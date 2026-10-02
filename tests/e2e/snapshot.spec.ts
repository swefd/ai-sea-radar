import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { blockExternal } from './support/offline';

// Контракт R4, CR :40…:53 (B-19): два незалежні стани — показаний набір із
// підписом джерела і результат останньої спроби окремим рядком.
// `/api/snapshot` підмінено `page.route` літеральними відповідями: сервер,
// ключ і AISStream тут не беруть участі, мережа заблокована. Отже доведено
// реакцію інтерфейсу на ФОРМУ відповіді, а не доступність AISStream (CR :91).
//
// Тексти порівнюються точно — вони частина контракту. Усі часи — літерали з
// тіл підмінених відповідей; годинник браузера жодного тексту не дає (CR :33).
//
// ЩО ЗМІНИЛОСЯ ПРОТИ R2 і чому (CR :55, :83). Тести станів R2 з B-16
// («порожній успіх: суден немає…», «помилка: карта порожня…») і три тести B-13
// («успіх з одним судном…», «завантаження: … демо зупинене, вибір прибрано»,
// «відповідь без тіла…») кодували правило «показуємо результат останньої
// спроби» — лист замовника № 3 його змінив. Тест «судно без швидкості й
// курсу» перенесено без правок.

const SUCCESS_ONE = {
  ok: true, collectedAt: '2026-01-01T12:00:00.000Z', windowSeconds: 15, count: 1,
  truncated: false, reason: 'window_elapsed',
  vessels: [{ id: '210385000', name: 'P&O PIONEER', lat: 51.1, lon: 1.3, speedKnots: 0,
    courseDeg: 48.2, timestamp: '2026-01-01T11:59:56.513Z', source: 'aisstream' }],
};
const SUCCESS_UNKNOWN = { ...SUCCESS_ONE, vessels: [{ ...SUCCESS_ONE.vessels[0], speedKnots: null, courseDeg: null }] };
const ERROR_NO_KEY = { ok: false, attemptedAt: '2026-01-01T12:00:00.000Z',
  error: { code: 'no_api_key', message: 'Ключ AISStream не налаштовано' } };

// Друга спроба — на хвилину пізніше, щоб час у рядку спроби відрізнявся від
// часу в підписі: саме ця різниця доводить, що підпис не оновився.
const EMPTY_LATER = { ...SUCCESS_ONE, collectedAt: '2026-01-01T12:01:00.000Z', vessels: [], count: 0 };
const ERROR_LATER = { ok: false, attemptedAt: '2026-01-01T12:01:00.000Z',
  error: { code: 'disconnected', message: "З'єднання з джерелом розірвано" } };
const ERROR_LATEST = { ...ERROR_LATER, attemptedAt: '2026-01-01T12:02:00.000Z' };
/** Те саме судно в тих самих координатах — другий непорожній успіх. */
const SUCCESS_AGAIN = { ...SUCCESS_ONE, collectedAt: '2026-01-01T12:01:00.000Z' };
/** Те саме судно, нова позиція й новий час повідомлення. */
const SUCCESS_MOVED = { ...SUCCESS_AGAIN, vessels: [{ ...SUCCESS_ONE.vessels[0],
  lat: 51.2, lon: 1.4, timestamp: '2026-01-01T12:00:58.000Z' }] };
/** Інше судно: обраного `210385000` у цьому наборі немає. */
const SUCCESS_OTHER = { ...SUCCESS_AGAIN, vessels: [{ ...SUCCESS_ONE.vessels[0],
  id: '235000001', name: 'OTHER', lat: 51.05, lon: 1.6 }] };
const SUCCESS_TRUNCATED = { ...SUCCESS_ONE, truncated: true, reason: 'limit_reached' };

const BUTTON = 'Завантажити справжні позиції';
const CANCEL = 'Скасувати';
const DEMO_CAPTION = 'Демонстраційні дані';
const CAPTION_1200 = 'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 1 · вибірка неповна';
const HINT = 'Після оновлення сторінки знову показуються демонстраційні дані';
const REAL = '[data-vessel-id="210385000"]';
const DEMO = '[data-vessel-id^="demo-"]';

