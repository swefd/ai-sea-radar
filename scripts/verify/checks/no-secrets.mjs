// CLAUDE.md, розділ Secrets: «The AISStream key must not reach source, delivered files,
// or the screen — the client checks the handed-over files for it during acceptance».
//
// Периметр — ПЕРЕДАЧА РЕПОЗИТОРІЮ (`git ls-files -c -o --exclude-standard`), не бандл
// браузера: клієнт тут — навчальний центр, і він читає docs/, .claude/, scripts/.
// Невідстежені файли теж скануються: секрет треба спинити ДО коміту, бо після
// потрапляння в історію git його вже не «розпередати» видаленням файлу.
//
// І головне: ця перевірка НІЧОГО зі знайденого не друкує. Звіт — file:line, назва
// шаблону, довжина збігу. Інакше вона порушувала б рівно те правило, яке охороняє.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { listRepoFiles } from '../hash.mjs';

/**
 * ЄДИНЕ виключення периметра (R-14): файли, чиє призначення — містити текст самих
 * шаблонів. Вони дали б самоукус — перевірка знайшла б власні регулярні вирази.
 * Виняток поіменний, перелічений, порахований у підсумку КОЖНОГО прогону (включно
 * з зеленим) і продубльований у blindSpot рядка реєстру: діра, яку видно, — не те
 * саме, що діра, якої немає.
 *
 * ЩО ТУТ БУЛО Й ЧОМУ ЗНИКЛО. Перша редакція виключала ще `package-lock.json`,
 * `skills-lock.json`, `.claude/skills/**` і `.agents/skills/**`, а мотивувала це
 * ПЕРЕДБАЧЕННЯМ: «без цього перевірка червона в перший же день — 62 рядки
 * `integrity`, два `computedHash`, чотири `.png`». Передбачення виміряли, і воно не
 * підтвердилося. Прогін ЦИХ шаблонів по всьому, що кожне виключення ховало:
 *
 *   .claude/skills/     25 файлів (2 бінарні), 6302 рядки  → 0 знахідок
 *   .agents/skills/     25 файлів (2 бінарні), 6302 рядки  → 0 знахідок
 *   package-lock.json    1 файл,               6309 рядків → 0 знахідок
 *   skills-lock.json     1 файл,                 18 рядків → 0 знахідок
 *   SELF_DESCRIBING      2 файли,                384 рядки → 0 знахідок
 *
 * Рядків `"integrity"` там не 62, а 410; `computedHash` — 2. Жоден не спрацьовує й
 * спрацювати НЕ МОЖЕ — з тієї самої причини, яку нижче називає коментар до
 * `PATTERNS`: шаблону «довгий base64» чи «довгий hex» тут немає за задумом, а
 * `integrity` і `computedHash` не є словами-якорями `assigned-secret`. Червоність,
 * якої боялися, не просто відсутня сьогодні — вона недосяжна під цим набором.
 *
 * Виняток, чия користь нуль, — діра, за яку нічого не куплено. Для
 * `package-lock.json` він коштував ще й справжнього позитиву: креденшели приватного
 * реєстру в `resolved` — класичний витік саме через lock-файл, і `url-credentials`
 * їх ловить. Сьогодні там нуль; тримати той нуль ПІД НАГЛЯДОМ і є користь, а
 * виключення знімало нагляд.
 *
 * Чотири `.png` під скілами нікуди не поділися — вони тепер відсіюються `isBinary`,
 * тобто детектором, а не списком, і потрапляють у «пропущено бінарних» підсумку.
 *
 * ПРАВИЛО, яке з цього лишається на майбутнє: виключення обґрунтовує ВИМІРЯНА
 * ненульова користь, ніколи передбачення, що перевірка почервоніє. Кортить щось
 * виключити — спершу виміряй, що воно ховає, і постав число сюди.
 *
 * Сам `SELF_DESCRIBING` теж виміряно: 0 знахідок, тобто сьогодні він інертний.
 * Лишається він не з вимірювання, а зі СТРУКТУРИ — цей файл оголошує шаблони, і
 * шаблон, дописаний трохи ширше, здатен збігтися з власним джерелом.
 *
 * Текст плану (`docs/superpowers/plans/…`) відстежений, тобто лежить у периметрі, і
 * сюди НЕ додається: замість винятку його фікстури зібрані з частин (див. крок 1),
 * тож жоден його рядок не збігається з шаблоном. Виняток коштував би дірки на цілий
 * файл, збірка з частин — нічого.
 */
const SELF_DESCRIBING = [
  'scripts/verify/checks/no-secrets.mjs',
  'tests/unit/no-secrets.spec.ts',
];

function isExcluded(relPath) {
  return SELF_DESCRIBING.includes(relPath);
}

