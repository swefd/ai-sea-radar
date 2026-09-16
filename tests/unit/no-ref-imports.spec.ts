import { rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { scanForRefImports, scanText } from '../../scripts/verify/checks/no-ref-imports.mjs';
import {
  makeFixtureRepo,
  removeFixture,
  runCheck,
  writeFixtureFiles,
} from './support/check-fixtures';

const CHECK = 'no-ref-imports.mjs';

/** Зручність: у якому файлі:рядку знайдено порушення. */
const at = (violations: { file: string; line: number }[]): string[] =>
  violations.map((v) => `${v.file}:${v.line}`);

/**
 * Префікс шляху до study material, зібраний із сегментів. Цілого рядка
 * `…/reference/…` у цьому файлі немає навмисно — інакше сам файл тесту став би
 * порушенням, яке перевірка знайде на справжньому дереві (крок 6).
 */
const REF = ['..', '..', '..', 'reference', 'geodesy'].join('/');
const REF_DEEP = `../${REF}`;

/** Чистий зліпок сьогоднішнього репозиторію: FSD під src/, тонкий вхід під app/. */
const CLEAN_FILES: Record<string, string> = {
  // Саме слово `reference` у рядку — не порушення: сканер шукає форму імпорту,
  // а не підрядок. Розбирати на частини треба лише специфікатори.
  '.gitignore': '/reference/\n',
  'package.json': '{"name":"t"}\n',
  'app/page.tsx': "export { HomePage as default } from '@/_pages/home';\n",
  'src/_pages/home/index.ts': "export { HomePage } from './ui/home-page';\n",
  'src/shared/config/map.ts': 'export const INITIAL_VIEW = { zoom: 10 };\n',
  'src/_pages/home/ui/home-page.module.css': "@import './base.css';\n",
  'scripts/verify/hash.mjs': "import path from 'node:path';\n",
  'tests/e2e/select.spec.ts': "import { test } from '@playwright/test';\n",
  // Хибне спрацювання, якого не має бути: тека зветься references, у множині.
  // Цей літерал лишається цілим свідомо — він і має не збігтися.
  'src/shared/lib/docs.ts': "import x from '../../../docs/references/layer-structure';\n",
};

test('чистий репозиторій проходить, і периметр не порожній', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    const { files, violations } = scanForRefImports(root);
    expect(violations).toEqual([]);
    // Нуль перевірених файлів — це не «чисто», це зламаний периметр.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('src/_pages/home/index.ts');
  } finally {
    removeFixture(root);
  }
});

test('ловить усі шість статичних форм — і називає file:line', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/lib/bad.ts': [
      `import type { LatLon } from '${REF}/latlon-spherical.js';`,
      `export { Dms } from '${REF}/dms.js';`,
      `import '${REF}/side-effect.js';`,
      `const lazy = () => import('${REF}/lazy.js');`,
      `const legacy = require('${REF}/legacy.js');`,
      `/// <reference path="${REF}/types.d.ts" />`,
    ].join('\n') + '\n',
  });
  try {
    const { violations } = scanForRefImports(root);
    expect(violations).toHaveLength(6);
    expect(at(violations).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((line) => `src/shared/lib/bad.ts:${line}`).sort(),
    );
    expect(new Set(violations.map((v) => v.form)).size).toBe(6);
  } finally {
    removeFixture(root);
  }
});

/**
 * Сьома форма. У фікстуру вище вона не влазить: `.ts`-файл CSS-імпорту не містить,
 * а тест вище рахує рівно шість рядків. Без цього тесту `.css` у периметрі
 * сканування і сама форма `css-import` не доводяться нічим.
 */
test('CSS у периметрі: обгортку url(...) ловить лише css-форма', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/_pages/home/ui/leaflet-map.module.css': `@import url("${REF}/base.css");\n`,
  });
  try {
    const { files, violations } = scanForRefImports(root);
    // Без '.css' у переліку розширень файл не потрапив би навіть у перелік
    // перевірених — і тест зеленів би на порожньому периметрі.
    expect(files).toContain('src/_pages/home/ui/leaflet-map.module.css');
    expect(at(violations)).toEqual(['src/_pages/home/ui/leaflet-map.module.css:1']);
    // Саме `url(...)`, а не голий `@import '…'`: голий спіймався б і як
    // import-bare, тож окрема форма css-import доводиться лише обгорткою.
    expect(violations.map((v) => v.form)).toEqual(['css-import']);
  } finally {
    removeFixture(root);
  }
});

/**
 * Годує `scanText` текстом напряму — і тим самим робить дві речі одним тестом.
 *
 * Перше: закриває дірку, через яку перевірка мовчки зеленіла на панівному
 * форматуванні цього репозиторію. Порядкове зіставлення не бачило інструкції, у
 * якій ключове слово й `from` стоять на різних рядках; так написані п'ять імпортів
 * у чотирьох файлах дерева, включно з цим файлом.
 *
 * Друге: це єдине місце, де декларація `scanText` у `.d.mts` узагалі навантажена.
 * Без виклику звідси рядок декларації можна було замінити на
 * `scanTextTYPO(relPath: number): number` — і `check-types`, і весь набір лишалися
 * зеленими (виміряно, R-48).
 */
