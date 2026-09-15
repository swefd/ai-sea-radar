// Реєстр — ДАНІ. Жодної логіки: щоб додати перевірку, цей файл дописують,
// а run.mjs не чіпають. Якщо для нового рядка довелося правити run.mjs — межа зламана.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import path from 'node:path';

/** Дефолтний таймаут одного рядка. Рядок може перекрити своїм timeoutMs. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * PRECONDITIONS — мапа id → {describe, probe}.
 * Проба відповідає ЛИШЕ на «чи можу я взагалі запуститися», ніколи на «чи пройшло».
 */
export const PRECONDITIONS = {
  'node-modules': {
    describe: 'немає node_modules/ — залежності не встановлені',
    probe: (root) => existsSync(path.join(root, 'node_modules')),
  },
  'playwright-pkg': {
    describe: 'не резолвиться @playwright/test',
    probe: (root) => {
      try {
        createRequire(path.join(root, 'package.json')).resolve('@playwright/test');
        return true;
      } catch {
        return false;
      }
    },
  },
  'playwright-browser': {
    describe: 'немає бінарника chromium у кеші Playwright',
    probe: () => {
      const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || defaultBrowsersPath();
      try {
        return readdirSync(cache).some((entry) => entry.startsWith('chromium'));
      } catch {
        return false;
      }
    },
  },
};

function defaultBrowsersPath() {
  const home = homedir();
  if (platform() === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform() === 'win32') return path.join(home, 'AppData', 'Local', 'ms-playwright');
  return path.join(home, '.cache', 'ms-playwright');
}

export const CHECKS = [
  {
    id: 'typecheck',
    tier: 'fast',
    // Команда живе в package.json в однині — інакше реєстр і розробник
    // запускали б різні tsc і розходилися непомітно.
    cmd: 'npm run --silent check-types',
    needs: ['node-modules'],
    after: [],
    proves: 'Кожен `.ts`/`.tsx` проєкту компілюється під `strict` із типами Next',
    blindSpot: 'Нічого про поведінку в рантаймі. `skipLibCheck: true` ховає помилки чужих `.d.ts`. Leaflet не виконується, тож звернення до `window` на рівні модуля тут скомпілюється успішно',
  },
  {
    id: 'lint',
    tier: 'fast',
    cmd: 'npm run --silent lint',
    needs: ['node-modules'],
    after: [],
    proves: 'Жоден файл не порушує правила `eslint-config-next` і базові правила TS',
    // Доповнення контролера (R-51). Перевірено не читанням конфігу, а через
    // `eslint --print-config scripts/verify/hash.mjs`: у злитих globals присутні
    // window, document, localStorage і navigator, а `no-undef` має рівень 2.
    // Тобто єдиний рядок, яким шар охороняє власні .mjs, для цілого класу імен
    // мовчазно неробочий. Спека §3.1 забороняє blindSpot, вужчий за реальність.
    blindSpot: 'Стиль і статичні шаблони, не логіку. Правило, якого немає в конфігу, не порушується за визначенням. `no-undef` увімкнено лише для `scripts/**/*.mjs` і `.claude/hooks/**/*.mjs`, і навіть там `eslint-config-next` віддає цим файлам ще й браузерний набір глобалей — тож `window`, `document` чи `localStorage`, помилково вжиті в серверному скрипті, не позначаються ніколи',
  },
  {
    id: 'unit',
    tier: 'fast',
    cmd: 'npx playwright test --project=unit',
    needs: ['node-modules', 'playwright-pkg'],
    after: [],
    // Нуль знайдених тестів — SKIPPED «0 тестів написано», а не PASSED (спека §3.2).
    emptyProbe: {
      cmd: 'npx playwright test --project=unit --list',
      reason: '0 тестів написано',
    },
    proves: 'Чисті функції поводяться як задано — для написаних випадків',
    // Доповнення контролера (R-52): «ні браузера» — домовленість тестів, а не
    // заборона в конфігу. Проєкт `unit` не задає жодного бар'єра, який завадив би
    // спеці звернутися до `page` і підняти chromium. Спека §3.1 забороняє
    // blindSpot, вужчий за реальність, тож формулювання каже, що саме тримає межу.
    blindSpot: 'Ні DOM, ні Leaflet. Браузера не піднімає — але це домовленість тестів, а не заборона в конфігу: спека, яка звернеться до `page`, підніме chromium і в цьому проєкті. Про рендер і карту не говорить нічого. Випадок, якого ніхто не написав, не покритий',
  },
  {
    id: 'build',
    tier: 'full',
    cmd: 'npm run --silent build',
    needs: ['node-modules'],
    after: ['typecheck'],
    timeoutMs: 300_000,
    proves: 'Застосунок збирається і серверний рендер не звертається до `window` на рівні імпорту — запобіжник SSR для Leaflet',
    blindSpot: 'Нічого не натискає. Карта, що вийшла сірою, збірку проходить',
  },
  {
    id: 'e2e',
    tier: 'full',
    cmd: 'npx playwright test --project=e2e',
    needs: ['node-modules', 'playwright-pkg', 'playwright-browser'],
    after: ['build'],
    timeoutMs: 300_000,
    emptyProbe: {
      cmd: 'npx playwright test --project=e2e --list',
      reason: '0 тестів написано',
    },
    proves: 'Поведінки вибору з B-07 виконуються у справжньому chromium проти dev-сервера',
    // Перші два речення — дослівно зі спеки §4. Третє додано свідомо:
    // §3.1 забороняє blindSpot, вужчий за реальність, а reuseExistingServer: true
    // з конфігу задачі 1 дозволяє протестувати чужий сервер на 127.0.0.1:3000.
    blindSpot: '**Рух не перевіряє** — перевірка руху з керованим часом належить R3. Тайли заблоковані, тож про справжні зображення карти не говорить нічого. Не доводить, що dev-сервер зібрано саме з цього дерева: `reuseExistingServer: true` прийме вже піднятий сервер іншої гілки',
  },
];
