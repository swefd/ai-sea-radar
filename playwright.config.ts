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
// Наслідок, який варто знати: цей модуль argv-залежний, а Playwright
// перечитує конфіг у воркерах, де `process.argv` інший і `selected` виходить
// порожнім. Сьогодні це безпечно лише тому, що `webServer` читається в
// головному процесі, а більше від `selected` не залежить ніщо — тож не робіть
// від нього залежними `projects` чи `use`, інакше воркер тихо побачить інший
// конфіг, ніж головний процес (R-42).
const needsServer = selected.includes('e2e');

export default defineConfig({
  testDir: './tests',
  // Playwright транспілює все, до чого дотягнеться його завантажувач. Файл,
  // дістатий через require(), він примусово вважає commonjs, ІГНОРУЮЧИ
  // розширення .mjs (esmLoader.js:7660 — перевірка fileIsModule стоїть на
  // недосяжній гілці тернарника), і Babel опускає ESM у CJS, де import.meta
  // не існує. Ці файли — звичайний Node ESM, транспілювати в них нічого,
  // тож вони виключаються з трансформації, і Node вантажить їх сам (R-44).
  build: { external: ['**/scripts/**/*.mjs', '**/.claude/hooks/**/*.mjs'] },
  fullyParallel: true,
  retries: 0,
  // 'list', а не 'html': вивід читається зі stderr хука, а не з браузера.
  reporter: 'list',
  // 'retain-on-failure', а не 'on-first-retry': `retries: 0` вище означає, що
  // повтору не буде ніколи, тож трейс за 'on-first-retry' не запишеться жодного
  // разу — і його не було б саме тоді, коли впав `e2e` (R-41).
  use: { trace: 'retain-on-failure' },
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
