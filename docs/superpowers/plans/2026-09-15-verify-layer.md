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
# testDir має існувати, інакше Playwright падає замість того, щоб знайти 0 тестів.
mkdir -p tests/unit tests/e2e

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
      contents = Buffer.from('\u0000<missing>');
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

### Task 3: `registry.mjs` + ядро `run.mjs`

Тут з'являються п'ять статусів. Ціль задачі — щоб **різниця між ними була в коді, а не в прозі**.

**Files:**
- Create: `scripts/verify/registry.mjs`
- Create: `scripts/verify/run.mjs`
- Test: `tests/unit/verify-core.spec.ts`
- Modify: `package.json` (скрипти `verify`, `verify:full`, `verify:checkpoint`)

**Interfaces:**
- Consumes: `sourceHash` із задачі 2 (поки не використовується — підключається в задачі 4); імена Playwright-проєктів `unit` і `e2e` із задачі 1
- Produces:
  - `STATUSES: readonly string[]` — `['PASSED','FAILED','SKIPPED','NOT_RUN','UNRUNNABLE']`
  - `isBlocking(status: string, noSkip: boolean): boolean`
  - `selectChecks(checks, opts: {tier: 'fast'|'full', only?: string[]}): Check[]`
  - `validateRegistry(checks): string[]` — список помилок, порожній = все гаразд
  - `classifyRun({spawnError?, timedOut?, code?}): {status, detail}`
  - `gateByPreconditions(check, satisfied: Set<string>): {status, detail} | null`
  - `blockedByDependency(check, resultsById: Map): {status, detail} | null`
  - `CHECKS`, `PRECONDITIONS` із `registry.mjs`

  Задача 4 імпортує `STATUSES` й `isBlocking`; задачі 5–7 дописують рядки в `CHECKS`.

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/verify-core.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import {
  STATUSES,
  isBlocking,
  selectChecks,
  validateRegistry,
  classifyRun,
  gateByPreconditions,
  blockedByDependency,
} from '../../scripts/verify/run.mjs';
import { CHECKS, PRECONDITIONS } from '../../scripts/verify/registry.mjs';

test('п\'ять статусів, і вони не згортаються', () => {
  expect(STATUSES).toEqual(['PASSED', 'FAILED', 'SKIPPED', 'NOT_RUN', 'UNRUNNABLE']);
  expect(new Set(STATUSES).size).toBe(5);
});

test('SKIPPED блокує лише під --no-skip; решта незелених блокує завжди', () => {
  expect(isBlocking('PASSED', false)).toBe(false);
  expect(isBlocking('PASSED', true)).toBe(false);

  expect(isBlocking('SKIPPED', false)).toBe(false);
  expect(isBlocking('SKIPPED', true)).toBe(true);

  for (const status of ['FAILED', 'NOT_RUN', 'UNRUNNABLE']) {
    expect(isBlocking(status, false)).toBe(true);
    expect(isBlocking(status, true)).toBe(true);
  }
});

test('fast не тягне full; full тягне обидва', () => {
  const checks = [
    { id: 'a', tier: 'fast' },
    { id: 'b', tier: 'full' },
    { id: 'c', tier: 'fast' },
  ];
  expect(selectChecks(checks, { tier: 'fast' }).map((c) => c.id)).toEqual(['a', 'c']);
  expect(selectChecks(checks, { tier: 'full' }).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  expect(selectChecks(checks, { tier: 'full', only: ['b'] }).map((c) => c.id)).toEqual(['b']);
});

test('classifyRun розрізняє «впало» і «не змогло запуститися»', () => {
  expect(classifyRun({ code: 0 }).status).toBe('PASSED');
  expect(classifyRun({ code: 1 }).status).toBe('FAILED');
  // Саме тут найлегше збрехати: повідомити FAILED про код, який ніхто не перевіряв.
  expect(classifyRun({ code: 127 }).status).toBe('UNRUNNABLE');
  expect(classifyRun({ spawnError: 'ENOENT' }).status).toBe('UNRUNNABLE');
  expect(classifyRun({ timedOut: true }).status).toBe('UNRUNNABLE');
});

test('відсутня передумова дає SKIPPED і називає, якої саме', () => {
  const check = { id: 'e2e', needs: ['playwright-browser'], after: [] };
  expect(gateByPreconditions(check, new Set(['node-modules']))).toMatchObject({
    status: 'SKIPPED',
  });
  expect(gateByPreconditions(check, new Set(['playwright-browser']))).toBeNull();
});

test('незелена залежність дає NOT_RUN, а не FAILED', () => {
  const check = { id: 'e2e', needs: [], after: ['build'] };
  const failed = new Map([['build', { status: 'FAILED' }]]);
  const passed = new Map([['build', { status: 'PASSED' }]]);
  expect(blockedByDependency(check, failed)).toMatchObject({ status: 'NOT_RUN' });
  expect(blockedByDependency(check, passed)).toBeNull();
});

test('реєстр внутрішньо узгоджений', () => {
  expect(validateRegistry(CHECKS)).toEqual([]);
});

test('кожна передумова, на яку хтось посилається, існує', () => {
  for (const check of CHECKS) {
    for (const need of check.needs) {
      expect(Object.keys(PRECONDITIONS)).toContain(need);
    }
  }
});
```

Передостанній тест — не формальність. `validateRegistry` вимагає непорожніх `proves` і `blindSpot`, тож рядок без чесної прози **не пройде власні тести проєкту**.

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

Очікується: FAIL — `Cannot find module '../../scripts/verify/run.mjs'`.

- [ ] **Крок 3: Написати `scripts/verify/registry.mjs`**

```js
// Тільки дані. Жодної логіки виконання — якщо, щоб додати рядок, довелося
// правити run.mjs, межа між реєстром і раннером зламана.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Проба відповідає ЛИШЕ на «чи можу я взагалі запуститися».
 * Ніколи на «чи пройшло» — інакше SKIPPED почав би означати думку про код.
 */
export const PRECONDITIONS = {
  'node-modules': {
    describe: 'node_modules/ встановлено',
    probe: (root) => existsSync(path.join(root, 'node_modules')),
  },
  'playwright-pkg': {
    describe: '@playwright/test встановлено',
    probe: (root) => existsSync(path.join(root, 'node_modules', '@playwright', 'test')),
  },
  'playwright-browser': {
    describe: 'браузер chromium завантажено',
    probe: () => {
      const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright');
      if (!existsSync(cache)) return false;
      // Версія в імені теки змінюється з кожним релізом Playwright,
      // тому перевіряється наявність будь-якої chromium-*, а не точної.
      return readdirSync(cache).some((name) => name.startsWith('chromium'));
    },
  },
};

/** Playwright виходить з кодом 1, коли не знайшов жодного тесту. */
function interpretNoTests({ output }) {
  return /no tests found/i.test(output)
    ? { status: 'SKIPPED', detail: 'тестів ще не написано — 0 тестів нічого не доводять' }
    : null;
}

export const CHECKS = [
  {
    id: 'typecheck',
    tier: 'fast',
    cmd: 'npx tsc -p tsconfig.json --noEmit',
    needs: ['node-modules'],
    after: [],
    proves:
      'Кожен .ts/.tsx проєкту компілюється під strict із типами Next.',
    blindSpot:
      'Нічого про поведінку в рантаймі. skipLibCheck: true ховає помилки чужих .d.ts. '
      + 'Leaflet не виконується, тож звернення до window на рівні модуля тут скомпілюється успішно.',
  },
  {
    id: 'lint',
    tier: 'fast',
    cmd: 'npx eslint .',
    needs: ['node-modules'],
    after: [],
    proves:
      'Жоден файл не порушує правила eslint-config-next і базові правила TypeScript.',
    blindSpot:
      'Стиль і статичні шаблони, не логіку. Правило, якого немає в конфігу, '
      + 'не порушується за визначенням.',
  },
  {
    id: 'unit',
    tier: 'fast',
    cmd: 'npx playwright test --project=unit',
    needs: ['node-modules', 'playwright-pkg'],
    after: [],
    interpret: interpretNoTests,
    proves:
      'Чисті функції поводяться як задано — для написаних випадків.',
    blindSpot:
      'Ні браузера, ні DOM, ні Leaflet. Про рендер і карту не говорить нічого. '
      + 'Випадок, якого ніхто не написав, не покритий.',
  },
  {
    id: 'build',
    tier: 'full',
    cmd: 'npm run build',
    needs: ['node-modules'],
    after: ['typecheck'],
    proves:
      'Застосунок збирається, і серверний рендер не звертається до window '
      + 'на рівні імпорту — запобіжник SSR для Leaflet.',
    blindSpot:
      'Нічого не натискає. Карта, що вийшла сірою, збірку проходить.',
  },
  {
    id: 'e2e',
    tier: 'full',
    cmd: 'npx playwright test --project=e2e',
    needs: ['node-modules', 'playwright-pkg', 'playwright-browser'],
    after: ['build'],
    interpret: interpretNoTests,
    proves:
      'Поведінки вибору з B-07 виконуються у справжньому chromium проти dev-сервера.',
    blindSpot:
      'Рух НЕ перевіряє — перевірка руху з керованим часом належить R3. '
      + 'Тайли заблоковані, тож про справжні зображення карти не говорить нічого.',
  },
];
```

- [ ] **Крок 4: Написати `scripts/verify/run.mjs`**

```js
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECKS, PRECONDITIONS } from './registry.mjs';

export const STATUSES = Object.freeze([
  'PASSED',     // виконалася, проблем не знайшла
  'FAILED',     // передумова була, виконалася, знайшла проблему
  'SKIPPED',    // передумови не було — ПРО КОД НЕ ГОВОРИТЬ НІЧОГО
  'NOT_RUN',    // не запускалась, бо впала та, від якої залежить
  'UNRUNNABLE', // сама не змогла запуститися
]);

export function isBlocking(status, noSkip) {
  if (status === 'PASSED') return false;
  if (status === 'SKIPPED') return Boolean(noSkip);
  return true;
}

export function selectChecks(checks, { tier, only }) {
  const tiers = tier === 'full' ? ['fast', 'full'] : ['fast'];
  const byTier = checks.filter((check) => tiers.includes(check.tier));
  if (!only || only.length === 0) return byTier;
  return byTier.filter((check) => only.includes(check.id));
}

