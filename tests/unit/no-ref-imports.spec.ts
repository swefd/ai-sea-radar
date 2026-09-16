import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import {
  blankComments,
  scanForRefImports,
  scanText,
} from '../../scripts/verify/checks/no-ref-imports.mjs';
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

/** Зручність для тестів через `scanText` напряму: форма@рядок. */
const found = (text: string): string[] =>
  scanText('probe.ts', text).map((v) => `${v.form}@${v.line}`);

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
 * Форма, яка у фікстуру вище не влазить: `.ts`-файл CSS-імпорту не містить,
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
 * Один символ у коментарі робив справжній імпорт із `reference/` невидимим.
 * `[^;]*?` — бар'єр навмисний, але крапка з комою ВСЕРЕДИНІ коментаря інструкції
 * не завершує; регулярка думала, що завершує. Виміряно до правки: перша вставка
 * нижче давала `[]`, та сама з комою замість крапки з комою — `import-from@1`.
 *
 * Це не теорія: CLAUDE.md ВИМАГАЄ коментаря з назвою походження поруч із
 * портованим із study material кодом, багаторядкові імпорти — панівний стиль тут,
 * а коментарі — щільна українська проза, у якій крапка з комою звичайна. Тобто
 * сканер сліпнув рівно на тому написанні, заради якого існує.
 */
