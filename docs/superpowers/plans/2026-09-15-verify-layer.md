# Verify Layer + Stop-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дати проєкту відтворюваний факт про власний код — реєстр перевірок із п'ятьма нерозрізнюваними статусами, які запускаються автоматично після кожного редагування (як lead) і на зупинці агента (як гейт).

**Architecture:** Реєстр — дані (`registry.mjs`), раннер — оркестратор (`run.mjs`), свіжість — хеш вмісту (`hash.mjs`). Три власні структурні перевірки в `checks/`. Два хуки Claude Code поверх цього: `PostToolUse` радить, `Stop` блокує. Жодна перевірка не знає про хуки; хуки викликають раннер як чорну скриньку.

**Tech Stack:** Node.js 24 (ESM, `.mjs`) · TypeScript 6 `strict` · ESLint 9 flat config · Playwright Test 1.63 (два проєкти: `unit` без браузера, `e2e` з chromium) · POSIX `sh` для резолву інтерпретатора.

**Spec:** `docs/superpowers/specs/2026-09-15-verify-layer-design.md` — читати разом із планом. План аргументує зі спеки; там причини, тут кроки.

## Global Constraints

Діють на **кожну** задачу нижче. Значення скопійовані дослівно.

**Читається разом із планом і має перевагу над ним:**
`.superpowers/sdd/2026-09-15-verify-layer/rulings.md` — рішення контролера R-01…R-33. Вони
**зобов'язальні**: де рішення щось закриває, воно закрите, і текст плану чи спеки йому не
суперечить. Кожне виправлення нижче названо номером рішення на місці.

- **Node 24 (R-24).** `.nvmrc` містить `24` — єдине місце, де версія зафіксована. Типовий Node цієї оболонки — **v22.23.1**, тож **кожна** команда `node`/`npm`/`npx` починається з `source ~/.nvm/nvm.sh && nvm use` (дає v24.21.0): голий `nvm use` у неінтерактивній оболонці не існує. Усі команди виконуються **з кореня робочого дерева** (`git rev-parse --show-toplevel`), ніколи з зашитого `/Users/…/sea-radar` — інакше задача правитиме не те дерево. У цьому дереві немає `node_modules`, тож задача 1 починається з `npm ci`.
- **Жодних залежностей поза трьома (R-30).** Додаються рівно `eslint@9.39.5`, `eslint-config-next@16.3.5`, `@playwright/test@1.63.0`, встановлені з `--save-exact` — саме ці версії, не діапазони. `eslint@9`, а не `10`: `eslint-plugin-react@^7.37` (`^3 || … || ^9.7`), `eslint-plugin-jsx-a11y@^6.10` (`… || ^9`) і `eslint-plugin-import@^2.32` (`… || ^9`), які тягне `eslint-config-next`, не заявляють peer `^10`. Якщо npm відхилить котрийсь пін — це **голосна** зупинка: записати фактично зарезолвлені версії у звіт і ескалювати, а не послабити пін і не глушити конфлікт через `--force` чи `--legacy-peer-deps`.
- **Playwright Test — єдиний тестовий раннер.** Vitest, Jest, MSW, Storybook не додаються за жодних обставин (SPRINT-01 B-07: «інших тестових фреймворків немає»).
- **`reference/` — read-only, не імпортується, не лінтиться, не тестується.** Виключена з `tsconfig.json`, має бути виключена з ESLint і Playwright `testDir`, і вона в `.gitignore`.
- **Секрети не друкуються ніколи.** `no-secrets` звітує `file:line` + назву шаблону + довжину збігу. **Ніколи сам збіг, навіть частково.**
- **`next lint` видалено в Next 16.** Лінт викликається ESLint CLI напряму. Ключ `eslint` у `next.config.ts` не додавати — він більше не підтримується.
- **Українська в рядках UI та звітів.** Будь-яке обрізання тексту — **за байтами через `Buffer`**, ніколи `String.prototype.slice`.
- **Кожен `.mjs` — ESM**, `import`, без `require`. Ознака точки входу — `import.meta.filename === process.argv[1]` (R-22), ніколи конкатенація `` `file://${process.argv[1]}` ``: вона ламається на будь-якому шляху з пробілом або не-ASCII, і скрипт тоді мовчки нічого не робить — не відрізнити від зеленого.
- **Задача, що додає файл, перезапускає всі зелені, які успадкувала (R-09).** Кожна задача закінчується `npm run check-types`, `npm run lint` і `npx playwright test --project=unit` — усі три з виходом `0` — і лише потім комітить. (У задачі 1 тестів ще немає, тож третя команда там іде в режимі `--list`.)
- **Жодної фікстури, схожої на справжній секрет (R-13).** У жодному відстежуваному файлі — ні в цьому плані, ні в спеці, ні в `docs/context/`, ні в жодному `.spec.ts` — не пишеться літерал, що збігається з шаблоном `no-secrets`. Фікстури складаються з частин у рантаймі (`['https://', 'ci', ':', 'x'.repeat(20), '@', 'registry.example/x'].join('')`). Інакше перевірка червоніє на документах, які її описують.
- **Коміт після кожної задачі.** Повідомлення українською, тіло пояснює *чому*, і закінчується рядком `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

---

## Структура файлів

| Файл | Відповідальність | Задача |
| --- | --- | --- |
| `package.json` | devDependencies + `lint`/`check-types` (1), три скрипти `verify*` (3) | 1, 3 |
| `eslint.config.mjs` | flat-конфіг ESLint; ігнорує `reference/`, `.next/`, `.verify/`; Node-глобали для `.mjs` поза `src/` (R-10) | 1 |
| `playwright.config.ts` | два проєкти; `webServer` лише коли обрано `e2e` | 1 |
| `tests/unit/.gitkeep`, `tests/e2e/.gitkeep` | обидві теки мусять існувати під `testDir: './tests'` (R-25) | 1 |
| `scripts/verify/hash.mjs` | які файли є джерелом + їх хеш за вмістом; `listRepoFiles` додає задача 5 | 2 |
| `scripts/verify/hash.d.mts` | декларації до `hash.mjs` — без них `.ts`-тест дає `TS7016` (R-08) | 2 |
| `tests/unit/hash.spec.ts` | тести хешу свіжості; задача 5 дописує тест на `listRepoFiles` | 2 |
| `.gitignore` | `/.verify/` — звіти й лічильники шару не йдуть у передачу | 2 |
| `scripts/verify/registry.mjs` | `CHECKS` і `PRECONDITIONS` — **тільки дані**; рядки дописують задачі 5, 6, 7 | 3 |
| `scripts/verify/run.mjs` | оркестрація: відбір, передумови, запуск, статуси, коди виходу | 3 |
| `scripts/verify/registry.d.mts`, `scripts/verify/run.d.mts` | декларації до обох модулів (R-08) | 3 |
| `tests/unit/run.spec.ts` | тести відбору, передумов, `isBlocking` і кодів виходу | 3 |
| `scripts/verify/report.mjs`, `scripts/verify/report.d.mts` | таблиця в термінал, JSON-звіт, кеш свіжості | 4 |
| `tests/unit/report.spec.ts` | тести форматування, обрізання за байтами й кешу | 4 |
| `scripts/verify/checks/no-ref-imports.mjs`, `…/no-ref-imports.d.mts` | жодного `import` із `reference/` | 5 |
| `tests/unit/support/check-fixtures.ts` | спільні фікстури трьох перевірок — дерева в `os.tmpdir()` (R-12) | 5 |
| `tests/unit/no-ref-imports.spec.ts` | тести перевірки `no-ref-imports` | 5 |
| `scripts/verify/checks/no-secrets.mjs`, `…/no-secrets.d.mts` | жодного ключа у файлах, що передаються | 6 |
| `tests/unit/no-secrets.spec.ts` | тести перевірки `no-secrets` | 6 |
| `scripts/verify/checks/deps-allowlist.mjs`, `…/deps-allowlist.d.mts` | `package.json` у межах узгодженого | 7 |
| `tests/unit/deps-allowlist.spec.ts` | тести перевірки `deps-allowlist` | 7 |
| `.claude/hooks/node.sh` | знайти Node 24, інакше впасти **голосно** | 8 |
| `tests/unit/node-sh.spec.ts` | тести резолву інтерпретатора | 8 |
| `.claude/hooks/edit-check.mjs`, `.claude/hooks/edit-check.d.mts` | `PostToolUse` — lead після редагування | 9 |
| `tests/unit/edit-check.spec.ts` | тести відбору файлів, розбору `tsc` і формату lead | 9 |
| `.claude/hooks/stop-gate.mjs`, `.claude/hooks/stop-gate.d.mts` | `Stop` — гейт, блокує | 10 |
| `tests/unit/stop-gate.spec.ts` | тести обрізання, таблиці провалів і лічильника livelock | 10 |
| `.claude/settings.json` | вмикання хуків | 11 |
| `tests/unit/settings-hooks.spec.ts` | стереже, що обидві події ввімкнені з явними таймаутами | 11 |
| `CLAUDE.md` | розділ «Перевірка» — опис для людини й для клієнта | 12 |
| `docs/context/verify-layer.md` | матеріал, який шар винен запису checkpoint | 12 |
| `tests/unit/claude-md-registry.spec.ts` | стереже рівність таблиці в `CLAUDE.md` і `registry.mjs` (R-19) | 12 |

Теку `docs/checkpoints/` цей план **не створює** — шаблон приходить із матеріалами курсу; див.
задачу 12, крок 2.

Межі навмисні: `registry.mjs` не має логіки, `run.mjs` не має знань про конкретні перевірки, `report.mjs` не вирішує статусів. Перевірити межу легко — якщо, щоб додати рядок у реєстр, треба правити `run.mjs`, межа зламана.

---

### Task 1: Інструменти перевірки — залежності та конфіги

Без цього немає чим запускати тести, тож задача перша, попри те, що вона не додає жодної перевірки.

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `eslint.config.mjs`
- Create: `playwright.config.ts`
- Create: `tests/unit/.gitkeep`, `tests/e2e/.gitkeep` (R-25)

**Interfaces:**
- Consumes: нічого
- Produces: `npm run check-types`, `npm run lint`; Playwright-проєкти з іменами рівно `unit` і `e2e` — задача 3 вписує ці імена в `registry.mjs` дослівно; блок Node-глобалів у `eslint.config.mjs`, на який спираються всі `.mjs` задач 2–10.

- [ ] **Крок 1: Корінь дерева, Node 24, `npm ci` (R-24)**

```bash
cd "$(git rev-parse --show-toplevel)"
source ~/.nvm/nvm.sh && nvm use
node -v
npm ci
```

Корінь береться командою, а не зашитим шляхом: план виконується у git-worktree, і зашите
`/Users/…/sea-radar` завело б усі наступні кроки в інше дерево. `source ~/.nvm/nvm.sh` перед
`nvm use` обов'язковий — `nvm` є функцією оболонки, у неінтерактивному запуску її не існує.

Очікується: `v24.x.x` і `npm ci`, що завершився без помилок. Якщо `nvm: command not found` або
версія не 24 — **зупинитися й сказати про це**, не продовжувати на 22. Далі весь план припускає
24. `npm ci` тут не формальність: у свіжому worktree немає `node_modules`, і без нього крок 2
ставив би три залежності в порожнє дерево.

- [ ] **Крок 2: Поставити три залежності (R-30)**

```bash
source ~/.nvm/nvm.sh && nvm use
npm install --save-dev --save-exact eslint@9.39.5 eslint-config-next@16.3.5 @playwright/test@1.63.0
```

`--save-exact`, бо `CLAUDE.md` каже «кожне узгоджене значення живе в одному місці» — діапазон означав би, що фактична версія залежить від дати встановлення.

Версії встановлюються **як написано**. Їх не вдалося звірити з реєстром офлайн, тож якщо npm
відхилить котрусь (`No matching version found`) — це голосна зупинка: записати фактично доступні
версії у звіт і ескалювати контролеру, **не** послаблювати пін і не міняти мажор самостійно.

- [ ] **Крок 3: Перевірити, що peer-конфліктів немає**

```bash
source ~/.nvm/nvm.sh && nvm use
npm ls eslint eslint-config-next @playwright/test
```

Очікується: дерево без `UNMET PEER DEPENDENCY` і без `invalid`. Якщо з'явився конфлікт навколо `eslint-plugin-react` чи `eslint-plugin-jsx-a11y` — це означає, що встановилася не та мажорна версія ESLint; перевірити `npm ls eslint` і **не глушити конфлікт через `--force` чи `--legacy-peer-deps`**.

- [ ] **Крок 4: Завантажити chromium у фоні**

```bash
source ~/.nvm/nvm.sh && nvm use
npx playwright install chromium > /tmp/pw-install.log 2>&1 &
```

`CLAUDE.md`: «Playwright's browser download is slow — run it in the background». Далі не чекати; `e2e` до кінця плану може чесно стояти `SKIPPED`, і це правильна поведінка, а не проблема.

- [ ] **Крок 5: Написати `eslint.config.mjs`**

```js
// Flat config. `next lint` видалено в Next 16 — ESLint викликається напряму.
// `eslint-config-next/core-web-vitals` експортує масив flat-конфігів.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  globalIgnores([
    // Дефолтні ігнори eslint-config-next перелічено явно, бо поведінка
    // успадкованих ignore-патернів не має бути припущенням: у flat-конфігу
    // глобальні ігнори НАКОПИЧУЮТЬСЯ, і покладатися на це наосліп — те саме,
    // що не знати периметра лінту.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Чуже й не наше. 532 сторонні .ts/.tsx — CLAUDE.md, reference/CLAUDE.md.
    'reference/**',
    // Звіти шару перевірки та робочі копії Claude Code.
    '.verify/**',
    '.claude/worktrees/**',
  ]),
  ...nextVitals,
  {
    // Node-глобали для всього, що виконує НЕ браузер: скрипти шару й хуки.
    // Конфіг Next/React дає файлам браузерні глобали, тож без цього блоку
    // `no-undef` червонітиме на кожному `process` і `Buffer` у `.mjs`.
    // Об'єкт виписано літералом: пакет `globals` НЕ встановлюється —
    // CLAUDE.md забороняє залежності понад три з кроку 2.
    files: ['scripts/**/*.mjs', '.claude/hooks/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
]);
```

Цей блок **не доводиться в цій задачі**: `.mjs`-файлів у `scripts/` і `.claude/hooks/` ще немає,
тож `lint` зелений і з ним, і без нього. Перший `.mjs` приносить задача 2, і саме її крок із
`npm run lint` є першим чесним доказом. Блок стоїть тут, а не там, бо власник
`eslint.config.mjs` — ця задача (R-10).

- [ ] **Крок 6: Написати `playwright.config.ts`**

```ts
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
```

- [ ] **Крок 7: Додати скрипти в `package.json`**

У блок `"scripts"`, поруч із наявними `dev` і `build`:

```json
    "lint": "eslint .",
    "check-types": "tsc -p tsconfig.json --pretty --noEmit"
```

- [ ] **Крок 8: Створити обидві теки тестів (R-25)**

```bash
mkdir -p tests/unit tests/e2e
touch tests/unit/.gitkeep tests/e2e/.gitkeep
```

`testDir: './tests'` кроку 6 вказує на теку, якої ще немає, а спека §7 вимагає обидві незалежно
від того, скільки в них тестів. Git порожніх тек не зберігає, тож `.gitkeep` у кожній — і обидва
файли **комітяться** кроком 10. Без цього задача 2 отримала б `tests/unit/` як побічний ефект
`mkdir` посеред TDD-кроку, а `tests/e2e/` не існувала б аж до B-07.

- [ ] **Крок 9: Переконатися, що обидва конфіги справді резолвяться, і перезапустити все зелене (R-09)**

```bash
source ~/.nvm/nvm.sh && nvm use
npm run check-types
npm run lint
npx playwright test --project=unit --list
```

Очікується:
- `check-types` — тиша, вихід `0`.
- `lint` — тиша, вихід `0`. `reference/` у цьому дереві немає (вона в `.gitignore`), тож мовчання ESLint про неї **нічого не доводить**: рядок `'reference/**'` кроку 5 стоїть на випадок дерева, де вона є, і перевіряється лише там.
- `--list` — `Total: 0 tests in 0 files`, і **dev-сервер не піднімається**. Сервера немає через **режим переліку**: `--list` не запускає ні тестів, ні `webServer`. Це не доказ логіки `needsServer` — її першим доведе задача 2, коли з'явиться перший тест.

Нуль тестів тут очікуваний і правильний: у `tests/unit/` поки лише `.gitkeep`, перший юніт-тест приходить у задачі 2. Саме тому третя команда йде в режимі `--list`, а не як `npx playwright test --project=unit`: прогін без жодного тесту завершується ненульовим кодом «no tests found», і з задачі 2 ця команда стає повноцінною.

- [ ] **Крок 10: Коміт**

```bash
git add package.json package-lock.json eslint.config.mjs playwright.config.ts tests/unit/.gitkeep tests/e2e/.gitkeep
git commit -m "chore: інструменти перевірки — ESLint 9 flat config і Playwright

Три devDependencies як свідомий виняток із правила «жодних зайвих
залежностей»: усі три — інструменти перевірки, не залежності застосунку,
і @playwright/test прямо передбачений B-07.

eslint@9, а не 10: eslint-plugin-react і eslint-plugin-jsx-a11y, які тягне
eslint-config-next@16.3.5, не заявляють peer ^10.

Проєкт unit не піднімає dev-сервер — інакше падіння сервера читалося б як
падіння юніт-тестів.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: `hash.mjs` — свіжість за вмістом

**Files:**
- Create: `scripts/verify/hash.mjs`
- Create: `scripts/verify/hash.d.mts` (R-08 — і **стається разом із `.mjs`**)
- Test: `tests/unit/hash.spec.ts`
- Modify: `.gitignore` (додати `/.verify/`)

**Interfaces:**
- Consumes: Playwright-проєкт `unit` і теку `tests/unit/` із задачі 1
- Produces:
  - `SOURCE_PREFIXES: string[]`, `SOURCE_FILES: string[]`
  - `isSourcePath(relPath: string): boolean`
  - `listSourceFiles(root: string): string[]` — відсортовані POSIX-шляхи відносно `root`
  - `sourceHash(root: string): { hash: string; fileCount: number; files: string[] }`
  - `scripts/verify/hash.d.mts` — рукописні декларації до всього переліченого вище. Без них
    `.ts`-тест, що імпортує `.mjs`, дає `TS7016`, бо `tsconfig.json` тримає `allowJs: false`.
    Вмикати `allowJs` не можна: це затягло б у програму всі `.mjs` шару й хуків. Задача 5
    **дописує** в цей файл один рядок (`listRepoFiles`), а не створює його заново.

  Задачі 4, 9 і 10 імпортують рівно `sourceHash`.

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/hash.spec.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import { isSourcePath, listSourceFiles, sourceHash } from '../../scripts/verify/hash.mjs';

/** Справжній git-репозиторій у тимчасовій теці: git-інтеграція — саме те, що ламається. */
function makeRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-hash-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(path.join(root, 'app'), { recursive: true });
  writeFileSync(path.join(root, 'app/page.tsx'), 'export default function P() { return null; }\n');
  // Дев'ять з одинадцяти файлів застосунку живуть під src/ після переходу на FSD.
  // Без цього рядка всі тести нижче зелені й зі зламаним SOURCE_PREFIXES.
  mkdirSync(path.join(root, 'src/_pages/home/ui'), { recursive: true });
  writeFileSync(path.join(root, 'src/_pages/home/ui/home-page.tsx'), 'export function HomePage() { return null; }\n');
  writeFileSync(path.join(root, 'package.json'), '{"name":"t"}\n');
  writeFileSync(path.join(root, '.gitignore'), 'secret.txt\n');
  writeFileSync(path.join(root, 'secret.txt'), 'ignored\n');
  writeFileSync(path.join(root, 'README.md'), '# not source\n');
  return root;
}

test('isSourcePath приймає префікси та точні імена, відкидає решту', () => {
  expect(isSourcePath('app/page.tsx')).toBe(true);
  // Головний код застосунку — під src/. Якби цього рядка не було, дефект
  // SOURCE_PREFIXES пройшов би повз усі п'ять тестів.
  expect(isSourcePath('src/_pages/home/ui/home-page.tsx')).toBe(true);
  expect(isSourcePath('scripts/verify/run.mjs')).toBe(true);
  expect(isSourcePath('.claude/hooks/node.sh')).toBe(true);
  expect(isSourcePath('tsconfig.json')).toBe(true);
  // Мажор Node вирішує, ЯКИМ інтерпретатором виконано кожну перевірку;
  // settings.json вмикає й вимикає хуки. Обидва змінюють висновок перевірки.
  expect(isSourcePath('.nvmrc')).toBe(true);
  expect(isSourcePath('.claude/settings.json')).toBe(true);
  expect(isSourcePath('README.md')).toBe(false);
  expect(isSourcePath('docs/tasks/SPRINT-01.md')).toBe(false);
});