type Handler = (route: Route) => Promise<void>;

function loadButton(page: Page) {
  return page.getByRole('button', { name: BUTTON });
}

function cancelButton(page: Page) {
  return page.getByRole('button', { name: CANCEL });
}

/** Рядок результату спроби — єдиний `role="status"` на сторінці. */
function attemptLine(page: Page) {
  return page.getByRole('status');
}

/**
 * Підпис джерела — поза картою й поза карткою: поле «Джерело» картки
 * демо-судна має той самий текст «Демонстраційні дані», тож пошук по всій
 * сторінці знаходив би обидва.
 */
function caption(page: Page, text: string) {
  return page.locator('aside > :not(#vessel-panel-body)').getByText(text, { exact: true });
}

/** Значення поля картки за підписом — той самий прийом, що в select.spec.ts. */
function cardField(page: Page, label: string) {
  return page
    .locator('aside dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .locator('dd');
}

function card(page: Page) {
  return page.locator('aside dl');
}

/** Незвернений корінь маркера Leaflet — його рамку пише лише `setLatLng` і вид карти. */
function markerRoot(page: Page, selector: string) {
  return page.locator('.leaflet-marker-icon', { has: page.locator(selector) });
}

function json(body: unknown, status: number): Handler {
  return (route) => route.fulfill({ status, json: body });
}

/** Відповідь, яку тест відпускає сам: без цього очікування тривало б мілісекунди. */
function held(body: unknown, status: number): { handler: Handler; release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    handler: async (route) => {
      await gate;
      await route.fulfill({ status, json: body });
    },
    release,
  };
}

/**
 * Мережа заблокована, `/api/snapshot` віддає відповіді з черги — N-те
 * натискання отримує N-ту. Зайвий запит скасовується: це видима помилка в
 * рядку спроби, а не мовчазний повтор останньої відповіді.
 *
 * `clock` — `page.clock.install` БЕЗ паузи: час іде сам, `runFor` додає тіки.
 * Ставиться до `goto`, інакше демо стартує за справжнім годинником.
 *
 * Очікування першого значка — готовність, а не перевірка: карта вантажиться
 * окремим чанком `ssr: false`.
 */
async function open(page: Page, handlers: Handler | Handler[], { clock = false } = {}) {
  // Одиночний обробник — щоб тест «судно без швидкості й курсу» перейшов з R2
  // байт у байт (CR :55: він без правок).
  const queue = Array.isArray(handlers) ? handlers : [handlers];
  if (clock) {
    await page.clock.install({ time: new Date('2026-01-01T11:59:00.000Z') });
  }
  await blockExternal(page);
  let next = 0;
  // Предикат за pathname, а не glob `**/api/snapshot`: glob закріплений у
  // кінці, а клієнт шле `?window=…&classB=…`.
  await page.route((url) => url.pathname === '/api/snapshot', (route) => {
    const handler = queue[next];
    next += 1;
    return handler === undefined ? route.abort() : handler(route);
  });
  await page.goto('/');
  await page.locator('[data-vessel-id]').first().waitFor();
}

/** Натиснути й дочекатися КІНЦЕВОГО тексту рядка — моменту, коли відповідь застосована. */
async function load(page: Page, expectedLine: string) {
  await loadButton(page).click();
  await expect(attemptLine(page)).toHaveText(expectedLine);
}

/**
 * Рамка, що не змінюється між двома читаннями: зум і перетягування Leaflet
 * анімовані, і рамка в середині анімації нічого б не доводила. `expect.poll`
 * сам повторює читання з інтервалом — `waitForTimeout` не потрібен.
 */
async function settledBox(locator: Locator) {
  let previous = '';
  await expect.poll(async () => {
    const current = JSON.stringify(await locator.boundingBox());
    const settled = current !== 'null' && current === previous;
    previous = current;
    return settled;
  }, { intervals: [250] }).toBe(true);
  return JSON.parse(previous) as { x: number; y: number; width: number; height: number };
}

