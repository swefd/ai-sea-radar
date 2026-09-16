// Раннер — оркестрація. Він не знає ЖОДНОЇ конкретної перевірки: усе, що він уміє,
// описано полями рядка реєстру. Нова перевірка — новий рядок, цей файл не змінюється.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

import { isEntryPoint } from './entry-point.mjs';
import { sourceHash } from './hash.mjs';
import { CHECKS, DEFAULT_TIMEOUT_MS, PRECONDITIONS } from './registry.mjs';
// Напрямок імпорту односторонній: run.mjs → report.mjs, ніколи навпаки. Тому
// `isBlocking` лишається тут, а в звіт іде готове поле `blocking`: імпорт
// `isBlocking` у report.mjs замкнув би цикл між двома файлами, які задача 10
// вантажить обидва.
import { cacheKey, formatTable, readFreshPass, toReport, toStdoutJson, wantsColor, writeReport } from './report.mjs';

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
    const next = argv[i + 1];
    if (next === undefined) throw new Error(`прапорець ${name} без значення`);
    // Наступний прапорець — не значення. `--root --json` мовчки давав root='--json'
    // і лишав json вимкненим: неправильний корінь плюс загублений режим, обидва тихо.
    if (next.startsWith('--')) throw new Error(`прапорець ${name} без значення (далі йде ${next})`);
    return [next, i + 1];
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
  // Порожня вибірка — не «усе пройшло». Нуль рядків дає нуль блокувань і EXIT=0:
  // зелений прогін, який не перевірив НІЧОГО. Це найгірший з можливих результатів
  // шару, тож помилкою має бути КОЖЕН шлях до нього, а не лише шлях через --only.
  // Рівень порожніє не від прапорця, а від правки registry.mjs: реєстр — дані,
  // його редагують не дивлячись у run.mjs, і саме там ця діра відкривається.
  if (byTier.length === 0) throw new Error(`рівень ${tier} не містить жодного рядка`);
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
  if (exitCode == null) {
    // `== null` навмисно: і null (обірвано сигналом), і undefined (виклик із
    // чужого модуля — усі поля в run.d.mts необовʼязкові). Процес, що не дав коду
    // виходу, нічого не довів; FAILED тут стверджував би, що перевірка бігла.
    return { status: 'UNRUNNABLE', reason: signal ? `обірвано сигналом ${signal}` : 'процес не дав коду виходу' };
  }
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
    // stdio задано явно з тієї самої причини, що й у hash.mjs: інакше
    // execFileSync віддає stderr дитини в батьківський процес, і поза
    // git-репозиторієм «fatal: not a git repository» опинявся б посеред
    // виводу самого шару — там, де на нього ніхто не чекає.
    return execFileSync(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
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
    // Декодуємо потік, а не кожен шматок: багатобайтовий символ, що розпався на
    // межі буфера, при `stdout += buffer` став би U+FFFD. Вивід тут українською,
    // задача 4 кладе ці рядки у файл, а U+FFFD цей шар читає як підпис псування.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* група вже мертва */ }
      // Другий таймер тримають за руку. Без clearTimeout раннер жив би зайві 2 с
      // після кожного таймауту; гірше — якби група померла від SIGTERM і ОС встигла
      // перевикористати pid, SIGKILL пішов би чужій групі, а catch це сховав би.
      killTimer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* так само */ }
      }, 2_000);
      killTimer.unref();
    }, timeoutMs);

    const settle = (outcome) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(outcome);
    };
    child.on('error', (spawnError) => settle({ spawnError, exitCode: null, signal: null, timedOut, stdout, stderr }));
    child.on('close', (exitCode, signal) => settle({ spawnError: null, exitCode, signal, timedOut, stdout, stderr }));
  });
}

// Придатна передумова — та, якою можна скористатися ПОВНІСТЮ: і спитати
// (`probe`), і пояснити відповідь (`describe`). Половина запису з двох полів —
// помилка даних незалежно від того, яка саме половина написана. Без `probe`
// нема кого питати; без придатного `describe` рядок стає SKIPPED без причини,
// а це рівно та форма провалу, від якої побудовано цей шар: зелений вихід і
// жодного слова про те, що нічого не бігло. Порожній рядок мовчить так само,
// як відсутній, тому не годиться й він.
function isUsablePrecondition(precondition) {
  return typeof precondition?.probe === 'function'
    && typeof precondition.describe === 'string'
    && precondition.describe.trim() !== '';
}

