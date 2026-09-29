# Налаштування знімка — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** користувач вибирає вікно збору (15 с…5 хв) і вмикає судна класу B, може скасувати завантаження, а діагностика спроби доступна в згорнутому блоці «Докладно».

**Architecture:** налаштування йдуть рядком запиту `GET /api/snapshot?window=&classB=`; сервер перевіряє їх за білим списком (400 `invalid_params`), передає вікно й тип підписки збирачу, а збирач рахує діагностику в обох гілках результату. Клієнт тримає налаштування в стані `VesselView` (без збереження), обриває запит через `AbortController` і показує новий стан `cancelled`.

**Tech Stack:** Node 24 · TypeScript 6 strict · Next.js 16 App Router · React 19 · Playwright Test 1.63 (проєкти `unit`, `e2e`). Нових залежностей немає.

**Spec:** `docs/superpowers/specs/2026-09-29-snapshot-settings-design.md`

## Передача в нову сесію — прочитати першим

Цей план складено в одній сесії, а виконуватиметься в іншій, після злиття з
паралельною гілкою. Нижче — усе з розмови, чого немає в коді й специфікації.

### Стан на момент передачі (2026-09-29)

- Гілка `worktree-snapshot-settings` відгалужена від `main` @ `5820048`. На ній
  лише документи: специфікація, цей план і `docs/IMPROVEMENTS.md` з рядком
  статусу. **Код не змінювався, жодна задача не почата.**
- `docs/IMPROVEMENTS.md` у `main` був НЕзакомічений (untracked); у цю гілку
  скопійований і закомічений. При злитті можливий конфлікт «додано в обох» —
  брати версію з рядком «Статус 2026-09-29».
- У головному checkout на `main` видалено `docs/checkpoints/CHECKPOINT-04.md`
  без коміту. Це зробила не ця сесія; не відновлювати й не комітити без слова
  людини.
- **Перед Task 1 — звірити план з кодом після злиття.** Паралельна гілка могла
  змінити ті самі файли (`vessel-view.tsx`, `vessel-panel.tsx`, `snapshot.ts`,
  `collector.ts`, тести). Номери рядків і фрагменти «було» в плані зняті з
  `5820048`; якщо файл інший — адаптувати крок, не вставляти наосліп.

### Рішення людини (власника проєкту), ухвалені в розмові

1. **П-1:** не фіксоване довше вікно, а повзунок користувача: 15 с, 30 с, 60 с,
   2, 3, 4, 5 хв. Типове 15 с.
2. **П-2:** клас B — перемикач користувача, за замовчуванням вимкнено.
3. **П-3:** помилки й надалі явні; докладна діагностика — прихована, варіант
   «B»: згорнутий `<details>` «Докладно» в панелі (не консоль, не «і те, і те»).
4. **Нове:** кнопка «Скасувати». Після неї — окремий стан «скасовано»
   (варіант «B»: суден немає, «Даних на карті немає», «Завантаження
   скасовано»), а не повернення до попереднього стану й не демо.
5. Підпис вікна — завжди в секундах («знімок за 120 с»); клас B — хвіст
   « · із малими суднами (клас B)». Погоджено.
6. Параметри в рядку `GET`, білий список, 400 `invalid_params`, діагностика і в
   успіху, і в помилці — погоджено.
7. Людина вважає своє повідомлення погодженням замовника: `docs/tasks/` не
   правиться, нові узгоджені значення живуть у специфікації й конфігурації.
8. Живий зразок класу B: скрипт пише агент, **запускає людина** зі своїм
   ключем (`! node …`). Агент `.env.local` не читає, не копіює, ключ у чат не
   просить.
9. Робота — в окремому worktree (вимога людини).

### Ще НЕ підтверджено людиною — спитати на початку нової сесії

- **Дві кнопки замість однієї** (специфікація §5.1, «Уточнення при
  плануванні»). Погоджено було «Скасувати» на місці «Завантажити»; план робить
  «Завантажити» заблокованою + «Скасувати» поруч, бо `SPRINT-02.md:31` і
  наявний e2e вимагають заблоковану кнопку в `loading`. Людина правку ще не
  підтвердила. Якщо відповість «одна кнопка» — Task 5 змінюється: кнопка
  завантаження в `loading` не рендериться, а твердження
  `toBeDisabled()` у тесті «завантаження: кнопка заблокована…» переписується
  (це зміна контракту R2 — записати в специфікацію).
- **Спосіб виконання** не обраний. Рекомендація агента — Native
  (`superpowers:executing-plans`): задачі ланцюжком змінюють одну форму
  відповіді, а Task 9 однаково потребує людини в сесії.
- Правки §3.2 (білий список ключів `byType`) і §7 (предикат маршруту в e2e) —
  технічні, людина бачила їх у підсумку, заперечень не було.

### Пастки, виміряні під час планування

- **У новому worktree немає `node_modules`** — Task 1, Step 0 (`npm ci`).
- **Glob `page.route('**/api/snapshot')` закріплений `$`** (перевірено в
  `playwright-core` `globToRegexPattern`): запит із `?window=…` він не
  перехоплює, тест тихо піде на справжній сервер. Тому предикат за `pathname`.
- **Фікстури ключа — лише з префіксом `EXAMPLE-`/`SAMPLE-`**, інакше рядок
  `no-secrets` реєстру червоніє на власних тестах.
- **`.env.local` лежить лише в головному checkout**, не у worktree.
- **Ізоляція worktree:** інструмент відмовляє командам, що роблять `cd` у
  головний checkout або складні конструкції зі змінними; читати файли
  головного checkout (`reference/`, `node_modules`) — абсолютним шляхом через
  Read/Grep, а не `cd`.
- **Скасування на сервері вже працює:** `snapshot.ts:89` передає
  `request.signal` у збирач, `onAbort` закриває сокет і таймери. Клієнту
  потрібен лише `AbortController`.
- **Поля класу B** за `reference/ais-message-models/models/StandardClassBPositionReport.ts`
  (`baseName`): `Latitude`, `Longitude`, `Sog`, `Cog` — ті самі імена, що в
  `PositionReport`. Але рішення — лише за живим зразком (`SPRINT-02.md:90`).
- **Робочий метод проєкту** (`CLAUDE.md`): після кожного пункту — показати diff
  проти задачі й розділити доведене тестом і перевірене очима; ворота
  готовності — `npm run verify:full`.

## Global Constraints

- Робоче дерево: `.claude/worktrees/snapshot-settings`, гілка `worktree-snapshot-settings`. Усі команди — звідси; `cd` у головний checkout заборонено.
- Жодних нових пакетів; `package.json` не змінюється (`deps-allowlist`).
- Вікна: `[15, 30, 60, 120, 180, 240, 300]`; типове — `15`; ліміт `100` без змін. Значення — лише в `src/shared/config/aisstream.ts`.
- `classB`: `0` | `1`; типове — вимкнено.
- Налаштування не зберігаються: ні `localStorage`, ні cookie.
- Сирий текст провайдера й ключ не потрапляють у відповідь, діагностику, консоль.
- Скасування не повертає частковий набір суден.
- Тексти дослівно: «Некоректні параметри запиту», «Завантаження скасовано», «Скасувати», «Вікно збору», «Малі судна (клас B)», «Докладно», « · із малими суднами (клас B)».
- Юніт-тести — Playwright `--project=unit`; e2e — `--project=e2e`. Завжди з `--project`.
- Фікстури ключа починаються з `EXAMPLE-` (інакше червоніє `no-secrets`).
- Коментарі — українською, у стилі сусідніх файлів (пояснюють «чому»).
- Коміти закінчуються рядком `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

1. **Пізня відповідь після «Скасувати».** Сервер устиг відповісти, коли людина вже скасувала або вже запустила нову спробу — стан мусить лишитися «скасовано» / результатом нової спроби. Тест — Task 5, крок 1 (другий тест).
2. **Майже-правильні параметри:** `015`, `+15`, ` 15`, `15.0`, `window=15&window=30`, `classB=true` — усе 400, жодного сокета. Тест — Task 1, крок 1.
3. **Ключ у новій поверхні.** 400-відповідь і `diagnostics` не містять ключа. Тест — Task 3, крок 1.
4. **Довільний `MessageType` провайдера** не стає ключем `byType` (це був би сирий текст провайдера на екрані). Тест — Task 3, крок 1.
5. **Розмонтування під час завантаження** (hot reload, закриття вкладки) обриває запит і не лишає сокет на сервері до кінця 5-хвилинного вікна. Покрито прибиранням в ефекті Task 5; серверний бік — наявний тест збирача «скасування до кінця вікна».

## Карта файлів

| Файл | Дія | Відповідальність |
|---|---|---|
| `src/shared/config/aisstream.ts`, `index.ts` | змінити | `SNAPSHOT_WINDOW_OPTIONS`, `SnapshotSettings`, `DEFAULT_SNAPSHOT_SETTINGS` |
| `src/_app/api-routes/snapshot-params.ts` | створити | `parseSnapshotParams` |
| `src/_app/api-routes/snapshot.ts` | змінити | 400, вікно з запиту, `includeClassB`, `diagnostics` |
| `src/entities/vessel/model/snapshot-response.ts` | змінити | форма відповіді, `SnapshotDiagnostics`, код `invalid_params` |
| `src/shared/api/aisstream/collector.ts` | змінити | лічильники діагностики; `includeClassB` → підписка |
| `src/shared/api/aisstream/subscription.ts` | змінити | опція `includeClassB` |
| `src/entities/vessel/lib/position-report.ts` | змінити | розбір `StandardClassBPositionReport` |
| `src/_pages/home/lib/fetch-snapshot.ts` | змінити | параметри, `signal`, `'cancelled'` |
| `src/_pages/home/lib/snapshot-caption.ts` | змінити | хвіст класу B |
| `src/_pages/home/lib/snapshot-details.ts` | створити | мітки вікна, рядок діагностики |
| `src/_pages/home/ui/vessel-view.tsx` | змінити | стан `cancelled`, `AbortController`, налаштування |
| `src/_pages/home/ui/vessel-panel.tsx`, `.module.css` | змінити | повзунок, прапорець, «Скасувати», «Докладно» |
| `scripts/capture-class-b-sample.mjs` | створити, потім видалити | одноразовий збір живого зразка класу B |
| `data/samples/standard-class-b-position-report.sample.json`, `PROVENANCE.md` | створити / змінити | зразок і провенанс |
| `tests/unit/snapshot-params.spec.ts`, `tests/unit/snapshot-details.spec.ts` | створити | |
| `tests/unit/{snapshot-handler,aisstream-collector,aisstream-subscription,aisstream-config,fetch-snapshot,snapshot-caption,position-report}.spec.ts` | змінити | |
| `tests/e2e/snapshot.spec.ts` | змінити | шаблон маршруту + нові сценарії |

---

### Task 1: Вікно з запиту й 400 `invalid_params`

**Files:**
- Modify: `src/shared/config/aisstream.ts`, `src/shared/config/index.ts`
- Create: `src/_app/api-routes/snapshot-params.ts`
- Modify: `src/_app/api-routes/snapshot.ts`, `src/entities/vessel/model/snapshot-response.ts`
- Test: `tests/unit/snapshot-params.spec.ts` (новий), `tests/unit/snapshot-handler.spec.ts`, `tests/unit/aisstream-config.spec.ts`

**Interfaces:**
- Produces:
  - `SNAPSHOT_WINDOW_OPTIONS: readonly [15, 30, 60, 120, 180, 240, 300]`
  - `type SnapshotSettings = { readonly windowSeconds: number; readonly includeClassB: boolean }`
  - `DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings` = `{ windowSeconds: 15, includeClassB: false }`
  - `parseSnapshotParams(params: URLSearchParams): SnapshotSettings | null`
  - `SnapshotErrorCode` включає `'invalid_params'`; успіх відповіді має `includeClassB: boolean`

- [ ] **Step 0: Залежності в worktree**

У worktree немає `node_modules`. Run: `npm ci` (браузери Playwright — у глобальному кеші, повторно не качаються).
Потім `npm run verify` — очікується зелений на вихідному дереві; якщо ні — зупинитися й повідомити людину.

- [ ] **Step 1: Падаючі тести розбору**

`tests/unit/snapshot-params.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { parseSnapshotParams } from '@/_app/api-routes/snapshot-params';