test('успіх 12:00:00: набір замінений, підпис і рядок спроби, рух демонстрації зупинено', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200)], { clock: true });
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  // Набір замінено цілком: лише судно відповіді, жодного демо-судна (CR :30).
  await expect(page.locator('[data-vessel-id]')).toHaveCount(1);
  await expect(page.locator(REAL)).toHaveCount(1);
  await expect(caption(page, CAPTION_1200)).toBeVisible();

  await page.locator(REAL).click();
  await expect(cardField(page, 'Ідентифікатор')).toHaveText('210385000');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Джерело')).toHaveText('AISStream');
  await expect(cardField(page, 'Координати')).toHaveText('51.10000, 1.30000');

  // CR :51: кілька тіків — справжні судна між завантаженнями не рухаються,
  // і демо не повертається.
  await page.clock.runFor(10_000);
  await expect(cardField(page, 'Координати')).toHaveText('51.10000, 1.30000');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('11:59:56 UTC');
  await expect(page.locator(DEMO)).toHaveCount(0);
});

test('повторне очікування: попередній набір на карті, кнопка заблокована, "Завантаження…"', async ({ page }) => {
  const second = held(SUCCESS_AGAIN, 200);
  await open(page, [json(SUCCESS_ONE, 200), second.handler]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  // Вибір ДО другого натискання: картка має пережити очікування (D6).
  await page.locator(REAL).click();
  await expect(card(page)).toHaveCount(1);

  await loadButton(page).click();

  // Удруге завантажити неможливо: кнопки завантаження в очікуванні немає, на
  // її місці «Скасувати» (рішення власника 2026-10-02, замість `disabled`).
  await expect(loadButton(page)).toHaveCount(0);
  await expect(cancelButton(page)).toBeEnabled();
  await expect(attemptLine(page)).toHaveText('Завантаження…');
  await expect(page.locator(REAL)).toHaveCount(1);
  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(card(page)).toHaveCount(1);

  second.release();

  await expect(attemptLine(page)).toHaveText('Спроба 12:01:00 UTC: отримано суден: 1');
  await expect(loadButton(page)).toBeEnabled();
  await expect(cancelButton(page)).toHaveCount(0);
});

test('порожня відповідь 12:01:00 після успіху 12:00:00: набір і підпис збережені', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(EMPTY_LATER, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await load(page, 'Спроба 12:01:00 UTC: за час збору позицій не отримано');

  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator('[data-vessel-id]')).toHaveCount(1);
  await expect(page.locator(REAL)).toHaveCount(1);
});

test('помилка 12:01:00 після успіху 12:00:00: набір і підпис збережені', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(ERROR_LATER, 502)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await load(page, "Спроба 12:01:00 UTC: не вдалося отримати дані: З'єднання з джерелом розірвано");

  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator(REAL)).toHaveCount(1);
  await expect(loadButton(page)).toBeEnabled();
});

test('збій за збоєм: рядок показує останню спробу, підпис — і далі останній успіх', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(EMPTY_LATER, 200), json(ERROR_LATEST, 502)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await load(page, 'Спроба 12:01:00 UTC: за час збору позицій не отримано');
  await load(page, "Спроба 12:02:00 UTC: не вдалося отримати дані: З'єднання з джерелом розірвано");

  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator(REAL)).toHaveCount(1);
});

test('помилка при демонстрації: судна рухаються, підпис "Демонстраційні дані", рядок без ключа', async ({ page }) => {
  await open(page, [json(ERROR_NO_KEY, 502)], { clock: true });

  // demo-3 — найдовший маршрут (22 с): за час завантаження сторінки він не стане.
  await page.locator('[data-vessel-id="demo-3"]').click();
  await load(page, 'Спроба 12:00:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано');

  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);

  const before = await cardField(page, 'Координати').textContent();
  await page.clock.runFor(4_000);
  await expect(cardField(page, 'Координати')).not.toHaveText(before ?? '');
});

