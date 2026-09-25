// Логіка рішень кешу тайлів. Спека: docs/superpowers/specs/2026-09-25-tile-cache-design.md.
//
// Файл компілюється двічі: головним `tsconfig` (його імпортують unit-тести) і
// `tsconfig.sw.json` (його імпортує service worker у браузері). Тому тут немає
// ні `self`, ні мережі, ні DOM, ні жодного імпорту: `public/` не бачить `src/`.

/** Ім'я кешу. Зміна версії змушує `activate` викинути попередні. */
export const TILE_CACHE_NAME = 'tile-cache-v1';
export const TILE_CACHE_PREFIX = 'tile-cache-';

/**
 * Мітка часу отримання, яку SW дописує в збережену копію. Власна, бо `Date` і
 * `Age` з крос-доменної відповіді JS не бачить: OSM не віддає
 * `Access-Control-Expose-Headers` (спека §5.1).
 */
export const FETCHED_AT_HEADER = 'x-tile-fetched-at';

/**
 * Мінімум утримання з політики OSM для клієнтів, які не розуміють заголовків:
 * «retain each tile for at least 7 days». Діє, коли директиви вікна немає.
 */
export const OSM_MIN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Стан збереженої копії — рядок таблиці спеки §5.2.
 * - `fresh`: віддаємо копію, у мережу не йдемо;
 * - `revalidate`: віддаємо копію одразу, оновлюємо у фоні;
 * - `stale-if-error`: спершу мережа, копія — лише при помилці;
 * - `expired`: копія не годиться навіть запасом.
 */
export type TileCopyState = 'fresh' | 'revalidate' | 'stale-if-error' | 'expired';

/**
 * Значення директиви `Cache-Control` у секундах, або `null`, якщо її немає чи
 * вона нерозбірна. Межа слова перед назвою — щоб `s-maxage` не читався як
 * `max-age`.
 */
function directiveSeconds(cacheControl: string, name: string): number | null {
  const match = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*"?(\\d+)"?(?=\\s*(?:,|$))`, 'i').exec(
    cacheControl,
  );
  return match === null ? null : Number(match[1]);
}

function hasDirective(cacheControl: string, name: string): boolean {
  return new RegExp(`(?:^|[\\s,])${name}(?=\\s*(?:,|=|$))`, 'i').test(cacheControl);
}

/**
 * HTTP-дата у форматі IMF-fixdate (RFC 9110 §5.6.7), як її віддає OSM:
 * `Sat, 26 Sep 2026 07:26:45 GMT`. Перевіряємо форму до `Date.parse`, бо той
 * надто поблажливий: `Date.parse('0')` у Node повертає 2000 рік (виміряно).
 */
const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Момент, до якого копія свіжа, в мілісекундах. Джерело — `Expires`, а не
 * `max-age`: `max-age` відраховується від генерації відповіді, а `Age`, що
 * каже, скільки з нього вже минуло на CDN, JS не бачить (спека §5.1).
 * Нерозбірний `Expires` ігнорується, і строк рахується від власної мітки плюс
 * `max-age`. Без мітки строку взяти нізвідки, і результат `null`.
 */
function freshUntil(headers: Headers, cacheControl: string): number | null {
  const fetchedAt = Number(headers.get(FETCHED_AT_HEADER));
  const hasStamp = headers.has(FETCHED_AT_HEADER) && Number.isFinite(fetchedAt);

  if (hasDirective(cacheControl, 'no-store') || hasDirective(cacheControl, 'no-cache')) {
    return hasStamp ? fetchedAt : null;
  }

  const expires = headers.get('expires');
  if (expires !== null && IMF_FIXDATE.test(expires.trim())) {
    return Date.parse(expires);
  }

  if (!hasStamp) {
    return null;
  }
  const maxAge = directiveSeconds(cacheControl, 'max-age');
  return fetchedAt + (maxAge ?? 0) * 1000;
}

/** Класифікує збережену копію за її заголовками на момент `now`. */
export function classifyCopy(headers: Headers, now: number): TileCopyState {
  const cacheControl = headers.get('cache-control') ?? '';
  const until = freshUntil(headers, cacheControl);
  if (until === null) {
    return 'expired';
  }
  if (now < until) {
    return 'fresh';
  }

  const swr = directiveSeconds(cacheControl, 'stale-while-revalidate');
  const sie = directiveSeconds(cacheControl, 'stale-if-error');
  const swrEnd = until + (swr === null ? OSM_MIN_RETENTION_MS : swr * 1000);
  // Обидва вікна рахуються від кінця свіжості, як у RFC 5861. Якщо
  // `stale-if-error` коротший за SWR, його вікно вже вичерпане, коли SWR
  // закінчиться, — звідси `Math.max`, а не від'ємний проміжок.
  const sieEnd = Math.max(swrEnd, until + (sie === null ? OSM_MIN_RETENTION_MS : sie * 1000));

  if (now < swrEnd) {
    return 'revalidate';
  }
  if (now < sieEnd) {
    return 'stale-if-error';
  }
  return 'expired';
}

/** Чи має SW обробляти цей запит. Усе, що не GET до хоста тайлів, іде повз. */
export function isTileRequest(method: string, url: string, tileHost: string | null): boolean {
  if (method !== 'GET' || tileHost === null || tileHost === '') {
    return false;
  }
  try {
    return new URL(url).hostname === tileHost;
  } catch {
    return false;
  }
}

/** Лише повний успіх стає офлайн-копією. Непрозора відповідь має статус 0. */
export function isStorable(status: number): boolean {
  return status === 200;
}

/** Копія заголовків із міткою отримання. Оригінал не змінюється. */
export function stampFetchedAt(headers: Headers, now: number): Headers {
  const stamped = new Headers(headers);
  stamped.set(FETCHED_AT_HEADER, String(now));
  return stamped;
}
