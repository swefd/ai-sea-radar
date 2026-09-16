import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, statSync, utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import {
  SOURCE_PREFIXES,
  SOURCE_FILES,
  SOURCE_EXTENSIONS,
  NON_SOURCE_PREFIXES,
  isSourcePath,
  listRepoFiles,
  listSourceFiles,
  sourceHash,
} from '../../scripts/verify/hash.mjs';

/** Порожній git-репозиторій у тимчасовій теці — єдине місце, де він створюється. */
function makeEmptyRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-hash-'));
  // `init.defaultBranch` задано явно: `init -q` не глушить пораду про гілку
  // за замовчуванням, тож без цього вивід тестів залежав би від глобального
  // ~/.gitconfig машини, на якій їх запустили.
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root });
  return root;
}

/** Справжній git-репозиторій у тимчасовій теці: git-інтеграція — саме те, що ламається. */
function makeRepo(): string {
  const root = makeEmptyRepo();
  mkdirSync(path.join(root, 'app'), { recursive: true });
  writeFileSync(path.join(root, 'app/page.tsx'), 'export default function P() { return null; }\n');
  // Дев'ять з одинадцяти файлів застосунку живуть під src/ після переходу на FSD.
  // Без цього рядка всі тести нижче зелені й зі зламаним SOURCE_PREFIXES.
  mkdirSync(path.join(root, 'src/_pages/home/ui'), { recursive: true });
  writeFileSync(path.join(root, 'src/_pages/home/ui/home-page.tsx'), 'export function HomePage() { return null; }\n');
  writeFileSync(path.join(root, 'package.json'), '{"name":"t"}\n');
  writeFileSync(path.join(root, '.gitignore'), 'secret.txt\n');
  writeFileSync(path.join(root, 'secret.txt'), 'ignored\n');
  writeFileSync(path.join(root, 'README.md'), '# not source\n');
  return root;
}

test('isSourcePath приймає префікси та точні імена, відкидає решту', () => {
  expect(isSourcePath('app/page.tsx')).toBe(true);
  // Головний код застосунку — під src/. Якби цього рядка не було, дефект
  // SOURCE_PREFIXES пройшов би повз усі п'ять тестів.
  expect(isSourcePath('src/_pages/home/ui/home-page.tsx')).toBe(true);
  expect(isSourcePath('scripts/verify/run.mjs')).toBe(true);
  expect(isSourcePath('.claude/hooks/node.sh')).toBe(true);
  expect(isSourcePath('tsconfig.json')).toBe(true);
  // Мажор Node вирішує, ЯКИМ інтерпретатором виконано кожну перевірку;
  // settings.json вмикає й вимикає хуки. Обидва змінюють висновок перевірки.
  expect(isSourcePath('.nvmrc')).toBe(true);
  expect(isSourcePath('.claude/settings.json')).toBe(true);
  // Решта периметра, раніше не закріплена жодним рядком. Кожне з цих чотирьох
  // імен вирішує, ЯК виконується решта перевірок: package-lock.json — які
  // версії інструментів, next.config.ts — як збирається застосунок,
  // eslint.config.mjs — що взагалі вважається помилкою лінту,
  // playwright.config.ts — які проєкти й чи піднімається сервер. Зміна
  // будь-якого з них мусить протухлювати закешоване зелене, інакше воно
  // перевикористається для інструментів, якими його не отримували (R-47).
  expect(isSourcePath('tests/unit/hash.spec.ts')).toBe(true);
  expect(isSourcePath('package-lock.json')).toBe(true);
  expect(isSourcePath('next.config.ts')).toBe(true);
  expect(isSourcePath('eslint.config.mjs')).toBe(true);
  expect(isSourcePath('playwright.config.ts')).toBe(true);
  expect(isSourcePath('README.md')).toBe(false);
  expect(isSourcePath('docs/tasks/SPRINT-01.md')).toBe(false);
});

