// Stop-гейт. Єдине місце шару, де народжується СТАТУС, а не lead: edit-check
// радить, а блокує тільки цей файл. Вісім кроків нижче пронумеровані за §6.3
// спеки й ідуть у тому ж порядку.
//
// Корінь дерева — з поля cwd вхідного JSON, НЕ з $CLAUDE_PROJECT_DIR (R-20): у
// worktree змінна лишається на головному checkout, і гейт видав би зелене з
// іншого дерева, ніж те, де є зміна. Це гірше за відсутність гейту, бо виглядає
// як факт.
//
// ТРИ РІЗНІ ТВЕРДЖЕННЯ, які цей файл не має права злити в одне «зелено»:
//   1. «щойно перевірено» — прогін відбувся і нічого не знайшов;
//   2. «зелено, але X пропущено» — щось не перевірялось (крок 5 спеки);
//   3. «зелено, бо відтворено з кешу» — не бігло НІЧОГО (ключ `reused`, R-73).
// Людина бачить (2) і (3) у таблиці раннера; машина — лише через конверт --json,
// а вирішує тут машина. Тому кожне з трьох має власний текст, і жодне не мовчить.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from '../../scripts/verify/entry-point.mjs';
import { truncateBytes } from '../../scripts/verify/report.mjs';
import { writeAllSync } from '../../scripts/verify/stdout.mjs';

// Обрізання причини — ПОЗИКА, а не власна копія. Реалізація в `report.mjs` уже
// вміє те, на чому ламається наївна: коли ліміт менший за сам маркер, вона ріже
// без маркера, а не повертає рядок, довший за ліміт. Друга байтова різалка в
// дереві розійшлася б із першою мовчки — рівно так, як розійшлися чотири копії
// варти вхідної точки до `isEntryPoint`.
export { truncateBytes as truncateUtf8 };

export const REASON_MAX_BYTES = 4096;
export const MAX_CONSECUTIVE_BLOCKS = 2;
export const COUNTER_DIR = '.verify/gate-counter';

/** Рядок, за яким «гейт не відпрацював» упізнається і оком, і тестом. */
export const GATE_NOT_RUN = 'ГЕЙТ НЕ ВІДПРАЦЮВАВ — не заявляй успіх';

const STDIN_TIMEOUT_MS = 5_000;
// Менше за `timeout: 300`, який задача 11 ставить рядку Stop у settings.json:
// гейт мусить упасти в межі СВОГО таймауту й сказати про це, бо вбитий ззовні
// хук не друкує нічого — а тиша тут читається як дозвіл зупинитися.
const RUNNER_TIMEOUT_MS = 240_000;
const COUNTER_TTL_MS = 24 * 60 * 60 * 1000;
const STATUS_WIDTH = 'UNRUNNABLE'.length;

/**
 * Дзеркало `isBlocking` із `run.mjs` (спека §5) — ЗАПЕРЕЧНИЙ перелік, а не
 * дозвільний: блокує все, що не `PASSED` і не `SKIPPED`.
 *
 * Полярність тут несуча. Дозвільний перелік (`new Set(['FAILED', 'NOT_RUN',
 * 'UNRUNNABLE'])`) робив гейт СТРОГО ПОБЛАЖЛИВІШИМ за раннер, про який він
 * звітує: рядок без ключа `status`, зі `status: null` чи з невпізнаним словом не
 * був ні провалом, ні пропуском і падав у гілку тихого зеленого — виміряно
 * наскрізно, вихід 0 і порожній stdout на чотирьох різних формах. Це той самий
 * механізм, проти якого загартовано `readReused`: `toStdoutJson` копіює
 * `r.status` дослівно, а `JSON.stringify` викидає `undefined` мовчки.
 *
 * `SKIPPED` не блокує тут із тієї самої причини, що й у раннері без `--no-skip`
 * (гейт його не просить), і має власні, суворіші гілки в `decide`.
 */
function isBlockingStatus(status) {
  if (status === 'PASSED') return false;
  if (status === 'SKIPPED') return false;
  return true;                 // FAILED, NOT_RUN, UNRUNNABLE — і все невпізнане
}

// Рядок таблиці мусить пережити те, що в нього блокувальним статусом потрапляє
// і не-рядок, і не-об'єкт: інакше варта полярності вище мінялася б на падіння.
const cell = (value, fallback) => (
  typeof value === 'string' && value !== '' ? value : fallback
);

