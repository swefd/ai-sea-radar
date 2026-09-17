import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { CHECKS } from '../../scripts/verify/registry.mjs';

/**
 * Розділ 2 файлу `docs/context/verify-layer.md` — ручна копія `proves`/`blindSpot` із
 * `registry.mjs`. Копія без сторожа розходиться з оригіналом мовчки, і розійдеться вона
 * саме там, де текст читає клієнт: запис checkpoint збирається з цього файлу.
 *
 * Межа сторожа вузька навмисно (R-19): він стереже рівність
 * `docs/context/verify-layer.md` ↔ `registry.mjs` і нічого більше — ні загального
 * docs-drift, ні інших документів. Сторож переїхав сюди разом із таблицею: доки комірки
 * жили в `CLAUDE.md`, він дивився туди.
 */

const DOC = path.join('docs', 'context', 'verify-layer.md');

/**
 * Корінь беремо з `config.configFile`, а не з `process.cwd()`, не з `__dirname`
 * і **не** з `config.rootDir`. `cwd` залежить від того, звідки запустили;
 * Playwright виконує тест-файли у CJS-контексті, де `import.meta.url` ненадійний;
 * а `rootDir` — це `resolve(configDir, testDir)`, тобто за нашого `testDir: './tests'`
 * він дорівнює `<repo>/tests`, і шлях від нього дав би ENOENT.
 * Тека `playwright.config.ts` і є корінь репозиторію — за побудовою задачі 1.
 */
function repoRoot(): string {
  const configFile = test.info().config.configFile;
  if (!configFile) {
    throw new Error('Playwright запущено без файлу конфігурації — корінь репозиторію невизначений');
  }
  return path.dirname(configFile);
}

function readDoc(): string {
  return readFileSync(path.join(repoRoot(), DOC), 'utf8');
}

/**
 * Підрозділи перевірок живуть у розділі 2 і ніде більше. Вирізаємо саме його: у файлі є
 * інші заголовки третього рівня (8.1…8.6), і без цього звуження тест на «зайві підрозділи»
 * ловив би їх теж — тобто був би червоним назавжди, а не тестом.
 */
function checksSection(doc: string): string {
  const start = doc.indexOf('## 2. Що кожна перевірка доводить');
  expect(start, `у ${DOC} немає розділу «2. Що кожна перевірка доводить»`).toBeGreaterThan(-1);
  const rest = doc.slice(start);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Текст одного підрозділу: від його заголовка до наступного `###` або кінця розділу. */
function blockOf(section: string, id: string): string[] {
  const lines = section.split('\n');
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith(`### \x60${id}\x60 `))
    .map(({ index }) => index);
  expect(starts, `підрозділ «${id}»: очікується рівно один`).toHaveLength(1);

  const from = starts[0];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => line.startsWith('### '));
  return to === -1 ? lines.slice(from) : lines.slice(from, from + 1 + to);
}

/**
 * Рядок підрозділу, що починається заданим префіксом, — або `null`, якщо його немає.
 *
 * Вимога «не більше одного» несуча, а не гігієнічна: без неї вигадана команда, дописана
 * ПОРЯД зі справжньою, лишала б сюїту зеленою (виміряно: `2 passed`). Далі кожне поле
 * звіряється на РІВНІСТЬ, а не на входження, з тієї ж причини — `toContain` правдивий і
 * тоді, коли поряд із правдою в тому самому рядку стоїть вигадка.
 */
function soleLine(block: string[], prefix: string, id: string): string | null {
  const hits = block.filter((line) => line.startsWith(prefix));
  expect(hits.length, `«${id}»: рядків «${prefix}» очікується не більше одного`)
    .toBeLessThanOrEqual(1);
  return hits.length === 1 ? hits[0] : null;
}

test('кожен рядок реєстру присутній у verify-layer.md дослівно', () => {
  const section = checksSection(readDoc());

  // Порожній реєстр зробив би цикл нижче вакуумно зеленим (R-50). Другий тест
  // упіймав би це нерівністю списків, але тест не повинен покладатися на сусіда.
  expect(CHECKS.length, 'реєстр порожній — перевіряти нічого').toBeGreaterThan(0);

  for (const check of CHECKS) {
    const block = blockOf(section, check.id);

    expect(block[0], `заголовок «${check.id}» розійшовся з реєстром`)
      .toBe(`### \x60${check.id}\x60 — рівень \x60${check.tier}\x60`);

    expect(soleLine(block, '**Команда:**', check.id), `cmd для «${check.id}»`)
      .toBe(`**Команда:** \x60${check.cmd}\x60`);

    // ДВОБІЧНО: порожній `after` означає, що рядка бути НЕ МУСИТЬ. Однобічна звірка
    // («кожен елемент after згаданий») пропускала дописане `після: build` рядкові,
    // чий after порожній, — виміряно: `2 passed`.
    const expectedAfter = check.after.length === 0
      ? null
      : `**Запускається після:** ${check.after.map((a) => `\x60${a}\x60`).join(', ')}`;
    expect(soleLine(block, '**Запускається після:**', check.id), `after для «${check.id}»`)
      .toBe(expectedAfter);

    expect(soleLine(block, '**Доводить.**', check.id), `proves для «${check.id}»`)
      .toBe(`**Доводить.** ${check.proves}`);
    expect(soleLine(block, '**Не доводить.**', check.id), `blindSpot для «${check.id}»`)
      .toBe(`**Не доводить.** ${check.blindSpot}`);
  }
});

test('у verify-layer.md немає підрозділів, яких уже немає в реєстрі', () => {
  const section = checksSection(readDoc());

  // Заголовок підрозділу перевірки: `### `id` — рівень `tier``.
  // Зворотні лапки задані кодом (`\x60`), а не символом: літеральна лапка всередині
  // регекс-літерала — рівно та конструкція, якої не моделює забілення коментарів у
  // `no-ref-imports`, і вона зробила б хвіст цього файлу сліпою зоною периметра.
  // Виміряно: із символьною лапкою тут тест «периметр: порушення видно в кожній позиції
  // живого коду» червонів однією позицією — у цьому ж файлі.
  const listed = [...section.matchAll(/^### \x60([a-z0-9-]+)\x60 — рівень \x60/gm)]
    .map((m) => m[1])
    .sort();
  const registered = CHECKS.map((check) => check.id).sort();

  expect(listed).toEqual(registered);
});
