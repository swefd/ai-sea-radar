import { test, expect } from '@playwright/test';

import {
  FETCHED_AT_HEADER,
  OSM_MIN_RETENTION_MS,
  classifyCopy,
  isStorable,
  isTileRequest,
  stampFetchedAt,
} from '@/_app/tile-cache/tile-freshness';

// Точка відліку довільна: логіка знає лише різниці, а не календар.
const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);
const SEC = 1000;
const DAY = 86_400 * SEC;

/** Копія, збережена в T0, зі строком свіжості `maxAge` секунд за `Expires`. */
function copy(cacheControl: string, maxAgeSec: number): Headers {
  return new Headers({
    'cache-control': cacheControl,
    expires: new Date(T0 + maxAgeSec * SEC).toUTCString(),
    [FETCHED_AT_HEADER]: String(T0),
  });
}

// Заголовки, які OSM віддав 2026-09-25 (спека §5.1).
const OSM = 'max-age=96910, stale-while-revalidate=604800, stale-if-error=604800';

test.describe('classifyCopy: стани з таблиці спеки §5.2', () => {
  test('до Expires — свіжа, у мережу не йдемо', () => {
    const h = copy(OSM, 96910);
    expect(classifyCopy(h, T0)).toBe('fresh');
    expect(classifyCopy(h, T0 + 96910 * SEC - 1)).toBe('fresh');
  });

  test('рівно на Expires і далі в межах SWR — віддаємо копію, оновлюємо у фоні', () => {
    const h = copy('max-age=60, stale-while-revalidate=120, stale-if-error=600', 60);
    expect(classifyCopy(h, T0 + 60 * SEC)).toBe('revalidate');
    expect(classifyCopy(h, T0 + 180 * SEC - 1)).toBe('revalidate');
  });

  test('за SWR, у межах stale-if-error — копія лише запасом при помилці', () => {
    const h = copy('max-age=60, stale-while-revalidate=120, stale-if-error=600', 60);
    expect(classifyCopy(h, T0 + 180 * SEC)).toBe('stale-if-error');
    expect(classifyCopy(h, T0 + 660 * SEC - 1)).toBe('stale-if-error');
  });

  test('за обома вікнами — прострочена', () => {
    const h = copy('max-age=60, stale-while-revalidate=120, stale-if-error=600', 60);
    expect(classifyCopy(h, T0 + 660 * SEC)).toBe('expired');
  });

  test('stale-if-error коротший за SWR — друге вікно порожнє, а не від\'ємне', () => {
    const h = copy('max-age=60, stale-while-revalidate=600, stale-if-error=120', 60);
    expect(classifyCopy(h, T0 + 659 * SEC)).toBe('revalidate');
    expect(classifyCopy(h, T0 + 660 * SEC)).toBe('expired');
  });
});

test.describe('classifyCopy: заголовка немає — діють 7 днів з політики OSM', () => {
  test('резерв дорівнює семи дням, а не іншому числу', () => {
    expect(OSM_MIN_RETENTION_MS).toBe(7 * DAY);
  });

  // Обидва вікна рахуються від кінця свіжості (RFC 5861), тож без директив
  // вони збігаються: сім днів копію видно, далі — ні.
  test('без директив вікон — сім днів від кінця свіжості', () => {
    const h = copy('max-age=60', 60);
    expect(classifyCopy(h, T0 + 60 * SEC + 7 * DAY - 1)).toBe('revalidate');
    expect(classifyCopy(h, T0 + 60 * SEC + 7 * DAY)).toBe('expired');
  });

  test('є лише stale-if-error — SWR бере 7 днів, а довший SIE лишається запасом', () => {
    const h = copy('max-age=60, stale-if-error=1209600', 60);
    expect(classifyCopy(h, T0 + 60 * SEC + 7 * DAY)).toBe('stale-if-error');
    expect(classifyCopy(h, T0 + 60 * SEC + 14 * DAY)).toBe('expired');
  });

  test('без жодного Cache-Control копія одразу застаріла, але вікна чинні', () => {
    const h = new Headers({ [FETCHED_AT_HEADER]: String(T0) });
    expect(classifyCopy(h, T0)).toBe('revalidate');
    expect(classifyCopy(h, T0 + 7 * DAY)).toBe('expired');
  });
});

test.describe('classifyCopy: без Expires — резерв через власну мітку', () => {
  test('свіжість = мітка + max-age', () => {
    const h = new Headers({ 'cache-control': 'max-age=60', [FETCHED_AT_HEADER]: String(T0) });
    expect(classifyCopy(h, T0 + 60 * SEC - 1)).toBe('fresh');
    expect(classifyCopy(h, T0 + 60 * SEC)).toBe('revalidate');
  });

  test('ні Expires, ні мітки — строку немає звідки взяти, копія прострочена', () => {
    const h = new Headers({ 'cache-control': OSM });
    expect(classifyCopy(h, T0)).toBe('expired');
  });
});