export async function runAll({ checks = CHECKS, preconditions = PRECONDITIONS, root, tier, noSkip, only, timeoutMs }) {
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
    // Помилка в даних одного рядка — не аварія прогону: вона робить UNRUNNABLE
    // цей рядок і не чіпає решти, інакше друкарська помилка в реєстрі стирала б
    // результати всіх, хто вже відбігав. Питання саме «чи можна цим
    // скористатися», і воно про ВЕСЬ запис: відсутній ключ, `undefined`, `null`,
    // будь-яка половина запису з двох полів. Вартовий не вимагає власного ключа —
    // придатний запис із прототипу теж придатний; `constructor` ловиться не тим,
    // що він успадкований, а тим, що в нього нема `probe`.
    // findIndex, а не find: find повернув би сам id, і `needs: ['']` пройшов би
    // повз вартового хибним значенням.
    // `?? []`: рядок без поля `needs` — теж помилка даних, і вона не має роняти
    // прогін. TypeScript поле вимагає, правка руками в `registry.mjs` його
    // забуває; без цього `findIndex` кидає TypeError із самого раннера.
    const unusableIdx = (check.needs ?? []).findIndex((n) => !isUsablePrecondition(preconditions[n]));
    if (unusableIdx !== -1) {
      finish('UNRUNNABLE', `непридатна передумова в реєстрі: ${JSON.stringify(check.needs[unusableIdx])}`);
      continue;
    }

    // Проба — чужий код, і вона ходить у файлову систему. Питати «чи це функція»
    // й одразу кликати без сітки — лишити аварію всього прогону на крок глибше.
    // Обгортки в самому реєстрі не стають зайвими: власний catch проби дає
    // `false`, тобто SKIPPED з поясненням — кращу відповідь, ніж UNRUNNABLE.
    // Ця сітка — запобіжник для проб, які свого catch не мають.
    let failed = null;
    let missing = null;
    for (const need of check.needs ?? []) {
      let met;
      try {
        met = preconditions[need].probe(root);
      } catch (probeError) {
        // `||`, не `??`: `new Error('')` має message, і він порожній. `??`
        // віддав би порожню причину, а цикл непорожності її пропустив би —
        // префікс же непорожній. Рядок, який каже «не зміг» і не каже чому,
        // нічим не кращий за мовчання.
        failed = { need, reason: `проба впала: ${probeError?.message || String(probeError)}` };
        break;
      }
      // Відповідь буває непридатною так само, як запис. `async probe` віддає
      // обіцянку, а вона істинна ЗАВЖДИ: проба, що вирішилася в `false`, дала б
      // PASSED там, де належав SKIPPED, — зелене, якого ніхто не заслужив.
      // Відхилення ж не є синхронним киданням, тож catch вище його не бачить
      // і прогін гине цілком. Тому питаємо булеве, а не істинне.
      if (typeof met !== 'boolean') {
        const shape = met && typeof met.then === 'function' ? 'обіцянка' : typeof met;
        // Хвіст обіцянки гасимо: відхилення без обробника вбиває процес Node
        // пізніше й поза цим рядком — тобто знову коштувало б усього прогону.
        if (shape === 'обіцянка') met.then(() => {}, () => {});
        failed = { need, reason: `проба відповіла не булевим значенням (${shape})` };
        break;
      }
      if (!met) { missing = need; break; }
    }
    if (failed) { finish('UNRUNNABLE', `передумова ${JSON.stringify(failed.need)} — ${failed.reason}`); continue; }
    if (missing) { finish('SKIPPED', preconditions[missing].describe); continue; }

    const limit = timeoutMs ?? check.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // 3. Проба порожнечі. Нуль знайдених тестів — SKIPPED, ніколи PASSED.
    // Поле зветься загально, розбір — ні: `parsePlaywrightTotal` розуміє лише
    // вивід Playwright. Рядок із чужим перелічувачем стане UNRUNNABLE, а не
    // зеленим — напрямок безпечний, але це межа реєстру-як-даних, не примха.
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

// Названі межі свіжості (R-49, R-57). Друкуються саме там, де зелене
// ВІДТВОРЮЄТЬСЯ, а не обчислюється: мовчазний кеш — це PASSED про дерево,
// якого щойно ніхто не перевіряв, і його межі мусять стояти поруч із ним.
const FRESHNESS_LIMITS = 'межі свіжості: .claude/settings.local.json поза git, тож локальне ввімкнення чи вимкнення хука кеш не скидає (R-49); назва файлу з U+FFFD зупиняє хешування цілком — гучно й зі шляхом (R-57)';

// CLI
//
// Тіло — у звичайній async-функції, а не в top-level await, і це не стиль.
// Тест `.ts` доходить до цього модуля через require(): Playwright транспілює
// спеку в CJS, а самі `.mjs` виключено з трансформації (R-44), тож їх вантажить
// Node. А require() відмовляється брати ESM-граф із top-level await
// («cannot be used on an ESM graph with top-level await»). TLA тут коштував би
// рівно того рантайм-імпорту, яким єдиним перевіряються декларації (R-48).
async function main() {
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
    // Форма stdout — контракт R-16, і збирає її експортована toStdoutJson,
    // а не літерал тут: CLI не запускає жоден тест набору, тож зібраний тут
    // конверт міг би втратити поле, лишивши весь набір зеленим (R-64).
    process.stdout.write(`${JSON.stringify(toStdoutJson(report), null, 2)}\n`);
  } else {
    process.stdout.write(formatTable(report.results, { color: wantsColor(process.stdout) }));
    // Відтворений прогін КАЖЕ, що він відтворений, і називає хеш. Межі свіжості
    // йдуть перед цим рядком, щоб останнім лишалося головне — чи бігло щось узагалі.
    if (report.reused) process.stdout.write(`${FRESHNESS_LIMITS}\n`);
    const source = report.reused ? `відтворено з .verify/last-run.json (hash ${hash.slice(0, 12)}, ${fileCount} файлів)` : `hash ${hash.slice(0, 12)}, ${fileCount} файлів`;
    process.stdout.write(`${source}\n`);
  }
  // exitCode, а не process.exit(): інакше крок 12 (`npm run verify | cat -v`)
  // може загубити хвіст таблиці — запис у трубу асинхронний.
  process.exitCode = report.blocking ? 1 : 0;
}

// R-22. Варта обов'язкова, а не косметична: `tests/unit/run.spec.ts` імпортує звідси
// дев'ять імен (R-48), і без неї імпорт запускав би цілий прогін посеред тестового
// процесу. Форма — у `entry-point.mjs`: пряме порівняння з `process.argv[1]` стояло
// тут і під симлінком не кликало `main()` взагалі (виміряно).
if (isEntryPoint(import.meta.filename)) {
  main().catch((error) => {
    // Зрив самого раннера — невідомий прапорець, цикл у реєстрі, зламаний
    // sourceHash. Стек іде в stderr, а код виходу — блокувальний: тихий нуль
    // тут означав би «усе гаразд», тобто найдорожчу з можливих брехень шару.
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
