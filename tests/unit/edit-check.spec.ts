import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import {
  isCheckablePath,
  isOutsideRoot,
  parseTscErrors,
  formatLead,
  tscNotRun,
  eslintNotRun,
  CODE_EXTENSIONS,
  IGNORED_PREFIXES,
  IGNORED_FILES,
  TYPECHECK_CACHE_DIR,
  NOT_RUN_PREFIX,
  MAX_LEAD_BYTES,
} from '../../.claude/hooks/edit-check.mjs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const HOOK = path.join(ROOT, '.claude/hooks/edit-check.mjs');

/**
 * Дерево-проба: справжній git-репозиторій (без нього `sourceHash` не має що
 * питати), але БЕЗ `node_modules`. Тобто обидва інструменти фізично відсутні —
 * рівно стан свіжого клону до `npm ci`, і рівно той стан, у якому хук раніше
 * мовчав би так само, як на чистому дереві.
 *
 * Справжнє дерево для цього не годиться: воно чисте, тож «порожньо» в ньому —
 * законний результат, і тест не відрізнив би виконаної перевірки від невиконаної.
 */
function makeProbeRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-editcheck-'));
  mkdirSync(path.join(root, 'src/shared/config'), { recursive: true });
  writeFileSync(path.join(root, 'src/shared/config/map.ts'), 'export const X = 1;\n');
  writeFileSync(path.join(root, 'docs.md'), '# не код\n');
  // `init.defaultBranch` задано явно — інакше вивід фікстури залежав би від
  // глобального ~/.gitconfig машини, на якій її створили (так само в hash.spec.ts).
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root });
  return root;
}

/**
 * Дерево-проба з РОБОЧИМИ інструментами: `node_modules` — симлінк на справжні,
 * тож `tsc` і `eslint` реально біжать, але по крихітному дереву. Так
 * перевіряється те, чого дерево без інструментів показати не може: справжній
 * вердикт і те, куди лягає кеш.
 */