// Білий список параметрів знімка — специфікація 2026-09-29 §3.1. Будь-що поза
// ним — null, і обробник відповідає 400 до читання ключа й до мережі.

const parse = (query: string) => parseSnapshotParams(new URLSearchParams(query));

test('без параметрів — типові 15 с і без класу B (поведінка R2)', () => {
  expect(parse('')).toEqual({ windowSeconds: 15, includeClassB: false });
});

for (const seconds of [15, 30, 60, 120, 180, 240, 300]) {
  test(`window=${seconds} приймається`, () => {
    expect(parse(`window=${seconds}`)).toEqual({ windowSeconds: seconds, includeClassB: false });
  });
}

test('classB=1 і classB=0', () => {
  expect(parse('classB=1')).toEqual({ windowSeconds: 15, includeClassB: true });
  expect(parse('window=60&classB=0')).toEqual({ windowSeconds: 60, includeClassB: false });
});

for (const query of [
  'window=14', 'window=16', 'window=99999', 'window=abc', 'window=',
  'window=015', 'window=+15', 'window=%2015', 'window=15.0', 'window=15&window=30',
  'classB=2', 'classB=true', 'classB=', 'classB=1&classB=1',
]) {
  test(`відмова: ${query}`, () => {
    expect(parse(query)).toBeNull();
  });
}

test('невідомі параметри ігноруються', () => {
  expect(parse('foo=bar&window=30')).toEqual({ windowSeconds: 30, includeClassB: false });
});
```

У `tests/unit/aisstream-config.spec.ts` додати в імпорт `SNAPSHOT_WINDOW_OPTIONS` і тест:

```ts
test('типове вікно входить до дозволених, а дозволені — рівно сім узгоджених', () => {
  expect(SNAPSHOT_WINDOW_OPTIONS).toEqual([15, 30, 60, 120, 180, 240, 300]);
  expect(SNAPSHOT_WINDOW_OPTIONS).toContain(SNAPSHOT_WINDOW_SECONDS);
});
```

У `tests/unit/snapshot-handler.spec.ts`:
1. `harness` отримує другий аргумент `query = ''` і робить запит на ``new Request(`http://127.0.0.1:3000/api/snapshot${query}`)``; також повертає лічильник викликів `connect` і останнє `windowMs`, переданий у `setTimer`:

```ts
function harness(drive: (h: SocketHandlers) => void, query = '') {
  const timers: Array<() => void> = [];
  const timerMs: number[] = [];
  let handlers: SocketHandlers | null = null;
  let connects = 0;
  const connect: Connect = (h) => { connects += 1; handlers = h; return { send: () => {}, close: () => {} }; };
  const handler = createSnapshotHandler({
    toItem: (raw) => ((raw as { v?: boolean }).v === true ? VESSEL : null),
    connect,
    now: () => NOW,
    env: ENV,
    setTimer: (fn, ms) => { timers.push(fn); timerMs.push(ms); return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => {},
  });
  const run = async () => {
    const pending = handler(new Request(`http://127.0.0.1:3000/api/snapshot${query}`));
    await Promise.resolve();
    if (handlers !== null) drive(handlers);
    for (const fn of timers) fn();
    return pending;
  };
  return Object.assign(run, { get connects() { return connects; }, timerMs });
}
```

2. В очікуванні першого тесту («успіх: HTTP 200…») додати `includeClassB: false` після `reason`.
3. Нові тести:

```ts
test('window=120&classB=1: вікно 120 000 мс у таймері, у відповіді 120 і includeClassB', async () => {
  const run = harness((h) => { h.onOpen(); }, '?window=120&classB=1');
  const response = await run();
  expect(run.timerMs).toEqual([120_000]);
  expect(await response.json()).toMatchObject({ ok: true, windowSeconds: 120, includeClassB: true });
});

test('некоректні параметри: HTTP 400, invalid_params, мережі не торкалися', async () => {
  const run = harness(() => {}, '?window=99999');
  const response = await run();
  expect(response.status).toBe(400);
  expect(run.connects).toBe(0);
  expect(await response.json()).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'invalid_params', message: 'Некоректні параметри запиту' },
  });
});

test('некоректні параметри перевіряються раніше за ключ', async () => {
  const handler = createSnapshotHandler({ toItem: () => null, env: {}, now: () => NOW });
  const response = await handler(new Request('http://127.0.0.1:3000/api/snapshot?classB=2'));
  expect(response.status).toBe(400);
  expect((await response.json() as { error: { code: string } }).error.code).toBe('invalid_params');
});
```

У `tests/unit/snapshot-caption.spec.ts` до `BASE` додати `includeClassB: false,` — інакше після Step 5 `check-types` червоніє на цьому файлі (тип успіху отримує обов'язкове поле).

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=unit tests/unit/snapshot-params.spec.ts tests/unit/snapshot-handler.spec.ts tests/unit/aisstream-config.spec.ts`
Expected: FAIL — модуля `snapshot-params` немає, `SNAPSHOT_WINDOW_OPTIONS` не експортовано, `includeClassB` відсутнє.

- [ ] **Step 3: Конфігурація**

У `src/shared/config/aisstream.ts` після `SNAPSHOT_WINDOW_SECONDS`:

```ts
/**
 * Дозволені вікна збору, секунди. Погоджено замовником 2026-09-29
 * (docs/superpowers/specs/2026-09-29-snapshot-settings-design.md §3.3):
 * повзунок інтерфейсу ходить саме цими кроками, а сервер іншого не приймає —
 * інакше ручний `?window=99999` тримав би сокет добу.
 */
export const SNAPSHOT_WINDOW_OPTIONS = [15, 30, 60, 120, 180, 240, 300] as const;

/** Налаштування однієї спроби. Не зберігаються між запусками (PROJECT_BRIEF:113). */
export type SnapshotSettings = {
  readonly windowSeconds: number;
  readonly includeClassB: boolean;
};

/** Без параметрів — дослівно поведінка R2: 15 с, лише PositionReport. */
export const DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings = {
  windowSeconds: SNAPSHOT_WINDOW_SECONDS,
  includeClassB: false,
};
```

У `src/shared/config/index.ts` додати до експортів: `export type { ApiKeyState, SnapshotSettings } from './aisstream';` і в список значень — `SNAPSHOT_WINDOW_OPTIONS, DEFAULT_SNAPSHOT_SETTINGS`.

- [ ] **Step 4: Розбір параметрів**

`src/_app/api-routes/snapshot-params.ts`:

```ts
// Розбір рядка запиту `GET /api/snapshot`. Джерело: специфікація
// docs/superpowers/specs/2026-09-29-snapshot-settings-design.md §3.1.
//
// Порівняння — з РЯДКОВИМ поданням дозволених значень, а не `Number(...)`:
// `Number` прийняв би `015`, `+15`, ` 15` і `15.0`, і білий список перестав
// би бути білим. Повтор параметра — теж відмова: `getAll` бачить обидва, а
// `get` мовчки взяв би перший.

import {
  DEFAULT_SNAPSHOT_SETTINGS,
  SNAPSHOT_WINDOW_OPTIONS,
  type SnapshotSettings,
} from '@/shared/config';

const WINDOW_BY_TEXT = new Map<string, number>(
  SNAPSHOT_WINDOW_OPTIONS.map((seconds) => [String(seconds), seconds]),
);
const CLASS_B_BY_TEXT = new Map<string, boolean>([['0', false], ['1', true]]);

/** `undefined` — параметра немає; `null` — він є, але некоректний. */
function single<T>(params: URLSearchParams, name: string, allowed: Map<string, T>): T | null | undefined {
  const values = params.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length > 1) return null;
  return allowed.get(values[0]) ?? null;
}

export function parseSnapshotParams(params: URLSearchParams): SnapshotSettings | null {
  const windowSeconds = single(params, 'window', WINDOW_BY_TEXT);
  const includeClassB = single(params, 'classB', CLASS_B_BY_TEXT);
  if (windowSeconds === null || includeClassB === null) return null;

  return {
    windowSeconds: windowSeconds ?? DEFAULT_SNAPSHOT_SETTINGS.windowSeconds,
    includeClassB: includeClassB ?? DEFAULT_SNAPSHOT_SETTINGS.includeClassB,
  };
}
```