test('listSourceFiles бере джерельні файли, ігнорує gitignored і не-джерельні', () => {
  const root = makeRepo();
  try {
    expect(listSourceFiles(root)).toEqual([
      'app/page.tsx',
      'package.json',
      'src/_pages/home/ui/home-page.tsx',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sourceHash стабільний між викликами без змін', () => {
  const root = makeRepo();
  try {
    expect(sourceHash(root).hash).toBe(sourceHash(root).hash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sourceHash змінюється від зміни вмісту, а не від дотику до файлу', () => {
  const root = makeRepo();
  try {
    const before = sourceHash(root).hash;

    // Той самий вміст, новий mtime: хеш мусить лишитися тим самим.
    writeFileSync(path.join(root, 'app/page.tsx'), 'export default function P() { return null; }\n');
    expect(sourceHash(root).hash).toBe(before);

    // Інший вміст: хеш мусить змінитися.
    writeFileSync(path.join(root, 'app/page.tsx'), 'export default function P() { return 1; }\n');
    expect(sourceHash(root).hash).not.toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('закомічені зміни не роблять хеш «чистим» — важить вміст, не стан дерева', () => {
  const root = makeRepo();
  try {
    const dirty = sourceHash(root).hash;
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c'], { cwd: root });
    expect(sourceHash(root).hash).toBe(dirty);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Останній тест — саме та помилка, від якої застерігає §3.4 спеки: коміт лишає чисте дерево, тож перевірка «дерево чисте» видала б зелене вже зламаному коду.

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
source ~/.nvm/nvm.sh && nvm use
npx playwright test --project=unit
```

`mkdir` тут немає навмисно: теку `tests/unit/` створила задача 1 (крок 8, разом із `.gitkeep`).
Створювати теку **після** того, як крок 1 уже записав у неї файл, неможливо — це був дефект
порядку, і його виправлено тим, що власником теки стала задача 1.

Очікується: FAIL — `Cannot find module '../../scripts/verify/hash.mjs'`.

- [ ] **Крок 3: Написати `scripts/verify/hash.mjs`**

```js
// Свіжість рахується за ВМІСТОМ. Не за mtime (ламається від git checkout,
// touch і розпакування архіву) і не за «git status чистий» (закомічений хід
// лишає чисте дерево, тобто видав би зелене вже зламаному коду).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Теки, вміст яких годує перевірки. */
export const SOURCE_PREFIXES = [
  // Увесь код застосунку — тут: репозиторій перейшов на Feature-Sliced Design,
  // і в app/ лишився тонкий вхід App Router. Без 'src/' хеш не змінювався б
  // від жодної правки застосунку, і --reuse-if-fresh передруковував би старе
  // зелене крізь реальний злам.
  'src/',
  'app/',
  'tests/',
  // 'scripts/', а не 'scripts/verify/': периметр хешу не має бути вужчим за
  // периметр сканування no-ref-imports.
  'scripts/',
  // Зміна хука змінює поведінку перевірки — кеш має протухати й від неї.
  '.claude/hooks/',
];

/** Окремі файли, що визначають, ЯК саме виконуються перевірки. */
export const SOURCE_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.ts',
  'eslint.config.mjs',
  'playwright.config.ts',
  // Вирішує, ЯКИМ Node виконано кожну перевірку.
  '.nvmrc',
  // Вмикає й вимикає хуки, тобто вирішує, чи перевірка взагалі запускається.
  '.claude/settings.json',
];

export function isSourcePath(relPath) {
  return SOURCE_PREFIXES.some((prefix) => relPath.startsWith(prefix))
    || SOURCE_FILES.includes(relPath);
}

export function listSourceFiles(root) {
  // -c: відстежувані, -o: невідстежувані, --exclude-standard: поважати .gitignore.
  // -z обов'язковий: без нього git лапкує шляхи зі спецсимволами, і список
  // тихо розсинхронізується з диском.
  const raw = execFileSync(
    'git',
    ['ls-files', '-c', '-o', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  return raw
    .split('\0')
    .filter((relPath) => relPath !== '' && isSourcePath(relPath))
    .sort();
}

export function sourceHash(root) {
  const files = listSourceFiles(root);
  const digest = createHash('sha256');

  for (const relPath of files) {
    digest.update(relPath);
    digest.update('\0');
    let contents;
    try {
      contents = readFileSync(path.join(root, relPath));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // R-05. Файл зник між переліком і читанням. Сентинел стоїть на місці
      // довжини, а не на місці вмісту: файл, який реально містить рядок
      // `<missing>`, має власну byteLength і тому дає інший потік.
      digest.update('<missing>');
      digest.update('\0');
      continue;
    }
    // R-05: потік — `path \0 byteLength \0 content`. Довжина перед вмістом
    // обов'язкова: без неї два різні розбиття тих самих байтів між двома
    // файлами дали б однаковий хеш.
    digest.update(String(contents.byteLength));
    digest.update('\0');
    digest.update(contents);
  }

  return { hash: digest.digest('hex'), fileCount: files.length, files };
}

// CLI: без нього питання «чому моє зелене перевикористалось» не має відповіді.
if (import.meta.filename === process.argv[1]) {
  const result = sourceHash(process.cwd());
  process.stdout.write(`${result.hash}  (${result.fileCount} файлів)\n`);
  if (process.argv.includes('--files')) {
    for (const relPath of result.files) process.stdout.write(`  ${relPath}\n`);
  }
}
```

- [ ] **Крок 4: Створити `scripts/verify/hash.d.mts` (R-08)**

`tsconfig.json` має `allowJs: false` і `strict`, тож імпорт `.mjs` із `.ts` — це
`TS7016`, вихід `2`. Без цього файлу `npm run check-types` червоний з моменту, коли
`hash.spec.ts` з'явився на диску. Декларації пишуться руками й тримаються синхронно
з експортами `hash.mjs`: розбіжність ловить `check-types` у кроці 8, а не редактор.

```ts
// Ручні декларації до hash.mjs (R-08): tsconfig має allowJs: false, тож без них
// імпорт .mjs із .ts — TS7016. Задача 5 дописує сюди `listRepoFiles` — один рядок,
// не переписування файлу.
export declare const SOURCE_PREFIXES: readonly string[];
export declare const SOURCE_FILES: readonly string[];
export declare function isSourcePath(relPath: string): boolean;
export declare function listSourceFiles(root: string): string[];
export declare function sourceHash(root: string): {
  hash: string;
  fileCount: number;
  files: string[];
};
```

- [ ] **Крок 5: Запустити тести — мають пройти**

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: `5 passed`. Тепер рядок `unit` більше не порожній — у задачі 3 він має дати `PASSED`, а не `SKIPPED`.

- [ ] **Крок 6: Перевірити CLI на справжньому репозиторії**

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/hash.mjs --files
```

Очікується: хеш і список, у якому є `app/page.tsx`, `package.json`, `scripts/verify/hash.mjs`, `tests/unit/hash.spec.ts`, і **немає** `docs/`, `.agents/`, `.claude/skills/`, `reference/`.

- [ ] **Крок 7: Додати `/.verify/` у `.gitignore`**

Після рядка `/.claude/settings.local.json` дописати:

```
# звіти й лічильники шару перевірки
/.verify/
```

- [ ] **Крок 8: Перезапустити всі три зелені (R-09)**

```bash
source ~/.nvm/nvm.sh && nvm use \
  && npm run check-types \
  && npm run lint \
  && npx playwright test --project=unit
```

Очікується: усі три — вихід `0`. Саме тут уперше по-справжньому перевіряється блок
Node-глобалів із задачі 1 (R-10): до цієї задачі не існувало жодного `.mjs`, на якому
ESLint міг би про нього збрехати або сказати правду. Якщо `lint` червоний на
`no-undef` — блок із задачі 1 неправильний, і лагодити треба його, а не `hash.mjs`.

- [ ] **Крок 9: Коміт**

```bash
git add scripts/verify/hash.mjs scripts/verify/hash.d.mts tests/unit/hash.spec.ts .gitignore
git commit -m "feat(verify): хеш джерел за вмістом

Свіжість рахується від вмісту файлів, не від mtime і не від чистоти
дерева. Тест на це прямий: коміт не змінює хеш, дотик до файлу не
змінює хеш, зміна байта — змінює.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `registry.mjs` + `run.mjs` — реєстр і раннер

Тут шар уперше набуває здатності щось стверджувати. До цієї задачі є хеш і немає жодного
статусу; після неї `npm run verify` дає п'ять рядків із п'ятьма розрізнюваними статусами й
чесним кодом виходу. Реєстр — дані, раннер — оркестрація; межа між ними перевіряється
кроком 10 навмисним додаванням рядка.

**Files:**
- Create: `scripts/verify/registry.mjs`
- Create: `scripts/verify/registry.d.mts`
- Create: `scripts/verify/run.mjs`
- Create: `scripts/verify/run.d.mts`
- Test: `tests/unit/run.spec.ts`
- Modify: `package.json` (три скрипти `verify*`)

**Interfaces:**
- Consumes: Playwright-проєкти `unit` і `e2e` та скрипти `npm run check-types`,
  `npm run lint` із задачі 1; `npm run build` із B-01.
  `sourceHash` із задачі 2 — CLI бере з нього поле `sourceHash` у JSON-звіті (R-16);
  кеш свіжості, побудований на тому самому хеші, приходить із задачею 4.
- Produces:
  - `registry.mjs`: `CHECKS: Check[]`, `PRECONDITIONS: Record<string, Precondition>`,
    `DEFAULT_TIMEOUT_MS: number`
  - `run.mjs`: `isBlocking(status, noSkip)`, `parseArgs(argv)`, `selectChecks(checks, opts)`,
    `orderChecks(checks)`, `classifyExit(outcome)`, `parsePlaywrightTotal(text)`,
    `runAll(options)`, `resolveRoot(cwd)`
  - тип результату `CheckResult` — контракт, який задача 4 (`report.mjs`) рендерить, а
    задачі 9 і 10 (хуки) читають
  - **Форма `run.mjs --json` (R-16), фіксується тут дослівно і більше не змінюється:**

    ```json
    {
      "tier": "<string>",
      "root": "<abs path>",
      "noSkip": false,
      "sourceHash": "<string>",
      "results": [ { "id": "…", "status": "…", "reason": "…", "durationMs": 0 } ]
    }
    ```

    Задача 4 (`report.mjs`) і задача 10 (Stop-гейт) цитують цю форму у своїх Interfaces.
    До R-16 гейт читав `report.results` із контракту, якого не фіксував жоден документ.
  - `node scripts/verify/run.mjs --root <path>` — прапорець, яким задача 10 передає гейту
    корінь **активного worktree** (див. крок 5, пункт про `--root`)

- [ ] **Крок 1: Зафіксувати середовище і успадковане зелене**

```bash
source ~/.nvm/nvm.sh && nvm use
node -v
npm run check-types
npm run lint
npx playwright test --project=unit
```

Очікується: `v24.21.0`; `check-types` і `lint` — тиша, вихід `0`; `unit` — `5 passed`.

Це не формальність. Задача 2 додала перші `.mjs` і перший `.ts`-тест; якщо якесь із трьох
уже червоне **до** початку Task 3, усе, що станеться далі, приписуватиметься не тій причині.
Якщо `check-types` дає `TS7016` — задача 2 не дописала `scripts/verify/hash.d.mts`;
повернутися туди, не лагодити тут.

- [ ] **Крок 2: Написати падаючий тест `tests/unit/run.spec.ts`**

Сім груп. Перші шість перевіряють чисті функції раннера, сьома стереже **дані** реєстру —
бо саме прозу `proves`/`blindSpot` передають клієнтові, і саме її найлегше тихо зіпсувати.

```ts
import { test, expect } from '@playwright/test';

import { type Check, CHECKS, PRECONDITIONS } from '../../scripts/verify/registry.mjs';
import {
  classifyExit,
  isBlocking,
  orderChecks,
  parseArgs,
  parsePlaywrightTotal,
  selectChecks,
} from '../../scripts/verify/run.mjs';

// 1. isBlocking — таблиця зі спеки §5, усі п'ять статусів × обидва значення noSkip.
test('isBlocking: PASSED ніколи не блокує', () => {
  expect(isBlocking('PASSED', false)).toBe(false);
  expect(isBlocking('PASSED', true)).toBe(false);
});

test('isBlocking: SKIPPED блокує ЛИШЕ під --no-skip', () => {
  expect(isBlocking('SKIPPED', false)).toBe(false);
  expect(isBlocking('SKIPPED', true)).toBe(true);
});

test('isBlocking: FAILED, NOT_RUN, UNRUNNABLE блокують завжди', () => {
  for (const status of ['FAILED', 'NOT_RUN', 'UNRUNNABLE'] as const) {
    expect(isBlocking(status, false)).toBe(true);
    expect(isBlocking(status, true)).toBe(true);
  }
});

// 2. parseArgs — усі шість прапорців зі спеки §5 (--tier, --no-skip, --only,
//    --reuse-if-fresh, --json, --timeout-ms) плюс доданий --root.
test('parseArgs: дефолти', () => {
  const opts = parseArgs([]);
  expect(opts.tier).toBe('fast');
  expect(opts.noSkip).toBe(false);
  expect(opts.only).toEqual([]);
  expect(opts.reuseIfFresh).toBe(false);
  expect(opts.json).toBe(false);
  expect(opts.timeoutMs).toBe(null); // null = «беремо з рядка реєстру»
  expect(opts.root).toBe(null);
});

test('parseArgs: прапорці в обох формах', () => {
  const opts = parseArgs([
    '--tier', 'full', '--no-skip', '--only', 'lint,unit',
    '--reuse-if-fresh', '--json', '--timeout-ms=5000', '--root=/tmp/x',
  ]);
  expect(opts.tier).toBe('full');
  expect(opts.noSkip).toBe(true);
  expect(opts.only).toEqual(['lint', 'unit']);
  expect(opts.reuseIfFresh).toBe(true);
  expect(opts.json).toBe(true);
  expect(opts.timeoutMs).toBe(5000);
  expect(opts.root).toBe('/tmp/x');
});

test('parseArgs: невідомий прапорець — помилка, а не тиша', () => {
  // Проковтнутий «--no-skipp» тихо вимкнув би найсуворіший режим.
  expect(() => parseArgs(['--no-skipp'])).toThrow(/--no-skipp/);
  expect(() => parseArgs(['--tier', 'quick'])).toThrow(/quick/);
});

// 3. selectChecks — рівні зі спеки §3.3.
test('selectChecks: fast бере лише fast, full бере fast + full', () => {
  const fast = selectChecks(CHECKS, { tier: 'fast', only: [] }).map((c) => c.id);
  const full = selectChecks(CHECKS, { tier: 'full', only: [] }).map((c) => c.id);
  expect(fast).toContain('typecheck');
  expect(fast).not.toContain('build');
  expect(fast).not.toContain('e2e');
  expect(full).toEqual(expect.arrayContaining([...fast, 'build', 'e2e']));
});

test('selectChecks: --only звужує, а невідомий id — помилка', () => {
  expect(selectChecks(CHECKS, { tier: 'full', only: ['lint'] }).map((c) => c.id)).toEqual(['lint']);
  expect(() => selectChecks(CHECKS, { tier: 'full', only: ['lnt'] })).toThrow(/lnt/);
});

test('selectChecks: порожня вибірка — помилка, а не мовчазне зелене', () => {
  // `--tier fast --only build`: id існує, але в рівень не входить. Без цієї перевірки
  // прогін дав би нуль рядків, нуль блокувань і EXIT=0 — «verify пройшов», не
  // перевіривши нічого. Це найдорожча брехня, на яку шар узагалі здатний.
  expect(() => selectChecks(CHECKS, { tier: 'fast', only: ['build'] })).toThrow(/fast/);
});

// 4. orderChecks — поле after.
test('orderChecks: залежність стоїть перед залежним', () => {
  const ids = orderChecks(selectChecks(CHECKS, { tier: 'full', only: [] })).map((c) => c.id);
  expect(ids.indexOf('typecheck')).toBeLessThan(ids.indexOf('build'));
  expect(ids.indexOf('build')).toBeLessThan(ids.indexOf('e2e'));
});

test('orderChecks: цикл — помилка з названими id, не нескінченний цикл', () => {
  // Анотація `: Check[]` обовʼязкова. Без неї TS виводить `tier: string`
  // і `orderChecks(cyclic)` дає TS2345 «Type 'string' is not assignable to type 'Tier'»,
  // тобто червоний check-types замість червоного тесту.
  const cyclic: Check[] = [
    { id: 'a', tier: 'fast', cmd: 'true', needs: [], after: ['b'], proves: '.', blindSpot: '.' },
    { id: 'b', tier: 'fast', cmd: 'true', needs: [], after: ['a'], proves: '.', blindSpot: '.' },
  ];
  expect(() => orderChecks(cyclic)).toThrow(/a|b/);
});

// 5. classifyExit — розрізнення FAILED / UNRUNNABLE зі спеки §3.2.
test('classifyExit: вихід 0 — PASSED', () => {
  expect(classifyExit({ exitCode: 0 }).status).toBe('PASSED');
});

test('classifyExit: звичайний ненульовий вихід — FAILED', () => {
  const r = classifyExit({ exitCode: 3 });
  expect(r.status).toBe('FAILED');
  expect(r.reason).toContain('3');
});

test('classifyExit: ENOENT, 127, 126, таймаут — UNRUNNABLE, ніколи FAILED', () => {
  expect(classifyExit({ spawnError: { code: 'ENOENT' } }).status).toBe('UNRUNNABLE');
  expect(classifyExit({ exitCode: 127 }).status).toBe('UNRUNNABLE');
  expect(classifyExit({ exitCode: 126 }).status).toBe('UNRUNNABLE');
  expect(classifyExit({ timedOut: true, signal: 'SIGKILL' }).status).toBe('UNRUNNABLE');
});

// 6. parsePlaywrightTotal — окремий випадок зі спеки §3.2.
test('parsePlaywrightTotal: читає кількість, розпізнає нуль двома формами', () => {
  expect(parsePlaywrightTotal('Total: 0 tests in 0 files')).toBe(0);
  expect(parsePlaywrightTotal('Total: 5 tests in 1 file')).toBe(5);
  expect(parsePlaywrightTotal('Total: 1 test in 1 file')).toBe(1);
  expect(parsePlaywrightTotal('Error: No tests found')).toBe(0);
});

test('parsePlaywrightTotal: нерозбірне — null, і це не нуль', () => {
  // null → раннер зобов'язаний дати UNRUNNABLE. Якби тут повертався 0,
  // зламана проба видавала б «0 тестів написано» — тобто брехала б про код.
  expect(parsePlaywrightTotal('')).toBe(null);
  expect(parsePlaywrightTotal('щось геть інше')).toBe(null);
});

// 7. Цілісність реєстру — стереже дані, не логіку.
test('реєстр: id унікальні, tier валідний, посилання розвʼязні', () => {
  const ids = CHECKS.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const check of CHECKS) {
    expect(['fast', 'full']).toContain(check.tier);
    for (const need of check.needs) expect(Object.keys(PRECONDITIONS)).toContain(need);
    for (const dep of check.after) expect(ids).toContain(dep);
  }
});

test('реєстр: у кожного рядка є непорожні proves і blindSpot', () => {
  // §3.1: рядок без спростовного proves — декоративний і має бути видалений.
  for (const check of CHECKS) {
    expect(check.proves.length).toBeGreaterThan(20);
    expect(check.blindSpot.length).toBeGreaterThan(20);
  }
});

test('реєстр: імена Playwright-проєктів збігаються з конфігом задачі 1 дослівно', () => {
  // Розбіжність тут дала б 0 тестів, тобто тихий SKIPPED замість реального прогону.
  expect(CHECKS.find((c) => c.id === 'unit')?.cmd).toContain('--project=unit');
  expect(CHECKS.find((c) => c.id === 'e2e')?.cmd).toContain('--project=e2e');
});
```

- [ ] **Крок 3: Запустити й переконатися, що падає з правильної причини**

```bash
npx playwright test --project=unit
```

Очікується: `hash.spec.ts` — 5 passed; `run.spec.ts` — падіння з
`Cannot find module '../../scripts/verify/registry.mjs'`.

Саме це повідомлення, а не `TS7016` і не `0 tests`: перше означало б забутий `.d.mts`,
друге — зламаний `testMatch`.

- [ ] **Крок 4: Написати `scripts/verify/registry.mjs` — самі дані**

Проза `proves` і `blindSpot` **перенесена зі спеки §4 дослівно**; це узгоджений текст, який
задача 12 кладе в checkpoint. Єдине доповнення — останнє речення `blindSpot` рядка `e2e`
(див. позначку нижче).

```js
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
    blindSpot: 'Стиль і статичні шаблони, не логіку. Правило, якого немає в конфігу, не порушується за визначенням',
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
    blindSpot: 'Ні браузера, ні DOM, ні Leaflet. Про рендер і карту не говорить нічого. Випадок, якого ніхто не написав, не покритий',
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
```

Три власні структурні перевірки (`no-ref-imports`, `no-secrets`, `deps-allowlist`) зі спеки
§4 сюди **не входять**: їхніх файлів ще немає, а рядок, чия `cmd` вказує на неіснуючий
скрипт, дав би `UNRUNNABLE` і зашумив би приймання цієї задачі. Кожна з них дописує свій
рядок у власній задачі (5, 6, 7) — і саме це доводить межу, перевірену кроком 10.
Їхня проза `proves`/`blindSpot` зі спеки §4 переноситься туди дослівно.

- [ ] **Крок 5: Написати `scripts/verify/run.mjs`**

```js
// Раннер — оркестрація. Він не знає ЖОДНОЇ конкретної перевірки: усе, що він уміє,
// описано полями рядка реєстру. Нова перевірка — новий рядок, цей файл не змінюється.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

import { sourceHash } from './hash.mjs';
import { CHECKS, DEFAULT_TIMEOUT_MS, PRECONDITIONS } from './registry.mjs';

/** Спека §5, дослівно. */
export function isBlocking(status, noSkip) {
  if (status === 'PASSED') return false;
  if (status === 'SKIPPED') return noSkip;
  return true;             // FAILED, NOT_RUN, UNRUNNABLE
}

const TIERS = ['fast', 'full'];

export function parseArgs(argv) {
  const opts = {
    tier: 'fast', noSkip: false, only: [],
    reuseIfFresh: false, json: false, timeoutMs: null, root: null,
  };
  const valueOf = (arg, i, name) => {
    if (arg.startsWith(`${name}=`)) return [arg.slice(name.length + 1), i];
    if (argv[i + 1] === undefined) throw new Error(`прапорець ${name} без значення`);
    return [argv[i + 1], i + 1];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-skip') { opts.noSkip = true; continue; }
    if (arg === '--reuse-if-fresh') { opts.reuseIfFresh = true; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--tier' || arg.startsWith('--tier=')) {
      const [value, next] = valueOf(arg, i, '--tier'); i = next;
      if (!TIERS.includes(value)) throw new Error(`невідомий рівень: ${value}`);
      opts.tier = value; continue;
    }
    if (arg === '--only' || arg.startsWith('--only=')) {
      const [value, next] = valueOf(arg, i, '--only'); i = next;
      opts.only = value.split(',').map((s) => s.trim()).filter(Boolean); continue;
    }
    if (arg === '--timeout-ms' || arg.startsWith('--timeout-ms=')) {
      const [value, next] = valueOf(arg, i, '--timeout-ms'); i = next;
      const ms = Number(value);
      if (!Number.isInteger(ms) || ms <= 0) throw new Error(`--timeout-ms: ${value}`);
      opts.timeoutMs = ms; continue;
    }
    if (arg === '--root' || arg.startsWith('--root=')) {
      const [value, next] = valueOf(arg, i, '--root'); i = next;
      opts.root = value; continue;
    }
    // Мовчазно проігнорований прапорець — це тихо вимкнений режим.
    // «--no-skipp» не має скасовувати найсуворішу перевірку без жодного слова.
    throw new Error(`невідомий прапорець: ${arg}`);
  }
  return opts;
}

export function selectChecks(checks, { tier, only }) {
  const byTier = tier === 'full' ? checks : checks.filter((c) => c.tier === 'fast');
  if (only.length === 0) return byTier;
  const known = new Set(checks.map((c) => c.id));
  for (const id of only) if (!known.has(id)) throw new Error(`--only: невідомий id ${id}`);
  const selected = byTier.filter((c) => only.includes(c.id));
  // Порожня вибірка — не «усе пройшло». `--tier fast --only build` дає рівно нуль
  // рядків, нуль блокувань і EXIT=0: зелений прогін, який не перевірив НІЧОГО.
  // Це найгірший з можливих результатів шару, тож він має бути помилкою, а не тишею.
  if (selected.length === 0) {
    throw new Error(`--only: жоден із [${only.join(', ')}] не належить рівню ${tier}`);
  }
  return selected;
}

export function orderChecks(checks) {
  const selected = new Set(checks.map((c) => c.id));
  const done = new Set();
  const ordered = [];
  let remaining = [...checks];
  while (remaining.length > 0) {
    // Залежність поза вибіркою вважається задоволеною: вона не бігла, отже не падала.
    // Це свідома поведінка --only, а не недогляд.
    const ready = remaining.filter((c) => c.after.every((d) => done.has(d) || !selected.has(d)));
    if (ready.length === 0) {
      throw new Error(`цикл у полі after: ${remaining.map((c) => c.id).join(', ')}`);
    }
    for (const c of ready) { ordered.push(c); done.add(c.id); }
    remaining = remaining.filter((c) => !done.has(c.id));
  }
  return ordered;
}

export function classifyExit({ spawnError, exitCode, signal, timedOut }) {
  if (spawnError) return { status: 'UNRUNNABLE', reason: `не вдалося запустити: ${spawnError.code ?? spawnError.message}` };
  if (timedOut) return { status: 'UNRUNNABLE', reason: `таймаут — групу процесів убито (${signal ?? 'SIGKILL'})` };
  if (exitCode === 127) return { status: 'UNRUNNABLE', reason: 'команду не знайдено (вихід 127)' };
  if (exitCode === 126) return { status: 'UNRUNNABLE', reason: 'команда не виконувана (вихід 126)' };
  if (exitCode === 0) return { status: 'PASSED', reason: '' };
  if (exitCode === null) return { status: 'UNRUNNABLE', reason: `обірвано сигналом ${signal}` };
  return { status: 'FAILED', reason: `вихід ${exitCode}` };
}

/** Кількість тестів із виводу Playwright, або null, якщо вивід нерозбірний. */
export function parsePlaywrightTotal(text) {
  const total = /Total:\s+(\d+)\s+tests?\b/.exec(text);
  if (total) return Number(total[1]);
  if (/No tests found/i.test(text)) return 0;
  return null;   // НЕ нуль: нерозбірне → UNRUNNABLE, а не «0 тестів написано»
}

export function resolveRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return cwd;   // не git-репозиторій: працюємо там, де нас запустили
  }
}

/** Один `cmd` через /bin/sh із кореня, з таймаутом, безпечним для ГРУПИ процесів. */
function runCommand(cmd, root, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], {
      cwd: root,
      // detached: дитина стає лідером НОВОЇ групи, тож kill(-pid) дістає й онуків.
      // Без цього `next build` лишає дітей жити після таймауту.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* група вже мертва */ }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* так само */ } }, 2_000);
    }, timeoutMs);

    child.on('error', (spawnError) => {
      clearTimeout(timer);
      resolve({ spawnError, exitCode: null, signal: null, timedOut, stdout, stderr });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ spawnError: null, exitCode, signal, timedOut, stdout, stderr });
    });
  });
}

export async function runAll({ checks = CHECKS, root, tier, noSkip, only, timeoutMs }) {
  const ordered = orderChecks(selectChecks(checks, { tier, only }));
  const results = [];
  const statusById = new Map();

  for (const check of ordered) {
    const startedAt = Date.now();
    const base = { id: check.id, tier: check.tier, cmd: check.cmd, proves: check.proves, blindSpot: check.blindSpot };
    const finish = (status, reason, extra = {}) => {
      const result = { ...base, status, reason, exitCode: null, signal: null, stdout: '', stderr: '', durationMs: Date.now() - startedAt, ...extra };
      results.push(result); statusById.set(check.id, status); return result;
    };

    // 1. Залежність упала → NOT_RUN. Ця перевірка не бігла й нічого не стверджує.
    const brokenDep = check.after.find((d) => statusById.has(d) && isBlocking(statusById.get(d), noSkip));
    if (brokenDep) { finish('NOT_RUN', `не запускалась: ${brokenDep} → ${statusById.get(brokenDep)}`); continue; }

    // 2. Передумови. Про код не говорять НІЧОГО.
    const missing = check.needs.find((n) => !PRECONDITIONS[n].probe(root));
    if (missing) { finish('SKIPPED', PRECONDITIONS[missing].describe); continue; }

    const limit = timeoutMs ?? check.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // 3. Проба порожнечі. Нуль знайдених тестів — SKIPPED, ніколи PASSED.
    if (check.emptyProbe) {
      const probe = await runCommand(check.emptyProbe.cmd, root, limit);
      const total = parsePlaywrightTotal(`${probe.stdout}\n${probe.stderr}`);
      if (total === null) {
        finish('UNRUNNABLE', 'проба переліку тестів дала нерозбірний вивід', { stdout: probe.stdout, stderr: probe.stderr, exitCode: probe.exitCode });
        continue;
      }
      if (total === 0) { finish('SKIPPED', check.emptyProbe.reason); continue; }
    }

    // 4. Сама перевірка.
    const outcome = await runCommand(check.cmd, root, limit);
    const { status, reason } = classifyExit(outcome);
    finish(status, reason, { exitCode: outcome.exitCode, signal: outcome.signal, stdout: outcome.stdout, stderr: outcome.stderr });
  }
  return results;
}

// CLI
// R-22: `import.meta.filename === process.argv[1]` — не конкатенація `file://…`,
// яка ламається на пробілах і не-ASCII у шляху, а тека worktree — це шлях,
// який обирали не ми.
if (import.meta.filename === process.argv[1]) {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root ? path.resolve(opts.root) : resolveRoot(process.cwd());
  // ...opts ПЕРЕД root, не після. У opts є власний root (за замовчуванням null),
  // і зворотний порядок затер би щойно обчислений корінь нулем — probe(null)
  // упав би на path.join(null, 'node_modules').
  const results = await runAll({ ...opts, root });
  const blocking = results.some((r) => isBlocking(r.status, opts.noSkip));
  // Тимчасовий текстовий вивід. Таблиця й кеш свіжості приходять у задачі 4;
  // форма JSON — ні, вона фіксується тут і більше не змінюється.
  if (opts.json) {
    // R-16, дослівно. Рівно ці поля й у цьому порядку; споживачі — звіт задачі 4
    // і Stop-гейт задачі 10 — цитують цю форму у своїх Interfaces. Повні stdout,
    // stderr, exitCode лишаються всередині `results` раннера, але у JSON не
    // потрапляють: гейт читає їх із `.verify/last-run.json` (задача 4).
    const report = {
      tier: opts.tier,
      root,
      noSkip: opts.noSkip,
      sourceHash: sourceHash(root).hash,
      results: results.map((r) => ({
        id: r.id, status: r.status, reason: r.reason, durationMs: r.durationMs,
      })),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else for (const r of results) process.stdout.write(`${r.status.padEnd(11)} ${r.id}${r.reason ? `  — ${r.reason}` : ''}\n`);
  // exitCode, а не process.exit(): запис у трубу асинхронний, і process.exit
  // обрізав би хвіст таблиці рівно тоді, коли вивід кудись перенаправлено
  // (крок 12 задачі 4 саме це й робить).
  process.exitCode = blocking ? 1 : 0;
}
```

Три місця, які легко зіпсувати непомітно, і тому названі окремо:

- **`--root` — доповнення до списку прапорців спеки §5. [РІШЕННЯ]** Воно потрібне не тут, а
  в задачі 10: за документацією хуків `$CLAUDE_PROJECT_DIR` у worktree **лишається на
  головному checkout**, а активну теку хук отримує полем `cwd` вхідного JSON. Без `--root`
  гейт перевіряв би головне дерево, поки Claude редагує worktree — тобто видавав би зелене
  з дерева, якого ніхто не змінював. Дефолт (`git rev-parse --show-toplevel`) лишає поведінку
  без прапорця такою, як описує спека.
- **`emptyProbe` — поле, якого немає у формі рядка зі спеки §3.1. [РІШЕННЯ]** Спека вимагає
  поведінки («0 тестів → SKIPPED»), але не каже, де вона живе. Тримати її в даних — єдиний
  спосіб не порушити межу «новий рядок без правки `run.mjs`».
- **`timeoutMs` у рядку + дефолт 120 000 мс. [РІШЕННЯ]** Спека дає прапорець `--timeout-ms`
  і не дає дефолту. `build` і `e2e` отримують 300 000: холодна збірка Next легко переступає
  дві хвилини, а таймаут — це `UNRUNNABLE`, тобто блокування з неправдивої причини.

- [ ] **Крок 6: Написати декларації `registry.d.mts` і `run.d.mts`**

Без них `tests/unit/run.spec.ts` дає `TS7016`, і крок 1 наступної задачі буде червоним не
з приводу коду — рівно та підміна причини, від якої шар будується (та сама пастка, що в
задачі 2).

```ts
// scripts/verify/registry.d.mts
export type Tier = 'fast' | 'full';

export interface Check {
  id: string;
  tier: Tier;
  cmd: string;
  needs: string[];
  after: string[];
  proves: string;
  blindSpot: string;
  timeoutMs?: number;
  emptyProbe?: { cmd: string; reason: string };
}

export interface Precondition {
  describe: string;
  probe: (root: string) => boolean;
}

export declare const DEFAULT_TIMEOUT_MS: number;
export declare const CHECKS: Check[];
export declare const PRECONDITIONS: Record<string, Precondition>;
```

```ts
// scripts/verify/run.d.mts
// Специфікатор — './registry.mjs' (рантайм-шлях), а не './registry.d.mts':
// декларацію TS знаходить сам. Обидві форми компілюються за поточного
// moduleResolution: "bundler", але лише перша переживе перехід на "node16".
import type { Check, Tier } from './registry.mjs';

export type Status = 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN' | 'UNRUNNABLE';

export interface CheckResult {
  id: string;
  tier: Tier;
  cmd: string;
  proves: string;
  blindSpot: string;
  status: Status;
  reason: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Options {
  tier: Tier;
  noSkip: boolean;
  only: string[];
  reuseIfFresh: boolean;
  json: boolean;
  timeoutMs: number | null;
  root: string | null;
}

export declare function isBlocking(status: Status, noSkip: boolean): boolean;
export declare function parseArgs(argv: readonly string[]): Options;
export declare function selectChecks(checks: Check[], opts: { tier: Tier; only: string[] }): Check[];
export declare function orderChecks(checks: Check[]): Check[];
export declare function classifyExit(outcome: {
  spawnError?: { code?: string; message?: string } | null;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
}): { status: Status; reason: string };
export declare function parsePlaywrightTotal(text: string): number | null;
export declare function resolveRoot(cwd: string): string;
export declare function runAll(options: {
  checks?: Check[];
  root: string;
  tier: Tier;
  noSkip: boolean;
  only: string[];
  timeoutMs: number | null;
}): Promise<CheckResult[]>;
```

- [ ] **Крок 7: Тести мають пройти**

```bash
npx playwright test --project=unit
```

Очікується: `24 passed` — 5 із `hash.spec.ts` і 19 із `run.spec.ts` (три `isBlocking`,
три `parseArgs`, три `selectChecks`, дві `orderChecks`, три `classifyExit`, дві
`parsePlaywrightTotal`, три цілісності реєстру). Якщо якийсь із трьох
тестів цілісності реєстру червоний — виправляти **реєстр**, не тест: тест тут і є вимога.

- [ ] **Крок 8: Додати три скрипти в `package.json`**

Дослівно за спекою §3.3 — `verify` = fast, `verify:full` = fast + full,
`verify:checkpoint` = full + `--no-skip`:

```json
    "verify": "node scripts/verify/run.mjs --tier fast",
    "verify:full": "node scripts/verify/run.mjs --tier full",
    "verify:checkpoint": "node scripts/verify/run.mjs --tier full --no-skip"
```

- [ ] **Крок 9: Прогін на справжньому репозиторії — і що саме він доводить**

```bash
npm run verify; echo "EXIT=$?"
npm run verify:full; echo "EXIT=$?"
```

Очікується від `npm run verify` — рівно три рядки й `EXIT=0`:

```
PASSED      typecheck
PASSED      lint
PASSED      unit
```

Очікується від `npm run verify:full` — ті самі три плюс:

```
PASSED      build
SKIPPED     e2e  — 0 тестів написано
```

і `EXIT=0`, бо `SKIPPED` без `--no-skip` не блокує.

**Що саме тут доведено, дослівно.** `e2e` стоїть `SKIPPED`, а не `PASSED` — тека `tests/e2e/`
порожня, і «пройшло 0 тестів» не доводить нічого. Якщо в цьому рядку побачите `PASSED` —
це не успіх, це та сама поведінка, яку шар побудовано ловити; `emptyProbe` не спрацював.
Якщо `e2e` стоїть `SKIPPED` із причиною «немає бінарника chromium…» — це теж правильно
(завантаження з задачі 1 ще не завершилось) і нічого не приховує; тоді проба порожнечі
лишається неперевіреною, і її треба довести окремо:

```bash
npx playwright test --project=e2e --list
```

Очікується рядок із `Total: 0 tests`. Якщо формат виявиться іншим — виправити регулярний
вираз `parsePlaywrightTotal` під фактичний вивід і **дописати фактичний рядок у тест**,
а не підганяти очікування кроку.

- [ ] **Крок 10: Навмисний злам — довести межу й довести розрізнення статусів**

Оглядом це недоказовно. **Спершу зняти зліпок — обидва файли ще не в git** (коміт аж у
кроці 12), тож ні `git diff`, ні `git checkout --` на них не працюють: перший на
невідстежуваному файлі друкує порожнечу незалежно від того, змінювали його чи ні
(тобто нічого не доводить), другий просто впаде з `pathspec did not match`.

```bash
cp scripts/verify/registry.mjs /tmp/verify-registry.bak.mjs
shasum -a 256 scripts/verify/run.mjs | tee /tmp/verify-run.sha
```

Тимчасово дописати в кінець масиву `CHECKS` три рядки:

```js
  { id: 'probe-ok', tier: 'fast', cmd: 'true', needs: [], after: [], proves: 'нічого, це проба межі', blindSpot: 'нічого, це проба межі' },
  { id: 'probe-fail', tier: 'fast', cmd: 'exit 3', needs: [], after: [], proves: 'нічого, це проба межі', blindSpot: 'нічого, це проба межі' },
  { id: 'probe-enoent', tier: 'fast', cmd: 'definitely-not-a-binary', needs: [], after: ['probe-fail'], proves: 'нічого, це проба межі', blindSpot: 'нічого, це проба межі' },
```

```bash
npm run verify; echo "EXIT=$?"
shasum -a 256 -c /tmp/verify-run.sha
```

Очікується:

```
PASSED      probe-ok
FAILED      probe-fail   — вихід 3
NOT_RUN     probe-enoent — не запускалась: probe-fail → FAILED
EXIT=1
```

і `shasum -c` — `scripts/verify/run.mjs: OK`. Саме контрольна сума, а не `git diff`:
`run.mjs` тут ще невідстежуваний, тож `git diff` мовчав би й на зміненому файлі.

Три твердження за один прогін: три нові рядки додалися без жодної правки раннера (межа
ціла); `exit 3` дає `FAILED`, а не `UNRUNNABLE`; впала залежність дає `NOT_RUN`, а не
тишу й не `FAILED`.

Далі прибрати `after: ['probe-fail']` у `probe-enoent` і прогнати ще раз — має стати
`UNRUNNABLE     probe-enoent — команду не знайдено (вихід 127)`. Це четверте твердження:
неіснуючий бінарник **не** читається як провал коду.

```bash
cp /tmp/verify-registry.bak.mjs scripts/verify/registry.mjs
rm /tmp/verify-registry.bak.mjs /tmp/verify-run.sha
npm run verify; echo "EXIT=$?"
```

Очікується: знову три рядки й `EXIT=0`. Відкат повертає зелене — інакше злам був не тимчасовий.

- [ ] **Крок 11: Перезапустити всі три успадковані зелені (R-09)**

```bash
source ~/.nvm/nvm.sh && nvm use \
  && npm run check-types \
  && npm run lint \
  && npx playwright test --project=unit
```

Усі три — вихід `0`. Задача додала чотири файли, яких жодна з трьох перевірок раніше
не бачила.

Якщо `lint` лається на Node-глобалі (`process`, `console`, `Buffer`) у
`scripts/verify/*.mjs` — **це дефект блоку з задачі 1, а не привід дописати другий блок тут.**
За R-10 власником блоку `files: ['scripts/**/*.mjs', '.claude/hooks/**/*.mjs']` із
`languageOptions.globals`, виписаними літералом, є `eslint.config.mjs` задачі 1. Повернутися
туди й полагодити перелік глобалів; пакет `globals` **не встановлюється** — залежностей рівно
три (спека §8), і транзитивна доступність через підняття в `node_modules/` не є контрактом.
Ця задача `eslint.config.mjs` не змінює.

- [ ] **Крок 12: Коміт**

```bash
git status --porcelain            # має показати рівно те, що нижче, і нічого зайвого
git add scripts/verify/registry.mjs scripts/verify/registry.d.mts \
        scripts/verify/run.mjs scripts/verify/run.d.mts \
        tests/unit/run.spec.ts package.json
git commit -m "feat(verify): реєстр перевірок і раннер із п'ятьма статусами

Реєстр — дані, раннер — оркестрація. Щоб додати перевірку, дописують
registry.mjs; run.mjs не змінюється. Межу перевірено навмисним
додаванням трьох рядків: раннер лишився недоторканим.

П'ять статусів розрізняються навмисно. FAILED означає, що перевірка
виконалась і знайшла проблему; UNRUNNABLE — що вона не змогла
запуститися й про код не сказала нічого. Повідомити перше замість
другого означало б стверджувати щось про код, якого ніхто не бачив.

Playwright із нулем знайдених тестів дає SKIPPED «0 тестів написано»,
а не PASSED: «пройшло 0 тестів» не доводить нічого. Нерозбірний вивід
проби дає UNRUNNABLE — теж не PASSED.

Таймаут убиває групу процесів, а не лідера: інакше next build лишає
дітей жити далі.

Порожня вибірка --only — помилка. «--tier fast --only build» інакше
дав би нуль рядків і EXIT=0: зелений прогін, який не перевірив нічого.

Прапорець --root додано понад список спеки §5. У worktree
\$CLAUDE_PROJECT_DIR лишається на головному checkout, тож без --root
Stop-гейт задачі 10 перевіряв би не те дерево, яке редагують.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: `report.mjs` — таблиця, JSON-звіт, кеш свіжості

Після задачі 3 раннер знає правду, але віддає її десятьма рядками в `stdout` і кодом виходу.
Цього замало двом споживачам: людині, якій потрібні п'ять **розрізнюваних** статусів у терміналі,
і Stop-гейту задачі 10, якому потрібен файл, що переживає процес. Ця задача додає обидва —
і кеш свіжості зі спеки §3.4, який робить повторний `verify` у хуці дешевим настільки, щоб
хук можна було тримати ввімкненим.

Одна межа задає тут усе інше: **`report.mjs` не ухвалює статусів.** Він рендерить те, що
вирішив `run.mjs`. Форматувальник, який «виправляє» статус (скажімо, малює `exitCode: 0` як
`PASSED`), робить п'ять статусів декоративними — і саме це стереже тест у кроці 2.

**Files:**
- Create: `scripts/verify/report.mjs`
- Create: `scripts/verify/report.d.mts`
- Test: `tests/unit/report.spec.ts`
- Modify: `scripts/verify/run.mjs` (підключення звіту, `--reuse-if-fresh`, `--json`)
- Modify: `.gitignore` — **лише якщо** рядка ще немає: `/.verify/` дописує задача 2, крок 7;
  тут він тільки перевіряється (див. крок 7)

**Interfaces:**
- Consumes: `CheckResult[]` і `parseArgs` із задачі 3; `sourceHash(root)` із задачі 2.
  `isBlocking` із задачі 3 споживає **`run.mjs`**, не `report.mjs`: вердикт обчислює раннер
  і передає його в `toReport` готовим полем `blocking`. Так межа «`report.mjs` не ухвалює
  статусів» тримається в коді, а не лише в прозі — і `report.mjs` не імпортує `run.mjs`,
  тобто циклу модулів не виникає.
- Produces:
  - `formatTable(results, opts)`, `wantsColor(stream, env)`, `toReport(input)`,
    `writeReport(root, report)`, `readReport(root)`, `readFreshPass(root, key)`,
    `cacheKey(opts)`, `truncateBytes(text, maxBytes)`
  - файл `.verify/last-run.json` зі схемою `schema: 1` — його читає `stop-gate.mjs` задачі 10
    і `docs` задачі 12
  - **`run.mjs --json` лишається у формі, зафіксованій R-16 задачею 3:**

    ```json
    {
      "tier": "<string>",
      "root": "<abs path>",
      "noSkip": false,
      "sourceHash": "<string>",
      "results": [ { "id": "…", "status": "…", "reason": "…", "durationMs": 0 } ]
    }
    ```

    Те, що звіт усередині багатший (`schema`, `key`, `blocking`, `exitCode`, обрізані
    `stdout`/`stderr`), форми stdout не змінює: багатший об'єкт іде у `.verify/last-run.json`,
    на stdout іде контракт. `sourceHash` у JSON — це поле `hash` звіту під іменем із R-16.

- [ ] **Крок 1: Зафіксувати середовище і успадковане зелене**

```bash
source ~/.nvm/nvm.sh && nvm use
npm run check-types
npm run lint
npm run verify; echo "EXIT=$?"
```

Очікується: `v24.21.0`; дві тиші з виходом `0`; `verify` — три `PASSED` і `EXIT=0`.
Задача 4 змінює `run.mjs`; якщо він уже червоний, кожна подальша різниця виявиться
приписаною не тій причині.

- [ ] **Крок 2: Написати падаючий тест `tests/unit/report.spec.ts`**

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect } from '@playwright/test';

import type { CheckResult } from '../../scripts/verify/run.mjs';
import {
  cacheKey,
  formatTable,
  readFreshPass,
  readReport,
  toReport,
  truncateBytes,
  wantsColor,
  writeReport,
} from '../../scripts/verify/report.mjs';

// `Partial<CheckResult>` і явний тип повернення — не косметика. З `Record<string, unknown>`
// TS виводить `tier: string` і `status: string`, і кожен виклик formatTable/toReport дає
// TS2345 «Type 'string' is not assignable to type Tier/Status»: червоний check-types
// замість червоного тесту, тобто рівно та підміна причини, від якої шар будується.
const result = (over: Partial<CheckResult> = {}): CheckResult => ({
  id: 'lint', tier: 'fast', cmd: 'npm run --silent lint',
  proves: 'п', blindSpot: 'б', status: 'PASSED', reason: '',
  exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 12,
  ...over,
});

// 1. МЕЖА: report.mjs не ухвалює статусів.
test('formatTable друкує статус як є, навіть коли він суперечить exitCode', () => {
  // Результат навмисно суперечливий: FAILED при exitCode 0.
  // Форматувальник, який «виправить» його на PASSED, знищив би сенс п'яти статусів.
  const table = formatTable([result({ status: 'FAILED', exitCode: 0 })], { color: false });
  expect(table).toContain('FAILED');
  expect(table).not.toContain('PASSED');
});

// 2. П'ять статусів мають лишатися п'ятьма розрізнюваними токенами без кольору.
test('усі пʼять статусів друкуються різними літералами без ANSI', () => {
  const statuses = ['PASSED', 'FAILED', 'SKIPPED', 'NOT_RUN', 'UNRUNNABLE'] as const;
  const table = formatTable(statuses.map((s, i) => result({ id: `c${i}`, status: s })), { color: false });
  for (const s of statuses) expect(table).toContain(s);
  expect(table).not.toMatch(/\u001b\[/);   // жодного escape-байта
});

test('SKIPPED завжди несе причину — інакше він читається як «усе гаразд»', () => {
  const table = formatTable([result({ id: 'e2e', status: 'SKIPPED', reason: '0 тестів написано' })], { color: false });
  expect(table).toContain('0 тестів написано');
});

// 3. Колір: TTY + NO_COLOR + TERM.
test('wantsColor: колір лише в TTY без NO_COLOR і без TERM=dumb', () => {
  expect(wantsColor({ isTTY: true }, {})).toBe(true);
  expect(wantsColor({ isTTY: false }, {})).toBe(false);
  expect(wantsColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
  expect(wantsColor({ isTTY: true }, { NO_COLOR: '' })).toBe(true);   // порожнє — не заборона
  expect(wantsColor({ isTTY: true }, { TERM: 'dumb' })).toBe(false);
});

// 4. Обрізання за БАЙТАМИ, не за кодовими одиницями.
test('truncateBytes ріже за байтами і ніколи не лишає пів символу', () => {
  const ukr = 'абвгд';                       // 10 байтів UTF-8
  // Ліміт 5 менший за сам маркер «\n…[обрізано]» (22 байти) — тим паче результат
  // мусить уміститися в 5. Реалізація, яка приклеює маркер завжди, повертає тут
  // 22 байти і цей рядок ловить її першим.
  expect(Buffer.byteLength(truncateBytes(ukr, 5))).toBeLessThanOrEqual(5);
  expect(truncateBytes(ukr, 5)).not.toContain('�');
  expect(truncateBytes(ukr, 100)).toBe(ukr); // коротше за ліміт — без змін
  expect(truncateBytes('', 10)).toBe('');
  // Коли місця вистачає — маркер є, і загальна довжина все одно в межах ліміту.
  const long = 'я'.repeat(200);              // 400 байтів
  expect(Buffer.byteLength(truncateBytes(long, 64))).toBeLessThanOrEqual(64);
  expect(truncateBytes(long, 64)).toContain('[обрізано]');
});

// 5. Звіт: схема, запис, читання.
test('writeReport/readReport роблять круг без втрат', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-'));
  // blocking передає викликач (у продакшені — run.mjs через isBlocking).
  // toReport його не виводить: рішення про блокування не належить звіту.
  const report = toReport({ root, tier: 'fast', noSkip: false, only: [], hash: 'deadbeef', fileCount: 11, reused: false, blocking: false, results: [result()] });
  writeReport(root, report);
  const read = readReport(root);
  expect(read?.schema).toBe(1);
  expect(read?.hash).toBe('deadbeef');
  expect(read?.results[0].status).toBe('PASSED');
  expect(readFileSync(path.join(root, '.verify', 'last-run.json'), 'utf8')).toContain('"schema": 1');
});

test('readReport на зіпсованому файлі дає null, а не виняток', () => {
  // Зіпсований кеш мусить коштувати один зайвий прогін, а не перетворити
  // весь verify на UNRUNNABLE.
  const root = mkdtempSync(path.join(tmpdir(), 'verify-'));
  writeReport(root, toReport({ root, tier: 'fast', noSkip: false, only: [], hash: 'x', fileCount: 0, reused: false, blocking: false, results: [] }));
  writeFileSync(path.join(root, '.verify', 'last-run.json'), '{ це не json');
  expect(readReport(root)).toBe(null);
});

test('readReport на відсутньому файлі дає null', () => {
  expect(readReport(mkdtempSync(path.join(tmpdir(), 'verify-')))).toBe(null);
});

// 6. Кеш свіжості.
test('cacheKey розрізняє рівень, --no-skip і --only, не лише хеш', () => {
  const base = { hash: 'h', tier: 'fast', noSkip: false, only: [] };
  expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  expect(cacheKey(base)).not.toBe(cacheKey({ ...base, tier: 'full' }));
  expect(cacheKey(base)).not.toBe(cacheKey({ ...base, noSkip: true }));
  expect(cacheKey(base)).not.toBe(cacheKey({ ...base, only: ['lint'] }));
});

test('readFreshPass повертає звіт лише при збігу ключа І чистому результаті', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-'));
  const opts = { hash: 'h1', tier: 'fast', noSkip: false, only: [] };
  writeReport(root, toReport({ root, ...opts, fileCount: 1, reused: false, blocking: false, results: [result()] }));

  expect(readFreshPass(root, cacheKey(opts))?.hash).toBe('h1');
  // Змінився хеш дерева — кеш недійсний. Це і є сенс контентної адресації.
  expect(readFreshPass(root, cacheKey({ ...opts, hash: 'h2' }))).toBe(null);
  // Інший рівень — інший ключ: зелений fast не має видаватися за full.
  expect(readFreshPass(root, cacheKey({ ...opts, tier: 'full' }))).toBe(null);
});

test('readFreshPass ніколи не відтворює НЕзелений прогін', () => {
  // Відтворене «червоно» приховало б виправлення, яке щойно зробили.
  const root = mkdtempSync(path.join(tmpdir(), 'verify-'));
  const opts = { hash: 'h1', tier: 'fast', noSkip: false, only: [] };
  writeReport(root, toReport({ root, ...opts, fileCount: 1, reused: false, blocking: true, results: [result({ status: 'FAILED', exitCode: 1 })] }));
  expect(readFreshPass(root, cacheKey(opts))).toBe(null);
});
```

- [ ] **Крок 3: Запустити й переконатися, що падає з правильної причини**

```bash
npx playwright test --project=unit
```

Очікується: `hash.spec.ts` і `run.spec.ts` зелені; `report.spec.ts` падає з
`Cannot find module '../../scripts/verify/report.mjs'`. Не `TS7016` і не `0 tests`.

- [ ] **Крок 4: Написати `scripts/verify/report.mjs`**

```js
// Подання і збереження. Жодного рішення про статус: усе, що тут відбувається з
// r.status, — це друк і серіалізація. Якщо тут з'явиться if про exitCode — межу зламано.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const SCHEMA = 1;
const MAX_OUTPUT_BYTES = 8 * 1024;
const STATUS_WIDTH = 'UNRUNNABLE'.length;

const COLORS = {
  PASSED: '\u001b[32m', FAILED: '\u001b[31m', SKIPPED: '\u001b[33m',
  NOT_RUN: '\u001b[90m', UNRUNNABLE: '\u001b[35m',
};

/**
 * Обрізання за БАЙТАМИ. String.slice рахує кодові одиниці UTF-16: український текст
 * два байти на символ, тож «8192 символи» — це до 16 КіБ у файлі. StringDecoder
 * віддає лише повні символи, тож обрізаний хвіст ніколи не стає U+FFFD.
 */
const TRUNCATION_MARKER = '\n…[обрізано]';                                  // 22 байти UTF-8
const MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');

export function truncateBytes(text, maxBytes = MAX_OUTPUT_BYTES) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  const decoder = new StringDecoder('utf8');
  // Маркер сам важить 22 байти. Приклеїти його безумовно означало б повернути
  // з «обріж до 5 байтів» рядок на 22 байти — функція порушувала б власний контракт
  // саме тоді, коли ліміт найжорсткіший. Місця немає — ріжемо без маркера.
  if (maxBytes <= MARKER_BYTES) return decoder.write(buf.subarray(0, maxBytes));
  return decoder.write(buf.subarray(0, maxBytes - MARKER_BYTES)) + TRUNCATION_MARKER;
}

/** Колір лише коли його справді видно і ніхто не просив без нього. */
export function wantsColor(stream, env = process.env) {
  if (!stream?.isTTY) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;
  return true;
}

export function formatTable(results, { color = false } = {}) {
  const idWidth = Math.max(4, ...results.map((r) => r.id.length));
  const lines = results.map((r) => {
    // Статус друкується дослівно. Ніколи не виводиться з exitCode.
    const label = r.status.padEnd(STATUS_WIDTH);
    const painted = color ? `${COLORS[r.status] ?? ''}${label}\u001b[0m` : label;
    const ms = `${String(r.durationMs).padStart(6)} мс`;
    const tail = r.reason ? `  — ${r.reason}` : '';
    return `${painted}  ${r.id.padEnd(idWidth)}  ${ms}${tail}`;
  });
  return `${lines.join('\n')}\n`;
}

export function cacheKey({ hash, tier, noSkip, only }) {
  // Хеш дерева — не весь ключ. Зелений fast не доводить нічого про build і e2e,
  // тож відтворювати його для --tier full було б брехнею про обсяг перевіреного.
  return `${hash}|${tier}|${noSkip ? 'noskip' : 'skipok'}|${[...only].sort().join(',')}`;
}

export function toReport({ root, tier, noSkip, only, hash, fileCount, reused, blocking, results, startedAt = Date.now(), durationMs = 0 }) {
  // blocking ПРИХОДИТЬ ззовні. Раніше тут стояла власна копія правила зі спеки §5 —
  // друга реалізація isBlocking, яка розійшлася б із першою мовчки й зробила б
  // межу «report.mjs не ухвалює статусів» порожньою декларацією.
  return {
    schema: SCHEMA,
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    root, tier, noSkip, only, hash, fileCount, reused,
    key: cacheKey({ hash, tier, noSkip, only }),
    blocking,
    exitCode: blocking ? 1 : 0,
    // stdout/stderr перевірок зберігаються сюди обрізаними. Файл лежить у .verify/,
    // яка в .gitignore (крок 7), тож у репозиторій він не потрапляє; але це все одно
    // локальний артефакт із чужим виводом — читати його оком, не вставляти в звіти.
    results: results.map((r) => ({ ...r, stdout: truncateBytes(r.stdout ?? ''), stderr: truncateBytes(r.stderr ?? '') })),
  };
}

const reportPath = (root) => path.join(root, '.verify', 'last-run.json');

export function writeReport(root, report) {
  mkdirSync(path.join(root, '.verify'), { recursive: true });
  // Запис через тимчасовий файл + rename: два паралельні прогони ніколи не лишать
  // напівзаписаний JSON. Спека §3.4 не вимагає блокування — злиття вирішує контентна
  // адресація, а не замок: переможець просто перезапише, і найгірша ціна — зайвий прогін.
  const tmp = `${reportPath(root)}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  renameSync(tmp, reportPath(root));
  return reportPath(root);
}

export function readReport(root) {
  try {
    const parsed = JSON.parse(readFileSync(reportPath(root), 'utf8'));
    return parsed?.schema === SCHEMA ? parsed : null;
  } catch {
    return null;   // немає, зіпсований або чужої схеми — просто немає кешу
  }
}

export function readFreshPass(root, key) {
  const report = readReport(root);
  if (!report || report.key !== key) return null;
  if (report.blocking) return null;   // відтворюють лише зелене
  return report;
}
```

Два рішення, яких спека не ухвалює, названо просто в коді:

- **`cacheKey` включає `tier`, `noSkip` і `only`, а не лише `sourceHash`. [РІШЕННЯ]**
  §3.4 каже «ключ — `sourceHash`», але не каже, що робити, коли попередній прогін
  перевіряв менший обсяг. Найменше рішення, яке задовольняє §3.4 і не бреше: різний
  обсяг — різний ключ.
- **Обрізання на 8 КіБ на потік. [РІШЕННЯ]** Спека каже «звіт», але не дає ліміту.
  Без ліміту один провалений `next build` кладе в `.verify/last-run.json` мегабайти,
  які потім читає кожен Stop-гейт.

- [ ] **Крок 5: Написати `scripts/verify/report.d.mts`**

```ts
// Специфікатор рантайму, не декларації — так само, як у run.d.mts задачі 3.
import type { CheckResult, Options } from './run.mjs';

export interface Report {
  schema: 1;
  startedAt: string;
  durationMs: number;
  root: string;
  tier: Options['tier'];
  noSkip: boolean;
  only: string[];
  hash: string;
  fileCount: number;
  reused: boolean;
  key: string;
  blocking: boolean;
  exitCode: 0 | 1;
  results: CheckResult[];
}

export declare function truncateBytes(text: string, maxBytes?: number): string;
export declare function wantsColor(stream: { isTTY?: boolean } | null | undefined, env?: Record<string, string | undefined>): boolean;
export declare function formatTable(results: CheckResult[], opts?: { color?: boolean }): string;
export declare function cacheKey(opts: { hash: string; tier: Options['tier']; noSkip: boolean; only: string[] }): string;
export declare function toReport(input: {
  root: string; tier: Options['tier']; noSkip: boolean; only: string[];
  hash: string; fileCount: number; reused: boolean; blocking: boolean;
  results: CheckResult[];
  startedAt?: number; durationMs?: number;
}): Report;
export declare function writeReport(root: string, report: Report): string;
export declare function readReport(root: string): Report | null;
export declare function readFreshPass(root: string, key: string): Report | null;
```

- [ ] **Крок 6: Підключити звіт у `run.mjs`**

Замінити тимчасовий блок CLI із задачі 3 на остаточний:

```js
if (import.meta.filename === process.argv[1]) {      // R-22
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root ? path.resolve(opts.root) : resolveRoot(process.cwd());
  const startedAt = Date.now();

  const { hash, fileCount } = sourceHash(root);
  const key = cacheKey({ hash, tier: opts.tier, noSkip: opts.noSkip, only: opts.only });

  let report = opts.reuseIfFresh ? readFreshPass(root, key) : null;
  if (report) {
    report = { ...report, reused: true };
  } else {
    // ...opts ПЕРЕД root в обох викликах: в opts є власний root (за замовчуванням
    // null), і зворотний порядок тихо повернув би корінь у null.
    const results = await runAll({ ...opts, root });
    // Вердикт обчислює раннер — тут і лише тут. report.mjs його не виводить.
    const blocking = results.some((r) => isBlocking(r.status, opts.noSkip));
    report = toReport({ ...opts, root, hash, fileCount, reused: false, blocking, results, startedAt, durationMs: Date.now() - startedAt });
    // Пишемо ЗАВЖДИ, навіть коли блокує: Stop-гейт задачі 10 читає саме цей файл,
    // і найцікавіший для нього випадок — червоний.
    writeReport(root, report);
  }

  if (opts.json) {
    // R-16: форма `--json` зафіксована задачею 3 і НЕ розширюється тим, що звіт
    // усередині багатший. Повний звіт (stdout/stderr перевірок, `key`, `schema`,
    // `exitCode`) лежить у `.verify/last-run.json`; на stdout іде рівно контракт.
    process.stdout.write(`${JSON.stringify({
      tier: report.tier,
      root: report.root,
      noSkip: report.noSkip,
      sourceHash: report.hash,
      results: report.results.map((r) => ({
        id: r.id, status: r.status, reason: r.reason, durationMs: r.durationMs,
      })),
    }, null, 2)}\n`);
  } else {
    process.stdout.write(formatTable(report.results, { color: wantsColor(process.stdout) }));
    const source = report.reused ? `відтворено з .verify/last-run.json (hash ${hash.slice(0, 12)}, ${fileCount} файлів)` : `hash ${hash.slice(0, 12)}, ${fileCount} файлів`;
    process.stdout.write(`${source}\n`);
  }
  // exitCode, а не process.exit(): інакше крок 12 (`npm run verify | cat -v`)
  // може загубити хвіст таблиці — запис у трубу асинхронний.
  process.exitCode = report.blocking ? 1 : 0;
}
```

плюс імпорти на початку файлу (`sourceHash` уже імпортовано в задачі 3 — там його
споживає JSON-звіт за R-16; дописується лише другий рядок):

```js
import { cacheKey, formatTable, readFreshPass, toReport, wantsColor, writeReport } from './report.mjs';
```

Напрямок імпорту тут односторонній: `run.mjs → report.mjs`, ніколи навпаки. Саме тому
`isBlocking` лишається в `run.mjs`, а `blocking` передається полем — імпорт `isBlocking`
у `report.mjs` замкнув би цикл модулів між двома файлами, які задача 10 вантажить обидва.

Відтворений прогін **каже, що він відтворений**, і називає хеш. Мовчазне відтворення —
це рядок `PASSED`, який стверджує про дерево, якого ніхто щойно не перевіряв.

- [ ] **Крок 7: Переконатися, що `.verify/` уже ігнорується — і не дописувати другого рядка**

```bash
grep -n '\.verify/' .gitignore; echo "GREP=$?"
```

Очікується: рівно один рядок `/.verify/` і `GREP=0` — його дописала задача 2, крок 7. Другий
рядок (`.verify/` без слеша попереду) **не додається**: він нічого не змінює, а два записи про
одну теку — це вже два місця для однієї угоди. Якщо `GREP=1`, задача 2 свій крок 7 не виконала:
дописати `/.verify/` тут, після рядка `/.claude/settings.local.json`.

Звіт — локальний артефакт прогону, не документ. У репозиторії він давав би конфлікти
на кожному злитті й ніколи не був би правдою більш ніж для однієї машини.

- [ ] **Крок 8: Тести мають пройти**

```bash
npx playwright test --project=unit
```

Очікується: `35 passed` (5 із `hash.spec.ts` + 19 із `run.spec.ts` + 11 із
`report.spec.ts`). Червоний тест межі з кроку 2 означає, що
`formatTable` десь виводить статус із `exitCode` — лагодити `report.mjs`, не тест.

- [ ] **Крок 9: Приймання — звіт існує і має форму, яку читатиме задача 10**

```bash
npm run verify
head -20 .verify/last-run.json
node --input-type=module -e "const j=JSON.parse(await (await import('node:fs/promises')).readFile('.verify/last-run.json','utf8'));console.log(j.schema,j.blocking,j.exitCode,j.results.length,j.hash.length)"
```

Очікується: таблиця з трьох рядків із тривалостями; далі `1 false 0 3 64`.
`hash.length === 64` — це sha256 із задачі 2, а не випадковий рядок; `blocking === false`
при трьох `PASSED` — це `isBlocking` із задачі 3, а не окрема думка звіту.

- [ ] **Крок 10: Приймання — кеш справді відтворює, і видно з таблиці**

```bash
time npm run verify
time npm run verify -- --reuse-if-fresh
```

Очікується: перший прогін — секунди (typecheck + lint + unit); другий — помітно швидший,
і його останній рядок містить `відтворено з .verify/last-run.json`. Якщо другий прогін
триває стільки ж — `--reuse-if-fresh` не спрацював; якщо він швидкий, але **не каже**,
що відтворений, — помилка гірша за перший випадок.

- [ ] **Крок 11: Приймання — зміна коду ламає свіжість (регресія на C-01)**

Це той крок, який ловить найдорожчу помилку всього шару: перелік джерел, що не бачить
`src/`. Після переїзду на FSD там лежить дев'ять із одинадцяти файлів коду.

```bash
printf '\n// тимчасова зміна для перевірки свіжості\n' >> src/shared/config/map.ts
npm run verify -- --reuse-if-fresh
git checkout -- src/shared/config/map.ts
npm run verify -- --reuse-if-fresh
```

Очікується: другий прогін (після правки) **не** містить «відтворено» — він біжить наново
й друкує інший `hash`. Третій (після відкату) містить «відтворено» і той самий хеш, що й
перший.

**Якщо після правки `src/shared/config/map.ts` прогін усе одно каже «відтворено» — це не
дрібниця кешу.** Це означає, що `SOURCE_PREFIXES` задачі 2 не містить `src/`, тобто весь
шар перевірки сліпий до дев'яти з одинадцяти файлів коду, а Stop-гейт задачі 10 
відтворюватиме зелене крізь будь-яку правку. Зупинитися і полагодити задачу 2.

Для певності те саме на файлі в `app/`:

```bash
printf '\n' >> app/page.tsx && npm run verify -- --reuse-if-fresh && git checkout -- app/page.tsx
```

- [ ] **Крок 12: Приймання — колір, `NO_COLOR` і труба**

```bash
if npm run verify | cat -v | grep -q '\^\['; then echo "ANSI у трубі — ПОМИЛКА"; else echo "ANSI не знайдено — правильно"; fi
NO_COLOR=1 npm run verify | grep -E 'PASSED|SKIPPED'
```

`if`, а не `grep -c … || echo`: `grep -c` друкує `0` **і** виходить з кодом 1, тож
гілка `||` спрацьовувала б завжди, а в терміналі з'являлися б обидва рядки — крок,
який «проходить» і при зламаній поведінці, нічого не доводить.

Очікується: перший рядок друкує `ANSI не знайдено — правильно` (вивід у трубу не є TTY);
другий показує статуси звичайним текстом. У живому терміналі (без труби) статуси кольорові —
це перевіряється оком і в цьому кроці не доводиться; доводиться саме те, що **без** кольору
`SKIPPED` і `PASSED` лишаються двома різними словами.

- [ ] **Крок 13: Приймання — зіпсований кеш не перетворюється на збій**

```bash
printf '{ зіпсовано' > .verify/last-run.json
npm run verify -- --reuse-if-fresh; echo "EXIT=$?"
```

Очікується: звичайний прогін, три `PASSED`, `EXIT=0`, жодного `UNRUNNABLE` і жодного
стектрейсу. Кеш — оптимізація; зіпсована оптимізація коштує один прогін, а не правду.

- [ ] **Крок 14: Приймання — статус, не код виходу (наскрізно)**

```bash
npx playwright test --project=e2e --list >/dev/null 2>&1; echo "probe exit=$?"
npm run verify:full; echo "EXIT=$?"
npm run verify:checkpoint; echo "EXIT=$?"
```

Очікується: `verify:full` — `SKIPPED e2e — 0 тестів написано` і `EXIT=0`;
`verify:checkpoint` — той самий `SKIPPED` і `EXIT=1`.

Один і той самий рядок, два різні коди виходу — це і є `isBlocking(status, noSkip)`
зі спеки §5, побачене наскрізно. Якщо `verify:checkpoint` дає `0` — `--no-skip` не
доходить до `isBlocking`, і найсуворіший режим шару тихо вимкнено.

- [ ] **Крок 15: Перезапустити всі три успадковані зелені (R-09)**

```bash
source ~/.nvm/nvm.sh && nvm use \
  && npm run check-types \
  && npm run lint \
  && npx playwright test --project=unit
git status --porcelain
```

Усі три — вихід `0`. `git status --porcelain` не показує ні
`.verify/last-run.json`, ні змін у `src/` чи `app/` — кроки 11 і 13 прибрали за собою.

- [ ] **Крок 16: Коміт**

```bash
git add scripts/verify/report.mjs scripts/verify/report.d.mts \
        scripts/verify/run.mjs tests/unit/report.spec.ts
git commit -m "feat(verify): таблиця, JSON-звіт і кеш свіжості

report.mjs подає і зберігає, але НЕ ухвалює статусів. Тест межі подає
йому навмисно суперечливий результат (FAILED при exitCode 0) і вимагає
надрукувати FAILED: форматувальник, який «виправляє» статус, робить
п'ять статусів декоративними.

Без кольору п'ять статусів лишаються п'ятьма різними словами. SKIPPED,
який читається як PASSED, — рівно та помилка, проти якої будувався шар.

Ключ кешу — не лише sourceHash, а ще рівень, --no-skip і --only:
зелений fast нічого не доводить про build та e2e, і відтворювати його
для --tier full означало б збрехати про обсяг перевіреного.

Відтворений прогін друкує, що він відтворений, і називає хеш. Мовчазне
відтворення — це PASSED про дерево, якого щойно ніхто не перевіряв.

Зіпсований .verify/last-run.json дає null, а не виняток: кеш —
оптимізація, і його поломка має коштувати один зайвий прогін,
а не перетворити весь verify на UNRUNNABLE.

Обрізання виводу — за байтами через StringDecoder. String.slice рахує
кодові одиниці UTF-16, тож на українському тексті ліміт удвічі
завищується, а обрізаний хвіст стає U+FFFD.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

`.gitignore` у переліку немає навмисно: рядок `/.verify/` комітить задача 2, і крок 7 тут його
лише звіряє. Якщо крок 7 показав `GREP=1` і рядок довелося дописати, додати `.gitignore` до
`git add` — інакше звіти шару поїдуть у передачу.

---

## Спільний контракт трьох перевірок

Діє на задачі 5, 6, 7 однаково; записаний тут один раз, щоб не розійтися в трьох копіях.

- **Виклик:** `node scripts/verify/checks/<id>.mjs [root]`. Корінь — перший аргумент,
  що не починається з `-`; за його відсутності `process.cwd()`.
  Аргумент потрібен двічі: тестам (фікстура в тимчасовій теці) і хукам —
  `stop-gate.mjs` мусить передати корінь **активного worktree**, а не
  `$CLAUDE_PROJECT_DIR` (знахідка F-1 у `recon-external-facts.md`). Перевірка, що
  зашила б корінь усередину, зробила б це неможливим.
- **Коди виходу:** `0` — чисто; `1` — знайдено порушення; **будь-який інший** — перевірка
  сама не змогла запуститися. Розрізнення не косметичне: спека §3.2 вимагає, щоб
  `run.mjs` відрізнив `FAILED` від `UNRUNNABLE`, і єдине, з чого він це дізнається, —
  код виходу.
- **Потоки:** порушення — у `stdout`, по рядку на порушення; власні збої перевірки — у
  `stderr`. Останній рядок `stdout` — завжди підсумок українською.
- **Джерело списку файлів:** `listRepoFiles(root)` із `scripts/verify/hash.mjs` —
  той самий `git ls-files -c -o --exclude-standard -z`, що годує хеш свіжості.
  Обхід дерева заборонений: у головному checkout він зайшов би в `reference/`
  (532 сторонні `.ts`/`.tsx`, `fsd-documentation/.git` — 407 МБ), а `--exclude-standard`
  відсікає її безкоштовно, бо `/reference/` є в `.gitignore`.

---

### Task 5: `checks/no-ref-imports.mjs` — жодного імпорту з `reference/`

Заборона записана у двох `CLAUDE.md` тричі й досі не стережеться нічим, крім уважності.
Задача перша з трьох структурних, бо дає спільний механізм — перелік файлів і сканер
літеральних специфікаторів, — яким користуються задачі 6 і 7.

**Files:**
- Modify: `scripts/verify/hash.mjs` (додати експорт `listRepoFiles`)
- Modify: `scripts/verify/hash.d.mts` (**один дописаний рядок** — R-08: файл створює
  задача 2, тут до нього додається лише декларація `listRepoFiles`)
- Modify: `tests/unit/hash.spec.ts` (тест на `listRepoFiles`)
- Create: `tests/unit/support/check-fixtures.ts`
- Create: `scripts/verify/checks/no-ref-imports.mjs`
- Create: `scripts/verify/checks/no-ref-imports.d.mts` (R-08: тест імпортує
  `scanForRefImports` із `.ts`, тож без декларацій це `TS7016`)
- Test: `tests/unit/no-ref-imports.spec.ts`
- Modify: `scripts/verify/registry.mjs` (додати рядок `no-ref-imports`)

**Interfaces:**
- Consumes: `listRepoFiles` не існує до цієї задачі — вона його й заводить;
  `isSourcePath`, `listSourceFiles`, `sourceHash` із задачі 2; `CHECKS` із задачі 3;
  Playwright-проєкт `unit` із задачі 1.
- Produces:
  - `listRepoFiles(root: string): string[]` у `hash.mjs` — усі передані файли, відсортовані
  - один дописаний рядок у `scripts/verify/hash.d.mts` (R-08)
  - `tests/unit/support/check-fixtures.ts`: `checkPath`, `runCheck`, `makeFixtureDir`,
    `makeFixtureRepo`, `writeFixtureFiles`, `removeFixture` — задачі 6 і 7 імпортують їх
    дослівно. Фікстури живуть у `os.tmpdir()`, ніколи у відстежуваних файлах (R-12).
  - `scripts/verify/checks/no-ref-imports.mjs` — **чиста функція** `scanForRefImports(root)`
    плюс тонка CLI-обгортка за спільним контрактом вище (R-12). Поведінку перевіряють
    тести, що імпортують функцію; `runCheck` лишається рівно для одного тесту на
    перевірку — того, що стереже коди виходу, бо саме їх читає `run.mjs`.
  - `scripts/verify/checks/no-ref-imports.d.mts` — декларації до неї
  - рядок реєстру з `id: 'no-ref-imports'`

- [ ] **Крок 1: Тест на `listRepoFiles` — спершу падаючий**

У `tests/unit/hash.spec.ts` дописати, не чіпаючи наявних п'яти тестів, і додати
`listRepoFiles` до наявного рядка `import`:

```ts
test('listRepoFiles віддає весь периметр передачі, а не лише джерела', () => {
  const root = makeRepo();
  try {
    const all = listRepoFiles(root);
    // Ширше за listSourceFiles: README.md — переданий файл, але не джерело.
    expect(all).toContain('README.md');
    expect(all).toContain('app/page.tsx');
    // .gitignore поважається: ігноровані файли не передаються й тут не з'являються.
    expect(all).not.toContain('secret.txt');
    // listSourceFiles — це фільтр над тим самим переліком, не другий запит до git.
    expect(listSourceFiles(root)).toEqual(all.filter(isSourcePath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: падіння з `listRepoFiles is not a function` (або `TS2305` на імпорті) —
тобто причина названа саме та. Якщо падіння інше — перевіряти його, а не йти далі.

- [ ] **Крок 2: Винести перелік файлів у `listRepoFiles`**

У `scripts/verify/hash.mjs` замінити тіло `listSourceFiles` на фільтр і підняти запит до
git на рівень вище — **один** виклик git на весь шар, а не по одному в кожній перевірці:

```js
/**
 * Усі файли, що входять у передачу: відстежені (-c) плюс невідстежені, але не
 * ігноровані (-o --exclude-standard). Саме це отримає клієнт із `git clone`, і саме
 * це сканують перевірки `no-ref-imports` і `no-secrets`.
 */
export function listRepoFiles(root) {
  // -z обов'язковий: без нього git лапкує й екранує шляхи зі спецсимволами,
  // і список тихо розсинхронізується з диском.
  const raw = execFileSync(
    'git',
    ['ls-files', '-c', '-o', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  return raw.split('\0').filter((relPath) => relPath !== '').sort();
}

export function listSourceFiles(root) {
  return listRepoFiles(root).filter(isSourcePath);
}
```

Далі — `scripts/verify/hash.d.mts`. **Файл уже існує:** його створює задача 2, крок 4
(R-08 — кожен `.mjs`, який імпортує `.ts`-тест, отримує сусідній `.d.mts` від тієї задачі,
що створила `.mjs`). Тут дописується **рівно один рядок** — декларація новоствореного
експорту, поруч із п'ятьма наявними:

```ts
export declare function listRepoFiles(root: string): string[];
```

Якщо `check-types` дає `TS7016` на `hash.mjs` — файл не створила задача 2; повернутися
туди й полагодити її крок 4, а не переписувати декларації тут.

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npx playwright test --project=unit
```

Очікується: `check-types` — тиша, вихід `0` (декларація й реалізація зійшлися);
`36 passed` — тридцять п'ять із задачі 4 (5 у `hash.spec.ts`, 19 у `run.spec.ts`,
11 у `report.spec.ts`) плюс новий. Якщо впав котрийсь із п'яти старих тестів хеша —
фільтр змінив поведінку `listSourceFiles`, і це регресія, а не «оновити очікування».

- [ ] **Крок 3: Написати спільні помічники для тестів перевірок**

`tests/unit/support/check-fixtures.ts` — `.ts` без `.spec`, тож `testMatch:
'unit/**/*.spec.ts'` його не збирає як тест, а `tsconfig.json` усе одно типізує.

```ts
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface CheckResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Playwright запускає тести з теки, де лежить `playwright.config.ts`, тобто з кореня
 * репозиторію. Якщо це колись перестане бути правдою, тест мусить сказати «скрипта
 * немає», а не «перевірка впала»: підміна причини — рівно те, від чого весь шар.
 */
export function checkPath(fileName: string): string {
  const full = path.resolve(process.cwd(), 'scripts/verify/checks', fileName);
  if (!existsSync(full)) {
    throw new Error(`Скрипта перевірки немає за шляхом ${full} (cwd: ${process.cwd()})`);
  }
  return full;
}

/** Запускає перевірку тим самим інтерпретатором, що й Playwright — без оболонки. */
export function runCheck(fileName: string, ...args: string[]): CheckResult {
  const result = spawnSync(process.execPath, [checkPath(fileName), ...args], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

export function writeFixtureFiles(root: string, files: Record<string, string>): void {
  for (const [relPath, contents] of Object.entries(files)) {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

/** Тека без git — для перевірок, що читають лише конкретний файл. */
export function makeFixtureDir(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-check-'));
  writeFixtureFiles(root, files);
  return root;
}

/** Справжній git-репозиторій: `--exclude-standard` — саме те, що має працювати. */
export function makeFixtureRepo(files: Record<string, string>): string {
  const root = makeFixtureDir(files);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

export function removeFixture(root: string): void {
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Крок 4: Написати падаючий тест перевірки**

**Спершу — пастка, в яку цей тест впаде, якщо написати його прямо.** Файл
`tests/unit/no-ref-imports.spec.ts` лежить під префіксом `tests/`, тобто **всередині
периметра власної перевірки**. Літерал `import x from '../../../reference/geodesy/dms.js'`
у фікстурі — синтаксично та сама форма, що й порушення, тож на кроці 6 перевірка знайшла б
дев'ять порушень у власному тесті на чистому дереві. Реакція «ну вона ж працює» тут
хибна: зелене на чистому дереві — це і є те, що доводить крок 6.

Тому специфікатори фікстур **збираються з частин**, як і синтетичний ключ у задачі 6:
жоден рядок цього файлу не містить цілої форми, а в момент запису у фікстуру рядок
стає справжнім. Поіменний виняток (`SELF_DESCRIBING`, як у задачі 6) тут теж спрацював
би, але коштував би дірки — цілий файл тестів поза скануванням; збірка з частин
не коштує нічого.

`tests/unit/no-ref-imports.spec.ts`:

```ts
import { rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { scanForRefImports } from '../../scripts/verify/checks/no-ref-imports.mjs';
import {
  makeFixtureRepo,
  removeFixture,
  runCheck,
  writeFixtureFiles,
} from './support/check-fixtures';

const CHECK = 'no-ref-imports.mjs';

/** Зручність: у якому файлі:рядку знайдено порушення. */
const at = (violations: { file: string; line: number }[]): string[] =>
  violations.map((v) => `${v.file}:${v.line}`);

/**
 * Префікс шляху до study material, зібраний із сегментів. Цілого рядка
 * `…/reference/…` у цьому файлі немає навмисно — інакше сам файл тесту став би
 * порушенням, яке перевірка знайде на справжньому дереві (крок 6).
 */
const REF = ['..', '..', '..', 'reference', 'geodesy'].join('/');
const REF_DEEP = `../${REF}`;

/** Чистий зліпок сьогоднішнього репозиторію: FSD під src/, тонкий вхід під app/. */
const CLEAN_FILES: Record<string, string> = {
  // Саме слово `reference` у рядку — не порушення: сканер шукає форму імпорту,
  // а не підрядок. Розбирати на частини треба лише специфікатори.
  '.gitignore': '/reference/\n',
  'package.json': '{"name":"t"}\n',
  'app/page.tsx': "export { HomePage as default } from '@/_pages/home';\n",
  'src/_pages/home/index.ts': "export { HomePage } from './ui/home-page';\n",
  'src/shared/config/map.ts': 'export const INITIAL_VIEW = { zoom: 10 };\n',
  'src/_pages/home/ui/home-page.module.css': "@import './base.css';\n",
  'scripts/verify/hash.mjs': "import path from 'node:path';\n",
  'tests/e2e/select.spec.ts': "import { test } from '@playwright/test';\n",
  // Хибне спрацювання, якого не має бути: тека зветься references, у множині.
  // Цей літерал лишається цілим свідомо — він і має не збігтися.
  'src/shared/lib/docs.ts': "import x from '../../../docs/references/layer-structure';\n",
};

test('чистий репозиторій проходить, і периметр не порожній', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    const { files, violations } = scanForRefImports(root);
    expect(violations).toEqual([]);
    // Нуль перевірених файлів — це не «чисто», це зламаний периметр.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('src/_pages/home/index.ts');
  } finally {
    removeFixture(root);
  }
});

test('ловить усі шість статичних форм — і називає file:line', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/lib/bad.ts': [
      `import type { LatLon } from '${REF}/latlon-spherical.js';`,
      `export { Dms } from '${REF}/dms.js';`,
      `import '${REF}/side-effect.js';`,
      `const lazy = () => import('${REF}/lazy.js');`,
      `const legacy = require('${REF}/legacy.js');`,
      `/// <reference path="${REF}/types.d.ts" />`,
    ].join('\n') + '\n',
  });
  try {
    const { violations } = scanForRefImports(root);
    expect(violations).toHaveLength(6);
    expect(at(violations).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((line) => `src/shared/lib/bad.ts:${line}`).sort(),
    );
    expect(new Set(violations.map((v) => v.form)).size).toBe(6);
  } finally {
    removeFixture(root);
  }
});

test('бачить код застосунку під src/, а не лише під app/', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/_pages/home/ui/leaflet-map.tsx':
      `import { bearing } from '${REF_DEEP}/latlon-spherical.js';\n`,
  });
  try {
    const { violations } = scanForRefImports(root);
    expect(at(violations)).toEqual(['src/_pages/home/ui/leaflet-map.tsx:1']);
  } finally {
    removeFixture(root);
  }
});

