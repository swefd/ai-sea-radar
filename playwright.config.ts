import { defineConfig, devices } from '@playwright/test';

// Порт — єдине джерело істини: скрипт `dev` у `package.json`
// (`next dev -H 127.0.0.1 -p 3000`). Тут він ПОВТОРЕНИЙ, а не вирішений, тож
// при зміні порту правляться обидва місця — інакше `webServer.url` чекатиме
// на адресу, якої ніхто не слухає, і тести падатимуть з таймауту (R-27).
const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Які проєкти обрано в командному рядку. Playwright знає лише глобальний
 * `webServer`, тож без цього запуск `unit` піднімав би dev-сервер — і падіння
 * сервера читалося б як падіння юніт-тестів. Це рівно та підміна причини,
 * яку весь шар має ловити, тому обробляються обидві форми прапорця —
 * і `--project=unit`, і варіативна `--project unit e2e`.
 */
function selectedProjects(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) {
      names.push(arg.slice('--project='.length));
    } else if (arg === '--project') {
      // CLI Playwright документує `--project <project-name...>` як
      // ВАРІАТИВНИЙ: `--project unit e2e` — це два значення, а не одне.
      // Читаємо, доки не почнеться наступний прапорець або не скінчиться argv.
      let j = i + 1;
      for (; j < argv.length; j += 1) {
        const value = argv[j];
        if (value === undefined || value.startsWith('-')) break;
        names.push(value);
      }
      i = j - 1;
    }
  }
  return names;
}

const selected = selectedProjects(process.argv);
// Сервер піднімається ЛИШЕ на явно обраний `e2e` (R-11). Порожній вибір —
// голий `npx playwright test` — сервера не отримує, і це свідомо: реєстр
// завжди передає `--project`, а голий запуск без сервера дасть гучну помилку
// з'єднання. Варіант «порожній вибір теж піднімає» коштував би dev-сервера на
// кожному прогоні `unit`, тобто рівно тієї підміни причини, що описана вище.
const needsServer = selected.includes('e2e');

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  // 'list', а не 'html': вивід читається зі stderr хука, а не з браузера.
  reporter: 'list',
  use: { trace: 'on-first-retry' },
  projects: [
    { name: 'unit', testMatch: 'unit/**/*.spec.ts' },
    {
      name: 'e2e',
      testMatch: 'e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
    },
  ],
  webServer: needsServer
    ? {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
});