- [ ] **Step 5: Тип відповіді**

У `src/entities/vessel/model/snapshot-response.ts`:
- до `SnapshotErrorCode` додати `| 'invalid_params'`;
- в успіх після `reason` додати `includeClassB: boolean;`.

- [ ] **Step 6: Обробник**

У `src/_app/api-routes/snapshot.ts`:
- імпорт: `import { parseSnapshotParams } from './snapshot-params';`, а `SNAPSHOT_WINDOW_SECONDS` з імпорту прибрати;
- до `ERROR_MESSAGES` додати `invalid_params: 'Некоректні параметри запиту',`;
- `errorResponse(code, at, status = 502)` — статус параметром, `{ status }` у `Response.json`;
- на початку повернутої функції, ПЕРЕД `readApiKey`:

```ts
    // Параметри — раніше за ключ: некоректний запит не має торкатися ні
    // оточення, ні мережі. 400, а не 502: це вада запиту, а не джерела.
    const settings = parseSnapshotParams(new URL(request.url).searchParams);
    if (settings === null) return errorResponse('invalid_params', now(), 400);
```

- у `collect({...})`: `windowMs: settings.windowSeconds * 1000,`;
- у відповіді успіху: `windowSeconds: settings.windowSeconds,` і після `reason` — `includeClassB: settings.includeClassB,`.

(`includeClassB` поки лише повертається у відповіді; у підписку його підключає Task 7.)

- [ ] **Step 7: Тести зелені**

Run: `npx playwright test --project=unit tests/unit/snapshot-params.spec.ts tests/unit/snapshot-handler.spec.ts tests/unit/aisstream-config.spec.ts`
Expected: PASS.
Run: `npm run verify` — Expected: зелений.

- [ ] **Step 8: Коміт**

```bash
git add src/shared/config src/_app/api-routes src/entities/vessel/model/snapshot-response.ts tests/unit/snapshot-params.spec.ts tests/unit/snapshot-handler.spec.ts tests/unit/aisstream-config.spec.ts tests/unit/snapshot-caption.spec.ts
git commit -m "feat(api): вікно збору з запиту, 400 invalid_params

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Діагностика у збирачі

**Files:**
- Modify: `src/shared/api/aisstream/collector.ts`
- Test: `tests/unit/aisstream-collector.spec.ts`

**Interfaces:**
- Consumes: нічого з Task 1.
- Produces:
  - `export type CollectDiagnostics = { connectMs: number | null; messages: number; rejected: number; byType: Record<string, number> }` у `collector.ts`
  - `CollectResult<T>` — обидві гілки мають поле `diagnostics: CollectDiagnostics`
  - ключі `byType` — лише `'PositionReport'`, `'StandardClassBPositionReport'`, `'other'`

- [ ] **Step 1: Падаючі тести**

У `tests/unit/aisstream-collector.spec.ts`:

1. Після `expectReleased` додати помічник і обгорнути ним УСІ наявні `expect(await promise).toEqual({...})` (рядки з `kind: 'done', items: [...]` і з `kind: 'error'`, `grep -n "expect(await promise).toEqual"`) — `expect(strip(await promise)).toEqual({...})`. Твердження про відсутність часткового набору від цього не слабшають: `toEqual` і далі бачить зайве поле `items`.

```ts
/** Результат без діагностики — для тестів, які перевіряють не її. */
function strip<R extends { diagnostics?: unknown }>(result: R): Omit<R, 'diagnostics'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { diagnostics: _ignored, ...rest } = result;
  return rest;
}
```

2. Нові тести в кінець файлу:

```ts
test('діагностика успіху: час з\'єднання, повідомлення, відкинуті, типи', async () => {
  const s = stand();
  const promise = run(s);
  s.advance(200);
  s.handlers.onOpen();
  // Підтвердження підписки — службове, у лічильники не йде.
  s.send({ MessageType: 'SubscriptionConfirmation' });
  s.send({ MessageType: 'PositionReport', id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.send({ MessageType: 'StandardClassBPositionReport', id: 'B', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.send({ MessageType: 'PositionReport', skip: true });
  s.handlers.onMessage('це не JSON');
  s.fireTimers();
  expect((await promise).diagnostics).toEqual({
    connectMs: 200,
    messages: 4,
    rejected: 2,
    byType: { PositionReport: 2, StandardClassBPositionReport: 1, other: 1 },
  });
});

test('діагностика помилки: лічильники є, суден немає', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ MessageType: 'PositionReport', id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.handlers.onClose();
  expect(await promise).toEqual({
    kind: 'error',
    code: 'disconnected',
    finishedAt: 1767268800000,
    diagnostics: { connectMs: 0, messages: 1, rejected: 0, byType: { PositionReport: 1 } },
  });
});

test('з\'єднання не відкрилося → connectMs null', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onError();
  expect((await promise).diagnostics).toEqual({ connectMs: null, messages: 0, rejected: 0, byType: {} });
});

test('довільний MessageType провайдера не стає ключем — лише "other"', async () => {
  // Ключ byType іде на екран; рядок провайдера туди не потрапляє (специфікація §3.2).
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ MessageType: '<script>alert(1)</script>' });
  s.fireTimers();
  expect((await promise).diagnostics.byType).toEqual({ other: 1 });
});

