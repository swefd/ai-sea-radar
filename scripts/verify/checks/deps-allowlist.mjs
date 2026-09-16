// Критерій B-01 — «зайвих залежностей немає»; критерій B-07 — «інших тестових
// фреймворків немає». Обидва — речення в `docs/tasks/SPRINT-01.md`, і до цієї
// перевірки жодна команда шару їх не читала: `npm install` про них не знає.
//
// Ця перевірка не сканує дерева — вона читає ОДИН файл. Через це вся її вартість
// сидить не в обході, а в тому, щоб не сказати «зелено» про файл, якого вона не
// прочитала або не зрозуміла; див. `readManifest` і варти в `checkManifest`.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from '../entry-point.mjs';

/**
 * Узгоджений набір. Джерела — критерій B-01 (`docs/tasks/SPRINT-01.md`) і §8 спеки
 * шару, яка свідомо додала до нього інструменти самої перевірки. Скільки рядків
 * припадає на кожне джерело, тут НЕ виписано: цей поділ нічого не вирішує, зате
 * розійшовся б із літералом на першому ж перенесенні пакета між ними.
 *
 * Версії ТОЧНІ, бо пакети поставлені з `--save-exact`, а CLAUDE.md каже: «Every
 * agreed value below lives in one config location». Allowlist лише з іменами
 * пропустив би дрейф мажорної версії: пакет із тим самим іменем і вдвічі старшим
 * номером проходив би як узгоджений, і жоден інший рядок реєстру цього не бачить.
 *
 * Оновлювати цей літерал і `package.json` належить ОДНИМ комітом. Розбіжність між
 * ними — це і є те, що перевірка ловить; вона не знає, який із двох боків правий,
 * і не вдає, що знає.
 */
export const ALLOWED = {
  dependencies: {
    leaflet: '1.9.4',
    next: '16.3.5',
    react: '19.3.0',
    'react-dom': '19.3.0',
  },
  devDependencies: {
    '@playwright/test': '1.63.0',
    '@types/leaflet': '1.9.22',
    '@types/node': '24.13.4',
    '@types/react': '19.3.0',
    eslint: '9.39.5',
    'eslint-config-next': '16.3.5',
    typescript: '6.0.3',
  },
};

const KNOWN_BLOCKS = Object.keys(ALLOWED);

/**
 * Дозволені ключі ВЕРХНЬОГО рівня. Усе інше в `package.json` — розбіжність.
 *
 * Тут стояв денилист блоків (`peerDependencies`, `overrides`, `resolutions`, …), і
 * він був неправильною формою правила. Виміряно на a11cc12, на копії справжнього
 * маніфесту: `workspaces: ["packages/*"]` → EXIT=0, `pnpm: { overrides: … }` →
 * EXIT=0, `bun: { overrides: … }` → EXIT=0. Три маршрути повз перевірку, і список
 * не закінчувався: вкладені поля інструментів (`npm`, `pnpm`, `yarn`, `bun`, і які
 * ще з'являться) ніхто не перелічить до кінця. Денилист не вміє сказати, чого в
 * ньому бракує, — тому наступний маршрут лишався б НЕВИДИМИМ.
 *
 * Allowlist може: незнайомий ключ провалює перевірку, навіть якщо про нього ніхто
 * не думав. Ціна — цей літерал треба оновлювати разом із `package.json`, рівно як
 * і `ALLOWED`; це та сама ціна, і платиться вона свідомо.
 *
 * Звірка тут ОДНОБІЧНА, на відміну від `ALLOWED`: питається лише «чи немає зайвого
 * ключа», не «чи всі на місці». Асиметрія принципова — ВІДСУТНІЙ ключ не може
 * завести залежність, а присутній незнайомий може.
 */
const ALLOWED_TOP_LEVEL = [
  'name',
  'version',
  'private',
  'scripts',
  'dependencies',
  'devDependencies',
];

