import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { scanForSecrets } from '../../scripts/verify/checks/no-secrets.mjs';
import {
  checkPath,
  makeFixtureRepo,
  removeFixture,
  runCheck,
  writeFixtureFiles,
} from './support/check-fixtures';

const CHECK = 'no-secrets.mjs';

/**
 * Синтетичний рядок форми AWS access key id: збігається з шаблоном, секретом не є.
 * Складений із частин навмисно — цілого літерала немає у файлі, тож навіть випадковий
 * grep по тестах нічого схожого на ключ не знайде. Довжина рівно 20.
 */
const SYNTHETIC = ['AKIA', 'N'.repeat(8), 'OTREAL00'].join('');

/**
 * Синтетичний URL із креденшелами. Зібраний із семи частин так, що жодного
 * фрагмента форми «схема://користувач:пароль@» у цьому файлі немає — ні цілим
 * рядком, ні в двох сусідніх. Це вимога R-13 і водночас умова того, що сам цей
 * файл (він відстежений, тобто в периметрі) лишається чистим.
 */
// Набивка — `q`, а НЕ `x`: `PLACEHOLDER` містить `xxxx`, тож `'x'.repeat(24)`
// відкидався б як плейсхолдер і тест «креденшели в URL ловляться» падав би на
// нулі знахідок. Виміряно контролером до диспетчу (R-104).
const SYNTHETIC_URL = ['https', '://', 'ci', ':', 'q'.repeat(24), '@', 'registry.example/next.tgz'].join('');

const CLEAN_FILES: Record<string, string> = {
  '.gitignore': '.env*\n',
  'package.json': '{"name":"t"}\n',
  'src/shared/config/map.ts': 'export const INITIAL_VIEW = { zoom: 10 };\n',
  'docs/tasks/SPRINT-01.md': '# Спринт\n',
};

test('чистий репозиторій проходить, і периметр не порожній', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    const { findings, scanned } = scanForSecrets(root);
    expect(findings).toEqual([]);
    // Нуль просканованих — це не «чисто», це зламаний периметр.
    expect(scanned).toBeGreaterThan(0);
  } finally {
    removeFixture(root);
  }
});

test('знаходить ключ, називає file:line і шаблон — і не повертає збігу', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
  });
  try {
    const { findings } = scanForSecrets(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      file: 'src/shared/config/keys.ts',
      line: 1,
      pattern: 'aws-access-key-id',
      length: 20,
    });
    // Тип знахідки не має поля зі збігом — і об'єкт теж. Сам збіг не існує
    // за межами scanLine, тож надрукувати його нема звідки.
    expect(JSON.stringify(findings)).not.toContain(SYNTHETIC);
  } finally {
    removeFixture(root);
  }
});

test('CLI НЕ друкує знайденого — ні цілком, ні частиною', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
  });
  try {
    const result = runCheck(CHECK, root);

    // Знайшла, і сказала де і що саме за шаблоном.
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('src/shared/config/keys.ts:1: aws-access-key-id');
    expect(result.stdout).toContain('довжина збігу: 20');

    // І — головне твердження цього тесту — не переказала знайденого.
    expect(result.stdout).not.toContain(SYNTHETIC);
    expect(result.stderr).not.toContain(SYNTHETIC);
    // «Навіть частково»: жодне восьмисимвольне вікно збігу не витекло.
    for (let i = 0; i + 8 <= SYNTHETIC.length; i += 1) {
      expect(result.stdout).not.toContain(SYNTHETIC.slice(i, i + 8));
    }
  } finally {
    removeFixture(root);
  }
});

test('відпускає після відкоту', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, {
      'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
    });
    expect(scanForSecrets(root).findings).toHaveLength(1);

    rmSync(path.join(root, 'src/shared/config/keys.ts'));
    expect(scanForSecrets(root).findings).toEqual([]);
  } finally {
    removeFixture(root);
  }
});

test('плейсхолдер у чужій документації — не знахідка', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    // Обидві фікстури СПРАЦЬОВУЮТЬ за шаблоном і відкидаються саме маркером
    // плейсхолдера. Це умова того, що тест щось доводить: рядок, який не збігається
    // з жодним шаблоном, лишався б зеленим і з порожнім PLACEHOLDER.
    // Форма взята з .claude/skills/shadcn/mcp.md; значення замінене на явний
    // плейсхолдер, бо `Bearer ${...}` шаблон bearer-token не ловить: `$` і `{`
    // поза його класом символів.
    //
    // Шлях фікстури — `docs/context/`, а НЕ `.claude/skills/`, і сьогодні він
    // правильний двічі. Коли `.claude/skills/**` було виключено периметром, рядок
    // звідти не читався б узагалі й тест був би зелений ВІД ВИКЛЮЧЕННЯ, а не від
    // `PLACEHOLDER` — саме та підміна, заради лову якої існує цей шар (R-105).
    // Виключення відтоді виміряли й скасували, тож обидва шляхи тепер читаються, —
    // а фікстура лишається тут рівно тому, що так вона не залежить від жодного
    // виключення ні сьогодні, ні після наступної зміни периметра.
    'docs/context/mcp.md':
      '"headers": { "Authorization": "Bearer YOUR_TOKEN_HERE_0123456789" }\n',
    // `AISSTREAM_API_KEY=` теж не збігається: `\b` перед `API` не спрацьовує після
    // підкреслення. Тому тут форма, яку assigned-secret справді бачить.
    'docs/context/setup.md': 'api_key = "EXAMPLE0123456789abcdef"\n',
  });
  try {
    expect(scanForSecrets(root).findings).toEqual([]);
  } finally {
    removeFixture(root);
  }
});