test('повідомлення після завершення не рахуються', async () => {
  const s = stand();
  const promise = run(s, { limit: 1 });
  s.handlers.onOpen();
  s.send({ MessageType: 'PositionReport', id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.send({ MessageType: 'PositionReport', id: 'B', t: '2026-01-01T12:00:00Z', p: 'P' });
  expect((await promise).diagnostics.messages).toBe(1);
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=unit tests/unit/aisstream-collector.spec.ts`
Expected: FAIL — `diagnostics` undefined.

- [ ] **Step 3: Реалізація**

У `src/shared/api/aisstream/collector.ts`:

1. Після типу `CollectOptions`:

```ts
/**
 * Що сталося за спробу — для блоку «Докладно» (специфікація 2026-09-29 §3.2).
 * Рахується в ОБОХ гілках результату: розрив після десяти повідомлень і розрив
 * без жодного — різні історії, хоч суден в обох немає.
 */
export type CollectDiagnostics = {
  connectMs: number | null;
  messages: number;
  rejected: number;
  byType: Record<string, number>;
};

/**
 * Типи, що стають ключами `byType`. Білий список, а не `MessageType` як є:
 * це рядок провайдера, а сирий текст провайдера на екран не потрапляє.
 */
const KNOWN_MESSAGE_TYPES = new Set(['PositionReport', 'StandardClassBPositionReport']);
```

2. `CollectResult<T>` — до обох гілок додати `diagnostics: CollectDiagnostics`.

3. На початку проміса, поруч із `let settled = false;`:

```ts
    const startedAt = now();
    const diagnostics: CollectDiagnostics = { connectMs: null, messages: 0, rejected: 0, byType: {} };
    const countType = (key: string) => {
      diagnostics.byType[key] = (diagnostics.byType[key] ?? 0) + 1;
    };
```

4. У `settle`: `resolve({ ...outcome, finishedAt: now(), diagnostics: { ...diagnostics, byType: { ...diagnostics.byType } } });` — копія, щоб ніщо після завершення не змінило вже віддане.

5. У `onOpen` першим рядком: `diagnostics.connectMs = now() - startedAt;`.

6. `onMessage` — тіло після `if (settled) return;` (коментарі над `JSON.parse` і `toItem` зберегти):

```ts
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            diagnostics.messages += 1;
            diagnostics.rejected += 1;
            countType('other');
            return;
          }

          const type = (raw as { MessageType?: unknown } | null)?.MessageType;
          // Підтвердження підписки — службове, не дані: у лічильники не йде.
          if (type === 'SubscriptionConfirmation') return;
          diagnostics.messages += 1;
          countType(typeof type === 'string' && KNOWN_MESSAGE_TYPES.has(type) ? type : 'other');

          let item: T | null;
          try {
            item = toItem(raw);
          } catch {
            settle({ kind: 'error', code: 'internal' });
            return;
          }
          if (item === null) {
            diagnostics.rejected += 1;
            return;
          }

          accept(item);
```

- [ ] **Step 4: Тести зелені**

Run: `npx playwright test --project=unit tests/unit/aisstream-collector.spec.ts` — PASS.
Run: `npm run verify` — зелений (обробник зайвого поля не читає).

- [ ] **Step 5: Коміт**

```bash
git add src/shared/api/aisstream/collector.ts tests/unit/aisstream-collector.spec.ts
git commit -m "feat(collector): діагностика спроби в обох гілках результату

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Діагностика у відповіді `/api/snapshot`

**Files:**
- Modify: `src/entities/vessel/model/snapshot-response.ts`, `src/entities/vessel/index.ts`, `src/_app/api-routes/snapshot.ts`
- Test: `tests/unit/snapshot-handler.spec.ts`

**Interfaces:**
- Consumes: `CollectResult.diagnostics` (Task 2), обробник Task 1.
- Produces:
  - `export type SnapshotDiagnostics = { connectMs: number | null; messages: number; rejected: number; byType: Record<string, number> }`, реекспорт з `@/entities/vessel`
  - успіх: `diagnostics: SnapshotDiagnostics`; помилка: `diagnostics: SnapshotDiagnostics | null`

- [ ] **Step 1: Падаючі тести**

У `tests/unit/snapshot-handler.spec.ts`:

1. Тест «успіх…»: до очікуваного тіла додати
   `diagnostics: { connectMs: 0, messages: 1, rejected: 0, byType: { other: 1 } },`
   (тестовий `toItem` приймає `{"v":true}` без `MessageType` → `other`).
2. Тести «без ключа» і 400 з Task 1: додати `diagnostics: null,`.
3. Цикл трьох помилок — п'ятий елемент кортежу `diagnostics`, деструктуризація `[label, drive, code, message, diagnostics]`, очікування
   `{ ok: false, attemptedAt: '2026-01-01T12:00:00.000Z', error: { code, message }, diagnostics }`:
   - «помилка до відкриття» → `{ connectMs: null, messages: 0, rejected: 0, byType: {} }`
   - «помилка після відкриття» → `{ connectMs: 0, messages: 0, rejected: 0, byType: {} }`
   - «розрив після підписки» → `{ connectMs: 0, messages: 0, rejected: 0, byType: {} }`
4. Новий тест:

```ts
test('ключ не потрапляє ні в 400, ні в діагностику', async () => {
  const bad = await harness(() => {}, '?window=1')();
  expect(await bad.text()).not.toContain(ENV.AISSTREAM_API_KEY);
  const ok = await harness((h) => { h.onOpen(); h.onMessage('{"v":true}'); })();
  expect(await ok.text()).not.toContain(ENV.AISSTREAM_API_KEY);
});
```

5. У `tests/unit/snapshot-caption.spec.ts` до `BASE` додати `diagnostics: { connectMs: 0, messages: 0, rejected: 0, byType: {} },` (та сама причина, що в Task 1: обов'язкове поле типу).

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=unit tests/unit/snapshot-handler.spec.ts`
Expected: FAIL — поля `diagnostics` немає.

- [ ] **Step 3: Тип**

`src/entities/vessel/model/snapshot-response.ts`, перед `SnapshotResponse`:

```ts
/**
 * Діагностика спроби (специфікація 2026-09-29 §3.2). Форма та сама, що
 * `CollectDiagnostics` збирача, але оголошена окремо: `entities` не імпортує
 * `shared/api`, а інтерфейс читає саме цей тип.
 */
export type SnapshotDiagnostics = {
  connectMs: number | null;
  messages: number;
  rejected: number;
  byType: Record<string, number>;
};
```

Успіх: `diagnostics: SnapshotDiagnostics;`. Помилка:

```ts
  | {
      ok: false;
      attemptedAt: string;
      error: { code: SnapshotErrorCode; message: string };
      diagnostics: SnapshotDiagnostics | null;
    };
```

`src/entities/vessel/index.ts`: `export type { SnapshotDiagnostics, SnapshotErrorCode, SnapshotResponse } from './model/snapshot-response';`

- [ ] **Step 4: Обробник**

`src/_app/api-routes/snapshot.ts`:
- `function errorResponse(code: SnapshotErrorCode, at: number, status = 502, diagnostics: SnapshotDiagnostics | null = null)`, у тілі `diagnostics`; імпорт типу `SnapshotDiagnostics` з `@/entities/vessel`. Коментар: «`null` — до збору справа не дійшла: `no_api_key`, `invalid_params`, кидок збирача».
- помилка збирача: `errorResponse(result.code, result.finishedAt, 502, result.diagnostics)`;
- успіх: `diagnostics: result.diagnostics,` після `includeClassB`.

- [ ] **Step 5: Тести зелені**

Run: `npx playwright test --project=unit tests/unit/snapshot-handler.spec.ts` — PASS.
Run: `npm run verify` — зелений.

- [ ] **Step 6: Коміт**

```bash
git add src/entities/vessel src/_app/api-routes/snapshot.ts tests/unit/snapshot-handler.spec.ts tests/unit/snapshot-caption.spec.ts
git commit -m "feat(api): діагностика у відповіді /api/snapshot

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: `fetchSnapshot` — параметри й скасування

**Files:**
- Modify: `src/_pages/home/lib/fetch-snapshot.ts`
- Test: `tests/unit/fetch-snapshot.spec.ts`

**Interfaces:**
- Consumes: `SnapshotSettings`, `DEFAULT_SNAPSHOT_SETTINGS` з `@/shared/config` (Task 1).
- Produces: `fetchSnapshot(settings: SnapshotSettings, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<SnapshotResponse | 'cancelled' | null>`; `SNAPSHOT_CANCELLED = 'cancelled' as const`.

- [ ] **Step 1: Падаючі тести**

У `tests/unit/fetch-snapshot.spec.ts`:
1. Імпорт: `import { DEFAULT_SNAPSHOT_SETTINGS } from '@/shared/config';`.
2. Усі наявні виклики `fetchSnapshot(stub(...))` → `fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, undefined, stub(...))`.
3. Нові тести:

```ts
test('налаштування йдуть рядком запиту', async () => {
  const urls: string[] = [];
  const capture = ((input: RequestInfo | URL) => {
    urls.push(String(input));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  await fetchSnapshot({ windowSeconds: 120, includeClassB: true }, undefined, capture);
  await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, undefined, capture);
  expect(urls).toEqual(['/api/snapshot?window=120&classB=1', '/api/snapshot?window=15&classB=0']);
});

test('скасування → "cancelled", а не null', async () => {
  // null інтерфейс перекладає в «Немає відповіді сервера»; скасування — інший
  // результат, і злитися з помилкою йому не можна.
  const controller = new AbortController();
  const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })) as typeof fetch;
  const pending = fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, controller.signal, hanging);
  controller.abort();
  expect(await pending).toBe('cancelled');
});

test('скасування під час читання тіла → теж "cancelled"', async () => {
  const controller = new AbortController();
  const response = { json: () => { controller.abort(); return Promise.reject(new DOMException('Aborted', 'AbortError')); } };
  const result = await fetchSnapshot(
    DEFAULT_SNAPSHOT_SETTINGS, controller.signal, (() => Promise.resolve(response as Response)) as typeof fetch,
  );
  expect(result).toBe('cancelled');
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=unit tests/unit/fetch-snapshot.spec.ts`
Expected: FAIL — URL без параметрів, скасування дає `null`.

- [ ] **Step 3: Реалізація**

`src/_pages/home/lib/fetch-snapshot.ts` — до шапкового коментаря дописати абзац:

```ts
// Скасування — ОКРЕМИЙ результат `'cancelled'`, а не `null`: `null` інтерфейс
// показує як «Немає відповіді сервера», а людина, що сама натиснула
// «Скасувати», помилки не робила (специфікація 2026-09-29 §5.2). Ознака —
// `signal.aborted`, а не ім'я винятку: `AbortError` рушії й підставки
// кидають по-різному, а стан сигналу однаковий.
```

Тіло:

```ts
import type { SnapshotResponse } from '@/entities/vessel';
import type { SnapshotSettings } from '@/shared/config';

const SNAPSHOT_URL = '/api/snapshot';

export const SNAPSHOT_CANCELLED = 'cancelled' as const;

/** Параметри завжди явні, навіть типові: запит сам каже, чого просили. */
function snapshotUrl({ windowSeconds, includeClassB }: SnapshotSettings): string {
  return `${SNAPSHOT_URL}?window=${windowSeconds}&classB=${includeClassB ? 1 : 0}`;
}

export async function fetchSnapshot(
  settings: SnapshotSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SnapshotResponse | typeof SNAPSHOT_CANCELLED | null> {
  try {
    const response = await fetchImpl(snapshotUrl(settings), { cache: 'no-store', signal });
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    if (typeof (body as { ok?: unknown }).ok !== 'boolean') return null;
    return body as SnapshotResponse;
  } catch {
    return signal?.aborted === true ? SNAPSHOT_CANCELLED : null;
  }
}
```

- [ ] **Step 4: Оновити єдиного споживача**

`src/_pages/home/ui/vessel-view.tsx`, у `handleLoad`: `await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS)` (імпорт `DEFAULT_SNAPSHOT_SETTINGS` з `@/shared/config`) і одразу після виклику:

```ts
    // Скасування з'явиться в Task 5; до того сигналу немає, і гілка недосяжна.
    if (response === 'cancelled') return;
```

- [ ] **Step 5: Тести зелені**

Run: `npx playwright test --project=unit tests/unit/fetch-snapshot.spec.ts` — PASS. `npm run verify` — зелений.

- [ ] **Step 6: Коміт**

```bash
git add src/_pages/home/lib/fetch-snapshot.ts src/_pages/home/ui/vessel-view.tsx tests/unit/fetch-snapshot.spec.ts
git commit -m "feat(ui): fetchSnapshot з параметрами й окремим результатом скасування

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Кнопка «Скасувати» і стан `cancelled`

**Files:**
- Modify: `src/_pages/home/ui/vessel-view.tsx`, `src/_pages/home/ui/vessel-panel.tsx`, `src/_pages/home/ui/vessel-panel.module.css`
- Test: `tests/e2e/snapshot.spec.ts`

**Interfaces:**
- Consumes: `fetchSnapshot(settings, signal)` і `'cancelled'` (Task 4).
- Produces: проп `VesselPanel.onCancel: () => void`; `LoadState` з варіантом `{ kind: 'cancelled' }`.

- [ ] **Step 1: Падаючі e2e-тести**

У `tests/e2e/snapshot.spec.ts`:

1. У `open()` шаблон маршруту — предикат за шляхом (glob Playwright закріплений `$` і `?window=…` не перехопив би):

```ts
  // Предикат за pathname, а не glob `**/api/snapshot`: glob закріплений у
  // кінці, а клієнт тепер шле `?window=…&classB=…`.
  await page.route((url) => url.pathname === '/api/snapshot', handler);
```

2. Нові тести в кінець:

```ts
const CANCEL = 'Скасувати';

/** Відповідь, яку тест відпускає сам; `release()` чекає, доки `fulfill` відпрацює. */
function heldRoute() {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let done: () => void = () => {};
  const finished = new Promise<void>((resolve) => { done = resolve; });
  const handler = async (route: Route) => {
    await held;
    // Запит уже обірвано — `fulfill` кидає; це очікувано, а не провал.
    await route.fulfill({ status: 200, json: SUCCESS_ONE }).catch(() => {});
    done();
  };
  return { handler, release: () => { release(); return finished; } };
}

test('«Скасувати»: запит обірвано, суден немає, "Завантаження скасовано"', async ({ page }) => {
  const held = heldRoute();
  await open(page, held.handler);

  await loadButton(page).click();
  await expect(loadButton(page)).toBeDisabled();

  const failed = page.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname === '/api/snapshot');
  await page.getByRole('button', { name: CANCEL }).click();
  await failed;

  await expect(page.getByRole('status')).toHaveText('Завантаження скасовано');
  await expect(page.getByText('Даних на карті немає', { exact: true })).toBeVisible();
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
  await expect(loadButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: CANCEL })).toHaveCount(0);
});

test('пізня відповідь після скасування не перезаписує стан', async ({ page }) => {
  const held = heldRoute();
  await open(page, held.handler);

  await loadButton(page).click();
  await page.getByRole('button', { name: CANCEL }).click();
  await expect(page.getByRole('status')).toHaveText('Завантаження скасовано');

  await held.release();

  await expect(page.getByRole('status')).toHaveText('Завантаження скасовано');
  await expect(page.locator('[data-vessel-id]')).toHaveCount(0);
});

test('«Скасувати» видно лише під час завантаження', async ({ page }) => {
  await open(page, json(SUCCESS_ONE, 200));
  await expect(page.getByRole('button', { name: CANCEL })).toHaveCount(0);
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=e2e tests/e2e/snapshot.spec.ts`
Expected: три нові тести FAIL (кнопки «Скасувати» немає); наявні — PASS (завдяки новому шаблону маршруту).

- [ ] **Step 3: Стан і обробники у `vessel-view.tsx`**

1. Імпорти: `useEffect, useRef, useState` вже є.
2. `LoadState` — додати варіант і доповнити коментар над типом рядком «`cancelled` — людина сама обірвала спробу; суден немає, як і в `error`, але це не помилка (специфікація 2026-09-29 §5.2)»:

```ts
  | { kind: 'cancelled' }
```

3. Текст поруч з іншими: `const CANCELLED_NOTICE = 'Завантаження скасовано';`
4. `describe` — нова гілка:

```ts
    case 'cancelled':
      return { caption: NO_DATA_CAPTION, notice: CANCELLED_NOTICE };
```

5. У компоненті, після `hadNonEmptySuccessRef`:

```ts
  // Контролер ПОТОЧНОЇ спроби. Ref, а не стан: він нічого не рендерить. Він же
  // — ознака «чия це відповідь»: спроба, чий контролер уже не поточний
  // (скасовано або розмонтовано), свій результат не записує.
  const attemptRef = useRef<AbortController | null>(null);

  // Розмонтування (hot reload, закриття) обриває запит: інакше сервер тримав
  // би сокет до кінця вікна — а воно тепер буває й 5 хвилин.
  useEffect(() => () => attemptRef.current?.abort(), []);
```

Якщо `react-hooks/exhaustive-deps` попереджає про `.current` у прибиранні — це хибна тривога для не-DOM ref; придушити рядком `// eslint-disable-next-line react-hooks/exhaustive-deps` із поясненням в одному реченні.

6. `handleLoad`:

```ts
  async function handleLoad() {
    const attempt = new AbortController();
    attemptRef.current = attempt;
    setSelectedVesselId(null);
    setLoad({ kind: 'loading' });

    const response = await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, attempt.signal);

    // Відповідь чужої спроби — ігнор. Стан уже записав той, хто її обірвав.
    if (attemptRef.current !== attempt) return;
    attemptRef.current = null;

    if (response === 'cancelled') return;
    if (response === null) {
      setLoad({ kind: 'error', message: NO_SERVER_RESPONSE });
      return;
    }
    // ...решта як була
```

(прибрати тимчасовий рядок `if (response === 'cancelled') return;` з Task 4 — він замінений цим.)

7. Новий обробник:

```ts
  // Стан пише САМ обробник, а не гілка 'cancelled' у handleLoad: відповідь
  // обірваного запиту може й не прийти, а людина має побачити результат одразу.
  function handleCancel() {
    attemptRef.current?.abort();
    attemptRef.current = null;
    setLoad({ kind: 'cancelled' });
  }
```

8. `<VesselPanel ... onCancel={handleCancel} />`.

- [ ] **Step 4: Кнопка у `vessel-panel.tsx`**

Проп: `/** Обриває поточну спробу; кнопка є лише в loading. */ readonly onCancel: () => void;` — додати до деструктуризації. Константа `const CANCEL_BUTTON_LABEL = 'Скасувати';`.

У `.actions` після кнопки завантаження:

```tsx
        {loading && (
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {CANCEL_BUTTON_LABEL}
          </button>
        )}
```

До коментаря про `.actions` дописати: «Під час збору поруч — «Скасувати». Кнопка завантаження лишається `disabled`, а не зникає: так R2 (SPRINT-02:31) і наявний e2e-тест».

- [ ] **Step 5: Стиль**

`vessel-panel.module.css` — `.actions` стає рядком, `.load` і `.cancel` ділять ширину:

```css
.actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0.875rem 1rem 0;
}
```

У `.load` замінити `display: block; width: 100%;` на `flex: 1 1 auto; min-width: 0;`. Новий блок після `.load:disabled`:

```css
/* «Скасувати» — вторинна дія: без заливки, колір `--locked`, щоб не
 * сплутати з головною кнопкою поруч. Ширина — за текстом. */
.cancel {
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 0.5rem 0.75rem;

  border: 1px solid rgba(255, 95, 210, 0.42);
  border-radius: var(--radius-sm);
  background: transparent;

  color: var(--locked);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;

  cursor: pointer;
}

.cancel:hover {
  background: rgba(255, 95, 210, 0.12);
}

.cancel:focus-visible {
  outline: 2px solid var(--locked);
  outline-offset: 2px;
}
```

Коментар над `.load` «Ширина — вся ширина панелі» замінити на «Кнопка займає все місце рядка, крім «Скасувати»; панель від них не ширшає (19rem — вимір запасу для `select.spec.ts`)».

- [ ] **Step 6: Тести зелені**

Run: `npx playwright test --project=e2e tests/e2e/snapshot.spec.ts tests/e2e/select.spec.ts` — PASS.
Run: `npm run verify` — зелений.

- [ ] **Step 7: Коміт**

```bash
git add src/_pages/home/ui tests/e2e/snapshot.spec.ts
git commit -m "feat(ui): кнопка «Скасувати» і стан «Завантаження скасовано»

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Тексти панелі — мітки вікна, рядок діагностики, хвіст підпису

**Files:**
- Create: `src/_pages/home/lib/snapshot-details.ts`
- Modify: `src/_pages/home/lib/snapshot-caption.ts`
- Test: `tests/unit/snapshot-details.spec.ts` (новий), `tests/unit/snapshot-caption.spec.ts`

**Interfaces:**
- Consumes: `SnapshotDiagnostics` (Task 3), `SNAPSHOT_WINDOW_OPTIONS` (Task 1).
- Produces:
  - `windowLabel(seconds: number): string` — `15 с`, `30 с`, `60 с`, `2 хв`…`5 хв`
  - `windowValueText(seconds: number): string` — `15 секунд`, `2 хвилини`, `5 хвилин`
  - `diagnosticsLine(d: SnapshotDiagnostics, vesselCount: number | null): string`
  - `snapshotCaption` дописує ` · із малими суднами (клас B)` при `includeClassB`

- [ ] **Step 1: Падаючі тести**

`tests/unit/snapshot-details.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { diagnosticsLine, windowLabel, windowValueText } from '@/_pages/home/lib/snapshot-details';

// Тексти панелі налаштувань і блоку «Докладно» — специфікація 2026-09-29
// §5.1, §5.4. Очікування — літерали.

test('мітки вікна: до хвилини — секунди, далі — хвилини', () => {
  expect([15, 30, 60, 120, 180, 240, 300].map(windowLabel))
    .toEqual(['15 с', '30 с', '60 с', '2 хв', '3 хв', '4 хв', '5 хв']);
});

test('aria-valuetext з українськими відмінками', () => {
  expect([15, 30, 60, 120, 180, 240, 300].map(windowValueText)).toEqual([
    '15 секунд', '30 секунд', '60 секунд', '2 хвилини', '3 хвилини', '4 хвилини', '5 хвилин',
  ]);
});

test('діагностика успіху', () => {
  expect(diagnosticsLine(
    { connectMs: 213, messages: 11, rejected: 0, byType: { PositionReport: 11 } }, 4,
  )).toBe("з'єднання: 0,2 с · повідомлень: 11 (PositionReport: 11) · відкинуто: 0 · суден: 4");
});

test('кілька типів — у сталому порядку, other останнім', () => {
  expect(diagnosticsLine(
    { connectMs: 1500, messages: 6, rejected: 1, byType: { other: 1, StandardClassBPositionReport: 2, PositionReport: 3 } }, 5,
  )).toBe("з'єднання: 1,5 с · повідомлень: 6 (PositionReport: 3, StandardClassBPositionReport: 2, інші: 1) · відкинуто: 1 · суден: 5");
});

test('помилка: без суден; з\'єднання не відкрите; повідомлень 0 — без дужок', () => {
  expect(diagnosticsLine({ connectMs: null, messages: 0, rejected: 0, byType: {} }, null))
    .toBe("з'єднання: не відкрито · повідомлень: 0 · відкинуто: 0");
});
```

У `tests/unit/snapshot-caption.spec.ts` (`BASE` уже має `includeClassB` і `diagnostics` з Task 1 і 3) — нові тести:

```ts
test('вікно з відповіді: 120 і 300 с — секундами', () => {
  expect(snapshotCaption({ ...BASE, windowSeconds: 120 })).toBe(
    'AISStream · знімок за 120 с · отримано 12:00:00 UTC · суден: 3 · вибірка неповна',
  );
  expect(snapshotCaption({ ...BASE, windowSeconds: 300 })).toBe(
    'AISStream · знімок за 300 с · отримано 12:00:00 UTC · суден: 3 · вибірка неповна',
  );
});

test('клас B: хвіст у кінці, після ліміту', () => {
  expect(snapshotCaption({ ...BASE, includeClassB: true })).toBe(
    'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 3 · вибірка неповна · із малими суднами (клас B)',
  );
  expect(snapshotCaption({ ...BASE, count: 100, truncated: true, reason: 'limit_reached', includeClassB: true })).toBe(
    'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 100 · вибірка неповна · зупинено на ліміті 100 · із малими суднами (клас B)',
  );
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=unit tests/unit/snapshot-details.spec.ts tests/unit/snapshot-caption.spec.ts`
Expected: FAIL — модуля немає, хвоста немає.

- [ ] **Step 3: `snapshot-details.ts`**

```ts
// Тексти панелі налаштувань і блоку «Докладно». Специфікація
// docs/superpowers/specs/2026-09-29-snapshot-settings-design.md §5.1, §5.4.
// Чисті функції без React — юніт-проєкт пінить їх літералами, як і підпис.

import type { SnapshotDiagnostics } from '@/entities/vessel';

/** Мітка під повзунком. До хвилини включно — секунди, як їх і називали. */
export function windowLabel(seconds: number): string {
  return seconds <= 60 ? `${seconds} с` : `${seconds / 60} хв`;
}

/** Для читача екрана. Відмінок хвилин: 2–4 — «хвилини», 5 — «хвилин». */
export function windowValueText(seconds: number): string {
  if (seconds <= 60) return `${seconds} секунд`;
  const minutes = seconds / 60;
  return `${minutes} ${minutes < 5 ? 'хвилини' : 'хвилин'}`;
}

/** Порядок типів сталий: інакше рядок стрибав би між однаковими спробами. */
const TYPE_ORDER = ['PositionReport', 'StandardClassBPositionReport', 'other'] as const;
const TYPE_LABEL: Record<(typeof TYPE_ORDER)[number], string> = {
  PositionReport: 'PositionReport',
  StandardClassBPositionReport: 'StandardClassBPositionReport',
  other: 'інші',
};

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace('.', ',');
}

/** `vesselCount` — `null` для помилки: суден там немає за визначенням. */
export function diagnosticsLine(d: SnapshotDiagnostics, vesselCount: number | null): string {
  const types = TYPE_ORDER
    .filter((type) => (d.byType[type] ?? 0) > 0)
    .map((type) => `${TYPE_LABEL[type]}: ${d.byType[type]}`);
  const parts = [
    `з'єднання: ${d.connectMs === null ? 'не відкрито' : seconds(d.connectMs)}`,
    `повідомлень: ${d.messages}${types.length > 0 ? ` (${types.join(', ')})` : ''}`,
    `відкинуто: ${d.rejected}`,
  ];
  if (vesselCount !== null) parts.push(`суден: ${vesselCount}`);
  return parts.join(' · ');
}
```

`windowLabel` для 60 дає `60 с` (не `1 хв`) — так у погодженому переліку.

- [ ] **Step 4: Хвіст підпису**

`snapshot-caption.ts`:

```ts
// Доповнення, коли в підписці були малі судна: інакше два знімки з однаковим
// вікном давали б різну кількість суден без видимої причини (специфікація §5.3).
const CLASS_B_TAIL = ' · із малими суднами (клас B)';

export function snapshotCaption(success: SnapshotSuccess): string {
  const base =
    `AISStream · знімок за ${success.windowSeconds} с · ` +
    `отримано ${formatTimestamp(success.collectedAt)} · ` +
    `суден: ${success.count} · вибірка неповна`;
  const limited = success.truncated ? `${base} · зупинено на ліміті ${SNAPSHOT_VESSEL_LIMIT}` : base;
  return success.includeClassB ? `${limited}${CLASS_B_TAIL}` : limited;
}
```

- [ ] **Step 5: Тести зелені**

Run: `npx playwright test --project=unit tests/unit/snapshot-details.spec.ts tests/unit/snapshot-caption.spec.ts` — PASS. `npm run verify` — зелений.

- [ ] **Step 6: Коміт**

```bash
git add src/_pages/home/lib tests/unit/snapshot-details.spec.ts tests/unit/snapshot-caption.spec.ts
git commit -m "feat(ui): тексти вікна, діагностики й доповнення про клас B

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Підписка на клас B

Підписка — окремо від перетворювача: вона не потребує зразка. До Task 9
повідомлення класу B приходять, але перетворювач їх відкидає — і це видно в
діагностиці як `відкинуто`, тобто чесно.

**Files:**
- Modify: `src/shared/api/aisstream/subscription.ts`, `src/shared/api/aisstream/collector.ts`, `src/_app/api-routes/snapshot.ts`
- Test: `tests/unit/aisstream-subscription.spec.ts`, `tests/unit/snapshot-handler.spec.ts`

**Interfaces:**
- Consumes: `SnapshotSettings.includeClassB` (Task 1).
- Produces: `buildSubscription(apiKey: string, options?: { includeClassB?: boolean }): string`; `CollectOptions.includeClassB?: boolean`.

- [ ] **Step 1: Падаючі тести**

`tests/unit/aisstream-subscription.spec.ts`, у кінець:

```ts
test('типи повідомлень: без опції — лише PositionReport (як у R2)', () => {
  const sent = JSON.parse(buildSubscription(KEY)) as { FilterMessageTypes: string[] };
  expect(sent.FilterMessageTypes).toEqual(['PositionReport']);
});

test('includeClassB — рівно два типи', () => {
  const sent = JSON.parse(buildSubscription(KEY, { includeClassB: true })) as { FilterMessageTypes: string[] };
  expect(sent.FilterMessageTypes).toEqual(['PositionReport', 'StandardClassBPositionReport']);
});
```

`tests/unit/snapshot-handler.spec.ts` — `harness` запам'ятовує надіслане: у `connect` повертати `{ send: (text) => { sent.push(text); }, close: () => {} }` з `const sent: string[] = [];`, і додати `sent` до `Object.assign(run, {...})`. Тест:

```ts
test('classB=1 доходить до підписки', async () => {
  const run = harness((h) => { h.onOpen(); }, '?classB=1');
  await run();
  const subscription = JSON.parse(run.sent[0]) as { FilterMessageTypes: string[] };
  expect(subscription.FilterMessageTypes).toEqual(['PositionReport', 'StandardClassBPositionReport']);
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=unit tests/unit/aisstream-subscription.spec.ts tests/unit/snapshot-handler.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Реалізація**

`subscription.ts`:

```ts
/**
 * Малі судна класу B — окремий тип повідомлення, не підвид PositionReport.
 * Вмикається користувачем (специфікація 2026-09-29, П-2); без опції — рівно
 * підписка R2 (SPRINT-02:23).
 */
export type SubscriptionOptions = { includeClassB?: boolean };

export function buildSubscription(apiKey: string, options: SubscriptionOptions = {}): string {
  const { south, west, north, east } = DOVER_STRAIT_REGION;
  const types = options.includeClassB === true
    ? ['PositionReport', 'StandardClassBPositionReport']
    : ['PositionReport'];

  return JSON.stringify({
    APIKey: apiKey,
    // (наявний коментар про BoundingBoxes без змін)
    BoundingBoxes: [[[south, west], [north, east]]],
    FilterMessageTypes: types,
  });
}
```

`collector.ts`: у `CollectOptions` — `/** Передається в підписку як є. */ includeClassB?: boolean;`; деструктуризувати; у `subscribe()` — `handle.send(buildSubscription(apiKey, { includeClassB }));`.

`snapshot.ts`: у `collect({...})` додати `includeClassB: settings.includeClassB,`.

- [ ] **Step 4: Тести зелені**

Run: `npx playwright test --project=unit tests/unit/aisstream-subscription.spec.ts tests/unit/snapshot-handler.spec.ts tests/unit/aisstream-collector.spec.ts` — PASS. `npm run verify` — зелений.

- [ ] **Step 5: Коміт**

```bash
git add src/shared/api/aisstream src/_app/api-routes/snapshot.ts tests/unit/aisstream-subscription.spec.ts tests/unit/snapshot-handler.spec.ts
git commit -m "feat(api): підписка на StandardClassBPositionReport за параметром

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Повзунок, прапорець і «Докладно» в панелі

**Files:**
- Modify: `src/_pages/home/ui/vessel-view.tsx`, `src/_pages/home/ui/vessel-panel.tsx`, `src/_pages/home/ui/vessel-panel.module.css`
- Test: `tests/e2e/snapshot.spec.ts`

**Interfaces:**
- Consumes: `SNAPSHOT_WINDOW_OPTIONS`, `DEFAULT_SNAPSHOT_SETTINGS`, `SnapshotSettings` (Task 1); `windowLabel`, `windowValueText`, `diagnosticsLine` (Task 6); `fetchSnapshot(settings, signal)` (Task 4); `SnapshotDiagnostics` (Task 3).
- Produces: нові пропси `VesselPanel`: `settings: SnapshotSettings`, `onSettingsChange: (next: SnapshotSettings) => void`, `details: string | null`.

- [ ] **Step 1: Падаючі e2e-тести**

У `tests/e2e/snapshot.spec.ts` у кінець:

```ts
function snapshotRequests(page: Page) {
  const urls: URL[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/snapshot') urls.push(url);
  });
  return urls;
}

test('без дотику до налаштувань: window=15, classB=0', async ({ page }) => {
  const urls = snapshotRequests(page);
  await open(page, json(SUCCESS_ONE, 200));
  await loadButton(page).click();
  await expect(page.locator('[data-vessel-id="210385000"]')).toHaveCount(1);
  expect(urls.map((u) => u.search)).toEqual(['?window=15&classB=0']);
});

test('повзунок на 2 хв і клас B: параметри в запиті, підпис із відповіді', async ({ page }) => {
  const urls = snapshotRequests(page);
  await open(page, json({ ...SUCCESS_ONE, windowSeconds: 120, includeClassB: true }, 200));

  const slider = page.getByRole('slider', { name: 'Вікно збору' });
  await slider.focus();
  // Індекс 0 → 3 (15 → 30 → 60 → 120).
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '2 хвилини');
  await page.getByRole('checkbox', { name: 'Малі судна (клас B)' }).check();

  await loadButton(page).click();
  await expect(page.getByText(
    'AISStream · знімок за 120 с · отримано 12:00:00 UTC · суден: 1 · вибірка неповна · із малими суднами (клас B)',
    { exact: true },
  )).toBeVisible();
  expect(urls.map((u) => u.search)).toEqual(['?window=120&classB=1']);
});

test('налаштування заблоковані під час завантаження', async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await open(page, async (route) => { await held; await route.fulfill({ status: 200, json: SUCCESS_ONE }); });

  await loadButton(page).click();
  await expect(page.getByRole('slider', { name: 'Вікно збору' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Малі судна (клас B)' })).toBeDisabled();
  release();
  await expect(page.getByRole('slider', { name: 'Вікно збору' })).toBeEnabled();
});

test('«Докладно»: закрите за замовчуванням, розкривається кліком', async ({ page }) => {
  await open(page, json({
    ...SUCCESS_ONE,
    diagnostics: { connectMs: 213, messages: 11, rejected: 0, byType: { PositionReport: 11 } },
  }, 200));
  await loadButton(page).click();

  const line = "з'єднання: 0,2 с · повідомлень: 11 (PositionReport: 11) · відкинуто: 0 · суден: 1";
  await expect(page.getByText(line, { exact: true })).toBeHidden();
  await page.getByText('Докладно', { exact: true }).click();
  await expect(page.getByText(line, { exact: true })).toBeVisible();
});

test('помилка без діагностики: «Докладно» немає', async ({ page }) => {
  await open(page, json({ ...ERROR_NO_KEY, diagnostics: null }, 502));
  await loadButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Не вдалося отримати дані: Ключ AISStream не налаштовано');
  await expect(page.getByText('Докладно', { exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Переконатися, що падають**

Run: `npx playwright test --project=e2e tests/e2e/snapshot.spec.ts`
Expected: нові тести FAIL (повзунка немає).

- [ ] **Step 3: `vessel-view.tsx`**

1. Стан налаштувань поруч з `load`:

```ts
  // Налаштування наступної спроби. Лише стан компонента: між запусками не
  // зберігаються (PROJECT_BRIEF:113), після оновлення — знову типові.
  const [settings, setSettings] = useState<SnapshotSettings>(DEFAULT_SNAPSHOT_SETTINGS);
```

2. `handleLoad`: `fetchSnapshot(settings, attempt.signal)`.
3. `LoadState.error` отримує діагностику: `{ kind: 'error'; message: string; diagnostics: SnapshotDiagnostics | null }`. У `handleLoad`: `NO_SERVER_RESPONSE` → `diagnostics: null`; `!response.ok` → `diagnostics: response.diagnostics ?? null` (`?? null` — захист від старого сервера без поля).
4. `describe` повертає ще й `details: string | null`:
   - `idle-demo`, `loading`, `cancelled` → `null`;
   - `success` → `load.response.diagnostics ? diagnosticsLine(load.response.diagnostics, load.response.count) : null`;
   - `error` → `load.diagnostics && load.diagnostics.connectMs !== null ? diagnosticsLine(load.diagnostics, null) : null` (специфікація §5.4: без відкритого з'єднання рядок з нулів нічого не пояснює).
5. У `VesselPanel` передати `settings`, `onSettingsChange={setSettings}`, `details`.

- [ ] **Step 4: `vessel-panel.tsx`**

Імпорти: `SNAPSHOT_WINDOW_OPTIONS`, `type SnapshotSettings` з `@/shared/config`; `windowLabel`, `windowValueText` з `../lib/snapshot-details`. Пропси — як в Interfaces, з однорядковими JSDoc.

Перед `.actions`:

```tsx
      <fieldset className={styles.settings} disabled={loading}>
        <label className={styles.settingLabel} htmlFor="snapshot-window">
          Вікно збору: {windowLabel(settings.windowSeconds)}
        </label>
        <input
          id="snapshot-window"
          className={styles.slider}
          type="range"
          min={0}
          max={SNAPSHOT_WINDOW_OPTIONS.length - 1}
          step={1}
          value={SNAPSHOT_WINDOW_OPTIONS.indexOf(settings.windowSeconds as (typeof SNAPSHOT_WINDOW_OPTIONS)[number])}
          aria-label="Вікно збору"
          aria-valuetext={windowValueText(settings.windowSeconds)}
          onChange={(event) =>
            onSettingsChange({ ...settings, windowSeconds: SNAPSHOT_WINDOW_OPTIONS[Number(event.target.value)] })
          }
        />
        <div className={styles.ticks} aria-hidden="true">
          {SNAPSHOT_WINDOW_OPTIONS.map((seconds) => (
            <span key={seconds}>{windowLabel(seconds)}</span>
          ))}
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={settings.includeClassB}
            onChange={(event) => onSettingsChange({ ...settings, includeClassB: event.target.checked })}
          />
          Малі судна (клас B)
        </label>
      </fieldset>
```

`aria-label` явний, бо видимий `<label>` містить змінне число, а тест і читач екрана шукають стале ім'я.

ВСЕРЕДИНІ `.body`, першим дочірнім вузлом, перед карткою (специфікація §5.1: «Докладно» ховається разом із тілом при згортанні):

```tsx
      {details !== null && (
        <details className={styles.details}>
          <summary>Докладно</summary>
          <p>{details}</p>
        </details>
      )}
```

Коментар над розміткою доповнити двома абзацами: `.settings` — `<fieldset disabled>` блокує повзунок і прапорець одним атрибутом під час збору, і стоїть поза `.body`, тож видимий згорнутою панеллю; `.details` — закритий за замовчуванням і живе в `.body`, тож згортання ховає його разом із карткою.

Правило `.body:empty` у CSS лишається робочим: коли немає ні деталей, ні картки, тіло порожнє.

- [ ] **Step 5: CSS**

У `vessel-panel.module.css` після `.actions`:

```css
/* Налаштування спроби — над кнопкою: їх вибирають ДО натискання. `fieldset`
 * без рамки: групування тут семантичне (один `disabled` на все), а не видиме. */
.settings {
  flex-shrink: 0;
  margin: 0;
  min-width: 0;
  border: 0;
  box-sizing: border-box;
  padding: 0.875rem 1rem 0;

  color: var(--ink);
  font-size: 0.8125rem;
}

.settings:disabled {
  color: var(--dim);
}

.settingLabel {
  display: block;
  margin-bottom: 0.375rem;
}

.slider {
  display: block;
  width: 100%;
  margin: 0;
  accent-color: var(--contact);
}

/* Сім міток на 17rem — дрібний шрифт і рівні проміжки; вирівнювання під
 * центри поділок браузера не гарантується, тому це підказка, а не шкала. */
.ticks {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
  color: var(--dim);
  font-size: 0.6875rem;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.625rem;
  cursor: pointer;
}

.checkbox input {
  accent-color: var(--contact);
}

/* «Докладно» — першим у тілі, над карткою; згортання панелі ховає його разом
 * з тілом. Рядок діагностики — дрібний і приглушений: це довідка, не стан. */
.details {
  margin: 0 1rem 0.75rem;
  color: var(--dim);
  font-size: 0.75rem;
}

.details summary {
  cursor: pointer;
}

.details p {
  margin: 0.375rem 0 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Запас для `select.spec.ts`**

Панель стала вищою, не ширшою — ширина 19rem без змін. Run: `npx playwright test --project=e2e` — усі PASS, зокрема `select.spec.ts` (кліки по демо-суднах).

- [ ] **Step 7: Візуальна перевірка**

`npm run dev` (якщо не запущено людиною) і відкрити `http://127.0.0.1:3000` через chrome-devtools MCP: знімок панелі в `idle-demo` і в `loading`. Переконатися: мітки під повзунком не накладаються; кнопки «Завантажити…» і «Скасувати» в одному рядку; згорнута панель показує налаштування, кнопки й підпис. Це перевірка очима — у звіті відділити її від доведеного тестами.

- [ ] **Step 8: Коміт**

```bash
git add src/_pages/home/ui tests/e2e/snapshot.spec.ts
git commit -m "feat(ui): повзунок вікна, перемикач класу B і блок «Докладно»

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Живий зразок класу B і перетворювач

**Цей таск має точку зупинки: крок 3 виконує людина.** Без живого зразка перетворювач не пишеться (`SPRINT-02.md:90`).

**Files:**
- Create (тимчасово): `scripts/capture-class-b-sample.mjs`
- Create: `data/samples/standard-class-b-position-report.sample.json`
- Modify: `data/samples/PROVENANCE.md`, `src/entities/vessel/lib/position-report.ts`
- Test: `tests/unit/position-report.spec.ts`

**Interfaces:**
- Consumes: нічого нового.
- Produces: `vesselFromPositionReport(raw)` приймає й `MessageType: 'StandardClassBPositionReport'` (тіло — `Message.StandardClassBPositionReport`). Ім'я функції не змінюється: споживачі (`snapshot.ts`) не чіпаються.

- [ ] **Step 1: Скрипт зразка**

`scripts/capture-class-b-sample.mjs`:

```js
// ОДНОРАЗОВИЙ скрипт: отримати ОДНЕ живе повідомлення StandardClassBPositionReport
// для data/samples/ (SPRINT-02:90 — перетворювач пишеться за зразком). Не частина
// застосунку; видаляється після отримання зразка.
//
// Запускає ЛЮДИНА зі своїм ключем:  node --env-file=.env.local scripts/capture-class-b-sample.mjs
// Ключ читається з оточення й НІКУДИ не друкується; у файл іде лише повідомлення.

import { writeFileSync } from 'node:fs';

const OUT = 'data/samples/standard-class-b-position-report.sample.json';
const BOXES = [
  { name: 'Дуврська протока', box: [[50.75, 0.95], [51.25, 1.95]], ms: 120_000 },
  { name: 'Ла-Манш', box: [[49.0, -6.0], [51.5, 2.5]], ms: 120_000 },
];

const apiKey = (process.env.AISSTREAM_API_KEY ?? '').trim();
if (apiKey === '') {
  console.error('AISSTREAM_API_KEY не задано');
  process.exit(1);
}

function tryBox({ name, box, ms }) {
  return new Promise((resolve) => {
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    socket.binaryType = 'arraybuffer';
    const timer = setTimeout(() => { socket.close(); resolve(null); }, ms);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [box],
        FilterMessageTypes: ['StandardClassBPositionReport'],
      }));
      console.log(`підписано: ${name}; чекаю до ${ms / 1000} с…`);
    });
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      const message = JSON.parse(text);
      if (message.MessageType !== 'StandardClassBPositionReport') return;
      clearTimeout(timer);
      socket.close();
      resolve({ name, box, message, receivedAt: new Date().toISOString() });
    });
    socket.addEventListener('error', () => { clearTimeout(timer); resolve(null); });
  });
}