test('scanText: багаторядкову форму видно так само, як однорядкову', () => {
  const found = (text: string): string[] =>
    scanText('probe.ts', text).map((v) => `${v.form}@${v.line}`);

  // Контрольна група: на однорядкових випадках номери рядків не зсунулися.
  expect(found(`import { bearing } from '${REF}/latlon-spherical.js';\n`))
    .toEqual(['import-from@1']);
  // Три форми, невидимі до цього.
  expect(found(`import {\n  bearing,\n} from '${REF}/latlon-spherical.js';\n`))
    .toEqual(['import-from@1']);
  expect(found(`import type {\n  LatLon,\n} from '${REF}/latlon-spherical.js';\n`))
    .toEqual(['import-from@1']);
  expect(found(`export {\n  Dms,\n} from '${REF}/dms.js';\n`))
    .toEqual(['export-from@1']);
  expect(found(`import { bearing }\n  from '${REF}/latlon-spherical.js';\n`))
    .toEqual(['import-from@1']);
  // Крапка з комою лишилася бар'єром: чистий сусід не заражається від переносу.
  expect(found("import { useState } from 'react';\nimport { z } from './local';\n"))
    .toEqual([]);
  // Номер — це рядок КЛЮЧОВОГО СЛОВА, а не рядок специфікатора.
  expect(found(`const a = 1;\nconst b = 2;\nimport {\n  bearing,\n} from '${REF}/dms.js';\n`))
    .toEqual(['import-from@3']);
});

/**
 * Периметр цілком, а не один його шматок. До цього тесту чотири з п'яти його частин
 * не доводилися нічим: звуження периметра до `['src/']` мовчки роняло його з 26
 * файлів до 9, лишало EXIT=0 і весь набір зеленим (виміряно рецензією).
 * `src/` стереже тест вище, `.css` — тест CSS, решту — цей.
 */
test('периметр: порушення видно в кожній його частині, включно з кореневим конфігом', () => {
  const bad = (name: string): string => `import x from '${REF}/${name}.js';\n`;
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'app/layout.tsx': bad('a'),
    'tests/e2e/bad.spec.ts': bad('b'),
    'scripts/verify/checks/bad.mjs': bad('c'),
    '.claude/hooks/bad.mjs': bad('d'),
    // Кореневий конфіг не має префікса взагалі — він у периметр потрапляє лише
    // через SOURCE_FILES, тобто лише тому, що периметр спільний із хешем.
    'next.config.ts': bad('e'),
  });
  try {
    const { violations } = scanForRefImports(root);
    expect(at(violations).sort()).toEqual([
      '.claude/hooks/bad.mjs:1',
      'app/layout.tsx:1',
      'next.config.ts:1',
      'scripts/verify/checks/bad.mjs:1',
      'tests/e2e/bad.spec.ts:1',
    ]);
  } finally {
    removeFixture(root);
  }
});

test('бачить код застосунку під src/, а не лише під app/', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/_pages/home/ui/leaflet-map.tsx':
      `import { bearing } from '${REF_DEEP}/latlon-spherical.js';\n`,
  });
  try {
    const { violations } = scanForRefImports(root);
    expect(at(violations)).toEqual(['src/_pages/home/ui/leaflet-map.tsx:1']);
  } finally {
    removeFixture(root);
  }
});

test('відпускає після відкоту — порушення прибрано, знову зелено', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, {
      'src/shared/lib/bad.ts': `import x from '${REF}/dms.js';\n`,
    });
    expect(scanForRefImports(root).violations).toHaveLength(1);

    rmSync(path.join(root, 'src/shared/lib/bad.ts'));
    expect(scanForRefImports(root).violations).toEqual([]);
  } finally {
    removeFixture(root);
  }
});

test('ігнорований git-ом файл не сканується — периметр той самий, що в хеша', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    // Ігнорований файл живе ВСЕРЕДИНІ периметра сканування — і це несуча
    // деталь, а не примха. Сама тека `reference/` відсівається вже фільтром
    // префіксів, тож фікстура з неї однієї лишала б тест зеленим і без
    // `--exclude-standard`: він доводив би роботу гітігнора, якої не було б
    // (виміряно, R-50).
    '.gitignore': '/reference/\nsrc/shared/lib/vendored.ts\n',
    'src/shared/lib/vendored.ts': `import own from '${REF}/dms.js';\n`,
    'reference/geodesy/latlon-spherical.js': `import own from '${['..', 'reference', 'dms.js'].join('/')}';\n`,
  });
  try {
    // Ігноровані файли не передаються клієнтові, тож і перевірці їх не видно.
    // Інакше перевірка сканувала б 532 сторонні файли study material.
    const { files, violations } = scanForRefImports(root);
    expect(violations).toEqual([]);
    expect(files).not.toContain('src/shared/lib/vendored.ts');
    // Друга лінія: тека study material не потрапляє в перелік і сама по собі.
    expect(files.some((f) => f.startsWith('reference/'))).toBe(false);
  } finally {
    removeFixture(root);
  }
});

/**
 * Єдиний тест через підпроцес. Він стереже не поведінку — її стережуть п'ять тестів
 * вище, — а КОНТРАКТ КОДІВ ВИХОДУ: `run.mjs` відрізняє FAILED від UNRUNNABLE рівно
 * за ними, і більше нізвідки цього не дізнається.
 */
test('CLI: 0 на чистому дереві, 1 на порушенні', () => {
  const clean = makeFixtureRepo(CLEAN_FILES);
  const dirty = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/lib/bad.ts': `import x from '${REF}/dms.js';\n`,
  });
  try {
    const ok = runCheck(CHECK, clean);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('порушень немає');

    const bad = runCheck(CHECK, dirty);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain('src/shared/lib/bad.ts:1:');
    expect(bad.stdout).toContain('файлів із порушеннями — 1');
  } finally {
    removeFixture(clean);
    removeFixture(dirty);
  }
});
