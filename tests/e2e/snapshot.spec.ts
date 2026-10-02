import { test, expect, type Page, type Route } from '@playwright/test';

import { blockExternal } from './support/offline';

// Стани інтерфейсу R2, SPRINT-02:30…:37 (B-13) і частина B-16 про стани.
// `/api/snapshot` підмінено `page.route` літеральною відповіддю: сервер,
// ключ і AISStream тут не беруть участі, мережа заблокована. Отже доведено
// реакцію інтерфейсу на ФОРМУ відповіді, а не те, що справжній сервер її так
// віддає, — це стереже юніт-тест обробника. Живий ланцюжок «MMSI → значок →
// картка» і запуск без ключа лишаються ручною перевіркою (SPRINT-02:94).
//
// Тексти порівнюються точно — вони частина контракту (SPRINT-02:36).

const SUCCESS_ONE = {
  ok: true, collectedAt: '2026-01-01T12:00:00.000Z', windowSeconds: 15, count: 1,
  truncated: false, reason: 'window_elapsed',
  vessels: [{ id: '210385000', name: 'P&O PIONEER', lat: 51.1, lon: 1.3, speedKnots: 0,
    courseDeg: 48.2, timestamp: '2026-01-01T11:59:56.513Z', source: 'aisstream' }],
};
const SUCCESS_UNKNOWN = { ...SUCCESS_ONE, vessels: [{ ...SUCCESS_ONE.vessels[0], speedKnots: null, courseDeg: null }] };
const EMPTY = { ...SUCCESS_ONE, vessels: [], count: 0 };
const ERROR_NO_KEY = { ok: false, attemptedAt: '2026-01-01T12:00:00.000Z',
  error: { code: 'no_api_key', message: 'Ключ AISStream не налаштовано' } };

const BUTTON = 'Завантажити справжні позиції';
const CANCEL = 'Скасувати';

function loadButton(page: Page) {
  return page.getByRole('button', { name: BUTTON });
}

/** Значення поля картки за підписом — той самий прийом, що в select.spec.ts. */
function cardField(page: Page, label: string) {
  return page
    .locator('aside dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .locator('dd');
}

/**
 * Мережа заблокована, `/api/snapshot` підмінено, сторінка відкрита й демо
 * намальоване. Очікування першого значка — готовність, а не перевірка: карта
 * вантажиться окремим чанком `ssr: false`.
 */
async function open(page: Page, handler: (route: Route) => Promise<void>) {
  await blockExternal(page);
  // Предикат за pathname, а не glob `**/api/snapshot`: glob закріплений у
  // кінці, а клієнт тепер шле `?window=…&classB=…`.
  await page.route((url) => url.pathname === '/api/snapshot', handler);
  await page.goto('/');
  await page.locator('[data-vessel-id]').first().waitFor();
}

function cancelButton(page: Page) {
  return page.getByRole('button', { name: CANCEL });
}

function json(body: unknown, status: number) {
  return (route: Route) => route.fulfill({ status, json: body });
}

test('успіх з одним судном: значок, підпис і картка справжнього судна', async ({ page }) => {
  await open(page, json(SUCCESS_ONE, 200));
  await loadButton(page).click();

  const vessels = page.locator('[data-vessel-id]');
  await expect(vessels).toHaveCount(1);
  await expect(page.locator('[data-vessel-id="210385000"]')).toHaveCount(1);
  await expect(
    page.getByText('AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 1 · вибірка неповна', { exact: true }),
  ).toBeVisible();
  // Повідомлення немає: непорожній успіх пояснень не потребує.
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.locator('[data-vessel-id="210385000"]').click();
  await expect(cardField(page, 'Ідентифікатор')).toHaveText('210385000');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Джерело')).toHaveText('AISStream');
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

test('порожній успіх: суден немає, підпис із "суден: 0" і пояснення', async ({ page }) => {
  await open(page, json(EMPTY, 200));
  await loadButton(page).click();

  await expect(page.getByRole('status')).toHaveText('За час збору позицій не отримано');
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
  await expect(
    page.getByText('AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 0 · вибірка неповна', { exact: true }),
  ).toBeVisible();
});

test('помилка: карта порожня, "Даних на карті немає" і причина з відповіді', async ({ page }) => {
  await open(page, json(ERROR_NO_KEY, 502));
  await loadButton(page).click();

  await expect(page.getByRole('status')).toHaveText('Не вдалося отримати дані: Ключ AISStream не налаштовано');
  await expect(page.getByText('Даних на карті немає', { exact: true })).toBeVisible();
  // Попередній (демонстраційний) набір НЕ зберігається — SPRINT-02:34, стан error.
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
});

// R2 (SPRINT-02:31) вимагав тут заблоковану кнопку. Із 2026-10-02 та сама
// кнопка стає «Скасувати» (специфікація 2026-09-29 §5.1, рішення власника):
// удруге завантажити неможливо, бо кнопки завантаження в `loading` немає.
test('завантаження: кнопка стає «Скасувати», демо зупинене, вибір прибрано', async ({ page }) => {
  // Відповідь тримається, доки тест її не відпустить: без цього стан
  // `loading` тривав би мілісекунди, і твердження про нього були б гонкою.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open(page, async (route) => {
    await held;
    await route.fulfill({ status: 200, json: SUCCESS_ONE });
  });

  // Вибір ДО натискання: інакше «картки немає» нічого б не доводило.
  await page.locator('[data-vessel-id="demo-1"]').click();
  await expect(page.locator('aside dl')).toHaveCount(1);

  await loadButton(page).click();

  await expect(loadButton(page)).toHaveCount(0);
  await expect(cancelButton(page)).toBeEnabled();
  await expect(page.getByText('Завантаження…', { exact: true })).toBeVisible();
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
  await expect(page.locator('aside dl')).toHaveCount(0);

  release();

  await expect(loadButton(page)).toBeEnabled();
  await expect(cancelButton(page)).toHaveCount(0);
  await expect(page.locator('[data-vessel-id="210385000"]')).toHaveCount(1);
});

test('відповідь без тіла: помилка "Немає відповіді сервера", а не вічне завантаження', async ({ page }) => {
  await open(page, (route) => route.fulfill({ status: 502, body: '' }));
  await loadButton(page).click();

  await expect(page.getByRole('status')).toHaveText('Не вдалося отримати дані: Немає відповіді сервера');
  await expect(loadButton(page)).toBeEnabled();
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
});

/** Відповідь, яку тест відпускає сам; `release()` чекає, доки `fulfill` відпрацює. */
function heldRoute() {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let done: () => void = () => {};
  const finished = new Promise<void>((resolve) => { done = resolve; });
  const handler = async (route: Route) => {
    await held;
    // Запит уже обірвано — `fulfill` кидає; це очікувано, а не провал.
    await route.fulfill({ status: 200, json: SUCCESS_ONE }).catch(() => {});
    done();
  };
  return { handler, release: () => { release(); return finished; } };
}

test('«Скасувати»: запит обірвано, суден немає, "Завантаження скасовано"', async ({ page }) => {
  const held = heldRoute();
  await open(page, held.handler);

  await loadButton(page).click();

  const failed = page.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname === '/api/snapshot');
  await cancelButton(page).click();
  await failed;

  await expect(page.getByRole('status')).toHaveText('Завантаження скасовано');
  await expect(page.getByText('Даних на карті немає', { exact: true })).toBeVisible();
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
  await expect(loadButton(page)).toBeEnabled();
  await expect(cancelButton(page)).toHaveCount(0);
});