function makeWorkingRepo(source: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-editcheck-live-'));
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    '{"compilerOptions":{"strict":true,"noEmit":true,"module":"esnext",'
    + '"moduleResolution":"bundler"},"include":["*.ts"]}\n',
  );
  // Порожній flat-конфіг: ESLint має відпрацювати й дати вердикт, а не впасти
  // на відсутньому конфігу — інакше тест не відрізнив би одне від одного.
  writeFileSync(path.join(root, 'eslint.config.mjs'), 'export default [];\n');
  writeFileSync(path.join(root, 'probe.ts'), source);
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root });
  return root;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(
  input: string,
  { env = {}, script = HOOK }: { env?: Record<string, string>; script?: string } = {},
): HookRun {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input,
    // Середовище береться як є плюс перевизначення: хук читає CLAUDE_PROJECT_DIR,
    // і саме його підміна — предмет двох тестів нижче.
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Тіло `additionalContext` із виводу хука — або порожньо, якщо вивід порожній. */
function additionalContext(stdout: string): string {
  if (stdout.trim() === '') return '';
  const parsed: unknown = JSON.parse(stdout);
  const hookOutput = (parsed as {
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  }).hookSpecificOutput;
  expect(hookOutput?.hookEventName).toBe('PostToolUse');
  return String(hookOutput?.additionalContext ?? '');
}

function payload(fields: Record<string, unknown>): string {
  return JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', ...fields });
}

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

test('isCheckablePath відкидає й те, чого не лінтить ESLint', () => {
  // Периметр хука не має бути ШИРШИМ за периметр лінту — і це не про зайву
  // роботу. Виміряно: `eslint out/probe9.ts` виходить із кодом 0 і рядком
  // «File ignored…», що читається як ЧИСТО, тож для файлу зі справжньою
  // TS2322 хук друкував нуль байтів. Хибне чисте, не марна робота.
  expect(isCheckablePath('.superpowers/sdd/2026-09-15-verify-layer/draft.mjs')).toBe(false);
  expect(isCheckablePath('.claude/worktrees/verify-layer/scripts/verify/run.mjs')).toBe(false);
  expect(isCheckablePath('out/probe9.ts')).toBe(false);
  expect(isCheckablePath('build/probe9.ts')).toBe(false);
  expect(isCheckablePath('next-env.d.ts')).toBe(false);
  // А власні хуки — лінтяться й перевіряються, тож лишаються в периметрі.
  expect(isCheckablePath('.claude/hooks/edit-check.mjs')).toBe(true);
});

test('перелік ігнорів хука не відстає від globalIgnores у eslint.config.mjs', () => {
  // Ручна синхронність один раз уже відстала: `out/`, `build/` і
  // `next-env.d.ts` були в конфігу й не були в хуку. Цей тест читає конфіг і
  // звіряє КОЖЕН його запис, тож наступне розходження буде червоним, а не
  // мовчазним чистим.
  const config = readFileSync(path.join(ROOT, 'eslint.config.mjs'), 'utf8');
  const block = /globalIgnores\(\[([\s\S]*?)\n\s*\]\)/.exec(config);
  expect(block, 'globalIgnores у eslint.config.mjs не знайдено').not.toBeNull();

  const patterns = [...(block as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  // Порожній перелік зробив би цикл нижче безглуздим, а тест — зеленим ні від чого.
  expect(patterns.length).toBeGreaterThanOrEqual(5);

  for (const pattern of patterns) {
    // `.next/**` → зразок файлу в тій теці; `next-env.d.ts` → він сам.
    const sample = pattern.endsWith('/**') ? `${pattern.slice(0, -3)}/probe.ts` : pattern;
    expect(isCheckablePath(sample), `не покрито: ${pattern}`).toBe(false);
  }
});

test('декларації .d.mts відповідають тому, що модуль справді експортує', () => {
  // R-48: `check-types` НЕ звіряє .d.mts із .mjs — єдине, що взагалі перевіряє
  // декларацію, це імпорт імені в тесті. Тому кожне ім'я тут не лише
  // імпортоване, а й ужите у твердженні, яке має значення.
  expect(CODE_EXTENSIONS).toEqual(['.ts', '.tsx', '.mjs', '.js']);
  for (const extension of CODE_EXTENSIONS) {
    expect(isCheckablePath(`src/shared/probe${extension}`)).toBe(true);
  }
  // Розширення поза переліком — не код для цього хука.
  expect(isCheckablePath('src/shared/probe.json')).toBe(false);

  for (const prefix of IGNORED_PREFIXES) {
    expect(isCheckablePath(`${prefix}probe.ts`), `не ігнорується: ${prefix}`).toBe(false);
  }
  for (const file of IGNORED_FILES) {
    expect(isCheckablePath(file), `не ігнорується: ${file}`).toBe(false);
  }

  // Кеш — не будь-де, а саме там, куди вказує константа: перевіряється нижче
  // на справжньому прогоні, тут — форма шляху.
  expect(TYPECHECK_CACHE_DIR).toBe('.verify/typecheck');
});

test('isOutsideRoot бачить вихід за корінь у всіх трьох формах', () => {
  expect(isOutsideRoot('../інше-дерево/src/a.ts')).toBe(true);
  expect(isOutsideRoot('..')).toBe(true);
  expect(isOutsideRoot('/Users/хтось/проєкт/src/a.ts')).toBe(true);
  expect(isOutsideRoot('src/shared/config/map.ts')).toBe(false);
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

test('tscNotRun відрізняє вердикт tsc від незапуску tsc', () => {
  // Виміряно на цьому дереві: `tsc --noEmit` із помилкою типу виходить із кодом
  // 2, а з неіснуючим tsconfig — із кодом 1. Тобто САМ КОД виходу не каже, чи
  // був вердикт; каже наявність розібраних діагностик.
  const verdict = { status: 2, stdout: 'src/a.ts(1,1): error TS2322: bad.', stderr: '' };
  expect(tscNotRun(verdict, 1)).toBe('');
  expect(tscNotRun({ status: 0, stdout: '', stderr: '' }, 0)).toBe('');

  // Зламаний або відсутній tsc: увесь текст у stderr, розібрати нічого.
  const broken = { status: 1, stdout: '', stderr: "Error: Cannot find module '/x/tsc'" };
  const notice = tscNotRun(broken, 0);
  expect(notice).toContain(NOT_RUN_PREFIX);
  expect(notice).toContain('tsc');
  // Подробиця зі stderr доходить — інакше причину довелося б угадувати.
  expect(notice).toContain('Cannot find module');

  // Процес не стартував зовсім: коду виходу немає.
  expect(tscNotRun({ status: null, stdout: '', stderr: 'spawn EACCES' }, 0)).toContain(NOT_RUN_PREFIX);

  // Переповнення maxBuffer: процес обірвано, коду виходу немає, але частковий
  // stdout устиг дати розібрані діагностики. Правило «є діагностики — є
  // вердикт» пустило б обрізаний результат у кеш ЯК ВЕРДИКТ, на добу вперед.
  const overflow = {
    status: null,
    stdout: 'src/a.ts(1,1): error TS2322: bad.\nsrc/b.ts(2,2): error TS2345: bad.',
    stderr: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  };
  expect(tscNotRun(overflow, 2)).toContain(NOT_RUN_PREFIX);
});

test('eslintNotRun відрізняє вердикт ESLint від незапуску ESLint', () => {
  // Виміряно: вихід 1 — знайдено проблеми (stylish їх завжди друкує в stdout),
  // вихід 2 — фатальна помилка конфігу, і весь текст лежить у stderr.
  const verdict = { status: 1, stdout: '/x/a.ts\n  1:1  error  Unexpected\n', stderr: '' };
  expect(eslintNotRun(verdict)).toBe('');
  expect(eslintNotRun({ status: 0, stdout: '', stderr: '' })).toBe('');

  const fatal = { status: 2, stdout: '', stderr: 'Error: Invalid eslint.config.mjs' };
  expect(eslintNotRun(fatal)).toContain(NOT_RUN_PREFIX);
  expect(eslintNotRun(fatal)).toContain('Invalid eslint.config.mjs');

  // Вихід 1 із ПОРОЖНІМ stdout — це не вердикт: так виходить Node, коли не
  // знайшов самого eslint. Правило «1 — це завжди вердикт» тут і мовчало б.
  expect(eslintNotRun({ status: 1, stdout: '', stderr: "Cannot find module '/x/eslint.js'" }))
    .toContain(NOT_RUN_PREFIX);
});

test('formatLead без знахідок, але з незапуском, НЕ мовчить', () => {
  const notice = tscNotRun({ status: 1, stdout: '', stderr: 'boom' }, 0);
  const lead = formatLead('src/shared/config/map.ts', '', [], [notice]);
  // Порожній lead тут означав би «перевірено й чисто» — тобто брехню про код,
  // якого ніхто не дивився.
  expect(lead).not.toBe('');
  expect(lead).toContain(NOT_RUN_PREFIX);
});

test('гучне «не виконалось» стоїть ПЕРШИМ, а не під списком знахідок', () => {
  // Із єдиною секцією порядок не перевіряється ніяк: будь-яка перестановка
  // лишає той самий рядок першим. Тому тут секцій кілька — і саме це
  // відрізняє «поставили першим» від «поставили як вийде».
  const notice = eslintNotRun({ status: 2, stdout: '', stderr: 'конфіг не зібрався' });
  const errors = parseTscErrors('src/shared/config/map.ts(12,7): error TS2322: Не той тип.');
  const lead = formatLead('src/shared/config/map.ts', '', errors, [notice]);

  expect(lead).toContain('TS2322');
  // Під висновком про типи це читалося б ПІСЛЯ висновку, який воно скасовує.
  expect(lead.indexOf(NOT_RUN_PREFIX)).toBe(0);
  expect(lead.indexOf(NOT_RUN_PREFIX)).toBeLessThan(lead.indexOf('TS2322'));
});

test('великий вивід ESLint не витісняє помилок типів із lead', () => {
  // ESLint у форматі stylish друкує по рядку на проблему й не має ліміту.
  // Файл із сотнями зауважень дав би текст, довший за весь бюджет lead, і
  // секція типів — важливіша — не помістилася б узагалі.
  const eslintText = Array.from({ length: 4000 }, (_, i) => `  ${i}:1  error  Щось не так`).join('\n');
  const errors = parseTscErrors('src/shared/config/map.ts(12,7): error TS2322: Не той тип.');
  const lead = formatLead('src/shared/config/map.ts', eslintText, errors);

  expect(lead).toContain('TS2322');
  expect(Buffer.byteLength(lead, 'utf8')).toBeLessThanOrEqual(MAX_LEAD_BYTES);
});

test('lead обрізається за БАЙТАМИ, лишає слід і не ріже символ навпіл', () => {
  // Зсув на один ASCII-символ рухає межу обрізання всередині двобайтових
  // кириличних символів: одна з проб неодмінно лягає на непарну межу, де
  // посимвольне обрізання дало б U+FFFD.
  for (const pad of ['', '.', '..', '...']) {
    const errors = parseTscErrors(
      `src/shared/config/map.ts(1,1): error TS2322: ${pad}${'я'.repeat(20000)}`,
    );
    const lead = formatLead('src/shared/config/map.ts', '', errors);
    expect(Buffer.byteLength(lead, 'utf8')).toBeLessThanOrEqual(MAX_LEAD_BYTES);
    expect(lead).toContain('обрізано');
    expect(lead).not.toContain('�');
  }
});

test('дерево без інструментів: хук каже вголос, що перевірки не було', () => {
  const root = makeProbeRepo();
  try {
    const run = runHook(payload({
      cwd: root,
      tool_input: { file_path: path.join(root, 'src/shared/config/map.ts') },
    }));
    expect(run.status).toBe(0); // хук не блокує — ані на знахідці, ані на поломці
    const context = additionalContext(run.stdout);
    expect(context).toContain(NOT_RUN_PREFIX);
    expect(context).toContain('tsc');
    expect(context).toContain('ESLint');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('справжній вердикт лягає в кеш саме за TYPECHECK_CACHE_DIR', () => {
  // Єдине місце, де інструменти справді біжать усередині тесту. Воно закріплює
  // дві речі одразу: що вердикт доходить до lead і що кеш пишеться туди, куди
  // вказує константа, — а не «десь у .verify».
  const root = makeWorkingRepo('export const probe: number = "не число";\n');
  try {
    const run = runHook(payload({
      cwd: root,
      tool_input: { file_path: path.join(root, 'probe.ts') },
    }));
    expect(run.status).toBe(0);
    expect(additionalContext(run.stdout)).toContain('TS2322');

    const cached = readdirSync(path.join(root, TYPECHECK_CACHE_DIR));
    expect(cached).toHaveLength(1);
    const errors: unknown = JSON.parse(
      readFileSync(path.join(root, TYPECHECK_CACHE_DIR, cached[0]), 'utf8'),
    );
    expect(Array.isArray(errors) ? errors : []).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('незапуск не кешується: другий виклик так само гучний', () => {
  // Кеш типів живе добу. Записати в нього «нуль помилок», що насправді означає
  // «tsc не бігло», — це законсервувати брехню на добу вперед: усі наступні
  // правки отримали б порожній lead із чистою совістю.
  const root = makeProbeRepo();
  const input = payload({
    cwd: root,
    tool_input: { file_path: path.join(root, 'src/shared/config/map.ts') },
  });
  try {
    expect(additionalContext(runHook(input).stdout)).toContain('tsc');
    expect(additionalContext(runHook(input).stdout)).toContain('tsc');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('не-код у тому самому дереві не запускає НІЧОГО', () => {
  // Структурний доказ кроку 1 спеки, не таймерний. У дереві без інструментів
  // будь-яка спроба запустити tsc чи ESLint неодмінно лишила б гучний слід —
  // порожній вивід тут можливий рівно тому, що хук вийшов до них.
  const root = makeProbeRepo();
  try {
    const run = runHook(payload({
      tool_name: 'Write',
      cwd: root,
      tool_input: { file_path: path.join(root, 'docs.md') },
    }));
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('виклик крізь символічне посилання не робить хук мовчазним', () => {
  // На macOS /tmp — симлінк на /private/tmp, тож наївна варта вхідної точки
  // (`import.meta.filename === process.argv[1]`) тут не покликала б main()
  // зовсім: вихід 0 і порожній stdout — невідрізненно від чистого дерева.
  const root = makeProbeRepo();
  const linkDir = mkdtempSync(path.join(tmpdir(), 'sea-radar-editcheck-link-'));
  const link = path.join(linkDir, 'edit-check.mjs');
  symlinkSync(HOOK, link);
  try {
    const run = runHook(
      payload({ cwd: root, tool_input: { file_path: path.join(root, 'src/shared/config/map.ts') } }),
      { script: link },
    );
    expect(run.status).toBe(0);
    expect(additionalContext(run.stdout)).toContain(NOT_RUN_PREFIX);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(linkDir, { recursive: true, force: true });
  }
});

test('нерозбірний вхід — теж гучно, а не тихо', () => {
  const run = runHook('це не JSON');
  expect(run.status).toBe(0);
  // Хук, який не зрозумів події, не перевірив нічого — і мусить сказати саме це.
  expect(additionalContext(run.stdout)).toContain(NOT_RUN_PREFIX);

  // `null` — валідний JSON, але не подія: читання полів кидає TypeError уже
  // поза розбором. Падіння хука — теж «перевірки не було», і мовчазним воно
  // бути не має: інакше єдиним слідом лишився б stderr, якого ніхто не читає.
  const nullish = runHook('null');
  expect(nullish.status).toBe(0);
  expect(additionalContext(nullish.stdout)).toContain(NOT_RUN_PREFIX);
});

test('файл коду під ЧУЖИМ коренем — гучно, а не мовчки', () => {
  // Виміряно ревю: `cwd` є, але вказує не туди — і хук мовчав, EXIT=0, нуль
  // байтів. Це плутає «не код» із «код, але не під тим коренем», а друге і є
  // рівно та небезпека, заради якої R-20 обрав cwd замість $CLAUDE_PROJECT_DIR.
  const root = makeProbeRepo();
  const wrongTree = mkdtempSync(path.join(tmpdir(), 'sea-radar-editcheck-wrong-'));
  try {
    const run = runHook(payload({
      cwd: wrongTree,
      tool_input: { file_path: path.join(root, 'src/shared/config/map.ts') },
    }));
    expect(run.status).toBe(0);
    const context = additionalContext(run.stdout);
    expect(context).toContain(NOT_RUN_PREFIX);
    expect(context).toContain('ПОЗА деревом');
    // Назване обидва: і дерево події, і файл — інакше причину довелося б угадувати.
    expect(context).toContain(wrongTree);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(wrongTree, { recursive: true, force: true });
  }
});

test('не-код під чужим коренем лишається мовчазним', () => {
  // Межа попереднього тесту: про не-код хук не робить жодного твердження,
  // тож і кричати нема про що. Без цієї межі кожна правка файлу поза деревом
  // (цілком законна) сипала б у контекст шум.
  const wrongTree = mkdtempSync(path.join(tmpdir(), 'sea-radar-editcheck-wrong2-'));
  try {
    const run = runHook(payload({
      cwd: wrongTree,
      tool_input: { file_path: '/tmp/деінде/нотатки.md' },
    }));
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
  } finally {
    rmSync(wrongTree, { recursive: true, force: true });
  }
});

test('корінь береться з поля cwd, а не з $CLAUDE_PROJECT_DIR', () => {
  const root = makeProbeRepo();
  const other = mkdtempSync(path.join(tmpdir(), 'sea-radar-editcheck-other-'));
  try {
    const run = runHook(
      payload({ cwd: root, tool_input: { file_path: path.join(root, 'src/shared/config/map.ts') } }),
      { env: { CLAUDE_PROJECT_DIR: other } },
    );
    // Якби корінь брався зі змінної, шлях файлу відносно неї почався б із '../',
    // isCheckablePath відкинув би його — і вивід був би порожній. Тобто зелене
    // з чужого дерева.
    expect(additionalContext(run.stdout)).toContain(NOT_RUN_PREFIX);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('без поля cwd запасне дерево називається вголос', () => {
  const root = makeProbeRepo();
  try {
    const run = runHook(
      payload({ tool_input: { file_path: path.join(root, 'src/shared/config/map.ts') } }),
      { env: { CLAUDE_PROJECT_DIR: root } },
    );
    const context = additionalContext(run.stdout);
    expect(context).toContain('CLAUDE_PROJECT_DIR');
    expect(context).toContain('cwd');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