test('scanText: коментар усередині імпорту більше його не ховає', () => {
  // Крапка з комою в коментарі між `import` і `from`.
  expect(found(`import {\n  // порт; див. upstream\n  bearing,\n} from '${REF}/dms.js';\n`))
    .toEqual(['import-from@1']);
  // Прохід 1 лишається ПІДЛОГОЮ: закоментований імпорт видно й далі. Якби другий
  // прохід замінив перший, а не додався до нього, цей рядок став би порожнім.
  expect(found(`// import { bearing } from '${REF}/dms.js';\n`)).toEqual(['import-from@1']);
  // Забілення не зсуває офсети: номер рядка рахується по забіленому тексту, тож
  // з'їдений перенос у блоковому коментарі вище приписав би порушення не тому
  // рядку. Тут імпорт починається на п'ятому — і лише другий прохід його бачить.
  expect(found([
    '/**',
    ' * блоковий коментар',
    ' * на кілька рядків',
    ' */',
    'import {',
    '  // порт; див. upstream',
    '  bearing,',
    `} from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual(['import-from@5']);
});

/**
 * Довжина — навантажений інваріант, а не охайність. Номер рядка рахується як
 * `text.slice(0, match.index)`, тож забілення, що міняє довжину або їсть переноси,
 * зсунуло б усі номери нижче. Тест вище ловить лише з'їдений перенос; цей ловить
 * будь-яку зміну довжини, включно з тією, що номерів поки не чіпає.
 */
test('blankComments: довжина й переноси незмінні, крапка з комою зникає', () => {
  const text = [
    '/* блок; із крапкою з комою */',
    "const a = 1; // хвіст; теж із нею",
    'const b = 2;',
    '',
  ].join('\n');
  const blanked = blankComments(text);

  expect(blanked).toHaveLength(text.length);
  expect(blanked.split('\n')).toHaveLength(text.split('\n').length);
  // Код недоторканий, тіла коментарів — самі пробіли, бар'єрів у них не лишилося.
  expect(blanked.split('\n')[2]).toBe('const b = 2;');
  expect(blanked.split('\n')[0].trim()).toBe('');
  expect(blanked.split('\n')[1]).toBe('const a = 1;'.padEnd(text.split('\n')[1].length));
});

/**
 * Дефект, який другий прохід приніс разом із виправленням. Незакритий `/*`
 * забілювався до кінця файлу, «як його читає компілятор», — але файл, що
 * проходить `tsc` і `eslint`, незакритого коментаря не має. Отже такий `/*`
 * завжди стоїть у літералі, а забілення до кінця файлу мовчки вимикає прохід 2
 * на всьому, що нижче.
 *
 * Літерал тут — не вигадка: глоб на кшталт наведеного нижче стоїть у прозі
 * рядка `lint` у `registry.mjs` і забілював там усе до кінця файлу — на базі
 * `28f4faf` це 6501 символ, включно з рядком самої цієї перевірки (виміряно).
 */
test('blankComments: незакритий блоковий маркер не з\'їдає решту файлу', () => {
  const text = "const globs = '.claude/worktrees/**';\nconst b = 2;\n";
  // Не «менше забілено», а «не забілено зовсім»: у літералі коментаря немає.
  expect(blankComments(text)).toBe(text);
});

/**
 * Той самий дефект, але видимий там, де він шкодить: у вердикті сканера.
 *
 * Пін саме на РЯДКОВОМУ ЛІТЕРАЛІ, а не на прозі в коментарі, і це виміряна
 * поправка. Глоб усередині `//` чи блокового коментаря забілюється РАЗОМ із
 * коментарем, тож маркер там ніколи не відкривається — такий текст ловився й
 * до правки. Тригером був тільки літерал, тож тест на прозі був би зеленим і
 * без правки, тобто не доводив би нічого (R-50).
 */
test('scanText: глоб у літералі не вимикає другий прохід на решті файлу', () => {
  const hidden = [
    'import {',
    '  // порт із upstream; див. нижче',
    '  z,',
    `} from '${REF}/dms.js';`,
    '',
  ].join('\n');

  // Форма рядка `lint` у реєстрі: проза з глобами всередині рядкового літерала.
  expect(found(`const ignores = 'не дерево репозиторію: .claude/worktrees/**';\n${hidden}`))
    .toEqual(['import-from@2']);
  // Шаблон — те саме, і так само не коментар.
  const BT = '`';
  expect(found(`const g = ${BT}.claude/worktrees/**${BT};\n${hidden}`))
    .toEqual(['import-from@2']);
  // Контрольна група: у коментарі глоб дефекту не давав ніколи — тобто зелене
  // тут не є доказом правки, і саме тому воно стоїть окремо від двох рядків вище.
  expect(found(`// не дерево репозиторію: .claude/worktrees/**\n${hidden}`))
    .toEqual(['import-from@2']);
});

/**
 * КЛАС, а не один випадок — і єдиний тест тут, який іде по СПРАВЖНЬОМУ дереву.
 *
 * Забілення, що сягає кінця файлу, мовчки вимикає прохід 2 на всьому, що нижче:
 * сканер віддає «порушень немає» й EXIT=0, `run.mjs` робить із цього PASSED, і
 * жодна інша перевірка цього не бачить. Саме цей тест зловив би дефект раунду 3,
 * і жоден із тестів, що пінять названі діри, його не зловив.
 *
 * По дереву, а не по фікстурі, навмисно: тригер — домашній стиль цього
 * репозиторію (глоби в прозі), тож фікстура ловила б лише ті написання, які
 * автор здогадався вписати. Швидко: файлів у периметрі 29.
 *
 * Периметр береться з `scanForRefImports`, а не збирається тут наново: другий
 * список розійшовся б із першим — рівно та помилка, яку вже виправляв периметр.
 *
 * Розпізнавання «це рядок коментаря» тут навмисно грубе — три префікси, без
 * розбору вкладеності. Помиляється воно в бік ЧЕРВОНОГО: файл, що закінчується
 * блоковим коментарем без зірочок на початку рядків, дасть хибний червоний.
 * Таких у периметрі нуль; якщо з'явиться, червоне означає «подивись у файл»,
 * а не «послаб тест».
 */
test('периметр: забілення коментарів ніде не сягає кінця файлу', () => {
  const root = process.cwd();
  const { files } = scanForRefImports(root);
  // Порожній периметр зробив би цей тест зеленим, нічого не перевіривши.
  expect(files.length).toBeGreaterThan(0);

  const swallowed: string[] = [];
  for (const rel of files) {
    const text = readFileSync(path.join(root, rel), 'utf8');
    const raw = text.split('\n');
    const blanked = blankComments(text).split('\n');
    // Останній рядок, який у СИРОМУ тексті не є коментарем сам по собі: якщо вже
    // й він став суцільними пробілами, забілення дійшло до кінця файлу.
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      const line = raw[i].trim();
      if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
        continue;
      }
      if (blanked[i].trim() === '') swallowed.push(`${rel}:${i + 1}`);
      break;
    }
  }

  expect(swallowed).toEqual([]);
});

/**
 * Дві форми, що не збігалися з власним наміром. Обидві правки — в бік ПЕРЕБОРУ.
 */
test('scanText: @import без пробілу й require.resolve більше не мовчать', () => {
  // Валідний CSS: пробіл між директивою й лапкою не обов'язковий.
  expect(found(`@import'${REF}/base.css';\n`)).toEqual(['css-import@1']);
  // `proves` називало `require` без застережень, а `.resolve` проходив мовчки.
  expect(found(`const p = require.resolve('${REF}/dms.js');\n`)).toEqual(['require@1']);
});

/**
 * ДІРИ, ЯКІ ЦЕЙ РАУНД СВІДОМО ЛИШАЄ ВІДКРИТИМИ — і які називає `blindSpot`.
 *
 * Ці тести існують НЕ щоб закріпити слабкість, а щоб список дір не міг тихо
 * стати неправдою. Досі `proves` і `blindSpot` торкався єдиний тест — перевірка
 * довжини рядка в `run.spec.ts`; неправдиве твердження в цих полях не здатен був
 * спіймати жоден тест, тому проза дрейфувала три раунди поспіль, а ловило її
 * лише людське око.
 *
 * Якщо хтось колись діру закриє — відповідний рядок тут почервоніє й змусить
 * оновити `blindSpot`. Це переводить його з декорації в навантажене твердження.
 * Червоний тут означає «онови прозу», а не «поламав сканер».
 */
test('blindSpot: названі діри справді є — і почервоніють, коли їх закриють', () => {
  // `SPECIFIER` вимагає лапок, а `@import url(…)` без лапок — валідний CSS.
  expect(found(`@import url(${REF}/base.css);\n`)).toEqual([]);
  // Шлях, зібраний обчисленням: у літералі сегмента `reference` немає взагалі.
  const BT = '`';
  expect(found(`const base = '${REF}';\nconst lazy = () => import(${BT}\${base}/dms.js${BT});\n`))
    .toEqual([]);
  // Ловиться лише варіант із `path=`; `types=` проходить мовчки.
  expect(found(`/// <reference types='${REF}/types.d.ts' />\n`)).toEqual([]);
  // Аліас із `paths` у `tsconfig.json`: сканер бачить літерал, а не те, у що
  // його розгортає компілятор.
  expect(found("import { bearing } from '@ref/latlon-spherical.js';\n")).toEqual([]);
  // Заниження N: ключ дедуплікації — рядок плюс специфікатор, тож ДВА справжні
  // порушення на одному рядку з тим самим шляхом дають ОДИН рядок звіту. Вердикт
  // від цього не міняється ніколи (нуль проти не-нуля), лише число.
  expect(found(`import a from '${REF}/dms.js'; export { b } from '${REF}/dms.js';\n`))
    .toEqual(['import-from@1']);
  // Зворотний бік того ж вибору: сканер не парсить мову, тож проза, яка саме
  // правило ЦИТУЄ, здатна дати хибне спрацювання. Перебір безпечний, недобір — ні.
  expect(found(`const RULE = ${BT}ніколи: import x from '${REF}/dms.js'${BT};\n`))
    .toEqual(['import-from@1']);
  // Межа наївного забілення, яка лишилася після правки незакритого маркера:
  // `//` у рядковому літералі з'їдає решту СВОГО рядка разом із `import`, а
  // прохід 1 упирається в крапку з комою всередині коментаря. Потрібен код і
  // ПОЧАТОК багаторядкового імпорту на ОДНОМУ рядку; у периметрі таких рядків
  // нуль, і жоден лінтер такого стилю не пропустить. Лікувати це забіленням,
  // що розуміє літерали, означало б платити складністю за випадок, якого немає.
  expect(found([
    "const u = 'http://x'; import {",
    '  // порт; див.',
    '  y,',
    `} from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual([]);
});

/**
 * Остання названа діра, якій потрібне справжнє дерево, а не текст: периметр
 * звужений за розширенням, і звуження реальне. Той самий `@import`, який у `.css`
 * ловиться (тест «CSS у периметрі» вище), у `.scss` не читається взагалі.
 */
test('blindSpot: розширення поза списком не читається, хоч і в периметрі свіжості', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/_pages/home/ui/theme.scss': `@import '${REF}/base.css';\n`,
  });
  try {
    const { files, violations } = scanForRefImports(root);
    expect(violations).toEqual([]);
    expect(files).not.toContain('src/_pages/home/ui/theme.scss');
  } finally {
    removeFixture(root);
  }
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
