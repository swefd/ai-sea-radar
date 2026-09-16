import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { CHECKS } from '../../scripts/verify/registry.mjs';

/**
 * Таблиця перевірок у `CLAUDE.md` — ручна копія даних із `registry.mjs`. Копія без
 * сторожа розходиться з оригіналом мовчки, і розійдеться вона саме там, де текст
 * читає клієнт. Межа сторожа вузька навмисно (R-19): він стереже рівність
 * `CLAUDE.md` ↔ `registry.mjs` і нічого більше — ні загального docs-drift, ні
 * інших документів.
 */

/**
 * Корінь беремо з `config.configFile`, а не з `process.cwd()`, не з `__dirname`
 * і **не** з `config.rootDir`. `cwd` залежить від того, звідки запустили;
 * Playwright виконує тест-файли у CJS-контексті, де `import.meta.url` ненадійний;
 * а `rootDir` — це `resolve(configDir, testDir)`, тобто за нашого `testDir: './tests'`
 * він дорівнює `<repo>/tests`, і `join(rootDir, 'CLAUDE.md')` дав би ENOENT.
 * Тека `playwright.config.ts` і є корінь репозиторію — за побудовою задачі 1.
 */
function repoRoot(): string {
  const configFile = test.info().config.configFile;
  if (!configFile) {
    throw new Error('Playwright запущено без файлу конфігурації — корінь репозиторію невизначений');
  }
  return path.dirname(configFile);
}

function readClaudeMd(): string {
  return readFileSync(path.join(repoRoot(), 'CLAUDE.md'), 'utf8');
}

/**
 * Таблиці перевірок живуть у підрозділі «Що кожна перевірка доводить» і ніде більше.
 * Вирізаємо саме його: у CLAUDE.md є інші таблиці, чия перша комірка теж є
 * ідентифікатором у зворотних лапках (`eslint`, `eslint-config-next`, …), і без
 * цього звуження тест на «зайві рядки» був би червоним назавжди — тобто не тестом.
 */
function checksSection(claudeMd: string): string {
  const start = claudeMd.indexOf('### Що кожна перевірка доводить');
  expect(start, 'у CLAUDE.md немає підрозділу «Що кожна перевірка доводить»').toBeGreaterThan(-1);
  const rest = claudeMd.slice(start);
  const end = rest.indexOf('\n### ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test('кожен рядок реєстру присутній у таблиці CLAUDE.md дослівно', () => {
  const section = checksSection(readClaudeMd());

  // Порожній реєстр зробив би цикл нижче вакуумно зеленим (R-50). Другий тест
  // упіймав би це нерівністю списків, але тест не повинен покладатися на сусіда.
  expect(CHECKS.length, 'реєстр порожній — перевіряти нічого').toBeGreaterThan(0);

  for (const check of CHECKS) {
    // Рівно один рядок таблиці на кожен id — інакше опис роздвоївся.
    const rows = section
      .split('\n')
      .filter((line) => line.startsWith(`| \`${check.id}\` |`));
    expect(rows, `рядок «${check.id}»: очікується рівно один`).toHaveLength(1);

    const row = rows[0];
    expect(row, `cmd для «${check.id}» розійшовся з реєстром`).toContain(`\`${check.cmd}\``);
    expect(row, `proves для «${check.id}» розійшовся з реєстром`).toContain(check.proves);
    expect(row, `blindSpot для «${check.id}» розійшовся з реєстром`).toContain(check.blindSpot);
  }
});

test('у таблиці CLAUDE.md немає рядків, яких уже немає в реєстрі', () => {
  const section = checksSection(readClaudeMd());

  // Рядок таблиці перевірок: перша комірка — id у зворотних лапках,
  // друга починається зі зворотної лапки (cmd).
  //
  // Лапка задана кодом (`\x60`), а не символом, і це не оздоба. Літеральна
  // зворотна лапка всередині регекс-літерала — рівно та конструкція, якої не
  // моделює забілення коментарів у `no-ref-imports`: вона відкриває «шаблонний
  // літерал» до кінця файлу й робить хвіст цього файлу сліпою зоною периметра.
  // Виміряно: із символьною лапкою тут тест «периметр: порушення видно в кожній
  // позиції живого коду» червонів однією позицією — `claude-md-registry.spec.ts`.
  const listed = [...section.matchAll(/^\| \x60([a-z0-9-]+)\x60 \| \x60/gm)]
    .map((m) => m[1])
    .sort();
  const registered = CHECKS.map((check) => check.id).sort();

  expect(listed).toEqual(registered);
});
