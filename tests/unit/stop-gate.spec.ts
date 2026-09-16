import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import {
  REASON_MAX_BYTES,
  MAX_CONSECUTIVE_BLOCKS,
  COUNTER_DIR,
  GATE_NOT_RUN,
  truncateUtf8,
  formatFailureTable,
  counterKey,
  blockCount,
  bumpBlockCount,
  resetBlockCount,
  readReused,
  decide,
} from '../../.claude/hooks/stop-gate.mjs';
// Типи — окремим `import type`: Babel стирає лише те, про що знає напевно, а
// декларації перевіряє тільки `check-types` (R-48), і саме вжиток тут робить
// їхнє зникнення помітним.
import type { CheckResult, GateKind, GateVerdict } from '../../.claude/hooks/stop-gate.mjs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const HOOK = path.join(ROOT, '.claude/hooks/stop-gate.mjs');

// ---------------------------------------------------------------------------
// Чисті функції
// ---------------------------------------------------------------------------

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

/**
 * Дрібний ліміт: маркер обрізання сам важить більше за нього, тож функція, яка
 * клеїть маркер безумовно, ПОРУШУЄ власний контракт саме там, де він найжорсткіший.
 * Тут це не гіпотеза: рівно так поводилася чернетка `truncateUtf8` у брифі — ліміти
 * 0, 1, 5, 10 і 21 усі повертали 22 байти. Гейт натомість позичає єдину реалізацію
 * шару (`truncateBytes`), і цей тест стереже саме позику: підміна її на власну
 * наївну копію червонить цей рядок.
 */
test('truncateUtf8 тримає навіть ліміт, менший за сам маркер', () => {
  for (const limit of [0, 1, 5, 10, 21, 22]) {
    const cut = truncateUtf8('ї'.repeat(50), limit);
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(limit);
    expect(cut).not.toContain('�');
  }
});

