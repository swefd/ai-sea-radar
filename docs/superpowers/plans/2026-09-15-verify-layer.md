# Verify Layer + Stop-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дати проєкту відтворюваний факт про власний код — реєстр перевірок із п'ятьма нерозрізнюваними статусами, які запускаються автоматично після кожного редагування (як lead) і на зупинці агента (як гейт).

**Architecture:** Реєстр — дані (`registry.mjs`), раннер — оркестратор (`run.mjs`), свіжість — хеш вмісту (`hash.mjs`). Три власні структурні перевірки в `checks/`. Два хуки Claude Code поверх цього: `PostToolUse` радить, `Stop` блокує. Жодна перевірка не знає про хуки; хуки викликають раннер як чорну скриньку.

**Tech Stack:** Node.js 24 (ESM, `.mjs`) · TypeScript 6 `strict` · ESLint 9 flat config · Playwright Test 1.63 (два проєкти: `unit` без браузера, `e2e` з chromium) · POSIX `sh` для резолву інтерпретатора.

**Spec:** `docs/superpowers/specs/2026-09-15-verify-layer-design.md` — читати разом із планом. План аргументує зі спеки; там причини, тут кроки.

## Global Constraints

Діють на **кожну** задачу нижче. Значення скопійовані дослівно.

- **Node 24.** `.nvmrc` містить `24`. Перед будь-якою командою — `nvm use`. На момент написання плану активним був **v22.23.1**, тобто дрейф уже є; кожна задача починається з перевірки версії.
- **Жодних залежностей поза трьома.** Додаються рівно `eslint@^9`, `eslint-config-next@16.3.5`, `@playwright/test@^1.63`. `eslint@^9`, а не `^10`: `eslint-plugin-react@^7.37` (`^3 || … || ^9.7`) і `eslint-plugin-jsx-a11y@^6.10` (`… || ^9`), які тягне `eslint-config-next`, не заявляють `^10`.
- **Playwright Test — єдиний тестовий раннер.** Vitest, Jest, MSW, Storybook не додаються за жодних обставин (SPRINT-01 B-07: «інших тестових фреймворків немає»).
- **`reference/` — read-only, не імпортується, не лінтиться, не тестується.** Виключена з `tsconfig.json`, має бути виключена з ESLint і Playwright `testDir`, і вона в `.gitignore`.
- **Секрети не друкуються ніколи.** `no-secrets` звітує `file:line` + назву шаблону + довжину збігу. **Ніколи сам збіг, навіть частково.**
- **`next lint` видалено в Next 16.** Лінт викликається ESLint CLI напряму. Ключ `eslint` у `next.config.ts` не додавати — він більше не підтримується.
- **Українська в рядках UI та звітів.** Будь-яке обрізання тексту — **за байтами через `Buffer`**, ніколи `String.prototype.slice`.
- **Кожен `.mjs` — ESM**, `import`, без `require`.
- **Коміт після кожної задачі.** Повідомлення українською, тіло пояснює *чому*, і закінчується рядком `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

---

## Структура файлів

| Файл | Відповідальність | Задача |
| --- | --- | --- |
| `eslint.config.mjs` | flat-конфіг ESLint; ігнорує `reference/`, `.next/`, `.verify/` | 1 |
| `playwright.config.ts` | два проєкти; `webServer` лише коли треба `e2e` | 1 |
| `scripts/verify/hash.mjs` | які файли є джерелом + їх хеш за вмістом | 2 |
| `scripts/verify/registry.mjs` | `CHECKS` і `PRECONDITIONS` — **тільки дані** | 3 |
| `scripts/verify/run.mjs` | оркестрація: відбір, передумови, запуск, статуси, коди виходу | 3 |
| `scripts/verify/report.mjs` | таблиця в термінал, JSON-звіт, кеш свіжості | 4 |
| `scripts/verify/checks/no-ref-imports.mjs` | жодного `import` із `reference/` | 5 |
| `scripts/verify/checks/no-secrets.mjs` | жодного ключа у файлах, що передаються | 6 |
| `scripts/verify/checks/deps-allowlist.mjs` | `package.json` у межах узгодженого | 7 |
| `.claude/hooks/node.sh` | знайти Node 24, інакше впасти **голосно** | 8 |
| `.claude/hooks/edit-check.mjs` | `PostToolUse` — lead після редагування | 9 |
| `.claude/hooks/stop-gate.mjs` | `Stop` — гейт, блокує | 10 |
| `.claude/settings.json` | вмикання хуків | 11 |
| `CLAUDE.md`, `docs/checkpoints/` | опис для людини й для клієнта | 12 |

Межі навмисні: `registry.mjs` не має логіки, `run.mjs` не має знань про конкретні перевірки, `report.mjs` не вирішує статусів. Перевірити межу легко — якщо, щоб додати рядок у реєстр, треба правити `run.mjs`, межа зламана.

---

### Task 1: Інструменти перевірки — залежності та конфіги

Без цього немає чим запускати тести, тож задача перша, попри те, що вона не додає жодної перевірки.

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `eslint.config.mjs`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: нічого
- Produces: `npm run check-types`, `npm run lint`; Playwright-проєкти з іменами рівно `unit` і `e2e` — задача 3 вписує ці імена в `registry.mjs` дослівно.

- [ ] **Крок 1: Переключитися на Node 24 і зафіксувати факт**

```bash
cd /Users/oleksandrsecond/Projects/sea-radar
nvm use
node -v
```

Очікується: `v24.x.x`. Якщо `nvm: command not found` або версія не 24 — **зупинитися й сказати про це**, не продовжувати на 22. Далі весь план припускає 24.

- [ ] **Крок 2: Поставити три залежності**

```bash
npm install --save-dev --save-exact eslint@9.39.5 eslint-config-next@16.3.5 @playwright/test@1.63.0
```

`--save-exact`, бо `CLAUDE.md` каже «кожне узгоджене значення живе в одному місці» — діапазон означав би, що фактична версія залежить від дати встановлення.

- [ ] **Крок 3: Перевірити, що peer-конфліктів немає**

```bash
npm ls eslint eslint-config-next @playwright/test
```

Очікується: дерево без `UNMET PEER DEPENDENCY` і без `invalid`. Якщо з'явився конфлікт навколо `eslint-plugin-react` чи `eslint-plugin-jsx-a11y` — це означає, що встановилася не та мажорна версія ESLint; перевірити `npm ls eslint` і **не глушити конфлікт через `--force` чи `--legacy-peer-deps`**.

- [ ] **Крок 4: Завантажити chromium у фоні**

```bash
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
    // Дефолтні ігнори eslint-config-next доводиться перелічити заново:
    // globalIgnores тут замінює їх, а не доповнює.
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
]);
```

- [ ] **Крок 6: Написати `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Які проєкти обрано в командному рядку. Playwright знає лише глобальний
 * `webServer`, тож без цього запуск `unit` піднімав би dev-сервер — і падіння
 * сервера читалося б як падіння юніт-тестів. Це рівно та підміна причини,
 * яку весь шар має ловити, тому обробляються обидві форми прапорця.
 */
