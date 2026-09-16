import { rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { scanForRefImports } from '../../scripts/verify/checks/no-ref-imports.mjs';
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