export function validateRegistry(checks) {
  const errors = [];
  const seen = new Set();

  for (const check of checks) {
    if (seen.has(check.id)) errors.push(`дубльований id: ${check.id}`);
    for (const dep of check.after ?? []) {
      if (!seen.has(dep)) {
        errors.push(`${check.id} залежить від ${dep}, якого немає вище в реєстрі`);
      }
    }
    // Проза мусить бути. Рядок без неї — декоративний, і краще хай впаде тест,
    // ніж він тихо додасть зеленого, не пояснивши, що саме довів.
    for (const field of ['proves', 'blindSpot']) {
      if (typeof check[field] !== 'string' || check[field].trim().length < 20) {
        errors.push(`${check.id}: ${field} відсутній або надто короткий, щоб бути спростовним`);
      }
    }
    seen.add(check.id);
  }

  return errors;
}

export function classifyRun({ spawnError, timedOut, code }) {
  if (spawnError) return { status: 'UNRUNNABLE', detail: `не вдалося запустити: ${spawnError}` };
  if (timedOut) return { status: 'UNRUNNABLE', detail: 'перевищено таймаут' };
  if (code === 127) return { status: 'UNRUNNABLE', detail: 'команду не знайдено (код 127)' };
  if (code === 0) return { status: 'PASSED', detail: '' };
  return { status: 'FAILED', detail: `код виходу ${code}` };
}

export function gateByPreconditions(check, satisfied) {
  const missing = (check.needs ?? []).filter((need) => !satisfied.has(need));
  if (missing.length === 0) return null;
  const described = missing.map((id) => PRECONDITIONS[id]?.describe ?? id);
  return { status: 'SKIPPED', detail: `немає передумови: ${described.join('; ')}` };
}

export function blockedByDependency(check, resultsById) {
  // Не-PASSED, а не лише FAILED: якщо залежність пропущено, запускати це
  // теж немає сенсу, і NOT_RUN чесніше, ніж вдавати самостійний результат.
  const blockers = (check.after ?? []).filter((dep) => {
    const previous = resultsById.get(dep);
    return previous !== undefined && previous.status !== 'PASSED';
  });
  if (blockers.length === 0) return null;
  return { status: 'NOT_RUN', detail: `не запускалась: не пройшла ${blockers.join(', ')}` };
}

function parseArgs(argv) {
  const options = { tier: 'fast', noSkip: false, only: [], json: false, timeoutMs: 600_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tier') options.tier = argv[++i];
    else if (arg === '--no-skip') options.noSkip = true;
    else if (arg === '--only') options.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (arg === '--json') options.json = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
  }
  return options;
}