test('периметр — рішення, а не випадковість: обидва списки закріплено поіменно', () => {
  // Порівняння за точним складом, не `toContain`. Будь-яке додавання чи
  // видалення робить тест червоним — і це задумано: периметр вирішує, чи
  // можна перевикористати зелений результат, тож він міняється свідомо й
  // під рев'ю, а не тихо. Якщо майбутня задача справді розширює периметр,
  // вона редагує цей рядок разом із hash.mjs.
  expect([...SOURCE_PREFIXES].sort()).toEqual(
    ['src/', 'app/', 'tests/', 'scripts/', '.claude/hooks/'].sort(),
  );
  expect([...SOURCE_FILES].sort()).toEqual(
    [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'next.config.ts',
      'eslint.config.mjs',
      'playwright.config.ts',
      '.nvmrc',
      '.claude/settings.json',
    ].sort(),
  );

  // Третій вимір периметра, доданий у раунді 1 задачі 9 (R-158), і закріплений
  // так само поіменно: перелік префіксів не покривав того, що насправді
  // перевіряють рядки `typecheck` і `lint` реєстру. tsc бере кожен .ts/.tsx у
  // дереві, ESLint — кожне розширення з цього переліку; тож кореневий
  // middleware.ts і кореневий postcss.config.mjs перевірялись і НЕ входили в хеш.
  expect([...SOURCE_EXTENSIONS].sort()).toEqual(
    ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].sort(),
  );
  expect([...NON_SOURCE_PREFIXES].sort()).toEqual(['node_modules/', 'reference/'].sort());
});

test('периметр покриває те, що перевіряє tsc: кореневий .ts входить у хеш', () => {
  // Виміряний наслідок вужчого периметра: з таким файлом у корені
  // `run.mjs --tier fast --reuse-if-fresh` віддавав `reused: true` і EXIT=0,
  // поки `tsc -p tsconfig.json --noEmit` друкував TS2322. Гейт відтворював
  // протухле зелене поверх дерева, яке не проходить тайпчек.
  expect(isSourcePath('middleware.ts')).toBe(true);
  expect(isSourcePath('instrumentation.ts')).toBe(true);
  expect(isSourcePath('docs/example.tsx')).toBe(true);
  // Той самий провал виміряно й для рядка `lint`: кореневий .mjs із
  // синтаксичною помилкою давав `eslint .` EXIT=1 і `reused: true` водночас.
  expect(isSourcePath('postcss.config.mjs')).toBe(true);
  // Виключення дзеркалять `exclude` у tsconfig.json — і тільки їх.
  expect(isSourcePath('node_modules/leaflet/index.d.ts')).toBe(false);
  expect(isSourcePath('reference/geodesy/latlon.ts')).toBe(false);
  // Не-TypeScript поза префіксами як не входив, так і не входить: розширення
  // периметра рівно до того, що читає tsc, і ані на файл більше.
  expect(isSourcePath('docs/tasks/SPRINT-01.md')).toBe(false);
  expect(isSourcePath('README.md')).toBe(false);
});