test('пізня відповідь після скасування не перезаписує стан', async ({ page }) => {
  const held = heldRoute();
  await open(page, held.handler);

  await loadButton(page).click();
  await cancelButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Завантаження скасовано');

  await held.release();

  await expect(page.getByRole('status')).toHaveText('Завантаження скасовано');
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
});

test('подвійний клік по «Завантажити» не скасовує власну спробу', async ({ page }) => {
  // Кнопка одна: другий клік подвійного кліку влучає вже в «Скасувати».
  const held = heldRoute();
  await open(page, held.handler);

  await loadButton(page).dblclick();
  await expect(cancelButton(page)).toBeVisible();
  await expect(page.getByText('Завантаження…', { exact: true })).toBeVisible();

  await held.release();
  await expect(page.locator('[data-vessel-id="210385000"]')).toHaveCount(1);
});

test('«Скасувати» видно лише під час завантаження', async ({ page }) => {
  await open(page, json(SUCCESS_ONE, 200));
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
  await open(page, json(SUCCESS_ONE, 200));
  await loadButton(page).click();
  await expect(page.locator('[data-vessel-id="210385000"]')).toHaveCount(1);
  expect(urls.map((u) => u.search)).toEqual(['?window=15&classB=0']);
});

test('повзунок на 2 хв і клас B: параметри в запиті, підпис із відповіді', async ({ page }) => {
  const urls = snapshotRequests(page);
  await open(page, json({ ...SUCCESS_ONE, windowSeconds: 120, includeClassB: true }, 200));

  const slider = page.getByRole('slider', { name: 'Вікно збору' });
  await slider.focus();
  // Індекс 0 → 3 (15 → 30 → 60 → 120).
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '2 хвилини');
  await page.getByRole('checkbox', { name: 'Малі судна (клас B)' }).check();

  await loadButton(page).click();
  await expect(page.getByText(
    'AISStream · знімок за 120 с · отримано 12:00:00 UTC · суден: 1 · вибірка неповна · із малими суднами (клас B)',
    { exact: true },
  )).toBeVisible();
  expect(urls.map((u) => u.search)).toEqual(['?window=120&classB=1']);
});

test('налаштування заблоковані під час завантаження', async ({ page }) => {
  const held = heldRoute();
  await open(page, held.handler);

  await loadButton(page).click();
  await expect(page.getByRole('slider', { name: 'Вікно збору' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Малі судна (клас B)' })).toBeDisabled();
  await held.release();
  await expect(page.getByRole('slider', { name: 'Вікно збору' })).toBeEnabled();
});

test('«Докладно»: закрите за замовчуванням, розкривається кліком', async ({ page }) => {
  await open(page, json({
    ...SUCCESS_ONE,
    diagnostics: { connectMs: 213, messages: 11, rejected: 0, byType: { PositionReport: 11 } },
  }, 200));
  await loadButton(page).click();

  const line = "з'єднання: 0,2 с · повідомлень: 11 (PositionReport: 11) · відкинуто: 0 · суден: 1";
  await expect(page.getByText(line, { exact: true })).toBeHidden();
  await page.getByText('Докладно', { exact: true }).click();
  await expect(page.getByText(line, { exact: true })).toBeVisible();
});

test('помилка без діагностики: «Докладно» немає', async ({ page }) => {
  await open(page, json({ ...ERROR_NO_KEY, diagnostics: null }, 502));
  await loadButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Не вдалося отримати дані: Ключ AISStream не налаштовано');
  await expect(page.getByText('Докладно', { exact: true })).toHaveCount(0);
});