export function runAll(root, options) {
  const registryErrors = validateRegistry(CHECKS);
  if (registryErrors.length > 0) {
    throw new Error(`реєстр неузгоджений:\n  ${registryErrors.join('\n  ')}`);
  }

  const satisfied = new Set(
    Object.entries(PRECONDITIONS)
      .filter(([, precondition]) => {
        try { return precondition.probe(root); } catch { return false; }
      })
      .map(([id]) => id),
  );

  const results = [];
  const byId = new Map();

  for (const check of selectChecks(CHECKS, options)) {
    const short = gateByPreconditions(check, satisfied)
      ?? blockedByDependency(check, byId);

    if (short) {
      const result = { id: check.id, ...short, output: '', ms: 0 };
      results.push(result);
      byId.set(check.id, result);
      continue;
    }

    const startedAt = Date.now();
    // `exec` згортає один рівень: sh замінюється самою командою, тож таймаут
    // б'є по ній, а не по оболонці навколо неї.
    //
    // ЧЕСНО ПРО МЕЖУ: це не вбиває групу процесів. `npm run build` усе одно
    // породжує `next` онуком, і на таймауті той може пережити батька. Таймаут
    // тут — запобіжник від зависання раннера, не гарантія прибирання дітей.
    // Повне вбивство групи потребує detached + process.kill(-pid), чого
    // spawnSync не дає; якщо осиротілі процеси стануть реальною проблемою,
    // це привід перейти на spawn з ручним очікуванням, а не глушити симптом.
    const spawned = spawnSync('/bin/sh', ['-c', `exec ${check.cmd}`], {
      cwd: root,
      encoding: 'utf8',
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 32 * 1024 * 1024,
    });

    const output = `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`;
    let verdict = classifyRun({
      spawnError: spawned.error && spawned.error.code !== 'ETIMEDOUT'
        ? String(spawned.error.message) : undefined,
      timedOut: spawned.error?.code === 'ETIMEDOUT',
      code: spawned.status,
    });

    const reinterpreted = check.interpret?.({ ...verdict, output });
    if (reinterpreted) verdict = reinterpreted;

    const result = { id: check.id, ...verdict, output, ms: Date.now() - startedAt };
    results.push(result);
    byId.set(check.id, result);
  }

  return {
    tier: options.tier,
    noSkip: options.noSkip,
    finishedAt: new Date().toISOString(),
    results,
    blocking: results.some((r) => isBlocking(r.status, options.noSkip)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const options = parseArgs(process.argv.slice(2));
  const report = runAll(root, options);

  // Тимчасовий вивід. Задача 4 замінює його на таблицю й JSON-звіт.
  for (const result of report.results) {
    process.stdout.write(`${result.status.padEnd(11)} ${result.id}  ${result.detail}\n`);
  }
  process.exit(report.blocking ? 1 : 0);
}
```

- [ ] **Крок 5: Запустити тести — мають пройти**

```bash
npx playwright test --project=unit
```

Очікується: `13 passed` (5 із задачі 2 + 8 нових).

- [ ] **Крок 6: Додати скрипти в `package.json`**

```json
    "verify": "node scripts/verify/run.mjs --tier fast",
    "verify:full": "node scripts/verify/run.mjs --tier full",
    "verify:checkpoint": "node scripts/verify/run.mjs --tier full --no-skip"
```

- [ ] **Крок 7: Побачити всі п'ять статусів на живому репозиторії**

```bash
npm run verify
```

Очікується три рядки `PASSED`: `typecheck`, `lint`, `unit`.

```bash
node scripts/verify/run.mjs --tier full --only e2e
```

Очікується `SKIPPED  e2e  немає передумови: браузер chromium завантажено` — якщо фонове завантаження з задачі 1 ще не добігло. Це **правильний** результат, а не збій.

Перевірити `UNRUNNABLE` навмисно, не сподіваючись побачити його випадково:

```bash
node -e "
const r = require('node:child_process').spawnSync('/bin/sh',['-c','definitely-not-a-command'],{encoding:'utf8'});
console.log('код:', r.status);
"
```

Очікується `код: 127` — тобто гілка `UNRUNNABLE` у `classifyRun` спрацює на реальному коді, а не лише в тесті.

- [ ] **Крок 8: Коміт**

```bash
git add scripts/verify/registry.mjs scripts/verify/run.mjs tests/unit/verify-core.spec.ts package.json
git commit -m "feat(verify): реєстр як дані і ядро раннера з п'ятьма статусами

FAILED і UNRUNNABLE розрізняються в коді, не лише в прозі: повідомити
«перевірка впала», коли вона ніколи не могла запуститися, означає
стверджувати щось про код, якого ніхто не перевіряв.

validateRegistry вимагає непорожніх proves і blindSpot, тож рядок без
чесної прози не проходить власні тести проєкту.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: `report.mjs` — таблиця, JSON-звіт і кеш свіжості

Кеш тут виконує **дві** роботи: не переганяє вже доведене і водночас зливає паралельні редагування. Другу роль легко недооцінити — саме вона прибирає потребу в локах.

**Files:**
- Create: `scripts/verify/report.mjs`
- Modify: `scripts/verify/run.mjs` (підключити звіт і `--reuse-if-fresh`)
- Test: `tests/unit/verify-report.spec.ts`

**Interfaces:**
- Consumes: `sourceHash` (задача 2), `STATUSES`/`isBlocking` (задача 3)
- Produces:
  - `formatTable(results, {color: boolean}): string`
  - `capBytes(text: string, maxBytes: number): string`
  - `canReuse(cached, {hash, tier, noSkip}): boolean`
  - `readCache(root): object | null`, `writeCache(root, report): void`

  Задача 10 імпортує `capBytes` дослівно — обрізання тексту в гейті мусить бути тим самим кодом, а не схожим.

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/verify-report.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { capBytes, canReuse, formatTable } from '../../scripts/verify/report.mjs';

test('capBytes рахує байти, а не символи', () => {
  // Весь текст проєкту українською, тобто двобайтовий у UTF-8.
  const ukrainian = 'перевірка';
  expect(Buffer.byteLength(ukrainian, 'utf8')).toBe(17);
  expect(ukrainian.length).toBe(9);

  // Наївний slice(0, 10) віддав би 10 символів = 19 байтів — більше за ліміт.
  const capped = capBytes(ukrainian, 10);
  expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(10 + Buffer.byteLength('\n…обрізано', 'utf8'));
});

test('capBytes не ріже літеру навпіл', () => {
  // 5 байтів посеред двобайтової «і» — межа проходить усередині символу.
  const capped = capBytes('привіт', 5);
  expect(capped).not.toContain('�');
});

test('capBytes не чіпає текст, що вміщується', () => {
  expect(capBytes('ok', 100)).toBe('ok');
});

test('canReuse вимагає збігу хеша, рівня, режиму — і зеленого результату', () => {
  const green = { hash: 'h1', tier: 'fast', noSkip: false, blocking: false };
  expect(canReuse(green, { hash: 'h1', tier: 'fast', noSkip: false })).toBe(true);

  expect(canReuse(green, { hash: 'h2', tier: 'fast', noSkip: false })).toBe(false);
  expect(canReuse(green, { hash: 'h1', tier: 'full', noSkip: false })).toBe(false);
  expect(canReuse(green, { hash: 'h1', tier: 'fast', noSkip: true })).toBe(false);

  // Червоне не перевикористовується: причину треба показати свіжою.
  const red = { ...green, blocking: true };
  expect(canReuse(red, { hash: 'h1', tier: 'fast', noSkip: false })).toBe(false);

  expect(canReuse(null, { hash: 'h1', tier: 'fast', noSkip: false })).toBe(false);
});

test('formatTable показує статус кожного рядка і не ковтає SKIPPED', () => {
  const table = formatTable(
    [
      { id: 'typecheck', status: 'PASSED', detail: '', ms: 900 },
      { id: 'e2e', status: 'SKIPPED', detail: 'немає браузера', ms: 0 },
    ],
    { color: false },
  );
  expect(table).toContain('typecheck');
  expect(table).toContain('PASSED');
  expect(table).toContain('e2e');
  expect(table).toContain('SKIPPED');
  expect(table).toContain('немає браузера');
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

Очікується: FAIL — `Cannot find module '../../scripts/verify/report.mjs'`.

- [ ] **Крок 3: Написати `scripts/verify/report.mjs`**

```js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CACHE_FILE = path.join('.verify', 'last-run.json');

/**
 * Обрізання за БАЙТАМИ. String.prototype.slice тут не годиться: весь текст
 * проєкту українською, тобто двобайтовий, і межа ліміту регулярно падає
 * всередину символу.
 */
export function capBytes(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  // Розрізаний хвіст декодується в U+FFFD — прибрати, а не показувати.
  const cut = buffer.subarray(0, maxBytes).toString('utf8').replace(/�+$/u, '');
  return `${cut}\n…обрізано`;
}

export function canReuse(cached, { hash, tier, noSkip }) {
  if (!cached) return false;
  if (cached.blocking) return false;
  return cached.hash === hash && cached.tier === tier && cached.noSkip === noSkip;
}

export function readCache(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, CACHE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export function writeCache(root, report) {
  const target = path.join(root, CACHE_FILE);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const COLORS = {
  PASSED: '\u001b[32m',
  FAILED: '\u001b[31m',
  SKIPPED: '\u001b[33m',
  NOT_RUN: '\u001b[35m',
  UNRUNNABLE: '\u001b[31m',
};
const RESET = '\u001b[0m';

export function formatTable(results, { color }) {
  const width = Math.max(...results.map((r) => r.id.length), 4);
  const lines = results.map((result) => {
    const badge = color
      ? `${COLORS[result.status] ?? ''}${result.status.padEnd(11)}${RESET}`
      : result.status.padEnd(11);
    const timing = result.ms > 0 ? ` ${(result.ms / 1000).toFixed(1)}s` : '';
    const detail = result.detail ? `  ${result.detail}` : '';
    return `  ${badge} ${result.id.padEnd(width)}${timing}${detail}`;
  });
  return lines.join('\n');
}

export function useColor(stream) {
  if (process.env.NO_COLOR !== undefined) return false;
  return Boolean(stream.isTTY);
}
```

- [ ] **Крок 4: Підключити звіт і `--reuse-if-fresh` у `run.mjs`**

У `run.mjs` додати імпорти поруч із наявними:

```js
import { sourceHash } from './hash.mjs';
import { canReuse, formatTable, readCache, useColor, writeCache } from './report.mjs';
```

У `parseArgs` додати розбір прапорця — всередину циклу, поруч із `--json`:

```js
    else if (arg === '--reuse-if-fresh') options.reuseIfFresh = true;
```

і в початкове значення `options`:

```js
  const options = {
    tier: 'fast', noSkip: false, only: [], json: false,
    timeoutMs: 600_000, reuseIfFresh: false,
  };
```

Замінити весь блок `if (import.meta.url === ...)` у кінці файлу на:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const options = parseArgs(process.argv.slice(2));
  const { hash } = sourceHash(root);

  const cached = options.reuseIfFresh ? readCache(root) : null;
  const reused = canReuse(cached, { hash, tier: options.tier, noSkip: options.noSkip });
  const report = reused ? cached : { ...runAll(root, options), hash };

  if (!reused) writeCache(root, report);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    if (reused) process.stdout.write('  (перевикористано: джерела не змінилися)\n');
    process.stdout.write(`${formatTable(report.results, { color: useColor(process.stdout) })}\n`);
  }

  process.exit(report.blocking ? 1 : 0);
}
```

- [ ] **Крок 5: Запустити тести — мають пройти**

```bash
npx playwright test --project=unit
```

Очікується: `18 passed`.

- [ ] **Крок 6: Перевірити кеш на живому репозиторії**

```bash
npm run verify
node scripts/verify/run.mjs --tier fast --reuse-if-fresh
```

Очікується: другий запуск друкує `(перевикористано: джерела не змінилися)` і завершується помітно швидше.

Тепер довести, що кеш **протухає від зміни вмісту**, а не лише виглядає розумним:

```bash
printf '\n// торкнулись\n' >> app/page.tsx
node scripts/verify/run.mjs --tier fast --reuse-if-fresh
git checkout app/page.tsx
```

Очікується: рядка про перевикористання **немає** — перевірки пробігли заново.

І найважливіше — довести §3.4 спеки прямо: закомічений стан не дає безкоштовного зеленого.

```bash
node scripts/verify/hash.mjs > /tmp/hash-before.txt
git stash list > /dev/null; git add -A; git status --short
node scripts/verify/hash.mjs > /tmp/hash-after.txt
diff /tmp/hash-before.txt /tmp/hash-after.txt && echo "ОК: staging не змінює хеш"
git reset > /dev/null
```

Очікується: `ОК: staging не змінює хеш`.

- [ ] **Крок 7: Коміт**

```bash
git add scripts/verify/report.mjs scripts/verify/run.mjs tests/unit/verify-report.spec.ts
git commit -m "feat(verify): таблиця, JSON-звіт і кеш за хешем вмісту

Кеш робить дві роботи: не переганяє вже доведене і зливає паралельні
редагування. Друга роль прибирає потребу в локах — результат адресований
вмістом, тож коректність не залежить від порядку, якого Claude Code не
обіцяє.

capBytes ріже за байтами: весь текст проєкту українською, і наївний slice
розрізав би літеру навпіл.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: `no-ref-imports` — заборона імпорту з `reference/`

Правило записане в `CLAUDE.md` і `reference/CLAUDE.md` тричі й досі не стережеться нічим.

**Files:**
- Modify: `scripts/verify/hash.mjs` (виділити `gitFiles`)
- Create: `scripts/verify/checks/no-ref-imports.mjs`
- Modify: `scripts/verify/registry.mjs` (новий рядок)
- Test: `tests/unit/check-no-ref-imports.spec.ts`

**Interfaces:**
- Consumes: `gitFiles` — нова експортована функція `hash.mjs`
- Produces:
  - `gitFiles(root: string): string[]` — усі файли, що передаються (відстежувані + невідстежувані, без gitignored)
  - `findRefImports(relPath: string, source: string): {line: number; specifier: string}[]`

  Задачі 6 і 7 імпортують `gitFiles`.

- [ ] **Крок 1: Виділити `gitFiles` у `hash.mjs`**

Замінити тіло `listSourceFiles` на:

```js
/** Усі файли, що потрапляють до передачі: відстежувані + невідстежувані, без gitignored. */
export function gitFiles(root) {
  const raw = execFileSync(
    'git',
    ['ls-files', '-c', '-o', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return raw.split('\0').filter((relPath) => relPath !== '').sort();
}

export function listSourceFiles(root) {
  return gitFiles(root).filter(isSourcePath);
}
```

Тести задачі 2 — і є перевірка, що рефакторинг нічого не зламав. Вони мусять лишитися зеленими без правок.

- [ ] **Крок 2: Написати падаючий тест**

Створити `tests/unit/check-no-ref-imports.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { findRefImports } from '../../scripts/verify/checks/no-ref-imports.mjs';

test('ловить відносний імпорт із reference/', () => {
  const found = findRefImports('app/page.tsx', "import { x } from '../reference/geodesy/x.js';\n");
  expect(found).toHaveLength(1);
  expect(found[0].line).toBe(1);
});

test('ловить імпорт лише типу — заборона діє й на рівні типів', () => {
  const found = findRefImports('app/a.ts', "import type { T } from '../../reference/x';\n");
  expect(found).toHaveLength(1);
});

test('ловить require і динамічний import', () => {
  expect(findRefImports('app/a.ts', "const g = require('../reference/g');\n")).toHaveLength(1);
  expect(findRefImports('app/a.ts', "await import('../reference/g');\n")).toHaveLength(1);
});

test('ловить голий специфікатор із reference/', () => {
  expect(findRefImports('app/a.ts', "import x from 'reference/geodesy';\n")).toHaveLength(1);
});

test('не чіпає законні імпорти', () => {
  const source = [
    "import { useState } from 'react';",
    "import L from 'leaflet';",
    "import { bearing } from './lib/bearing';",
    '',
  ].join('\n');
  expect(findRefImports('app/page.tsx', source)).toEqual([]);
});

test('слово reference в іншому значенні не є порушенням', () => {
  const source = "// див. reference/geodesy для формули\nimport { a } from './a';\n";
  expect(findRefImports('app/a.ts', source)).toEqual([]);
});

test('повертає номер рядка, а не зсув', () => {
  const source = "import a from './a';\nimport b from './b';\nimport c from '../reference/c';\n";
  expect(findRefImports('app/a.ts', source)[0].line).toBe(3);
});
```

Останній тест — не дрібниця: номер рядка це те, за чим людина відкриває файл, і зсув у символах тут був би марним.

- [ ] **Крок 3: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

Очікується: FAIL — модуля немає.

- [ ] **Крок 4: Написати `scripts/verify/checks/no-ref-imports.mjs`**

```js
// CLAUDE.md, тричі: reference/ — не залежність, не ціль імпорту, не частина
// того, що передається. Ні в рантаймі, ні на рівні типів.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { gitFiles } from '../hash.mjs';

const SCANNED = ['app/', 'tests/', 'scripts/'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.cjs'];

const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g;

export function findRefImports(relPath, source) {
  const fromDir = path.posix.dirname(relPath);
  const found = [];

  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[2];

    const isRefSpecifier = specifier.startsWith('.')
      // Відносний: розв'язати відносно файлу, а не шукати підрядок —
      // './reference-utils' не порушення, '../reference/x' порушення.
      ? path.posix.normalize(path.posix.join(fromDir, specifier)).startsWith('reference/')
      : specifier === 'reference' || specifier.startsWith('reference/');

    if (!isRefSpecifier) continue;

    found.push({
      line: source.slice(0, match.index).split('\n').length,
      specifier,
    });
  }

  return found;
}

function main() {
  const root = process.cwd();
  const files = gitFiles(root).filter(
    (relPath) =>
      SCANNED.some((prefix) => relPath.startsWith(prefix))
      && EXTENSIONS.includes(path.extname(relPath)),
  );

  let violations = 0;
  for (const relPath of files) {
    for (const hit of findRefImports(relPath, readFileSync(path.join(root, relPath), 'utf8'))) {
      process.stdout.write(`${relPath}:${hit.line}  імпорт із reference/: ${hit.specifier}\n`);
      violations += 1;
    }
  }

  if (violations > 0) {
    process.stdout.write(
      `\n${violations} порушень. reference/ — матеріал для читання: перенести потрібні рядки `
      + 'у власний код проєкту з коментарем про походження.\n',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Крок 5: Додати рядок у реєстр**

У `CHECKS`, після рядка `unit`:

```js
  {
    id: 'no-ref-imports',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/no-ref-imports.mjs',
    needs: [],
    after: [],
    proves:
      'Жоден файл застосунку чи тестів не має import/require із reference/ — '
      + 'ні в рантаймі, ні на рівні типів.',
    blindSpot:
      'Тільки статичні літерали шляхів. Шлях, зібраний обчисленням у рантаймі, невидимий.',
  },
```

`needs: []` навмисне: перевірка читає файли й не потребує `node_modules`.

- [ ] **Крок 6: Запустити тести й перевірку**

```bash
npx playwright test --project=unit
npm run verify
```

Очікується: тести зелені, `no-ref-imports  PASSED`.

- [ ] **Крок 7: Довести, що перевірка справді ловить — навмисним порушенням**

```bash
printf "import type { X } from '../reference/geodesy/x';\n" >> app/page.tsx
node scripts/verify/checks/no-ref-imports.mjs; echo "код виходу: $?"
git checkout app/page.tsx
node scripts/verify/checks/no-ref-imports.mjs; echo "код виходу: $?"
```

Очікується: перший запуск — `app/page.tsx:N  імпорт із reference/: ../reference/geodesy/x` і `код виходу: 1`; після відкоту — `код виходу: 0`.

Перевірка, яку ніколи не бачили червоною, не перевірена.

- [ ] **Крок 8: Коміт**

```bash
git add scripts/verify/hash.mjs scripts/verify/checks/no-ref-imports.mjs scripts/verify/registry.mjs tests/unit/check-no-ref-imports.spec.ts
git commit -m "feat(verify): заборона імпорту з reference/

Правило записане в CLAUDE.md і reference/CLAUDE.md тричі й досі не
стереглося нічим. Відносні шляхи розв'язуються, а не шукаються підрядком:
'./reference-utils' не порушення, '../reference/x' порушення.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `no-secrets` — жодного ключа у файлах, що передаються

Клієнт перевіряє передані файли на ключ під час приймання. Перевірка **сама не має права надрукувати те, що знайшла**.

**Files:**
- Create: `scripts/verify/checks/no-secrets.mjs`
- Modify: `scripts/verify/registry.mjs`
- Test: `tests/unit/check-no-secrets.spec.ts`

**Interfaces:**
- Consumes: `gitFiles` (задача 5)
- Produces: `findSecrets(source: string): {line: number; pattern: string; length: number}[]` — **без поля зі значенням збігу**; `formatFinding(relPath, finding): string`

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/check-no-secrets.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { findSecrets, formatFinding } from '../../scripts/verify/checks/no-secrets.mjs';

test('ловить ключ у формі sk-...', () => {
  const found = findSecrets('const k = "sk-AAAAAAAAAAAAAAAAAAAAAA";\n');
  expect(found).toHaveLength(1);
  expect(found[0].pattern).toBe('anthropic-key');
});

test('ловить присвоєння в поле з іменем секрету', () => {
  expect(findSecrets('apiKey: "abcdefghijklmnop1234"\n')).toHaveLength(1);
  expect(findSecrets("password = 'hunter2hunter2hunter2'\n")).toHaveLength(1);
});

test('ловить 40-символьний hex — форма ключа AISStream', () => {
  const found = findSecrets(`const key = "${'a1b2c3d4'.repeat(5)}";\n`);
  expect(found[0].pattern).toBe('hex-40');
});

test('НЕ повертає саме значення — у знахідці немає збігу в жодному полі', () => {
  const secret = 'sk-SUPERSECRETVALUE123456';
  const found = findSecrets(`const k = "${secret}";\n`);
  const serialised = JSON.stringify(found);
  // Найважливіший тест файлу: інакше перевірка порушує правило, яке охороняє.
  expect(serialised).not.toContain(secret);
  expect(serialised).not.toContain('SUPERSECRET');
  expect(found[0].length).toBe(secret.length);
});

test('formatFinding друкує місце й тип, але не значення', () => {
  const secret = 'sk-SUPERSECRETVALUE123456';
  const [finding] = findSecrets(`const k = "${secret}";\n`);
  const line = formatFinding('app/a.ts', finding);
  expect(line).toContain('app/a.ts:1');
  expect(line).toContain('anthropic-key');
  expect(line).not.toContain(secret);
  expect(line).not.toContain('SUPERSECRET');
});

test('читання з env — не секрет', () => {
  expect(findSecrets('const k = process.env.AISSTREAM_KEY;\n')).toEqual([]);
});

test('порожнє й коротке значення — не секрет', () => {
  expect(findSecrets('apiKey: ""\n')).toEqual([]);
  expect(findSecrets('token = "abc"\n')).toEqual([]);
});

test('рядок із позначкою verify:allow-secret пропускається', () => {
  expect(findSecrets('apiKey: "abcdefghijklmnop1234" // verify:allow-secret\n')).toEqual([]);
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

- [ ] **Крок 3: Написати `scripts/verify/checks/no-secrets.mjs`**

```js
// CLAUDE.md: «Never read or print secrets. The AISStream key must not reach
// source, delivered files, or the screen.» Тому ця перевірка звітує МІСЦЕ і
// ТИП, ніколи значення — навіть частково. Префікс із трьох символів теж
// був би витоком трьох символів.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { gitFiles } from '../hash.mjs';

const ALLOW_MARKER = 'verify:allow-secret';

const PATTERNS = [
  { name: 'anthropic-key', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: 'hex-40', re: /\b[0-9a-f]{40}\b/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  {
    name: 'assigned-secret',
    re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|auth)\b\s*[:=]\s*(['"])((?:(?!\1).){12,})\1/gi,
  },
];

// Двійкове й згенероване. package-lock.json НЕ виключено навмисно:
// приватний реєстр з автентифікацією лишає креденшел саме там.
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.woff', '.woff2']);

export function findSecrets(source) {
  const findings = [];
  const lines = source.split('\n');

  lines.forEach((text, index) => {
    if (text.includes(ALLOW_MARKER)) return;

    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        // Довжина — єдине, що беремо зі значення. Саме значення не зберігається
        // в жодному полі, щоб його не можна було надрукувати випадково.
        const value = match[2] ?? match[0];
        findings.push({ line: index + 1, pattern: name, length: value.length });
      }
    }
  });

  return findings;
}

export function formatFinding(relPath, finding) {
  return `${relPath}:${finding.line}  ${finding.pattern} (${finding.length} символів, значення не друкується)`;
}

function main() {
  const root = process.cwd();
  const files = gitFiles(root).filter(
    (relPath) => !SKIP_EXTENSIONS.has(path.extname(relPath).toLowerCase()),
  );

  let violations = 0;
  for (const relPath of files) {
    let source;
    try {
      source = readFileSync(path.join(root, relPath), 'utf8');
    } catch {
      continue;
    }
    for (const finding of findSecrets(source)) {
      process.stdout.write(`${formatFinding(relPath, finding)}\n`);
      violations += 1;
    }
  }

  if (violations > 0) {
    process.stdout.write(
      `\n${violations} знахідок. Прибрати значення з файлу й читати його з оточення. `
      + `Якщо це хибне спрацювання — дописати в тому рядку позначку ${ALLOW_MARKER}, `
      + 'а не розширювати виключення на весь файл.\n',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Крок 4: Додати рядок у реєстр**

Після `no-ref-imports`:

```js
  {
    id: 'no-secrets',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/no-secrets.mjs',
    needs: [],
    after: [],
    proves:
      'Жоден файл, що потрапляє до передачі, не містить рядків, схожих на ключ або токен.',
    blindSpot:
      'Порівняння за шаблонами: секрет у незвичному кодуванні або розбитий на рядки '
      + 'невидимий. Ігноровані git-ом файли не скануються — і не передаються.',
  },
```

- [ ] **Крок 5: Прогнати на справжньому репозиторії**

```bash
npx playwright test --project=unit
node scripts/verify/checks/no-secrets.mjs; echo "код виходу: $?"
```

Очікується `код виходу: 0`.

Якщо спрацювало на `package-lock.json` або `skills-lock.json` — **звузити шаблон**, а не виключити файл. Виключення файлу прибирає й справжні знахідки в ньому; звуження шаблону прибирає лише хибні.

Окремо переконатися, що файл із живим токеном **не сканується, бо не передається**:

```bash
git check-ignore -v .claude/settings.local.json
```

Очікується рядок із `.gitignore` — тобто `gitFiles` його не поверне, і перевірка ніколи його не відкриє.

- [ ] **Крок 6: Довести навмисним порушенням — на тимчасовому файлі, не в репозиторії**

```bash
printf 'const k = "sk-%s";\n' "$(node -p "'A'.repeat(24)")" > app/tmp-secret-probe.ts
node scripts/verify/checks/no-secrets.mjs; echo "код виходу: $?"
rm app/tmp-secret-probe.ts
node scripts/verify/checks/no-secrets.mjs; echo "код виходу: $?"
```

Очікується: перший запуск — `app/tmp-secret-probe.ts:1  anthropic-key (27 символів, значення не друкується)` і `код виходу: 1`; після видалення — `0`.

Проба навмисно складається з літер `A`: справжній секрет для цього не потрібен і не допускається.

- [ ] **Крок 7: Коміт**

```bash
git add scripts/verify/checks/no-secrets.mjs scripts/verify/registry.mjs tests/unit/check-no-secrets.spec.ts
git commit -m "feat(verify): заборона секретів у файлах, що передаються

Звітує file:line, тип шаблону й довжину — ніколи значення, навіть
частково. Окремий тест серіалізує знахідку і перевіряє, що збігу немає в
жодному полі: інакше перевірка порушувала б правило, яке охороняє.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: `deps-allowlist` — межі узгодженого набору

Стереже критерії B-01 («жодних зайвих залежностей») і B-07 («інших тестових фреймворків немає»).

**Files:**
- Create: `scripts/verify/checks/deps-allowlist.mjs`
- Modify: `scripts/verify/registry.mjs`
- Test: `tests/unit/check-deps-allowlist.spec.ts`

**Interfaces:**
- Produces: `auditDependencies(pkg: object): {name: string; problem: string}[]`

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/check-deps-allowlist.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { auditDependencies } from '../../scripts/verify/checks/deps-allowlist.mjs';

const current = {
  dependencies: { next: '16.3.5', react: '19.3.0', 'react-dom': '19.3.0' },
  devDependencies: {
    '@types/node': '24.13.4',
    '@types/react': '19.3.0',
    typescript: '6.0.3',
    eslint: '9.39.5',
    'eslint-config-next': '16.3.5',
    '@playwright/test': '1.63.0',
  },
};

test('поточний набір проєкту чистий', () => {
  expect(auditDependencies(current)).toEqual([]);
});

test('leaflet дозволений заздалегідь — SPRINT-01 фіксує його в стеку', () => {
  const withLeaflet = {
    ...current,
    dependencies: { ...current.dependencies, leaflet: '1.9.4' },
    devDependencies: { ...current.devDependencies, '@types/leaflet': '1.9.12' },
  };
  expect(auditDependencies(withLeaflet)).toEqual([]);
});

test('другий тестовий раннер ловиться і називається саме так', () => {
  const withVitest = {
    ...current,
    devDependencies: { ...current.devDependencies, vitest: '3.0.0' },
  };
  const found = auditDependencies(withVitest);
  expect(found).toHaveLength(1);
  expect(found[0].name).toBe('vitest');
  expect(found[0].problem).toContain('B-07');
});

test('будь-яка незнайома залежність — порушення, не лише перелічені заборонені', () => {
  const withRandom = {
    ...current,
    dependencies: { ...current.dependencies, 'left-pad': '1.3.0' },
  };
  const found = auditDependencies(withRandom);
  expect(found).toHaveLength(1);
  expect(found[0].name).toBe('left-pad');
});

test('друга бібліотека карт ловиться', () => {
  const withMapbox = {
    ...current,
    dependencies: { ...current.dependencies, 'mapbox-gl': '3.0.0' },
  };
  expect(auditDependencies(withMapbox)).toHaveLength(1);
});

test('відсутність дозволеної залежності не є порушенням', () => {
  // Allowlist — стеля, не підлога: leaflet ще не встановлено, і це нормально.
  expect(auditDependencies({ dependencies: { next: '16.3.5' } })).toEqual([]);
});
```

Останній тест фіксує сенс списку: він каже, чого **не можна**, а не чого бракує.

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

- [ ] **Крок 3: Написати `scripts/verify/checks/deps-allowlist.mjs`**

```js
// SPRINT-01 B-01: «жодних зайвих залежностей». B-07: «інших тестових
// фреймворків немає». Allowlist — стеля, не підлога: відсутність
// дозволеного пакета порушенням не є.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_RUNTIME = new Set([
  'next', 'react', 'react-dom',
  // Стек зафіксований SPRINT-01; ставиться в B-02.
  'leaflet',
]);

const ALLOWED_DEV = new Set([
  '@types/node', '@types/react', '@types/react-dom', '@types/leaflet',
  'typescript',
  // Шар перевірки — свідомий виняток, записаний у checkpoint.
  'eslint', 'eslint-config-next', '@playwright/test',
]);

/** Назване окремо заради повідомлення: «незнайомий пакет» тут замало. */
const NAMED_BANS = new Map([
  ['vitest', 'другий тестовий раннер — SPRINT-01 B-07: «інших тестових фреймворків немає»'],
  ['jest', 'другий тестовий раннер — SPRINT-01 B-07'],
  ['mocha', 'другий тестовий раннер — SPRINT-01 B-07'],
  ['ava', 'другий тестовий раннер — SPRINT-01 B-07'],
  ['jasmine', 'другий тестовий раннер — SPRINT-01 B-07'],
  ['cypress', 'другий тестовий раннер — SPRINT-01 B-07'],
  ['@testing-library/react', 'тестова бібліотека поверх другого раннера — SPRINT-01 B-07'],
  ['msw', 'мокінг мережі — цей спринт не має реальних даних'],
  ['mapbox-gl', 'друга бібліотека карт — стек фіксує Leaflet'],
  ['maplibre-gl', 'друга бібліотека карт — стек фіксує Leaflet'],
  ['ol', 'друга бібліотека карт — стек фіксує Leaflet'],
  ['geodesy', 'reference/geodesy читається, не встановлюється — «Copy, never install»'],
  ['ws', 'reference/ читається, не встановлюється — реальні дані це R2'],
  ['@aisstream/aisstream', 'реальні дані це R2 — цей спринт до них не готується'],
]);

export function auditDependencies(pkg) {
  const problems = [];

  const groups = [
    { entries: pkg.dependencies ?? {}, allowed: ALLOWED_RUNTIME, label: 'dependencies' },
    { entries: pkg.devDependencies ?? {}, allowed: ALLOWED_DEV, label: 'devDependencies' },
  ];

  for (const { entries, allowed, label } of groups) {
    for (const name of Object.keys(entries)) {
      if (NAMED_BANS.has(name)) {
        problems.push({ name, problem: NAMED_BANS.get(name) });
      } else if (!allowed.has(name)) {
        problems.push({
          name,
          problem: `незнайомий пакет у ${label} — узгодити явно або прибрати`,
        });
      }
    }
  }

  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const problems = auditDependencies(pkg);

  for (const { name, problem } of problems) {
    process.stdout.write(`package.json  ${name}: ${problem}\n`);
  }

  if (problems.length > 0) process.exit(1);
}
```

- [ ] **Крок 4: Додати рядок у реєстр**

Після `no-secrets`:

```js
  {
    id: 'deps-allowlist',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/deps-allowlist.mjs',
    needs: [],
    after: [],
    proves:
      'package.json містить лише узгоджений набір; другого тестового раннера '
      + 'й другої бібліотеки карт немає.',
    blindSpot:
      'Тільки прямі залежності. Не доводить, що дозволена залежність узагалі використовується.',
  },
```

- [ ] **Крок 5: Прогнати повний fast-рівень**

```bash
npx playwright test --project=unit
npm run verify
```

Очікується шість `PASSED`: `typecheck`, `lint`, `unit`, `no-ref-imports`, `no-secrets`, `deps-allowlist`.

- [ ] **Крок 6: Довести навмисним порушенням**

```bash
npm pkg set devDependencies.vitest="3.0.0"
node scripts/verify/checks/deps-allowlist.mjs; echo "код виходу: $?"
npm pkg delete devDependencies.vitest
node scripts/verify/checks/deps-allowlist.mjs; echo "код виходу: $?"
```

Очікується: `package.json  vitest: другий тестовий раннер — SPRINT-01 B-07: «інших тестових фреймворків немає»`, `код виходу: 1`; після відкоту — `0`.

`npm pkg set` правит лише `package.json`, пакет не встановлюється — перевірка читає маніфест, і цього достатньо.

- [ ] **Крок 7: Коміт**

```bash
git add scripts/verify/checks/deps-allowlist.mjs scripts/verify/registry.mjs tests/unit/check-deps-allowlist.spec.ts
git commit -m "feat(verify): межі узгодженого набору залежностей

Allowlist — стеля, не підлога: відсутність дозволеного пакета порушенням
не є. Заборонені раннери названі поіменно, щоб повідомлення цитувало
критерій B-07, а не казало просто «незнайомий пакет».

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: `node.sh` — знайти Node 24 або впасти голосно

На цій машині проблема не гіпотетична. Виміряно під час планування:

| Джерело | Версія | Що було б, якби взяли його |
| --- | --- | --- |
| `command -v node` у неінтерактивному shell | **v22.23.1** | мовчки не та мажорна |
| `/opt/homebrew/bin/node` | **v25.8.0** | мовчки не та мажорна |
| `~/.nvm/versions/node/v24.21.0/bin/node` | **v24.21.0** | правильна |

Хук не успадковує середовище інтерактивного shell, тож `nvm use` у вашому терміналі його не стосується.

**Files:**
- Create: `.claude/hooks/node.sh`

**Interfaces:**
- Produces: виконуваний `node.sh`, що робить `exec <node24> "$@"`; задачі 9 і 10 викликаються рівно через нього.

- [ ] **Крок 1: Написати `.claude/hooks/node.sh`**

```sh
#!/bin/sh
# Знайти інтерпретатор Node, чия мажорна версія збігається з .nvmrc, і
# передати йому аргументи.
#
# Тільки вбудовані команди sh — ні dirname, ні sed, ні ls. Хук не успадковує
# середовище інтерактивного shell, тож ворожий або порожній PATH не має
# ламати саме визначення шляхів.
set -u

fail_loud() {
  # Один рядок валідного JSON. Тихий ненульовий вихід тут неприпустимий:
  # мовчазний хук читається як «перевірено», а перевірено нічого не було.
  printf '{"systemMessage":"%s"}\n' "$1"
  exit 0
}

root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  self="$0"
  case "$self" in
    /*/*/*) root="${self%/*}"; root="${root%/*}"; root="${root%/*}" ;;
    *) fail_loud "verify: не вдалося визначити корінь проєкту; хуки НЕ виконуються — не вважай тихий хід перевіреним" ;;
  esac
fi

want=""
if [ -r "$root/.nvmrc" ]; then
  read -r want < "$root/.nvmrc" || want=""
fi
[ -n "$want" ] || fail_loud "verify: .nvmrc не читається; хуки НЕ виконуються — не вважай тихий хід перевіреним"

major_of() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

found=""
for candidate in \
  "$HOME/.nvm/versions/node/v$want".*/bin/node \
  "$root/node_modules/.bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node
do
  [ -x "$candidate" ] || continue
  [ "$(major_of "$candidate")" = "$want" ] || continue
  found="$candidate"
  break
done

# PATH перевіряється останнім навмисно: на цій машині він веде на іншу
# мажорну версію, і мовчазне її використання — рівно та підміна, яку
# весь шар має ловити.
if [ -z "$found" ] && command -v node >/dev/null 2>&1; then
  if [ "$(major_of node)" = "$want" ]; then
    found="$(command -v node)"
  fi
fi

[ -n "$found" ] || fail_loud "verify: інтерпретатора Node $want не знайдено; хуки НЕ виконуються — не вважай тихий хід перевіреним"

bin="${found%/node}"
PATH="$root/node_modules/.bin:$bin:$PATH"
export PATH

exec "$found" "$@"
```

- [ ] **Крок 2: Зробити виконуваним**

```bash
chmod +x .claude/hooks/node.sh
```

- [ ] **Крок 3: Перевірити, що він обирає 24, а не те, що під рукою**

```bash
node -v
.claude/hooks/node.sh -p 'process.versions.node'
```

Очікується: перший рядок може бути `v22.23.1`, другий — **`24.21.0`**. Розбіжність тут і є доказом, що резолвер працює.

- [ ] **Крок 4: Перевірити падіння з порожнім PATH**

```bash
env -i HOME="$HOME" CLAUDE_PROJECT_DIR="$PWD" PATH=/nonexistent \
  .claude/hooks/node.sh -p '1 + 1'
```

Очікується: `2`. Резолвер знаходить nvm через `$HOME` і не залежить від `PATH`.

- [ ] **Крок 5: Перевірити, що недосяжність Node — це ГУЧНЕ падіння, а не тиша**

```bash
env -i CLAUDE_PROJECT_DIR="$PWD" HOME=/nonexistent PATH=/nonexistent \
  .claude/hooks/node.sh -p '1 + 1'
echo "код виходу: $?"
```

Очікується: один рядок JSON із `systemMessage`, де є «хуки НЕ виконуються», і `код виходу: 0`.

Вихід саме `0`: ненульовий код тут Claude Code сприйняв би як помилку самого хука й міг би приховати текст. Ціль протилежна — щоб текст дійшов.

Перевірити, що це валідний JSON, а не схожий на нього рядок:

```bash
env -i CLAUDE_PROJECT_DIR="$PWD" HOME=/nonexistent PATH=/nonexistent \
  .claude/hooks/node.sh -p '1' | node -e 'JSON.parse(require("node:fs").readFileSync(0,"utf8")); console.log("валідний JSON")'
```

Очікується: `валідний JSON`.

- [ ] **Крок 6: Коміт**

```bash
git add .claude/hooks/node.sh
git commit -m "feat(hooks): резолвер інтерпретатора Node 24

Хук не успадковує середовище інтерактивного shell. На цій машині PATH
веде на v22.23.1, а homebrew на v25.8.0 — обидва мовчки не та мажорна
версія. Резолвер звіряє major з .nvmrc і перевіряє PATH останнім.

Недосяжний Node дає гучний systemMessage і код 0, ніколи тихий ненульовий
вихід: мовчазний хук читається як «перевірено», а перевірено нічого.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: `edit-check.mjs` — lead після редагування

Цей шар **не блокує, і не за нашим вибором**: документація Claude Code для `PostToolUse` каже `Can block? No` — інструмент уже виконався. Це збігається з потрібною поведінкою: посеред рефакторингу код законно зламаний, і змушувати «чинити» файл 1 із 3 було б шкідливо.

**Files:**
- Create: `.claude/hooks/edit-check.mjs`
- Test: `tests/unit/edit-check.spec.ts`

**Interfaces:**
- Consumes: `sourceHash` (задача 2), `capBytes` (задача 4)
- Produces: `shouldCheck(filePath: string): boolean`; `narrowTypecheckOutput(output: string, relPath: string): {own: string[]; elsewhere: number}`

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/edit-check.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { shouldCheck, narrowTypecheckOutput } from '../../.claude/hooks/edit-check.mjs';

test('перевіряються лише файли коду', () => {
  expect(shouldCheck('app/page.tsx')).toBe(true);
  expect(shouldCheck('scripts/verify/run.mjs')).toBe(true);
  expect(shouldCheck('docs/tasks/SPRINT-01.md')).toBe(false);
  expect(shouldCheck('package.json')).toBe(false);
});

test('reference/ не перевіряється — він read-only і не наш', () => {
  expect(shouldCheck('reference/geodesy/latlon-spherical.js')).toBe(false);
});

test('згенероване не перевіряється', () => {
  expect(shouldCheck('.next/types/x.ts')).toBe(false);
  expect(shouldCheck('node_modules/x/index.js')).toBe(false);
});

test('помилки у відредагованому файлі відокремлюються від решти', () => {
  const output = [
    "app/page.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "app/other.tsx(9,1): error TS2304: Cannot find name 'foo'.",
    "app/page.tsx(12,3): error TS2551: Property 'x' does not exist.",
  ].join('\n');

  const narrowed = narrowTypecheckOutput(output, 'app/page.tsx');
  expect(narrowed.own).toHaveLength(2);
  expect(narrowed.own[0]).toContain('TS2322');
  // Зламане в іншому файлі не ховається — воно найдорожче.
  expect(narrowed.elsewhere).toBe(1);
});

test('чистий вивід дає нуль і там, і там', () => {
  expect(narrowTypecheckOutput('', 'app/page.tsx')).toEqual({ own: [], elsewhere: 0 });
});

test('абсолютний шлях у виводі tsc зіставляється з відносним', () => {
  const output = '/Users/x/proj/app/page.tsx(3,7): error TS2322: nope.';
  expect(narrowTypecheckOutput(output, 'app/page.tsx').own).toHaveLength(1);
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

- [ ] **Крок 3: Написати `.claude/hooks/edit-check.mjs`**

```js
#!/usr/bin/env node
// PostToolUse, матчер Edit|Write.
//
// Цей шар дає LEAD, не статус: документація каже «Can block? No» — інструмент
// уже виконався. Статус видає лише Stop-гейт.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sourceHash } from '../../scripts/verify/hash.mjs';
import { capBytes } from '../../scripts/verify/report.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.jsx', '.cjs']);
const IGNORED_PREFIXES = ['reference/', '.next/', 'node_modules/', '.claude/worktrees/'];
const MAX_BYTES = 4000;

