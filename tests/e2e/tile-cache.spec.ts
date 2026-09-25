import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { OSM_TILE_LAYER } from '@/shared/config';

/**
 * Кеш тайлів: спека docs/superpowers/specs/2026-09-25-tile-cache-design.md, §7.4.
 *
 * Мережі тест не торкається ніколи. Тайли підробляє `context.route`, а не
 * `page.route`: запити, які SW робить сам, `page.route` не бачить
 * (документація Playwright), а тут перевіряються саме вони.
 *
 * Що це доводить: механіку на заголовках, які задає тест. Чого не доводить:
 * що справжній OSM сьогодні віддає ті самі заголовки (спека §9).
 */

test.use({ serviceWorkers: 'allow' });

const TILE_HOST = new URL(OSM_TILE_LAYER.urlTemplate).hostname;

// 1×1 прозорий PNG. Розмір не важить: перевіряємо, що зображення декодувалося.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function isLoopback(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

type Network = 'online' | 'offline';

/**
 * Одна точка керування мережею для всього контексту. Онлайн: тайли отримують
 * підроблену відповідь зі строком у годину, решта зовнішнього скасовується —
 * тест не ходить у справжню мережу навіть «онлайн». Офлайн: скасовується все,
 * що не loopback. Лічильник рахує тайли, що реально дійшли до «мережі».
 */
async function controlNetwork(context: BrowserContext) {
  const state = { mode: 'online' as Network, served: 0 };
  await context.route(
    (url) => !isLoopback(url.href),
    async (route) => {
      const url = new URL(route.request().url());
      if (state.mode === 'online' && url.hostname === TILE_HOST) {
        state.served += 1;
        await route.fulfill({
          status: 200,
          body: PNG,
          headers: {
            'content-type': 'image/png',
            'access-control-allow-origin': '*',
            'cache-control': 'max-age=3600, stale-while-revalidate=604800, stale-if-error=604800',
            expires: new Date(Date.now() + 3_600_000).toUTCString(),
          },
        });
        return;
      }
      await route.abort('internetdisconnected');
    },
  );
  return state;
}

async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Кожен тайл на карті декодувався, і тайлів більше нуля. */
async function expectTilesLoaded(page: Page): Promise<void> {
  const tiles = page.locator('img.leaflet-tile');
  await expect(tiles.first()).toBeVisible();
  await expect
    .poll(async () =>
      tiles.evaluateAll((imgs) =>
        (imgs as HTMLImageElement[]).every((img) => img.complete && img.naturalWidth > 0),
      ),
    )
    .toBe(true);
  expect(await tiles.count()).toBeGreaterThan(0);
}

test('переглянута онлайн карта лишається видимою офлайн', async ({ page, context }) => {
  const network = await controlNetwork(context);

  // Перше відкриття: сторінка ще не під контролем SW (спека §6, межа першого
  // відкриття). Оновлення після активації — те, що кладе тайли в кеш.
  await page.goto('/');
  await waitForController(page);
  await page.reload();
  await expectTilesLoaded(page);
  expect(network.served, 'онлайн тайли мали прийти з «мережі»').toBeGreaterThan(0);

  network.mode = 'offline';
  const servedOnline = network.served;
  const tileResponses: { url: string; fromSW: boolean; status: number }[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).hostname === TILE_HOST) {
      tileResponses.push({
        url: response.url(),
        fromSW: response.fromServiceWorker(),
        status: response.status(),
      });
    }
  });

  await page.reload();
  await expectTilesLoaded(page);

  expect(tileResponses.length).toBeGreaterThan(0);
  for (const r of tileResponses) {
    expect(r.fromSW, `${r.url} мав прийти від SW`).toBe(true);
    expect(r.status, r.url).toBe(200);
  }
  expect(network.served, 'офлайн жоден тайл не мав дійти до мережі').toBe(servedOnline);
});

test('SW не чіпає нічого, крім тайлів', async ({ page, context }) => {
  await controlNetwork(context);
  const loopback: { url: string; fromSW: boolean }[] = [];
  page.on('response', (response) => {
    if (isLoopback(response.url())) {
      loopback.push({ url: response.url(), fromSW: response.fromServiceWorker() });
    }
  });

  await page.goto('/');
  await waitForController(page);
  await page.reload();
  await expectTilesLoaded(page);
  // Запит до `/api/…` із контрольованої сторінки — тим самим шляхом, що й
  // кнопка R2. НЕ `/api/snapshot`: навіть `HEAD` Next виконує обробником `GET`,
  // а той відкриває справжнє з'єднання з AISStream із сервера, куди блокування
  // сторінки не дістає. Для SW шлях однаковий: хост loopback, отже повз.
  const apiStatus = await page.evaluate(() =>
    fetch('/api/tile-cache-probe').then((r) => r.status),
  );
  expect(apiStatus).toBe(404);

  expect(loopback.length).toBeGreaterThan(0);
  expect(loopback.some((r) => r.url.endsWith('/api/tile-cache-probe'))).toBe(true);
  expect(loopback.filter((r) => r.fromSW).map((r) => r.url)).toEqual([]);
});
