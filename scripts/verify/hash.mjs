// Свіжість рахується за ВМІСТОМ. Не за mtime (ламається від git checkout,
// touch і розпакування архіву) і не за «git status чистий» (закомічений хід
// лишає чисте дерево, тобто видав би зелене вже зламаному коду).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from './entry-point.mjs';

/** Теки, вміст яких годує перевірки. */
export const SOURCE_PREFIXES = [
  // Увесь код застосунку — тут: репозиторій перейшов на Feature-Sliced Design,
  // і в app/ лишився тонкий вхід App Router. Без 'src/' хеш не змінювався б
  // від жодної правки застосунку, і --reuse-if-fresh передруковував би старе
  // зелене крізь реальний злам.
  'src/',
  'app/',
  'tests/',
  // 'scripts/', а не 'scripts/verify/': периметр хешу не має бути вужчим за
  // периметр сканування no-ref-imports.
  'scripts/',
  // Зміна хука змінює поведінку перевірки — кеш має протухати й від неї.
  '.claude/hooks/',
];

/** Окремі файли, що визначають, ЯК саме виконуються перевірки. */
export const SOURCE_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.ts',
  'eslint.config.mjs',
  'playwright.config.ts',
  // Вирішує, ЯКИМ Node виконано кожну перевірку.
  '.nvmrc',
  // Вмикає й вимикає хуки, тобто вирішує, чи перевірка взагалі запускається.
  '.claude/settings.json',
];

/**
 * Третій вимір периметра: розширення, які перевірки читають ЗВІДУСІЛЬ, а не
 * лише з перелічених вище тек.
 *
 * Префіксного списку було не досить, і це виміряно двічі, а не передбачено:
 *
 *   кореневий `probe-gate-hole.ts` зі справжньою TS2322 →
 *     `tsc -p tsconfig.json --noEmit` EXIT=2, а
 *     `run.mjs --tier fast --reuse-if-fresh` → `reused: true`, EXIT=0;
 *   кореневий `probe-lint-hole.mjs` із синтаксичною помилкою →
 *     `eslint .` EXIT=1, а той самий гейт → `reused: true`, EXIT=0.
 *
 * Обидва рази гейт відтворював протухле зелене поверх дерева, яке перевірку не
 * проходить: рівно той провал, заради запобігання якому існує весь шар.
 * Кореневі `middleware.ts`, `instrumentation.ts`, `postcss.config.mjs` — не
 * гіпотеза, а звичайні файли Next.
 *
 * Периметр свіжості не має права бути вужчим за те, що насправді читають рядки
 * реєстру (R-158). Тут — об'єднання двох таких периметрів: `include` у
 * tsconfig бере кожен `.ts`/`.tsx` у дереві, а `eslint .` — кожен файл із
 * цього переліку поза своїми ігнорами. Самі глоби сюди не виписані навмисно:
 * їхня закривна послідовність обірвала б цей коментар посеред речення.
 *
 * Ширше за строго необхідне — свідомо: зайве протухання коштує одного зайвого
 * прогону, а вузьке — зеленого вердикту про неперевірений код.
 */
export const SOURCE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
];

/** Дзеркало `exclude` у tsconfig.json — і рівно воно, без додатків. */
export const NON_SOURCE_PREFIXES = ['node_modules/', 'reference/'];

// U+FFFD REPLACEMENT CHARACTER — зібраний із коду, а не вписаний літерою:
// сам символ у джерелі виглядає як збите кодування, тобто як рівно та
// поломка, яку він і ловить, і будь-яке перезбереження файлу зіпсувало б його
// мовчки.
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