test('відпускає після відкоту — порушення прибрано, знову зелено', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, {
      'src/shared/lib/bad.ts': `import x from '${REF}/dms.js';\n`,
    });
    expect(scanForRefImports(root).violations).toHaveLength(1);

    rmSync(path.join(root, 'src/shared/lib/bad.ts'));
    expect(scanForRefImports(root).violations).toEqual([]);
  } finally {
    removeFixture(root);
  }
});

test('ігнорований git-ом файл не сканується — периметр той самий, що в хеша', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'reference/geodesy/latlon-spherical.js': `import own from '${['..', 'reference', 'dms.js'].join('/')}';\n`,
  });
  try {
    // /reference/ у .gitignore фікстури, тож git ls-files --exclude-standard
    // її не поверне. Інакше перевірка сканувала б 532 сторонні файли.
    const { files, violations } = scanForRefImports(root);
    expect(violations).toEqual([]);
    expect(files.some((f) => f.startsWith('reference/'))).toBe(false);
  } finally {
    removeFixture(root);
  }
});

/**
 * Єдиний тест через підпроцес. Він стереже не поведінку — її стережуть п'ять тестів
 * вище, — а КОНТРАКТ КОДІВ ВИХОДУ: `run.mjs` відрізняє FAILED від UNRUNNABLE рівно
 * за ними, і більше нізвідки цього не дізнається.
 */
