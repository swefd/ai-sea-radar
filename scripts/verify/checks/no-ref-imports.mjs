// Стереже правило з CLAUDE.md і reference/CLAUDE.md: «Never `import` from
// `../reference/...`, in app code or tests, at runtime or at type level».
// Записане тричі, не стережене нічим — саме той «documented-but-unenforced»
// інваріант, заради якого спека §4 завела три власні рядки.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { isSourcePath, listRepoFiles } from '../hash.mjs';

/**
 * Периметр сканування — це периметр свіжості з `hash.mjs`, звужений за розширенням.
 * Власного списку тек тут немає навмисно. Доки списки були два, вони збігалися лише
 * домовленістю, і три кореневі конфіги — `next.config.ts`, `playwright.config.ts`,
 * `eslint.config.mjs` — у периметр хеша входили, а в периметр сканування ні:
 * імпорт із reference/ у `next.config.ts` давав «порушень немає» й EXIT=0
 * (виміряно). Тепер це один і той самий `isSourcePath`, тож розійтися вони більше
 * не можуть, а звуження лишається одне, назване й записане нижче — розширення файлу.
 */
const SCAN_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  // @import у CSS так само вміє вказати за межі проєкту.
  '.css',
];

/** Літеральний специфікатор у лапках будь-якого з трьох видів. */
const SPECIFIER = String.raw`(['"\`])([^'"\`\n]*)\1`;

/**
 * Сім статичних форм. Обчислений шлях сюди не потрапляє за визначенням —
 * це записано в blindSpot рядка реєстру й не лікується тут.
 *
 * `import … from` і `export … from` розділені на два імені навмисно, а не злиті
 * в одне `(?:import|export)`. Ім'я форми потрапляє у вивід перевірки, і рядок
 * `bad.ts:2: import-from →` на реекспорті називав би не ту конструкцію. Ціна
 * злиття видно й у тесті: шість різних синтаксичних форм давали б лише п'ять
 * різних імен, тож твердження «кожна форма спіймана СВОЇМ матчером» стало б
 * недоказовним.
 */
const FORMS = [
  // `[^;]*?`, а не `[^;\n]*?`: крапка з комою лишається бар'єром, а перенос рядка
  // перестає ним бути. Інакше інструкція з `import {` на одному рядку і `} from '…'`
  // на іншому не збігається з жодною формою — а це панівне форматування тут.
  { name: 'import-from', re: new RegExp(String.raw`\bimport\b[^;]*?\bfrom\s*` + SPECIFIER, 'g') },
  { name: 'export-from', re: new RegExp(String.raw`\bexport\b[^;]*?\bfrom\s*` + SPECIFIER, 'g') },
  { name: 'import-bare', re: new RegExp(String.raw`\bimport\s+` + SPECIFIER, 'g') },
  { name: 'import-dynamic', re: new RegExp(String.raw`\bimport\s*\(\s*` + SPECIFIER, 'g') },
  { name: 'require', re: new RegExp(String.raw`\brequire\s*\(\s*` + SPECIFIER, 'g') },
  { name: 'triple-slash', re: new RegExp(String.raw`///\s*<reference\s+[^>\n]*?path\s*=\s*` + SPECIFIER, 'g') },
  { name: 'css-import', re: new RegExp(String.raw`@import\s+(?:url\(\s*)?` + SPECIFIER, 'g') },
];

/**
 * Прив'язка до СЕГМЕНТА шляху, не до підрядка. Інакше перевірка спрацювала б на
 * `.claude/skills/feature-sliced-design/references/…` — тека `references`, у множині,
 * і жодного стосунку до study material не має.
 */
function pointsAtReference(specifier) {
  return specifier.replace(/\\/g, '/').split('/').includes('reference');
}

/**
 * Зіставляє форми на ЦІЛОМУ тексті файлу, а не порядково. Порядкове зіставлення
 * пропускало панівне тут форматування — ключове слово й `from` на різних рядках, —
 * тобто віддавало «порушень немає» й EXIT=0 на справжньому порушенні, а `run.mjs`
 * робив із цього PASSED (виміряно на справжньому дереві).
 */
