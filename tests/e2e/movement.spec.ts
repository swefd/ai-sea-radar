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
  // 100 мс, сумарно менше за секунду. startedAt уже прочитано при монтуванні
  // панелі (vessel-view.tsx:101) на паузі, тобто 12:00:00; а інтервал демонстрації
  // (2000 мс) за <1 с ще не спрацював. Це стереже перший тест: 12:00:00 UTC.
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
  const before = await page.locator(DEMO_1).boundingBox();

  await page.clock.runFor(8_000);

  await expect(cardField(page, 'Координати')).toHaveText('50.99900, 1.36000');
  await expect(cardField(page, 'Швидкість')).toHaveText('18 kn');
  await expect(cardField(page, 'Курс')).toHaveText('232°');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:08 UTC');
  // Карта й картка читають один стан: зрушила не лише картка, а й значок.
  expect(await page.locator(DEMO_1).boundingBox()).not.toEqual(before);
});

test('за кінцем маршруту: остання точка, 0 kn, курс і час останнього кроку, далі без змін', async ({ page }) => {
  // 30 с — за кінцем і demo-1 (7-й тік, 14 с), і всього флоту (11-й тік, 22 с).
  await page.clock.runFor(30_000);

  await expect(cardField(page, 'Координати')).toHaveText('50.81100, 1.05400');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Курс')).toHaveText('227°');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:14 UTC');
  const stopped = await page.locator(DEMO_1).boundingBox();

  // Ще хвилина — нічого не змінюється: без петлі й без повторного старту.
  await page.clock.runFor(60_000);

  await expect(cardField(page, 'Координати')).toHaveText('50.81100, 1.05400');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:14 UTC');
  expect(await page.locator(DEMO_1).boundingBox()).toEqual(stopped);
});
