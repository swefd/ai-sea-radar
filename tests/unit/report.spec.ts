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
  toStdoutJson,
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
  expect(truncateBytes(ukr, 5)).not.toContain('\uFFFD');
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
  // `as const` на `tier` і `as string[]` на `only` — та сама причина, що й у `result()`
  // вище: без них TS виводить `tier: string`, і виклик дає TS2345 замість червоного
  // тесту. Цілий `as const` не годиться — він робить `only` readonly.
  const base = { hash: 'h', tier: 'fast' as const, noSkip: false, only: [] as string[] };
  expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  expect(cacheKey(base)).not.toBe(cacheKey({ ...base, tier: 'full' }));
  expect(cacheKey(base)).not.toBe(cacheKey({ ...base, noSkip: true }));
  expect(cacheKey(base)).not.toBe(cacheKey({ ...base, only: ['lint'] }));
});

test('readFreshPass повертає звіт лише при збігу ключа І чистому результаті', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-'));
  const opts = { hash: 'h1', tier: 'fast' as const, noSkip: false, only: [] as string[] };
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
  const opts = { hash: 'h1', tier: 'fast' as const, noSkip: false, only: [] as string[] };
  writeReport(root, toReport({ root, ...opts, fileCount: 1, reused: false, blocking: true, results: [result({ status: 'FAILED', exitCode: 1 })] }));
  expect(readFreshPass(root, cacheKey(opts))).toBe(null);
});

// 7. Конверт stdout (R-64). До цієї задачі форму `--json` не перевіряв жоден тест:
// CLI не запускає ніщо в наборі, тож поле можна було прибрати, лишивши все зелене.
test('toStdoutJson віддає рівно пʼять ключів R-16 і повні рядки результатів', () => {
  const report = toReport({
    root: '/tmp/x', tier: 'full', noSkip: true, only: ['lint'],
    hash: 'abc123', fileCount: 11, reused: false, blocking: false,
    results: [result(), result({ id: 'unit', status: 'SKIPPED', reason: '0 тестів написано', durationMs: 0 })],
  });
  const json = toStdoutJson(report);
  // Порядок ключів теж фіксований R-16, тож toEqual по масиву, а не toContain.
  expect(Object.keys(json)).toEqual(['tier', 'root', 'noSkip', 'sourceHash', 'results']);
  expect(json.tier).toBe('full');
  expect(json.root).toBe('/tmp/x');
  expect(json.noSkip).toBe(true);
  expect(json.sourceHash).toBe('abc123');   // поле `hash` звіту під іменем із R-16
  expect(Array.isArray(json.results)).toBe(true);
  expect(json.results).toHaveLength(2);
  for (const row of json.results) {
    expect(typeof row.id).toBe('string');
    expect(typeof row.status).toBe('string');
    expect(typeof row.reason).toBe('string');   // для PASSED це порожній рядок — і це задумано
    expect(Number.isFinite(row.durationMs)).toBe(true);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  }
});