/**
 * Denylist НЕ заміняє allowlist і не додає до нього НІ ОДНОГО спійманого пакета:
 * усе, що він перелічує, вже провалюється як «немає в узгодженому наборі». Це
 * структурно, а не випадково — `deniedRule` читається ЛИШЕ всередині гілки «пакета
 * немає в ALLOWED», — але спирається на передумову: списки не перетинаються.
 *
 * Пришпилено двома тестами, і кожен стереже своє. «перетин ALLOWED і DENIED порожній»
 * стереже саму ПЕРЕДУМОВУ: поки перетин порожній, пріоритет на справжньому наборі не
 * спостережний — його розворот не червонив ЖОДНОГО тесту (виміряно на 0438273:
 * 115 passed / 0 failed). «колізія ALLOWED×DENIED» вносить перетин усередині тесту й
 * знімає його у `finally`: під тим самим розворотом червоніє рівно він і тільки він
 * (виміряно тут же: 115 passed / 1 failed). Без другого гілку пріоритету можна було
 * переписати як завгодно, і жоден рядок сюїти не заперечив би.
 *
 * Число, з анкером, бо воно проживе рівно до наступної правки цього літерала:
 * виміряно на a11cc12 — усі 29 імен і скоупів звідси дають рівно одну розбіжність
 * і з `DENIED`, і з порожнім `DENIED`; назву правила при цьому несуть 29
 * повідомлень проти 0.
 *
 * Тобто його єдина робота — назвати зламане правило замість безликого «невідомий
 * пакет»: повідомлення, що називає причину, лагодять, а не глушать. Він слабший за
 * allowlist за побудовою — ловить лише передбачене, — і саме тому стоїть після нього,
 * а не замість.
 */
const DENIED = [
  {
    rule: 'другий тестовий раннер',
    why: 'SPRINT-01 B-07: «інших тестових фреймворків немає»',
    names: ['vitest', 'jest', 'mocha', 'jasmine', 'ava', 'tap', 'uvu', 'karma', 'cypress'],
    scopes: ['@vitest/', '@jest/', '@testing-library/'],
  },
  {
    rule: 'друга бібліотека карт',
    why: 'SPRINT-01, Частина Б — «друга бібліотека карт» відхиляється на огляді плану',
    names: ['mapbox-gl', 'maplibre-gl', 'ol', 'react-leaflet', 'cesium', 'deck.gl'],
    scopes: ['@react-leaflet/', '@googlemaps/'],
  },
  {
    rule: 'підготовка до R2',
    why: 'CLAUDE.md: «not geodesy, not ws, not @aisstream/aisstream». Реальні дані AIS — пізніший реліз',
    names: ['geodesy', 'ws'],
    scopes: ['@aisstream/'],
  },
  {
    rule: 'спокуса з reference/',
    why: 'CLAUDE.md: «React Query, Zustand, Tailwind, MSW, Vitest and Storybook appear in these repos; none of them is thereby permitted»',
    names: ['zustand', 'msw', 'storybook', 'tailwindcss'],
    scopes: ['@tanstack/', '@storybook/'],
  },
];

/**
 * `typeof null === 'object'`, а масив — теж об'єкт. Обидва приходять із `JSON.parse`
 * як валідний JSON, і обидва без цієї функції давали б `TypeError` або розбір рядка
 * по літерах замість речення про те, що саме не так.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Що саме дісталося замість об'єкта — у повідомленні, бо «не об'єкт» само по собі не
 * лагодять. Назви українською всі, а не лише дві: «(масив)» поруч із «(number)» в
 * одному реченні — це не дрібниця стилю, а слід від того, що перелік дописували не
 * думаючи, і читач справедливо питає, чи так само дописували правила.
 */
function describeShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'масив';
  const NAMES = { string: 'рядок', number: 'число', boolean: 'булеве', undefined: 'undefined' };
  return NAMES[typeof value] ?? typeof value;
}

/**
 * Правило денилиста, зламане цим іменем, або `undefined`. Експортується заради тесту
 * на порожній перетин з `ALLOWED` — див. коментар над `DENIED`.
 */
