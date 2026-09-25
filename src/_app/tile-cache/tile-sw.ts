// Service worker кешу тайлів. Спека: docs/superpowers/specs/2026-09-25-tile-cache-design.md.
//
// Компілюється `tsconfig.sw.json` у `public/tile-sw.js` і реєструється як
// модуль. Імпорт пишеться з `.js`, бо резолвить його браузер, а не збирач.
//
// Файл перевіряє й головний `tsc` — під `lib: DOM`, як решту коду, без
// окремого `exclude` (план, «Відхилення від спеки»). DOM не знає типів SW,
// тож п'ять потрібних членів описано нижче вручну. Розбіжність із браузером
// `tsc` не побачить — її ловить `tests/e2e/tile-cache.spec.ts`.

import {
  TILE_CACHE_NAME,
  TILE_CACHE_PREFIX,
  classifyCopy,
  isStorable,
  isTileRequest,
  stampFetchedAt,
} from './tile-freshness.js';

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface TileWorkerScope {
  readonly location: { readonly href: string };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const scope = globalThis as unknown as TileWorkerScope;
const tileHost = new URL(scope.location.href).searchParams.get('host');

scope.addEventListener('install', (event) => {
  event.waitUntil(scope.skipWaiting());
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([dropOldCaches(), dropExpiredCopies()]).then(() => scope.clients.claim()));
});

scope.addEventListener('fetch', (event) => {
  if (!isTileRequest(event.request.method, event.request.url, tileHost)) {
    // `respondWith` не викликається: запит іде повз SW, як без нього.
    return;
  }
  event.respondWith(respond(event));
});

async function dropOldCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(TILE_CACHE_PREFIX) && name !== TILE_CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
}

async function dropExpiredCopies(): Promise<void> {
  const cache = await caches.open(TILE_CACHE_NAME);
  const now = Date.now();
  for (const request of await cache.keys()) {
    const copy = await cache.match(request);
    if (copy === undefined || classifyCopy(copy.headers, now) === 'expired') {
      await cache.delete(request);
    }
  }
}

/**
 * Leaflet просить тайл як `<img>` без `crossOrigin`, тобто в режимі `no-cors`, і
 * відповідь на такий запит непрозора: ні статусу, ні заголовків. Тому SW
 * перезапитує тайл сам у режимі `cors` (OSM віддає
 * `access-control-allow-origin: *`). Ключ кешу — лише URL, режим не важить.
 */
async function fromNetwork(url: string): Promise<Response> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (isStorable(response.status)) {
    await store(url, response.clone());
  }
  return response;
}

async function store(url: string, response: Response): Promise<void> {
  try {
    const body = await response.blob();
    const stamped = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: stampFetchedAt(response.headers, Date.now()),
    });
    const cache = await caches.open(TILE_CACHE_NAME);
    await cache.put(url, stamped);
  } catch {
    // Переповнене сховище чи обірване тіло: без копії, тайл і так показано.
  }
}

async function respond(event: FetchEvent): Promise<Response> {
  const url = event.request.url;
  const cache = await caches.open(TILE_CACHE_NAME);
  const copy = await cache.match(url);
  if (copy === undefined) {
    return fromNetwork(url);
  }

  switch (classifyCopy(copy.headers, Date.now())) {
    case 'fresh':
      return copy;
    case 'revalidate':
      // Фонове оновлення: помилку мережі ковтаємо, копію вже віддано.
      event.waitUntil(fromNetwork(url).catch(() => undefined));
      return copy;
    case 'stale-if-error':
      return fromNetwork(url).then(
        (response) => (response.status >= 500 ? copy : response),
        () => copy,
      );
    case 'expired':
      return fromNetwork(url);
  }
}