/** Ознаки того, що збіг — плейсхолдер у документації, а не ключ. */
const PLACEHOLDER = /\$\{|<[A-Za-z_]|YOUR[_-]|EXAMPLE|SAMPLE|PLACEHOLDER|CHANGE[_-]?ME|xxxx|…|\.\.\./i;

/**
 * Шаблони. Назва кожного потрапляє у звіт — щоб той, хто читає, знав, що саме шукати
 * у файлі, не отримавши самого рядка.
 *
 * Кожен прив'язаний до КОНТЕКСТУ (R-14): слово-якір (`api_key`, `secret`, `token`,
 * `password`, `aisstream`, `Bearer `), форма URL із креденшелами, або літеральний
 * префікс блоку (`-----BEGIN … PRIVATE KEY-----`, `AKIA`/`ASIA`). Жодного шаблону
 * «довгий base64» чи «довгий hex» тут немає й бути не може: саме вони роблять
 * перевірку червоною на дайджестах, хешах і data-URI, тобто на не-секретах.
 */
const PATTERNS = [
  { name: 'private-key-block', re: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/g },
  { name: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s:@'"]+@/g },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g },
  {
    name: 'assigned-secret',
    re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|auth[_-]?key)\b\s*[:=]\s*['"`]?[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
  },
  // Мотивувальний випадок R2: ключ AISStream, названий у CLAUDE.md поіменно.
  { name: 'aisstream-key', re: /\baisstream\b[^\n]{0,40}?['"`][A-Za-z0-9]{16,}['"`]/gi },
];

/** Бінарь виявляється NUL-байтом, а не розширенням: список розширень старіє, детектор ні. */
function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

/** Повертає лише метадані збігу. Сам збіг не залишає цієї функції — за побудовою. */
export function scanLine(line) {
  const found = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let match = pattern.re.exec(line);
    while (match !== null) {
      if (!PLACEHOLDER.test(match[0])) {
        found.push({ pattern: pattern.name, length: match[0].length });
      }
      match = pattern.re.exec(line);
    }
  }

  return found;
}

/**
 * Чиста функція за R-12: бере корінь, повертає ЛИШЕ метадані — file, line, назву
 * шаблону, довжину збігу — плюс три лічильники. Самого збігу вона не повертає, тож
 * навіть той, хто викличе її з тесту, не зможе випадково надрукувати знайдене.
 */
export function scanForSecrets(root) {
  const findings = [];
  let scanned = 0;
  let binarySkipped = 0;
  let excludedSkipped = 0;

  for (const relPath of listRepoFiles(root)) {
    if (isExcluded(relPath)) {
      excludedSkipped += 1;
      continue;
    }

    const buffer = readFileSync(path.join(root, relPath));
    if (isBinary(buffer)) {
      binarySkipped += 1;
      continue;
    }

    scanned += 1;
    buffer.toString('utf8').split('\n').forEach((line, index) => {
      for (const item of scanLine(line)) {
        findings.push({ file: relPath, line: index + 1, ...item });
      }
    });
  }

  return { findings, scanned, binarySkipped, excludedSkipped };
}

function main() {
  const root = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const { findings, scanned, binarySkipped, excludedSkipped } = scanForSecrets(root);

  for (const item of findings) {
    process.stdout.write(`${item.file}:${item.line}: ${item.pattern} (довжина збігу: ${item.length})\n`);
  }

  // Обидва пропуски названо в підсумку — і на зеленому теж. Пропуск, про який
  // мовчать, читається як «перевірено», а це рівно та підміна, від якої весь шар.
  const skipped = `пропущено бінарних — ${binarySkipped}, поза периметром — ${excludedSkipped}`;

  if (findings.length === 0) {
    process.stdout.write(
      `no-secrets: просканували файлів — ${scanned}, ${skipped}, знахідок немає.\n`,
    );
    process.exit(0);
  }

  const affected = new Set(findings.map((item) => item.file)).size;
  process.stdout.write(
    `no-secrets: знахідок — ${findings.length}, файлів із знахідками — ${affected}, `
    + `${skipped}. Вміст не друкується — відкрийте файл за вказаним рядком.\n`,
  );
  process.exit(1);
}

// R-22. Варта обов'язкова: за R-12 тест імпортує `scanForSecrets` із цього ж файлу,
// і без неї імпорт запускав би `main()` із `process.exit()` посеред тестів.
//
// Обидва боки — крізь realpathSync, і це не обережність про запас. Пряме
// порівняння тут стояло, і діру ВИМІРЯЛИ на цьому файлі: запуск крізь симлінк дав
// нуль байтів виводу і EXIT=0, тобто `run.mjs` зробив би з нього PASSED, не
// просканувавши жодного файлу. Причина в тому, що Node резолвить URL модуля крізь
// симлінк, а `process.argv[1]` лишає як дали. Рядок реєстру має `needs: []` —
// за R-72 біжить неохороненим — і `emptyProbe` в нього немає, тож мовчазне зелене
// нікому було б спіймати. Уперше це виміряли на сусідові (no-ref-imports.mjs:329),
// а тут перевірили заново: та сама конфігурація дала ту саму діру.
//
// Форма скопійована з сусіда СВІДОМО, а не винесена у спільний модуль: два випадки
// ще не патерн, а винесення коштувало б нового модуля з власним .d.mts, зсуву обох
// периметрів (хешу й сканування) і правки файлу завершеної задачі — забагато
// машинерії заради п'яти рядків посеред гілки. Правило трьох: третя перевірка,
// якій знадобиться ця варта, забирає її у спільний модуль разом із цими двома.
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
    process.stderr.write(`no-secrets: перевірка не змогла запуститися: ${error.message}\n`);
    process.exit(2);
  }
}