test.describe('classifyCopy: нерозбірні заголовки не вигадують строку', () => {
  test('битий Expires — рахуємо від мітки', () => {
    const h = new Headers({
      'cache-control': 'max-age=60',
      expires: 'not-a-date',
      [FETCHED_AT_HEADER]: String(T0),
    });
    expect(classifyCopy(h, T0 + 59 * SEC)).toBe('fresh');
    expect(classifyCopy(h, T0 + 60 * SEC)).toBe('revalidate');
  });

  // `Date.parse('0')` у Node дає 2000 рік. Без перевірки форми така копія
  // вважалася б застарілою ще до свого народження — і за вікнами прострочена.
  test('Expires: 0 не читається як 2000 рік', () => {
    const h = new Headers({
      'cache-control': 'stale-if-error=600',
      expires: '0',
      [FETCHED_AT_HEADER]: String(T0),
    });
    expect(classifyCopy(h, T0)).toBe('revalidate');
  });

  test('max-age=abc не дає числа — як без max-age', () => {
    const h = new Headers({ 'cache-control': 'max-age=abc', [FETCHED_AT_HEADER]: String(T0) });
    expect(classifyCopy(h, T0)).toBe('revalidate');
  });

  test('s-maxage не плутається з max-age', () => {
    const h = new Headers({
      'cache-control': 's-maxage=999999, max-age=60',
      [FETCHED_AT_HEADER]: String(T0),
    });
    expect(classifyCopy(h, T0 + 60 * SEC)).toBe('revalidate');
  });

  test('регістр і пробіли директив не важать', () => {
    const h = new Headers({
      'cache-control': 'Max-Age = 60 ,  Stale-If-Error=600',
      [FETCHED_AT_HEADER]: String(T0),
    });
    expect(classifyCopy(h, T0 + 59 * SEC)).toBe('fresh');
  });

  test('no-store чи no-cache — копії не віримо', () => {
    for (const cc of ['no-store', 'no-cache, max-age=600']) {
      const h = new Headers({ 'cache-control': cc, [FETCHED_AT_HEADER]: String(T0) });
      expect(classifyCopy(h, T0), cc).not.toBe('fresh');
    }
  });

  test('годинник пішов назад — копія свіжа, а не прострочена', () => {
    const h = copy(OSM, 96910);
    expect(classifyCopy(h, T0 - DAY)).toBe('fresh');
  });
});

test.describe('isTileRequest: SW чіпає лише GET до хоста тайлів', () => {
  const HOST = 'tiles.example.test';

  test('GET до хоста тайлів — так', () => {
    expect(isTileRequest('GET', `https://${HOST}/10/515/342.png`, HOST)).toBe(true);
  });

  test('інші методи — ні', () => {
    for (const method of ['POST', 'HEAD', 'PUT', 'get']) {
      expect(isTileRequest(method, `https://${HOST}/1/1/1.png`, HOST), method).toBe(false);
    }
  });

  test('інший хост, loopback, API, HMR — ні', () => {
    for (const url of [
      'https://evil.example.test/10/515/342.png',
      `https://sub.${HOST}/1/1/1.png`,
      'http://127.0.0.1:3000/api/snapshot',
      'http://127.0.0.1:3000/_next/static/chunks/main.js',
      'ws://127.0.0.1:3000/_next/webpack-hmr',
    ]) {
      expect(isTileRequest('GET', url, HOST), url).toBe(false);
    }
  });

  test('хост не передано — SW не чіпає нічого', () => {
    expect(isTileRequest('GET', `https://${HOST}/1/1/1.png`, null)).toBe(false);
    expect(isTileRequest('GET', `https://${HOST}/1/1/1.png`, '')).toBe(false);
  });

  test('нерозбірний URL — ні, без винятку', () => {
    expect(isTileRequest('GET', 'не адреса', HOST)).toBe(false);
  });
});

test.describe('isStorable: у кеш іде лише успіх', () => {
  test('200 — так', () => {
    expect(isStorable(200)).toBe(true);
  });

  test('помилки, редиректи, частковий вміст і непрозора відповідь (0) — ні', () => {
    for (const status of [0, 204, 206, 304, 404, 429, 500, 503]) {
      expect(isStorable(status), String(status)).toBe(false);
    }
  });
});

test.describe('stampFetchedAt', () => {
  test('дописує мітку й не губить решту заголовків', () => {
    const original = new Headers({ 'cache-control': OSM, 'content-type': 'image/png' });
    const stamped = stampFetchedAt(original, T0);
    expect(stamped.get(FETCHED_AT_HEADER)).toBe(String(T0));
    expect(stamped.get('cache-control')).toBe(OSM);
    expect(stamped.get('content-type')).toBe('image/png');
  });

  test('оригінал не змінюється', () => {
    const original = new Headers({ 'cache-control': OSM });
    stampFetchedAt(original, T0);
    expect(original.has(FETCHED_AT_HEADER)).toBe(false);
  });
});
