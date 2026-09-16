import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// Типи, а не `as any`: `@typescript-eslint/no-explicit-any` із eslint-config-next
// зробив би `npx eslint .` червоним. Заразом опис форми конфігу — те, що перевіряє
// тест, стає видимим у самому тесті.
interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

interface Settings {
  enabledPlugins?: Record<string, boolean>;
  hooks?: Record<string, HookEntry[] | undefined>;
}

function settings(): Settings {
  return JSON.parse(readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8')) as Settings;
}

/**
 * Розкриття рядка команди тією ж оболонкою, що й у Claude Code: рядок стає
 * ТЕКСТОМ скрипта, тож `"$CLAUDE_PROJECT_DIR"` розкривається саме так, як
 * розкриється в бою. Підстановка через аргумент (`set -- $1`) довела б лише
 * розбиття на слова: значення змінної повторно не розкривається, і літерал
 * `$CLAUDE_PROJECT_DIR`, записаний в одинарних лапках, пройшов би зеленим.
 */
function expandArgv(command: string, projectDir: string): string[] {
  const script = `set -- ${command}\nfor arg in "$@"; do printf '%s\\0' "$arg"; done`;
  const out = execFileSync('sh', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  return out.split('\0').slice(0, -1);
}

function commandOf(event: 'PostToolUse' | 'Stop'): string {
  const entry = settings().hooks?.[event]?.[0];
  expect(entry, `у settings.json немає запису ${event}`).toBeDefined();
  return entry?.hooks[0].command ?? '';
}

/**
 * Плагіни, які лежали у файлі до вмикання хуків. Перелічені поіменно, бо перевірка
 * самого лише ІМЕНІ ключа ловить тільки грубу форму пастки — заміну файлу цілим
 * блоком JSON. Часткова втрата (`enabledPlugins: {}` чи мінус один рядок) проходила
 * б зеленою, а це рівно той різновид «зеленого, що нічого не стереже», проти якого
 * весь цей шар. Перевірка — НАДмножинна: шостий плагін, увімкнений пізніше, не
 * робить тест червоним, зникнення будь-якого з п'яти — робить.
 */
const PLUGINS_BEFORE_WIRING = [
  'context7@claude-plugins-official',
  'skill-creator@claude-plugins-official',
  'superpowers@claude-plugins-official',
  'typescript-lsp@claude-plugins-official',
  'frontend-design@claude-plugins-official',
];

test('вмикання не загубило наявний enabledPlugins', () => {
  expect(settings()).toHaveProperty('enabledPlugins');
  const plugins = settings().enabledPlugins ?? {};
  // Перевіряється ЗНАЧЕННЯ, не наявність ключа: `"…": false` лишає ключ на місці,
  // а плагін вимкненим — втрата рівно того ж ґатунку, що й видалений рядок, і
  // `Object.keys` її не бачить.
  for (const id of PLUGINS_BEFORE_WIRING) expect(plugins[id], id).toBe(true);
});

test('PostToolUse увімкнено на Edit|Write із явним таймаутом 120', () => {
  const post = settings().hooks?.PostToolUse?.[0];
  expect(post).toBeDefined();
  // `Edit|Write` містить лише літери й `|`, тож довідник оцінює його як «exact
  // string, or list of exact strings», а не як регулярний вираз; будь-який інший
  // символ перевів би матчер на гілку «JavaScript regular expression, unanchored»,
  // де `Edit.*` збігається ще й із `NotebookEdit`. Регістрозалежні обидві гілки.
  expect(post?.matcher).toBe('Edit|Write');
  expect(post?.hooks[0].type).toBe('command');
  expect(post?.hooks[0].command).toContain('edit-check.mjs');
  expect(post?.hooks[0].command).toContain('node.sh'); // ніколи не голий node
  expect(post?.hooks[0].timeout).toBe(120); // дефолт 600 — гейт на десять хвилин зламаний
});

test('Stop увімкнено без матчера, із таймаутом 300', () => {
  const stop = settings().hooks?.Stop?.[0];
  expect(stop).toBeDefined();
  expect(stop?.matcher).toBeUndefined(); // Stop матчера не підтримує
  expect(stop?.hooks[0].type).toBe('command');
  expect(stop?.hooks[0].command).toContain('stop-gate.mjs');
  expect(stop?.hooks[0].command).toContain('node.sh');
  expect(stop?.hooks[0].timeout).toBe(300);
});

/**
 * Виміряно на пробному дереві з `.nvmrc` = 22: форма `.claude/hooks/node.sh` без
 * `./` бігла НЕ тією версією, ніж дві інші, бо зріз шляху зупинявся на `.claude`
 * (R-149). Абсолютний шлях знімає питання незалежно від того, як розрізає шлях
 * сам `node.sh`, — але лише доти, доки він справді абсолютний ПІСЛЯ розкриття.
 * Огляд цього не ловить: у лапках рядок виглядає однаково і тоді, коли змінна
 * доходить до `sh` літералом.
 */
for (const event of ['PostToolUse', 'Stop'] as const) {
  /**
   * Друга половина вимоги §6.4, і саме та, якої розкриття НЕ доводить: абсолютним
   * шлях був би й зашитий `/Users/<хтось>/…`, і всі тести нижче лишилися б зеленими
   * на цій машині. Ціна конкретна — машинозалежний домашній шлях у файлі, який
   * клієнт відкриває на прийманні, і хук, що не запуститься в жодного іншого.
   * Тому адреса скрипта перевіряється в НЕРОЗКРИТОМУ рядку.
   *
   * Перевіряється рівно ця властивість — «шлях адресований змінною» — і жодна
   * деталь запису понад неї. Рівносильні для `sh` форми мусять лишатися зеленими:
   * подвійний пробіл, `"${CLAUDE_PROJECT_DIR}"` і канонічна форма З ДОВІДНИКА
   * `"$CLAUDE_PROJECT_DIR/…"` з лапками навколо всього шляху. Інакше наступний,
   * хто напише форму, надруковану в документації, отримає червоний тест і
   * вирішить, що помилився ВІН, — а це пастка в коді, який ми віддаємо.
   */
  test(`команда ${event} адресує скрипт через $CLAUDE_PROJECT_DIR, а не машинним шляхом`, () => {
    // Слово зі скісною рискою — це шлях; решта (майбутні прапорці) не обходить.
    const paths = commandOf(event).split(/\s+/).filter((word) => word.includes('/'));
    expect(paths.length).toBeGreaterThanOrEqual(2); // резолвер і скрипт
    for (const p of paths) expect(p).toMatch(/^"?\$\{?CLAUDE_PROJECT_DIR\}?/);
  });

  test(`команда ${event} розкривається в абсолютні шляхи до наявних файлів`, () => {
    const argv = expandArgv(commandOf(event), ROOT);
    const script = event === 'Stop' ? 'stop-gate.mjs' : 'edit-check.mjs';

    expect(argv).toEqual([
      path.join(ROOT, '.claude/hooks/node.sh'),
      path.join(ROOT, `.claude/hooks/${script}`),
    ]);
    // Файли існують, і резолвер — виконуваний: одруківка в шляху всередині
    // settings.json інакше проявилася б лише в живій сесії, як мовчазний хук.
    accessSync(argv[0], constants.X_OK);
    accessSync(argv[1], constants.R_OK);
  });
}

/**
 * Наскрізна узгодженість двох чисел у різних файлах: вбитий харнесом хук не
 * друкує НІЧОГО, тобто зникає рівно в те мовчання, проти якого написано шар.
 * Тому `timeout` події Stop мусить лишати гейтові час упасти за власним
 * `RUNNER_TIMEOUT_MS` і сказати про це вголос. Коментар у `stop-gate.mjs`
 * стверджує цю нерівність; майбутня правка будь-якого з двох чисел зробила б
 * його тихо неправдивим (R-132) — тут вона стає червоним тестом.
 */
test('таймаут Stop у settings.json більший за RUNNER_TIMEOUT_MS гейта', () => {
  const source = readFileSync(path.join(ROOT, '.claude/hooks/stop-gate.mjs'), 'utf8');
  const found = /^const RUNNER_TIMEOUT_MS = ([\d_]+);/m.exec(source);
  expect(found, 'у stop-gate.mjs не знайдено const RUNNER_TIMEOUT_MS').not.toBeNull();

  const runnerTimeoutMs = Number(found?.[1].replaceAll('_', ''));
  const stopTimeoutS = settings().hooks?.Stop?.[0]?.hooks[0].timeout;
  expect(stopTimeoutS).toBeDefined();
  expect((stopTimeoutS ?? 0) * 1000).toBeGreaterThan(runnerTimeoutMs);
});