test('кореневий .ts змінює хеш — інакше гейт відтворює зелене поверх зламаного', () => {
  const root = makeRepo();
  try {
    const before = sourceHash(root).hash;
    // Рівно той файл, яким відтворювався провал гейта.
    writeFileSync(path.join(root, 'probe-gate-hole.ts'), 'export const x: number = "ні";\n');
    expect(sourceHash(root).hash).not.toBe(before);
    expect(sourceHash(root).files).toContain('probe-gate-hole.ts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listSourceFiles бере джерельні файли, ігнорує gitignored і не-джерельні', () => {
  const root = makeRepo();
  try {
    expect(listSourceFiles(root)).toEqual([
      'app/page.tsx',
      'package.json',
      'src/_pages/home/ui/home-page.tsx',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listRepoFiles віддає весь периметр передачі, а не лише джерела', () => {
  const root = makeRepo();
  try {
    const all = listRepoFiles(root);
    // Ширше за listSourceFiles: README.md — переданий файл, але не джерело.
    expect(all).toContain('README.md');
    expect(all).toContain('app/page.tsx');
    // .gitignore поважається: ігноровані файли не передаються й тут не з'являються.
    expect(all).not.toContain('secret.txt');
    // listSourceFiles — це фільтр над тим самим переліком, не другий запит до git.
    expect(listSourceFiles(root)).toEqual(all.filter(isSourcePath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sourceHash стабільний між викликами без змін', () => {
  const root = makeRepo();
  try {
    expect(sourceHash(root).hash).toBe(sourceHash(root).hash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sourceHash змінюється від зміни вмісту, а не від дотику до файлу', () => {
  const root = makeRepo();
  try {
    const before = sourceHash(root).hash;
    const target = path.join(root, 'app/page.tsx');
    const mtimeBefore = statSync(target).mtimeMs;

    // Той самий вміст, новий mtime: хеш мусить лишитися тим самим.
    writeFileSync(target, 'export default function P() { return null; }\n');
    // Явний, детермінований mtime — не «сподіваюся, запис потрапив в іншу
    // секунду». Без цього рядка тест на ФС із грубою гранулярністю зеленіє
    // і проти хеша за mtime, тобто перестає перевіряти саме те, заради чого
    // написаний (R-50).
    utimesSync(target, 1_700_000_000, 1_700_000_000);
    expect(statSync(target).mtimeMs).not.toBe(mtimeBefore);

    expect(sourceHash(root).hash).toBe(before);

    // Інший вміст: хеш мусить змінитися.
    writeFileSync(path.join(root, 'app/page.tsx'), 'export default function P() { return 1; }\n');
    expect(sourceHash(root).hash).not.toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('закомічені зміни не роблять хеш «чистим» — важить вміст, не стан дерева', () => {
  const root = makeRepo();
  try {
    const dirty = sourceHash(root).hash;
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c'], { cwd: root });
    expect(sourceHash(root).hash).toBe(dirty);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('довжина перед вмістом: два різні розбиття тих самих байтів дають різні хеші', () => {
  // Без поля довжини обидва репозиторії дали б той самий потік:
  //   `app/a.tsx\0` + `app/b.tsx\0X`   проти   `app/a.tsx\0` + `` + `app/b.tsx\0` + `X`
  // Саме тому довжина стоїть перед вмістом, а не для краси (R-05).
  const one = makeEmptyRepo();
  const two = makeEmptyRepo();
  try {
    mkdirSync(path.join(one, 'app'), { recursive: true });
    writeFileSync(path.join(one, 'app/a.tsx'), Buffer.from('app/b.tsx\0X', 'utf8'));

    mkdirSync(path.join(two, 'app'), { recursive: true });
    writeFileSync(path.join(two, 'app/a.tsx'), '');
    writeFileSync(path.join(two, 'app/b.tsx'), 'X');

    expect(sourceHash(one).hash).not.toBe(sourceHash(two).hash);
  } finally {
    rmSync(one, { recursive: true, force: true });
    rmSync(two, { recursive: true, force: true });
  }
});

test('зниклий відстежуваний файл не збігається з файлом, що містить «<missing>»', () => {
  const gone = makeEmptyRepo();
  const literal = makeEmptyRepo();
  try {
    for (const root of [gone, literal]) {
      mkdirSync(path.join(root, 'app'), { recursive: true });
      writeFileSync(path.join(root, 'app/a.tsx'), '<missing>');
      execFileSync('git', ['add', '-A'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c'],
        { cwd: root },
      );
    }
    // У `gone` файл лишається відстежуваним, але зникає з диска.
    rmSync(path.join(gone, 'app/a.tsx'));

    // Без цього рядка тест зеленів би й тоді, коли git не перелічує зниклий
    // файл: `gone` мав би нуль файлів проти одного, хеші різнилися б і так, а
    // гілка сентинела не виконалася б жодного разу (R-54).
    expect(sourceHash(gone).fileCount).toBe(1);

    expect(sourceHash(gone).hash).not.toBe(sourceHash(literal).hash);
  } finally {
    rmSync(gone, { recursive: true, force: true });
    rmSync(literal, { recursive: true, force: true });
  }
});

// Процес спавниться НАПРЯМУ, без спільного помічника: помічник резолвить шлях до
// реального за побудовою, тож запуску крізь симлінк виразити не здатен (R-111).
test('CLI крізь симлінк СПРАВДІ біжить — варта вхідної точки (R-22)', () => {
  const root = makeRepo();
  const linkDir = mkdtempSync(path.join(tmpdir(), 'sea-radar-hash-link-'));
  const link = path.join(linkDir, 'hash-link.mjs');
  try {
    const real = path.resolve(process.cwd(), 'scripts/verify/hash.mjs');
    // Немає скрипта — тест мусить сказати саме це, а не видати відсутність файлу
    // за зламану варту.
    expect(existsSync(real)).toBe(true);
    symlinkSync(real, link);
    // Несучий рядок: якби шлях запуску збігався з реальним, тест міряв би
    // звичайний запуск і був би зелений із будь-якою вартою.
    expect(link).not.toBe(real);

    const result = spawnSync(process.execPath, [link, '--files'], { cwd: root, encoding: 'utf8' });

    // Код виходу тут не розрізняє НІЧОГО: CLI хешу завжди виходить нулем, і зламана
    // варта дає той самий нуль. Тому несуть твердження про ЗМІСТ виводу — саме та
    // друга половина вимоги, без якої тест був би зелений із будь-якою вартою.
    const { hash, fileCount, files } = sourceHash(root);
    expect(result.stdout).not.toBe('');
    expect(result.stdout).toContain(hash);
    expect(result.stdout).toContain(`(${fileCount} файлів)`);
    // І бігло саме по фікстурі: `--files` називає її файли поіменно.
    expect(files.length).toBeGreaterThan(0);
    for (const relPath of files) expect(result.stdout).toContain(relPath);
  } finally {
    rmSync(linkDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
