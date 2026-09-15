// Свіжість рахується за ВМІСТОМ. Не за mtime (ламається від git checkout,
// touch і розпакування архіву) і не за «git status чистий» (закомічений хід
// лишає чисте дерево, тобто видав би зелене вже зламаному коду).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

// U+FFFD REPLACEMENT CHARACTER — зібраний із коду, а не вписаний літерою:
// сам символ у джерелі виглядає як збите кодування, тобто як рівно та
// поломка, яку він і ловить, і будь-яке перезбереження файлу зіпсувало б його
// мовчки.
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

export function isSourcePath(relPath) {
  return SOURCE_PREFIXES.some((prefix) => relPath.startsWith(prefix))
    || SOURCE_FILES.includes(relPath);
}

export function listSourceFiles(root) {
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

  const entries = raw.split('\0');

  // Шлях із невалідним UTF-8 декодується в U+FFFD, далі readFileSync дає
  // ENOENT, і файл тихо стає `<missing>` — тобто хеш мовчки бреше. У цьому
  // репозиторії таких імен немає; якщо колись з'являться, краще впасти
  // голосно, ніж повернути правдоподібний хеш (R-50).
  for (const relPath of entries) {
    if (relPath.includes(REPLACEMENT_CHARACTER)) {
      throw new Error(
        `listSourceFiles: шлях не є валідним UTF-8 і декодувався з втратою: ${relPath}`,
      );
    }
  }

  // Під час конфлікту `-c` віддає по рядку на кожну стадію того самого шляху,
  // тож без Set файл хешувався б кілька разів, а fileCount роздувався б.
  return [
    ...new Set(
      entries.filter((relPath) => relPath !== '' && isSourcePath(relPath)),
    ),
  ].sort();
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
if (import.meta.filename === process.argv[1]) {
  const result = sourceHash(process.cwd());
  process.stdout.write(`${result.hash}  (${result.fileCount} файлів)\n`);
  if (process.argv.includes('--files')) {
    for (const relPath of result.files) process.stdout.write(`  ${relPath}\n`);
  }
}