for (const candidate of BOXES) {
  const got = await tryBox(candidate);
  if (got === null) { console.log(`${candidate.name}: нічого`); continue; }
  const json = JSON.stringify(got.message, null, 2);
  if (json.includes(apiKey)) { console.error('у повідомленні знайдено ключ — не зберігаю'); process.exit(1); }
  writeFileSync(OUT, `${json}\n`);
  console.log(`збережено ${OUT}; район: ${got.name} ${JSON.stringify(got.box)}; отримано: ${got.receivedAt}`);
  process.exit(0);
}
console.log('зразка не отримано в жодному районі');
process.exit(2);
```

- [ ] **Step 2: Перевірити скрипт без мережі**

Run: `npm run lint` — скрипт `.mjs` у `scripts/` лінтується конфігом для `scripts/**/*.mjs`. Виправити, якщо є зауваження. `npm run verify` — зелений (зокрема `no-secrets`: у скрипті ключа немає).

- [ ] **Step 3: ЗУПИНКА — людина запускає скрипт**

Попросити людину виконати в сесії:

```
! node --env-file=.env.local scripts/capture-class-b-sample.mjs
```

`.env.local` лежить у головному checkout, не в worktree; якщо у worktree його немає — людина або копіює файл сама, або запускає з шляхом: `! node --env-file=/Users/oleksandrsecond/Projects/sea-radar/.env.local scripts/capture-class-b-sample.mjs`. Агент `.env.local` не читає й не копіює.

Вихід 2 (зразка немає) — зупинитися й повідомити людину; перетворювач класу B без зразка не пишеться, решта функції (Task 1–8) від цього не залежить.

- [ ] **Step 4: Зразок і провенанс**

Прочитати збережений файл. Звірити: `Message.StandardClassBPositionReport` має `Latitude`, `Longitude`, `Sog`, `Cog` (за `reference/ais-message-models/models/StandardClassBPositionReport.ts` — так, але вирішує зразок); `MetaData` має `MMSI`, `ShipName`, `time_utc`. Якщо поля інші — ЗУПИНИТИСЯ й узгодити окрему гілку розбору з людиною (специфікація §9).

У `data/samples/PROVENANCE.md`: у таблицю — рядок `standard-class-b-position-report.sample.json` | перше `StandardClassBPositionReport`, отримане скриптом `scripts/capture-class-b-sample.mjs` | **ТАК**; і розділ за зразком наявного «`position-report.sample.json` — живий `PositionReport`»: час отримання (UTC, з виводу скрипта), район і бокс, фільтр, спосіб збереження (як є, лише відступи), перевірка на ключ, відмінності від `PositionReport` (перелік полів, яких немає або які нові).

- [ ] **Step 5: Падаючі тести перетворювача**

У `tests/unit/position-report.spec.ts`:

```ts
const CLASS_B_PATH = path.join(process.cwd(), 'data/samples/standard-class-b-position-report.sample.json');

