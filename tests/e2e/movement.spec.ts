import { test, expect, type Page } from '@playwright/test';

import { blockExternal } from './support/offline';

// Рух демонстрації з керованим часом браузера, B-16 (SPRINT-03:62). Годинник
// сторінки — page.clock; серверного збирача він не стосується: це інший
// процес із власним годинником (SPRINT-03:24, :94).
//
// Очікування — ЛІТЕРАЛИ, переписані руками з src/entities/vessel/model/
// demo-routes.ts (demo-1, 8 точок, 18 kn), а не виклик vesselAtTick. Курси
// 232° і 227° пораховано незалежно від коду застосунку (Python, початковий
// азимут великого кола) і затверджено людиною до написання assertions.
//
// Годинник ставиться на паузу рівно на 12:00:00 ДО завантаження сторінки:
// момент старту демонстрації (useState(() => Date.now()) у vessel-view.tsx)
// тоді точно 12:00:00, і час кроку i — 12:00:00 + i·2 с. Час рухається лише
// через runFor — чотири тіки по 2000 мс (SPRINT-01) = 8000.

const DEMO_1 = '[data-vessel-id="demo-1"]';

// Позицію значка міряємо за НЕЗВЕРНЕНИМ коренем маркера Leaflet, а не за
// вузлом із data-vessel-id: той — дочірній гліф, повернутий на курс
// (vessel-icon.ts), і його рамка змінюється вже від самої зміни кута, навіть
// коли маркер стоїть на місці. transform кореня пише лише setLatLng.
function markerRoot(page: Page) {
  return page.locator('.leaflet-marker-icon', { has: page.locator(DEMO_1) });
}

function cardField(page: Page, label: string) {
  return page
    .locator('aside dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .locator('dd');
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T11:59:59.000Z') });
  await page.clock.pauseAt(new Date('2026-01-01T12:00:00.000Z'));
  await blockExternal(page);
  await page.goto('/');
  // Карта — окремий чанк dynamic(..., { ssr: false }), і його завантаження чекає
  // на таймери, які поставлений на паузу підмінний годинник тримає: без руху
  // часу значок не з'являється ніколи. Тож час просуваємо обмеженими кроками по
  // 100 мс, сумарно менше за секунду. startedAt (vessel-view.tsx:101) читається
  // при монтуванні панелі; чи це сталося до чи під час цих кроків, тест не знає —
  // доведено лише, що до першого тіка час старту в межах тієї самої секунди
  // 12:00:00 (перший тест). Інтервал демонстрації (2000 мс) за <1 с не спрацьовує.
  const marker = page.locator(DEMO_1);
  let advancedMs = 0;
  while ((await marker.count()) === 0 && advancedMs < 900) {
    await page.clock.runFor(100);
    advancedMs += 100;
  }
  await marker.waitFor({ timeout: 1_000 });
  await marker.click();
  await expect(page.locator('aside dl')).toHaveCount(1);
});

test('до першого тіка: точка 0 і час старту', async ({ page }) => {
  await expect(cardField(page, 'Координати')).toHaveText('51.22940, 1.76670');
  await expect(cardField(page, 'Швидкість')).toHaveText('18 kn');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:00 UTC');
});

test('через чотири тіки: значок зрушив, картка показує нові координати', async ({ page }) => {
  await expect(markerRoot(page)).toHaveCount(1);
  const before = await markerRoot(page).boundingBox();

  await page.clock.runFor(8_000);

  await expect(cardField(page, 'Координати')).toHaveText('50.99900, 1.36000');
  await expect(cardField(page, 'Швидкість')).toHaveText('18 kn');
  await expect(cardField(page, 'Курс')).toHaveText('232°');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:08 UTC');
  // Карта й картка читають один стан: зрушила не лише картка, а й сам маркер.
  // Точка 0 → точка 4 — на південний захід: на зумі 10 це близько 296 px ліворуч
  // і 267 px донизу. Пороги 100 px відсікають і поворот гліфа (частки пікселя),
  // і випадкове тремтіння, але не справжній зсув; напрям перевіряється знаком.
  const after = await markerRoot(page).boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(before!.x - after!.x).toBeGreaterThan(100);
  expect(after!.y - before!.y).toBeGreaterThan(100);
});

test('за кінцем маршруту: остання точка, 0 kn, курс і час останнього кроку, далі без змін', async ({ page }) => {
  // 30 с — за кінцем і demo-1 (7-й тік, 14 с), і всього флоту (11-й тік, 22 с).
  await page.clock.runFor(30_000);

  await expect(cardField(page, 'Координати')).toHaveText('50.81100, 1.05400');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Курс')).toHaveText('227°');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:14 UTC');
  await expect(markerRoot(page)).toHaveCount(1);
  const stopped = await markerRoot(page).boundingBox();
  // Без цього порівняння нижче було б порожнім: зниклий маркер дав би null === null.
  expect(stopped).not.toBeNull();

  // Ще хвилина — нічого не змінюється: без петлі й без повторного старту.
  await page.clock.runFor(60_000);

  await expect(cardField(page, 'Координати')).toHaveText('50.81100, 1.05400');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:14 UTC');
  expect(await markerRoot(page).boundingBox()).toEqual(stopped);
});