export function scanText(relPath, text) {
  const violations = [];
  // Одне порушення вміє збігтися з кількома формами: голий `@import '…'` у .css
  // ловиться і як import-bare, і як css-import, а `export` без крапки з комою вміє
  // дотягнутися до `from` нижчого справжнього імпорту. Ключ — трійка
  // file+line+specifier (файл тут один), а порядок зовнішнього циклу лишає ПЕРШЕ
  // ім'я в порядку FORMS: воно найточніше описує конструкцію.
  const seen = new Set();

  for (const form of FORMS) {
    // Виміряно, а не припущено: жоден тест цього рядка не спростовує (R-50).
    // Регулярки з /g живуть на рівні модуля, тобто переживають і файли, і
    // виклики, — але внутрішній цикл завжди вичерпує текст до `null`, а `exec`
    // на `null` сам обнуляє `lastIndex`. Рядок лишається як страховка рівно від
    // одного майбутнього ходу: `break` усередині циклу (скажімо, «досить
    // першого порушення на файл») зробив би стан протічним, і тоді сканер
    // мовчки пропускав би порушення в наступному файлі.
    form.re.lastIndex = 0;
    let match = form.re.exec(text);
    while (match !== null) {
      const specifier = match[2];
      if (pointsAtReference(specifier)) {
        // Рядок КЛЮЧОВОГО СЛОВА, а не рядок специфікатора: у багаторядковій формі
        // людині треба початок інструкції, і для однорядкових це те саме число.
        const line = text.slice(0, match.index).split('\n').length;
        // Роздільник — пробіл, і цього досить: `line` завжди цифри, тож перший
        // пробіл у ключі завжди той самий, скільки б їх не було в специфікаторі.
        const key = `${line} ${specifier}`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({ file: relPath, line, form: form.name, specifier });
        }
      }
      match = form.re.exec(text);
    }
  }

  // Зовнішній цикл тепер по формах, тож без сортування вивід ішов би групами форм,
  // а не згори вниз по файлу. Сортування стабільне — усередині рядка лишається
  // порядок FORMS, тобто те саме перше ім'я, що вибрала дедуплікація.
  return violations.sort((a, b) => a.line - b.line);
}

/**
 * Чиста функція за R-12: бере корінь, повертає перевірені файли й порушення.
 * Нічого не друкує й нічим не виходить. Тести імпортують саме її й запускають на
 * фікстурі в `os.tmpdir()` — не через підпроцес: фікстура-літерал у відстеженому
 * `.spec.ts` зробила б цю ж перевірку червоною на власному тесті.
 */
export function scanForRefImports(root) {
  const files = listRepoFiles(root).filter(
    (relPath) => isSourcePath(relPath) && SCAN_EXTENSIONS.includes(path.extname(relPath)),
  );

  const violations = [];
  for (const relPath of files) {
    violations.push(...scanText(relPath, readFileSync(path.join(root, relPath), 'utf8')));
  }

  return { files, violations };
}

function main() {
  const root = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const { files, violations } = scanForRefImports(root);

  for (const item of violations) {
    process.stdout.write(`${item.file}:${item.line}: ${item.form} → ${item.specifier}\n`);
  }

  if (violations.length === 0) {
    process.stdout.write(`no-ref-imports: перевірено файлів — ${files.length}, порушень немає.\n`);
    process.exit(0);
  }

  const affected = new Set(violations.map((item) => item.file)).size;
  process.stdout.write(
    `no-ref-imports: порушень — ${violations.length}, файлів із порушеннями — ${affected}.\n`,
  );
  process.exit(1);
}

// Коментарі й рядки не вирізаються навмисно: перебір безпечний, недобір — ні.
// Закоментований import із reference/ усе одно вартий того, щоб його побачили.
//
// Вхідна варта (R-22) тут обов'язкова, а не косметична: за R-12 тести імпортують
// `scanForRefImports` із цього ж файлу, і без варти імпорт запускав би `main()`
// із `process.exit()` посеред тестового процесу.
//
// Обидва боки — крізь realpathSync. URL модуля Node резолвить крізь симлінк,
// `process.argv[1]` — ні, тож пряме порівняння під симлінком не кликало `main()`
// взагалі: нуль байтів виводу, EXIT=0, і `run.mjs` робив із цього PASSED
// (виміряно). Рядок реєстру має `needs: []`, тобто за R-72 біжить неохороненим,
// і `emptyProbe` в нього немає — мовчазне зелене нікому було б спіймати.
function isEntryPoint() {
  const invoked = process.argv[1];
  // Не задано — значить, файл не запускали: `node --eval`, REPL, імпорт із тесту.
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === realpathSync(import.meta.filename);
  } catch {
    // Шляху не існує (видалили між стартом і цим рядком) — це не запуск нас.
    return false;
  }
}

if (isEntryPoint()) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`no-ref-imports: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