test('CLI: 0 на чистому дереві, 1 на порушенні', () => {
  const clean = makeFixtureRepo(CLEAN_FILES);
  const dirty = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/lib/bad.ts': `import x from '${REF}/dms.js';\n`,
  });
  try {
    const ok = runCheck(CHECK, clean);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('порушень немає');

    const bad = runCheck(CHECK, dirty);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain('src/shared/lib/bad.ts:1:');
    expect(bad.stdout).toContain('файлів із порушеннями — 1');
  } finally {
    removeFixture(clean);
    removeFixture(dirty);
  }
});
```

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: увесь файл `no-ref-imports.spec.ts` падає на завантаженні —
`Cannot find module '../../scripts/verify/checks/no-ref-imports.mjs'` — тобто саме з тієї
причини, що модуля ще немає, а не з якоїсь іншої. `npm run check-types` у цей момент теж
червоний (`TS2307`), і це очікувано. Шість тестів хеша лишаються зеленими.

- [ ] **Крок 5: Написати `scripts/verify/checks/no-ref-imports.mjs`**

```js
// Стереже правило з CLAUDE.md і reference/CLAUDE.md: «Never `import` from
// `../reference/...`, in app code or tests, at runtime or at type level».
// Записане тричі, не стережене нічим — саме той «documented-but-unenforced»
// інваріант, заради якого спека §4 завела три власні рядки.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listRepoFiles } from '../hash.mjs';

/**
 * Теки, чий код узагалі може щось імпортувати.
 * `src/` — усі шари FSD (_app, _pages, shared); після переїзду на FSD тут дев'ять
 * із одинадцяти файлів застосунку, і без цього префікса перевірка їх не бачить.
 * `app/` — тонкий вхід Next.js App Router, теж справжній код.
 * `scripts/` і `.claude/hooks/` ширші за букву спеки («файл застосунку чи тестів»):
 * скрипт перевірки, що імпортує з reference/, зіпсував би передачу так само.
 */
const SCAN_PREFIXES = ['src/', 'app/', 'tests/', 'scripts/', '.claude/hooks/'];

const SCAN_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  // @import у CSS так само вміє вказати за межі проєкту.
  '.css',
];

/** Літеральний специфікатор у лапках будь-якого з трьох видів. */
const SPECIFIER = String.raw`(['"\`])([^'"\`\n]*)\1`;

/**
 * Шість статичних форм. Обчислений шлях сюди не потрапляє за визначенням —
 * це записано в blindSpot рядка реєстру й не лікується тут.
 */
const FORMS = [
  { name: 'import-from', re: new RegExp(String.raw`\b(?:import|export)\b[^;\n]*?\bfrom\s*` + SPECIFIER, 'g') },
  { name: 'import-bare', re: new RegExp(String.raw`\bimport\s+` + SPECIFIER, 'g') },
  { name: 'import-dynamic', re: new RegExp(String.raw`\bimport\s*\(\s*` + SPECIFIER, 'g') },
  { name: 'require', re: new RegExp(String.raw`\brequire\s*\(\s*` + SPECIFIER, 'g') },
  { name: 'triple-slash', re: new RegExp(String.raw`///\s*<reference\s+[^>\n]*?path\s*=\s*` + SPECIFIER, 'g') },
  { name: 'css-import', re: new RegExp(String.raw`@import\s+(?:url\(\s*)?` + SPECIFIER, 'g') },
];

/**
 * Прив'язка до СЕГМЕНТА шляху, не до підрядка. Інакше перевірка спрацювала б на
 * `.claude/skills/feature-sliced-design/references/…` — тека `references`, у множині,
 * і жодного стосунку до study material не має.
 */
function pointsAtReference(specifier) {
  return specifier.replace(/\\/g, '/').split('/').includes('reference');
}

export function scanText(relPath, text) {
  const violations = [];

  text.split('\n').forEach((line, index) => {
    for (const form of FORMS) {
      form.re.lastIndex = 0;
      let match = form.re.exec(line);
      while (match !== null) {
        if (pointsAtReference(match[2])) {
          violations.push({ file: relPath, line: index + 1, form: form.name, specifier: match[2] });
        }
        match = form.re.exec(line);
      }
    }
  });

  return violations;
}

/**
 * Чиста функція за R-12: бере корінь, повертає перевірені файли й порушення.
 * Нічого не друкує й нічим не виходить. Тести імпортують саме її й запускають на
 * фікстурі в `os.tmpdir()` — не через підпроцес: фікстура-літерал у відстеженому
 * `.spec.ts` зробила б цю ж перевірку червоною на власному тесті.
 */
export function scanForRefImports(root) {
  const files = listRepoFiles(root).filter(
    (relPath) => SCAN_PREFIXES.some((prefix) => relPath.startsWith(prefix))
      && SCAN_EXTENSIONS.includes(path.extname(relPath)),
  );

  const violations = [];
  for (const relPath of files) {
    violations.push(...scanText(relPath, readFileSync(path.join(root, relPath), 'utf8')));
  }

  return { files, violations };
}

function main() {
  const root = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const { files, violations } = scanForRefImports(root);

  for (const item of violations) {
    process.stdout.write(`${item.file}:${item.line}: ${item.form} → ${item.specifier}\n`);
  }

  if (violations.length === 0) {
    process.stdout.write(`no-ref-imports: перевірено файлів — ${files.length}, порушень немає.\n`);
    process.exit(0);
  }

  const affected = new Set(violations.map((item) => item.file)).size;
  process.stdout.write(
    `no-ref-imports: порушень — ${violations.length}, файлів із порушеннями — ${affected}.\n`,
  );
  process.exit(1);
}

// Коментарі й рядки не вирізаються навмисно: перебір безпечний, недобір — ні.
// Закоментований import із reference/ усе одно вартий того, щоб його побачили.
//
// Вхідна варта (R-22) тут обов'язкова, а не косметична: за R-12 тести імпортують
// `scanForRefImports` із цього ж файлу, і без варти імпорт запускав би `main()`
// із `process.exit()` посеред тестового процесу.
if (import.meta.filename === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`no-ref-imports: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
```

- [ ] **Крок 5а: Написати `scripts/verify/checks/no-ref-imports.d.mts` (R-08)**

```ts
// Ручні декларації: tsconfig має allowJs: false, тож імпорт цього .mjs із .spec.ts —
// TS7016. Тримати синхронно з експортами руками; розбіжність ловить `check-types`.
export interface RefImportViolation {
  file: string;
  line: number;
  form: string;
  specifier: string;
}

export declare function scanText(relPath: string, text: string): RefImportViolation[];
export declare function scanForRefImports(root: string): {
  files: string[];
  violations: RefImportViolation[];
};
```

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: `42 passed` — тридцять шість попередніх і шість нових. Зокрема тест
«бачить код застосунку під src/» доводить, що периметр покриває FSD: без префікса
`src/` він падає, і це єдиний тест, який його стереже.

- [ ] **Крок 6: Прогнати перевірку на справжньому дереві**

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/checks/no-ref-imports.mjs; echo "EXIT=$?"
```

Очікується: `порушень немає` і `EXIT=0`. Число перевірених файлів — не нуль і не
одиниця: сьогодні це щонайменше дев'ять файлів `src/`, два `app/`, плюс `scripts/verify/`
і `tests/`. **Нуль перевірених файлів — це провал кроку, а не успіх:** він означає, що
`git ls-files` не повернув нічого (не той корінь) або що жоден префікс не збігся.

Далі — навмисний злам, бо спека §12 фаза 3 вимагає саме його, а не огляду коду:

```bash
source ~/.nvm/nvm.sh && nvm use
printf "%s\n" "import { x } from '../../../reference/geodesy/dms.js';" >> src/shared/config/map.ts
node scripts/verify/checks/no-ref-imports.mjs; echo "EXIT=$?"
git checkout -- src/shared/config/map.ts
node scripts/verify/checks/no-ref-imports.mjs; echo "EXIT=$?"
git diff --stat src/shared/config/map.ts
```

`src/shared/config/map.ts` — відстежений файл, тож `git checkout --` його справді
відкотить; для нового файлу цей рядок нічого не зробив би, і відкат треба було б робити
через `rm`. Останній рядок це й доводить: `git diff --stat` мусить бути порожнім.

Очікується: перший прогін — рядок `src/shared/config/map.ts:<N>: import-from → …` і
`EXIT=1`; після відкоту — `порушень немає` і `EXIT=0`. Це і є критерій фази 3
дослівно: «ловить навмисно внесене порушення й відпускає після відкоту».

- [ ] **Крок 7: Додати рядок у реєстр**

У `scripts/verify/registry.mjs`, у масив `CHECKS` рівня `fast`:

```js
  {
    id: 'no-ref-imports',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/no-ref-imports.mjs',
    needs: [],
    after: [],
    proves:
      'Жоден файл застосунку чи тестів не має `import`/`require` із `reference/` — '
      + 'ні в рантаймі, ні на рівні типів',
    // Спека §4 дає перші два речення дослівно. Решта дописана тому, що §3.1 забороняє
    // blindSpot вужчий за реальний пропуск, а ці три діри реальні.
    blindSpot:
      'Тільки статичні літерали шляхів. Шлях, зібраний обчисленням у рантаймі, невидимий. '
      + 'Аліас у `paths` з `tsconfig.json`, що вказує на `reference/`, дав би імпорт, '
      + 'якого цей сканер не бачить. Файли, ігноровані git-ом, не скануються. '
      + 'Розширення поза списком (напр. `.json`, `.scss`) не читаються взагалі. '
      + 'Периметр сканування (`scripts/`) ширший за периметр хеша свіжості '
      + '(`scripts/verify/`): файл під `scripts/other/` змінює вердикт цієї перевірки, '
      + 'не змінюючи ключа свіжості, тож `--reuse-if-fresh` віддасть старий результат',
  },
```

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/run.mjs --tier fast
```

Очікується: у таблиці з'явився рядок `no-ref-imports` зі статусом `PASSED`, і код
виходу раннера — `0`. Якщо статус `UNRUNNABLE` — `cmd` не резолвиться з кореня
репозиторію; це помилка шляху, не перевірки.

- [ ] **Крок 8: Перезапустити всі успадковані зелені**

Задача, що додає файли, зобов'язана перезапустити все, що застала зеленим — інакше
дефект у стилі C-02 (`TS7016` від нового імпорту) лишається невидимим до наступної задачі.

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
```

Очікується: три виходи `0`. Ймовірне місце падіння — `lint`: `eslint .` уперше бачить
`scripts/verify/checks/*.mjs`. Якщо він скаржиться на `process`/`Buffer` як на невизначені
(`no-undef`) — це дефект блоку Node-глобалів у `eslint.config.mjs`, власником якого за R-10
є **задача 1**. Повернутися туди й дописати відсутній глобаль до літерального об'єкта;
вимикати саме правило — не можна, і другого блоку тут не заводиться. Ця задача
`eslint.config.mjs` не змінює.

- [ ] **Крок 9: Коміт**

```bash
git add scripts/verify/hash.mjs scripts/verify/hash.d.mts scripts/verify/registry.mjs \
        scripts/verify/checks/no-ref-imports.mjs \
        scripts/verify/checks/no-ref-imports.d.mts \
        tests/unit/hash.spec.ts tests/unit/no-ref-imports.spec.ts \
        tests/unit/support/check-fixtures.ts
git status --short   # у списку не має бути нічого незакомічуваного з цієї задачі
git commit -m "feat(verify): перевірка «жодного імпорту з reference/»

Заборона записана у двох CLAUDE.md тричі й досі трималася на уважності.
Тепер її стереже рядок реєстру, а не звичка.

Периметр покриває src/ — після переїзду на FSD там дев'ять із одинадцяти
файлів застосунку, і перевірка, що дивиться лише в app/, не бачила б код.

Матчер прив'язаний до сегмента шляху, не до підрядка: тека references/
у множині — це вендорена документація скілів, а не study material.

Специфікатори у фікстурах зібрані з сегментів: файл тесту лежить під
tests/, тобто всередині власного периметра, і цілий літерал зробив би
його порушенням, яке перевірка знаходить на чистому дереві.

listRepoFiles піднято в hash.mjs, щоб перевірки й ключ свіжості не
розходилися в питанні «які файли існують».

Перевірка експортує чисту функцію scanForRefImports(root), і тести
викликають саме її: підпроцес лишився рівно для одного тесту — того,
що стереже коди виходу, бо їх читає run.mjs.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `checks/no-secrets.mjs` — жодного ключа у переданих файлах

`CLAUDE.md`: «The AISStream key must not reach source, delivered files, or the screen —
the client checks the handed-over files for it during acceptance». Перевірка має прямий
наслідок на прийманні, і вона єдина, чий **звіт сам може порушити правило, яке охороняє**.

**Files:**
- Create: `scripts/verify/checks/no-secrets.mjs`
- Create: `scripts/verify/checks/no-secrets.d.mts` (R-08)
- Test: `tests/unit/no-secrets.spec.ts`
- Modify: `scripts/verify/registry.mjs` (додати рядок `no-secrets`)

**Interfaces:**
- Consumes: `listRepoFiles` із `hash.mjs` (задача 5); `runCheck`, `makeFixtureRepo`,
  `writeFixtureFiles`, `removeFixture` із `tests/unit/support/check-fixtures.ts` (задача 5);
  `CHECKS` із задачі 3.
- Produces: `scripts/verify/checks/no-secrets.mjs` за спільним контрактом;
  чиста функція `scanForSecrets(root)` і `scanLine(line: string)` — тести імпортують їх
  (R-12); `scripts/verify/checks/no-secrets.d.mts`; рядок реєстру з `id: 'no-secrets'`.

**Периметр — рішення, яке треба сказати вголос (R-14).** «Файли, що потрапляють до
передачі» — це **репозиторій**, не бандл браузера. У словнику цього проєкту «клієнт» —
навчальний центр-замовник; `blindSpot` у спеці §4 підтверджує («Ігноровані git-ом файли не
скануються — **і не передаються**»). Периметр «бандл» був би вужчим і не покрив би
`docs/`, `.claude/`, `scripts/`, які клієнт отримує й читає.

Периметр = текстові файли з `git ls-files -c -o --exclude-standard`, **мінус**:
`package-lock.json`, `skills-lock.json`, `.claude/skills/**`, `.agents/skills/**`, і
будь-який файл із NUL-байтом у перших 8 КіБ (бінарний). Причина не косметична:
без цих винятків перевірка червона в перший же день — 62 рядки `"integrity": "sha512-…"`,
два 64-символьні `computedHash` і чотири відстежені `.png`. **Перевірка, червона від
не-секретів, — це перевірка, яку вимикають**, і тоді вона не охороняє нічого. Кожен виняток
названо вголос у `blindSpot` рядка реєстру: діра, яку видно, — не те саме, що діра, якої
немає, але друге тут недосяжне.

- [ ] **Крок 1: Написати падаючий тест — і спершу вирішити, як він не надрукує секрет**

Правило Global Constraints: «`no-secrets` звітує `file:line` + назву шаблону + довжину
збігу. **Ніколи сам збіг, навіть частково.**» Тест зобов'язаний тримати те саме правило,
інакше він переносить проблему з перевірки в тест. Тому фікстура — **синтетичний рядок,
що збігається з шаблоном і секретом не є**, складений із частин, щоб цілого літерала не
було ні в файлі тесту, ні у виводі; а центральне твердження тесту — **заперечне**.

`tests/unit/no-secrets.spec.ts`:

```ts
import { rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { scanForSecrets } from '../../scripts/verify/checks/no-secrets.mjs';
import {
  makeFixtureRepo,
  removeFixture,
  runCheck,
  writeFixtureFiles,
} from './support/check-fixtures';

const CHECK = 'no-secrets.mjs';

/**
 * Синтетичний рядок форми AWS access key id: збігається з шаблоном, секретом не є.
 * Складений із частин навмисно — цілого літерала немає у файлі, тож навіть випадковий
 * grep по тестах нічого схожого на ключ не знайде. Довжина рівно 20.
 */
const SYNTHETIC = ['AKIA', 'N'.repeat(8), 'OTREAL00'].join('');

/**
 * Синтетичний URL із креденшелами. Зібраний із семи частин так, що жодного
 * фрагмента форми «схема://користувач:пароль@» у цьому файлі немає — ні цілим
 * рядком, ні в двох сусідніх. Це вимога R-13 і водночас умова того, що сам цей
 * файл (він відстежений, тобто в периметрі) лишається чистим.
 */
const SYNTHETIC_URL = ['https', '://', 'ci', ':', 'x'.repeat(24), '@', 'registry.example/next.tgz'].join('');

const CLEAN_FILES: Record<string, string> = {
  '.gitignore': '.env*\n',
  'package.json': '{"name":"t"}\n',
  'src/shared/config/map.ts': 'export const INITIAL_VIEW = { zoom: 10 };\n',
  'docs/tasks/SPRINT-01.md': '# Спринт\n',
};

test('чистий репозиторій проходить, і периметр не порожній', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    const { findings, scanned } = scanForSecrets(root);
    expect(findings).toEqual([]);
    // Нуль просканованих — це не «чисто», це зламаний периметр.
    expect(scanned).toBeGreaterThan(0);
  } finally {
    removeFixture(root);
  }
});

test('знаходить ключ, називає file:line і шаблон — і не повертає збігу', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
  });
  try {
    const { findings } = scanForSecrets(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      file: 'src/shared/config/keys.ts',
      line: 1,
      pattern: 'aws-access-key-id',
      length: 20,
    });
    // Тип знахідки не має поля зі збігом — і об'єкт теж. Сам збіг не існує
    // за межами scanLine, тож надрукувати його нема звідки.
    expect(JSON.stringify(findings)).not.toContain(SYNTHETIC);
  } finally {
    removeFixture(root);
  }
});

test('CLI НЕ друкує знайденого — ні цілком, ні частиною', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
  });
  try {
    const result = runCheck(CHECK, root);

    // Знайшла, і сказала де і що саме за шаблоном.
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('src/shared/config/keys.ts:1: aws-access-key-id');
    expect(result.stdout).toContain('довжина збігу: 20');

    // І — головне твердження цього тесту — не переказала знайденого.
    expect(result.stdout).not.toContain(SYNTHETIC);
    expect(result.stderr).not.toContain(SYNTHETIC);
    // «Навіть частково»: жодне восьмисимвольне вікно збігу не витекло.
    for (let i = 0; i + 8 <= SYNTHETIC.length; i += 1) {
      expect(result.stdout).not.toContain(SYNTHETIC.slice(i, i + 8));
    }
  } finally {
    removeFixture(root);
  }
});

test('відпускає після відкоту', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, {
      'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
    });
    expect(scanForSecrets(root).findings).toHaveLength(1);

    rmSync(path.join(root, 'src/shared/config/keys.ts'));
    expect(scanForSecrets(root).findings).toEqual([]);
  } finally {
    removeFixture(root);
  }
});

test('плейсхолдер у чужій документації — не знахідка', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    // Обидві фікстури СПРАЦЬОВУЮТЬ за шаблоном і відкидаються саме маркером
    // плейсхолдера. Це умова того, що тест щось доводить: рядок, який не збігається
    // з жодним шаблоном, лишався б зеленим і з порожнім PLACEHOLDER.
    // Форма — з .claude/skills/shadcn/mcp.md; значення замінене на явний
    // плейсхолдер, бо `Bearer ${...}` шаблон bearer-token не ловить: `$` і `{`
    // поза його класом символів.
    '.claude/skills/shadcn/mcp.md':
      '"headers": { "Authorization": "Bearer YOUR_TOKEN_HERE_0123456789" }\n',
    // `AISSTREAM_API_KEY=` теж не збігається: `\b` перед `API` не спрацьовує після
    // підкреслення. Тому тут форма, яку assigned-secret справді бачить.
    'docs/context/setup.md': 'api_key = "EXAMPLE0123456789abcdef"\n',
  });
  try {
    expect(scanForSecrets(root).findings).toEqual([]);
  } finally {
    removeFixture(root);
  }
});

test('lock-файли й вендорені скіли — поза периметром, і пропуск порахований (R-14)', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    // Усередині кожного — синтетичний ключ. БЕЗ виключення він дав би знахідку,
    // тож зелене доводить саме виключення, а не те, що фікстура нічого не містить.
    'package-lock.json':
      `{"packages":{"node_modules/next":{"integrity":"sha512-${SYNTHETIC}"}}}\n`,
    'skills-lock.json': `{"computedHash":"${SYNTHETIC}"}\n`,
    '.claude/skills/shadcn/mcp.md': `token = "${SYNTHETIC}"\n`,
    '.agents/skills/x/README.md': `api_key = "${SYNTHETIC}"\n`,
  });
  try {
    const { findings, excludedSkipped } = scanForSecrets(root);
    expect(findings).toEqual([]);
    // Пропуск порахований і потрапляє в підсумок. Тихе виключення читалося б як
    // «перевірено», і саме тоді діра перестає бути видимою.
    expect(excludedSkipped).toBe(4);
  } finally {
    removeFixture(root);
  }
});

test('креденшели в URL ловляться там, де файл у периметрі', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'docs/context/deploy.md': `npm pack ${SYNTHETIC_URL}\n`,
  });
  try {
    const { findings } = scanForSecrets(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('docs/context/deploy.md');
    expect(findings[0]?.pattern).toBe('url-credentials');
  } finally {
    removeFixture(root);
  }
});

test('бінарний файл пропускається — і пропуск видимий у підсумку', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, {
      // NUL-байт тут записаний ЕСКЕЙПОМ, не сирим байтом. Сирий 0x00 у тексті плану
      // невидимий в рев'ю, губиться при копіюванні і робить сам файл плану бінарним
      // для git. Він обов'язковий по суті: isBinary шукає саме NUL, а не розширення —
      // без нього файл сканується, синтетичний ключ знаходиться, вихід 1, і падають
      // обидва твердження нижче.
      'assets/logo.png': `\x89PNG\r\n\x1a\n\0${SYNTHETIC}`,
    });
    const result = runCheck(CHECK, root);
    // Пропуск — не «пройшло». Він названий у підсумку, бо це діра, а не зелене.
    expect(result.stdout).toContain('пропущено бінарних — 1');
    expect(result.code).toBe(0);
  } finally {
    removeFixture(root);
  }
});

test('ігнорований файл не сканується — периметр це передача, не диск', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, { '.env.local': `AISSTREAM_API_KEY=${SYNTHETIC}\n` });
    // .env* у .gitignore фікстури: файл не передається, отже поза периметром.
    // Це записано в blindSpot рядка реєстру — межа, а не пропуск.
    expect(runCheck(CHECK, root).code).toBe(0);
  } finally {
    removeFixture(root);
  }
});
```

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: дев'ять нових тестів падають — сім на відсутньому модулі
`no-secrets.mjs`, два (ті, що кличуть `runCheck`) на «Скрипта перевірки немає за
шляхом …/no-secrets.mjs». Сорок два попередні — зелені.

- [ ] **Крок 2: Написати `scripts/verify/checks/no-secrets.mjs`**

```js
// CLAUDE.md, розділ Secrets: «The AISStream key must not reach source, delivered files,
// or the screen — the client checks the handed-over files for it during acceptance».
//
// Периметр — ПЕРЕДАЧА РЕПОЗИТОРІЮ (`git ls-files -c -o --exclude-standard`), не бандл
// браузера: клієнт тут — навчальний центр, і він читає docs/, .claude/, scripts/.
// Невідстежені файли теж скануються: секрет треба спинити ДО коміту, бо після
// потрапляння в історію git його вже не «розпередати» видаленням файлу.
//
// І головне: ця перевірка НІЧОГО зі знайденого не друкує. Звіт — file:line, назва
// шаблону, довжина збігу. Інакше вона порушувала б рівно те правило, яке охороняє.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listRepoFiles } from '../hash.mjs';

/**
 * Файли, чиє призначення — містити текст самих шаблонів. Вони дали б самоукус:
 * перевірка знайшла б власні регулярні вирази. Виняток поіменний і перелічений —
 * не «виключимо теку, бо вона не наша», — і він записаний у blindSpot рядка реєстру.
 *
 * Список свідомо короткий. Текст плану (`docs/superpowers/plans/…`) відстежений, тобто
 * лежить у периметрі, і сюди НЕ додається: замість винятку його фікстури зібрані з
 * частин (див. крок 1), тож жоден його рядок не збігається з шаблоном. Виняток коштував
 * би дірки на цілий файл, збірка з частин — нічого.
 */
const SELF_DESCRIBING = [
  'scripts/verify/checks/no-secrets.mjs',
  'tests/unit/no-secrets.spec.ts',
];

/**
 * Виключення периметра (R-14). Кожне названо тут і продубльовано в blindSpot рядка
 * реєстру — саме тому, що це діри.
 *
 * `package-lock.json` — 62 значення `"integrity": "sha512-…"`.
 * `skills-lock.json`  — два 64-символьні `computedHash`.
 * `.claude/skills/**` і `.agents/skills/**` — вендорені сторонні скіли: їхній текст
 * ми не пишемо й не передаємо як свій код, а приклади в ньому мають форму токенів.
 *
 * Тут свідомо ВИКЛЮЧАЮТЬСЯ ФАЙЛИ, а не маскуються поля. Маскування значень
 * `integrity`/`computedHash` виглядало б точнішим, але це два регулярні вирази, що
 * тихо перестають збігатися при зміні формату lock-файлу, — і тоді перевірка знову
 * червона з не-секретів. Ціна прямого виключення сказана вголос: секрет, вписаний
 * у lock-файл, ця перевірка не побачить.
 */
const EXCLUDED_FILES = ['package-lock.json', 'skills-lock.json'];
const EXCLUDED_PREFIXES = ['.claude/skills/', '.agents/skills/'];

