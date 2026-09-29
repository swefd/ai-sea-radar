import type { Page } from '@playwright/test';

// Блокування зовнішньої мережі для нових e2e-сюїт. Та сама ідея, що й фікстура
// `traffic` у `select.spec.ts`: скасовується все, що не loopback, — за
// дозволеним, а не за забороненим хостом, тож зміна шару тайлів не поверне
// тест до залежності від мережі. `select.spec.ts` свою копію тримає й далі:
// файл за правилом плану не змінюється (SPRINT-03:68), тож спільною ця функція
// стає лише для нових сюїт.
//
// Ім'я файлу БЕЗ `.spec.ts` навмисно: проєкт `e2e` бере `e2e/**/*.spec.ts`, і
// допоміжний модуль із таким суфіксом став би «тестовим файлом без тестів».

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

// Лише схеми, що йдуть у мережу: у `data:` і `blob:` `hostname` порожній, і
// без цього обмеження предикат скасовував би й їх.
const NETWORK_PROTOCOLS = new Set(['http:', 'https:']);

function isExternal(url: URL): boolean {
  return NETWORK_PROTOCOLS.has(url.protocol) && !LOOPBACK_HOSTS.has(url.hostname);
}

/** Ставити ДО `page.goto`, інакше перші тайли підуть у мережу. */
export async function blockExternal(page: Page): Promise<void> {
  await page.route(isExternal, (route) => route.abort());
}