function selectedProjects(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) {
      names.push(arg.slice('--project='.length));
    } else if (arg === '--project' && argv[i + 1] !== undefined) {
      names.push(argv[i + 1]);
    }
  }
  return names;
}

const selected = selectedProjects(process.argv);
const needsServer = selected.length === 0 || selected.includes('e2e');

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

- [ ] **Крок 8: Переконатися, що обидва конфіги справді резолвяться**

```bash
npm run check-types
npm run lint
npx playwright test --list
```

Очікується:
- `check-types` — тиша, вихід `0`.
- `lint` — тиша, вихід `0`. Якщо ESLint скаржиться на `reference/` — крок 5 зроблено неправильно.
- `--list` — `Total: 0 tests in 0 files`, і **dev-сервер не піднімається**.

Нуль тестів тут очікуваний і правильний: тек `tests/unit/` і `tests/e2e/` ще немає, перший юніт-тест приходить у задачі 2.

- [ ] **Крок 9: Коміт**

```bash
git add package.json package-lock.json eslint.config.mjs playwright.config.ts
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
- Test: `tests/unit/hash.spec.ts`
- Modify: `.gitignore` (додати `/.verify/`)

**Interfaces:**
- Consumes: Playwright-проєкт `unit` із задачі 1
- Produces:
  - `SOURCE_PREFIXES: string[]`, `SOURCE_FILES: string[]`
  - `isSourcePath(relPath: string): boolean`
  - `listSourceFiles(root: string): string[]` — відсортовані POSIX-шляхи відносно `root`
  - `sourceHash(root: string): { hash: string; fileCount: number; files: string[] }`

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
  writeFileSync(path.join(root, 'package.json'), '{"name":"t"}\n');
  writeFileSync(path.join(root, '.gitignore'), 'secret.txt\n');
  writeFileSync(path.join(root, 'secret.txt'), 'ignored\n');
  writeFileSync(path.join(root, 'README.md'), '# not source\n');
  return root;
}

test('isSourcePath приймає префікси та точні імена, відкидає решту', () => {
  expect(isSourcePath('app/page.tsx')).toBe(true);
  expect(isSourcePath('scripts/verify/run.mjs')).toBe(true);
  expect(isSourcePath('.claude/hooks/node.sh')).toBe(true);
  expect(isSourcePath('tsconfig.json')).toBe(true);
  expect(isSourcePath('README.md')).toBe(false);
  expect(isSourcePath('docs/tasks/SPRINT-01.md')).toBe(false);
});

test('listSourceFiles бере джерельні файли, ігнорує gitignored і не-джерельні', () => {
  const root = makeRepo();
  try {
    expect(listSourceFiles(root)).toEqual(['app/page.tsx', 'package.json']);
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
mkdir -p tests/unit
npx playwright test --project=unit
```

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
  'app/',
  'tests/',
  'scripts/verify/',
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
      // Файл зник між переліком і читанням. Позначити явно, а не вдати,
      // що його не було: інакше два різні стани дерева дали б один хеш.
      contents = Buffer.from(' <missing>');
    }
    digest.update(createHash('sha256').update(contents).digest());
    digest.update('\0');
  }

  return { hash: digest.digest('hex'), fileCount: files.length, files };
}

