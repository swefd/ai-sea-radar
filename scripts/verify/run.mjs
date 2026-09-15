// Раннер — оркестрація. Він не знає ЖОДНОЇ конкретної перевірки: усе, що він уміє,
// описано полями рядка реєстру. Нова перевірка — новий рядок, цей файл не змінюється.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

import { sourceHash } from './hash.mjs';
import { CHECKS, DEFAULT_TIMEOUT_MS, PRECONDITIONS } from './registry.mjs';

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

export async function runAll({ checks = CHECKS, root, tier, noSkip, only, timeoutMs }) {
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
    // Невідомий id — помилка ДАНИХ одного рядка, не аварія прогону. Вона робить
    // UNRUNNABLE цей рядок і не чіпає решти: інакше друкарська помилка в реєстрі
    // стирала б результати всіх, хто вже відбігав.
    const unknownNeed = check.needs.find((n) => !Object.hasOwn(PRECONDITIONS, n));
    if (unknownNeed) { finish('UNRUNNABLE', `невідома передумова в реєстрі: ${unknownNeed}`); continue; }
    const missing = check.needs.find((n) => !PRECONDITIONS[n].probe(root));
    if (missing) { finish('SKIPPED', PRECONDITIONS[missing].describe); continue; }

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
  // ...opts ПЕРЕД root, не після. У opts є власний root (за замовчуванням null),
  // і зворотний порядок затер би щойно обчислений корінь нулем — probe(null)
  // упав би на path.join(null, 'node_modules').
  const results = await runAll({ ...opts, root });
  const blocking = results.some((r) => isBlocking(r.status, opts.noSkip));
  // Тимчасовий текстовий вивід. Таблиця й кеш свіжості приходять у задачі 4;
  // форма JSON — ні, вона фіксується тут і більше не змінюється.
  if (opts.json) {
    // R-16, дослівно. Рівно ці поля й у цьому порядку; споживачі — звіт задачі 4
    // і Stop-гейт задачі 10 — цитують цю форму у своїх Interfaces. Повні stdout,
    // stderr, exitCode лишаються всередині `results` раннера, але у JSON не
    // потрапляють: гейт читає їх із `.verify/last-run.json` (задача 4).
    const report = {
      tier: opts.tier,
      root,
      noSkip: opts.noSkip,
      sourceHash: sourceHash(root).hash,
      results: results.map((r) => ({
        id: r.id, status: r.status, reason: r.reason, durationMs: r.durationMs,
      })),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else for (const r of results) process.stdout.write(`${r.status.padEnd(11)} ${r.id}${r.reason ? `  — ${r.reason}` : ''}\n`);
  // exitCode, а не process.exit(): запис у трубу асинхронний, і process.exit
  // обрізав би хвіст таблиці рівно тоді, коли вивід кудись перенаправлено
  // (крок 12 задачі 4 саме це й робить).
  process.exitCode = blocking ? 1 : 0;
}

// R-22: `import.meta.filename === process.argv[1]` — не конкатенація `file://…`,
// яка ламається на пробілах і не-ASCII у шляху, а тека worktree — це шлях,
// який обирали не ми.
if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    // Зрив самого раннера — невідомий прапорець, цикл у реєстрі, зламаний
    // sourceHash. Стек іде в stderr, а код виходу — блокувальний: тихий нуль
    // тут означав би «усе гаразд», тобто найдорожчу з можливих брехень шару.
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