export function deniedRule(name) {
  return DENIED.find(
    (entry) => entry.names.includes(name) || entry.scopes.some((scope) => name.startsWith(scope)),
  );
}

// `Object.hasOwn`, а не `!== undefined`, у КОЖНОМУ зверненні до словника пакетів нижче
// — без винятків і без переліку, бо перелік тут нічого не додає, зате гниє: імена пакетів
// приходять із чужого JSON, а `{"constructor": "1.0.0"}` інакше знаходив собі
// «узгоджену версію» в Object.prototype. Мовчазного зеленого це не давало — рядок
// був розбіжністю, — але текст виходив нечитабельний («узгоджено function Object()
// { [native code] }»), а `allowedBlockOf` на таких іменах просто брехав.
function allowedVersionOf(block, name) {
  return Object.hasOwn(ALLOWED[block], name) ? ALLOWED[block][name] : undefined;
}

function allowedBlockOf(name) {
  return KNOWN_BLOCKS.find((block) => Object.hasOwn(ALLOWED[block], name));
}

/**
 * Список розбіжностей маніфесту з узгодженим набором. Порожній список означає згоду.
 *
 * Параметр оголошено як `unknown` (див. сайдкар), і це не перестраховка: вхід
 * приходить із `JSON.parse`, тобто типом не є нічим. Варти нижче перехоплюють те,
 * що інакше впало б стеком, і кажуть це РЯДКОМ — стек у stderr читається як
 * поламана перевірка, а не як поламаний вхід.
 *
 * @param {unknown} manifest
 * @returns {string[]}
 */
export function checkManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return [`маніфест не є об'єктом (${describeShape(manifest)}) — звіряти нема з чим`];
  }

  const problems = [];

  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_TOP_LEVEL.includes(key)) {
      problems.push(
        `ключ "${key}" не дозволений на верхньому рівні: звіряються лише `
        + `${KNOWN_BLOCKS.join(" і ")}, тож залежності, заведені через будь-який інший `
        + 'ключ, ця перевірка не побачить',
      );
    }
  }

  const present = (name) => KNOWN_BLOCKS.some((block) => {
    const actual = manifest[block];
    return isPlainObject(actual) && Object.hasOwn(actual, name);
  });

  for (const block of KNOWN_BLOCKS) {
    // Блока немає зовсім — це `{}`, тобто випадок «усі узгоджені зникли», і про нього
    // говорить друга половина звірки нижче. `?? {}` тут не годиться: він зрівняв би з
    // відсутністю ще й `"dependencies": null`, тобто проковтнув би саме ту форму, від
    // якої стоїть варта наступним рядком.
    const raw = manifest[block];
    const actual = raw === undefined ? {} : raw;

    // Блок є, але не словник пакетів. Далі не йдемо НАВМИСНО: «leaflet зникла» тут
    // було б здогадкою — з `"dependencies": null` не видно, є вона там чи немає.
    // Один рядок про блок чесніший за жменю рядків про пакети, яких ніхто не бачив.
    if (!isPlainObject(actual)) {
      problems.push(`${block}: блок не є об'єктом (${describeShape(actual)}) — вміст не читається`);
      continue;
    }

    for (const [name, version] of Object.entries(actual)) {
      const expected = allowedVersionOf(block, name);

      // Тут і тільки тут визначено пріоритет: allowlist питається ПЕРШИМ, денилист
      // отримує слово, лише коли пакета в `ALLOWED` немає. На справжньому наборі цей
      // порядок не спостережний — перетин списків порожній; спостережним його робить
      // тест, який вносить перетин навмисно. Обидва — див. коментар над `DENIED`.
      if (expected === undefined) {
        const home = allowedBlockOf(name);
        const rule = deniedRule(name);
        if (home !== undefined) {
          problems.push(`${block}.${name}: узгоджено в "${home}", не в "${block}"`);
        } else if (rule !== undefined) {
          problems.push(`${block}.${name}: ${rule.rule} — ${rule.why}`);
        } else {
          problems.push(`${block}.${name}: немає в узгодженому наборі`);
        }
        continue;
      }

      if (version !== expected) {
        problems.push(`${block}.${name}: версія ${version}, узгоджено ${expected}`);
      }
    }

    // Друга половина звірки, і саме вона робить червоним `package.json` узагалі без
    // залежностей: такий файл справді не має ЗАЙВОГО, тож перша половина мовчала б.
    // `present` гасить дубль, коли пакет не зник, а переїхав у сусідній блок —
    // про переїзд уже сказано рядком вище.
    for (const name of Object.keys(ALLOWED[block])) {
      if (!Object.hasOwn(actual, name) && !present(name)) {
        problems.push(`${block}.${name}: узгоджена залежність зникла з package.json`);
      }
    }
  }

  return problems;
}