export function formatFailureTable(results) {
  return results
    .filter((result) => isBlockingStatus(result?.status))
    .map((result) => `${cell(result?.status, 'БЕЗ СТАТУСУ').padEnd(STATUS_WIDTH)} `
      + `${cell(result?.id, '(без id)')} — ${cell(result?.reason, 'без причини')}`)
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
  // Прибирання: лічильники старші за добу вже нічого не стережуть. Поріг той
  // самий, що в `pruneCache` хука edit-check, і причина та сама.
  const cutoff = Date.now() - COUNTER_TTL_MS;
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
 * Лічильник — ЗАПОБІЖНИК від livelock, а не умова коректності, тож його поломка
 * не сміє скасувати блокування, яке гейт уже вирішив зробити. Виміряно на
 * чернетці цього файлу: `.verify` як файл замість теки давав `ENOTDIR` усередині
 * `bumpBlockCount` уже ПІСЛЯ того, як гейт установив червоне, — і хук помирав
 * стектрейсом із виходом 1, порожнім stdout і без `decision: block`. Для події
 * Stop вихід 1 неблокувальний, тобто зупинка проходила: поломка запобіжника
 * скасовувала саме той вердикт, заради якого весь файл існує.
 *
 * Запасне значення для читання — 0, і це навмисно сторона «блокувати»: зайве
 * блокування ловить власна межа Claude Code, а пропущене не ловить ніхто.
 *
 * Поломка потрапляє в `faults`, а не лише в stderr, і це теж вимірювання, а не
 * смак: stderr доходить до моделі ЛИШЕ на виході 2, тож на зеленому шляху
 * (вихід 0) про зламану межу livelock не дізнавався ніхто — ні модель, ні
 * людина. Тепер вона їде тим самим `systemMessage`, що й решта голосних
 * поправок до зеленого.
 */
function guardCounter(faults, action, fallback = undefined) {
  try {
    return action();
  } catch (error) {
    const reason = String(error?.message ?? error);
    faults.push(`УВАГА: лічильник блокувань недоступний (${reason}). `
      + 'Межа livelock цього ходу не працює; вердикт нижче від цього не залежить.');
    writeAllSync(2, `stop-gate: лічильник блокувань недоступний (${reason})\n`);
    return fallback;
  }
}

/**
 * Строге читання шостого ключа конверта (R-73, R-74 I-3). Три значення, бо станів
 * справді три, і два з них не можна злити:
 *   `false`     — прогін відбувся щойно;
 *   `true`      — НЕ БІГЛО НІЧОГО, звіт відтворено з .verify/last-run.json;
 *   будь-що ще  — конвертові вірити не можна, і сказати «свіжо» означало б
 *                 заявити більше, ніж дали дані.
 * `JSON.stringify` мовчки викидає ключ зі значенням `undefined`, тож «ключа
 * немає» — найімовірніша форма поломки, і саме її не можна читати як «свіжо».
 *
 * @param {unknown} report
 * @returns {'fresh' | 'reused' | 'unknown'}
 */
export function readReused(report) {
  if (report?.reused === true) return 'reused';
  if (report?.reused === false) return 'fresh';
  return 'unknown';
}

const refuse = (detail) => ({
  kind: 'REFUSE',
  message: detail === '' ? GATE_NOT_RUN : `${GATE_NOT_RUN} (${detail})`,
});

const listRows = (rows) => rows
  .map((row) => `${row.id} (${row.reason || 'без причини'})`)
  .join(', ');

const reusedNote = (tree) => 'Зелено, але НІЧОГО НЕ БІГЛО: раннер відтворив попередній зелений '
  + `звіт із .verify/last-run.json за незмінним хешем дерева ${tree} — гейт просить `
  + '--reuse-if-fresh. Це інше твердження, ніж «щойно перевірено», і сказати його '
  + 'треба саме так. Справжній прогін — `npm run verify`.';

const skippedNote = (rows) => `Зелено, але ПРОПУЩЕНО, тобто про ці рядки не доведено нічого: ${listRows(rows)}. `
  + 'Скажи це вголос у відповіді — «зелено, але X пропущено» не те саме, що «зелено».';

/**
 * Кроки 4–6 спеки одним рішенням. Чиста функція: усе, що гейт знає про прогін,
 * приходить конвертом, тож вердикт перевіряється без запуску раннера.
 *
 * REFUSE — це fail open, але голосно: гейт нічого не стверджує про код і не
 * блокує (блокувати означало б сказати «червоно» про те, чого ніхто не дивився).
 *
 * @param {unknown} report — розібраний stdout `run.mjs --tier fast --json`.
 * @returns {{ kind: 'REFUSE' | 'PASS' | 'BLOCK', message: string }}
 */
export function decide(report) {
  // Запобіжник форми лишається на місці й після фіксації конверта (R-16): якщо
  // форма колись розійдеться, гейт скаже «не відпрацював», а не «зелено».
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return refuse('');
  if (!Array.isArray(report.results)) return refuse('');

  // Дерево називається з КОНВЕРТА, а не з того, що гейт просив: повідомлення
  // мусить бути однозначним щодо того самого кореня, який справді оглянули.
  const tree = typeof report.root === 'string' && report.root !== '' ? report.root : '(корінь не названо)';

  const reused = readReused(report);
  if (reused === 'unknown') {
    return refuse(`конверт раннера без булевого reused: чи бігло щось узагалі — невідомо; дерево: ${tree}`);
  }

  // Нуль рядків — не «усе пройшло»: раннер відмовляється звітувати про вибірку,
  // якої не робив (R-63), і нуль доказів не є доказом (R-61).
  if (report.results.length === 0) {
    return refuse(`раннер повернув нуль рядків, тобто вибірки не було; дерево: ${tree}`);
  }

  const failures = report.results.filter((result) => isBlockingStatus(result?.status));
  const skipped = report.results.filter((result) => result?.status === 'SKIPPED');

  // R-61 дослівно: гейт не має права прочитати вихід 0 із прогону, у якому не
  // бігло нічого. Усі рядки SKIPPED — це саме він (найчастіше корінь без
  // node_modules), і «зелено, але все пропущено» тут не пом'якшення, а те саме
  // хибне зелене, лише багатослівне.
  if (failures.length === 0 && skipped.length === report.results.length) {
    return refuse(`жоден рядок не дав вердикту про код: усі ${skipped.length} — SKIPPED `
      + `(${listRows(skipped)}); дерево: ${tree}`);
  }

  const notes = [];
  if (reused === 'reused') notes.push(reusedNote(tree));
  if (skipped.length > 0) notes.push(skippedNote(skipped));

  if (failures.length > 0) {
    notes.push(`Перевірка червона — зупинятись зарано (дерево: ${tree}):\n`
      + formatFailureTable(report.results));
    return { kind: 'BLOCK', message: notes.join('\n\n') };
  }
  return { kind: 'PASS', message: notes.join('\n\n') };
}

/** Голосний вихід 0: гейт нічого не стверджує про код, але й не мовчить. */
function loud(message) {
  writeAllSync(1, `${JSON.stringify({ systemMessage: truncateBytes(message, REASON_MAX_BYTES) })}\n`);
  process.exit(0);
}

/**
 * Крок 1: читання stdin із запобіжником. Таймаут НЕ вважається порожнім входом:
 * порожнє читання загубило б prompt_id і тихо вимкнуло межу livelock.
 */
function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    const timer = setTimeout(() => resolve({ ok: false, text: '' }), timeoutMs);
    process.stdin
      .on('data', (chunk) => chunks.push(chunk))
      .on('error', () => { clearTimeout(timer); resolve({ ok: false, text: '' }); })
      .on('end', () => {
        clearTimeout(timer);
        resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
      });
  });
}