test('очікування при демонстрації: демо рухається, поки запит триває', async ({ page }) => {
  // CR :26 — саме ОЧІКУВАННЯ, не наслідок відповіді: рух перевіряється, поки
  // рядок ще «Завантаження…», а відповідь притримана.
  const pending = held(ERROR_NO_KEY, 502);
  await open(page, [pending.handler], { clock: true });

  await page.locator('[data-vessel-id="demo-3"]').click();
  await loadButton(page).click();
  await expect(attemptLine(page)).toHaveText('Завантаження…');

  const before = await cardField(page, 'Координати').textContent();
  expect(before).not.toBeNull();
  await page.clock.runFor(4_000);
  await expect(cardField(page, 'Координати')).not.toHaveText(before!);
  await expect(attemptLine(page)).toHaveText('Завантаження…');

  pending.release();
  await expect(attemptLine(page)).toHaveText(
    'Спроба 12:00:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано',
  );
});

test('порожній успіх при демонстрації: демо рухається далі, підпис не змінюється', async ({ page }) => {
  await open(page, [json(EMPTY_LATER, 200)], { clock: true });

  await page.locator('[data-vessel-id="demo-3"]').click();
  await load(page, 'Спроба 12:01:00 UTC: за час збору позицій не отримано');

  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);

  const before = await cardField(page, 'Координати').textContent();
  await page.clock.runFor(4_000);
  await expect(cardField(page, 'Координати')).not.toHaveText(before ?? '');
});

test('обраного судна немає в новому наборі: картка закрита, набори не злиті', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(SUCCESS_OTHER, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await page.locator(REAL).click();
  await expect(card(page)).toHaveCount(1);

  await load(page, 'Спроба 12:01:00 UTC: отримано суден: 1');

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(REAL)).toHaveCount(0);
  await expect(page.locator('[data-vessel-id="235000001"]')).toHaveCount(1);
});

test('обране демо-судно після непорожнього успіху: картка закрита', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200)]);
  await page.locator('[data-vessel-id="demo-1"]').click();
  await expect(card(page)).toHaveCount(1);

  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  await expect(card(page)).toHaveCount(0);
});

test('обране судно є в новому наборі: картка показує нові координати й час', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(SUCCESS_MOVED, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await page.locator(REAL).click();
  await expect(cardField(page, 'Координати')).toHaveText('51.10000, 1.30000');

  await load(page, 'Спроба 12:01:00 UTC: отримано суден: 1');

  await expect(cardField(page, 'Координати')).toHaveText('51.20000, 1.40000');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:58 UTC');
});

test('успіх, судно без швидкості й курсу: "Немає даних" і нейтральний значок', async ({ page }) => {
  await open(page, json(SUCCESS_UNKNOWN, 200));
  await loadButton(page).click();

  const vessel = page.locator('[data-vessel-id="210385000"]');
  await expect(vessel).toHaveAttribute('data-icon', 'neutral');

  await vessel.click();
  await expect(cardField(page, 'Швидкість')).toHaveText('Немає даних');
  await expect(cardField(page, 'Курс')).toHaveText('Немає даних');
});