/**
 * Прочитати й упізнати `package.json`. Три способи не впізнати його розділені, бо
 * розділені й підказки: немає файлу — не той корінь; не парситься — правте синтаксис;
 * не об'єкт — файл валідний як JSON і при цьому не маніфест.
 *
 * @returns {{ ok: true, manifest: Record<string, unknown> } | { ok: false, reason: string }}
 */
function readManifest(root) {
  const file = path.join(root, 'package.json');

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { ok: false, reason: `${file} не читається: ${error.code ?? error.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `${file} не є валідним JSON: ${error.message}` };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      reason: `${file} — валідний JSON, але не є об'єктом (${describeShape(parsed)})`,
    };
  }

  return { ok: true, manifest: parsed };
}

function main() {
  const root = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const read = readManifest(root);

  // R-113 у варіанті для одного файлу: замість «оглянуто файлів — 0» тут «маніфест
  // не прочитано». Наслідок той самий і саме той, від якого весь шар, — інакше
  // перевірка звітувала б «усі в узгодженому наборі» про файл, якого не бачила.
  // Досяжно звичайним аргументом кореня: `deps-allowlist.mjs docs` — і це не
  // гіпотеза, а те, як `no-secrets.mjs` уже одного разу зеленів.
  //
  // Код 2, не 1, і не тому, що 2 суворіше. 1 каже «package.json розійшовся з
  // набором — правте одне з двох», і для зламаного файлу ця порада неправдива.
  // `classifyExit` у `run.mjs` мапить 1 і 2 в FAILED однаково (власні гілки там
  // мають 127 і 126), тож блокує воно так само; різниця видна тому, хто дивиться
  // на голий код виходу. Прецедент — та сама межа в `no-secrets.mjs`.
  if (!read.ok) {
    process.stderr.write(
      `deps-allowlist: ${read.reason}. Перевірка нічого не прочитала й тому нічого не довела.\n`,
    );
    process.exit(2);
  }

  const problems = checkManifest(read.manifest);

  for (const problem of problems) {
    process.stdout.write(`package.json: ${problem}\n`);
  }

  if (problems.length === 0) {
    const total = KNOWN_BLOCKS.reduce((sum, block) => sum + Object.keys(ALLOWED[block]).length, 0);
    process.stdout.write(`deps-allowlist: залежностей — ${total}, усі в узгодженому наборі.\n`);
    process.exit(0);
  }

  process.stdout.write(
    `deps-allowlist: розбіжностей — ${problems.length}. Кожна виправляється або в `
    + `package.json, або свідомим оновленням ALLOWED у цьому файлі — не обома «про всяк випадок».\n`,
  );
  process.exit(1);
}

// R-22. Варта обов'язкова: за R-12 тест імпортує `ALLOWED` і `checkManifest` із цього ж
// файлу, і без неї імпорт запускав би `main()` із `process.exit()` посеред тестів. Форма
// — у `entry-point.mjs`, туди ж винесено вимір, який пояснює, чому наївне порівняння
// рядків тут не годиться. Ціна помилки саме тут вища за середню: рядок реєстру має
// `needs: []` — за R-72 біжить неохороненим — і `emptyProbe` в нього немає.
if (isEntryPoint(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`deps-allowlist: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
