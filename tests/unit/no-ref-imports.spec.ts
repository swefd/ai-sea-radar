import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import {
  blankComments,
  scanForRefImports,
  scanText,
} from '../../scripts/verify/checks/no-ref-imports.mjs';
import {
  checkPath,
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
 * Інваріант забілення дослівно: забілюється ТІЛЬКИ те, що є коментарем.
 *
 * Дві половини одного дефекту, обидві пришпилені окремо. Перша: маркер усередині
 * ЛІТЕРАЛА коментаря не відкриває, навіть коли нижче стоїть справжній закривач і
 * пара формально складається, — інакше забілюється весь проміжок між ними, а на
 * ньому мовчки вимкнений прохід 2. Друга: незакритий маркер ПОЗА літералом
 * коментаря так само не відкриває — інакше забілюється все до кінця файлу.
 *
 * Глоб тут не вигадка, а домашній стиль: така проза стоїть у рядку `lint` у
 * `registry.mjs` і на базі `28f4faf` забілювала 6501 символ, включно з рядком
 * самої цієї перевірки (виміряно).
 */
test('blankComments: забілюється тільки те, що є коментарем', () => {
  // Перша половина: пара складається аж НИЖЧЕ імпорту. Під наївним забіленням
  // рядок `const x = 1;` ставав суцільними пробілами — разом із усім, що між.
  const paired = [
    "const g = '.claude/worktrees/**';",
    'const x = 1;',
    '/* справжній коментар */',
    '',
  ].join('\n');
  const blanked = blankComments(paired).split('\n');
  expect(blanked[0]).toBe("const g = '.claude/worktrees/**';");
  expect(blanked[1]).toBe('const x = 1;');
  // Контроль у протилежний бік: справжній коментар забілюється й далі, інакше
  // «нічого не забілювати» проходило б цей тест теж.
  expect(blanked[2].trim()).toBe('');

  // Друга половина: незакритий маркер поза літералом. Не «менше забілено», а
  // «не забілено зовсім» — і прохід 1 по сирому тексту лишається підлогою.
  const unclosed = 'const a = 1;\n/* хвіст без пари\nconst b = 2;\n';
  expect(blankComments(unclosed)).toBe(unclosed);
});

/**
 * Той самий дефект, але видимий там, де він шкодить: у вердикті сканера.
 *
 * Пін саме на РЯДКОВОМУ ЛІТЕРАЛІ, а не на прозі в коментарі, і це виміряна
 * поправка. Глоб усередині `//` чи блокового коментаря забілюється РАЗОМ із
 * коментарем, тож маркер там ніколи не відкривається — такий текст ловився й
 * до правки. Тригером був тільки літерал, тож тест на прозі був би зеленим і
 * без правки, тобто не доводив би нічого (R-50).
 *
 * Найдорожчий випадок тут — четвертий: пара для маркера з літерала складається
 * аж НИЖЧЕ імпорту. Забілення проміжку вимикає прохід 2 рівно там, де стоїть
 * порушення, а прохід 1 упирається в крапку з комою всередині коментаря —
 * виміряно, ця форма давала `[]` на справжньому порушенні.
 */
test('scanText: маркер у літералі не вимикає другий прохід', () => {
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
  // Пара складається нижче імпорту — і забілює його разом із проміжком.
  expect(found([
    "const g = 'a/*b';",
    hidden,
    '/* справжній коментар */',
    '',
  ].join('\n'))).toEqual(['import-from@2']);
  // `//` у літералі поруч із ПОЧАТКОМ багаторядкового імпорту. Доти ця форма
  // була названою дірою й пінилася як відкрита; тепер вона ловиться, і пін
  // переїхав сюди — з тим самим текстом фікстури, але протилежним твердженням.
  expect(found([
    "const u = 'http://x'; import {",
    '  // порт; див.',
    '  y,',
    `} from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual(['import-from@1']);
});

/**
 * Оракул «це місце всередині коментаря?» для тесту нижче — і навмисно НЕ
 * `blankComments`. Коли лінію проводить сама функція, яку тест перевіряє, її
 * власна помилка оголошує сліпу позицію «коментарем» і тест зеленіє по колу:
 * виміряно, з циркулярним оракулом на базі `cf3c0c7` дір виходило 0 при 61
 * реально не знайденій вставці.
 *
 * Тому оракул тут незалежний, грубий і КОНСЕРВАТИВНИЙ: попередній непорожній
 * рядок сирого файлу починається з `//`, `*` або `/*` — позицію не вимагаємо.
 * Помиляється він у бік «менше вимог», тобто послабити тест здатен, а зробити
 * його хибно червоним — ні.
 */
const insideComment = (lines: string[], index: number): boolean => {
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    return line.startsWith('//') || line.startsWith('*') || line.startsWith('/*');
  }
  return false;
};

/**
 * КЛАС, а не один випадок — і єдиний тест тут, який іде по СПРАВЖНЬОМУ дереву.
 *
 * Питання, на яке він відповідає, дослівно: чи є в периметрі позиція живого коду,
 * у якій справжнє порушення сканер НЕ побачить? Форма вставки — та, яку ловить
 * лише прохід 2 (крапка з комою в коментарі всередині багаторядкового імпорту),
 * тож тест міряє саме те, чи прохід 2 десь мовчки вимкнений. Забілення, яке
 * з'їло проміжок, дає «порушень немає», EXIT=0 і PASSED у `run.mjs` — і жодна
 * інша перевірка цього не бачить.
 *
 * Попередник цього тесту дивився ОДИН рядок на файл (останній некоментарний) і
 * питав лише «чи забілення сягнуло кінця файлу». Він був зелений на дереві, де
 * 61 вставка з 672 не знаходилася (виміряно), тобто зеленів на хибному класі.
 *
 * По дереву, а не по фікстурі, навмисно: тригер — домашній стиль цього
 * репозиторію (глоби й шляхи в прозі всередині літералів), тож фікстура ловила б
 * лише ті написання, які автор здогадався вписати. Крок по рядках розріджений —
 * кожен 5-й, — бо густіший нічого не додає, а секунди коштує.
 *
 * Периметр береться з `scanForRefImports`, а не збирається тут наново: другий
 * список розійшовся б із першим — рівно та помилка, яку вже виправляв периметр.
 */
test('периметр: порушення видно в кожній позиції живого коду', () => {
  const root = process.cwd();
  const { files } = scanForRefImports(root);
  // Порожній периметр зробив би цей тест зеленим, нічого не перевіривши.
  expect(files.length).toBeGreaterThan(0);

  // Форма, невидима для проходу 1: крапка з комою в коментарі стоїть бар'єром
  // між `import` і `from`. Бачить її лише прохід 2 — і тільки якщо забілення
  // не з'їло цей шматок файлу.
  const block = [
    'import {',
    '  // порт; див. нижче',
    '  z,',
    `} from '${REF}/dms.js';`,
  ];

  const blind: string[] = [];
  let live = 0;
  for (const rel of files) {
    const lines = readFileSync(path.join(root, rel), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 5) {
      if (insideComment(lines, i)) continue;
      live += 1;
      const patched = [...lines.slice(0, i), ...block, ...lines.slice(i)].join('\n');
      if (!scanText(rel, patched).some((v) => v.specifier.endsWith('/dms.js'))) {
        blind.push(`${rel}:${i + 1}`);
      }
    }
  }

  // Друга варта від порожнього прогону: оракул, який раптом визнає коментарем
  // усе, лишив би `blind` порожнім, нічого не перевіривши. Поріг самомасштабний —
  // щонайменше по позиції на файл, — а не число, яке старіє.
  expect(live).toBeGreaterThan(files.length);
  expect(blind).toEqual([]);
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
  // Ціна того ж вибору — НОМЕР РЯДКА. Збіг починається від ключового слова, тож
  // зайвий `import` у коментарі вище, без крапки з комою між ним і справжнім
  // імпортом, дотягується до чужого `from` і приписує порушення СВОЄМУ рядку.
  // Напрямок помилки безпечний: рядок звіту зайвий, а не зниклий, — прохід 2
  // бачить той самий імпорт ще раз і вже на правильному рядку.
  expect(found([
    '// зайвий import у коментарі, без крапки з комою',
    `import x from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual(['import-from@1', 'import-from@2']);
  // Контроль до попереднього рядка: з крапкою з комою в коментарі бар'єр стоїть,
  // і номер єдиний та правильний. Без цього рядка «двічі» не відрізнялося б від
  // «завжди двічі».
  expect(found([
    '// зайвий import; у коментарі',
    `import x from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual(['import-from@2']);
  // Межа забілення: воно знає рівно літерал у лапках, рядковий коментар і
  // блоковий. Маркер усередині конструкції, якої воно не моделює, читається як
  // справжній. Тут така конструкція — вкладений шаблон: бектик усередині `${…}`
  // збиває парування, і `//` з тіла шаблона забілює решту рядка разом із
  // ПОЧАТКОМ багаторядкового імпорту.
  //
  // «На одному рядку» тут потрібне САМЕ ЦІЙ гілці: рядковий коментар далі свого
  // рядка не сягає. Гілка з блоковим маркером цієї умови не має й працює через
  // довільну кількість рядків — її пінить тест про словник забілення нижче.
  //
  // Вкладених шаблонів у периметрі НЕМАЄ жодного: виміряно парсером TypeScript
  // на `b282e1e` — обхід AST шукав шаблон усередині виразу інтерполяції й
  // знайшов нуль. Числа інтерполяцій тут навмисно не названо: периметр включає
  // цей самий файл, тож кожна правка спека його зсуває, і голе число застаріє
  // знову — воно вже застаріло рівно так одного разу.
  expect(found([
    `const s = ${BT}a\${${BT}//${BT}}c${BT}; import {`,
    '  // порт; див.',
    '  y,',
    `} from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual([]);
});

/**
 * КЛАС, який `blindSpot` називає тепер, — і пін на кожне його ВИМІРЯНЕ джерело.
 *
 * Доти клас описувався двома універсальними твердженнями, і обидва були хибні:
 * «недобір лише коли на ОДНОМУ рядку» і «решта хиб розбору літералів забілює
 * МЕНШЕ, тож хибного PASSED не дає». Перше спростовує (D), друге — (A) і (B).
 * Прозу здатне втримати лише те, що її спростовує, тож кожне джерело стоїть тут
 * поряд зі своїм КОНТРОЛЕМ: той самий текст без дефекту — і порушення видно.
 * Без контролю ці рядки були б зелені й на сканері, який не ловить нічого.
 *
 * Істинна форма класу — про СЛОВНИК забілення, а не про перелік написань:
 * `blankComments` знає рівно три речі — літерал у лапках, рядковий коментар,
 * блоковий коментар, — тож маркер усередині будь-якої конструкції з-поза цієї
 * трійки читається як справжній.
 * (E) і (F) показують, що клас не зводиться до «розходження парування лапок»:
 * у них лапки немає ЖОДНОЇ.
 *
 * Якщо котресь джерело колись закриють — відповідний рядок почервоніє й змусить
 * оновити `blindSpot`. Червоний тут означає «онови прозу», а не «поламав сканер».
 */
test('blindSpot: маркер у конструкції, якої забілення не моделює, читається як справжній', () => {
  const BT = '`';
  const BS = '\\';
  const hidden = [
    'import {',
    '  // порт; див. нижче',
    '  z,',
    `} from '${REF}/dms.js';`,
  ];
  const real = '/* справжній коментар */';
  const probe = (head: string): string[] => found([head, ...hidden, real, ''].join('\n'));
  // Друга половина класу: лапка в немодельованій конструкції збиває парування
  // ДАЛІ за текстом — з'їдає бектик, що відкривав шаблон, і випускає тіло
  // шаблона в код. Імпорт тут починається на 4-му рядку.
  const spill = (head: string): string[] =>
    found([`${head} const t = ${BT}`, '  a/*b', `${BT};`, ...hidden, real, ''].join('\n'));

  // (E) тіло регекс-літерала. Лапки в рядку немає взагалі.
  expect(probe(`const re = /a${BS}/*b/;`)).toEqual([]);
  expect(probe(`const re = /a${BS}/xb/;`)).toEqual(['import-from@2']);

  // (F) текст JSX — так само без жодної лапки.
  expect(probe('const el = <p>a/*b</p>;')).toEqual([]);
  expect(probe('const el = <p>axb</p>;')).toEqual(['import-from@2']);

  // (D) вкладений шаблон, а імпорт починається РЯДКОМ НИЖЧЕ. Умови «на одному
  // рядку» блокова гілка не має — рівно це й спростовує стару прозу.
  expect(probe(`const s = ${BT}a\${${BT}/*${BT}}c${BT};`)).toEqual([]);
  expect(probe(`const s = ${BT}ac${BT};`)).toEqual(['import-from@2']);

  // (A) апостроф у тексті JSX. Забілено БІЛЬШЕ, а не менше, і вердикт чистий.
  expect(spill("const el = <p>Ім'я</p>;")).toEqual([]);
  expect(spill('const el = 1;')).toEqual(['import-from@4']);

  // (B) те саме джерело, але лапка в тілі регекса. Це гілка, яку задача 6
  // робить жилою: вона кладе в периметр `checks/no-secrets.mjs` — найщільнішу
  // тут концентрацію регекс-літералів.
  expect(spill(`const re = /['"]/;`)).toEqual([]);
  expect(spill('const re = 1;')).toEqual(['import-from@4']);
});

/**
 * Гілка `:119` — пропуск екранування всередині літерала. Мутація на `if (false)`
 * лишала ВЕСЬ набір зеленим (17 passed), тобто гілку не тримав жоден тест.
 *
 * Обидва твердження нижче червоніють з `if (false)` і зеленіють назад (R-50):
 * без пропуску літерал закривається на екранованій лапці, хвіст його тіла
 * читається як код, і відкривальний маркер звідти паруєтся зі справжнім
 * закривачем НИЖЧЕ, забілюючи все між ними.
 */
test('пропуск екранування: екранована лапка літерала не закриває', () => {
  const text = [
    "const s = 'a\\'b/*c';",
    'const x = 1;',
    '/* справжній коментар */',
    '',
  ].join('\n');
  const blanked = blankComments(text).split('\n');
  // Літерал пропущено ЦІЛКОМ, тож `/*` у ньому коментаря не відкрив і сусідній
  // рядок коду цілий. Без пропуску він став би суцільними пробілами.
  expect(blanked[1]).toBe('const x = 1;');
  // Контроль у протилежний бік: справжній коментар забілюється й далі, інакше
  // «нічого не забілювати» проходило б цей тест теж.
  expect(blanked[2].trim()).toBe('');

  // Той самий дефект у ВЕРДИКТІ: забілений проміжок накриває багаторядковий
  // імпорт, прохід 2 сліпне, а прохід 1 упирається в крапку з комою в коментарі.
  expect(found([
    "const s = 'a\\'b/*c';",
    'import {',
    '  // порт; див. нижче',
    '  z,',
    `} from '${REF}/dms.js';`,
    '/* справжній коментар */',
    '',
  ].join('\n'))).toEqual(['import-from@2']);
});

/**
 * Гілка `:129` — охорона переносу рядка для `'` і `"`. Мутація на `if (false)`
 * так само лишала весь набір зеленим, хоча гілка навантажена: без неї непарна
 * лапка їсть не свій рядок, а все до наступної лапки У ФАЙЛІ, і справжні
 * коментарі на цьому проміжку не забілюються зовсім.
 *
 * Обидва твердження нижче червоніють з `if (false)` і зеленіють назад (R-50).
 */
test('охорона переносу рядка: непарна лапка не їсть далі свого рядка', () => {
  const text = [
    "const el = <p>Ім'я</p>;",
    '/* справжній коментар */',
    'const x = 1;',
    '',
  ].join('\n');
  const blanked = blankComments(text).split('\n');
  // Апостроф відкрив «літерал», але охорона обриває його на кінці рядка — тож
  // справжній коментар нижче забілено. Без охорони «літерал» тягнеться далі й
  // коментар лишається недоторканим.
  expect(blanked[1].trim()).toBe('');
  expect(blanked[2]).toBe('const x = 1;');

  // Той самий дефект у ВЕРДИКТІ: без охорони «літерал» від апострофа тягнеться
  // аж до лапки, що відкриває специфікатор, накриваючи собою коментар із
  // крапкою з комою — прохід 2 його не забілює, прохід 1 на ньому спиняється.
  expect(found([
    "const el = <p>Ім'я</p>;",
    'import {',
    '  // порт; див. нижче',
    '  z,',
    `} from '${REF}/dms.js';`,
    '',
  ].join('\n'))).toEqual(['import-from@2']);
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
 * Перший із тестів через підпроцес. Він стереже не поведінку — її стережуть п'ять
 * тестів вище, — а КОНТРАКТ КОДІВ ВИХОДУ: `run.mjs` відрізняє FAILED від UNRUNNABLE
 * рівно за ними, і більше нізвідки цього не дізнається. Решта підпроцесних тестів
 * нижче: вхідна варта й охоплення — обидва про межу ПРОГРАМИ, а не про функції.
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

/**
 * Варта вхідної точки тут правильна ще з попереднього раунду — і досі не була
 * запінена нічим. Саме тому та сама діра спокійно прожила в `run.mjs` і `hash.mjs`:
 * правильну форму бачили очима, а стерегти її не стерегло ніщо.
 *
 * Процес спавниться НАПРЯМУ, без `runCheck`: помічник резолвить шлях до реального за
 * побудовою (`checkPath` → `path.resolve`), тож запуску крізь симлінк виразити не
 * здатен (R-111).
 */
test('запуск крізь симлінк СПРАВДІ біжить — варта вхідної точки (R-22)', () => {
  // Фікстура НАВМИСНО брудна: зламана варта дає нуль байтів виводу і EXIT=0, тож на
  // чистому дереві очікуваний код теж був би 0 і єдиним червоним лишилося б «вивід
  // порожній». З порушенням правильний код — 1, і зламана варта валить три
  // твердження замість одного.
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/lib/bad.ts': `import x from '${REF}/dms.js';\n`,
  });
  const linkDir = mkdtempSync(path.join(tmpdir(), 'sea-radar-check-link-'));
  const link = path.join(linkDir, 'no-ref-imports-link.mjs');
  try {
    const real = checkPath(CHECK);
    symlinkSync(real, link);
    // Несучий рядок: якби шлях запуску збігався з реальним, тест міряв би звичайний
    // запуск і був би зелений із будь-якою вартою.
    expect(link).not.toBe(real);

    const result = spawnSync(process.execPath, [link, root], { encoding: 'utf8' });

    // Node резолвить URL модуля крізь симлінк, а `process.argv[1]` — ні. Пряме
    // порівняння тих двох не кликало б `main()` взагалі: порожній вивід, EXIT=0, і
    // `run.mjs` зробив би з цього PASSED, не прочитавши жодного файлу.
    expect(result.stdout).not.toBe('');
    expect(result.status).toBe(1);
    // І бігло саме по фікстурі, а не просто щось надрукувалося.
    expect(result.stdout).toContain('src/shared/lib/bad.ts:1:');
  } finally {
    removeFixture(linkDir);
    removeFixture(root);
  }
});