// CLI: без нього питання «чому моє зелене перевикористалось» не має відповіді.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = sourceHash(process.cwd());
  process.stdout.write(`${result.hash}  (${result.fileCount} файлів)\n`);
  if (process.argv.includes('--files')) {
    for (const relPath of result.files) process.stdout.write(`  ${relPath}\n`);
  }
}
```

- [ ] **Крок 4: Запустити тести — мають пройти**

```bash
npx playwright test --project=unit
```

Очікується: `5 passed`. Тепер рядок `unit` більше не порожній — у задачі 3 він має дати `PASSED`, а не `SKIPPED`.

- [ ] **Крок 5: Перевірити CLI на справжньому репозиторії**

```bash
node scripts/verify/hash.mjs --files
```

Очікується: хеш і список, у якому є `app/page.tsx`, `package.json`, `scripts/verify/hash.mjs`, `tests/unit/hash.spec.ts`, і **немає** `docs/`, `.agents/`, `.claude/skills/`, `reference/`.

- [ ] **Крок 6: Додати `/.verify/` у `.gitignore`**

Після рядка `/.claude/settings.local.json` дописати:

```
# звіти й лічильники шару перевірки
/.verify/
```

- [ ] **Крок 7: Коміт**

```bash
git add scripts/verify/hash.mjs tests/unit/hash.spec.ts .gitignore
git commit -m "feat(verify): хеш джерел за вмістом

Свіжість рахується від вмісту файлів, не від mtime і не від чистоти
дерева. Тест на це прямий: коміт не змінює хеш, дотик до файлу не
змінює хеш, зміна байта — змінює.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
