import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const NODE_SH = path.join(ROOT, '.claude/hooks/node.sh');

/**
 * Копія скрипта у тимчасовому дереві зі СВОЇМ `.nvmrc` (`null` — файлу немає
 * зовсім). Справжній `.nvmrc` не чіпається — він вхід хешу свіжості (задача 2),
 * і підміна зробила б дерево несвіжим, а перервана підміна лишила б у
 * репозиторії чуже число.
 */
function makeProbeTree(nvmrc: string | null): { probeRoot: string; probeSh: string } {
  const probeRoot = mkdtempSync(path.join(tmpdir(), 'sea-radar-nodesh-'));
  mkdirSync(path.join(probeRoot, '.claude/hooks'), { recursive: true });
  const probeSh = path.join(probeRoot, '.claude/hooks/node.sh');
  copyFileSync(NODE_SH, probeSh);
  chmodSync(probeSh, 0o755);
  if (nvmrc !== null) writeFileSync(path.join(probeRoot, '.nvmrc'), nvmrc);
  return { probeRoot, probeSh };
}

/**
 * Підроблене дерево nvm: `<NVM_DIR>/versions/node/<version>/bin/node` із заданим
 * вмістом і бітом виконання. Так перевіряється, чи вірить резолвер НАЗВІ теки
 * замість самого бінарника.
 */
function makeFakeNvm(version: string, body: string): { nvmDir: string } {
  const nvmDir = mkdtempSync(path.join(tmpdir(), 'sea-radar-fakenvm-'));
  const binDir = path.join(nvmDir, 'versions/node', version, 'bin');
  mkdirSync(binDir, { recursive: true });
  const fakeNode = path.join(binDir, 'node');
  writeFileSync(fakeNode, body);
  chmodSync(fakeNode, 0o755);
  return { nvmDir };
}

test('node.sh запускає скрипт саме на мажорі з .nvmrc', () => {
  const result = spawnSync(NODE_SH, ['-e', 'process.stdout.write(process.versions.node)'], {
    encoding: 'utf8',
    input: '{}',
  });
  expect(result.status).toBe(0);
  expect(result.stdout.split('.')[0]).toBe('24');
});

