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
 * Копія скрипта у тимчасовому дереві зі СВОЇМ `.nvmrc`. Справжній `.nvmrc` не
 * чіпається — він вхід хешу свіжості (задача 2), і підміна зробила б дерево
 * несвіжим, а перервана підміна лишила б у репозиторії чуже число.
 */
function makeProbeTree(nvmrc: string): { probeRoot: string; probeSh: string } {
  const probeRoot = mkdtempSync(path.join(tmpdir(), 'sea-radar-nodesh-'));
  mkdirSync(path.join(probeRoot, '.claude/hooks'), { recursive: true });
  const probeSh = path.join(probeRoot, '.claude/hooks/node.sh');
  copyFileSync(NODE_SH, probeSh);
  chmodSync(probeSh, 0o755);
  writeFileSync(path.join(probeRoot, '.nvmrc'), nvmrc);
  return { probeRoot, probeSh };
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
  for (const forbidden of [
    'dirname', 'basename', 'sed', 'ls', 'cat', 'grep', 'awk',
    'readlink', 'expr', 'tr', 'head', 'tail', 'which', 'find', 'xargs', 'env',
  ]) {
    expect(body, `зовнішня утиліта ${forbidden}`)
      .not.toMatch(new RegExp(String.raw`(^|[^\w./-])${forbidden}(\s|$|\))`, 'm'));
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
  // Дискримінатор: якби скрипт не зрізав `v` і мінор, рядок не був би числом,
  // спрацював би запасний мажор 24 — і скрипт УСПІШНО запустився б на node 24,
  // надрукувавши 'ok'. Середовище тут навмисно не зрізане саме для цього:
  // запасна гілка мусить мати всі шанси спрацювати, інакше тест нічого не ділить.
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