/**
 * Крок 3. `process.execPath`, а не 'node': голе ім'я працює лише тому, що node.sh
 * дописав PATH, і мовчки зникло б, якби гейт колись покликали напряму. Це той
 * самий Node, що виконує цей файл, тобто рівно мажор із .nvmrc.
 *
 * `stdio` задано явно: без нього stderr раннера протікає в наш власний stderr —
 * а саме туди гейт кладе причину блокування, яку модель читає за виходу 2.
 *
 * Ненульовий вихід раннера — це ВІДПОВІДЬ, а не поломка: на червоному дереві він
 * виходить 1 і друкує придатний звіт. Розбирати треба той самий stdout.
 */
function runRunner(root) {
  const args = [
    path.join(root, 'scripts/verify/run.mjs'), '--tier', 'fast', '--reuse-if-fresh', '--json',
  ];
  try {
    return parseOrNull(execFileSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: RUNNER_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error) {
    return parseOrNull(String(error?.stdout ?? ''));
  }
}

function parseOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  // 1
  const read = await readStdin(STDIN_TIMEOUT_MS);
  if (!read.ok) {
    return loud(`${GATE_NOT_RUN} (вхід гейта не прочитано за ${STDIN_TIMEOUT_MS} мс)`);
  }

  const input = parseOrNull(read.text);
  // Валідний JSON, який не є об'єктом (`null`, число, рядок, масив), раніше давав
  // неперехоплений TypeError на першому ж зверненні до поля — тобто тихий вихід 1
  // без жодного повідомлення. Запобіжник, що падає, гірший за відсутній, бо
  // створює враження покриття.
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return loud(`${GATE_NOT_RUN} (вхід гейта не є об'єктом)`);
  }

  // 2 — строго «Claude продовжує, бо Stop-хук раніше заблокував зупинку».
  if (input.stop_hook_active === true) process.exit(0);

  // R-20. Дерево вибирає поле `cwd`, і тільки воно. Запасний шлях існує — і він НЕ
  // мовчазний: гейт, що перевірив чуже дерево й промовчав про це, дає фальшиве
  // зелене. Примітка приклеюється до КОЖНОГО вердикту, включно із зеленим.
  let root = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '';
  let rootNote = '';
  if (root === '') {
    const fromEnv = process.env.CLAUDE_PROJECT_DIR;
    root = fromEnv ?? process.cwd();
    rootNote = 'УВАГА: у вхідному JSON немає поля cwd. Дерево взяте з '
      + `${fromEnv ? '$CLAUDE_PROJECT_DIR' : 'process.cwd()'}: ${root}. `
      + 'У worktree це може бути НЕ те дерево, яке ви редагуєте.';
  }

  const key = counterKey(input);

  // 3 + 4 + 5 + 6
  const verdict = decide(runRunner(root));
  // Текст складається ПІСЛЯ роботи з лічильником, а не до неї: інакше поломка
  // запобіжника не встигала б потрапити у вже зібране повідомлення.
  const faults = [];
  const compose = () => [rootNote, ...faults, verdict.message]
    .filter((part) => part !== '').join('\n\n');

  if (verdict.kind === 'REFUSE') return loud(compose());

  if (verdict.kind === 'PASS') {
    guardCounter(faults, () => resetBlockCount(root, key));
    // Зелене мовчить — але тільки коли сказати нічого: пропуск, відтворення з
    // кешу, запасне дерево й зламаний лічильник — кожне робить його іншим
    // твердженням.
    const full = compose();
    if (full !== '') return loud(full);
    process.exit(0);
  }

  // 7 — межа livelock. Межа Claude Code за замовчуванням — 8 блокувань поспіль
  // (змінна CLAUDE_CODE_STOP_HOOK_BLOCK_CAP); наша суворіша за дефолтну.
  if (guardCounter(faults, () => blockCount(root, key), 0) >= MAX_CONSECUTIVE_BLOCKS) {
    guardCounter(faults, () => resetBlockCount(root, key));
    return loud(`Гейт блокував ${MAX_CONSECUTIVE_BLOCKS} рази поспіль і більше не блокує. `
      + `Відкрий відповідь явною заявою «досі червоно, ось що падає»:\n${compose()}`);
  }
  guardCounter(faults, () => bumpBlockCount(root, key), 0);

  // 6 + 8 — decision/reason ВЕРХНЬОГО рівня (для Stop саме так), вихід 2.
  // Запис — через writeAllSync: асинхронний запис у трубу обрізається синхронним
  // process.exit одразу після нього, і причина блокування прийшла б порожньою.
  const reason = truncateBytes(compose(), REASON_MAX_BYTES);
  writeAllSync(1, `${JSON.stringify({ decision: 'block', reason })}\n`);
  // Дубль у stderr: за виходу 2 документація обіцяє показати моделі саме stderr.
  writeAllSync(2, `${reason}\n`);
  process.exit(2);
}

// Варта вхідної точки — спільна (`isEntryPoint`), а не наївне порівняння з
// process.argv[1]: під симлінком (на macOS /tmp — симлінк на /private/tmp) те
// порівняння не кликало б main() зовсім. Виміряно на чернетці цього файлу: усі
// сім сценаріїв, включно з тричі червоним деревом, давали вихід 0 і порожній
// stdout — тобто «зупиняйся, все гаразд» замість блокування.
//
// `main().catch(...)`, а не top-level await: TLA робить модуль графом, який
// require(ESM) не вантажить, а саме ним Playwright тягне зовнішні .mjs (R-60).
if (isEntryPoint(import.meta.filename)) {
  main().catch((error) => {
    // Падіння гейта — теж «перевірки не було». Стек іде в stderr для людини,
    // коротка причина — у systemMessage для моделі, яка інакше прочитала б тишу
    // як дозвіл зупинитися.
    writeAllSync(2, `stop-gate: ${String(error?.stack ?? error)}\n`);
    loud(`${GATE_NOT_RUN} (гейт упав: ${String(error?.message ?? error)})`);
  });
}
