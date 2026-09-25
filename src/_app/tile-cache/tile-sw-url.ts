// Адреса реєстрації service worker кешу тайлів. Окремим файлом, бо імпортує
// `@/shared/config` через споживача, а все, що компілює `tsconfig.sw.json`,
// імпортувати з `src/` не може.

/**
 * Область дії SW — весь origin. Файл мусить лежати в корені `public/`: область
 * за замовчуванням — тека скрипта, а ширшу дав би лише заголовок
 * `Service-Worker-Allowed`, тобто серверний код (спека §4.3).
 */
export const TILE_SW_SCOPE = '/';

/**
 * `public/` не бачить `@/shared/config`, тож хост тайлів SW отримує параметром.
 * Так рядок хоста лишається вписаним лише в `OSM_TILE_LAYER.urlTemplate`.
 */
export function tileServiceWorkerUrl(urlTemplate: string): string {
  const host = new URL(urlTemplate).hostname;
  return `/tile-sw.js?host=${encodeURIComponent(host)}`;
}