test('успіх з truncated: підпис закінчується на " · зупинено на ліміті 100"', async ({ page }) => {
  await open(page, [json(SUCCESS_TRUNCATED, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  await expect(caption(page, `${CAPTION_1200} · зупинено на ліміті 100`)).toBeVisible();
});

test('другий непорожній успіх після зсуву карти: центр і масштаб не змінилися', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(SUCCESS_AGAIN, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  const initial = await settledBox(markerRoot(page, REAL));

  // Людина наблизилась і зсунула карту. Перетягування — з порожнього місця
  // карти ліворуч від панелі, не з маркера.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.mouse.move(400, 500);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 10 });
  await page.mouse.up();
  const shifted = await settledBox(markerRoot(page, REAL));
  // Без цього порівняння нижче нічого б не доводило: вид мав справді змінитися.
  expect(shifted).not.toEqual(initial);

  // Те саме судно в тих самих координатах: рамка маркера змінилася б лише від
  // зміни виду карти.
  await load(page, 'Спроба 12:01:00 UTC: отримано суден: 1');
  expect(await settledBox(markerRoot(page, REAL))).toEqual(shifted);
});

test('відповідь без тіла: "Немає відповіді сервера" без часу, набір збережений', async ({ page }) => {
  await open(page, [(route) => route.fulfill({ status: 502, body: '' })]);
  await load(page, 'Спроба: не вдалося отримати дані: Немає відповіді сервера');

  await expect(loadButton(page)).toBeEnabled();
  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);
});

test('підказка про оновлення сторінки є завжди, і рядок спроби видно згорнутою панеллю', async ({ page }) => {
  await open(page, [json(ERROR_NO_KEY, 502)]);

  // До першого натискання: підказка є, рядка спроби немає (CR :25).
  await expect(page.getByText(HINT, { exact: true })).toBeVisible();
  await expect(attemptLine(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Згорнути' }).click();
  await load(page, 'Спроба 12:00:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано');

  await expect(page.getByText(HINT, { exact: true })).toBeVisible();
  await expect(attemptLine(page)).toBeVisible();
});

// ── Налаштування знімка, «Скасувати», смуга збору, «Докладно» (main,
// специфікація 2026-09-29) — під контрактом R4: скасування теж спроба без
// результату, тож набір і підпис лишаються, змінюється лише рядок спроби.

test('«Скасувати»: запит обірвано, набір і підпис збережені, "Завантаження скасовано"', async ({ page }) => {
  const pending = held(SUCCESS_ONE, 200);
  await open(page, [pending.handler]);

  await loadButton(page).click();

  const failed = page.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname === '/api/snapshot');
  await cancelButton(page).click();
  await failed;

  await expect(attemptLine(page)).toHaveText('Завантаження скасовано');
  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);
  await expect(loadButton(page)).toBeEnabled();
  await expect(cancelButton(page)).toHaveCount(0);
});

test('«Скасувати» після успіху: знімок лишається на карті', async ({ page }) => {
  const pending = held(SUCCESS_AGAIN, 200);
  await open(page, [json(SUCCESS_ONE, 200), pending.handler]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  await loadButton(page).click();
  await cancelButton(page).click();

  await expect(attemptLine(page)).toHaveText('Завантаження скасовано');
  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator(REAL)).toHaveCount(1);
});

test('пізня відповідь після скасування не перезаписує стан', async ({ page }) => {
  // Відповідь — справжнє судно: якби пізня відповідь записалась, воно з'явилось би.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let done: () => void = () => {};
  const finished = new Promise<void>((resolve) => { done = resolve; });
  await open(page, [async (route) => {
    await gate;
    // Запит уже обірвано — `fulfill` кидає; це очікувано, а не провал.
    await route.fulfill({ status: 200, json: SUCCESS_ONE }).catch(() => {});
    done();
  }]);

  await loadButton(page).click();
  await cancelButton(page).click();
  await expect(attemptLine(page)).toHaveText('Завантаження скасовано');

  release();
  await finished;

  await expect(attemptLine(page)).toHaveText('Завантаження скасовано');
  await expect(page.locator(REAL)).toHaveCount(0);
  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
});

test('подвійний клік по «Завантажити» не скасовує власну спробу', async ({ page }) => {
  // Кнопка одна: другий клік подвійного кліку влучає вже в «Скасувати».
  const pending = held(SUCCESS_ONE, 200);
  await open(page, [pending.handler]);

  await loadButton(page).dblclick();
  await expect(cancelButton(page)).toBeVisible();
  await expect(attemptLine(page)).toHaveText('Завантаження…');

  pending.release();
  await expect(attemptLine(page)).toHaveText('Спроба 12:00:00 UTC: отримано суден: 1');
  await expect(page.locator(REAL)).toHaveCount(1);
});

test('«Скасувати» видно лише під час завантаження', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200)]);
  await expect(cancelButton(page)).toHaveCount(0);
});