test('node.sh не з’їдає stdin — payload доходить до скрипта', () => {
  const payload = '{"hook_event_name":"Stop","stop_hook_active":false}';
  const result = spawnSync(
    NODE_SH,
    ['-e', 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>process.stdout.write(s))'],
    { encoding: 'utf8', input: payload },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(payload);
});

// `NODE_ENV` у зрізаних середовищах нижче — вимога ТИПУ, а не резолву: Next
// доповнює `ProcessEnv` обов'язковим `NODE_ENV` (`next/types/global.d.ts`), тож
// без нього `spawnSync` не збирається під `check-types`. Сам node.sh цієї змінної
// не читає — зрізаним лишається саме те, від чого залежить пошук: PATH, HOME, NVM_DIR.
test('ворожий PATH не ламає резолв: node все одно знаходиться', () => {
  const result = spawnSync(NODE_SH, ['-e', 'process.stdout.write("ok")'], {
    encoding: 'utf8',
    input: '{}',
    env: {
      PATH: '/nonexistent',
      HOME: process.env.HOME ?? '',
      NVM_DIR: process.env.NVM_DIR ?? '',
      NODE_ENV: process.env.NODE_ENV,
    },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('ok');
});

test('node.sh: придатного Node немає ніде — systemMessage у stdout, вихід 0, ніколи тиха невдача', () => {
  // Ворожого PATH тут НЕ досить: гілка типових системних розташувань пробує
  // /opt/homebrew/bin/node та /usr/local/bin/node за абсолютним шляхом, і PATH
  // на неї не впливає. Якби на машині стояв Homebrew-Node потрібного мажора,
  // тест зеленів би, нічого не довівши.
  // Тому скрипт копіюється у тимчасове дерево з .nvmrc = 99: мажора 99 не існує ніде,
  // тож жодна з гілок резолву не може випадково «врятувати» тест.
  const { probeRoot, probeSh } = makeProbeTree('99\n');
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
      env: {
        PATH: '/nonexistent',
        HOME: '/nonexistent',
        NVM_DIR: '/nonexistent',
        NODE_ENV: process.env.NODE_ENV,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('ok'); // скрипт НЕ запустився на чужому мажорі
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('systemMessage');
    const message = String((parsed as { systemMessage: string }).systemMessage);
    expect(message).toContain('НЕ виконувалась');
    expect(message).toContain('99'); // мажор прочитано з .nvmrc, а не зашито у скрипт
    // Голосно означає видимо: повідомлення дублюється і в stderr.
    expect(result.stderr.trim()).not.toBe('');
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('виклик без аргументів — теж голосна відмова, не мовчазний вихід', () => {
  const result = spawnSync(NODE_SH, [], { encoding: 'utf8', input: '{}' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('systemMessage');
});

test('node.sh: у скрипті немає зовнішніх утиліт — самі вбудовані', () => {
  // Коментарі відкидаються: у шапці утиліти названі саме як заборонені.
  const body = readFileSync(NODE_SH, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  // Підрядок із пробілами (' dirname ') обходиться тривіально: $(dirname "$x"),
  // `dirname` на початку рядка, табуляція. Тому — межі слова, не пробіли.
  //
  // `/` НЕ належить до класу дозволеного попереднього символу, і це несуче:
  // поки він там був, виклик за абсолютним шляхом (`/bin/ls`) лишав тест зеленим,
  // тобто варта стерегла одну форму з трьох (R-150). Тепер від слова його
  // відділяє будь-що, крім символу слова, крапки й дефіса, а завершує — пробіл,
  // кінець рядка або роздільник команди.
  //
  // Закривна зворотна лапка — теж термінатор: без неї форма без аргументу
  // (BACKTICK + ls + BACKTICK) прослизала, бо після слова не було ні пробілу,
  // ні кінця рядка (R-154). Сам символ підставляється змінною: у `String.raw`
  // його довелося б екранувати, і в рядок потрапив би ще й зворотний слеш.
  const BACKTICK = '`';
  for (const forbidden of [
    'dirname', 'basename', 'sed', 'ls', 'cat', 'grep', 'awk',
    'readlink', 'expr', 'tr', 'head', 'tail', 'which', 'find', 'xargs', 'env',
  ]) {
    expect(body, `зовнішня утиліта ${forbidden}`)
      .not.toMatch(new RegExp(String.raw`(^|[^\w.-])${forbidden}(\s|$|[;|&)<>${BACKTICK}])`, 'm'));
  }
});

test('PATH дособирається, а не затирається: каталог знайденого node — першим, node_modules/.bin — на місці', () => {
  // Друга половина контракту «Produces»: задачі 9–11 запускають крізь цей резолвер
  // інструменти з node_modules/.bin, і мовчазна втрата будь-якої зі складових
  // PATH проявилася б там як UNRUNNABLE із неправильної причини.
  // Маркер у вхідному PATH ловить найправдоподібнішу помилку — привласнення
  // замість дописування, після якого хук лишився б без усього, що там було.
  // Запуск із ЧУЖОЇ теки обов'язковий: коли cwd збігається з коренем checkout,
  // складові «від $PWD» і «від каталогу скрипта» дають однаковий рядок, і втрату
  // будь-якої з них не видно. Тут вони різні, тож перевіряються обидві.
  const elsewhere = realpathSync(mkdtempSync(path.join(tmpdir(), 'sea-radar-nodesh-cwd-')));
  try {
    const result = spawnSync(
      NODE_SH,
      ['-e', 'process.stdout.write(process.execPath + "\\n" + (process.env.PATH ?? ""))'],
      {
        encoding: 'utf8',
        input: '{}',
        cwd: elsewhere,
        env: {
          PATH: '/nonexistent-marker',
          HOME: process.env.HOME ?? '',
          NVM_DIR: process.env.NVM_DIR ?? '',
          NODE_ENV: process.env.NODE_ENV,
        },
      },
    );
    expect(result.status).toBe(0);
    const [execPath, pathLine] = result.stdout.split('\n');
    const entries = (pathLine ?? '').split(':');
    expect(entries[0]).toBe(path.dirname(String(execPath)));
    expect(entries).toContain(path.join(elsewhere, 'node_modules/.bin'));
    expect(entries).toContain(path.join(ROOT, 'node_modules/.bin'));
    expect(entries).toContain('/nonexistent-marker');
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('.nvmrc у формі v99.1.2 — префікс і мінор відкидаються, лишається мажор 99', () => {
  // Дискримінатор: якби скрипт не зрізав `v` і мінор, рядок не був би числом —
  // і замість «не знайдено Node major 99» прийшла б відмова «не розібрано».
  // Тобто тест відрізняє ПРОЧИТАНИЙ мажор від невпізнаного файлу, а не просто
  // «якось відмовило». Середовище навмисно не зрізане: у зрізаному відмова
  // прийшла б і так, і ділити було б нічого.
  const { probeRoot, probeSh } = makeProbeTree('v99.1.2\n');
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('ok');
    expect(result.stdout).toContain('major 99');
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('усі три форми виклику бачать те саме дерево: абсолютна, ./ і гола відносна', () => {
  // `${var%/*}` лишає рядок без змін, коли '/' у ньому вже немає, тож гола
  // відносна форма зупиняла зріз на `.claude`, читала `.nvmrc` не там — і мовчки
  // бігла іншою версією, ніж дві інші форми. Жоден тест так не викликав.
  // Порівнюється саме ВЕСЬ stdout: повідомлення відмови не містить шляхів
  // (подробиця йде лише в stderr), тож три форми мусять дати рядок у рядок те саме.
  const { probeRoot, probeSh } = makeProbeTree('99\n');
  try {
    const forms = [probeSh, './.claude/hooks/node.sh', '.claude/hooks/node.sh'];
    const outputs = forms.map((form) => {
      const result = spawnSync(form, ['-e', 'process.stdout.write("ok")'], {
        encoding: 'utf8',
        input: '{}',
        cwd: probeRoot,
      });
      expect(result.status, form).toBe(0);
      expect(result.stdout, form).not.toContain('ok');
      return result.stdout;
    });
    expect(outputs[0]).toContain('major 99');
    expect(outputs[1], './.claude/hooks/node.sh').toBe(outputs[0]);
    expect(outputs[2], '.claude/hooks/node.sh').toBe(outputs[0]);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('гола відносна форма не кладе в PATH неіснуючий .claude/node_modules/.bin', () => {
  // Побічний наслідок того самого зрізу: у PATH лягав каталог, якого не існує,
  // і вести він міг куди завгодно, бо запис відносний.
  const major = process.versions.node.split('.')[0] ?? '';
  const { probeRoot } = makeProbeTree(`${major}\n`);
  try {
    const result = spawnSync(
      '.claude/hooks/node.sh',
      ['-e', 'process.stdout.write(process.env.PATH ?? "")'],
      {
        encoding: 'utf8',
        input: '{}',
        cwd: probeRoot,
        // Маркер замість успадкованого PATH обов'язковий: у справжньому PATH цієї
        // машини є теки під `~/.claude`, і перевірка на підрядок ловила б їх.
        env: {
          PATH: '/nonexistent-marker',
          HOME: process.env.HOME ?? '',
          NVM_DIR: process.env.NVM_DIR ?? '',
          NODE_ENV: process.env.NODE_ENV,
        },
      },
    );
    expect(result.status).toBe(0);
    const entries = result.stdout.split(':');
    expect(entries.filter((entry) => entry.includes('.claude'))).toEqual([]);
    expect(entries).toContain('/nonexistent-marker');
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('тека v98.* із чужим мажором не виконується: назві теки не вірять', () => {
  // Гілка nvm — єдина, що мала шанс повірити імені каталогу. Мажор 98 у .nvmrc
  // робить вимір детермінованим: справжнього node 98 немає ніде, тож урятувати
  // тест може лише підробка, і саме її не можна пускати.
  const { nvmDir } = makeFakeNvm(
    'v98.0.0',
    '#!/bin/sh\nif [ "$1" = "-v" ]; then printf "v22.0.0\\n"; exit 0; fi\nprintf "WRONG-MAJOR-RAN\\n"\n',
  );
  const { probeRoot, probeSh } = makeProbeTree('98\n');
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
      env: { PATH: '/nonexistent', HOME: '/nonexistent', NVM_DIR: nvmDir, NODE_ENV: process.env.NODE_ENV },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('WRONG-MAJOR-RAN');
    expect(result.stdout).toContain('major 98');
  } finally {
    rmSync(nvmDir, { recursive: true, force: true });
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('виконуваний не-бінарник у теці nvm дає systemMessage, а не тихий вихід 127', () => {
  // Єдиний виміряний пролом у контракті «тихого ненульового виходу не існує»:
  // `exec` на файлі з неіснуючим інтерпретатором завершує оболонку кодом 127,
  // і в stdout не лишається нічого — для того, хто читає вивід хука, це
  // невідрізнимо від «перевірка мовчки пройшла».
  const { nvmDir } = makeFakeNvm('v98.0.0', '#!/nonexistent/interpreter\n');
  const { probeRoot, probeSh } = makeProbeTree('98\n');
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
      env: { PATH: '/nonexistent', HOME: '/nonexistent', NVM_DIR: nvmDir, NODE_ENV: process.env.NODE_ENV },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('systemMessage');
    expect(result.stdout).toContain('major 98');
    expect(result.stderr.trim()).not.toBe('');
  } finally {
    rmSync(nvmDir, { recursive: true, force: true });
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('.nvmrc = lts/hydrogen — голосна відмова, а не мовчазна підміна числом', () => {
  // `lts/*` — легальний синтаксис nvm, якого цей резолвер не вміє. Дискримінатор:
  // із захардкодженим запасним мажором скрипт побіг би на ньому й надрукував 'ok',
  // тобто єдине джерело істини підмінялося б мовчки.
  const { probeRoot, probeSh } = makeProbeTree('lts/hydrogen\n');
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('ok');
    expect(result.stdout).toContain('не розібрано');
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('.nvmrc немає зовсім — теж голосна відмова, а не запасне число', () => {
  const { probeRoot, probeSh } = makeProbeTree(null);
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('ok');
    expect(result.stdout).toContain('не прочитано .nvmrc');
    // Шлях, за яким шукали, — у stderr: у JSON він не потрапляє, бо лапка чи
    // зворотний слеш у ньому зробили б stdout нерозбірним.
    expect(result.stderr).toContain(probeRoot);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('кінцевий пробіловий символ у .nvmrc — форматування, а не значення', () => {
  // До зняття запасного `want=24` CRLF мовчки провалювався у 24 й був правильним
  // ВИПАДКОВО. Прибраний фолбек оголив розбір, який ніколи не був повним: чекаут
  // на Windows із autocrlf інакше не запустив би хук узагалі, на цілком легальному
  // для nvm файлі. Мажор 97 навмисно неіснуючий: доказом служить САМЕ ЧИСЛО у
  // відмові, тобто те, що файл розібрано, а не те, що щось якось побігло.
  for (const [label, content] of [
    ['CRLF', '97\r\n'],
    ['кінцевий пробіл', '97 \n'],
    ['кінцева табуляція', '97\t\n'],
    ['CR без переводу рядка', '97\r'],
    ['пробіл і CR разом', '97 \r\n'],
  ] as const) {
    const { probeRoot, probeSh } = makeProbeTree(content);
    try {
      const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
        encoding: 'utf8',
        input: '{}',
      });
      expect(result.status, label).toBe(0);
      expect(result.stdout, label).toContain('major 97');
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  }
});

test('не-мажори в .nvmrc і далі відмовляють гучно: banana, порожній файл, самі пробіли', () => {
  // Друга половина R-153: зрізання кінцевих пробілів не сміє перетворитися на
  // «витягнути з файлу бодай щось». Це не «24 зі сміттям на хвості» — це не-мажори.
  // (`lts/hydrogen` стереже окремий тест вище: у нього своя причина — він
  // легальний для nvm, і саме тому спокусливо було б його якось прийняти.)
  // Провідний пробіл тут — МЕЖА сьогоднішнього розбору, закріплена навмисно:
  // зрізається лише хвіст, бо саме там autocrlf лишає \r. Якщо межу колись
  // посунуть, цей рядок почервоніє й скаже про це, замість тихо змінити поведінку.
  for (const [label, content] of [
    ['banana', 'banana\n'],
    ['порожній файл', ''],
    ['самі пробіли', '   \n'],
    ['сам лише CRLF', '\r\n'],
    ['провідна табуляція', '\t24\n'],
  ] as const) {
    const { probeRoot, probeSh } = makeProbeTree(content);
    try {
      const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
        encoding: 'utf8',
        input: '{}',
      });
      expect(result.status, label).toBe(0);
      expect(result.stdout, label).not.toContain('ok');
      expect(result.stdout, label).toContain('не розібрано');
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  }
});

test('.nvmrc без кінцевого переводу рядка все одно читається', () => {
  // `read` повертає ненуль на такому файлі, хоча змінну вже заповнив. Якби ця
  // невдача затирала значення, файл «24» без \n став би невпізнаним — і хук
  // відмовляв би на цілком коректному репозиторії.
  const { probeRoot, probeSh } = makeProbeTree('97');
  try {
    const result = spawnSync(probeSh, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      input: '{}',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('major 97');
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});
