// Подання і збереження. Жодного рішення про статус: усе, що тут відбувається з
// r.status, — це друк і серіалізація. Якщо тут з'явиться if про exitCode — межу зламано.
//
// Імпорт іде в один бік: run.mjs → report.mjs, ніколи навпаки. Саме тому `isBlocking`
// лишається в run.mjs, а `blocking` приходить сюди готовим полем: імпорт `isBlocking`
// замкнув би цикл модулів між двома файлами, які задача 10 вантажить обидва.
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

/**
 * Конверт для stdout — рівно шість ключів R-16 + R-73 і рівно в тому порядку.
 * Окрема експортована функція, а не літерал усередині main(): CLI не запускає
 * жоден тест набору, тож зібраний у main() конверт міг би втратити поле, лишивши
 * всі тести зеленими, а колонку в таблиці — порожньою.
 * Звіт усередині багатший (`schema`, `key`, `blocking`, обрізані потоки) — це
 * не змінює форми stdout: багатший об'єкт іде у .verify/last-run.json.
 *
 * Шостий ключ `reused` (R-73) — тому, що Stop-гейт задачі 10 читає саме цей
 * stdout, а не файл (спека §6.3 крок 3). «Зелено, бо відтворено з кешу» — інше
 * твердження, ніж «зелено», так само як «зелено, але X пропущено» (крок 5).
 * Людина бачить різницю в таблиці; машина без цього ключа — ні.
 */
export function toStdoutJson(report) {
  return {
    tier: report.tier,
    root: report.root,
    noSkip: report.noSkip,
    sourceHash: report.hash,       // поле `hash` звіту під іменем із R-16
    results: report.results.map((r) => ({
      id: r.id, status: r.status, reason: r.reason, durationMs: r.durationMs,
    })),
    // `=== true`, а не `report.reused`: JSON.stringify МОВЧКИ викидає ключ зі
    // значенням undefined, тож звіт, зібраний не через toReport, втратив би поле
    // цілком — і споживач прочитав би відсутність як «свіжий».
    reused: report.reused === true,
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