function classBSample(): Json {
  return JSON.parse(readFileSync(CLASS_B_PATH, 'utf8')) as Json;
}

test('живий зразок класу B → судно', () => {
  // Значення переписати РУКАМИ з data/samples/standard-class-b-position-report.sample.json
  // до запуску тесту: id ← MetaData.MMSI рядком, name ← ShipName (обрізане, '' → null),
  // lat/lon ← Message.StandardClassBPositionReport.Latitude/Longitude,
  // speedKnots ← Sog, courseDeg ← Cog (з правилами домену), timestamp ← time_utc до мс.
  expect(vesselFromPositionReport(classBSample())).toEqual({
    id: '<MMSI зі зразка>',
    name: '<ShipName зі зразка або null>',
    lat: 0, // <Latitude зі зразка>
    lon: 0, // <Longitude зі зразка>
    speedKnots: 0, // <Sog або null>
    courseDeg: 0, // <Cog або null>
    timestamp: '<time_utc до мілісекунд, ISO Z>',
    source: 'aisstream',
  });
});

test('клас B: тіло з чужим ключем (PositionReport) при MessageType класу B → null', () => {
  const raw = classBSample();
  const message = raw.Message as Json;
  message.PositionReport = message.StandardClassBPositionReport;
  delete message.StandardClassBPositionReport;
  expect(vesselFromPositionReport(raw)).toBeNull();
});