export function shouldCheck(relPath) {
  if (IGNORED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
  return CODE_EXTENSIONS.has(path.extname(relPath));
}

export function narrowTypecheckOutput(output, relPath) {
  const own = [];
  let elsewhere = 0;

  for (const line of output.split('\n')) {
    if (!/\berror TS\d+/.test(line)) continue;
    // tsc друкує шлях відносно cwd, але під іншим запуском може бути абсолютний.
    if (line.includes(relPath)) own.push(line.trim());
    else elsewhere += 1;
  }

  return { own, elsewhere };
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

/** Тайпчек — на весь проєкт, але результат адресується хешем вмісту. */
function typecheckCached() {
  const { hash } = sourceHash(ROOT);
  const cacheFile = path.join(ROOT, '.verify', 'typecheck', `${hash}.json`);

  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch { /* кеша немає — рахуємо */ }

  const run = spawnSync('/bin/sh', ['-c', 'npx tsc -p tsconfig.json --noEmit'], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  const result = { output: `${run.stdout ?? ''}${run.stderr ?? ''}`, code: run.status };

  try {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(result), 'utf8');
  } catch { /* кеш — оптимізація; його відсутність нічого не ламає */ }

  return result;
}

function main() {
  const payload = readStdin();
  const absolute = payload?.tool_input?.file_path;
  if (!absolute) process.exit(0);

  const relPath = path.relative(ROOT, absolute);
  if (relPath.startsWith('..') || !shouldCheck(relPath)) process.exit(0);

  const notes = [];

  // Лінт — справді файловий: звуження тут чесне.
  const lint = spawnSync('/bin/sh', ['-c', `npx eslint ${JSON.stringify(relPath)}`], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (lint.status !== 0) {
    notes.push(`ESLint у ${relPath}:\n${`${lint.stdout ?? ''}${lint.stderr ?? ''}`.trim()}`);
  }

  // Тайпчек — на весь проєкт: `tsc --noEmit <file>` дає TS5112 і не завантажує
  // tsconfig.json, тобто губить strict, jsx і типи Next. Звужується ЗВІТ.
  const typecheck = typecheckCached();
  if (typecheck.code !== 0) {
    const { own, elsewhere } = narrowTypecheckOutput(typecheck.output, relPath);
    if (own.length > 0) notes.push(`TypeScript у ${relPath}:\n${own.join('\n')}`);
    if (elsewhere > 0) notes.push(`TypeScript: ще ${elsewhere} помилок в інших файлах.`);
  }

  if (notes.length === 0) process.exit(0);

  const context = capBytes(
    `${notes.join('\n\n')}\n\nЦе lead, не статус: перевірка на зупинці вирішує остаточно.`,
    MAX_BYTES,
  );

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  })}\n`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Крок 4: Запустити тести — мають пройти**

```bash
chmod +x .claude/hooks/edit-check.mjs
npx playwright test --project=unit
```

- [ ] **Крок 5: Прогнати хук руками на чистому файлі**

```bash
printf '{"tool_input":{"file_path":"%s/app/page.tsx"}}' "$PWD" \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/edit-check.mjs
echo "код виходу: $?"
```

Очікується: жодного виводу, `код виходу: 0`. Тиша на чистому файлі — правильна поведінка.

- [ ] **Крок 6: Прогнати на навмисно зламаному файлі**

```bash
cp app/page.tsx /tmp/page.tsx.bak
printf '\nconst broken: number = "не число";\n' >> app/page.tsx

printf '{"tool_input":{"file_path":"%s/app/page.tsx"}}' "$PWD" \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/edit-check.mjs

cp /tmp/page.tsx.bak app/page.tsx
```

Очікується: один рядок JSON, у якому `hookSpecificOutput.hookEventName` дорівнює `PostToolUse`, а `additionalContext` містить `TS2322` і шлях `app/page.tsx`.

Перевірити форму окремо, а не на око:

```bash
printf '{"tool_input":{"file_path":"%s/app/page.tsx"}}' "$PWD" \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/edit-check.mjs \
  | node -e '
const o = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (o.hookSpecificOutput?.hookEventName !== "PostToolUse") throw new Error("не та подія");
if (typeof o.hookSpecificOutput.additionalContext !== "string") throw new Error("немає additionalContext");
console.log("форма правильна");'
```

(на зламаному файлі; очікується `форма правильна`)

- [ ] **Крок 7: Перевірити, що не-код ігнорується**

```bash
printf '{"tool_input":{"file_path":"%s/docs/tasks/SPRINT-01.md"}}' "$PWD" \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/edit-check.mjs
echo "код виходу: $?"
```

Очікується: тиша, `0`, і жодного запуску `tsc` (помітно миттєво).

- [ ] **Крок 8: Коміт**

```bash
git add .claude/hooks/edit-check.mjs tests/unit/edit-check.spec.ts
git commit -m "feat(hooks): перевірка після редагування як lead

Лінт звужується до файлу чесно. Тайпчек — ні: tsc --noEmit <file> дає
TS5112 і не завантажує tsconfig.json, тобто губить strict, jsx і типи
Next. Тому перевіряється весь проєкт, а звужується звіт — помилки в
інших файлах показуються лічильником, а не ховаються.

Результат адресується хешем вмісту, тож паралельні редагування зливаються
без локів.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: `stop-gate.mjs` — гейт на зупинці

Єдине місце, де з'являється статус. Форма виводу звірена з чинною документацією: для `Stop` поля `decision` і `reason` — **верхнього рівня**, а `hookSpecificOutput.additionalContext` — окремий, *неблокувальний* канал. Форма з вихідного брифу зблокувала б нічого, тихо.

**Files:**
- Create: `.claude/hooks/stop-gate.mjs`
- Test: `tests/unit/stop-gate.spec.ts`

**Interfaces:**
- Consumes: `capBytes` (задача 4); `scripts/verify/run.mjs --json`
- Produces: `summarise(report)`, `buildBlockReason(results)`, `shouldStillBlock(count, cap)`

- [ ] **Крок 1: Написати падаючий тест**

Створити `tests/unit/stop-gate.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { summarise, buildBlockReason, shouldStillBlock } from '../../.claude/hooks/stop-gate.mjs';

const report = {
  blocking: true,
  results: [
    { id: 'typecheck', status: 'FAILED', detail: 'код виходу 2', output: 'TS2322 ...' },
    { id: 'lint', status: 'PASSED', detail: '', output: '' },
    { id: 'e2e', status: 'SKIPPED', detail: 'немає браузера', output: '' },
    { id: 'build', status: 'NOT_RUN', detail: 'не пройшла typecheck', output: '' },
  ],
};

test('summarise відокремлює блокувальне від пропущеного', () => {
  const summary = summarise(report);
  expect(summary.blocking.map((r) => r.id)).toEqual(['typecheck', 'build']);
  expect(summary.skipped.map((r) => r.id)).toEqual(['e2e']);
});

test('SKIPPED не потрапляє в блокувальні при звичайному запуску', () => {
  expect(summarise(report).blocking.map((r) => r.id)).not.toContain('e2e');
});

test('причина блокування називає кожен рядок і його статус', () => {
  const reason = buildBlockReason(summarise(report).blocking);
  expect(reason).toContain('typecheck');
  expect(reason).toContain('FAILED');
  expect(reason).toContain('build');
  expect(reason).toContain('NOT_RUN');
});

test('причина блокування не порожня і не безмежна', () => {
  const reason = buildBlockReason(summarise(report).blocking);
  expect(reason.length).toBeGreaterThan(0);
  expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(8000);
});

test('межа livelock: після двох поспіль гейт перестає блокувати', () => {
  expect(shouldStillBlock(0, 2)).toBe(true);
  expect(shouldStillBlock(1, 2)).toBe(true);
  expect(shouldStillBlock(2, 2)).toBe(false);
  expect(shouldStillBlock(5, 2)).toBe(false);
});

test('зелений звіт не дає блокувальних рядків', () => {
  const green = { blocking: false, results: [{ id: 'lint', status: 'PASSED', detail: '', output: '' }] };
  expect(summarise(green).blocking).toEqual([]);
});
```

- [ ] **Крок 2: Запустити й переконатися, що падає**

```bash
npx playwright test --project=unit
```

- [ ] **Крок 3: Написати `.claude/hooks/stop-gate.mjs`**

```js
#!/usr/bin/env node
// Stop-гейт. Єдине місце, де з'являється статус.
//
// Форма виводу: для Stop `decision` і `reason` — поля ВЕРХНЬОГО РІВНЯ.
// hookSpecificOutput.additionalContext — окремий, неблокувальний канал.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';

import { capBytes } from '../../scripts/verify/report.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const COUNTER_DIR = path.join(ROOT, '.verify', 'gate-counter');
const CONSECUTIVE_CAP = 2;   // власна межа; у Claude Code вона 8
const MAX_REASON_BYTES = 8000;

export function summarise(report) {
  const results = report.results ?? [];
  return {
    blocking: results.filter((r) => r.status !== 'PASSED' && r.status !== 'SKIPPED'),
    skipped: results.filter((r) => r.status === 'SKIPPED'),
  };
}

export function buildBlockReason(blocking) {
  const rows = blocking
    .map((r) => {
      const tail = (r.output ?? '').trim().split('\n').slice(-6).join('\n');
      return `• ${r.status} ${r.id} — ${r.detail}${tail ? `\n${tail}` : ''}`;
    })
    .join('\n\n');

  return capBytes(
    `Перевірка не пройшла. Не заявляй, що імплементацію завершено.\n\n${rows}\n\n`
    + 'Полагодь причину, а не перевірку. Ослаблення правила замість виправлення коду '
    + 'тут вважається провалом, а не обхідним шляхом.',
    MAX_REASON_BYTES,
  );
}

export function shouldStillBlock(count, cap) {
  return count < cap;
}

/** Асинхронний запис у pipe обрізається синхронним process.exit одразу після нього. */
function writeAllSync(fd, text) {
  const buffer = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += writeSync(fd, buffer, offset, buffer.length - offset);
    } catch (error) {
      if (error.code === 'EAGAIN') continue;
      throw error;
    }
  }
}

function emit(payload, code) {
  writeAllSync(1, `${JSON.stringify(payload)}\n`);
  process.exit(code);
}

function readCounter(key) {
  try {
    return Number(readFileSync(path.join(COUNTER_DIR, key), 'utf8')) || 0;
  } catch {
    return 0;
  }
}

function writeCounter(key, value) {
  try {
    mkdirSync(COUNTER_DIR, { recursive: true });
    writeFileSync(path.join(COUNTER_DIR, key), String(value), 'utf8');
  } catch { /* лічильник — запобіжник, не умова коректності */ }
}

function main() {
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch { /* обробляється нижче */ }

  // Прапорець означає строго: «Claude продовжує, бо Stop-хук раніше заблокував».
  if (payload?.stop_hook_active === true) process.exit(0);

  const run = spawnSync(
    '/bin/sh',
    ['-c', 'node scripts/verify/run.mjs --tier fast --reuse-if-fresh --json'],
    { cwd: ROOT, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
  );

  let report = null;
  try {
    report = JSON.parse(run.stdout);
  } catch { /* обробляється нижче */ }

  // Fail open — але ГУЧНО. Ніякого тихого `|| exit 0`.
  if (!report) {
    emit({
      systemMessage:
        'ГЕЙТ НЕ ВІДПРАЦЮВАВ: перевірка не дала придатного результату. '
        + 'Код НЕ перевірено — не заявляй успіх. '
        + `${capBytes((run.stderr ?? '').trim(), 600)}`,
    }, 0);
  }

  const { blocking, skipped } = summarise(report);

  // Без stdin не можна прочитати stop_hook_active, тож блокувати небезпечно:
  // це прямий шлях у livelock. Не блокуємо — але й не мовчимо.
  if (!payload) {
    emit({
      systemMessage: blocking.length > 0
        ? `ГЕЙТ НЕ ЗМІГ ПРОЧИТАТИ ВХІД і тому не блокує, але перевірка ЧЕРВОНА: ${
          blocking.map((r) => `${r.status} ${r.id}`).join(', ')}. Не заявляй успіх.`
        : 'Гейт не зміг прочитати вхід; перевірка зелена.',
    }, 0);
  }

  const key = String(payload.prompt_id ?? 'no-prompt-id').replace(/[^A-Za-z0-9_-]/g, '_');

  if (blocking.length === 0) {
    writeCounter(key, 0);
    if (skipped.length > 0) {
      // «Зелено, але X пропущено» — інше твердження, ніж «зелено».
      emit({
        systemMessage:
          `Перевірка зелена, але пропущено: ${skipped.map((r) => `${r.id} (${r.detail})`).join('; ')}. `
          + 'Пропущене не доводить нічого — скажи це прямо у відповіді, не подавай як повністю перевірене.',
      }, 0);
    }
    process.exit(0);
  }

  const count = readCounter(key);
  if (!shouldStillBlock(count, CONSECUTIVE_CAP)) {
    writeCounter(key, 0);
    emit({
      systemMessage:
        `Гейт блокував ${CONSECUTIVE_CAP} рази поспіль і більше не блокує. Досі червоно: `
        + `${blocking.map((r) => `${r.status} ${r.id}`).join(', ')}. `
        + 'Почни відповідь прямою заявою, що перевірка не пройдена, і перелічи, що саме падає.',
    }, 0);
  }

  writeCounter(key, count + 1);
  emit({ decision: 'block', reason: buildBlockReason(blocking) }, 2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Крок 4: Запустити тести — мають пройти**

```bash
chmod +x .claude/hooks/stop-gate.mjs
npx playwright test --project=unit
```

- [ ] **Крок 5: Прогнати гейт на зеленому репозиторії**

```bash
rm -rf .verify/gate-counter
printf '{"prompt_id":"probe-green","stop_hook_active":false}' \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/stop-gate.mjs
echo "код виходу: $?"
```

Очікується: `код виходу: 0`. Вивід — або тиша, або `systemMessage` про пропущене (якщо chromium ще не завантажився, `e2e` не в `fast`, тож імовірна тиша).

- [ ] **Крок 6: Прогнати на червоному — і перевірити КОД 2 та ФОРМУ**

```bash
cp app/page.tsx /tmp/page.tsx.bak
printf '\nconst broken: number = "не число";\n' >> app/page.tsx
rm -rf .verify/gate-counter

printf '{"prompt_id":"probe-red","stop_hook_active":false}' \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/stop-gate.mjs \
  > /tmp/gate-out.json
echo "код виходу: $?"
cat /tmp/gate-out.json
```

Очікується `код виходу: 2` і JSON із **верхньорівневими** `decision` і `reason`.

Перевірити форму машинно, бо саме тут бриф помилявся:

```bash
node -e '
const o = JSON.parse(require("node:fs").readFileSync("/tmp/gate-out.json", "utf8"));
if (o.decision !== "block") throw new Error("decision не верхнього рівня або не block");
if (typeof o.reason !== "string" || o.reason.length === 0) throw new Error("reason порожній");
if (o.hookSpecificOutput) throw new Error("hookSpecificOutput тут не блокує — прибрати");
console.log("форма блокування правильна");'
```

- [ ] **Крок 7: Перевірити межу livelock**

```bash
for i in 1 2 3; do
  printf '{"prompt_id":"probe-red","stop_hook_active":false}' \
    | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/stop-gate.mjs > /dev/null
  echo "спроба $i → код виходу: $?"
done
```

Очікується: `спроба 1 → 2`, `спроба 2 → 2`, `спроба 3 → 0` (лічильник уже на 2 після кроку 6, тож точні числа можуть зсунутися на одиницю — важливо, що **послідовність блокувань скінченна**, а не що вона рівно така).

- [ ] **Крок 8: Перевірити `stop_hook_active` і повернути файл**

```bash
printf '{"prompt_id":"probe-red","stop_hook_active":true}' \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/stop-gate.mjs
echo "код виходу: $?"

cp /tmp/page.tsx.bak app/page.tsx
rm -rf .verify/gate-counter
npm run verify
```

Очікується: з прапорцем — миттєвий `0` без запуску перевірок; після відкоту — `verify` зелений.

- [ ] **Крок 9: Перевірити fail-open-loud**

```bash
mv scripts/verify/run.mjs scripts/verify/run.mjs.bak
printf '{"prompt_id":"probe-broken","stop_hook_active":false}' \
  | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/node.sh .claude/hooks/stop-gate.mjs
echo "код виходу: $?"
mv scripts/verify/run.mjs.bak scripts/verify/run.mjs
```

Очікується: `код виходу: 0` і `systemMessage` із текстом `ГЕЙТ НЕ ВІДПРАЦЮВАВ`. Тиші тут бути не може — мовчазний гейт читається як «перевірено».

- [ ] **Крок 10: Коміт**

```bash
git add .claude/hooks/stop-gate.mjs tests/unit/stop-gate.spec.ts
git commit -m "feat(hooks): Stop-гейт

decision і reason — поля верхнього рівня, як вимагає чинна документація
для Stop. Форма з вихідного брифу (усередині hookSpecificOutput)
зблокувала б нічого, тихо — саме той провал, від якого бриф застерігав.

Запис у сирий fd циклом за байтовим зсувом: асинхронний запис у pipe
обрізається синхронним process.exit одразу після нього.

Помилка самого гейта — fail open, але гучно. Знайдена проблема — fail
closed. Тихого || exit 0 немає ніде.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: Вмикання хуків і перевірка навмисним зламом

Досі кожен шматок перевірявся окремо. Тут перевіряється **зібране**, і єдиний спосіб це зробити — зламати код навмисно. Гейт, якого ніколи не бачили червоним у реальному ході, не перевірений: найгірший його стан — виглядати озброєним і не блокувати нічого.

**Files:**
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `node.sh`, `edit-check.mjs`, `stop-gate.mjs` (задачі 8–10)
- Produces: працюючі хуки для наступних сесій

- [ ] **Крок 1: Дописати ключ `hooks` у `.claude/settings.json`**

Використати skill `update-config` — це його призначення. Цільовий стан файлу:

```json
{
  "enabledPlugins": {
    "context7@claude-plugins-official": true,
    "skill-creator@claude-plugins-official": true,
    "superpowers@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/node.sh \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/edit-check.mjs",
            "timeout": 120
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/node.sh \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/stop-gate.mjs",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

Три речі тут навмисні:

- `timeout` заданий явно — дефолт command-хука 600 с, а гейт, що висить десять хвилин, зламаний.
- Матчер `Edit|Write`, без `MultiEdit`: такого інструмента не існує, і зайвий елемент у списку створював би враження покриття, якого немає.
- Файл — `settings.json`, не `settings.local.json`: шар передається клієнтові. Ключ `hooks` між рівнями налаштувань **зливається**, тож локальні налаштування проєктні хуки не затруть.

- [ ] **Крок 2: Перевірити, що JSON валідний**

```bash
node -e 'JSON.parse(require("node:fs").readFileSync(".claude/settings.json","utf8")); console.log("валідний JSON")'
```

- [ ] **Крок 3: Перезапустити сесію Claude Code**

Хуки зчитуються на старті сесії. Без перезапуску подальші кроки перевірять старий стан і дадуть хибно-заспокійливий результат.

- [ ] **Крок 4: Перевірити `PostToolUse` живим редагуванням**

Попросити Claude Code дописати в `app/page.tsx` рядок із помилкою типу, наприклад `const broken: number = 'не число';`.

Очікується: одразу після редагування в контекст приходить `additionalContext` з `TS2322` і шляхом `app/page.tsx`, і **хід не блокується** — Claude може редагувати далі.

- [ ] **Крок 5: Перевірити `Stop` на тому ж зламаному коді**

Попросити Claude завершити хід і заявити, що роботу зроблено.

Очікується: зупинку **заблоковано**, у контекст приходить `reason` із переліком `FAILED typecheck`, і Claude продовжує роботу замість того, щоб віддати зламаний код людині.

Це і є та поведінка, заради якої все будувалося. Якщо тут тиша — далі не йти: решта плану вже не має значення.

- [ ] **Крок 6: Полагодити й перевірити, що гейт відпускає**

Прибрати зламаний рядок і попросити Claude завершити хід.

Очікується: зупинка проходить. Якщо `e2e` пропущено через незавантажений браузер — приходить `systemMessage`, який вимагає сказати про пропущене вголос.

- [ ] **Крок 7: Переконатися, що робоче дерево чисте**

```bash
git status --short
npm run verify
```

Очікується: жодних слідів навмисних зламів; `verify` зелений.

- [ ] **Крок 8: Коміт**

```bash
git add .claude/settings.json
git commit -m "feat(hooks): увімкнути перевірку після редагування і Stop-гейт

Перевірено навмисним зламом у живій сесії: помилка типу блокує зупинку,
виправлення відпускає. Гейт, якого ніколи не бачили червоним, не
перевірений.

Таймаути задані явно: дефолт 600 с, а гейт, що висить десять хвилин,
зламаний.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: Опис для людини і запис у checkpoint

Шар передається клієнтові. Недокументований шар перевірки — це набір незрозумілих скриптів у переданій теці.

**Files:**
- Modify: `CLAUDE.md` (новий розділ)
- Create: `docs/checkpoints/CHECKPOINT-01.md`

**Interfaces:**
- Consumes: усе попереднє
- Produces: нічого для коду

- [ ] **Крок 1: Додати розділ у `CLAUDE.md`**

Після розділу `## Commands`, перед `## Agreed values`:

````markdown
## Verification

Three commands, one registry (`scripts/verify/registry.mjs`):

```
npm run verify              # fast tier — seconds; what the Stop hook runs
npm run verify:full         # + build + e2e — before handing work to a person
npm run verify:checkpoint   # full tier with --no-skip — before writing a checkpoint
```

Every check carries `proves` and `blindSpot` prose, and the runner's own tests
reject a row whose prose is missing — a check that cannot say what it fails to
cover does not belong in the registry.

**Five statuses, and they never collapse into each other.** `PASSED` ·
`FAILED` (ran, found a problem) · `SKIPPED` (**a precondition was missing —
says nothing about the code**) · `NOT_RUN` (a dependency failed first) ·
`UNRUNNABLE` (the check itself could not start). Reporting `FAILED` for
something that never ran would assert something about code nobody checked.

**Two hooks.** `PostToolUse` lints the edited file and type-checks the project
after every `Edit`/`Write` — advisory by platform design, since the tool has
already run. `Stop` runs the fast tier and blocks the turn when anything is
red. Fix the cause, never the check: weakening a rule to get green counts as
a failure here, not a workaround.

`npx playwright test --project=unit` runs unit tests without a browser;
`--project=e2e` runs the browser tests. One runner, per SPRINT-01 B-07.
````

- [ ] **Крок 2: Перевірити, чи з'явився `docs/checkpoints/TEMPLATE.md`**

```bash
ls -la docs/checkpoints/
```

`CLAUDE.md` посилається на цей шаблон, але на момент написання плану тека була порожня. Якщо шаблон з'явився — писати за ним, і кроки 3–4 підлаштувати під його рубрики. Якщо його досі немає — писати за структурою нижче й **сказати про це в підсумку**, а не вдавати, що шаблону дотримано.

- [ ] **Крок 3: Написати `docs/checkpoints/CHECKPOINT-01.md`**

Заповнити реальними результатами останнього прогону — **не переписувати числа з плану**. SPRINT-01 вимагає «тільки факти: як запустити, що зроблено, які команди виконані й з яким результатом, що перевірено візуально, що лишилося».

Обов'язкові розділи:

1. **Як запустити** — `nvm use`, `npm install`, `npm run dev`, і три команди `verify`.
2. **Що зроблено** — шар перевірки: реєстр, п'ять статусів, два рівні, два хуки.
3. **Виконані команди й результат** — вивід `npm run verify:checkpoint`, дослівно, з назвами пропущених рядків, якщо такі були.
4. **Таблиця `proves` / `blindSpot`** — вісім рядків. Це прямо відповідає на питання тижня: що тести вибору доводять і **чого не доводять**.
5. **Три нові залежності як свідомий виняток** — `eslint`, `eslint-config-next`, `@playwright/test`. Обґрунтування: усі три — інструменти перевірки, не залежності застосунку; `@playwright/test` прямо передбачений B-07; другого тестового раннера немає, юніт-тести виконує Playwright окремим проєктом без браузера.
6. **Що перевірено візуально, а не тестом** — і прямо: **рух перевірено оком; автоматична перевірка руху з керованим часом — завдання R3**.
7. **Що лишилося** — зокрема відкладене: рачети, `memo`, `selfcheck`, CI parity, і причини з §2 спеки.

- [ ] **Крок 4: Прогнати `verify:checkpoint` і вставити справжній вивід**

```bash
npm run verify:checkpoint 2>&1 | tee /tmp/checkpoint-run.txt
echo "код виходу: ${PIPESTATUS[0]}"
```

Якщо код `1` через `SKIPPED` — це і є призначення `--no-skip`: записати в checkpoint зелене, під яким половина не бігла, не можна. Або завантажити браузер і перепрогнати, або записати пропуск явно, назвавши його.

- [ ] **Крок 5: Коміт**

```bash
git add CLAUDE.md docs/checkpoints/CHECKPOINT-01.md
git commit -m "docs: описати шар перевірки в CLAUDE.md і checkpoint

Шар передається клієнтові, тож він описаний, а не лише працює. Checkpoint
містить таблицю proves/blindSpot — прямої відповіді на питання тижня «чого
тести НЕ доводять» — і фіксує, що рух перевірено візуально, а автоматична
перевірка руху належить R3.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Порядок і залежності

```
1 (інструменти)
└─ 2 (hash) ── 3 (реєстр + ядро) ── 4 (звіт + кеш)
                                     ├─ 5 (no-ref-imports) ─┐
                                     ├─ 6 (no-secrets)      ├─ 11 (вмикання) ── 12 (опис)
                                     ├─ 7 (deps-allowlist)  │
                                     └─ 8 (node.sh) ── 9 (edit-check) ── 10 (stop-gate) ─┘
```

Задачі 5, 6, 7 незалежні між собою — можуть виконуватися в будь-якому порядку або паралельно. Задача 5 змінює `hash.mjs`, тож якщо 6 і 7 ідуть паралельно, 5 має завершитися першою.

## Чого цей план не робить

Повторено з §11 спеки, бо в момент виконання це найлегше забути:

- **Нічого візуального.** Сіра карта, картка, що роз'їхалася, значок під неправильним кутом — усе це проходить усі вісім рядків.
- **Нічого про рух.** Свідомо, до R3.
- **Нічого про формати з ТЗ**, поки хтось не напише unit-тест на кожен.
- **Нічого про судження моделі.** Findings Клода лишаються lead.
- **Нічого про те, чого немає в реєстрі.**