function isExcluded(relPath) {
  return SELF_DESCRIBING.includes(relPath)
    || EXCLUDED_FILES.includes(relPath)
    || EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/** Ознаки того, що збіг — плейсхолдер у документації, а не ключ. */
const PLACEHOLDER = /\$\{|<[A-Za-z_]|YOUR[_-]|EXAMPLE|SAMPLE|PLACEHOLDER|CHANGE[_-]?ME|xxxx|…|\.\.\./i;

/**
 * Шаблони. Назва кожного потрапляє у звіт — щоб той, хто читає, знав, що саме шукати
 * у файлі, не отримавши самого рядка.
 *
 * Кожен прив'язаний до КОНТЕКСТУ (R-14): слово-якір (`api_key`, `secret`, `token`,
 * `password`, `aisstream`, `Bearer `), форма URL із креденшелами, або літеральний
 * префікс блоку (`-----BEGIN … PRIVATE KEY-----`, `AKIA`/`ASIA`). Жодного шаблону
 * «довгий base64» чи «довгий hex» тут немає й бути не може: саме вони роблять
 * перевірку червоною на дайджестах, хешах і data-URI, тобто на не-секретах.
 */
const PATTERNS = [
  { name: 'private-key-block', re: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/g },
  { name: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s:@'"]+@/g },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g },
  {
    name: 'assigned-secret',
    re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|auth[_-]?key)\b\s*[:=]\s*['"`]?[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
  },
  // Мотивувальний випадок R2: ключ AISStream, названий у CLAUDE.md поіменно.
  { name: 'aisstream-key', re: /\baisstream\b[^\n]{0,40}?['"`][A-Za-z0-9]{16,}['"`]/gi },
];

/** Бінарь виявляється NUL-байтом, а не розширенням: список розширень старіє, детектор ні. */
function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

/** Повертає лише метадані збігу. Сам збіг не залишає цієї функції — за побудовою. */
export function scanLine(line) {
  const found = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let match = pattern.re.exec(line);
    while (match !== null) {
      if (!PLACEHOLDER.test(match[0])) {
        found.push({ pattern: pattern.name, length: match[0].length });
      }
      match = pattern.re.exec(line);
    }
  }

  return found;
}

/**
 * Чиста функція за R-12: бере корінь, повертає ЛИШЕ метадані — file, line, назву
 * шаблону, довжину збігу — плюс три лічильники. Самого збігу вона не повертає, тож
 * навіть той, хто викличе її з тесту, не зможе випадково надрукувати знайдене.
 */
export function scanForSecrets(root) {
  const findings = [];
  let scanned = 0;
  let binarySkipped = 0;
  let excludedSkipped = 0;

  for (const relPath of listRepoFiles(root)) {
    if (isExcluded(relPath)) {
      excludedSkipped += 1;
      continue;
    }

    const buffer = readFileSync(path.join(root, relPath));
    if (isBinary(buffer)) {
      binarySkipped += 1;
      continue;
    }

    scanned += 1;
    buffer.toString('utf8').split('\n').forEach((line, index) => {
      for (const item of scanLine(line)) {
        findings.push({ file: relPath, line: index + 1, ...item });
      }
    });
  }

  return { findings, scanned, binarySkipped, excludedSkipped };
}

function main() {
  const root = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const { findings, scanned, binarySkipped, excludedSkipped } = scanForSecrets(root);

  for (const item of findings) {
    process.stdout.write(`${item.file}:${item.line}: ${item.pattern} (довжина збігу: ${item.length})\n`);
  }

  // Обидва пропуски названо в підсумку — і на зеленому теж. Пропуск, про який
  // мовчать, читається як «перевірено», а це рівно та підміна, від якої весь шар.
  const skipped = `пропущено бінарних — ${binarySkipped}, поза периметром — ${excludedSkipped}`;

  if (findings.length === 0) {
    process.stdout.write(
      `no-secrets: просканували файлів — ${scanned}, ${skipped}, знахідок немає.\n`,
    );
    process.exit(0);
  }

  const affected = new Set(findings.map((item) => item.file)).size;
  process.stdout.write(
    `no-secrets: знахідок — ${findings.length}, файлів із знахідками — ${affected}, `
    + `${skipped}. Вміст не друкується — відкрийте файл за вказаним рядком.\n`,
  );
  process.exit(1);
}

// R-22. Варта обов'язкова: за R-12 тест імпортує `scanForSecrets` із цього ж файлу,
// і без неї імпорт запускав би `main()` із `process.exit()` посеред тестів.
if (import.meta.filename === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`no-secrets: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
```

- [ ] **Крок 2а: Написати `scripts/verify/checks/no-secrets.d.mts` (R-08)**

Декларації описують **лише метадані**. Типу, що ніс би сам збіг, тут немає навмисно:
те, чого немає в типі, ніхто не надрукує випадково.

```ts
export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  length: number;
}

export declare function scanLine(line: string): { pattern: string; length: number }[];
export declare function scanForSecrets(root: string): {
  findings: SecretFinding[];
  scanned: number;
  binarySkipped: number;
  excludedSkipped: number;
};
```

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: `51 passed` — сорок два попередні й дев'ять нових. Тест «CLI НЕ друкує
знайденого — ні цілком, ні частиною» — єдиний, що стереже центральне правило; якщо він
падає, це не «підправити очікування», а знак, що звіт тече.

- [ ] **Крок 3: Прогнати на справжньому дереві й розібрати кожну знахідку**

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/checks/no-secrets.mjs; echo "EXIT=$?"
```

Очікується: `знахідок немає` і `EXIT=0`. Числа: сьогодні `git ls-files -c -o
--exclude-standard` віддає **79** шляхів, із них **52** підпадають під виключення R-14
(два lock-файли плюс дві копії вендорених скілів — `.claude/skills/**` і
`.agents/skills/**`), тож «поза периметром — 52», а «просканували файлів» — близько
**27**, плюс файли, додані задачами 1–6.

`пропущено бінарних` сьогодні дасть **0**, і це не ознака зламаного `isBinary`: усі
чотири відстежені `.png` лежать саме всередині вендорених скілів, тобто відсіюються
раніше — виключенням, а не детектором NUL. Що `isBinary` працює, доводить не цей
прогін, а юніт-тест «бінарний файл пропускається».

Три лічильники не перетинаються: кожен шлях потрапляє рівно в один із них, тож
`scanned + binarySkipped + excludedSkipped` мусить дорівнювати кількості шляхів, яку
щойно віддав `git ls-files`. **Нуль просканованих файлів — провал кроку, не успіх.**

Прогін по сьогоднішньому дереву дає нуль знахідок — це перевірено заздалегідь, тож
`EXIT=1` тут означає, що задачі 1–6 щось принесли, а не що перевірка шумить.

Якщо `EXIT=1` — жодного рядка звіту не переносити в чат і в коміт. Порядок дій:

1. Відкрити названий `file:line` локально.
2. **Справжній секрет** → видалити з файлу й з історії git, перш ніж щось інше.
3. **Плейсхолдер у чужій документації** → дописати маркер у `PLACEHOLDER`, назвавши
   в коментарі конкретний файл, який його спричинив.
4. **Файл, що описує самі шаблони** (розділ плану, спека, чернетка в `.superpowers/`)
   → дописати його шлях у `SELF_DESCRIBING` **поіменно** й додати рядок у `blindSpot`.
   Поіменний перелік — не те саме, що «виключити теку, бо вона не наша»: друге §1
   забороняє, перше лишає діру видимою.

Далі — навмисний злам, критерій фази 3:

```bash
source ~/.nvm/nvm.sh && nvm use
printf "export const k = '%s';\n" "AKIA$(printf 'N%.0s' $(seq 1 8))OTREAL00" \
  > tmp-check.txt
node scripts/verify/checks/no-secrets.mjs; echo "EXIT=$?"
rm tmp-check.txt
node scripts/verify/checks/no-secrets.mjs; echo "EXIT=$?"
git status --short   # мусить бути порожньо: тимчасовий файл прибрано
```

Файл кладеться в корінь, а не в `src/shared/config/`, з двох причин: периметр цієї
перевірки — уся передача, тож корінь доводить те саме; а `.ts` усередині `src/`
потрапив би в `include` з `tsconfig.json` і в шар `shared` FSD, тобто зламав би
`check-types` і порушив межі зрізу заради тимчасового файлу. Відкат — `rm`, а не
`git checkout --`: файл новий, і `git checkout --` на ньому нічого не зробив би.

Очікується: перший прогін — `tmp-check.txt:1: aws-access-key-id (довжина збігу: 20)`
і `EXIT=1`, причому в рядку звіту **немає самого значення**; після видалення —
`знахідок немає` і `EXIT=0`.

- [ ] **Крок 4: Додати рядок у реєстр**

```js
  {
    id: 'no-secrets',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/no-secrets.mjs',
    needs: [],
    after: [],
    proves:
      'Жоден файл, що потрапляє до передачі, не містить рядків, схожих на ключ або токен',
    // Перші два речення — зі спеки §4 дослівно. Решта дописана за §3.1: занижений
    // blindSpot небезпечніший за відсутній, а ці чотири пропуски реальні.
    blindSpot:
      'Порівняння за шаблонами: секрет у незвичному кодуванні або розбитий на рядки '
      + 'невидимий. Ігноровані git-ом файли не скануються — і не передаються. '
      + 'Бінарні файли (NUL у перших 8 КіБ) пропускаються цілком. Поза периметром '
      + 'цілком: package-lock.json, skills-lock.json, .claude/skills/** і '
      + '.agents/skills/** — секрет, вписаний у будь-який із них, невидимий. '
      + 'Збіг, що містить маркер плейсхолдера, відкидається без розгляду. '
      + 'Файли зі списку SELF_DESCRIBING не скануються взагалі',
  },
```

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/run.mjs --tier fast
```

Очікується: рядок `no-secrets` зі статусом `PASSED`; код виходу раннера — `0`.

- [ ] **Крок 5: Перезапустити всі успадковані зелені**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
```

Очікується: три виходи `0`.

- [ ] **Крок 6: Коміт**

```bash
git add scripts/verify/checks/no-secrets.mjs scripts/verify/checks/no-secrets.d.mts \
        tests/unit/no-secrets.spec.ts scripts/verify/registry.mjs
git commit -m "feat(verify): перевірка «жодного ключа у переданих файлах»

CLAUDE.md: клієнт перевіряє передані файли на ключ AISStream під час
приймання. Досі між ключем і передачею не стояло нічого.

Периметр — передача репозиторію (git ls-files -c -o --exclude-standard),
а не бандл браузера: клієнт тут навчальний центр, і він читає docs/,
.claude/ і scripts/ так само, як src/.

Звіт дає file:line, назву шаблону й довжину збігу — і ніколи сам збіг.
Тест стереже саме це заперечним твердженням: жодне восьмисимвольне вікно
знайденого не потрапляє у вивід. Фікстура — синтетичний рядок форми
ключа, складений із частин, тож цілого літерала немає й у тесті.

Lock-файли й дві копії вендорених скілів виключено з периметра цілком —
без цього перевірка червона з не-секретів у перший же день, а червону
перевірку вимикають. Кожен виняток названо в blindSpot і порахований
у підсумку прогону: діра, яку видно, — не те саме, що діра, якої немає.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: `checks/deps-allowlist.mjs` — `package.json` у межах узгодженого

Критерії B-01 і B-07 прямо вимагають відсутності зайвих залежностей і другого тестового
раннера, а §8 спеки витратила бюджет винятків рівно на три пакети. Задача остання з трьох
структурних, бо єдина з них не читає дерева — лише один файл.

**Files:**
- Create: `scripts/verify/checks/deps-allowlist.mjs`
- Create: `scripts/verify/checks/deps-allowlist.d.mts` (R-08)
- Test: `tests/unit/deps-allowlist.spec.ts`
- Modify: `scripts/verify/registry.mjs` (додати рядок `deps-allowlist`)

**Interfaces:**
- Consumes: `runCheck`, `makeFixtureDir`, `writeFixtureFiles`, `removeFixture` із
  `tests/unit/support/check-fixtures.ts` (задача 5); `CHECKS` із задачі 3; фактичний
  `package.json` після кроку 2 задачі 1.
- Produces: `scripts/verify/checks/deps-allowlist.mjs` за спільним контрактом; експорти
  `ALLOWED` і чиста функція `checkManifest(manifest)` — тести імпортують обидва (R-12);
  `scripts/verify/checks/deps-allowlist.d.mts`; рядок реєстру з `id: 'deps-allowlist'`.

**Два рішення, записані тут, щоб їх не ухвалили мовчки.**
(1) **Звіряються точні версії, не лише імена.** `CLAUDE.md`: «Every agreed value below
lives in one config location», і крок 2 задачі 1 ставить пакети з `--save-exact` саме
тому. Allowlist лише з іменами пропустив би тихий дрейф `eslint` з 9 на 10 — а весь §8
спеки побудований на тому, що 10 тут неможлива через peer-діапазони.
(2) **Allowlist живе у файлі перевірки, не в реєстрі.** §3.1 спеки: `registry.mjs` —
тільки дані **про перевірки**; узгоджений набір пакетів — дані **перевірки**.

- [ ] **Крок 1: Написати падаючий тест**

Чиста фікстура **не переписує** allowlist третьою копією: вона будується з експортованої
константи `ALLOWED` самої перевірки (R-12). Інакше список жив би у трьох місцях —
`package.json`, перевірка, тест — і розійшовся б на першому ж оновленні залежності.

Дев'ять із десяти тестів кличуть чисту `checkManifest(manifest)` напряму: вона бере
розібраний маніфест, тож фікстура на диску їм узагалі не потрібна. Десятий лишається на
`runCheck`, бо саме він доводить контракт кодів виходу (`0`/`1`), на який спирається
`run.mjs`, — і цього не доводить жоден виклик чистої функції.

`tests/unit/deps-allowlist.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { ALLOWED, checkManifest } from '../../scripts/verify/checks/deps-allowlist.mjs';
import {
  makeFixtureDir,
  removeFixture,
  runCheck,
  writeFixtureFiles,
} from './support/check-fixtures';

const CHECK = 'deps-allowlist.mjs';

/** Узгоджений набір у форматі package.json — з вуст самої перевірки, не з другої копії. */
function agreedManifest(
  extra: Record<string, Record<string, string>> = {},
): Record<string, unknown> {
  const manifest: Record<string, unknown> = { name: 'fixture', private: true };
  for (const [block, packages] of Object.entries(ALLOWED)) {
    manifest[block] = { ...packages, ...(extra[block] ?? {}) };
  }
  for (const [block, packages] of Object.entries(extra)) {
    if (manifest[block] === undefined) manifest[block] = packages;
  }
  return manifest;
}

function serialise(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

test('узгоджений набір проходить', () => {
  expect(checkManifest(agreedManifest())).toEqual([]);
});

test('другий тестовий раннер названий поіменно, а не «невідомий пакет»', () => {
  const problems = checkManifest(agreedManifest({ devDependencies: { vitest: '4.0.0' } }));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('devDependencies.vitest');
  expect(problems[0]).toContain('другий тестовий раннер');
});

test('друга бібліотека карт — теж поіменно, і в дочірньому просторі імен', () => {
  for (const [name, version] of [['maplibre-gl', '5.0.0'], ['@react-leaflet/core', '3.0.0']]) {
    const problems = checkManifest(agreedManifest({ dependencies: { [name]: version } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`dependencies.${name}`);
    expect(problems[0]).toContain('друга бібліотека карт');
  }
});

test('підготовка до R2 не проходить під виглядом звичайної залежності', () => {
  const problems = checkManifest(agreedManifest({ dependencies: { ws: '8.0.0' } }));
  expect(problems.join('\n')).toContain('підготовка до R2');
});

test('незнайомий пакет поза жодною категорією — все одно провал', () => {
  const problems = checkManifest(agreedManifest({ dependencies: { 'left-pad': '1.3.0' } }));
  expect(problems.join('\n')).toContain('немає в узгодженому наборі');
});

test('дрейф версії ловиться — не лише поява пакета', () => {
  const problems = checkManifest(agreedManifest({ devDependencies: { eslint: '10.10.0' } }));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('devDependencies.eslint');
  expect(problems[0]).toContain('10.10.0');
});

test('діапазон замість точної версії — теж дрейф', () => {
  const problems = checkManifest(agreedManifest({ dependencies: { leaflet: '^1.9.4' } }));
  expect(problems).toHaveLength(1);
});

test('інші блоки залежностей заборонені — інакше пакет обійшов би allowlist', () => {
  const problems = checkManifest(agreedManifest({ peerDependencies: { vitest: '4.0.0' } }));
  expect(problems.join('\n')).toContain('peerDependencies');
});

test('узгоджена залежність, що зникла, — теж розбіжність', () => {
  const manifest = agreedManifest();
  const dependencies = { ...(manifest.dependencies as Record<string, string>) };
  delete dependencies.leaflet;
  manifest.dependencies = dependencies;

  expect(checkManifest(manifest).join('\n')).toContain('зникла з package.json');
});

test('CLI: код 1 на розбіжності, 0 після відкоту', () => {
  // Єдиний тест на підпроцесі — він стереже контракт кодів виходу, який чиста
  // функція не доводить, а `run.mjs` від нього залежить.
  const root = makeFixtureDir({
    'package.json': serialise(agreedManifest({ devDependencies: { jest: '30.0.0' } })),
  });
  try {
    expect(runCheck(CHECK, root).code).toBe(1);

    writeFixtureFiles(root, { 'package.json': serialise(agreedManifest()) });
    const after = runCheck(CHECK, root);
    expect(after.stdout).toContain('усі в узгодженому наборі');
    expect(after.code).toBe(0);
  } finally {
    removeFixture(root);
  }
});
```

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit
```

Очікується: десять нових тестів падають — дев'ять на відсутньому модулі
`deps-allowlist.mjs`, десятий на «Скрипта перевірки немає за шляхом
…/deps-allowlist.mjs». П'ятдесят один попередній — зелені.

- [ ] **Крок 2: Написати `scripts/verify/checks/deps-allowlist.mjs`**

```js
// Критерій B-01 — «зайвих залежностей немає»; критерій B-07 — «інших тестових
// фреймворків немає». §8 спеки витратила бюджет винятків рівно на три пакети.
// Ця перевірка — єдине, що стоїть між цими реченнями й `npm install`.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Узгоджений набір. Джерела: B-01 (чотири dependencies, чотири devDependencies) і
 * §8 спеки (три інструменти перевірки як свідомий виняток).
 *
 * Версії ТОЧНІ, бо крок 2 задачі 1 ставить пакети з --save-exact, а CLAUDE.md
 * каже: «Every agreed value below lives in one config location». Allowlist лише з
 * іменами пропустив би тихий дрейф eslint з 9 на 10 — а весь §8 спеки стоїть на
 * тому, що 10 тут неможлива через peer-діапазони eslint-plugin-react і
 * eslint-plugin-jsx-a11y.
 *
 * Оновлювати цей літерал і package.json належить ОДНИМ комітом. Розбіжність між
 * ними — це і є те, що перевірка ловить.
 */
export const ALLOWED = {
  dependencies: {
    leaflet: '1.9.4',
    next: '16.3.5',
    react: '19.3.0',
    'react-dom': '19.3.0',
  },
  devDependencies: {
    '@playwright/test': '1.63.0',
    '@types/leaflet': '1.9.22',
    '@types/node': '24.13.4',
    '@types/react': '19.3.0',
    eslint: '9.39.5',
    'eslint-config-next': '16.3.5',
    typescript: '6.0.3',
  },
};

const KNOWN_BLOCKS = Object.keys(ALLOWED);

/** Пакет у будь-якому з цих блоків обійшов би allowlist — тому блоків не має бути взагалі. */
const FORBIDDEN_BLOCKS = [
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
  'overrides',
  'resolutions',
];

/**
 * Denylist НЕ заміняє allowlist — він слабший за побудовою, бо ловить лише передбачене.
 * Його єдина робота — назвати зламане правило поіменно замість безликого
 * «невідомий пакет»: повідомлення, що називає причину, лагодять, а не глушать.
 */
const DENIED = [
  {
    rule: 'другий тестовий раннер',
    why: 'SPRINT-01 B-07: «інших тестових фреймворків немає»',
    names: ['vitest', 'jest', 'mocha', 'jasmine', 'ava', 'tap', 'uvu', 'karma', 'cypress'],
    scopes: ['@vitest/', '@jest/', '@testing-library/'],
  },
  {
    rule: 'друга бібліотека карт',
    why: 'SPRINT-01, Частина Б — «друга бібліотека карт» відхиляється на огляді плану',
    names: ['mapbox-gl', 'maplibre-gl', 'ol', 'react-leaflet', 'cesium', 'deck.gl'],
    scopes: ['@react-leaflet/', '@googlemaps/'],
  },
  {
    rule: 'підготовка до R2',
    why: 'CLAUDE.md: «not geodesy, not ws, not @aisstream/aisstream». Реальні дані AIS — пізніший реліз',
    names: ['geodesy', 'ws'],
    scopes: ['@aisstream/'],
  },
  {
    rule: 'спокуса з reference/',
    why: 'CLAUDE.md: «React Query, Zustand, Tailwind, MSW, Vitest and Storybook appear in these repos; none of them is thereby permitted»',
    names: ['zustand', 'msw', 'storybook', 'tailwindcss'],
    scopes: ['@tanstack/', '@storybook/'],
  },
];

function deniedRule(name) {
  return DENIED.find(
    (entry) => entry.names.includes(name) || entry.scopes.some((scope) => name.startsWith(scope)),
  );
}

function allowedBlockOf(name) {
  return KNOWN_BLOCKS.find((block) => ALLOWED[block][name] !== undefined);
}

export function checkManifest(manifest) {
  const problems = [];

  for (const block of FORBIDDEN_BLOCKS) {
    if (manifest[block] !== undefined) {
      problems.push(`блок "${block}" заборонений: залежність у ньому пройшла б повз allowlist`);
    }
  }

  const present = (name) => KNOWN_BLOCKS.some((block) => (manifest[block] ?? {})[name] !== undefined);

  for (const block of KNOWN_BLOCKS) {
    const actual = manifest[block] ?? {};

    for (const [name, version] of Object.entries(actual)) {
      const expected = ALLOWED[block][name];

      if (expected === undefined) {
        const home = allowedBlockOf(name);
        const rule = deniedRule(name);
        if (home !== undefined) {
          problems.push(`${block}.${name}: узгоджено в "${home}", не в "${block}"`);
        } else if (rule !== undefined) {
          problems.push(`${block}.${name}: ${rule.rule} — ${rule.why}`);
        } else {
          problems.push(`${block}.${name}: немає в узгодженому наборі`);
        }
        continue;
      }

      if (version !== expected) {
        problems.push(`${block}.${name}: версія ${version}, узгоджено ${expected}`);
      }
    }

    for (const name of Object.keys(ALLOWED[block])) {
      if (actual[name] === undefined && !present(name)) {
        problems.push(`${block}.${name}: узгоджена залежність зникла з package.json`);
      }
    }
  }

  return problems;
}

function main() {
  const root = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const problems = checkManifest(manifest);

  for (const problem of problems) {
    process.stdout.write(`package.json: ${problem}\n`);
  }

  if (problems.length === 0) {
    const total = KNOWN_BLOCKS.reduce((sum, block) => sum + Object.keys(ALLOWED[block]).length, 0);
    process.stdout.write(`deps-allowlist: залежностей — ${total}, усі в узгодженому наборі.\n`);
    process.exit(0);
  }

  process.stdout.write(
    `deps-allowlist: розбіжностей — ${problems.length}. Кожна виправляється або в `
    + `package.json, або свідомим оновленням ALLOWED у цьому файлі — не обома «про всяк випадок».\n`,
  );
  process.exit(1);
}

// R-22. Варта обов'язкова: за R-12 тест імпортує `ALLOWED` і `checkManifest` із цього ж
// файлу, і без неї імпорт запускав би `main()` із `process.exit()` посеред тестів.
if (import.meta.filename === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`deps-allowlist: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
```

- [ ] **Крок 2а: Написати `scripts/verify/checks/deps-allowlist.d.mts` (R-08)**

```ts
export type VersionMap = Record<string, string>;

export declare const ALLOWED: {
  dependencies: VersionMap;
  devDependencies: VersionMap;
};

export declare function checkManifest(manifest: Record<string, unknown>): string[];
```

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npx playwright test --project=unit
```

Очікується: `check-types` — тиша, вихід `0`; `61 passed` — п'ятдесят один попередній
і десять нових.

- [ ] **Крок 3: Прогнати на справжньому `package.json`**

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/checks/deps-allowlist.mjs; echo "EXIT=$?"
```

Очікується: `deps-allowlist: залежностей — 11, усі в узгодженому наборі.` і `EXIT=0`.

Якщо `EXIT=1` з рядками про `eslint`, `eslint-config-next` чи `@playwright/test` —
крок 2 задачі 1 поставив не ті патч-версії (`recon-conflicts.md` C-20 це передбачив).
Правильний хід — **звірити з `npm ls` і записати фактичну версію в `ALLOWED`**, назвавши
її в повідомленні коміта; неправильний — прибрати звірку версій, бо вона «заважає».

Далі — навмисний злам, критерій фази 3. Без `npm install`, щоб не чіпати дерево:

```bash
source ~/.nvm/nvm.sh && nvm use
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
manifest.devDependencies.vitest = '4.0.0';
writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n');
"
node scripts/verify/checks/deps-allowlist.mjs; echo "EXIT=$?"
git checkout -- package.json
node scripts/verify/checks/deps-allowlist.mjs; echo "EXIT=$?"
git diff --stat package.json
```

Відкат — `git checkout -- package.json`, а не копія в `/tmp`: `package.json`
відстежений, тож git відновлює його **побайтово**, разом із форматуванням, яке
`JSON.stringify` перед тим переписав. Копія через `cp` теж працює, але залишає
позаробочий файл, який нікуди не записаний і губиться при перериванні кроку.
`--input-type=module`, бо Global Constraints вимагають ESM, а `node -e` без нього
виконує код як CommonJS.

Очікується: перший прогін — `package.json: devDependencies.vitest: другий тестовий
раннер — SPRINT-01 B-07: «інших тестових фреймворків немає»` і `EXIT=1`; після
відкоту — `усі в узгодженому наборі`, `EXIT=0`, і `git diff --stat` порожній.

- [ ] **Крок 4: Додати рядок у реєстр**

```js
  {
    id: 'deps-allowlist',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/deps-allowlist.mjs',
    needs: [],
    after: [],
    proves:
      '`package.json` містить лише узгоджений набір; другого тестового раннера й '
      + 'другої бібліотеки карт немає',
    // Перше речення — зі спеки §4 дослівно; далі дописано те, чого воно не називає.
    blindSpot:
      'Тільки прямі залежності. Не доводить, що дозволена залежність узагалі '
      + 'використовується. `eslint-config-next` тягне `eslint-plugin-react`, '
      + '`eslint-plugin-jsx-a11y` та `eslint-plugin-import` транзитивно — про них '
      + 'рядок не говорить нічого. Не читає `package-lock.json`, тож підміна пакета '
      + 'на тій самій версії невидима. Сам allowlist — літерал у файлі перевірки: '
      + 'він доводить згоду з ним, не з брифом',
  },
```

```bash
source ~/.nvm/nvm.sh && nvm use && node scripts/verify/run.mjs --tier fast
```

Очікується: у таблиці всі шість рядків рівня `fast` — `typecheck`, `lint`, `unit`,
`no-ref-imports`, `no-secrets`, `deps-allowlist` — зі статусом `PASSED`; код виходу `0`.
Це перший момент, коли рівень `fast` укомплектований за §4 спеки.

- [ ] **Крок 5: Перезапустити всі успадковані зелені й звірити три перевірки з реєстром**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
node scripts/verify/run.mjs --tier fast --only no-ref-imports,no-secrets,deps-allowlist --json
```

Очікується: три виходи `0`; у JSON-звіті рівно три рядки, усі `PASSED`, і в кожному —
непорожні `proves` та `blindSpot`. Порожній `blindSpot` тут — дефект: §3.1 спеки каже,
що занижений blindSpot небезпечніший за відсутній, а відсутній — небезпечніший за все.

- [ ] **Крок 6: Коміт**

```bash
git add scripts/verify/checks/deps-allowlist.mjs scripts/verify/checks/deps-allowlist.d.mts \
        tests/unit/deps-allowlist.spec.ts scripts/verify/registry.mjs
git commit -m "feat(verify): перевірка «package.json у межах узгодженого»

Критерії B-01 і B-07 вимагають відсутності зайвих залежностей і другого
тестового раннера. Досі між цими реченнями й npm install не стояло нічого.

Первинне правило — allowlist: будь-який пакет поза списком у будь-якому
блоці — провал. Denylist доданий не замість, а щоб повідомлення називало
зламане правило поіменно: «другий тестовий раннер», а не «невідомий пакет».

Звіряються точні версії, а не лише імена: пакети поставлені з --save-exact,
і allowlist лише з іменами пропустив би дрейф eslint з 9 на 10, на
неможливості якого стоїть увесь §8 спеки.

Інші блоки залежностей (peerDependencies, overrides, resolutions)
заборонені: пакет у них обійшов би перевірку цілком.

Цим комітом рівень fast укомплектований за §4 спеки — шість рядків.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Поправки до спеки, що діють на всі чотири задачі

Спека §6 заявляє, що механіка хуків звірена з документацією. Повторна звірка
(`recon-external-facts.md`) підтвердила її майже цілком; чотири місця виправляються тут, і
кожна задача нижче називає своє виправлення на місці.

| Місце спеки | Що в ній | Що насправді | Наслідок для задач |
| --- | --- | --- | --- |
| §6.4, обидві команди | хуки викликаються як `"$CLAUDE_PROJECT_DIR"/.claude/hooks/…` | `${CLAUDE_PROJECT_DIR}` **не рухається** за Claude у worktree; шлях активного дерева приходить полем `cwd` вхідного JSON | Команди лишаються як у спеці, але **корінь дерева обидва `.mjs`-хуки беруть із `cwd`, а не зі змінної**. Інакше гейт перевірив би не те дерево, яке редагують. Окремий наслідок, який мусить закрити контролер: поки гілка не злита, у головному checkout самих скриптів ще немає — див. врізку в задачі 11, крок 6. Задачі 9, 10, 11 |
| §6.2, «не блокує — і не за моїм вибором» | обґрунтовано документацією `Can block? No` | `Can block? No` стосується лише **скасування виклику інструмента**; канал `{"decision":"block","reason":…}` + exit 2 у `PostToolUse` існує | Рішення давати lead лишається, але записується як **вибір**, з причиною «посеред рефакторингу код законно зламаний». Задача 9 |
| §6.3 п.7, «Claude Code має власну межу у 8 блокувань — наша суворіша» | подано як константу | 8 — дефолт, змінюваний через `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | Формулювання в коментарі: «суворіша за дефолтну межу». Задача 10 |
| §3.4 / Task 2 `SOURCE_PREFIXES` | немає `src/` | увесь код застосунку під `src/` | Хуки ключують кеш за `sourceHash`; без `'src/'` кеш не протухає від правки застосунку. Задачі 9 і 10 **покладаються** на виправлення з Task 2 і не можуть бути прийняті без нього |

---

### Task 8: `.claude/hooks/node.sh` — знайти Node 24, інакше впасти голосно

Хук не успадковує середовище інтерактивної оболонки: ні `nvm`, ні його `PATH`. Голий
`npx tsc` усередині хука повідомив би `UNRUNNABLE` із неправильної причини — а це найгірший
різновид брехні, бо виглядає як висновок про код. Тому обидва `.mjs`-хуки запускаються не
напряму, а через цей резолвер, і він іде першим із трьох.

**Files:**
- Create: `.claude/hooks/node.sh` (виконуваний, `chmod +x`)
- Test: `tests/unit/node-sh.spec.ts`

**Interfaces:**
- Consumes: `.nvmrc` (єдине місце, де зафіксовано мажор Node); Playwright-проєкт `unit` із задачі 1
- Produces: виконуваний `.claude/hooks/node.sh`, який `exec`-ає свої аргументи знайденим
  Node-бінарником, попередньо додавши до `PATH` каталог цього бінарника, `$PWD/node_modules/.bin`
  і `<project>/node_modules/.bin`. Задачі 9, 10 і 11 викликають його рівно як
  `node.sh <абсолютний шлях до .mjs>`.

**Три контракти, яких мусить триматися реалізація** (кожен перевіряється кроком нижче):

1. **Самі лише вбудовані команди.** Ні `dirname`, ні `sed`, ні `ls`, ні `cat`, ні `grep`.
   Каталоги — параметричною підстановкою, перелік версій — вбудованим globbing, читання
   `.nvmrc` — вбудованим `read`. Ворожий або порожній `PATH` не має ламати саме визначення шляхів.
2. **stdin не споживається.** Хук отримує JSON на stdin і мусить передати його далі незайманим.
   `read` застосовується **тільки** до `.nvmrc` із явним редиректом, ніколи до дескриптора 0.
3. **Тихого ненульового виходу не існує.** Будь-яка відмова друкує `{"systemMessage": …}` у stdout,
   дублює рядок у stderr і виходить `0` — fail open, але голосно, тією самою логікою, що §6.3 п.4.

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/node-sh.spec.ts`:

```ts
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const NODE_SH = path.join(ROOT, '.claude/hooks/node.sh');

test('node.sh запускає скрипт саме на мажорі з .nvmrc', () => {
  const result = spawnSync(NODE_SH, ['-e', 'process.stdout.write(process.versions.node)'], {
    encoding: 'utf8',
    input: '{}',
  });
  expect(result.status).toBe(0);
  expect(result.stdout.split('.')[0]).toBe('24');
});

test('node.sh не з’їдає stdin — payload доходить до скрипта', () => {
  const payload = '{"hook_event_name":"Stop","stop_hook_active":false}';
  const result = spawnSync(
    NODE_SH,
    ['-e', 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>process.stdout.write(s))'],
    { encoding: 'utf8', input: payload },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(payload);
});

test('ворожий PATH не ламає резолв: node все одно знаходиться', () => {
  const result = spawnSync(NODE_SH, ['-e', 'process.stdout.write("ok")'], {
    encoding: 'utf8',
    input: '{}',
    env: { PATH: '/nonexistent', HOME: process.env.HOME ?? '', NVM_DIR: process.env.NVM_DIR ?? '' },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('ok');
});

test('node.sh: придатного Node немає ніде — systemMessage у stdout, вихід 0, ніколи тиха невдача', () => {
  // Ворожого PATH тут НЕ досить: гілка 3 резолву пробує /opt/homebrew/bin/node та
  // /usr/local/bin/node за абсолютним шляхом, і PATH на неї не впливає. Якби на машині
  // стояв Homebrew-Node потрібного мажора, тест зеленів би, нічого не довівши.
  // Тому скрипт копіюється у тимчасове дерево з .nvmrc = 99: мажора 99 не існує ніде,
  // тож жодна з трьох гілок не може випадково «врятувати» тест. Справжній .nvmrc
  // не чіпається — він вхід хешу свіжості (задача 2), і підміна зробила б дерево несвіжим.
  const probeRoot = mkdtempSync(path.join(tmpdir(), 'sea-radar-nodesh-'));
  try {
    mkdirSync(path.join(probeRoot, '.claude/hooks'), { recursive: true });
    const probeSh = path.join(probeRoot, '.claude/hooks/node.sh');
    copyFileSync(NODE_SH, probeSh);
    chmodSync(probeSh, 0o755);
    writeFileSync(path.join(probeRoot, '.nvmrc'), '99\n');

    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
      env: { PATH: '/nonexistent', HOME: '/nonexistent', NVM_DIR: '/nonexistent' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('ok'); // скрипт НЕ запустився на чужому мажорі
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('systemMessage');
    const message = String((parsed as { systemMessage: string }).systemMessage);
    expect(message).toContain('НЕ виконувалась');
    expect(message).toContain('99'); // мажор прочитано з .nvmrc, а не зашито у скрипт
    // Голосно означає видимо: повідомлення дублюється і в stderr.
    expect(result.stderr.trim()).not.toBe('');
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('виклик без аргументів — теж голосна відмова, не мовчазний вихід', () => {
  const result = spawnSync(NODE_SH, [], { encoding: 'utf8', input: '{}' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('systemMessage');
});

test('node.sh: у скрипті немає зовнішніх утиліт — самі вбудовані', () => {
  // Коментарі відкидаються: у шапці утиліти названі саме як заборонені.
  const body = readFileSync(NODE_SH, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  // Підрядок із пробілами (' dirname ') обходиться тривіально: $(dirname "$x"),
  // `dirname` на початку рядка, табуляція. Тому — межі слова, не пробіли.
  for (const forbidden of [
    'dirname', 'basename', 'sed', 'ls', 'cat', 'grep', 'awk',
    'readlink', 'expr', 'tr', 'head', 'tail', 'which', 'find', 'xargs', 'env',
  ]) {
    expect(body, `зовнішня утиліта ${forbidden}`)
      .not.toMatch(new RegExp(String.raw`(^|[^\w./-])${forbidden}(\s|$|\))`, 'm'));
  }
});
```

Останній тест читає **робочу копію**, а не індекс: на кроці 4 файл ще не доданий до індексу,
і `git show :шлях` там упав би помилкою git, а не змістовним провалом. Робоча копія і є те,
що крок 7 комітить.

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit tests/unit/node-sh.spec.ts
```

Фільтр — шлях файлу, не `-g`: чотири з шести заголовків не містять рядка `node.sh`, і `-g
"node.sh"` мовчки прогнав би два тести замість шести. Тихо звужений фільтр — саме той різновид
зеленого, який шар має ловити, а не створювати.

Очікується: усі шість падають, і **форма падіння в них різна** — перевіряти треба саме її:
п'ять перших падають на `expect(result.status).toBe(0)`, бо `spawnSync` на відсутньому файлі не
кидає, а повертає `status: null` і `error.code === 'ENOENT'`; шостий падає з `ENOENT` у
`readFileSync`. Падіння на асерції *після* `status` означало б, що файл уже якось є.

- [ ] **Крок 3: Написати `.claude/hooks/node.sh`**

```sh
#!/bin/sh
# Резолвер інтерпретатора для хуків Claude Code.
#
# Хук не успадковує середовище інтерактивної оболонки: ні nvm, ні його PATH.
# Голий `npx tsc` усередині хука повідомив би UNRUNNABLE із неправильної причини —
# а це найгірший різновид брехні, бо виглядає як висновок про код.
#
# САМІ ЛИШЕ ВБУДОВАНІ КОМАНДИ — без dirname, sed, ls, cat: ворожий або порожній
# PATH не має ламати саме визначення шляхів.
#
# stdin НЕ ЧИТАЄТЬСЯ: на ньому лежить JSON події, і він мусить дійти до .mjs незайманим.
# Єдиний `read` нижче має явний редирект із .nvmrc.
set -u

# --- голосна відмова -------------------------------------------------------
# Ніколи тихий ненульовий вихід: fail open, але видимо (та сама логіка, що §6.3 п.4).
fail_loud() {
  printf '{"systemMessage":"ХУК НЕ ЗАПУСТИВСЯ: %s. Перевірка НЕ виконувалась — не вважай її зеленою."}\n' "$1"
  printf 'node.sh: %s\n' "$1" >&2
  exit 0
}

[ "$#" -gt 0 ] || fail_loud "викликано без аргументів"

# --- каталоги, без dirname -------------------------------------------------
hook_dir=${0%/*}
[ "$hook_dir" = "$0" ] && hook_dir=.
project_dir=${hook_dir%/*}    # .claude
project_dir=${project_dir%/*} # корінь checkout, у якому лежить сам хук

# --- бажаний мажор: .nvmrc — єдине місце, де версія зафіксована (CLAUDE.md) --
want=24
if [ -r "$project_dir/.nvmrc" ]; then
  IFS= read -r nvmrc < "$project_dir/.nvmrc" || nvmrc=''
  nvmrc=${nvmrc#v}
  nvmrc=${nvmrc%%.*}
  case $nvmrc in
    '' | *[!0-9]*) : ;;   # порожньо або не число — лишається запасне 24
    *) want=$nvmrc ;;
  esac
fi

major_of() {
  mv_out=$("$1" -v 2>/dev/null) || return 1
  mv_out=${mv_out#v}
  mv_out=${mv_out%%.*}
  [ -n "$mv_out" ] || return 1
  printf '%s' "$mv_out"
}

node_bin=''

# 1) те, що вже в PATH — найчастіший і найдешевший випадок
if cand=$(command -v node 2>/dev/null) && [ -x "$cand" ]; then
  [ "$(major_of "$cand")" = "$want" ] && node_bin=$cand
fi

# 2) установка nvm: перелік версій вбудованим globbing, не через ls
if [ -z "$node_bin" ]; then
  # ${HOME:-…} обов'язкове: під `set -u` неоголошений HOME обвалив би скрипт,
  # а хук запускається з середовищем, якого ми не контролюємо.
  for cand in "${NVM_DIR:-${HOME:-/nonexistent}/.nvm}"/versions/node/v"$want".*/bin/node; do
    [ -x "$cand" ] || continue
    node_bin=$cand
    break
  done
fi

# 3) типові системні розташування
if [ -z "$node_bin" ]; then
  for cand in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$cand" ] || continue
    [ "$(major_of "$cand")" = "$want" ] || continue
    node_bin=$cand
    break
  done
fi

# Свідомо НЕ запускаємось на чужому мажорі. Вердикт, отриманий не тим Node, —
# це твердження про код, якого ніхто не перевіряв тим інтерпретатором, що заявлений.
[ -n "$node_bin" ] || fail_loud "не знайдено Node major ${want} (.nvmrc)"

node_dir=${node_bin%/*}
# $PWD першим: у worktree саме він має node_modules активного дерева.
# Усі три — із запасним значенням: під `set -u` порожній PATH або незаданий PWD
# обвалили б скрипт саме там, де він мусить відмовляти голосно.
PATH=$node_dir:${PWD:-.}/node_modules/.bin:$project_dir/node_modules/.bin:${PATH:-}
export PATH

exec "$node_bin" "$@"
```

- [ ] **Крок 4: Зробити виконуваним і прогнати тести**

```bash
chmod +x .claude/hooks/node.sh
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit tests/unit/node-sh.spec.ts
```

Очікується: `6 passed`. Якщо падає тест про ворожий `PATH` — гілка 2 не знайшла nvm; якщо падає
тест про stdin — десь у скрипті є `read` без редиректу; якщо падає тест про заборонені утиліти —
дивись, який саме рядок його спричинив: у повідомленні названо утиліту.

- [ ] **Крок 5: Довести контракт «мажор справді береться з `.nvmrc`» — в обидва боки**

Той самий скрипт, два різні `.nvmrc`, дві різні поведінки. Справжній `.nvmrc` **не чіпається**:
він вхід хешу свіжості (задача 2), і підміна зробила б дерево несвіжим, а перервана підміна
лишила б у репозиторії `99`.

```bash
PROBE=$(mktemp -d)
mkdir -p "$PROBE/.claude/hooks"
cp .claude/hooks/node.sh "$PROBE/.claude/hooks/node.sh"

printf '99\n' > "$PROBE/.nvmrc"
printf '{}' | "$PROBE/.claude/hooks/node.sh" -e 'process.stdout.write("ok")'; echo "EXIT=$?"

printf '24\n' > "$PROBE/.nvmrc"
printf '{}' | "$PROBE/.claude/hooks/node.sh" -e 'process.stdout.write("ok")'; echo "EXIT=$?"

rm -rf "$PROBE"
```

Очікується: перший запуск — `{"systemMessage":"ХУК НЕ ЗАПУСТИВСЯ: не знайдено Node major 99
(.nvmrc)…"}` і `EXIT=0`; другий — `ok` і `EXIT=0`. Однакова відповідь на обидва `.nvmrc`
означає, що число зашите у скрипт, а файл читається для вигляду.

- [ ] **Крок 6: Перезапустити успадковані зелені**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
```

Очікується: усі три — вихід `0`. `node.sh` — не `.ts`, тож `check-types` його не бачить; `lint`
його теж не бачить (`eslint .` не лінтить `.sh`) — але `tests/unit/node-sh.spec.ts` бачать обидва,
і саме він міг щойно зламати успадковане зелене.

- [ ] **Крок 7: Коміт**

```bash
git add .claude/hooks/node.sh tests/unit/node-sh.spec.ts
git commit -m "feat(hooks): резолвер Node 24 для хуків

Хук не успадковує середовище інтерактивної оболонки: ні nvm, ні його PATH.
Без цього резолвера перевірка в хуку повідомила б UNRUNNABLE із неправильної
причини — а це виглядає як висновок про код, якого ніхто не перевіряв.

Самі лише вбудовані команди: ворожий або порожній PATH не має ламати саме
визначення шляхів. stdin не читається — на ньому лежить JSON події.

Мажор береться з .nvmrc, і тест це доводить підміною файлу. На чужому мажорі
скрипт свідомо не запускається: краще голосна відмова, ніж вердикт, отриманий
не тим інтерпретатором.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: `.claude/hooks/edit-check.mjs` — `PostToolUse`, lead після редагування

Перша з двох точок, де шар торкається сесії. Вона **не дає статусу** — статус дає лише гейт із
задачі 10. Тут — lead: назвати ризик одразу після редагування, поки контекст свіжий.

**Files:**
- Create: `.claude/hooks/edit-check.mjs`
- Create: `.claude/hooks/edit-check.d.mts` (та сама причина, що й `hash.d.mts` у задачі 2:
  `.ts`-тест імпортує `.mjs`, а `allowJs: false` + `strict` дають `TS7016`)
- Test: `tests/unit/edit-check.spec.ts`

**Interfaces:**
- Consumes: `sourceHash` із `scripts/verify/hash.mjs` (задача 2) — **включно з виправленим
  `SOURCE_PREFIXES`, що містить `'src/'`**; `.claude/hooks/node.sh` (задача 8);
  локальні `node_modules/typescript/bin/tsc` і `node_modules/eslint/bin/eslint.js`
  (обидва з задачі 1, жодної нової залежності)
- Consumes: блок Node-глобалів у `eslint.config.mjs`, який **створює задача 1** (R-10) і який
  уже покриває `.claude/hooks/**/*.mjs` разом зі `scripts/**/*.mjs`. Ця задача другого блоку
  **не додає**. Якщо після кроку 5 `npm run lint` червоніє на `no-undef` — це дефект того
  єдиного блоку в `eslint.config.mjs` (найімовірніше бракує глобала в літералі), і
  виправляється він там, а не другим блоком і не коментарем-глушником у хуку. Пакет
  `globals` не встановлюється: CLAUDE.md забороняє зайві залежності.
- Produces (експорти `edit-check.mjs`, оголошені в `edit-check.d.mts`):
  - `CODE_EXTENSIONS: string[]` — рівно `['.ts', '.tsx', '.mjs', '.js']` (список зі спеки §6.2 п.1, дослівно)
  - `IGNORED_PREFIXES: string[]` — `['reference/', '.next/', 'node_modules/', '.verify/']`
  - `isCheckablePath(relPath: string): boolean`
  - `parseTscErrors(stdout: string): { file: string; line: number; column: number; code: string; message: string }[]`
  - `formatLead(relPath: string, eslintText: string, errors: TscError[]): string`
  - `TYPECHECK_CACHE_DIR: string` — `.verify/typecheck/`

**Поправка до спеки, свідома.** §6.2 пише: «Цей шар не блокує — і не за моїм вибором.
Документація: для `PostToolUse` — `Can block? No`». Звірка показала, що `Can block? No`
стосується лише **скасування виклику інструмента**; канал зворотного зв'язку
`{"decision":"block","reason":…}` + exit 2 у `PostToolUse` існує. Отже неблокування тут — **вибір**,
і він лишається чинним із змістовної причини, названої в тій самій §6.2: посеред рефакторингу код
законно зламаний, і змушувати «чинити» файл 1 із 3 було б шкідливо. У коментарі файлу пишеться
саме ця причина, а не хибна посилка на документацію.

**Друга поправка (R-20).** Корінь дерева береться з поля `cwd` вхідного JSON, **не** з
`$CLAUDE_PROJECT_DIR`: у worktree змінна лишається на головному checkout, і хук лінтив би
не той файл, який щойно відредаговано. `$CLAUDE_PROJECT_DIR` лишається рівно однією річчю —
способом **знайти сам скрипт** у рядку команди `settings.json` (задача 11).
Якщо `cwd` у вхідному JSON усе-таки немає, хук відкочується на `$CLAUDE_PROJECT_DIR`, а
далі на `process.cwd()` — і **каже про це у своєму виводі**, бо мовчазна підміна дерева
неотличима від зеленого.

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/edit-check.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import {
  isCheckablePath,
  parseTscErrors,
  formatLead,
} from '../../.claude/hooks/edit-check.mjs';

test('isCheckablePath пропускає код і відкидає все інше', () => {
  expect(isCheckablePath('src/shared/config/map.ts')).toBe(true);
  expect(isCheckablePath('src/_pages/home/ui/leaflet-map.tsx')).toBe(true);
  expect(isCheckablePath('scripts/verify/run.mjs')).toBe(true);
  expect(isCheckablePath('eslint.config.mjs')).toBe(true);
  // Не код:
  expect(isCheckablePath('docs/tasks/SPRINT-01.md')).toBe(false);
  expect(isCheckablePath('src/_app/styles/globals.css')).toBe(false);
  expect(isCheckablePath('package.json')).toBe(false);
  // Заборонені префікси зі спеки §6.2 п.1:
  expect(isCheckablePath('reference/geodesy/latlon-spherical.js')).toBe(false);
  expect(isCheckablePath('.next/types/app.ts')).toBe(false);
  expect(isCheckablePath('node_modules/leaflet/index.js')).toBe(false);
});

test('parseTscErrors розбирає непроменений вивід tsc', () => {
  const stdout = [
    "src/shared/config/map.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "app/page.tsx(3,1): error TS2307: Cannot find module '@/_pages/home'.",
    'Found 2 errors in 2 files.',
  ].join('\n');

  const errors = parseTscErrors(stdout);
  expect(errors).toHaveLength(2);
  expect(errors[0]).toMatchObject({ file: 'src/shared/config/map.ts', line: 12, code: 'TS2322' });
  expect(errors[1]).toMatchObject({ file: 'app/page.tsx', line: 3, code: 'TS2307' });
});

test('formatLead ставить помилки відредагованого файлу першими', () => {
  const errors = parseTscErrors(
    [
      "app/page.tsx(3,1): error TS2307: Cannot find module 'x'.",
      "src/shared/config/map.ts(12,7): error TS2322: Type 'string' is not assignable.",
    ].join('\n'),
  );
  const lead = formatLead('src/shared/config/map.ts', '', errors);
  expect(lead.indexOf('TS2322')).toBeLessThan(lead.indexOf('app/page.tsx'));
});

test('formatLead НЕ ховає зламане в інших файлах — воно найдорожче', () => {
  const errors = parseTscErrors("app/page.tsx(3,1): error TS2307: Cannot find module 'x'.");
  const lead = formatLead('src/shared/config/map.ts', '', errors);
  expect(lead).toContain('app/page.tsx');
  // `toMatch(/1/)` тут не годиться: одиниця трапляється в будь-якому коді помилки
  // і в будь-якому номері рядка, тож така асерція зеленіла б і без лічильника.
  expect(lead).toContain('деінде: 1');
});

test('formatLead на чистому результаті не вигадує проблем', () => {
  expect(formatLead('src/shared/config/map.ts', '', [])).toBe('');
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit tests/unit/edit-check.spec.ts
```

Фільтр — шлях файлу, не `-g`: `-g` звужує за заголовком тесту, і дописаний згодом тест із іншим
заголовком тихо випав би з прогону.

Очікується: `Cannot find module '../../.claude/hooks/edit-check.mjs'`. Це та сама форма падіння,
що в задачі 2 крок 2 — файла ще немає.

- [ ] **Крок 3: Написати `.claude/hooks/edit-check.mjs`**

Реалізація в чотири кроки зі спеки §6.2, дослівно в тому ж порядку.

```js
// PostToolUse, матчер Edit|Write. Дає LEAD, не статус.
//
// Не блокує — це ВИБІР, а не обмеження документації: канал decision:"block"
// у PostToolUse існує. Причина вибору змістовна: посеред рефакторингу код
// законно зламаний, і змушувати «чинити» файл 1 із 3 було б шкідливо.
// Статус дає лише Stop-гейт.
//
// Корінь дерева — з поля cwd вхідного JSON, НЕ з $CLAUDE_PROJECT_DIR:
// у worktree змінна лишається на головному checkout.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { sourceHash } from '../../scripts/verify/hash.mjs';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
export const IGNORED_PREFIXES = ['reference/', '.next/', 'node_modules/', '.verify/'];
export const TYPECHECK_CACHE_DIR = '.verify/typecheck';

// Інструменти запускаються НЕ через `npx` і не за іменем із PATH: `npx tsc` працює
// тільки тому, що node.sh дописав PATH, і мовчки деградував би, якби хук колись
// покликали напряму. process.execPath — це той самий Node, що виконує цей файл,
// тобто рівно мажор із .nvmrc; шлях до пакета — локальний і однозначний.
const TSC_ENTRY = 'node_modules/typescript/bin/tsc';
const ESLINT_ENTRY = 'node_modules/eslint/bin/eslint.js';

export function isCheckablePath(relPath) {
  if (relPath.startsWith('../') || path.isAbsolute(relPath)) return false;
  if (IGNORED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
  return CODE_EXTENSIONS.includes(path.extname(relPath));
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export function parseTscErrors(stdout) {
  const errors = [];
  for (const line of stdout.split('\n')) {
    const match = TSC_LINE.exec(line.trim());
    if (match === null) continue;
    errors.push({
      file: match[1].split(path.sep).join('/'),
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4],
      message: match[5],
    });
  }
  return errors;
}

const MAX_LISTED = 10;

export function formatLead(relPath, eslintText, errors) {
  const parts = [];
  if (eslintText.trim() !== '') parts.push(`ESLint — ${relPath}:\n${eslintText.trim()}`);

  const here = errors.filter((error) => error.file === relPath);
  const elsewhere = errors.filter((error) => error.file !== relPath);

  if (here.length > 0) {
    const listed = here.slice(0, MAX_LISTED)
      .map((error) => `  ${error.file}:${error.line}:${error.column} ${error.code} ${error.message}`);
    parts.push(`Типи — у щойно відредагованому файлі (${here.length}):\n${listed.join('\n')}`);
  }

  // Зламане в іншому файлі НЕ ховається — воно найдорожче (спека §6.2 п.3).
  if (elsewhere.length > 0) {
    const files = [...new Set(elsewhere.map((error) => error.file))].slice(0, MAX_LISTED);
    parts.push(`Типи — помилок деінде: ${elsewhere.length} (${files.join(', ')})`);
  }

  return parts.join('\n\n');
}

/**
 * Весь проєкт, із ключуванням за хешем. Звуження тут було б фіктивним:
 * `tsc --noEmit <file>` дає TS5112 і не завантажує tsconfig.json, тобто
 * втрачає strict, jsx і типи Next. Звужується ЗВІТ, не перевірка.
 *
 * Кеш за хешем робить другу роботу — злиття паралельних редагувань:
 * три одночасні Edit дають один підсумковий хеш, тож один прогін tsc
 * відповідає на всі три.
 */
function typecheckErrors(root) {
  const { hash } = sourceHash(root);
  const cacheDir = path.join(root, TYPECHECK_CACHE_DIR);
  const cacheFile = path.join(cacheDir, `${hash}.json`);

  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    /* кешу немає або він пошкоджений — рахуємо заново */
  }

  let stdout = '';
  try {
    // --pretty false: ANSI-барви зробили б вивід нерозбірним для parseTscErrors.
    // Саме тому тут не npm run check-types (він з --pretty) — розбіжність свідома.
    stdout = execFileSync(
      process.execPath,
      [path.join(root, TSC_ENTRY), '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const errors = parseTscErrors(stdout);
  try {
    mkdirSync(cacheDir, { recursive: true });
    const temp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(errors));
    renameSync(temp, cacheFile); // атомарно: паралельні хуки не побачать напівзапису
    pruneCache(cacheDir);
  } catch {
    /* кеш — оптимізація, а не умова коректності */
  }
  return errors;
}

/**
 * R-23. Кожен запис іменується хешем, тож кожна правка лишає новий файл, а старі
 * не перезаписуються ніколи. Без прибирання `.verify/typecheck/` росте на одну
 * позицію з кожним редагуванням і за тиждень роботи стає тисячами файлів.
 *
 * Поріг — 24 години, як у `bumpBlockCount` задачі 10. Виклик стоїть УСЕРЕДИНІ того
 * самого `try`, що й запис: кеш — оптимізація, і невдале прибирання не має права
 * зламати хук, який інакше відпрацював.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function pruneCache(cacheDir) {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const name of readdirSync(cacheDir)) {
    const entry = path.join(cacheDir, name);
    try {
      if (statSync(entry).mtimeMs < cutoff) rmSync(entry, { force: true });
    } catch {
      /* запис зник під паралельним хуком — саме той результат, якого ми й хотіли */
    }
  }
}

function eslintOutput(root, relPath) {
  try {
    execFileSync(
      process.execPath,
      [path.join(root, ESLINT_ENTRY), '--format', 'stylish', relPath],
      { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    return '';
  } catch (error) {
    return `${error.stdout ?? ''}`;
  }
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0); // lead без входу неможливий; статус дає гейт, не цей хук
  }

  // R-20. Дерево вибирає поле `cwd` вхідного JSON — і тільки воно. $CLAUDE_PROJECT_DIR
  // лишається на головному checkout, коли сесія йде у worktree. Запасний шлях існує,
  // але він НЕ мовчазний: підміна дерева, про яку не сказали, — це звіт про чуже дерево.
  let root = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '';
  let rootFallbackNote = '';
  if (root === '') {
    root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    rootFallbackNote = `У вхідному JSON немає поля cwd. Дерево взяте з `
      + `${process.env.CLAUDE_PROJECT_DIR ? '$CLAUDE_PROJECT_DIR' : 'process.cwd()'}: `
      + `${root}. У worktree це може бути НЕ те дерево, яке ви редагуєте.`;
  }

  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string' || filePath === '') process.exit(0);

  const relPath = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  if (!isCheckablePath(relPath)) process.exit(0); // крок 1 спеки: тихий вихід 0

  const body = formatLead(relPath, eslintOutput(root, relPath), typecheckErrors(root));
  // Примітка про запасне дерево друкується навіть на порожньому lead: саме на
  // порожньому вона й потрібна — «нічого не знайшов» із чужого дерева нічого не варте.
  const lead = [rootFallbackNote, body].filter((part) => part !== '').join('\n\n');
  if (lead !== '') {
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: lead,
      },
    })}\n`);
  }
  process.exit(0);
}

// import.meta.filename, а не `file://${process.argv[1]}`: конкатенація ламається
// на шляхах із пробілом або не-ASCII (вони кодуються у file:// URL), і хук тоді
// тихо нічого не робив би, виглядаючи як зелене.
if (import.meta.filename === process.argv[1]) await main();
```

- [ ] **Крок 4: Написати `.claude/hooks/edit-check.d.mts`**

```ts
// Рукописні декларації: .ts-тест імпортує .mjs, а allowJs: false + strict
// дають TS7016. Заразом це документує публічний API хука.
export declare const CODE_EXTENSIONS: string[];
export declare const IGNORED_PREFIXES: string[];
export declare const TYPECHECK_CACHE_DIR: string;

export interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export declare function isCheckablePath(relPath: string): boolean;
export declare function parseTscErrors(stdout: string): TscError[];
export declare function formatLead(relPath: string, eslintText: string, errors: TscError[]): string;
```

- [ ] **Крок 5: Тести мають пройти, успадковані зелені — лишитися зеленими**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
```

Очікується: `check-types` — тиша, вихід `0` (саме тут доводиться, що `.d.mts` із кроку 4
робить свою роботу: приберіть його — і буде `TS7016`); `lint` — вихід `0`;
Playwright — `72 passed`: шістдесят сім із задач 2–8 і п'ять нових.

Якщо `lint` червоніє на `no-undef` для `process`/`Buffer` у `.claude/hooks/edit-check.mjs` —
це не дефект хука й не привід додавати другий блок: єдиний блок Node-глобалів живе в
`eslint.config.mjs` із задачі 1 (R-10) і вже перелічує `.claude/hooks/**/*.mjs`. Правити
треба саме його — дописати бракуючий глобал у той самий літерал. Глушити правило
коментарем у хуку — ні, бо тоді наступний `.mjs` принесе ту саму проблему знову.

- [ ] **Крок 6: Прогнати хук справжнім payload-ом — чистий файл**

Хук неможливо перевірити з сесії, яка не завантажила його на старті. Тому він перевіряється
прямим подаванням JSON у stdin — рівно тієї форми, яку Claude Code подає для `PostToolUse`.

```bash
ROOT=$(git rev-parse --show-toplevel)
printf '{"session_id":"probe","prompt_id":"11111111-1111-1111-1111-111111111111","cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/src/shared/config/map.ts"},"tool_response":{"success":true}}' "$ROOT" "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/edit-check.mjs; echo "EXIT=$?"
```

Очікується: **порожній stdout** і `EXIT=0`. Порожньо — бо дерево чисте: lead без знахідки не
вигадується. Якщо тут щось надрукувалось — або дерево справді зламане, або `formatLead` вигадує.

- [ ] **Крок 7: Прогнати хук на не-коді — доказ кроку 1 спеки**

```bash
ROOT=$(git rev-parse --show-toplevel)
printf '{"cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"%s/docs/tasks/SPRINT-01.md"}}' "$ROOT" "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/edit-check.mjs; echo "EXIT=$?"
```

Очікується: порожній stdout, `EXIT=0`, і — важливе — **менш ніж за 0,5 с**: `tsc` узагалі не
запускався. Бюджет саме такий, а не 0,2 с: у нього входять `sh`, старт Node і розбір самого
хука, тож 0,2 с червоніли б на правильній реалізації. Дискримінатор лишається чесним, бо
прогін `tsc` на цьому проєкті — одиниці секунд, не десяті. Якщо команда думає секунду, крок 1
спеки не реалізовано, і хук ганяє типи на кожному записі в `docs/`.

- [ ] **Крок 8: Навмисний злам — доказ, що хук бачить помилку і називає правильний файл**

Відкат — **копією, не `git checkout --`**: `git checkout -- <файл>` викинув би будь-яку законну
незакомічену правку цього файлу, яка зараз у роботі. Копія повертає рівно той стан, що був.

```bash
ROOT=$(git rev-parse --show-toplevel)
cp src/shared/config/map.ts /tmp/map-probe.bak
printf '\nconst PROBE: number = "рядок";\n' >> src/shared/config/map.ts
printf '{"cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/src/shared/config/map.ts"}}' "$ROOT" "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/edit-check.mjs; echo "EXIT=$?"
cp /tmp/map-probe.bak src/shared/config/map.ts && rm /tmp/map-probe.bak
```

Очікується: JSON із `hookSpecificOutput.additionalContext`, у якому є `TS2322` і
`src/shared/config/map.ts`, і **`EXIT=0` — хук не блокує**. Exit `2` тут означав би, що
реалізація блокує всупереч §6.2.

- [ ] **Крок 9: Навмисний злам в ІНШОМУ файлі — доказ, що воно не ховається**

```bash
ROOT=$(git rev-parse --show-toplevel)
cp src/shared/config/map.ts /tmp/map-probe.bak
printf '\nconst PROBE: number = "рядок";\n' >> src/shared/config/map.ts
printf '{"cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/app/page.tsx"}}' "$ROOT" "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/edit-check.mjs; echo "EXIT=$?"
cp /tmp/map-probe.bak src/shared/config/map.ts && rm /tmp/map-probe.bak
```

Очікується: `additionalContext` містить `помилок деінде` і назву `src/shared/config/map.ts`,
хоча редагували `app/page.tsx`. Це і є доказ рядка спеки «зламане в іншому файлі не ховається —
воно найдорожче». Порожній вивід тут = реалізація звузила **перевірку** замість **звіту**.

- [ ] **Крок 10: Доказ, що корінь береться з `cwd`, а не з `$CLAUDE_PROJECT_DIR`**

```bash
ROOT=$(git rev-parse --show-toplevel)
cp src/shared/config/map.ts /tmp/map-probe.bak
printf '\nconst PROBE: number = "рядок";\n' >> src/shared/config/map.ts
printf '{"cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/src/shared/config/map.ts"}}' "$ROOT" "$ROOT" \
  | CLAUDE_PROJECT_DIR=/tmp ./.claude/hooks/node.sh ./.claude/hooks/edit-check.mjs; echo "EXIT=$?"
cp /tmp/map-probe.bak src/shared/config/map.ts && rm /tmp/map-probe.bak
```

Очікується: той самий звіт із `TS2322`, попри `CLAUDE_PROJECT_DIR=/tmp`. Якби корінь брався зі
змінної, хук пішов би перевіряти `/tmp` і повернув порожньо — тобто зелене з чужого дерева.

- [ ] **Крок 11: Коміт**

```bash
git add .claude/hooks/edit-check.mjs .claude/hooks/edit-check.d.mts tests/unit/edit-check.spec.ts
git commit -m "feat(hooks): edit-check — lead після редагування

PostToolUse на Edit|Write. Дає lead, не статус: посеред рефакторингу код
законно зламаний, і змушувати чинити файл 1 із 3 було б шкідливо. Канал
блокування в PostToolUse існує — неблокування тут вибір, а не обмеження.

Типи перевіряються по всьому проєкту, бо tsc --noEmit <file> дає TS5112 і
втрачає tsconfig. Звужується звіт, не перевірка: спершу помилки у щойно
відредагованому файлі, далі лічильник помилок деінде.

Корінь дерева береться з поля cwd вхідного JSON. У worktree
CLAUDE_PROJECT_DIR лишається на головному checkout, і хук перевіряв би не те
дерево, яке редагують.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: `.claude/hooks/stop-gate.mjs` — `Stop`, єдине місце, де шар блокує

Вісім кроків §6.3 спеки переносяться сюди **дослівно** й реалізуються в тому ж порядку.

> 1. Прочитати stdin JSON із коротким запобіжником на таймаут. Зависле читання не має вішати хід — але й **не має тихо вважатися порожнім**: порожнє читання загубило б `prompt_id` і вимкнуло лічильник блокувань.
> 2. Якщо `stop_hook_active === true` → вихід `0`. Прапорець означає строго «Claude продовжує, бо Stop-хук раніше заблокував зупинку».
> 3. Запустити `node scripts/verify/run.mjs --tier fast --reuse-if-fresh --json`.
> 4. **Раннер не дав придатного результату** (падіння, таймаут, нерозбірний звіт) → `{"systemMessage": "ГЕЙТ НЕ ВІДПРАЦЮВАВ — не заявляй успіх"}`, вихід `0`. Fail open, але голосно.
> 5. **Зелено** → скинути лічильник. Якщо був бодай один `SKIPPED` → `systemMessage`, який вимагає сказати це вголос у відповіді. «Зелено, але X пропущено» — інше твердження, ніж «зелено».
> 6. **Червоно** → таблиця провалів (статус + id + коротка причина), обрізана **за байтами через `Buffer`**, не за довжиною рядка. Тут це не теоретично: весь текст проєкту українською, тобто двобайтовий, і наївний `slice` ріже літеру навпіл. Далі — `{"decision": "block", "reason": "…"}` і вихід `2`.
> 7. **Межа livelock:** лічильник на `prompt_id` у `.verify/gate-counter/`, максимум 2 поспіль. Далі гейт перестає блокувати й натомість вимагає відкрити відповідь явною заявою «досі червоно, ось що падає». Claude Code має власну межу у 8 блокувань — наша суворіша й спрацьовує раніше.
> 8. **Запис перед `process.exit`** — циклом за байтовим зсувом у сирий fd, із повтором на `EAGAIN`. Асинхронний запис у pipe обрізається синхронним `process.exit` одразу після нього; це різниця між тим, чи причина блокування дійде до моделі, чи прийде порожньою.

**Files:**
- Create: `.claude/hooks/stop-gate.mjs`
- Create: `.claude/hooks/stop-gate.d.mts`
- Test: `tests/unit/stop-gate.spec.ts`

**Interfaces:**
- Consumes: `scripts/verify/run.mjs` — режим `--tier fast --reuse-if-fresh --json`;
  `.claude/hooks/node.sh` (задача 8)
- Consumes: форму, яку друкує `run.mjs --json`. Вона **зафіксована** задачею 3 (R-16) і
  цитується тут дослівно — гейт читає з неї `results`:

  ```json
  {
    "tier": "fast",
    "root": "/абсолютний/шлях",
    "noSkip": false,
    "sourceHash": "…",
    "results": [
      { "id": "typecheck", "status": "PASSED", "reason": "", "durationMs": 0 }
    ]
  }
  ```

  Запобіжник `Array.isArray(report?.results)` лишається на місці й після фіксації: якщо
  форма колись розійдеться, гейт дасть `systemMessage` «ГЕЙТ НЕ ВІДПРАЦЮВАВ» — fail open
  голосно, ніколи фальшиве зелене.
- Consumes: єдиний блок Node-глобалів у `eslint.config.mjs` із задачі 1 (R-10), який уже
  перелічує `.claude/hooks/**/*.mjs` — та сама примітка, що в задачі 9.
- Produces (експорти, оголошені в `stop-gate.d.mts`):
  - `REASON_MAX_BYTES: number` (4096)
  - `MAX_CONSECUTIVE_BLOCKS: number` (2)
  - `truncateUtf8(text: string, maxBytes: number): string`
  - `formatFailureTable(results: CheckResult[]): string`
  - `counterKey(input: unknown): string`
  - `blockCount(root, key): number`, `bumpBlockCount(root, key): number`, `resetBlockCount(root, key): void`
  - `writeAllSync(fd: number, text: string): void`

**Дві поправки до спеки.** (1) Корінь дерева — з поля `cwd`, не з `$CLAUDE_PROJECT_DIR`: інакше
гейт прогнав би раннер по головному checkout, поки Claude редагує worktree, і видав би зелене з
іншого дерева — гірше за відсутність гейту, бо виглядає як факт. (2) Формулювання «Claude Code
має власну межу у 8 блокувань» уточнюється до «межа за замовчуванням 8, змінна
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`»: наша межа суворіша за дефолтну, а не за будь-яку.

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/stop-gate.spec.ts`:

```ts
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import {
  REASON_MAX_BYTES,
  MAX_CONSECUTIVE_BLOCKS,
  truncateUtf8,
  formatFailureTable,
  counterKey,
  blockCount,
  bumpBlockCount,
  resetBlockCount,
} from '../../.claude/hooks/stop-gate.mjs';

test('truncateUtf8 ріже за байтами і ніколи не ділить літеру навпіл', () => {
  // Кирилиця — два байти на літеру: наївний slice тут ламається.
  const text = 'ї'.repeat(500);
  const cut = truncateUtf8(text, 100);
  expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(100);
  expect(cut).not.toContain('�'); // жодного розрізаного символу
  expect(cut).toContain('обрізано');
});

test('truncateUtf8 не чіпає текст, що вміщається', () => {
  expect(truncateUtf8('типи зламані', REASON_MAX_BYTES)).toBe('типи зламані');
});

test('formatFailureTable друкує статус, id і причину — і лише блокувальні рядки', () => {
  const table = formatFailureTable([
    { id: 'typecheck', status: 'FAILED', reason: 'TS2322 у src/shared/config/map.ts' },
    { id: 'lint', status: 'PASSED', reason: '' },
    { id: 'build', status: 'NOT_RUN', reason: 'впав typecheck' },
    { id: 'e2e', status: 'UNRUNNABLE', reason: 'spawn ENOENT' },
  ]);
  expect(table).toContain('FAILED');
  expect(table).toContain('typecheck');
  expect(table).toContain('TS2322');
  expect(table).toContain('NOT_RUN');
  expect(table).toContain('UNRUNNABLE');
  expect(table).not.toContain('lint'); // PASSED не блокує і в таблиці провалів не місце
});

test('counterKey бере prompt_id, а за його відсутності не вимикає лічильник', () => {
  expect(counterKey({ prompt_id: 'p-1', session_id: 's-1' })).toBe('p-1');
  expect(counterKey({ session_id: 's-1' })).toBe('s-1');
  expect(counterKey({})).not.toBe(''); // ключ є завжди — інакше межа livelock зникає
});

test('counterKey знешкоджує шлях: ключ не може вийти з теки лічильників', () => {
  const key = counterKey({ prompt_id: '../../escape' });
  expect(key).not.toContain('/');
  expect(key).not.toContain('..');
});

test('лічильник рахує поспіль і скидається', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-gate-'));
  try {
    expect(blockCount(root, 'p-1')).toBe(0);
    expect(bumpBlockCount(root, 'p-1')).toBe(1);
    expect(bumpBlockCount(root, 'p-1')).toBe(2);
    expect(blockCount(root, 'p-1')).toBe(MAX_CONSECUTIVE_BLOCKS);
    resetBlockCount(root, 'p-1');
    expect(blockCount(root, 'p-1')).toBe(0);
    // Лічильники різних промптів не змішуються.
    expect(bumpBlockCount(root, 'p-2')).toBe(1);
    expect(readdirSync(path.join(root, '.verify/gate-counter')).length).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit tests/unit/stop-gate.spec.ts
```

Фільтр — шлях файлу, не `-g`, із тієї самої причини, що в задачах 8 і 9.

Очікується: `Cannot find module '../../.claude/hooks/stop-gate.mjs'`.

- [ ] **Крок 3: Написати `.claude/hooks/stop-gate.mjs`**

```js
// Stop-гейт. Єдине місце шару, де з'являється СТАТУС, а не lead.
// Вісім кроків нижче пронумеровані за §6.3 спеки й ідуть у тому ж порядку.
//
// Корінь дерева — з поля cwd вхідного JSON, НЕ з $CLAUDE_PROJECT_DIR: у worktree
// змінна лишається на головному checkout, і гейт видав би зелене з іншого дерева,
// ніж те, де є зміна. Це гірше за відсутність гейту, бо виглядає як факт.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';

export const REASON_MAX_BYTES = 4096;
export const MAX_CONSECUTIVE_BLOCKS = 2;
export const COUNTER_DIR = '.verify/gate-counter';
const STDIN_TIMEOUT_MS = 5_000;
const RUNNER_TIMEOUT_MS = 240_000; // менше за timeout: 300 у settings.json
const BLOCKING = new Set(['FAILED', 'NOT_RUN', 'UNRUNNABLE']);

/** Крок 6: обрізання ЗА БАЙТАМИ. Українська — двобайтова; наївний slice ріже літеру навпіл. */
export function truncateUtf8(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  const suffix = Buffer.from('\n…(обрізано)', 'utf8');
  let end = Math.max(0, maxBytes - suffix.length);
  // Відкотитися до початку UTF-8 послідовності: 10xxxxxx — продовження, не початок.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8') + suffix.toString('utf8');
}

export function formatFailureTable(results) {
  return results
    .filter((result) => BLOCKING.has(result.status))
    .map((result) => `${result.status.padEnd(10)} ${result.id} — ${result.reason || 'без причини'}`)
    .join('\n');
}

/** Крок 7: ключ лічильника. Без ключа межа livelock зникає, тож ключ є завжди. */
export function counterKey(input) {
  const raw = [input?.prompt_id, input?.session_id, 'unknown']
    .find((value) => typeof value === 'string' && value !== '');
  return String(raw).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function counterFile(root, key) {
  return path.join(root, COUNTER_DIR, key);
}

export function blockCount(root, key) {
  try {
    const value = Number.parseInt(readFileSync(counterFile(root, key), 'utf8'), 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function bumpBlockCount(root, key) {
  const next = blockCount(root, key) + 1;
  const dir = path.join(root, COUNTER_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(counterFile(root, key), String(next));
  // Прибирання: лічильники старші за добу вже нічого не стережуть.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
    } catch { /* гонка з паралельним хуком — не критично */ }
  }
  return next;
}

export function resetBlockCount(root, key) {
  rmSync(counterFile(root, key), { force: true });
}

/**
 * Крок 8: синхронний запис у сирий fd циклом за байтовим зсувом.
 * Асинхронний запис у pipe обрізається синхронним process.exit одразу після нього —
 * це різниця між тим, чи причина блокування дійде до моделі, чи прийде порожньою.
 */
export function writeAllSync(fd, text) {
  const buf = Buffer.from(text, 'utf8');
  const deadline = Date.now() + 2_000;
  let offset = 0;
  while (offset < buf.length) {
    try {
      offset += writeSync(fd, buf, offset, buf.length - offset);
    } catch (error) {
      if (error.code === 'EAGAIN') {
        if (Date.now() > deadline) return; // pipe не розсмоктується — не вішати хід
        continue;
      }
      if (error.code === 'EPIPE') return; // читач пішов
      throw error;
    }
  }
}

function loud(message) {
  writeAllSync(1, `${JSON.stringify({ systemMessage: message })}\n`);
  process.exit(0);
}

/** Крок 1: читання stdin із запобіжником. Таймаут НЕ вважається порожнім входом. */
function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    const timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
    process.stdin
      .on('data', (chunk) => chunks.push(chunk))
      .on('error', () => { clearTimeout(timer); resolve({ ok: false }); })
      .on('end', () => { clearTimeout(timer); resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') }); });
  });
}

async function main() {
  // 1
  const read = await readStdin(STDIN_TIMEOUT_MS);
  if (!read.ok) loud('ГЕЙТ НЕ ВІДПРАЦЮВАВ — не заявляй успіх (вхід гейта не прочитано)');

  let input;
  try {
    input = JSON.parse(read.text);
  } catch {
    loud('ГЕЙТ НЕ ВІДПРАЦЮВАВ — не заявляй успіх (вхід гейта нерозбірний)');
  }

  // 2 — строго «Claude продовжує, бо Stop-хук раніше заблокував зупинку».
  if (input.stop_hook_active === true) process.exit(0);

  // R-20. Дерево вибирає поле `cwd`, і тільки воно. Запасний шлях існує — і він НЕ
  // мовчазний: гейт, що перевірив чуже дерево й промовчав про це, дає фальшиве зелене.
  // Примітка нижче приклеюється до КОЖНОГО вердикту гейта, включно із зеленим.
  let root = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '';
  let rootNote = '';
  if (root === '') {
    const source = process.env.CLAUDE_PROJECT_DIR ? '$CLAUDE_PROJECT_DIR' : 'process.cwd()';
    root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    rootNote = `УВАГА: у вхідному JSON немає поля cwd. Дерево взяте з ${source}: ${root}. `
      + 'У worktree це може бути не те дерево, яке ви редагуєте.';
  }

  const key = counterKey(input);

  // 3
  let report;
  try {
    // process.execPath, а не 'node': голе ім'я працює лише тому, що node.sh дописав PATH,
    // і мовчки зникло б, якби гейт колись покликали напряму. Це той самий Node, що виконує
    // цей файл, тобто рівно мажор із .nvmrc.
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, 'scripts/verify/run.mjs'), '--tier', 'fast', '--reuse-if-fresh', '--json'],
      { cwd: root, encoding: 'utf8', timeout: RUNNER_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    );
    report = JSON.parse(stdout);
  } catch (error) {
    // Раннер міг вийти 1 і все одно дати придатний звіт — це ЧЕРВОНЕ, не поломка.
    try {
      report = JSON.parse(error.stdout ?? '');
    } catch {
      report = null;
    }
  }

  // 4 — fail open, але голосно.
  if (report === null || !Array.isArray(report?.results)) {
    loud('ГЕЙТ НЕ ВІДПРАЦЮВАВ — не заявляй успіх');
  }

  const failures = report.results.filter((result) => BLOCKING.has(result.status));
  const skipped = report.results.filter((result) => result.status === 'SKIPPED');

  // 5
  if (failures.length === 0) {
    resetBlockCount(root, key);
    if (skipped.length > 0) {
      const names = skipped.map((result) => `${result.id} (${result.reason || 'без причини'})`).join(', ');
      loud(`${rootNote}${rootNote === '' ? '' : '\n\n'}`
        + `Зелено, але ПРОПУЩЕНО: ${names}. Скажи це вголос у відповіді — «зелено, але X пропущено» `
        + 'не те саме, що «зелено».');
    }
    // Зелене мовчить — але не тоді, коли дерево обране запасним шляхом.
    if (rootNote !== '') loud(rootNote);
    process.exit(0);
  }

  // 7 — межа livelock. Дефолтна межа Claude Code — 8 блокувань поспіль
  // (змінна CLAUDE_CODE_STOP_HOOK_BLOCK_CAP); наша суворіша за дефолтну.
  const table = formatFailureTable(report.results);
  if (blockCount(root, key) >= MAX_CONSECUTIVE_BLOCKS) {
    resetBlockCount(root, key);
    loud(`Гейт блокував ${MAX_CONSECUTIVE_BLOCKS} рази поспіль і більше не блокує. `
      + `Відкрий відповідь явною заявою «досі червоно, ось що падає»:\n${truncateUtf8(table, REASON_MAX_BYTES)}`);
  }
  bumpBlockCount(root, key);

  // 6 + 8 — decision/reason ВЕРХНЬОГО рівня (для Stop саме так), exit 2.
  const reason = truncateUtf8(
    `${rootNote}${rootNote === '' ? '' : '\n\n'}Перевірка червона — зупинятись зарано:\n${table}`,
    REASON_MAX_BYTES,
  );
  writeAllSync(1, `${JSON.stringify({ decision: 'block', reason })}\n`);
  // Дубль у stderr: за exit 2 документація обіцяє показати моделі саме stderr.
  writeAllSync(2, `${reason}\n`);
  process.exit(2);
}

// import.meta.filename — та сама причина, що в задачі 9: конкатенація з file:// ламається
// на шляхах із пробілом або не-ASCII, і гейт тоді мовчки не запустився б.
if (import.meta.filename === process.argv[1]) await main();
```

- [ ] **Крок 4: Написати `.claude/hooks/stop-gate.d.mts`**

```ts
export interface CheckResult {
  id: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN' | 'UNRUNNABLE';
  reason: string;
}

export declare const REASON_MAX_BYTES: number;
export declare const MAX_CONSECUTIVE_BLOCKS: number;
export declare const COUNTER_DIR: string;

export declare function truncateUtf8(text: string, maxBytes: number): string;
export declare function formatFailureTable(results: CheckResult[]): string;
export declare function counterKey(input: unknown): string;
export declare function blockCount(root: string, key: string): number;
export declare function bumpBlockCount(root: string, key: string): number;
export declare function resetBlockCount(root: string, key: string): void;
export declare function writeAllSync(fd: number, text: string): void;
```

- [ ] **Крок 5: Тести й успадковані зелені**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
```

Очікується: усі три — вихід `0`; Playwright — `78 passed`: сімдесят два з задач 2–9 і шість
нових зі кроку 1. Червоне `lint` на `no-undef` для `process`/`Buffer` виправляється в
єдиному блоці Node-глобалів `eslint.config.mjs` із задачі 1 — примітка та сама, що в задачі 9
крок 5.

- [ ] **Крок 6: `stop_hook_active` — коротке замикання (крок 2 спеки)**

```bash
ROOT=$(git rev-parse --show-toplevel)
printf '{"session_id":"probe","prompt_id":"p-probe","cwd":"%s","hook_event_name":"Stop","stop_hook_active":true}' "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/stop-gate.mjs; echo "EXIT=$?"
```

Очікується: порожній stdout, `EXIT=0`, **і менш ніж за 0,5 с** — раннер не запускався. У бюджет
входять `sh`, старт Node і розбір хука, тож 0,3 с червоніли б на правильній реалізації;
дискримінатор лишається чесним, бо прогін раннера — одиниці секунд. Якщо команда думає секунди,
замикання не спрацювало, і гейт може зациклитись.

- [ ] **Крок 7: Зелене дерево — гейт відпускає**

```bash
ROOT=$(git rev-parse --show-toplevel)
printf '{"session_id":"probe","prompt_id":"p-green","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/stop-gate.mjs; echo "EXIT=$?"
```

Очікується: `EXIT=0` і **порожній stdout**. `e2e` тут узагалі ні до чого: гейт ганяє рівень
`fast`, а `e2e` — рядок рівня `full` (R-18, спека §3.3: `fast` виключає браузер, демон і
мережу), тож ані `ПРОПУЩЕНО`, ані `chromium` у цьому кроці з'явитися не можуть. Якщо
`systemMessage` зі словом `ПРОПУЩЕНО` усе ж надрукувався — це справжній пропуск у `fast`
(наприклад, `unit` без файлів тестів), і його треба розібрати, а не списати на браузер.

- [ ] **Крок 8: НАВМИСНИЙ ЗЛАМ — гейт мусить почервоніти (фаза 4 §12)**

Копія-відкат, а не `git checkout --`: останній викинув би законну незакомічену правку цього
файлу. Резервна копія живе до кроку 10 — злам потрібен трьом крокам поспіль.

```bash
ROOT=$(git rev-parse --show-toplevel)
cp src/shared/config/map.ts /tmp/map-probe.bak
printf '\nconst PROBE: number = "рядок";\n' >> src/shared/config/map.ts
printf '{"session_id":"probe","prompt_id":"p-red","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/stop-gate.mjs; echo "EXIT=$?"
```

Очікується: `EXIT=2`; у stdout — `{"decision":"block","reason":"…"}`, де `reason` містить
`FAILED` і `typecheck`; той самий текст у stderr. **Зелене тут означає, що гейт озброєний лише
на вигляд** — і саме цей стан §12 називає найгіршим. Файл поки НЕ відкочувати: наступні два кроки
працюють на тому ж зламі.

Окремо доводиться, що злам справді пройшов крізь хеш: `'src/'` у `SOURCE_PREFIXES` (виправлення
задачі 2). Без нього `--reuse-if-fresh` передрукував би старий `PASS`, і цей крок дав би `EXIT=0`
на зламаному коді.

- [ ] **Крок 9: Межа livelock — третє поспіль блокування не блокує**

```bash
ROOT=$(git rev-parse --show-toplevel)
for i in 1 2 3; do
  printf '{"session_id":"probe","prompt_id":"p-livelock","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$ROOT" \
    | ./.claude/hooks/node.sh ./.claude/hooks/stop-gate.mjs > /tmp/gate-$i.out 2>/dev/null; echo "RUN$i EXIT=$?"
done
cat /tmp/gate-3.out
```

Очікується: `RUN1 EXIT=2`, `RUN2 EXIT=2`, `RUN3 EXIT=0`, а `/tmp/gate-3.out` містить
`systemMessage` зі словами `досі червоно, ось що падає` і таблицею провалів. Лічильник у
`.verify/gate-counter/p-livelock` при цьому має зникнути (скидається на переході межі).

- [ ] **Крок 10: Відкат зламу — гейт мусить відпустити**

```bash
cp /tmp/map-probe.bak src/shared/config/map.ts && rm /tmp/map-probe.bak
ROOT=$(git rev-parse --show-toplevel)
printf '{"session_id":"probe","prompt_id":"p-red","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/stop-gate.mjs; echo "EXIT=$?"
ls .verify/gate-counter/ 2>/dev/null
```

Очікується: `EXIT=0` і **порожній перелік** `.verify/gate-counter/` для `p-red` — крок 5 спеки
вимагає скинути лічильник на зеленому. Гейт, який блокує й після виправлення, не менш зламаний,
ніж той, що не блокує ніколи.

- [ ] **Крок 11: Зламаний раннер — fail open, але голосно (крок 4 спеки)**

`mv` тут не годиться: перерваний посеред прогону, він лишив би репозиторій **без** `run.mjs` —
тобто зламав би шар, який цей крок перевіряє. Раннер натомість тимчасово замінюється на такий,
що друкує нерозбірне; це та сама гілка кроку 4 спеки («нерозбірний звіт»), і відкат — копією.

```bash
ROOT=$(git rev-parse --show-toplevel)
cp scripts/verify/run.mjs /tmp/run-probe.bak
printf 'process.stdout.write("це не JSON\\n");\n' > scripts/verify/run.mjs
printf '{"session_id":"probe","prompt_id":"p-broken","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$ROOT" \
  | ./.claude/hooks/node.sh ./.claude/hooks/stop-gate.mjs; echo "EXIT=$?"
cp /tmp/run-probe.bak scripts/verify/run.mjs && rm /tmp/run-probe.bak
```

Очікується: `EXIT=0` і stdout рівно
`{"systemMessage":"ГЕЙТ НЕ ВІДПРАЦЮВАВ — не заявляй успіх"}`. Ні `EXIT=2` (це стверджувало б щось
про код, якого ніхто не перевірив), ні тиша (це прочиталося б як зелене).

- [ ] **Крок 12: Коміт**

```bash
git add .claude/hooks/stop-gate.mjs .claude/hooks/stop-gate.d.mts tests/unit/stop-gate.spec.ts
git commit -m "feat(hooks): stop-gate — єдине місце, де шар блокує

Вісім кроків §6.3 спеки, у тому ж порядку. Зависле читання stdin не вважається
порожнім входом: порожнє читання загубило б prompt_id і вимкнуло межу livelock.

Обрізання причини — за байтами через Buffer: увесь текст проєкту українською,
тобто двобайтовий, і наївний slice ріже літеру навпіл. Запис у stdout —
синхронним циклом у сирий fd із повтором на EAGAIN, бо асинхронний запис у pipe
обрізається наступним process.exit, і причина блокування прийшла б порожньою.

Раннер без придатного результату дає systemMessage і вихід 0: fail open, але
голосно. Повідомити «перевірка впала», коли вона не могла запуститися, означало б
стверджувати щось про код, якого ніхто не перевіряв.

Корінь дерева — з поля cwd: у worktree CLAUDE_PROJECT_DIR лишається на головному
checkout, і гейт віддав би зелене з іншого дерева, ніж те, де є зміна.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: `.claude/settings.json` — вмикання

Три попередні задачі написали хуки, яких ніщо не викликає. Ця задача — рівно один файл і рівно
той JSON, що у спеці §6.4.

**Files:**
- Modify: `.claude/settings.json` (у файлі вже є ключ `enabledPlugins` — його **не втратити**)
- Test: `tests/unit/settings-hooks.spec.ts`

**Interfaces:**
- Consumes: `.claude/hooks/node.sh` (8), `.claude/hooks/edit-check.mjs` (9), `.claude/hooks/stop-gate.mjs` (10)
- Produces: увімкнені події `PostToolUse` (матчер `Edit|Write`, timeout 120) і `Stop` (без матчера, timeout 300)

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/settings-hooks.spec.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// Типи, а не `as any`: `@typescript-eslint/no-explicit-any` із eslint-config-next
// зробив би `npm run lint` червоним, а крок 4 обіцяє вихід 0. Заразом опис форми
// конфігу — те, що перевіряє тест, стає видимим у самому тесті.
interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

interface Settings {
  enabledPlugins?: Record<string, boolean>;
  hooks?: Record<string, HookEntry[] | undefined>;
}

function settings(): Settings {
  return JSON.parse(readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8')) as Settings;
}

test('вмикання не загубило наявний enabledPlugins', () => {
  expect(settings()).toHaveProperty('enabledPlugins');
});

test('PostToolUse увімкнено на Edit|Write із явним таймаутом 120', () => {
  const post = settings().hooks?.PostToolUse?.[0];
  expect(post).toBeDefined();
  expect(post?.matcher).toBe('Edit|Write'); // список точних збігів, регістрозалежний
  expect(post?.hooks[0].type).toBe('command');
  expect(post?.hooks[0].command).toContain('edit-check.mjs');
  expect(post?.hooks[0].command).toContain('node.sh'); // ніколи не голий node
  expect(post?.hooks[0].timeout).toBe(120); // дефолт 600 — гейт на десять хвилин зламаний
});

test('Stop увімкнено без матчера, із таймаутом 300', () => {
  const stop = settings().hooks?.Stop?.[0];
  expect(stop).toBeDefined();
  expect(stop?.matcher).toBeUndefined(); // Stop матчера не підтримує
  expect(stop?.hooks[0].command).toContain('stop-gate.mjs');
  expect(stop?.hooks[0].command).toContain('node.sh');
  expect(stop?.hooks[0].timeout).toBe(300);
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
source ~/.nvm/nvm.sh && nvm use && npx playwright test --project=unit tests/unit/settings-hooks.spec.ts
```

Очікується: `3 tests`, із них перший зелений (ключ `enabledPlugins` уже є), **два інші** падають
на `expect(post).toBeDefined()` / `expect(stop).toBeDefined()` — ключа `hooks` ще немає.

- [ ] **Крок 3: Дописати ключ `hooks` у `.claude/settings.json`**

Нижче — **фрагмент, не весь файл**: це значення, яке додається поруч із наявним
`enabledPlugins`, дослівно зі спеки §6.4. Замінити ним вміст `.claude/settings.json` цілком
означало б втратити `enabledPlugins` — саме це ловить перший тест кроку 1.

```json
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/node.sh \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/edit-check.mjs",
        "timeout": 120
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/node.sh \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/stop-gate.mjs",
        "timeout": 300
      }]
    }]
  }
```

Три речі, які тут **свідомо** саме такі:

- **`$CLAUDE_PROJECT_DIR` лишається** — і це не суперечить поправці задач 9 і 10. Змінна
  вказує, **де лежить скрипт** (він справді в головному checkout), а дерево, яке перевіряють,
  хуки беруть із поля `cwd`. Розділення обов'язків, а не непослідовність.
- **`Stop` без `matcher`** — подія матчера не підтримує й спрацьовує завжди.
- **Таймаути явні** — дефолт command-хука 600 с, а гейт, що висить десять хвилин, зламаний.
  `PostToolUse` і `Stop` не входять до подій зі зниженим дефолтом, тож 120 і 300 роблять рівно те,
  заради чого їх поставили.

- [ ] **Крок 4: Тести й успадковані зелені**

```bash
source ~/.nvm/nvm.sh && nvm use && npm run check-types && npm run lint && npx playwright test --project=unit
```

Очікується: усі три — вихід `0`; Playwright — `81 passed`: сімдесят вісім із задач 2–10
і **три нові**.

- [ ] **Крок 5: Довести, що записана команда справді працює — не оглядом, а запуском**

Конфіг може бути синтаксично правильним і при цьому вести в нікуди. Виконуємо рядок команди
руками. Увага: підстановка нижче — **не та, що зробить Claude Code**. Тут `CLAUDE_PROJECT_DIR`
навмисно вказує на активне дерево, і цим доводиться лише те, що **рядок команди синтаксично
працює й веде у справжні файли**. Що змінна вказуватиме на головний checkout — окреме питання
кроку 6, і цей крок його не закриває.

```bash
ROOT=$(git rev-parse --show-toplevel)
CLAUDE_PROJECT_DIR="$ROOT"
printf '{"session_id":"probe","prompt_id":"p-wire","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$ROOT" \
  | "$CLAUDE_PROJECT_DIR"/.claude/hooks/node.sh "$CLAUDE_PROJECT_DIR"/.claude/hooks/stop-gate.mjs; echo "EXIT=$?"

printf '{"cwd":"%s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/src/shared/config/map.ts"}}' "$ROOT" "$ROOT" \
  | "$CLAUDE_PROJECT_DIR"/.claude/hooks/node.sh "$CLAUDE_PROJECT_DIR"/.claude/hooks/edit-check.mjs; echo "EXIT=$?"
```

Очікується: обидва `EXIT=0` на чистому дереві. `sh: …: No such file or directory` тут означає
друкарську помилку в шляху всередині `settings.json` — саме те, чого огляд не ловить.

- [ ] **Крок 6: Перевірка вмикання в живій сесії — і чому вона окрема**

> **РІШЕННЯ КОНТРОЛЕРА R-21 — цей крок ВІДКЛАДЕНО. Не виконувати його в цій задачі.**
>
> Підстава. `$CLAUDE_PROJECT_DIR` вказує на **головний checkout** і не рухається за Claude
> у worktree (та сама властивість, заради якої задачі 9 і 10 беруть корінь із `cwd`).
> Наслідок: поки гілка не злита, у головному checkout немає ні `.claude/hooks/*`, ні ключа
> `hooks` у `.claude/settings.json` — тобто сесія, відкрита **у worktree**, або не побачить
> хуків узагалі, або спробує запустити неіснуючий шлях. Живий доказ вмикання тут фізично
> недосяжний, і будь-який «успіх», отриманий у цьому дереві, був би доказом про інше дерево.
>
> Обрано варіант (а): крок виконується **після злиття цієї гілки в `main`**, із сесії,
> відкритої в головному checkout. Варіант (б) — прибрати `$CLAUDE_PROJECT_DIR` із команди —
> **відхилено**: §6.4 спеки фіксує саме цю змінну, і вона тут правильна, бо відповідає на
> питання «де лежить скрипт», а не «яке дерево перевіряти».
>
> Що робить виконавець задачі 11: **не виконує** кроків нижче, не ставить галочку, і в звіті
> пише рівно одне речення — «крок 6 відкладено за R-21 до злиття в `main`». Задача 12
> записує його як **непідтверджений**, називаючи цю причину; записати його пройденим вона
> права не має.

Нижче — процедура для тієї майбутньої сесії, не для цієї. Хуки завантажуються на старті сесії,
тож **поточна сесія їх не побачить**. Після злиття в `main`: відкрити нову сесію Claude Code
в головному checkout, внести навмисну помилку типу
(`const PROBE: number = "рядок";` у `src/shared/config/map.ts`), попросити модель завершити хід і
спостерігати:

1. одразу після редагування — lead від `edit-check` із `TS2322`;
2. на спробі зупинитися — блокування від `stop-gate` із таблицею провалів;
3. після виправлення — зупинка проходить.

Це і є фаза 4 §12: «перевіряється НАВМИСНИМ ЗЛАМОМ, не оглядом коду». Кроки 5–11 задачі 10
доводять логіку хуків; цей крок доводить **вмикання**, і замінити його вони не можуть.
Результат записується в checkpoint (задача 12).

- [ ] **Крок 7: Коміт**

```bash
git add .claude/settings.json tests/unit/settings-hooks.spec.ts
git commit -m "feat(hooks): увімкнути PostToolUse і Stop

Таймаути задані явно: дефолт command-хука 600 с, а гейт, що висить десять
хвилин, зламаний. PostToolUse — 120, Stop — 300.

$CLAUDE_PROJECT_DIR тут вказує, ДЕ ЛЕЖИТЬ СКРИПТ: він справді в головному
checkout. Дерево, яке перевіряють, хуки беруть із поля cwd вхідного JSON —
інакше у worktree гейт перевіряв би не те дерево, що редагують.

Stop іде без матчера: подія матчера не підтримує. Edit|Write — список точних
збігів; MultiEdit не існує.

Ключ hooks між рівнями налаштувань зливається, тож settings.local.json
проєктні хуки не затре.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Що ці чотири задачі НЕ доводять

Дописується до §11 спеки разом із задачею 12:

- **Нічого про поведінку хуків усередині справжньої сесії, крім кроку 6 задачі 11.** Прогони з
  payload-ом у stdin доводять логіку хука; вони не доводять, що Claude Code викликає його саме так.
- **Нічого про паралельні виклики.** Документація Claude Code не обіцяє ні локів, ні порядку, ні
  обмеження конкурентності хуків. Кеш за хешем робить результат правильним попри це, але сам
  факт конкурентного виклику тут не перевіряється.
- **Нічого понад те, що форма `run.mjs --json` зафіксована на папері.** R-16 закріпив її
  дослівно в задачі 3, і задачі 4 та 10 цитують її у своїх Interfaces — розбіжність між
  документами більше не є відкритим питанням. Чого ці чотири задачі не доводять — що
  реалізація тієї форми дотримується: це доводять тести задачі 3, не хуки. Запобіжник
  `Array.isArray(report?.results)` лишається саме на цей випадок: розбіжність дасть голосне
  `ГЕЙТ НЕ ВІДПРАЦЮВАВ`, ніколи фальшиве зелене.
- **Нічого про те, чи Claude Code взагалі знайде ці хуки у worktree.** За R-21 живий доказ
  вмикання (задача 11, крок 6) **відкладено до злиття гілки в `main`** і виконується з сесії
  в головному checkout: `$CLAUDE_PROJECT_DIR` вказує на головний checkout, а скрипти до злиття
  лежать у гілці. Доти вмикання лишається **непідтвердженим**, і задача 12 записує його саме так.
- **`edit-check` може надрукувати фрагмент коду.** Повідомлення `tsc` містять типи-літерали
  (`Type '"…"' is not assignable`), тобто рядок із джерела може потрапити в `additionalContext`.
  Для секрету, вписаного в код, це канал витоку — вузький, але справжній. Стереже його рядок
  `no-secrets` (задача 6), не цей хук; у `blindSpot` це має бути сказано.

---

### Task 12: Розділ «Перевірка» в `CLAUDE.md` + матеріал для запису checkpoint

Остання задача, і єдина, чий результат читає людина, а не машина. Шар, який працює, але ніде не
описаний, лишає клієнта з трьома новими залежностями без пояснення і з питанням тижня («що
доводять тести вибору і **чого не доводять**») без відповіді. Тут же закривається борг
достовірності самої `CLAUDE.md`: після задач 1–11 три її твердження стали неправдою, і документ,
який агент читає як закон, не має права брехати.

**Files:**
- Modify: `CLAUDE.md` (новий розділ `## Перевірка`; правки в `Commands`, `Stack`,
  `Boundaries this sprint`, `Status`, у рядку про `docs/checkpoints/` і в переліку `docs/context/`)
- Create: `docs/context/verify-layer.md` — матеріал, який шар винен майбутньому запису checkpoint
- Test: `tests/unit/claude-md-registry.spec.ts`
- **Не створює:** `docs/checkpoints/TEMPLATE.md`, `docs/checkpoints/CHECKPOINT-0N.md`,
  саму теку `docs/checkpoints/` — див. крок 2; а також `scripts/verify/registry.d.mts` —
  його володілець задача 3, крок 6 (див. крок 4)

**Interfaces:**
- Consumes:
  - `CHECKS` із `scripts/verify/registry.mjs` (задача 3) — джерело істини для таблиці
    `proves`/`blindSpot`; поля, що читаються: `id`, `cmd`, `tier`, `after`, `proves`, `blindSpot`
  - `scripts/verify/registry.d.mts` — декларації для імпорту `.mjs` із `.ts`-тесту (той самий
    прийом, що `hash.d.mts` у задачі 2; без нього `check-types` дає `TS7016`)
  - npm-скрипти `verify`, `verify:full`, `verify:checkpoint` (задачі 3–4)
  - Playwright-проєкт `unit` (задача 1)
  - `.verify/last-run.json` (задача 4) — джерело для пункту 5 §10 спеки
- Produces:
  - розділ `## Перевірка` в `CLAUDE.md` — **єдине** людське місце, де живуть три команди, п'ять
    статусів, таблиця `proves`/`blindSpot`, виняток на три залежності та §11 спеки
  - `docs/context/verify-layer.md` — вказівник на цей розділ + слот під результат прогону +
    перелік прийнятих відхилень
  - `tests/unit/claude-md-registry.spec.ts` — стереже, щоб таблиця в `CLAUDE.md` не розійшлася
    з `registry.mjs`

---

- [ ] **Крок 1: Переконатися, що є що описувати**

Усі команди цієї задачі виконуються **з кореня робочого дерева** (там, де лежать `package.json` і
`playwright.config.ts`), і кожній передує перемикання на Node 24 — типовий Node цієї оболонки
v22, а `.nvmrc` пінить 24.

```bash
source ~/.nvm/nvm.sh && nvm use
node -v
npm run verify:full; echo "EXIT=$?"
```

Очікується: `v24.x.x`, далі — таблиця раннера й **`EXIT=0`**.

Зелений ворота тут — `verify:full`, **не** `verify:checkpoint`, і це не послаблення. Тека
`tests/e2e/` порожня до B-07 (спека §7: «порожня; наповнюється на B-07»), тож `emptyProbe` рядка
`e2e` чесно дає `SKIPPED — 0 тестів написано`. Без `--no-skip` пропуск не блокує → `EXIT=0`.
Під `--no-skip` той самий чесний пропуск стає блокувальним → `EXIT=1` **за побудовою**, і
вимагати від `verify:checkpoint` нуля сьогодні означало б вимагати неможливого — або, гірше,
підштовхувати виконавця «полагодити» правильну поведінку.

Що який результат **доводить**:

- `EXIT=0`, а єдиний `SKIPPED` — `e2e` з причиною «0 тестів написано» → шар описуваний, крок
  пройдено;
- `SKIPPED e2e` із причиною **«немає бінарника chromium»** (а не «0 тестів написано») → фонове
  завантаження з задачі 1 крок 4 не завершилося. Це правильна поведінка раннера, а не дефект:
  дочекатися й повторити. Описувати шар, у якого половина не бігла з технічної причини, не можна;
- будь-який `FAILED` чи `UNRUNNABLE` → **зупинитися**. Задача 12 нічого не лагодить: вона
  описує стан, а не створює його. Червоне повертається у задачу, що його внесла;
- `npm ERR! Missing script: "verify:full"` → задачі 3–4 не дописали скриптів у
  `package.json`. Це їхній борг; повернутися туди.

Далі — **спостереження**, не ворота:

```bash
source ~/.nvm/nvm.sh && nvm use
npm run verify:checkpoint; echo "EXIT=$?"
```

Очікується сьогодні `EXIT=1` і рівно одна блокувальна причина: `SKIPPED e2e — 0 тестів написано`.
Якщо причина одна й саме ця — це очікуваний червоний, і він фіксується в кроці 8 як факт про
стан спринту («checkpoint-прогін блокує доти, доки B-07 не напише жодного e2e-тесту»), а не як
дефект шару. Якщо блокувальних причин більше однієї або причина інша — діє попередній абзац:
зупинитися.

Зберегти обидва виводи — вони дослівно потрібні в кроках 8 і 9.

- [ ] **Крок 2: Зафіксувати відсутність шаблону — командою, не пам'яттю**

```bash
ls -la docs/checkpoints/ ; git ls-files docs/checkpoints/
```

Очікується: `ls: docs/checkpoints/: No such file or directory` і **порожній** вивід `git ls-files`.
Це доводить те, на чому тримається вся решта задачі: теки немає, `TEMPLATE.md` немає, і
`CLAUDE.md` рядком 21 посилається на файл, якого не існує.

**Що з цього випливає, і це не рішення виконавця.** Спека §10 сама це визнала: «Запис має лягти
в шаблон, коли той з'явиться; до того часу структура вище є пропозицією, не готовим записом».
`docs/tasks/ABOUT.md` каже, звідки шаблон прийде: «шаблон запису checkpoint — у
`docs/checkpoints/TEMPLATE.md`» — його **публікує автор курсу разом із матеріалами заняття**,
це не наш артефакт. `SPRINT-01` додає другу умову: запис робиться «після рішення про приймання»,
тобто після людини, а не в межах цієї задачі.

Отже задача 12 **не створює** ні `TEMPLATE.md` (вигаданий шаблон витіснив би справжній і
передався б клієнтові як наш), ні `CHECKPOINT-0N.md` (запис без рішення про приймання —
твердження про те, чого не було), ні порожньої теки `docs/checkpoints/` (`CLAUDE.md` прямо
забороняє теки «про запас»).

Натомість матеріал, який шар винен тому запису, лягає в `docs/context/verify-layer.md` — туди,
де `CLAUDE.md` уже поселила «project-local notes (not third-party)». Коли `TEMPLATE.md`
надійде, запис збирається звідти копіюванням, а не переписуванням.

- [ ] **Крок 3: Написати падаючий тест на розходження таблиці з реєстром**

Таблиця `proves`/`blindSpot` у `CLAUDE.md` — ручна копія даних із `registry.mjs`. Копія без
сторожа розходиться з оригіналом мовчки, і розійдеться вона саме там, де текст читає клієнт.
`CLAUDE.md` вимагає: «Every agreed value below lives in **one** config location»; сторож —
дешевий спосіб зробити цю вимогу правдою, а не побажанням.

**Це свідомий і названий вихід за межу спеки §2 — і саме той, який §2 передбачила.** Рядок
`memo` (сторож розходження документації) стоїть у таблиці «свідомо не будуємо» з тригером
«З'явиться разом із розділом «Перевірка» в `CLAUDE.md`». Розділ «Перевірка» з'являється **в цій
задачі**, отже тригер спрацьовує тут. Межу тесту закріпило рішення R-19: він стереже рівність
`CLAUDE.md` ↔ `registry.mjs` і **нічого більше** — не загальний docs-drift, не інші документи, не
`docs/`. Ширший сторож був би тим самим `memo` наперед, і його §2 забороняє. Це відхилення йде
рядком у таблицю кроку 8.

Створити `tests/unit/claude-md-registry.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import { CHECKS } from '../../scripts/verify/registry.mjs';

/**
 * Корінь беремо з `config.configFile`, а не з `process.cwd()`, не з `__dirname`
 * і **не** з `config.rootDir`. `cwd` залежить від того, звідки запустили;
 * Playwright виконує тест-файли у CJS-контексті, де `import.meta.url` ненадійний;
 * а `rootDir` — це `resolve(configDir, testDir)`, тобто за нашого `testDir: './tests'`
 * він дорівнює `<repo>/tests`, і `join(rootDir, 'CLAUDE.md')` дав би ENOENT.
 * Тека `playwright.config.ts` і є корінь репозиторію — за побудовою задачі 1.
 */
function repoRoot(): string {
  const configFile = test.info().config.configFile;
  if (!configFile) {
    throw new Error('Playwright запущено без файлу конфігурації — корінь репозиторію невизначений');
  }
  return path.dirname(configFile);
}

function readClaudeMd(): string {
  return readFileSync(path.join(repoRoot(), 'CLAUDE.md'), 'utf8');
}

/**
 * Таблиці перевірок живуть у підрозділі «Що кожна перевірка доводить» і ніде більше.
 * Вирізаємо саме його: у CLAUDE.md є інші таблиці, чия перша комірка теж є
 * ідентифікатором у зворотних лапках (`eslint`, `eslint-config-next`, …), і без
 * цього звуження тест на «зайві рядки» був би червоним назавжди — тобто не тестом.
 */
function checksSection(claudeMd: string): string {
  const start = claudeMd.indexOf('### Що кожна перевірка доводить');
  expect(start, 'у CLAUDE.md немає підрозділу «Що кожна перевірка доводить»').toBeGreaterThan(-1);
  const rest = claudeMd.slice(start);
  const end = rest.indexOf('\n### ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test('кожен рядок реєстру присутній у таблиці CLAUDE.md дослівно', () => {
  const section = checksSection(readClaudeMd());

  for (const check of CHECKS) {
    // Рівно один рядок таблиці на кожен id — інакше опис роздвоївся.
    const rows = section
      .split('\n')
      .filter((line) => line.startsWith(`| \`${check.id}\` |`));
    expect(rows, `рядок «${check.id}»: очікується рівно один`).toHaveLength(1);

    const row = rows[0] as string;
    expect(row, `cmd для «${check.id}» розійшовся з реєстром`).toContain(`\`${check.cmd}\``);
    expect(row, `proves для «${check.id}» розійшовся з реєстром`).toContain(check.proves);
    expect(row, `blindSpot для «${check.id}» розійшовся з реєстром`).toContain(check.blindSpot);
  }
});

test('у таблиці CLAUDE.md немає рядків, яких уже немає в реєстрі', () => {
  const section = checksSection(readClaudeMd());

  // Рядок таблиці перевірок: перша комірка — id у зворотних лапках,
  // друга починається зі зворотної лапки (cmd).
  const listed = [...section.matchAll(/^\| `([a-z0-9-]+)` \| `/gm)].map((m) => m[1]).sort();
  const registered = CHECKS.map((check) => check.id).sort();

  expect(listed).toEqual(registered);
});
```

Два напрямки навмисно різні: перший ловить **застарілий** текст у `CLAUDE.md`, другий —
**зайвий** рядок, що пережив видалення з реєстру. Один без одного залишає половину діри.

Відомий край, який треба знати заздалегідь: `toContain` порівнює `proves`/`blindSpot` дослівно,
а markdown вимагає екранувати `|` всередині комірки як `\|`. Якщо в реєстрі колись з'явиться
`proves` із вертикальною рискою — тест впаде, і це правильно: він змусить ухвалити рішення
(екранувати в реєстрі теж, чи нормалізувати в тесті), а не тихо розійтися.

- [ ] **Крок 4: Запустити — має впасти, і саме з правильної причини**

```bash
source ~/.nvm/nvm.sh && nvm use
npx playwright test --project=unit -g "CLAUDE.md"
```

Очікується одне з двох, і різниця істотна:

- `Cannot find module '../../scripts/verify/registry.mjs'` → задача 3 не виконана; зупинитися;
- обидва тести **падають**: перший — на «рядок «typecheck»: очікується рівно один» (або на
  відсутності підрозділу), другий — на нерівності списків. Правильний провал: реєстр є, розділу в
  `CLAUDE.md` ще немає. Саме це доводить, що тест дивиться на `CLAUDE.md`, а не проходить порожнім.

Якщо `check-types` при цьому дає `TS7016 Could not find a declaration file for module
'../../scripts/verify/registry.mjs'` — це означає, що **задача 3 не виконала свій крок 6**, який
створює `scripts/verify/registry.d.mts` (і `run.d.mts`, що імпортує з нього `Check` і `Tier`).
Декларації тут **не переписуються**: друга редакція того самого API розійдеться з першою, а
`run.d.mts` при цьому впаде на `TS2305` (немає експорту `Tier`). Повернутися в задачу 3 і
дописати крок 6 там.

Що саме має бути в тому файлі (для звірки, не для копіювання): `Tier`, `Check` з полями
`id`/`tier`/`cmd`/`needs`/`after`/`proves`/`blindSpot` та необов'язковими `timeoutMs` і
`emptyProbe`, `Precondition`, `DEFAULT_TIMEOUT_MS`, `CHECKS`, `PRECONDITIONS`. `allowJs: true`
в `tsconfig.json` не вмикати ні за яких обставин — це затягне в програму всі `.mjs` шару й хуків.

- [ ] **Крок 5: Написати розділ `## Перевірка` в `CLAUDE.md`**

Вставити **перед** розділом `## Agreed values` (після `## Commands`): розділ описує метод роботи,
а не узгоджені значення застосунку, і має стояти поруч із командами, які він пояснює.

Розділ українською всередині англійського документа — це свідомо. Текст `proves`/`blindSpot`
узгоджений українською й переноситься **дослівно**; переклад створив би другу редакцію тієї
самої угоди, тобто рівно те роздвоєння, проти якого написане правило «одне значення — одне місце».
Правки в наявних англійських розділах (кроки 6–7) лишаються англійською.

Комірки `cmd`, `proves` і `blindSpot` беруться **з `registry.mjs`**, а не зі спеки: реєстр — та
сама «one config location», і крок 3 стереже саме цю рівність. Базовий текст реєстру — таблиця §4
спеки; якщо котрась комірка від неї відрізняється, **виграє реєстр**: це прийнята ерата з
попередніх задач, вона йде в перелік відхилень кроку 8, а не «виправляється» назад.

Таблиця нижче вже враховує два такі розходження зі спекою §4, обидва внесені задачею 3:
`cmd` кличе npm-скрипти (`npm run --silent …`) і `npx playwright …`, а не голі бінарники, щоб
реєстр і розробник запускали **той самий** tsc/eslint; а `blindSpot` рядка `e2e` має третє
речення про `reuseExistingServer`. Перед вставкою **звірити кожну комірку з
`scripts/verify/registry.mjs` очима** — спека тут вторинна, а крок 7 усе одно впаде на
розходженні.

````markdown
## Перевірка

Шар перевірки — `scripts/verify/`. Реєстр перевірок — **дані, не скрипти**: єдине джерело істини
для таблиць нижче — `scripts/verify/registry.mjs`, а `tests/unit/claude-md-registry.spec.ts`
стежить, щоб цей розділ від нього не відстав.

### Три команди

| Команда | Що запускає | Коли |
| --- | --- | --- |
| `npm run verify` | рівень `fast` — усе, що не потребує браузера, демона, мережі | кожен хід агента; ціль — секунди |
| `npm run verify:full` | `fast` + `build` + `e2e` | перед передачею людині й перед checkpoint |
| `npm run verify:checkpoint` | `full` + `--no-skip`: пропуск стає провалом | момент запису checkpoint |

CI в цьому проєкті немає й не передбачено («localhost only, loopback only, nothing deployed»),
тож роль «моменту, коли пропуск недопустимий» відіграє checkpoint. Під `--no-skip` у запис не
може потрапити зелене, під яким половина не бігла.

### П'ять статусів

| Статус | Значення | Блокує |
| --- | --- | --- |
| `PASSED` | Виконалася, проблем не знайшла | ні |
| `FAILED` | Передумова була, перевірка виконалася, знайшла проблему | так |
| `SKIPPED` | Передумови справді не було (немає браузера, бінарника, 0 тестів). **Про код не говорить нічого** | лише за `--no-skip` |
| `NOT_RUN` | Перевірка з `after:` не запускалась, бо впала та, від якої вона залежить | так |
| `UNRUNNABLE` | Сама перевірка не змогла запуститися: `spawn ENOENT`, exit 127, нерозбірний вивід | так |

Розрізнення `FAILED` / `UNRUNNABLE` — не педантизм. Повідомити «перевірка впала», коли вона
ніколи не могла запуститися, означає стверджувати щось про код, який ніхто не перевіряв.
Окремо: Playwright із нульовою кількістю знайдених тестів дає `SKIPPED` з причиною «0 тестів
написано», а **не** `PASSED`.

### Що кожна перевірка доводить — і чого не доводить

Рівень `fast`:

| id | cmd | proves | blindSpot |
| --- | --- | --- | --- |
| `typecheck` | `npm run --silent check-types` | Кожен `.ts`/`.tsx` проєкту компілюється під `strict` із типами Next | Нічого про поведінку в рантаймі. `skipLibCheck: true` ховає помилки чужих `.d.ts`. Leaflet не виконується, тож звернення до `window` на рівні модуля тут скомпілюється успішно |
| `lint` | `npm run --silent lint` | Жоден файл не порушує правила `eslint-config-next` і базові правила TS | Стиль і статичні шаблони, не логіку. Правило, якого немає в конфігу, не порушується за визначенням |
| `unit` | `npx playwright test --project=unit` | Чисті функції поводяться як задано — для написаних випадків | Ні браузера, ні DOM, ні Leaflet. Про рендер і карту не говорить нічого. Випадок, якого ніхто не написав, не покритий |
| `no-ref-imports` | `node scripts/verify/checks/no-ref-imports.mjs` | Жоден файл застосунку чи тестів не має `import`/`require` із `reference/` — ні в рантаймі, ні на рівні типів | Тільки статичні літерали шляхів. Шлях, зібраний обчисленням у рантаймі, невидимий |
| `no-secrets` | `node scripts/verify/checks/no-secrets.mjs` | Жоден файл, що потрапляє до передачі, не містить рядків, схожих на ключ або токен | Порівняння за шаблонами: секрет у незвичному кодуванні або розбитий на рядки невидимий. Ігноровані git-ом файли не скануються — і не передаються |
| `deps-allowlist` | `node scripts/verify/checks/deps-allowlist.mjs` | `package.json` містить лише узгоджений набір; другого тестового раннера й другої бібліотеки карт немає | Тільки прямі залежності. Не доводить, що дозволена залежність узагалі використовується |

Рівень `full`:

| id | cmd | after | proves | blindSpot |
| --- | --- | --- | --- | --- |
| `build` | `npm run --silent build` | `typecheck` | Застосунок збирається і серверний рендер не звертається до `window` на рівні імпорту — запобіжник SSR для Leaflet | Нічого не натискає. Карта, що вийшла сірою, збірку проходить |
| `e2e` | `npx playwright test --project=e2e` | `build` | Поведінки вибору з B-07 виконуються у справжньому chromium проти dev-сервера | **Рух не перевіряє** — перевірка руху з керованим часом належить R3. Тайли заблоковані, тож про справжні зображення карти не говорить нічого. Не доводить, що dev-сервер зібрано саме з цього дерева: `reuseExistingServer: true` прийме вже піднятий сервер іншої гілки |

**`no-secrets` не друкує знайдене.** Звіт дає `file:line` і маркер типу, ніколи сам рядок —
інакше перевірка порушувала б правило, яке охороняє.

### Рух перевіряється візуально

Комірка `blindSpot` рядка `e2e` виконує пряму вимогу SPRINT-01, рядок 46: «Рух цього тижня
перевіряється візуально; автоматична перевірка руху з керованим часом - завдання релізу R3, і в
записі checkpoint це так і записується». Жодна з восьми перевірок не дивиться на рух, і це не
прогалина реалізації, а межа, узгоджена на цей спринт.

### Три залежності — свідомий виняток

| Пакет | Версія | Навіщо |
| --- | --- | --- |
| `eslint` | `9.39.5` | рядок `lint`. Саме 9.x: власний peer-діапазон `eslint-config-next` (`>= 9`) формально дозволяє 10, але плагіни, які він тягне залежностями — `eslint-plugin-react@^7.37` (`… \|\| ^9.7`), `eslint-plugin-jsx-a11y@^6.10` (`… \|\| ^9`) і `eslint-plugin-import@^2.32` (`… \|\| ^9`) — **не заявляють `^10`**. Тобто 9.x тут не обережність, а єдиний варіант без peer-конфлікту |
| `eslint-config-next` | `16.3.5` | точно під `next@16.3.5` |
| `@playwright/test` | `1.63.0` | рядки `unit` і `e2e`; передбачений B-07 |

Це виняток із правила «no extra dependencies» у розділі Boundaries, і він свідомий: усі три —
**інструменти перевірки, не залежності застосунку**, жодна не потрапляє до коду, що виконується в
браузері, а `@playwright/test` прямо передбачений критерієм B-07. Другий тестовий раннер **не
додається**: юніт-тести виконує Playwright Test окремим проєктом `unit` без браузера, тож
критерій B-07 «інших тестових фреймворків немає» лишається виконаним — і це стереже рядок
`deps-allowlist`.

### Чого цей шар не доводить

Розділ обов'язковий: шар, який не називає власних сліпих плям, сам стає тим, від чого мав би
берегти.

- **Нічого візуального.** Сіра карта, картка, що роз'їхалася, значок під неправильним кутом — усе
  це проходить усі вісім рядків. SPRINT-01 покладає це на очі, і так і лишається.
- **Нічого про рух.** Свідомо, до R3.
- **Нічого про формати з ТЗ**, поки хтось не напише unit-тест на кожен. Порожня тека
  `tests/unit/` дає `SKIPPED`, а не `PASSED` — саме щоб ця діра була видима.
- **Нічого про судження моделі.** Findings Клода лишаються lead: хук їх не рахує й не може
  перевірити. Це припис у тексті блокування, а не механізм.
- **Нічого про те, що Claude Code справді вантажить ці хуки.** `.claude/hooks/edit-check.mjs` і
  `.claude/hooks/stop-gate.mjs` покриті юніт-тестами, і ті доводять поведінку скриптів на заданому
  вході — але не те, що агент їх викликає. Жива перевірка навмисною поломкою відкладена до злиття
  гілки в `main` і виконується з сесії, відкритої в основному checkout: доти в `main` немає ні
  файлів хуків, ні ключа `hooks` у `.claude/settings.json`, тож доводити там нічого. До того дня
  увімкнення лишається **непідтвердженим**, і юніт-тести за доказ увімкнення не видаються.
- **Нічого про те, чого немає в реєстрі.** Реєстр — межа того, що шар узагалі бачить.

Уточнення до третього пункту, чинне на сьогодні: тека `tests/unit/` більше не порожня — у ній
живуть тести самого шару перевірки. Рядок `unit` дає `PASSED` за них, і **не** за формати картки:
жодного тесту на формати ще ніхто не написав. Механізм видимості діри змінився, сама діра — ні.
````

- [ ] **Крок 6: Виправити в `CLAUDE.md` те, що стало неправдою**

Після задач 1–11 кілька тверджень документа стали хибними, і кожне хибне саме там, де агент читає
його як дозвіл, заборону або карту репозиторію. Правок шість: (а)–(е).

**(а) `## Commands`.** Рядок «Playwright commands arrive with B-07» неправдивий — вони вже тут.
Замінити абзац і блок цілком на:

````markdown
Run `nvm use` first — it reads `.nvmrc` (Node 24), the one place the version is pinned.

```
npm run dev      # http://localhost:3000 — binds 127.0.0.1:3000 explicitly; loopback only
npm run build    # next build — the SSR guard for Leaflet; run it as an acceptance check

npm run lint          # eslint .
npm run check-types   # tsc --noEmit

npm run verify             # the check registry, fast tier — run this after a change
npm run verify:full        # fast + build + e2e
npm run verify:checkpoint  # full, and a SKIPPED counts as a failure — see "Перевірка"

npx playwright test --project=unit          # unit tests: no browser, no dev server
npx playwright test --project=e2e           # browser tests; boots the dev server
npx playwright test                         # both projects; boots the dev server
npx playwright test path/to/file.spec.ts    # one file
npx playwright test -g "card opens"         # one test by name
```

Playwright's browser download is slow — run it in the background. Always pass `--project`: the
dev server is booted for any selection that can include `e2e`, and a server failure in a unit run
reads as a unit-test failure.
````

**(б) `## Stack`.** Розділ має заголовок «Stack (fixed by SPRINT-01)», а SPRINT-01 ESLint **не
згадує жодного разу** (перевірити: `grep -ci eslint docs/tasks/SPRINT-01.md` → `0`). Тому сам
рядок стеку **не чіпається**: дописати туди ESLint означало б приписати спринтові рішення, якого
він не ухвалював. Натомість додати два пункти нижче, які чесно називають походження:

```markdown
- Playwright Test runs two projects: `unit` (no browser) and `e2e` (chromium). Same runner, one
  config — there is still no second testing framework.
- ESLint 9 with a flat config came later, with the verify layer, not with SPRINT-01. It is a
  verification tool, not an application dependency — see "Перевірка".
```

**(в) `## Boundaries this sprint`.** «no extra dependencies» тепер читається як порушене.
Замінити цей фрагмент переліку на:

```markdown
no extra **application** dependencies — the three verification tools (`eslint`,
`eslint-config-next`, `@playwright/test`) are a deliberate exception, justified and recorded in
"Перевірка"
```

**(г) Рядок про checkpoint** (нині: «Checkpoints go in `docs/checkpoints/CHECKPOINT-0N.md`,
following `docs/checkpoints/TEMPLATE.md`»). Він указує на два файли, яких немає. Замінити на:

```markdown
Checkpoints go in `docs/checkpoints/CHECKPOINT-0N.md`, following `docs/checkpoints/TEMPLATE.md`.
Neither exists yet — the template arrives with the course materials, so do not invent one and do
not create the folder. What the verify layer owes that record is drafted in
`docs/context/verify-layer.md`.
```

**(д) `## Status`.** Дописати одне речення в кінець абзацу, щоб «що вже є» лишалося правдою:

```markdown
The verify layer (`scripts/verify/`, `.claude/hooks/`, `.claude/settings.json`) came after B-02;
it is working method, not a backlog item — see "Перевірка".
```

**(е) Перелік `docs/context/`.** Рядок «Project-local notes (not third-party) are in
`docs/context/`: `clean-code-ts.md`, and a Next.js note on lazy-loading client components…»
перелічує вміст теки поіменно, а крок 8 додає туди третій файл. Дописати його в той самий
перелік — інакше документ, який агент читає як карту, показує теку неповно:

```markdown
Project-local notes (not third-party) are in `docs/context/`: `clean-code-ts.md`, a Next.js note
on lazy-loading client components that bears on the client-only Leaflet mount in B-02, and
`verify-layer.md` — what the verify layer owes the checkpoint record.
```

(Точне формулювання звірити з чинним рядком: правка додає третій елемент, а не переписує
перші два.)

- [ ] **Крок 7: Прогнати все, що ця задача успадкувала зеленим**

```bash
source ~/.nvm/nvm.sh && nvm use
npx playwright test --project=unit; echo "EXIT=$?"
npm run check-types; echo "EXIT=$?"
npm run lint; echo "EXIT=$?"
```

Очікується: усі три — `EXIT=0`, і серед пройдених тестів обидва з кроку 3. Перехід «обидва падали
на «рядок «typecheck»: очікується рівно один» → обидва проходять» — це те, що доводить, що розділ
кроку 5 справді збігається з реєстром, а не схожий на нього.

Найімовірніша причина червоного тут — комірка `cmd` чи `blindSpot`, узята зі спеки §4 замість
`registry.mjs`. Виправляти **`CLAUDE.md`**, а не реєстр і не тест: реєстр — джерело істини, тест —
сама вимога.

`check-types` і `lint` тут не формальність: задача додала `.ts`-файл, який імпортує `.mjs`, — те
саме місце, де задача 2 колись отримала `TS7016`. Задача, що додає файл, зобов'язана перезапустити
всі зелені, які успадкувала.

- [ ] **Крок 8: Написати `docs/context/verify-layer.md`**

Спека §10 називає п'ять речей, які має записати checkpoint. Чотири з них — сталі й уже живуть у
розділі «Перевірка»; дублювати їх тут означало б завести другу редакцію тієї самої угоди.
П'ята — результат конкретного прогону — навмисно **не** записується заздалегідь: зафіксований
сьогодні, до дня checkpoint він застаріє, а видавати старий вердикт за свіжий — рівно та помилка,
проти якої побудований хеш свіжості в §3.4.

Шостий пункт — понад §10, на вимогу `docs/tasks/ABOUT.md`: запис checkpoint містить «які
відхилення від завдання прийняті й чому».

Спершу зібрати відхилення з історії, а не з пам'яті:

```bash
git log --format='%h %s%n%b' main..HEAD
```

Очікується: повідомлення комітів задач 1–11, у тілах яких названі причини. Перелік у файлі нижче
складається **з них**; пункт, якого немає в жодному коміті, у файл не потрапляє.

Створити `docs/context/verify-layer.md`:

````markdown
# Шар перевірки — матеріал для запису checkpoint

**Це не запис checkpoint і не шаблон.** `docs/checkpoints/TEMPLATE.md` ще не надійшов (перевірено
командою: теки `docs/checkpoints/` не існує), а сам запис робиться після рішення про приймання —
`SPRINT-01`, розділ «Checkpoint». Тут лежить те, що шар перевірки винен тому запису, у формі,
придатній до копіювання, коли шаблон з'явиться.

Спека шару: `docs/superpowers/specs/2026-09-15-verify-layer-design.md`, §10 — п'ять пунктів нижче.

## 1–4. Команди, таблиця `proves`/`blindSpot`, три залежності, рух

Усе чотири — у розділі **«Перевірка»** файлу `CLAUDE.md`. Копіювати звідти цілком; окремої
редакції тут навмисно немає, щоб текст не роздвоївся. Розділ містить:

1. що запускає кожна з `npm run verify`, `verify:full`, `verify:checkpoint`;
2. таблицю `proves` / `blindSpot` на всі вісім рядків — пряму відповідь на питання тижня «що
   доводять тести вибору і чого не доводять»;
3. три нові залежності як свідомий виняток, із обґрунтуванням;
4. явне: рух перевірено **візуально**, не тестом; автоматична перевірка руху з керованим часом —
   R3.

Плюс підрозділ «Чого цей шар не доводить» — його теж копіювати, він для того й написаний.

**Окремо й вголос, бо це стан на день написання, а не стала угода: увімкнення хуків —
непідтверджене.** Задача 11 крок 6 (жива перевірка того, що Claude Code вантажить
`PostToolUse` і `Stop`, доведена навмисною поломкою, а не переглядом коду — вимога спеки §12)
виконується **після злиття гілки в `main`, із сесії, відкритої в основному checkout**: доки
злиття не відбулося, в `main` немає ні `.claude/hooks/*`, ні ключа `hooks` у
`.claude/settings.json`, тож поломка не має де спрацювати. Запис checkpoint називає цей пункт
**непідтвердженим і з цієї причини**; юніт-тести обох скриптів зелені, але вони доводять
поведінку скриптів, а не те, що агент їх викликає. Видати одне за інше — саме та підміна, проти
якої написаний увесь цей файл.

## 5. Результат прогону — заповнюється в день checkpoint

Не заповнювати заздалегідь: вердикт, зафіксований раніше дня передачі, до неї застаріє, а стара
зелена таблиця, подана як свіжа, — та сама помилка, проти якої побудований хеш свіжості.

У день запису:

```
npm run verify:full        # ворота: EXIT=0
npm run verify:checkpoint  # той самий прогін, але пропуск блокує
```

У запис іде: дата й час прогону, підсумковий вихід (`0` або `1`) **кожної** з двох команд, таблиця
з термінала, і — окремим рядком — **назви пропущених перевірок, якщо такі були**, із причиною
кожного пропуску. Машинна копія того самого прогону лишається в `.verify/last-run.json` (файл у
`.gitignore`, у передачу не йде — беруться назви й статуси, не файл).

«Зелено, але X пропущено» — інше твердження, ніж «зелено», і в записі воно має звучати інакше.

**Стан на день написання цього файлу, який запис має назвати вголос:** `tests/e2e/` порожня
(спека §7: «порожня; наповнюється на B-07»), тож рядок `e2e` дає `SKIPPED — 0 тестів написано`.
Наслідок: `verify:full` зелений, а `verify:checkpoint` **червоний з єдиної причини** — саме цього
пропуску. Це не дефект шару, а правда про спринт: доки ніхто не написав жодного e2e-тесту, шар
відмовляється називати передачу повністю перевіреною. Коли B-07 напише тести, обидві команди
стають зеленими без жодної правки коду; якщо на день checkpoint `verify:checkpoint` червоний з
**іншої** чи з **додаткової** причини — запис не робиться, розбирається причина.

## 6. Прийняті відхилення

(Понад §10; вимагає `docs/tasks/ABOUT.md`: запис містить «які відхилення від завдання прийняті й
чому». Перелік складено з тіл комітів задач 1–11, не з пам'яті.)

| Відхилення | Причина |
| --- | --- |
| Хешується й сканується також `src/`, не лише `app/` | Репозиторій перейшов на Feature-Sliced Design після написання спеки: увесь код застосунку живе в `src/_app/`, `src/_pages/`, `src/shared/`, а в `app/` лишився тонкий вхід App Router. Перелік префіксів зі спеки §3.4 не побачив би майже нічого — ерата до спеки, не до коду |
| Поруч із `.mjs` шару лежать рукописні `.d.mts` (`hash`, `registry`, `run`) | `tsconfig.json` тримає `allowJs: false`, тож `.ts`-тест не бачить типів `.mjs` і дає `TS7016`. Вмикати `allowJs` не можна — це затягло б у програму всі `.mjs` шару й хуків |
| Хуки визначають корінь проєкту з поля `cwd` вхідного JSON, а не з `$CLAUDE_PROJECT_DIR` | У git worktree змінна вказує на основний checkout, і хук перевіряв би чуже дерево |
| `--project` приймає кілька значень | Так влаштований CLI Playwright (варіативний прапорець, підтримує `*`); одне значення було б вужче за інструмент |
| Фази 1 і 2 плану виконані у зворотному порядку | (Уточнити з `git log`; якщо в комітах такого немає — рядок видалити) |
| `cmd` у реєстрі кличе npm-скрипти (`npm run --silent …`), а не голі бінарники, як у таблиці спеки §4 | Інакше реєстр і розробник запускали б різні `tsc`/`eslint` і розходилися б непомітно |
| `blindSpot` рядка `e2e` довший за текст спеки §4 на речення про `reuseExistingServer` | §3.1 забороняє `blindSpot`, вужчий за реальність: `reuseExistingServer: true` прийме вже піднятий сервер іншої гілки |
| Є вузький сторож розходження `CLAUDE.md` ↔ `registry.mjs`, хоча §2 тримає `memo` в «свідомо не будуємо» | Тригер самої §2 — «З'явиться разом із розділом «Перевірка» в `CLAUDE.md`» — спрацював: розділ з'явився. Сторож стереже рівно цю пару файлів і не є загальним docs-drift |
| Жива перевірка увімкнення хуків (задача 11, крок 6) відкладена до злиття гілки в `main` і виконується з основного checkout | Спека §12 вимагає доводити фазу 4 навмисною поломкою, а не переглядом коду, а в `main` до злиття немає ні файлів хуків, ні ключа `hooks` — ламати нічого. Відкласти чесно, зімітувати — ні; доти увімкнення записане як **непідтверджене** |
````

Таблиця вище — **заготовка з уже відомих відхилень**, а не готовий перелік. Звірити кожен рядок
із виводом `git log`: рядок, якого немає в жодному тілі коміта, **видалити** (інакше файл
стверджує рішення, якого ніхто не ухвалював), а названу в коміті причину, якої немає в таблиці, —
**дописати**. Кожен рядок — одне речення «що зроблено інакше» і одне «чому», без переказу коду.

- [ ] **Крок 9: Довести, що передача не забруднена, і зафіксувати прогін**

```bash
source ~/.nvm/nvm.sh && nvm use
git status --short
node scripts/verify/hash.mjs --files | grep -E 'CLAUDE\.md|docs/context|\.verify/'; echo "GREP=$?"
npm run verify:full; echo "EXIT=$?"
```

Очікується:

- `git status --short` показує рівно три шляхи: `CLAUDE.md`, `docs/context/verify-layer.md`,
  `tests/unit/claude-md-registry.spec.ts`. **Жодного `.verify/`** — інакше `.gitignore` із задачі 2
  зламаний, і звіти шару поїдуть клієнтові. `scripts/verify/registry.d.mts` тут з'явитися не може:
  його комітить задача 3;
- `grep` по списку хешу **не знаходить нічого** (`GREP=1`). Це не недогляд: ні `CLAUDE.md`, ні
  `docs/` не годують жодної перевірки, тож правка прози не має протухлювати кеш. Якщо `docs/`
  раптом у списку — хтось розширив `SOURCE_PREFIXES` і зробив кеш шумним. Команда друкує **шляхи**,
  не вміст, — на файл із секретом вона не подивиться й поготів його не надрукує;
- `verify:full` — `EXIT=0`, при цьому `e2e` лишається `SKIPPED — 0 тестів написано` (та сама
  причина, що в кроці 1: `tests/e2e/` наповнює B-07). Це та сама команда, що в кроці 1, і тепер
  вона біжить уже з новим тестом усередині рядка `unit`: зелене тут доводить, що опис і реєстр
  збігаються не лише в окремому запуску тесту, а й у штатному прогоні шару.

`verify:checkpoint` тут навмисно **не** є воротами — з тієї самої причини, що в кроці 1: доки
`tests/e2e/` порожня, `--no-skip` дає `EXIT=1` за побудовою. Якщо його все ж прогнати для запису
(крок 8 цього чекає), єдиною блокувальною причиною має лишитися той самий `SKIPPED e2e`; будь-яка
друга причина — привід зупинитися.

- [ ] **Крок 10: Коміт**

```bash
git add CLAUDE.md docs/context/verify-layer.md tests/unit/claude-md-registry.spec.ts
git commit -m "docs: розділ «Перевірка» в CLAUDE.md і матеріал для запису checkpoint

Шар, який працює, але ніде не описаний, лишає клієнта з трьома новими
залежностями без пояснення і з питанням тижня — «що доводять тести вибору
і чого не доводять» — без відповіді. Розділ «Перевірка» відповідає на нього
таблицею proves/blindSpot і окремим підрозділом про те, чого шар не доводить
узагалі.

Таблиця — ручна копія даних із registry.mjs, тож копію стереже тест:
claude-md-registry.spec.ts падає і від застарілого тексту в CLAUDE.md, і
від рядка, що пережив видалення з реєстру.

Твердження CLAUDE.md, що стали неправдою, виправлені: «Playwright commands
arrive with B-07», «no extra dependencies», посилання на неіснуючий
docs/checkpoints/TEMPLATE.md і неповний перелік docs/context/. Рядок стеку
не чіпали: він має заголовок «fixed by SPRINT-01», а SPRINT-01 ESLint не
згадує — тож ESLint названий окремим пунктом як інструмент перевірки.

Шаблон запису checkpoint не вигадується: він приходить із матеріалами курсу,
а сам запис робиться після рішення про приймання. Тека docs/checkpoints/ не
створюється; матеріал до неї лежить у docs/context/verify-layer.md, і
результат прогону там навмисно порожній — вердикт, зафіксований раніше дня
передачі, до неї застаріє.

Ворота задачі — verify:full, а не verify:checkpoint: tests/e2e/ порожня до
B-07, тож e2e чесно дає SKIPPED «0 тестів написано», і під --no-skip цей
пропуск блокує за побудовою. Червоний checkpoint-прогін тут — факт про стан
спринту, записаний у docs/context/verify-layer.md, а не дефект шару.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

`git add` містить рівно три шляхи. `scripts/verify/registry.d.mts` серед них немає й бути не
може: його створює й комітить задача 3, крок 6 (див. крок 4).

---