test('клас B: широта 91 ("недоступно") → null', () => {
  const raw = classBSample();
  ((raw.Message as Json).StandardClassBPositionReport as Json).Latitude = 91;
  expect(vesselFromPositionReport(raw)).toBeNull();
});

test('клас B: Sog 102.3 → speedKnots null, позиція приймається', () => {
  const raw = classBSample();
  ((raw.Message as Json).StandardClassBPositionReport as Json).Sog = 102.3;
  expect(vesselFromPositionReport(raw)?.speedKnots).toBeNull();
});
```

Кутові дужки в першому тесті — не заглушка плану: це вказівка переписати літерали зі зразка, якого на момент планування ще немає. Тест не комітиться з кутовими дужками.

Run: `npx playwright test --project=unit tests/unit/position-report.spec.ts` — Expected: перший і третій/четвертий FAIL (тип класу B відкидається), другий PASS.

- [ ] **Step 6: Перетворювач**

У `position-report.ts`:

```ts
/**
 * Тип повідомлення → ключ тіла в `Message`. Клас B (малі судна, специфікація
 * 2026-09-29 П-2) несе ті самі поля позиції під ІНШИМ ключем — звірено з живим
 * зразком data/samples/standard-class-b-position-report.sample.json.
 */
const POSITION_BODY_BY_TYPE = new Map<unknown, string>([
  ['PositionReport', 'PositionReport'],
  ['StandardClassBPositionReport', 'StandardClassBPositionReport'],
]);
```

У `vesselFromPositionReport`:

```ts
  const message = asObject(raw);
  const bodyKey = message === null ? undefined : POSITION_BODY_BY_TYPE.get(message.MessageType);
  if (message === null || bodyKey === undefined) {
    return null;
  }

  const meta = asObject(message.MetaData);
  const report = asObject(asObject(message.Message)?.[bodyKey]);