test('formatFailureTable друкує статус, id і причину — і лише блокувальні рядки', () => {
  const rows: CheckResult[] = [
    { id: 'typecheck', status: 'FAILED', reason: 'TS2322 у src/shared/config/map.ts' },
    { id: 'lint', status: 'PASSED', reason: '' },
    { id: 'build', status: 'NOT_RUN', reason: 'впав typecheck' },
    { id: 'e2e', status: 'UNRUNNABLE', reason: 'spawn ENOENT' },
  ];
  const table = formatFailureTable(rows);
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
    // Лічильники різних промптів не змішуються, і перевіряється це ДО скидання:
    // після нього спільний на всіх файл дав би ту саму одиницю, що й окремий, —
    // виміряно мутацією, яка складала всі промпти в один файл і лишалася зеленою.
    expect(bumpBlockCount(root, 'p-2')).toBe(1);
    expect(blockCount(root, 'p-1')).toBe(2);
    resetBlockCount(root, 'p-1');
    expect(blockCount(root, 'p-1')).toBe(0);
    expect(blockCount(root, 'p-2')).toBe(1); // чуже скидання свого не чіпає
    // Шлях у тесті стоїть ЛІТЕРАЛОМ — це контракт на диску, і брати його з того
    // самого модуля означало б звіряти реалізацію саму з собою. Константа
    // звіряється з літералом окремо, бо імпорт зі спека — єдине, що взагалі
    // стереже декларацію (R-48): `check-types` `.mjs` не читає.
    expect(COUNTER_DIR).toBe('.verify/gate-counter');
    expect(readdirSync(path.join(root, '.verify/gate-counter')).length).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Шостий ключ конверта і вердикт гейта
// ---------------------------------------------------------------------------

type Status = 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN' | 'UNRUNNABLE';

/** Конверт `run.mjs --json` — шість ключів, `reused` останнім (R-16 + R-73). */
function envelope(
  rows: { id: string; status: Status; reason?: string }[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tier: 'fast',
    root: '/дерево/проба',
    noSkip: false,
    sourceHash: 'a'.repeat(64),
    results: rows.map((row) => ({ reason: '', durationMs: 1, ...row })),
    reused: false,
    ...extra,
  };
}

const GREEN: { id: string; status: Status }[] = [
  { id: 'typecheck', status: 'PASSED' },
  { id: 'lint', status: 'PASSED' },
];

/** Вердикт у двох іменованих типах — інакше їх не перевіряє ніщо (R-48). */
function kindOf(report: unknown): GateKind {
  const verdict: GateVerdict = decide(report);
  return verdict.kind;
}

/**
 * Три значення, а не два, — і саме на цьому тесті ламаються обидві правдоподібні
 * НЕправильні реалізації: `if (report.reused)` назве рядок `'ні'` відтворенням, а
 * голе `report.reused === true` назве відсутній ключ свіжим прогоном. Друге
 * небезпечніше: `JSON.stringify` мовчки викидає ключ зі значенням `undefined`, тож
 * «немає ключа» — найімовірніша форма поломки конверта, і читати її як «щойно
 * перевірено» означає заявити більше, ніж дали дані.
 */
test('readReused розрізняє свіже, відтворене і невідоме — і нічого не вгадує', () => {
  expect(readReused({ reused: false })).toBe('fresh');
  expect(readReused({ reused: true })).toBe('reused');
  expect(readReused({})).toBe('unknown');
  expect(readReused({ reused: 'true' })).toBe('unknown');
  expect(readReused({ reused: 'ні' })).toBe('unknown');
  expect(readReused({ reused: 1 })).toBe('unknown');
  expect(readReused({ reused: null })).toBe('unknown');
});

test('свіже зелене — гейт мовчить', () => {
  const verdict = decide(envelope(GREEN));
  expect(verdict.kind).toBe('PASS');
  expect(verdict.message).toBe('');
});

/**
 * Головна знахідка відправлення: `reused: true` означає, що НЕ БІГЛО НІЧОГО.
 * Гейт відпускає (хеш дерева не змінився, тобто про цей самий код зелене вже
 * доводили), але мовчки зарахувати це як «щойно перевірено» не має права.
 */
test('відтворене зелене не мовчить: гейт відпускає, але каже, що нічого не бігло', () => {
  const verdict = decide(envelope(GREEN, { reused: true }));
  expect(verdict.kind).toBe('PASS');
  expect(verdict.message).toContain('НІЧОГО НЕ БІГЛО');
  expect(verdict.message).toContain('відтвор');
});

test('конверт без булевого reused — гейт відмовляється, а не рахує зеленим', () => {
  for (const broken of [{ reused: undefined }, { reused: 'true' }, { reused: 1 }]) {
    const verdict = decide(envelope(GREEN, broken));
    expect(verdict.kind).toBe('REFUSE');
    expect(verdict.message).toContain(GATE_NOT_RUN);
  }
});

/**
 * R-61 дослівно: «гейт не має права прочитати вихід 0 із прогону, у якому не бігло
 * нічого». Усі рядки `SKIPPED` — це саме він (корінь без node_modules), і «зелено,
 * але все пропущено» тут не пом'якшення, а те саме хибне зелене, лише багатослівне.
 */
test('усі рядки SKIPPED — це не зелене: гейт відмовляється і називає дерево', () => {
  const verdict = decide(envelope([
    { id: 'typecheck', status: 'SKIPPED', reason: 'немає node_modules' },
    { id: 'lint', status: 'SKIPPED', reason: 'немає node_modules' },
  ]));
  expect(verdict.kind).toBe('REFUSE');
  expect(verdict.message).toContain(GATE_NOT_RUN);
  expect(verdict.message).toContain('/дерево/проба'); // саме те дерево, яке оглянули
  expect(verdict.message).toContain('typecheck');
});

test('частина рядків SKIPPED — зелене з голосною поправкою (крок 5 спеки)', () => {
  const verdict = decide(envelope([
    { id: 'typecheck', status: 'PASSED' },
    { id: 'unit', status: 'SKIPPED', reason: '0 тестів написано' },
  ]));
  expect(verdict.kind).toBe('PASS');
  expect(verdict.message).toContain('ПРОПУЩЕНО');
  expect(verdict.message).toContain('unit');
  expect(verdict.message).toContain('0 тестів написано');
  // Пропуск — не відтворення: змішати два різні твердження означало б сказати
  // про прогін те, чого в конверті немає.
  expect(verdict.message).not.toContain('НІЧОГО НЕ БІГЛО');
});

test('кожен блокувальний статус блокує сам по собі', () => {
  for (const status of ['FAILED', 'NOT_RUN', 'UNRUNNABLE'] as Status[]) {
    const verdict = decide(envelope([
      { id: 'typecheck', status, reason: 'причина' },
      { id: 'lint', status: 'PASSED' },
    ]));
    expect(verdict.kind).toBe('BLOCK');
    expect(verdict.message).toContain(status);
    expect(verdict.message).toContain('typecheck');
    expect(verdict.message).toContain('/дерево/проба');
  }
});

/**
 * Полярність. `isBlocking` раннера (`run.mjs`, спека §5) — ЗАПЕРЕЧНИЙ перелік:
 * блокує все, що не `PASSED` і не `SKIPPED`. Дозвільний перелік у гейті робив би
 * його строго поблажливішим за раннер, про який він звітує: рядок без ключа
 * `status` не є ні провалом, ні пропуском і падав у гілку тихого зеленого —
 * виміряно наскрізно, вихід 0 і порожній stdout. Мутація «повернути дозвільний
 * перелік» червонить саме цей тест і більше жоден, тож без нього полярність не
 * пришпилена в жоден бік.
 */
test('невпізнаний, відсутній або зіпсований status БЛОКУЄ, як і в раннері', () => {
  const broken: unknown[][] = [
    [{ id: 'typecheck', reason: 'ключ status загублено', durationMs: 1 }],
    [{ id: 'typecheck', status: 'ЩОСЬ', reason: '', durationMs: 1 }],
    [{ id: 'typecheck', status: null, reason: '', durationMs: 1 }],
    [null],
    [1, 2],
  ];
  for (const rows of broken) {
    expect(kindOf(envelope(GREEN, { results: rows }))).toBe('BLOCK');
  }
  // І таблиця при цьому лишається читаною, а не падає на не-рядку.
  const table = formatFailureTable([
    { id: 'typecheck', reason: 'без status' },
    null,
  ] as unknown as CheckResult[]);
  expect(table).toContain('БЕЗ СТАТУСУ');
  expect(table).toContain('typecheck');
  expect(table).toContain('(без id)');
});

/**
 * Порожній вибір — НЕ «усе пропущено»: це два різні стани (R-61 і R-63). Усі
 * рядки `SKIPPED` означає, що щось бігло й нічого не довело; нуль рядків — що
 * раннер відмовляється звітувати про вибірку, якої не робив. Тому тест питає не
 * лише про відмову, а й про те, ЯКУ саме: варта нуля рядків стоїть перед вартою
 * всіх-пропущених, і без власного тексту її зникнення сховалося б за сусідньою
 * (виміряно мутацією — прибрана варта лишала набір зеленим).
 */
test('нуль рядків — відмова, і причина названа саме нулем рядків', () => {
  const verdict = decide(envelope([]));
  expect(verdict.kind).toBe('REFUSE');
  expect(verdict.message).toContain(GATE_NOT_RUN);
  expect(verdict.message).toContain('нуль рядків');
});

test('зіпсована форма конверта — відмова, ніколи зелене', () => {
  for (const broken of [
    envelope(GREEN, { results: 'не масив' }),
    envelope(GREEN, { results: undefined }),
    null,
    'не об’єкт',
    [],
  ]) {
    const verdict = decide(broken);
    expect(verdict.kind).toBe('REFUSE');
    expect(verdict.message).toContain(GATE_NOT_RUN);
  }
});

// ---------------------------------------------------------------------------
// Гейт цілком: підставний раннер у тимчасовому дереві
// ---------------------------------------------------------------------------

/**
 * Підставний раннер друкує заданий конверт і лишає слід `runner-ran.txt` у теці,
 * з якої його покликали. Слід несучий: без нього «раннер не біг» і «раннер біг та
 * нічого не сказав» виглядали б однаково — а це рівно та пара станів, яку весь шар
 * має розрізняти.
 */
function fakeRunner(payload: unknown, exitCode = 0): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return 'import { writeFileSync } from \'node:fs\';\n'
    + 'writeFileSync(\'runner-ran.txt\', \'ran\\n\');\n'
    + `process.stdout.write(${JSON.stringify(text)});\n`
    + `process.exitCode = ${exitCode};\n`;
}

function makeProbeRoot(runnerSource: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-stopgate-'));
  mkdirSync(path.join(root, 'scripts/verify'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/verify/run.mjs'), runnerSource);
  return root;
}

interface GateRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Запуск гейта в пробному дереві. `cwd` і `CLAUDE_PROJECT_DIR` вказують на те
 * саме дерево НАВІТЬ тоді, коли вхідний JSON кореня не називає, і це не
 * надмірність: варта не-об'єкта стоїть до вибору кореня, тож мутація, яка її
 * прибирає, відправляє гейт запасним шляхом — у СПРАВЖНІЙ репозиторій. Під час
 * ревю саме цей шлях записав `.verify/gate-counter/unknown` у робоче дерево й
 * вибив 60-секундний таймаут. Тест, герметичний лише поки реалізація правильна,
 * герметичний рівно тоді, коли він не потрібен.
 */
function runGate(
  root: string,
  input: unknown,
  { promptId = 'p-1', script = HOOK }: { promptId?: string; script?: string } = {},
): GateRun {
  const text = input === undefined
    ? JSON.stringify({
      session_id: 's-1', prompt_id: promptId, cwd: root, hook_event_name: 'Stop', stop_hook_active: false,
    })
    : JSON.stringify(input);
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: text,
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Тіло systemMessage — або порожньо, якщо гейт промовчав. */
function systemMessage(stdout: string): string {
  if (stdout.trim() === '') return '';
  const parsed: unknown = JSON.parse(stdout);
  return String((parsed as { systemMessage?: unknown }).systemMessage ?? '');
}

const RED = [
  { id: 'typecheck', status: 'FAILED' as Status, reason: 'TS2322 у src/shared/config/map.ts' },
  { id: 'lint', status: 'PASSED' as Status },
];

test('stop_hook_active — коротке замикання: раннер не запускається зовсім', () => {
  const root = makeProbeRoot(fakeRunner(envelope(RED), 1));
  try {
    const run = runGate(root, {
      session_id: 's-1', prompt_id: 'p-1', cwd: root, hook_event_name: 'Stop', stop_hook_active: true,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    // Саме тут замикання й доводиться: дерево ЧЕРВОНЕ, тож гейт, який пропустив
    // прапорець, дав би вихід 2. Слід раннера відсутній — нічого не запускалось.
    expect(existsSync(path.join(root, 'runner-ran.txt'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('червоне дерево — блокування з таблицею у stdout і в stderr, вихід 2', () => {
  // Вихід 1 у раннера — як у справжнього на червоному: придатний звіт приходить
  // із ненульовим кодом, і прочитати це як поломку означало б не заблокувати.
  const root = makeProbeRoot(fakeRunner(envelope(RED), 1));
  try {
    const run = runGate(root, undefined);
    expect(run.status).toBe(2);
    const parsed: unknown = JSON.parse(run.stdout);
    const output = parsed as { decision?: string; reason?: string };
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('FAILED');
    expect(output.reason).toContain('typecheck');
    expect(output.reason).toContain('TS2322');
    // Той самий текст у stderr: за виходу 2 документація обіцяє моделі саме його.
    expect(run.stderr).toContain('typecheck');
    expect(existsSync(path.join(root, 'runner-ran.txt'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Лічильник — запобіжник від livelock, а не умова коректності. `.verify` як ФАЙЛ
 * ламає `mkdirSync` у `bumpBlockCount`; виміряно на чернетці брифа, що гейт при
 * цьому вмирав стектрейсом ПІСЛЯ того, як установив червоне: вихід 1, порожній
 * stdout — для події Stop це неблокувальна помилка, тобто зупинка проходила.
 */
test('поломка лічильника не скасовує вже ухваленого блокування', () => {
  const root = makeProbeRoot(fakeRunner(envelope(RED), 1));
  try {
    writeFileSync(path.join(root, '.verify'), 'не тека\n');
    const run = runGate(root, undefined);
    expect(run.status).toBe(2);
    expect(systemMessage(run.stdout)).toBe('');
    const output = JSON.parse(run.stdout) as { decision?: string; reason?: string };
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('typecheck');
    // І поломка названа в самій причині, а не лише у stderr.
    expect(output.reason).toContain('лічильник блокувань недоступний');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Той самий збій на ЗЕЛЕНОМУ шляху. Там вихід 0, а за документацією stderr
 * доходить до моделі лише на виході 2 — тобто поломка межі livelock не
 * діставалася нікого: ні моделі, ні людини. Тепер вона їде `systemMessage`,
 * тим самим каналом, що й решта голосних поправок до зеленого.
 */
test('поломка лічильника на зеленому не тоне у stderr — вона в systemMessage', () => {
  const root = makeProbeRoot(fakeRunner(envelope(GREEN)));
  try {
    writeFileSync(path.join(root, '.verify'), 'не тека\n');
    const run = runGate(root, undefined);
    expect(run.status).toBe(0);
    expect(systemMessage(run.stdout)).toContain('лічильник блокувань недоступний');
    expect(systemMessage(run.stdout)).toContain('livelock');
    expect(run.stderr).toContain('лічильник блокувань недоступний'); // людині — те саме
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Твердження — про ПРИЧИНУ, а не лише про код виходу: без варти не-об'єкта вхід
 * `null` дає той самий вихід 0 і той самий `ГЕЙТ НЕ ВІДПРАЦЮВАВ` через
 * `main().catch`, тож перевірка «сталося щось гучне» на ньому впасти не може.
 * Різниця рівно в тексті: варта каже, ЩО з входом, а падіння — що впало.
 */
test('валідний JSON, який не є об’єктом, — гучна відмова, а не стектрейс', () => {
  const root = makeProbeRoot(fakeRunner(envelope(GREEN)));
  try {
    for (const input of [null, 42, 'рядок', ['масив']]) {
      const run = runGate(root, input);
      expect(run.status).toBe(0);
      expect(systemMessage(run.stdout)).toContain(GATE_NOT_RUN);
      expect(systemMessage(run.stdout)).toContain("вхід гейта не є об'єктом");
      // Раннер не кликали: вхід відкинуто до того, як гейт вибрав дерево.
      expect(existsSync(path.join(root, 'runner-ran.txt'))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('нерозбірний вивід раннера — fail open, але голосно (крок 4 спеки)', () => {
  const root = makeProbeRoot(fakeRunner('це не JSON\n'));
  try {
    const run = runGate(root, undefined);
    expect(run.status).toBe(0);
    // Дослівно, без подробиць: крок 11 брифа приймає саме цей рядок.
    expect(run.stdout.trim()).toBe(JSON.stringify({ systemMessage: GATE_NOT_RUN }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('відтворене зелене доходить крізь увесь гейт: вихід 0, але не тиша', () => {
  const root = makeProbeRoot(fakeRunner(envelope(GREEN, { reused: true })));
  try {
    const run = runGate(root, undefined);
    expect(run.status).toBe(0);
    expect(systemMessage(run.stdout)).toContain('НІЧОГО НЕ БІГЛО');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('свіже зелене скидає лічильник і проходить мовчки', () => {
  const root = makeProbeRoot(fakeRunner(envelope(GREEN)));
  try {
    bumpBlockCount(root, 'p-1');
    const run = runGate(root, undefined);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    expect(blockCount(root, 'p-1')).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('межа livelock: третє поспіль блокування не блокує, а вимагає сказати вголос', () => {
  const root = makeProbeRoot(fakeRunner(envelope(RED), 1));
  try {
    const first = runGate(root, undefined, { promptId: 'p-livelock' });
    const second = runGate(root, undefined, { promptId: 'p-livelock' });
    const third = runGate(root, undefined, { promptId: 'p-livelock' });
    expect([first.status, second.status, third.status]).toEqual([2, 2, 0]);
    expect(systemMessage(third.stdout)).toContain('досі червоно, ось що падає');
    expect(systemMessage(third.stdout)).toContain('typecheck');
    // Лічильник скидається на переході межі — інакше наступний хід почався б
    // одразу за межею і гейт не заблокував би ЖОДНОГО разу.
    expect(existsSync(path.join(root, '.verify/gate-counter/p-livelock'))).toBe(false);
    // Інший промпт межі не успадковує.
    expect(runGate(root, undefined, { promptId: 'p-other' }).status).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Варта вхідної точки. `import.meta.filename === process.argv[1]` під симлінком
 * НЕ кликало б `main()` зовсім: Node резолвить URL модуля крізь симлінк, а
 * `argv[1]` лишає як дали. Для звичайної перевірки ціна тієї дірки — різниця між
 * «PASSED» і «нічого не бігло»; для Stop-гейта — між «блокую» і «зупиняйся, все
 * гаразд». Сюїта стерегла це лише непрямо, у чужому спеку.
 */
test('варта вхідної точки: запуск крізь симлінк усе одно блокує', () => {
  const root = makeProbeRoot(fakeRunner(envelope(RED), 1));
  const linkDir = mkdtempSync(path.join(tmpdir(), 'sea-radar-gate-link-'));
  const link = path.join(linkDir, 'stop-gate-link.mjs');
  symlinkSync(HOOK, link);
  try {
    const run = runGate(root, undefined, { script: link });
    expect(run.status).toBe(2);
    const output = JSON.parse(run.stdout) as { decision?: string; reason?: string };
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('typecheck');
    expect(existsSync(path.join(root, 'runner-ran.txt'))).toBe(true);
  } finally {
    rmSync(linkDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Бюджет `REASON_MAX_BYTES` жив лише в чистих тестах `truncateUtf8` і не
 * приводився в дію ЖОДНИМ шляхом блокування — мутація «ніколи не обрізати
 * reason» виживала. Тут таблиця провалів навмисно більша за бюджет.
 */
test('причина блокування тримає байтовий бюджет, а JSON лишається цілим', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `перевірка-${index}`,
    status: 'FAILED' as Status,
    reason: 'дуже довга причина українською '.repeat(10),
  }));
  const root = makeProbeRoot(fakeRunner(envelope(rows), 1));
  try {
    const run = runGate(root, undefined);
    expect(run.status).toBe(2);
    const output = JSON.parse(run.stdout) as { reason?: string };
    const reason = String(output.reason);
    expect(Buffer.byteLength(reason, 'utf8')).toBeGreaterThan(REASON_MAX_BYTES / 2);
    expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(REASON_MAX_BYTES);
    expect(reason).toContain('обрізано');
    expect(reason).not.toContain('�'); // жодної літери, розрізаної навпіл
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Крок 1 спеки: зависле читання stdin не має вішати хід — але й НЕ має тихо
 * вважатися порожнім входом, бо порожнє читання загубило б `prompt_id` і
 * вимкнуло межу livelock. Гілку `!ok` не приводило в дію ніщо: `spawnSync`
 * завжди закриває stdin, тож дістатися до неї можна лише асинхронним запуском,
 * у якому труба лишається відкритою.
 */
test('зависле читання stdin не вважається порожнім входом', async () => {
  const root = makeProbeRoot(fakeRunner(envelope(RED), 1));
  try {
    const child = spawn(process.execPath, [HOOK], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    // stdin навмисно НЕ закривається — гейт мусить вийти сам, за своїм таймаутом.
    const status = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });
    expect(status).toBe(0);
    expect(systemMessage(stdout)).toContain(GATE_NOT_RUN);
    expect(systemMessage(stdout)).toContain('не прочитано');
    // Раннера не кликали: без входу невідомо навіть, яке дерево перевіряти.
    expect(existsSync(path.join(root, 'runner-ran.txt'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('без поля cwd гейт не мовчить навіть на зеленому — і називає взяте дерево', () => {
  const root = makeProbeRoot(fakeRunner(envelope(GREEN)));
  try {
    const result = spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      input: JSON.stringify({ session_id: 's-1', prompt_id: 'p-1', hook_event_name: 'Stop' }),
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    expect(result.status).toBe(0);
    expect(systemMessage(result.stdout)).toContain('CLAUDE_PROJECT_DIR');
    expect(systemMessage(result.stdout)).toContain(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