test('поза периметром — РІВНО два файли, що оголошують шаблони; lock-файл сканується (R-14)', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    // Усередині кожного — синтетичний ключ. БЕЗ виключення він дав би знахідку,
    // тож зелене доводить саме виключення, а не те, що фікстура нічого не містить.
    'scripts/verify/checks/no-secrets.mjs': `const probe = '${SYNTHETIC}';\n`,
    'tests/unit/no-secrets.spec.ts': `const probe = '${SYNTHETIC}';\n`,
    // А lock-файл — У периметрі, і цей рядок стереже саме те, що він там лишився.
    // Виключення lock-файлів було виміряне й скасоване: воно ховало 0 знахідок і
    // коштувало справжнього позитиву — креденшели приватного реєстру в `resolved`
    // є класичним витоком саме через lock. Поверне його хтось назад — тут почервоніє.
    'package-lock.json':
      `{"packages":{"node_modules/x":{"resolved":"${SYNTHETIC_URL}"}}}\n`,
  });
  try {
    const { findings, excludedSkipped } = scanForSecrets(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('package-lock.json');
    expect(findings[0]?.pattern).toBe('url-credentials');
    // Пропуск порахований і потрапляє в підсумок. Тихе виключення читалося б як
    // «перевірено», і саме тоді діра перестає бути видимою.
    expect(excludedSkipped).toBe(2);
  } finally {
    removeFixture(root);
  }
});

test('креденшели в URL ловляться там, де файл у периметрі', () => {
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'docs/context/deploy.md': `npm pack ${SYNTHETIC_URL}\n`,
  });
  try {
    const { findings } = scanForSecrets(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('docs/context/deploy.md');
    expect(findings[0]?.pattern).toBe('url-credentials');
  } finally {
    removeFixture(root);
  }
});

test('бінарний файл пропускається — і пропуск видимий у підсумку', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, {
      // NUL-байт тут записаний ЕСКЕЙПОМ, не сирим байтом. Сирий 0x00 у тексті плану
      // невидимий в рев'ю, губиться при копіюванні і робить сам файл плану бінарним
      // для git. Він обов'язковий по суті: isBinary шукає саме NUL, а не розширення —
      // без нього файл сканується, синтетичний ключ знаходиться, вихід 1, і падають
      // обидва твердження нижче.
      'assets/logo.png': `\x89PNG\r\n\x1a\n\0${SYNTHETIC}`,
    });
    const result = runCheck(CHECK, root);
    // Пропуск — не «пройшло». Він названий у підсумку, бо це діра, а не зелене.
    expect(result.stdout).toContain('пропущено бінарних — 1');
    expect(result.code).toBe(0);
  } finally {
    removeFixture(root);
  }
});

test('запуск крізь симлінк СПРАВДІ біжить — варта вхідної точки (R-22)', () => {
  // Фікстура НАВМИСНО брудна. Зламана варта дає нуль байтів виводу і EXIT=0 —
  // тобто на чистій фікстурі очікуваний код теж 0, і єдиним червоним лишилося б
  // «вивід порожній». З підкинутим ключем правильний код — 1, тож зламана варта
  // валить і код, і вивід, і рядок знахідки. Тест, який ледве червоніє, тут
  // вартий менше за ніщо: саме мовчазне PASSED і є та поломка, яку він стереже.
  const root = makeFixtureRepo({
    ...CLEAN_FILES,
    'src/shared/config/keys.ts': `export const key = '${SYNTHETIC}';\n`,
  });
  const linkDir = mkdtempSync(path.join(tmpdir(), 'sea-radar-check-link-'));
  const link = path.join(linkDir, 'no-secrets-link.mjs');
  try {
    const real = checkPath(CHECK);
    symlinkSync(real, link);
    // Несучий рядок: якби шлях запуску збігався з реальним, тест міряв би
    // звичайний запуск і був би зелений з будь-якою вартою. На macOS tmpdir іще
    // й лежить за симлінком (/var → /private/var) — про це саме кажуть
    // run.spec.ts:206 і report.spec.ts:189, — але тут різницю створює сам лінк.
    expect(link).not.toBe(real);

    const result = spawnSync(process.execPath, [link, root], { encoding: 'utf8' });

    // Node резолвить URL модуля крізь симлінк, а process.argv[1] — ні. Пряме
    // порівняння тих двох не кликало б main() взагалі: порожній вивід, EXIT=0,
    // і `run.mjs` зробив би з нього PASSED, не просканувавши жодного файлу.
    expect(result.stdout).not.toBe('');
    expect(result.status).toBe(1);
    // І біг саме по фікстурі, а не просто щось надрукував.
    expect(result.stdout).toContain('src/shared/config/keys.ts:1: aws-access-key-id');
    // Правило звіту діє й тут: знайдене не друкується.
    expect(result.stdout).not.toContain(SYNTHETIC);
  } finally {
    removeFixture(linkDir);
    removeFixture(root);
  }
});

test('ігнорований файл не сканується — периметр це передача, не диск', () => {
  const root = makeFixtureRepo(CLEAN_FILES);
  try {
    writeFixtureFiles(root, { '.env.local': `AISSTREAM_API_KEY=${SYNTHETIC}\n` });
    // .env* у .gitignore фікстури: файл не передається, отже поза периметром.
    // Це записано в blindSpot рядка реєстру — межа, а не пропуск.
    expect(runCheck(CHECK, root).code).toBe(0);
  } finally {
    removeFixture(root);
  }
});
