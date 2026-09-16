// Стереже правило з CLAUDE.md і reference/CLAUDE.md: «Never `import` from
// `../reference/...`, in app code or tests, at runtime or at type level».
// Записане тричі, не стережене нічим — саме той «documented-but-unenforced»
// інваріант, заради якого спека §4 завела три власні рядки.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listRepoFiles } from '../hash.mjs';

/**
 * Теки, чий код узагалі може щось імпортувати.
 * `src/` — усі шари FSD (_app, _pages, shared); після переїзду на FSD тут дев'ять
 * із одинадцяти файлів застосунку, і без цього префікса перевірка їх не бачить.
 * `app/` — тонкий вхід Next.js App Router, теж справжній код.
 * `scripts/` і `.claude/hooks/` ширші за букву спеки («файл застосунку чи тестів»):
 * скрипт перевірки, що імпортує з reference/, зіпсував би передачу так само.
 */
const SCAN_PREFIXES = ['src/', 'app/', 'tests/', 'scripts/', '.claude/hooks/'];

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
  { name: 'import-from', re: new RegExp(String.raw`\bimport\b[^;\n]*?\bfrom\s*` + SPECIFIER, 'g') },
  { name: 'export-from', re: new RegExp(String.raw`\bexport\b[^;\n]*?\bfrom\s*` + SPECIFIER, 'g') },
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

export function scanText(relPath, text) {
  const violations = [];

  text.split('\n').forEach((line, index) => {
    for (const form of FORMS) {
      // Виміряно, а не припущено: жоден тест цього рядка не спростовує (R-50).
      // Регулярки з /g живуть на рівні модуля, тобто переживають і рядки, і
      // виклики, — але внутрішній цикл завжди вичерпує рядок до `null`, а `exec`
      // на `null` сам обнуляє `lastIndex`. Рядок лишається як страховка рівно від
      // одного майбутнього ходу: `break` усередині циклу (скажімо, «досить
      // першого порушення на рядок») зробив би стан протічним, і тоді сканер
      // мовчки пропускав би порушення в наступному файлі.
      form.re.lastIndex = 0;
      let match = form.re.exec(line);
      while (match !== null) {
        if (pointsAtReference(match[2])) {
          violations.push({ file: relPath, line: index + 1, form: form.name, specifier: match[2] });
        }
        match = form.re.exec(line);
      }
    }
  });

  return violations;
}

/**
 * Чиста функція за R-12: бере корінь, повертає перевірені файли й порушення.
 * Нічого не друкує й нічим не виходить. Тести імпортують саме її й запускають на
 * фікстурі в `os.tmpdir()` — не через підпроцес: фікстура-літерал у відстеженому
 * `.spec.ts` зробила б цю ж перевірку червоною на власному тесті.
 */
export function scanForRefImports(root) {
  const files = listRepoFiles(root).filter(
    (relPath) => SCAN_PREFIXES.some((prefix) => relPath.startsWith(prefix))
      && SCAN_EXTENSIONS.includes(path.extname(relPath)),
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
if (import.meta.filename === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`no-ref-imports: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
