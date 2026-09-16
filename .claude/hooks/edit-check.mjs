// PostToolUse, матчер Edit|Write. Дає LEAD, не статус.
//
// Не блокує — це ВИБІР, а не обмеження документації: канал decision:"block"
// у PostToolUse існує. Причина вибору змістовна: посеред рефакторингу код
// законно зламаний, і змушувати «чинити» файл 1 із 3 було б шкідливо.
// Статус дає лише Stop-гейт.
//
// Корінь дерева — з поля cwd вхідного JSON, НЕ з $CLAUDE_PROJECT_DIR:
// у worktree змінна лишається на головному checkout.
//
// МОВЧИТЬ ЦЕЙ ХУК РІВНО У ДВОХ ВИПАДКАХ: подія не про код (тоді про код і не
// сказано нічого) або перевірки відпрацювали й нічого не знайшли. Кожен шлях,
// на якому інструмент не дав вердикту — відсутній tsc, фатальна помилка
// конфігу ESLint, нерозбірний вхід, файл поза деревом події, — друкує про це
// вголос. Порожній вивід «бо перевірка не запустилась» невідрізненний від
// чистого дерева, а це рівно той клас брехні, проти якого написано весь шар.
// Блокувати ми не можемо (і не хочемо), тож єдиний доступний інструмент —
// сказати голосно в additionalContext.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from '../../scripts/verify/entry-point.mjs';
import { sourceHash } from '../../scripts/verify/hash.mjs';
import { truncateBytes } from '../../scripts/verify/report.mjs';
import { writeAllSync } from '../../scripts/verify/stdout.mjs';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

/**
 * Те, чого ESLint не лінтить. Це НЕ економія роботи — це чесність вердикту:
 * виміряно, що `eslint out/probe9.ts` виходить із кодом **0** і рядком
 * «File ignored because of a matching ignore pattern», а нуль — це «чисто».
 * Тобто для файлу зі справжньою TS2322 хук друкував 0 байтів: хибне чисте, а
 * не марна робота.
 *
 * Перелік дзеркалить `globalIgnores` у `eslint.config.mjs` і тримається
 * синхронно ВРУЧНУ — саме ця ручна синхронність один раз і відстала, тож її
 * стереже тест, який читає `eslint.config.mjs` і звіряє кожен запис поіменно.
 * `node_modules/` до `globalIgnores` не входить: його ESLint ігнорує сам.
 */
export const IGNORED_PREFIXES = [
  'reference/', '.next/', 'out/', 'build/', 'node_modules/',
  '.verify/', '.superpowers/', '.claude/worktrees/',
];

/** Те саме, але записи `globalIgnores`, які є іменами файлів, а не теками. */
export const IGNORED_FILES = ['next-env.d.ts'];
export const TYPECHECK_CACHE_DIR = '.verify/typecheck';

// Рядок, за яким гучне «не виконалось» упізнається і оком, і тестом. Він же
// перше, що читач бачить у lead: висновок «чисто» під ним був би хибним.
export const NOT_RUN_PREFIX = 'ПЕРЕВІРКА НЕ ВИКОНАЛАСЬ';

// Бюджети — за БАЙТАМИ, бо весь текст тут українською (два байти на символ), і
// тому, що обрив труби теж байтовий. Виміряно: запис у трубу з негайним
// process.exit(0) доставляє щонайбільше 65536 байтів. Бюджет lead лишає запас
// навіть після екранування JSON, а writeAllSync прибирає саму стелю; обидва
// потрібні, бо вони про різне — скільки тексту доречно й скільки його дійде.
export const MAX_LEAD_BYTES = 16 * 1024;
// Секція ESLint обмежена ОКРЕМО, і це несуче: у форматі stylish вона росте по
// рядку на зауваження й без власного ліміту з'їла б увесь бюджет, лишивши
// помилки типів — дорожчі — за межею.
const MAX_ESLINT_BYTES = 4 * 1024;
const MAX_DETAIL_BYTES = 2 * 1024;

