import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import {
  type Check,
  type Precondition,
  type Tier,
  CHECKS,
  DEFAULT_TIMEOUT_MS,
  PRECONDITIONS,
} from '../../scripts/verify/registry.mjs';
import {
  type CheckResult,
  type Options,
  type Status,
  classifyExit,
  isBlocking,
  orderChecks,
  parseArgs,
  parsePlaywrightTotal,
  resolveRoot,
  runAll,
  selectChecks,
} from '../../scripts/verify/run.mjs';

// Кожне ім'я з обох `.d.mts` імпортоване тут і вжите нижче. Це не охайність:
// за `allowJs: false` TypeScript читає декларацію й НІКОЛИ не читає `.mjs`,
// тож `check-types` однаково радо прийме декларацію, якій у рантаймі не
// відповідає нічого. Єдина перевірка, що існує, — рантайм-імпорт із тесту
// (R-48).

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
  const alwaysBlocking: Status[] = ['FAILED', 'NOT_RUN', 'UNRUNNABLE'];
  for (const status of alwaysBlocking) {
    expect(isBlocking(status, false)).toBe(true);
    expect(isBlocking(status, true)).toBe(true);
  }
});

// 2. parseArgs — усі шість прапорців зі спеки §5 (--tier, --no-skip, --only,
//    --reuse-if-fresh, --json, --timeout-ms) плюс доданий --root.
test('parseArgs: дефолти', () => {
  const opts: Options = parseArgs([]);
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

// 7. Виконавча частина раннера — resolveRoot і runAll.
test('resolveRoot: корінь git-дерева, а поза репозиторієм — тека запуску', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'sea-radar-root-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'sea-radar-noroot-'));
  try {
    // `init.defaultBranch` задано явно з тієї ж причини, що й у hash.spec.ts:
    // інакше вивід тесту залежить від ~/.gitconfig машини.
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: repo });
    mkdirSync(path.join(repo, 'a/b'), { recursive: true });
    // realpathSync: на macOS tmpdir лежить за симлінком (/var → /private/var),
    // а git віддає вже розв'язаний шлях.
    expect(resolveRoot(path.join(repo, 'a/b'))).toBe(realpathSync(repo));
    // Поза репозиторієм — повертає рівно те, що дали, і не падає.
    expect(resolveRoot(outside)).toBe(outside);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('runAll: чотири статуси на чужому реєстрі — раннер не знає жодної перевірки', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-runall-'));
  try {
    // Рядок `skip` доводить щось лише тоді, коли пробі справді нема чого знайти.
    // Свіжа тимчасова тека це гарантує — але гарантію теж перевіряємо, інакше
    // тест зеленів би й з пробою, яка завжди каже «так» (R-50).
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false);

    const tier: Tier = 'fast';
    const checks: Check[] = [
      { id: 'ok', tier, cmd: 'printf ok', needs: [], after: [], proves: '.', blindSpot: '.' },
      { id: 'bad', tier, cmd: 'exit 3', needs: [], after: [], proves: '.', blindSpot: '.' },
      { id: 'blocked', tier, cmd: 'true', needs: [], after: ['bad'], proves: '.', blindSpot: '.' },
      { id: 'skip', tier, cmd: 'true', needs: ['node-modules'], after: [], proves: '.', blindSpot: '.' },
    ];

    const results: CheckResult[] = await runAll({
      checks, root, tier, noSkip: false, only: [], timeoutMs: null,
    });

    // Жоден id звідси не згадується в run.mjs: перевірки прийшли параметром.
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['ok', 'PASSED'],
      ['bad', 'FAILED'],
      ['skip', 'SKIPPED'],
      ['blocked', 'NOT_RUN'],
    ]);
    // NOT_RUN мусить називати винуватця: без цього рядок мовчить про те,
    // чому перевірка нічого не стверджує.
    expect(results.find((r) => r.id === 'blocked')?.reason).toContain('bad');
    expect(results.find((r) => r.id === 'bad')?.exitCode).toBe(3);
    // Вивід справді зібрано, а не лише оголошено в декларації.
    expect(results.find((r) => r.id === 'ok')?.stdout).toBe('ok');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 8. Цілісність реєстру — стереже дані, не логіку.
test('реєстр: id унікальні, tier валідний, посилання розвʼязні', () => {
  const ids = CHECKS.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const check of CHECKS) {
    expect(['fast', 'full']).toContain(check.tier);
    for (const need of check.needs) expect(Object.keys(PRECONDITIONS)).toContain(need);
    for (const dep of check.after) expect(ids).toContain(dep);
  }
  // Таймаут — теж дані рядка. Перекриття мусить бути ЩЕДРІШИМ за дефолт:
  // таймаут дає UNRUNNABLE, тобто блокування з неправдивої причини, тож
  // рядок, що просить власний ліміт менший за загальний, — помилка (R-17).
  expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
  for (const check of CHECKS) {
    if (check.timeoutMs !== undefined) expect(check.timeoutMs).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
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

test('реєстр: проби передумов відповідають чесно в обидва боки', () => {
  // Проба, що НІКОЛИ не каже «так», перетворює кожну перевірку на SKIPPED,
  // а весь прогін — на EXIT=0, який не перевірив нічого. Тому кожна проба
  // перевіряється обома відповідями, а середовище задається явно (R-50).
  const empty = mkdtempSync(path.join(tmpdir(), 'sea-radar-probe-'));
  const browsers = mkdtempSync(path.join(tmpdir(), 'sea-radar-browsers-'));
  const savedBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    const nodeModules: Precondition = PRECONDITIONS['node-modules'];
    expect(nodeModules.probe(empty)).toBe(false);
    mkdirSync(path.join(empty, 'node_modules'));
    expect(nodeModules.probe(empty)).toBe(true);

    // Порожня тека резолвити @playwright/test нізвідки; корінь цього
    // репозиторію — звідки, інакше цей тест не зміг би виконатися.
    expect(PRECONDITIONS['playwright-pkg'].probe(empty)).toBe(false);
    expect(PRECONDITIONS['playwright-pkg'].probe(process.cwd())).toBe(true);

    process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    expect(PRECONDITIONS['playwright-browser'].probe(empty)).toBe(false);
    mkdirSync(path.join(browsers, 'chromium-1181'));
    expect(PRECONDITIONS['playwright-browser'].probe(empty)).toBe(true);
  } finally {
    if (savedBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsersPath;
    rmSync(empty, { recursive: true, force: true });
    rmSync(browsers, { recursive: true, force: true });
  }
});