export function isSourcePath(relPath) {
  // Виключення — перші: те, чого tsc не читає, не змінює його вердикту.
  if (NON_SOURCE_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
  return SOURCE_PREFIXES.some((prefix) => relPath.startsWith(prefix))
    || SOURCE_FILES.includes(relPath)
    || SOURCE_EXTENSIONS.includes(path.extname(relPath));
}

/**
 * Усі файли, що входять у передачу: відстежені (-c) плюс невідстежені, але не
 * ігноровані (-o --exclude-standard). Саме це отримає клієнт із `git clone`, і саме
 * це сканують перевірки шару. Запит до git живе тут в однині: перевірка, яка питала б
 * git самостійно, могла б розійтися з ключем свіжості в питанні «які файли існують».
 */
export function listRepoFiles(root) {
  // -c: відстежувані, -o: невідстежувані, --exclude-standard: поважати .gitignore.
  // -z дає рівно одне: шляхи з пробілами, лапками чи переводами рядка
  // переживають розбиття цілими — без нього git їх лапкує й екранує, і
  // розділити вивід назад на справжні імена вже неможливо.
  // stdio задано явно: без нього stderr git'а протікає в батьківський процес,
  // а з задачі 3 це вивід самого шару перевірки.
  const raw = execFileSync(
    'git',
    ['ls-files', '-c', '-o', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Під час конфлікту `-c` віддає по рядку на кожну стадію того самого шляху,
  // тож без Set файл хешувався б кілька разів, fileCount роздувався б, а
  // no-ref-imports читав би той самий файл двічі й рахував порушення подвійно.
  return [...new Set(raw.split('\0').filter((relPath) => relPath !== ''))].sort();
}

export function listSourceFiles(root) {
  const selected = listRepoFiles(root).filter(isSourcePath);

  // Шлях із невалідним UTF-8 декодується в U+FFFD, далі readFileSync дає
  // ENOENT, і файл тихо стає `<missing>` — тобто хеш мовчки бреше. У цьому
  // репозиторії таких імен немає; якщо колись з'являться, краще впасти
  // голосно, ніж повернути правдоподібний хеш (R-50).
  //
  // Вартовий стоїть ПІСЛЯ фільтра, і це не деталь: шлях, якого ми не хешуємо,
  // не може зробити дайджест брехливим, тож відхиляти його — не наша справа.
  // Інакше один зіпсований байт в імені файлу під docs/ валив би sourceHash, а
  // з ним і всі перевірки, які до того файлу не мають стосунку — вартовий,
  // ширший за те, що він захищає, сам стає відмовою (R-53).
  //
  // Звуження безпечне: кожен префікс у SOURCE_PREFIXES — ASCII, а зіпсовані
  // байти живуть у частині з іменем, тож `src/<мотлох>.tsx` усе одно збігається
  // з 'src/' і все одно ловиться.
  for (const relPath of selected) {
    if (relPath.includes(REPLACEMENT_CHARACTER)) {
      throw new Error(
        `listSourceFiles: шлях не є валідним UTF-8 і декодувався з втратою: ${relPath}`,
      );
    }
  }

  return selected;
}

export function sourceHash(root) {
  const files = listSourceFiles(root);
  const digest = createHash('sha256');

  for (const relPath of files) {
    digest.update(relPath);
    digest.update('\0');
    let contents;
    try {
      contents = readFileSync(path.join(root, relPath));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // R-05. Файл зник між переліком і читанням. Сентинел стоїть на місці
      // довжини, а не на місці вмісту: файл, який реально містить рядок
      // `<missing>`, має власну byteLength і тому дає інший потік.
      digest.update('<missing>');
      digest.update('\0');
      continue;
    }
    // R-05: потік — `path \0 byteLength \0 content`. Довжина перед вмістом
    // обов'язкова: без неї два різні розбиття тих самих байтів між двома
    // файлами дали б однаковий хеш.
    digest.update(String(contents.byteLength));
    digest.update('\0');
    digest.update(contents);
  }

  return { hash: digest.digest('hex'), fileCount: files.length, files };
}

// CLI: без нього питання «чому моє зелене перевикористалось» не має відповіді.
//
// R-22. Варта обов'язкова, а не косметична: `tests/unit/hash.spec.ts` імпортує звідси
// і обидва списки периметра, і всі експортовані функції, і без неї імпорт рахував би
// хеш і друкував його посеред тестового процесу. Числа імен тут немає з тієї ж
// причини, що й у `run.mjs`: воно зсувається від правки спеки, а перевірити його
// звідси нічим. Форма — у `entry-point.mjs`: пряме порівняння з `process.argv[1]` стояло
// тут і під симлінком не кликало цей блок взагалі (виміряно).
if (isEntryPoint(import.meta.filename)) {
  const result = sourceHash(process.cwd());
  process.stdout.write(`${result.hash}  (${result.fileCount} файлів)\n`);
  if (process.argv.includes('--files')) {
    for (const relPath of result.files) process.stdout.write(`  ${relPath}\n`);
  }
}
