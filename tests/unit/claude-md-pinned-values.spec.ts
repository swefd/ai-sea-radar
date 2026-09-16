import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Розділ «Перевірка» в `CLAUDE.md` повторює значення, які пінить код: точні версії трьох
 * інструментів перевірки (`package.json`) і два таймаути хуків (`.claude/settings.json`).
 * Повтор корисний — читач бачить число там, де читає обґрунтування, — але без сторожа він
 * дрейфує МОВЧКИ: підняли версію, перевірки почервоніли гучно, їх полагодили, а проза
 * лишилася казати старе число. Це той самий дрейф, від якого стереже сторож
 * `verify-layer.md` ↔ `registry.mjs`, лише інша пара.
 *
 * Межа так само вузька: ЛИШЕ ці п'ять значень і лише в `CLAUDE.md`. Це не загальний
 * docs-drift і не перевірка решти прози.
 *
 * Чого тут НЕМАЄ і чому: дефолт таймаута command-хука (600 с) не пінить жоден файл цього
 * репозиторію — він із документації Claude Code, тож стерегти його нічим.
 */

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface HookCommand { timeout?: number }
interface HookEntry { hooks: HookCommand[] }
interface Settings { hooks?: Record<string, HookEntry[] | undefined> }

/**
 * Корінь — із `config.configFile`, як і в сусіднього сторожа: `process.cwd()` залежить
 * від того, звідки запустили, а `config.rootDir` — це `<repo>/tests`.
 */
function repoRoot(): string {
  const configFile = test.info().config.configFile;
  if (!configFile) {
    throw new Error('Playwright запущено без файлу конфігурації — корінь репозиторію невизначений');
  }
  return path.dirname(configFile);
}

function read(relPath: string): string {
  return readFileSync(path.join(repoRoot(), relPath), 'utf8');
}

/** Інструменти перевірки — виняток із «no extra dependencies», названий у CLAUDE.md. */
const VERIFICATION_TOOLS = ['eslint', 'eslint-config-next', '@playwright/test'];

test('версії інструментів перевірки в CLAUDE.md збігаються з package.json', () => {
  const manifest = JSON.parse(read('package.json')) as Manifest;
  const claudeMd = read('CLAUDE.md');

  for (const name of VERIFICATION_TOOLS) {
    const pinned = manifest.devDependencies?.[name] ?? manifest.dependencies?.[name];
    expect(pinned, `${name} зник із package.json — тоді його немає й серед винятків`)
      .toBeDefined();

    // Рядок таблиці залежностей: перша комірка — ім'я пакета, друга — версія.
    const rows = claudeMd
      .split('\n')
      .filter((line) => line.startsWith(`| \x60${name}\x60 |`));
    expect(rows, `${name}: у CLAUDE.md очікується рівно один рядок таблиці`).toHaveLength(1);

    // РІВНІСТЬ другої комірки, не входження: версія, дописана поряд зі справжньою,
    // лишила б `toContain` правдивим.
    const cells = rows[0].split('|').map((cell) => cell.trim());
    expect(cells[2], `версія ${name} у CLAUDE.md розійшлася з package.json`)
      .toBe(`\x60${pinned}\x60`);
  }
});

test('таймаути хуків у CLAUDE.md збігаються з .claude/settings.json', () => {
  const settings = JSON.parse(read('.claude/settings.json')) as Settings;
  const claudeMd = read('CLAUDE.md');

  for (const event of ['PostToolUse', 'Stop'] as const) {
    const pinned = settings.hooks?.[event]?.[0]?.hooks[0]?.timeout;
    expect(pinned, `у settings.json немає явного таймаута для ${event}`).toBeDefined();

    // Число ВИТЯГУЄТЬСЯ з прози й порівнюється, а не шукається готовим: пошук
    // підрядка «`Stop` 300 с» лишався б зеленим і тоді, коли поряд стоїть друге,
    // суперечливе число.
    const found = [...claudeMd.matchAll(new RegExp(`\x60${event}\x60 (\\d+) с`, 'g'))]
      .map((match) => Number(match[1]));
    expect(found, `${event}: у CLAUDE.md очікується рівно одна згадка таймаута`)
      .toHaveLength(1);
    expect(found[0], `таймаут ${event} у CLAUDE.md розійшовся з settings.json`).toBe(pinned);
  }
});