function snapshotRequests(page: Page) {
  const urls: URL[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/snapshot') urls.push(url);
  });
  return urls;
}

test('без дотику до налаштувань: window=15, classB=0', async ({ page }) => {
  const urls = snapshotRequests(page);
  await open(page, [json(SUCCESS_ONE, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  expect(urls.map((u) => u.search)).toEqual(['?window=15&classB=0']);
});

test('повзунок на 2 хв і клас B: параметри в запиті, підпис із відповіді', async ({ page }) => {
  const urls = snapshotRequests(page);
  await open(page, [json({ ...SUCCESS_ONE, windowSeconds: 120, includeClassB: true }, 200)]);

  const slider = page.getByRole('slider', { name: 'Вікно збору' });
  await slider.focus();
  // Індекс 0 → 3 (15 → 30 → 60 → 120).
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '2 хвилини');
  await page.getByRole('checkbox', { name: 'Малі судна (клас B)' }).check();

  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await expect(caption(page,
    'AISStream · знімок за 120 с · отримано 12:00:00 UTC · суден: 1 · вибірка неповна · із малими суднами (клас B)',
  )).toBeVisible();
  expect(urls.map((u) => u.search)).toEqual(['?window=120&classB=1']);
});

test('налаштування заблоковані під час завантаження', async ({ page }) => {
  const pending = held(SUCCESS_ONE, 200);
  await open(page, [pending.handler]);

  await loadButton(page).click();
  await expect(page.getByRole('slider', { name: 'Вікно збору' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Малі судна (клас B)' })).toBeDisabled();
  pending.release();
  await expect(page.getByRole('slider', { name: 'Вікно збору' })).toBeEnabled();
});

// Смуга збору рахує вибране вікно браузерним годинником від натискання — це
// оцінка, сервер свого прогресу не шле. `page.clock` тут не на паузі (карта
// вантажиться чанком, що чекає таймерів), тож час іде й сам: звідси діапазон
// «13 або 14 с» після стрибка на 13 с, а не одне число.
test('смуга збору: лічильник секунд, стеля на вікні, зникає з відповіддю', async ({ page }) => {
  const pending = held(SUCCESS_ONE, 200);
  await open(page, [pending.handler], { clock: true });

  const progress = page.getByRole('progressbar', { name: 'Збір позицій' });
  await expect(progress).toHaveCount(0);

  await loadButton(page).click();
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuemax', '15');

  await page.clock.fastForward(13_000);
  await expect(page.getByText(/^1[34] с із 15 с$/)).toBeVisible();

  await page.clock.fastForward(10_000);
  await expect(page.getByText('15 с із 15 с', { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '15');

  pending.release();
  await expect(progress).toHaveCount(0);
});

test('смуга збору зникає після «Скасувати»', async ({ page }) => {
  const pending = held(SUCCESS_ONE, 200);
  await open(page, [pending.handler]);

  await loadButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Збір позицій' })).toBeVisible();
  await cancelButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Збір позицій' })).toHaveCount(0);
});

test('«Докладно»: закрите за замовчуванням, розкривається кліком', async ({ page }) => {
  await open(page, [json({
    ...SUCCESS_ONE,
    diagnostics: { connectMs: 213, messages: 11, rejected: 0, byType: { PositionReport: 11 } },
  }, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  const line = "з'єднання: 0,2 с · повідомлень: 11 (PositionReport: 11) · відкинуто: 0 · суден: 1";
  await expect(page.getByText(line, { exact: true })).toBeHidden();
  await page.getByText('Докладно', { exact: true }).click();
  await expect(page.getByText(line, { exact: true })).toBeVisible();
});

test('помилка без діагностики: «Докладно» немає', async ({ page }) => {
  await open(page, [json({ ...ERROR_NO_KEY, diagnostics: null }, 502)]);
  await load(page, 'Спроба 12:00:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано');
  await expect(page.getByText('Докладно', { exact: true })).toHaveCount(0);
});