```

Решта функції без змін. У шапковий коментар модуля — одне речення про клас B.

- [ ] **Step 7: Тести зелені, скрипт прибрано**

Run: `npx playwright test --project=unit tests/unit/position-report.spec.ts` — PASS.
`git rm`/видалити `scripts/capture-class-b-sample.mjs` (специфікація §6), якщо людина не сказала лишити; у PROVENANCE згадати, що скрипт видалено, і назвати коміт, у якому він був.
Run: `npm run verify` — зелений.

- [ ] **Step 8: Коміт**

```bash
git add data/samples src/entities/vessel/lib/position-report.ts tests/unit/position-report.spec.ts scripts
git commit -m "feat(vessel): розбір StandardClassBPositionReport за живим зразком

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

(скрипт має з'явитися в історії окремим комітом ДО видалення — закомітити його після кроку 2: `git add scripts/capture-class-b-sample.mjs && git commit -m "chore(samples): одноразовий скрипт зразка класу B"`.)

---

### Task 10: Ворота готовності

**Files:**
- Modify: `docs/IMPROVEMENTS.md` (статус «реалізовано»), за потреби `docs/context/verify-layer.md` — лише якщо змінився реєстр (не мав би).

- [ ] **Step 1:** Run: `npm run verify:full`. Expected: усі рядки PASSED. Якщо щось FAILED — `superpowers:systematic-debugging`, не латати навмання.
- [ ] **Step 2:** Ручна перевірка з живим ключем (людина запускає `npm run dev`): 15 с без класу B → підпис і «Докладно» з `PositionReport: N`; 2 хв з класом B → підпис із хвостом; «Скасувати» посеред 5 хв → «Завантаження скасовано» одразу. Записати, що бачили, окремо від доведеного тестами.
- [ ] **Step 3:** У `docs/IMPROVEMENTS.md` рядок статусу: «Реалізовано в гілці `worktree-snapshot-settings`, коміти <перший>…<останній>».
- [ ] **Step 4: Коміт**

```bash
git add docs/IMPROVEMENTS.md
git commit -m "docs: П-1…П-3 реалізовано

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