// Інструменти запускаються НЕ через `npx` і не за іменем із PATH: `npx tsc` працює
// тільки тому, що node.sh дописав PATH, і мовчки деградував би, якби хук колись
// покликали напряму. process.execPath — це той самий Node, що виконує цей файл,
// тобто рівно мажор із .nvmrc; шлях до пакета — локальний і однозначний.
const TSC_ENTRY = 'node_modules/typescript/bin/tsc';
const ESLINT_ENTRY = 'node_modules/eslint/bin/eslint.js';

/** Чи схоже це взагалі на код — питання про ім'я, не про розташування. */
function hasCodeExtension(somePath) {
  return CODE_EXTENSIONS.includes(path.extname(somePath));
}

/** Чи вийшов шлях за межі дерева, яке назвала подія. */
export function isOutsideRoot(relPath) {
  return relPath === '..' || relPath.startsWith('../') || path.isAbsolute(relPath);
}

export function isCheckablePath(relPath) {
  if (isOutsideRoot(relPath)) return false;
  if (IGNORED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
  if (IGNORED_FILES.includes(relPath)) return false;
  return hasCodeExtension(relPath);
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

/** Текст «не виконалось» із причиною та подробицею. */
function notRunNotice(tool, reason, detail = '') {
  const said = truncateBytes(detail.trim(), MAX_DETAIL_BYTES);
  return `${NOT_RUN_PREFIX} — ${tool}: ${reason}.\n`
    + `Це НЕ означає, що код чистий: вердикту від ${tool} немає, і цю частину `
    + 'перевірки ніхто не зробив.\n'
    + (said === '' ? '(подробиць немає)' : said);
}

/** Подробиця запуску інструмента: обидва потоки разом, у порядку читання. */
const toolSaid = (run) => `${run.stdout}\n${run.stderr}`;

/** Код виходу в тексті причини — або чесне «його немає». */
const exitLabel = (status) => (
  typeof status === 'number' ? `вихід ${status}` : 'процес не дав коду виходу'
);

/**
 * Чи дав tsc вердикт? Не за кодом виходу: виміряно на цьому дереві, що помилка
 * типу дає вихід 2, а неіснуючий tsconfig — вихід 1. Тобто код виходу тут не
 * розрізняє «знайшов помилки» і «не зміг подивитись». Розрізняє наявність
 * розібраних діагностик: жодної при ненульовому виході — значить, вердикту не
 * було (MODULE_NOT_FOUND, TS5058, вбитий процес).
 */
export function tscNotRun(run, errorCount) {
  if (run.status === 0) return '';
  // Немає коду виходу — немає вердикту, скільки б рядків не встигло
  // надрукуватись. Так виглядає переповнення maxBuffer: процес обривають,
  // частковий stdout може містити десяток розібраних діагностик, і без цього
  // рядка обрізаний результат осів би в кеші ЯК ВЕРДИКТ — на добу вперед.
  // Так само виглядає процес, убитий сигналом.
  if (run.status === null) {
    return notRunNotice('tsc', 'процес обірвано без коду виходу', toolSaid(run));
  }
  if (errorCount > 0) return '';
  return notRunNotice(
    'tsc',
    `${exitLabel(run.status)}, жодного рядка діагностики не розібрано`,
    toolSaid(run),
  );
}

/**
 * Чи дав вердикт ESLint? Виміряно: вихід 1 — знайдено проблеми (формат stylish
 * друкує їх у stdout завжди), вихід 2 — фатальна помилка конфігу, і весь текст
 * при цьому лежить у stderr, тобто поза полем зору того, хто читає лише stdout.
 *
 * Порожній stdout при виході 1 — теж не вердикт: так виходить Node, коли не
 * знайшов самого eslint. Правило «1 — це завжди вердикт» на цьому мовчало б.
 */
export function eslintNotRun(run) {
  if (run.status === 0) return '';
  if (run.status === 1 && run.stdout.trim() !== '') return '';
  return notRunNotice('ESLint', exitLabel(run.status), toolSaid(run));
}

const MAX_LISTED = 10;

export function formatLead(relPath, eslintText, errors, notices = []) {
  const parts = [];

  // Гучне «не виконалось» — ПЕРШИМ. Під списком помилок його прочитали б після
  // висновку, а він цей висновок скасовує.
  for (const notice of notices) {
    if (typeof notice === 'string' && notice.trim() !== '') parts.push(notice.trim());
  }

  const lint = truncateBytes(eslintText.trim(), MAX_ESLINT_BYTES);
  if (lint !== '') parts.push(`ESLint — ${relPath}:\n${lint}`);

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

  return truncateBytes(parts.join('\n\n'), MAX_LEAD_BYTES);
}

/**
 * Запуск інструмента тим самим Node, що виконує хук. Ненульовий вихід — це не
 * виняток, а відповідь, тож вона повертається тим самим полем, що й успіх:
 * різницю між вердиктом і незапуском ухвалюють tscNotRun/eslintNotRun, і ніде
 * більше.
 *
 * stdio задано явно: без нього stderr дитини протікає в батьківський процес, а
 * саме в stderr обидва інструменти кладуть текст своїх фатальних помилок — той,
 * який хук зобов'язаний показати, а не загубити.
 */
function runTool(root, args, maxBuffer) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : null,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message ?? ''),
    };
  }
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
function typecheck(root) {
  let hash;
  try {
    ({ hash } = sourceHash(root));
  } catch (error) {
    // Без хеша немає ані кешу, ані впевненості, що дерево те саме. Мовчазний
    // прогін «якось» був би відповіддю про невідомо що.
    return {
      errors: [],
      notice: notRunNotice(
        'tsc', 'не вдалося порахувати хеш дерева', String(error?.message ?? error),
      ),
    };
  }

  const cacheDir = path.join(root, TYPECHECK_CACHE_DIR);
  const cacheFile = path.join(cacheDir, `${hash}.json`);

  try {
    return { errors: JSON.parse(readFileSync(cacheFile, 'utf8')), notice: '' };
  } catch {
    /* кешу немає або він пошкоджений — рахуємо заново */
  }

  // --pretty false: ANSI-барви зробили б вивід нерозбірним для parseTscErrors.
  // Саме тому тут не npm run check-types (він з --pretty) — розбіжність свідома.
  const run = runTool(
    root,
    [path.join(root, TSC_ENTRY), '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
    32 * 1024 * 1024,
  );
  // Обидва потоки: діагностики tsc кладе в stdout, але текст поломки — у stderr,
  // і розбирати варто те й те.
  const errors = parseTscErrors(`${run.stdout}\n${run.stderr}`);
  const notice = tscNotRun(run, errors.length);

  // Кешується ЛИШЕ справжній вердикт. Записати «нуль помилок», що насправді
  // означає «не бігло», — це законсервувати брехню на добу вперед.
  if (notice === '') {
    try {
      mkdirSync(cacheDir, { recursive: true });
      const temp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(errors));
      renameSync(temp, cacheFile); // атомарно: паралельні хуки не побачать напівзапису
      pruneCache(cacheDir);
    } catch {
      /* кеш — оптимізація, а не умова коректності */
    }
  }
  return { errors, notice };
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

function lint(root, relPath) {
  const run = runTool(
    root,
    [path.join(root, ESLINT_ENTRY), '--format', 'stylish', relPath],
    8 * 1024 * 1024,
  );
  const notice = eslintNotRun(run);
  // Вихід 0 — чисто (зауваження без помилок сюди свідомо не йдуть: lead про
  // ризик, а не про стиль). Текст береться лише тоді, коли вердикт справжній.
  return { text: notice === '' && run.status !== 0 ? run.stdout : '', notice };
}

/** Конверт PostToolUse. Пишеться в сирий fd 1: див. writeAllSync. */
function emit(lead) {
  const envelope = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lead },
  });
  writeAllSync(1, `${envelope}\n`);
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    // Тихий вихід тут був би тим самим мовчазним зеленим: подію отримано,
    // перевірку не зроблено, і ніхто про це не дізнався.
    emit(notRunNotice(
      'edit-check', 'вхідний JSON події не розібрано', String(error?.message ?? error),
    ));
    process.exit(0);
  }

  // R-20. Дерево вибирає поле `cwd` вхідного JSON — і тільки воно. $CLAUDE_PROJECT_DIR
  // лишається на головному checkout, коли сесія йде у worktree. Запасний шлях існує,
  // але він НЕ мовчазний: підміна дерева, про яку не сказали, — це звіт про чуже дерево.
  let root = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '';
  let rootFallbackNote = '';
  // Звідки взято дерево — частина діагностики, а не дрібниця: рання відмова нижче
  // друкувала «дерево (cwd)» і тоді, коли `cwd` подія НЕ несла, тобто називала
  // невинне джерело. Відмова лишалася гучною, брехала лише підказка — а читають
  // саме її.
  let rootSource = 'cwd';
  if (root === '') {
    const fromEnv = process.env.CLAUDE_PROJECT_DIR;
    root = fromEnv ?? process.cwd();
    rootSource = fromEnv ? '$CLAUDE_PROJECT_DIR' : 'process.cwd()';
    rootFallbackNote = 'У вхідному JSON немає поля cwd. Дерево взяте з '
      + `${fromEnv ? '$CLAUDE_PROJECT_DIR' : 'process.cwd()'}: ${root}. `
      + 'У worktree це може бути НЕ те дерево, яке ви редагуєте.';
  }

  const filePath = input?.tool_input?.file_path;
  // Подія без шляху — не про файл (інший інструмент під тим самим матчером).
  // Нічого не перевірено й нічого не стверджується: тут мовчання чесне.
  if (typeof filePath !== 'string' || filePath === '') process.exit(0);

  const relPath = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');

  // Файл КОДУ поза деревом, яке назвала подія. Виміряно, що мовчання тут
  // плутає дві різні речі: «це не код» і «це код, але не під тим коренем» —
  // а друге і є та небезпека, заради якої R-20 обрав `cwd` замість
  // $CLAUDE_PROJECT_DIR. Порожній вивід читався б як «перевірено й чисто».
  // Не-код відсіюється раніше за цю перевірку: про нього не сказано нічого,
  // тож і казати нема про що.
  if (isOutsideRoot(relPath)) {
    if (hasCodeExtension(filePath)) {
      emit(notRunNotice(
        'edit-check',
        'файл коду лежить ПОЗА деревом, яке назвала подія',
        `дерево (${rootSource}): ${root}\nфайл: ${filePath}`,
      ));
    }
    process.exit(0);
  }

  if (!isCheckablePath(relPath)) process.exit(0); // крок 1 спеки: тихий вихід 0

  const eslint = lint(root, relPath);
  const types = typecheck(root);
  // Примітка про запасне дерево йде в тому самому переліку, що й «не виконалось»,
  // і так само друкується на порожньому lead: «нічого не знайшов» із чужого
  // дерева не варте нічого.
  const lead = formatLead(relPath, eslint.text, types.errors, [
    rootFallbackNote, eslint.notice, types.notice,
  ]);
  if (lead !== '') emit(lead);
  process.exit(0);
}

// Варта вхідної точки — спільна (`isEntryPoint`), а не наївне порівняння з
// process.argv[1]: під симлінком (на macOS /tmp — симлінк на /private/tmp) те
// порівняння не кликало б main() зовсім, тобто дало б вихід 0 і порожній
// stdout — знову невідрізненно від чистого дерева.
//
// `main().catch(...)`, а не `await main()`: top-level await робить модуль
// графом TLA, а такий граф не вантажиться через require(ESM) — саме ним
// Playwright тягне зовнішні .mjs. Виміряно: з `await` тест не міг імпортувати
// хук ЗОВСІМ («require() cannot be used on an ESM graph with top-level await»),
// тобто ціна одного зайвого `await` — уся варта цього файлу.
if (isEntryPoint(import.meta.filename)) {
  main().catch((error) => {
    // Падіння хука — теж «перевірки не було». Стек іде в stderr для людини,
    // коротка причина — в lead для моделі, яка інакше прочитала б тишу як «чисто».
    process.stderr.write(`edit-check: ${String(error?.stack ?? error)}\n`);
    emit(notRunNotice('edit-check', 'хук упав', String(error?.message ?? error)));
    process.exit(0);
  });
}
