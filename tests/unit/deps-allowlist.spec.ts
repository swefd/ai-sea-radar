import { expect, test } from '@playwright/test';

import { ALLOWED, checkManifest, deniedRule } from '../../scripts/verify/checks/deps-allowlist.mjs';
import {
  makeFixtureDir,
  removeFixture,
  runCheck,
  writeFixtureFiles,
} from './support/check-fixtures';

const CHECK = 'deps-allowlist.mjs';

/** Узгоджений набір у форматі package.json — з вуст самої перевірки, не з другої копії. */
function agreedManifest(
  extra: Record<string, Record<string, string>> = {},
): Record<string, unknown> {
  const manifest: Record<string, unknown> = { name: 'fixture', private: true };
  for (const [block, packages] of Object.entries(ALLOWED)) {
    manifest[block] = { ...packages, ...(extra[block] ?? {}) };
  }
  for (const [block, packages] of Object.entries(extra)) {
    if (manifest[block] === undefined) manifest[block] = packages;
  }
  return manifest;
}

function serialise(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

test('узгоджений набір проходить', () => {
  expect(checkManifest(agreedManifest())).toEqual([]);
});

test('другий тестовий раннер названий поіменно, а не «невідомий пакет»', () => {
  const problems = checkManifest(agreedManifest({ devDependencies: { vitest: '4.0.0' } }));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('devDependencies.vitest');
  expect(problems[0]).toContain('другий тестовий раннер');
});

test('друга бібліотека карт — теж поіменно, і в дочірньому просторі імен', () => {
  for (const [name, version] of [['maplibre-gl', '5.0.0'], ['@react-leaflet/core', '3.0.0']]) {
    const problems = checkManifest(agreedManifest({ dependencies: { [name]: version } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`dependencies.${name}`);
    expect(problems[0]).toContain('друга бібліотека карт');
  }
});

test('підготовка до R2 не проходить під виглядом звичайної залежності', () => {
  const problems = checkManifest(agreedManifest({ dependencies: { ws: '8.0.0' } }));
  expect(problems.join('\n')).toContain('підготовка до R2');
});

test('незнайомий пакет поза жодною категорією — все одно провал', () => {
  const problems = checkManifest(agreedManifest({ dependencies: { 'left-pad': '1.3.0' } }));
  expect(problems.join('\n')).toContain('немає в узгодженому наборі');
});

test('дрейф версії ловиться — не лише поява пакета', () => {
  const problems = checkManifest(agreedManifest({ devDependencies: { eslint: '10.10.0' } }));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('devDependencies.eslint');
  expect(problems[0]).toContain('10.10.0');
});

test('діапазон замість точної версії — теж дрейф', () => {
  const problems = checkManifest(agreedManifest({ dependencies: { leaflet: '^1.9.4' } }));
  expect(problems).toHaveLength(1);
});

test('інші блоки залежностей заборонені — інакше пакет обійшов би allowlist', () => {
  const problems = checkManifest(agreedManifest({ peerDependencies: { vitest: '4.0.0' } }));
  expect(problems.join('\n')).toContain('peerDependencies');
});

test('незнайомий ключ верхнього рівня — розбіжність, хай би ким він був', () => {
  // Раніше тут стояв денилист блоків, і повз нього ЗМІРЯНО проходили три маршрути
  // (на a11cc12, на копії справжнього маніфесту): `workspaces`, `pnpm.overrides`,
  // `bun.overrides` — усі три давали EXIT=0 і «усі в узгодженому наборі». Список не
  // закінчувався, бо вкладених полів інструментів ніхто не перелічить до кінця.
  //
  // Тому тест перелічує не «заборонене», а стверджує ПРАВИЛО: будь-який ключ поза
  // дозволеними — розбіжність. Два останні входи вигадані навмисно: якщо перевірка
  // ловить і їх, вона ловить клас, а не мої приклади.
  const routes: Record<string, unknown>[] = [
    { workspaces: ['packages/*'] },
    { pnpm: { overrides: { react: '18' } } },
    { bun: { overrides: { react: '18' } } },
    { yarn: { resolutions: { react: '18' } } },
    { 'ще-не-вигаданий-менеджер': { overrides: {} } },
    { somethingCompletelyUnrelated: 1 },
  ];

  for (const route of routes) {
    const key = Object.keys(route)[0];
    const problems = checkManifest({ ...agreedManifest(), ...route });
    expect(problems, key).toHaveLength(1);
    expect(problems[0], key).toContain(`ключ "${key}"`);
  }
});

test('перетин ALLOWED і DENIED порожній', () => {
  // Пріоритет між двома списками визначено гілкою `expected === undefined` у
  // `checkManifest`: allowlist питається першим. Але на цілому наборі цей порядок
  // НЕ СПОСТЕРЕЖНИЙ, поки перетин порожній: розворот пріоритету лишає решту сюїти
  // зеленою (виміряно). Тобто припущення «жоден узгоджений пакет не стоїть у
  // денилисті» тримає код, а не перевіряє ніщо.
  //
  // Цей тест і робить припущення видимою розтяжкою: щойно хтось внесе DENIED-ім'я
  // в ALLOWED, тут стане червоно — і доведеться вирішити свідомо, а не дізнатися
  // про це з того, що правило «підготовка до R2» мовчки перестало діяти.
  const agreedNames = Object.values(ALLOWED).flatMap((packages) => Object.keys(packages));
  expect(agreedNames.length).toBeGreaterThan(0);

  const collisions = agreedNames.filter((name) => deniedRule(name) !== undefined);
  expect(collisions).toEqual([]);
});

test('колізія ALLOWED×DENIED: виграє allowlist — мовчки, тому це стверджено вголос', () => {
  // ЩО ЦЕЙ ТЕСТ НЕ КАЖЕ. Він не благословляє стан, у якому узгоджений пакет стоїть
  // у денилисті: цей стан ЗАБОРОНЕНО, і забороняє його тест вище — щойно перетин
  // стане непорожнім НАСПРАВДІ, той почервоніє й змусить вирішувати свідомо.
  //
  // ЩО ВІН КАЖЕ. Що станеться, ЯКЩО перетин усе-таки виникне. Сьогодні відповідь —
  // «виграє allowlist, і мовчки»: жодного рядка про те, що правило денилиста
  // перестало діяти. Мовчазна перемога allowlist — найгірший із можливих
  // результатів, тож саме її треба тримати під твердженням, а не під коментарем.
  //
  // ЧОМУ ВЗАГАЛІ. Без нього гілка пріоритету не має ЖОДНОГО тесту: розворот
  // `allowedVersionOf` на `deniedRule(name) !== undefined ? undefined : …` не
  // червонив ЖОДНОГО (виміряно на 0438273: 115 passed / 0 failed). Тест на
  // передумову ловить ПОЯВУ перетину, але не ловить зміну поведінки за порожнього
  // перетину — а це рівно той регрес, який зробить той, хто «спростить» лукап, не
  // зрозумівши, навіщо `DENIED` читається другим. R-123 і R-138 у парі: поведінка,
  // яку жоден тест не відрізняє від її правдоподібної неправильної версії, не
  // стережеться нічим.
  //
  // ЯК. Колізія вноситься в `ALLOWED` на час одного твердження і знімається у
  // `finally`; після нього набір перевіряється НАНОВО — інакше витік із цього
  // тесту ламав би сусідів, а не себе.
  //
  // ЧОМУ ЦЕ НЕ МИГТИТЬ. Виміряно одноразовим пробником — тест, що тримає мутацію
  // 400 мс, і вісім сусідів, що в цей час стверджують чистоту, — з логом
  // pid + START/END на кожен тест. `fullyParallel: true` роздає тести ОДНОГО файлу
  // різним процесам-воркерам (9 тестів → 5 різних pid за прогін), тож модуль у
  // кожного свій; а в межах одного процесу інтервали тестів не перетинаються
  // жодного разу — 0 перетинів на 180 інтервалах у 100 процесах, і 0 під
  // `--workers=1`, де тримач мутації та сусіди СПРАВДІ ділять процес. Жоден сусід
  // мутації не побачив: 3480 passed на `--repeat-each=30`.
  const COLLIDING = 'ws';
  // Версія навмисно неправдоподібна: справжній номер `ws` у цьому файлі читався б
  // як підготовка до R2, а тут потрібне лише те, щоб маніфест збігся з `ALLOWED`.
  const VERSION = '0.0.0';

  expect(deniedRule(COLLIDING), 'передумова: ім\'я справді в DENIED').not.toBeUndefined();
  expect(Object.hasOwn(ALLOWED.dependencies, COLLIDING)).toBe(false);

  try {
    ALLOWED.dependencies[COLLIDING] = VERSION;

    // R-50 на саму ін'єкцію: без цього рядка твердження нижче було б зеленим і
    // тоді, коли колізії не сталося, — тобто вакуумним.
    const collisions = Object.values(ALLOWED)
      .flatMap((packages) => Object.keys(packages))
      .filter((name) => deniedRule(name) !== undefined);
    expect(collisions).toEqual([COLLIDING]);

    // Ось воно: маніфест містить пакет, що стоїть в ОБОХ списках, — і перевірка
    // мовчить. Під розворотом пріоритету тут з'являється рівно одна розбіжність.
    expect(checkManifest(agreedManifest())).toEqual([]);
  } finally {
    delete ALLOWED.dependencies[COLLIDING];
  }

  // Перевимір після зняття: набір цілий, перетин знову порожній.
  expect(Object.hasOwn(ALLOWED.dependencies, COLLIDING)).toBe(false);
  expect(checkManifest(agreedManifest())).toEqual([]);
});

test('успадковане імʼя пакета не знаходить собі «узгодженої версії» в Object.prototype', () => {
  // Виміряно на a11cc12: `{"constructor": "1.0.0"}` давало рядок «узгоджено function
  // Object() { [native code] }». Мовчазного зеленого не було — розбіжність
  // рахувалася, — але повідомлення не читалося, а `allowedBlockOf` на таких іменах
  // брехав, ніби пакет десь узгоджений. `Object.hasOwn` стоїть у кожному зверненні до
  // словника пакетів, а не в обраних — число тут не називається навмисно.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const problems = checkManifest(agreedManifest({ dependencies: { [name]: '1.0.0' } }));
    expect(problems, name).toHaveLength(1);
    expect(problems[0], name).toContain(`dependencies.${name}`);
    expect(problems[0], name).toContain('немає в узгодженому наборі');
    expect(problems[0], name).not.toContain('native code');
  }
});

test('узгоджена залежність, що зникла, — теж розбіжність', () => {
  const manifest = agreedManifest();
  const dependencies = { ...(manifest.dependencies as Record<string, string>) };
  delete dependencies.leaflet;
  manifest.dependencies = dependencies;

  expect(checkManifest(manifest).join('\n')).toContain('зникла з package.json');
});

test('пакет, що переїхав у сусідній блок, — один рядок про переїзд, а не два', () => {
  // Без гасіння дубля той самий переїзд давав би і «немає в узгодженому наборі» в
  // новому блоці, і «зникла з package.json» у старому — дві розбіжності там, де
  // сталася одна. Саме заради цього в перевірці живе `present`; без цього тесту він
  // виглядав би як зайвий рядок і зник би при першому спрощенні.
  const manifest = agreedManifest();
  const dependencies = { ...(manifest.dependencies as Record<string, string>) };
  const devDependencies = { ...(manifest.devDependencies as Record<string, string>) };
  devDependencies.leaflet = dependencies.leaflet;
  delete dependencies.leaflet;
  manifest.dependencies = dependencies;
  manifest.devDependencies = devDependencies;

  const problems = checkManifest(manifest);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('devDependencies.leaflet');
  expect(problems[0]).toContain('узгоджено в "dependencies"');
});

test('CLI: код 1 на розбіжності, 0 після відкоту', () => {
  // Один із двох тестів на підпроцесі — він стереже контракт кодів виходу, який чиста
  // функція не доводить, а `run.mjs` від нього залежить. Другий — про код 2 нижче.
  const root = makeFixtureDir({
    'package.json': serialise(agreedManifest({ devDependencies: { jest: '30.0.0' } })),
  });
  try {
    expect(runCheck(CHECK, root).code).toBe(1);

    writeFixtureFiles(root, { 'package.json': serialise(agreedManifest()) });
    const after = runCheck(CHECK, root);
    expect(after.stdout).toContain('усі в узгодженому наборі');
    expect(after.code).toBe(0);
  } finally {
    removeFixture(root);
  }
});

// R-113 у варіанті для однієї перевірки одного файлу. Лічильника охоплення тут немає —
// сканувати нічого, — але клас той самий: перевірка звітує успіх, не прочитавши того,
// про що звітує. Нижче — чотири входи з нотаток і п'ятий, знайдений під час роботи
// (блок, що не є об'єктом); жоден із них не має давати «усі в узгодженому наборі».
// Числа тут навмисно не підсумовано одним: перелік входів у клас за визначенням
// не закритий, і «чотири» вже одного разу протухло за один раунд.
//
// Перші три — про сам ФАЙЛ, тому й перевіряються через підпроцес: несуче в них саме
// код виходу, а `run.mjs` бачить лише його. Код 2, не 1, і не тому, що 2 суворіше:
// 1 каже «package.json розійшовся з набором — правте одне з двох», і ця порада для
// зламаного файлу неправдива. `classifyExit` у `run.mjs` мапить 1 і 2 однаково в
// FAILED (127 і 126 мають власні гілки), тож блокує воно так само, а людині, яка
// дивиться на голий код, 2 відрізняє «не було чого перевіряти» від «знайдено
// розбіжність». Той самий вибір і з тієї самої причини зроблено в `no-secrets.mjs`.
test(`R-113: package.json відсутній, зламаний або не є об'єктом — код 2, ніколи не зелене`, () => {
  const cases: { label: string; files: Record<string, string>; says: string }[] = [
    { label: 'немає файлу', files: {}, says: 'не читається' },
    { label: 'не парситься', files: { 'package.json': '{ "name": \n' }, says: 'не є валідним JSON' },
    // `null` — валідний JSON. Саме цей вхід у передпольотному аудиті задачі 10 давав
    // неперехоплений TypeError; тут він мусить давати речення, а не стек.
    { label: `валідний JSON, не є об'єктом`, files: { 'package.json': 'null\n' }, says: `не є об'єктом` },
  ];

  for (const { label, files, says } of cases) {
    const root = makeFixtureDir(files);
    try {
      const result = runCheck(CHECK, root);
      expect(result.code, label).toBe(2);
      expect(result.stdout, label).not.toContain('усі в узгодженому наборі');
      expect(result.stderr, label).toContain(says);
    } finally {
      removeFixture(root);
    }
  }
});

test('R-113: маніфест без блоків залежностей — розбіжність, а не «усі в узгодженому наборі»', () => {
  // Найпідступніший із них: package.json без `dependencies` справді не
  // містить ЗАЙВИХ залежностей, тож «зайвого немає» — технічно правда. Варти тут
  // немає й не треба: allowlist звіряється в ОБИДВА боки, і саме друга його половина
  // робить цей вхід червоним — кожна узгоджена залежність названа як зникла.
  // Цей тест і є те, що не дасть другій половині тихо зникнути.
  const problems = checkManifest({ name: 'fixture', private: true });

  const agreedNames = Object.values(ALLOWED).flatMap((packages) => Object.keys(packages));
  expect(problems).toHaveLength(agreedNames.length);
  for (const name of agreedNames) {
    expect(problems.join('\n')).toContain(`${name}: узгоджена залежність зникла`);
  }
});

test(`checkManifest не падає стеком на тому, що не є об'єктом — називає, що дістав`, () => {
  // Функція оголошена над `unknown`, бо вхід приходить із `JSON.parse`. Перехопити й
  // сказати краще, ніж упасти стеком: стек у stderr читається як поламана перевірка,
  // а не як поламаний вхід.
  for (const value of [null, [], 42, 'text']) {
    const problems = checkManifest(value);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`не є об'єктом`);
  }
});

test(`блок залежностей, що не є об'єктом, названо — а не розібрано по літерах`, () => {
  // `"dependencies": "leaflet"` без варти дало б рядок на кожну ЛІТЕРУ — `Object.entries`
  // над рядком повертає його символи; `"dependencies": null` — TypeError звідти ж.
  // Обидва — та сама підміна причини, лише на рівень нижче за випадок вище.
  //
  // Назва форми звіряється разом із рештою і саме українською: «(масив)» поруч із
  // «(number)» в одному реченні — слід від переліку, який дописували не думаючи, а
  // читач справедливо переносить цю підозру на правила.
  const shapes: [unknown, string][] = [
    ['leaflet', 'рядок'],
    [null, 'null'],
    [7, 'число'],
    [true, 'булеве'],
    [['leaflet'], 'масив'],
  ];

  for (const [value, shape] of shapes) {
    const problems = checkManifest({ ...agreedManifest(), dependencies: value });
    expect(problems, shape).toHaveLength(1);
    expect(problems[0], shape).toContain('dependencies');
    expect(problems[0], shape).toContain(`не є об'єктом (${shape})`);
  }
});
