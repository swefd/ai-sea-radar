# B-08…B-10. Ключ, reader і зразок — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сервер Sea Radar безпечно читає ключ AISStream, відкриває WebSocket, віддає перше отримане повідомлення сирим через `GET /api/snapshot` і зберігає живий зразок із провенансом.

**Architecture:** П'ять модулів, з яких **рівно один** знає слово WebSocket. Reader приймає джерело подій (`connect`) і годинник параметрами, тож юніт-тести подають повідомлення й рухають час без мережі. Route Handler тонкий: літеральні `runtime`/`dynamic` плюс реекспорт. Формат повідомлення **не розбирається** — це B-11, і він чекає на зразок із B-10.

**Tech Stack:** Node.js 24 (вбудований `WebSocket`, **без** `ws`) · TypeScript 6 `strict` · Next.js 16 App Router Route Handler · Playwright Test, проєкт `unit`.

**Spec:** `docs/superpowers/specs/2026-09-22-b08-b10-aisstream-key-and-reader-design.md`

## Global Constraints

- **Нових залежностей — нуль.** `package.json` не змінюється жодним рядком. Вбудований `WebSocket` Node 24 сам пропонує `permessage-deflate` (§2.4 спеки), тож `ws` не потрібен. Рядок `deps-allowlist` звіряє маніфест із літеральним списком **в обидва боки** — будь-який новий пакет зробить `npm run verify` червоним.
- **Ключ не потрапляє нікуди**, крім однієї змінної та тіла підписки: ні в `console`, ні у відповідь, ні в текст помилки, ні в коміт. Агент **не читає** `.env` і `.env.local` — ніколи, жодним інструментом.
- **Тексти відповідей — літерали зі `SPRINT-02.md:29`**, дослівно: `no_api_key` → `"Ключ AISStream не налаштовано"`; `connect_failed` → `"Не вдалося підключитися до джерела"`; `provider_error` → `"Джерело повернуло помилку"`; `disconnected` → `"З'єднання з джерелом розірвано"`; `internal` → `"Внутрішня помилка сервера"`.
- **Підписка:** поле `APIKey` (не `Apikey`, не `aPIKey` — §2.2 спеки), бокс `[[[50.75, 0.95], [51.25, 1.95]]]` у порядку `[lat, lon]`, фільтр `['PositionReport']`, надсилається **першою дією** в `onOpen` (джерело дає 3 секунди).
- **`ws.binaryType = 'arraybuffer'` до підписки на події.** Виміряно: за замовчуванням `blob`, і `JSON.parse(event.data)` кидає `SyntaxError` на бінарному фреймі, який шле AISStream (§2.5 спеки).
- **Константи вікна:** строк `15` секунд, ліміт `100` суден — у конфігурації, не в коді reader'а (`SPRINT-02.md:28`). Ліміт цього заходу не використовується, але оголошується там же.
- **Фікстури ключів у тестах пишуться з префіксом `EXAMPLE-` або `SAMPLE-`.** Виміряно проти нашого ж `no-secrets`: рядок `APIKey: "test-key-not-real-1234"` дає ЗНАХІДКУ `assigned-secret`, а `APIKey: "EXAMPLE-KEY-NOT-A-REAL-ONE"` придушується шаблоном `PLACEHOLDER`. Без цієї конвенції `npm run verify` червоніє на власних тестах.
- **Мова:** коментарі й назви тестів українською, як у наявних `tests/unit/*.spec.ts`. Імпорт у тестах — через аліас (`@/shared/...`), ніколи відносним шляхом і ніколи з `reference/`.
- **Після кожної задачі:** `npm run verify` має бути зеленим. Перед здачею — `npm run verify:full`.

---

## Структура файлів

| Файл | Відповідальність | Задача |
| --- | --- | --- |
| `.gitignore` | `.env*` із винятком `!.env.example` | 1 |
| `.env.example` | рядок `AISSTREAM_API_KEY=` без значення | 1 |
| `.claude/settings.json` | три deny-правила на `Read` | 1 |
| `src/shared/config/aisstream.ts` | ключ як юніон + константи вікна й ліміту | 2 |
| `src/shared/config/index.ts` | реекспорт (наявний файл, дописується) | 2 |
| `tests/unit/aisstream-config.spec.ts` | юніт: `missing`/`present`/пробіли | 2 |
| `src/shared/api/aisstream/subscription.ts` | чиста побудова тіла підписки | 3 |
| `tests/unit/aisstream-subscription.spec.ts` | юніт: `APIKey`, бокс, фільтр | 3 |
| `src/shared/api/aisstream/reader.ts` | строк, єдине завершення, прибирання | 4 |
| `tests/unit/aisstream-reader.spec.ts` | юніт проти підставного `connect` | 4 |
| `src/shared/api/aisstream/connect.ts` | **єдиний** модуль із WebSocket | 5 |
| `src/_app/api-routes/snapshot.ts` | юніон → HTTP-статус і тіло | 6 |
| `app/api/snapshot/route.ts` | літеральні `runtime`/`dynamic` + реекспорт | 6 |
| `data/samples/position-report.sample.json` | зразок у вихідній структурі | 7 |
| `data/samples/PROVENANCE.md` | паспорт зразка | 7 |

Межа модулів не стильова: `reader.ts` не імпортує `connect.ts` — він приймає `connect` параметром. Саме це робить задачу 4 тестовною без мережі й дає B-12 готову межу.

---

## Task 1: Секрет і його периметр (B-08, частина без коду)

**Files:**
- Modify: `.gitignore:34`
- Modify: `.env.example` (існує, вміст замінюється повністю)
- Modify: `.claude/settings.json:2-7` (блок `permissions`)

**Interfaces:**
- Consumes: нічого
- Produces: захищений периметр для задач 2–7; `.env.example` як зразок для людини

**Чому першою.** `SPRINT-02.md:84`: «Порядок обов'язковий: спочатку `.env.example`, `.gitignore` і правила Claude Code… Потім перевірка на фіктивному файлі… Тільки потім справжній ключ». Захист, доданий після того, як ключ уже в дереві, неможливо відрізнити від «файлу просто не торкалися».

- [ ] **Step 1: Зафіксувати поточну (зламану) поведінку — це вимір, не формальність**

```bash
cd "$CLAUDE_PROJECT_DIR"
for f in .env .env.local .env.production.local .env.example; do
  printf '%-26s ' "$f"; git check-ignore -q "$f" && echo IGNORED || echo "NOT IGNORED"
done
```

Очікується **до** правки (це дефект, який ми усуваємо):
```
.env                       IGNORED
.env.local                 NOT IGNORED
.env.production.local      NOT IGNORED
.env.example               NOT IGNORED
```

- [ ] **Step 2: Полагодити `.gitignore`**

Замінити рядок 34 (`​.env`) на дві сходинки:

```gitignore
.env*
!.env.example
```

- [ ] **Step 3: Перевірити, що периметр закрився**

```bash
for f in .env .env.local .env.production.local .env.example; do
  printf '%-26s ' "$f"; git check-ignore -q "$f" && echo IGNORED || echo "NOT IGNORED"
done
```

Очікується: перші три `IGNORED`, `.env.example` — `NOT IGNORED` (його комітять навмисно).

- [ ] **Step 4: Переписати `.env.example`**

Вміст файлу — рівно один рядок з перенесенням у кінці, дослівно за `SPRINT-02.md:24`:

```
AISSTREAM_API_KEY=
```

Без значення, без `your_api_key_here`, у ВЕРХНЬОМУ регістрі. Поточний вміст (`aisstream_api_key=your_api_key_here`) не відповідає ні регістру змінної, ні вимозі «без значення».

- [ ] **Step 5: Додати deny-правила**

У `.claude/settings.json`, всередину наявного об'єкта `permissions` (поруч із `allow`):

```json
"deny": [
  "Read(./.env)",
  "Read(./.env.local)",
  "Read(./.env.*.local)"
]
```

Явний перелік, **не** `Read(./.env*)` з негацією. Причина в §3.3 спеки: негація `!` підтримується цією версією CLI (виміряно), але глоб із винятком **відкрив би `.env.example` на читання**, а агент цей файл створює, не читає.

- [ ] **Step 6: Перевірити, що JSON не зламано**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('settings.json — валідний JSON')"
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npm run verify
```

Очікується: валідний JSON; `verify` зелений. Якщо `no-secrets` почервонів — у `.env.example` потрапило значення; повернутися до Step 4.

- [ ] **Step 7: Коміт**

```bash
git add .gitignore .env.example .claude/settings.json
git commit -m "$(cat <<'EOF'
feat(config): периметр ключа AISStream — .gitignore, .env.example, deny (B-08)

.gitignore повернуто до .env* із винятком !.env.example. Виміряно, що
послаблення до .env лишало .env.local і .env.production.local поза
ігноруванням — рівно те, що критерій B-08 вимагає захистити.

deny-правила перелічені явно, а не глобом із негацією. Негація '!'
підтримується CLI 2.1.278 (перевірено в docs), але Read(./.env*) з
винятком відкрив би .env.example на читання — агент його створює,
а не читає.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: ЗУПИНКА — перевірка руками, яку не робить жоден тест**

**Це не крок агента.** Повідомити людині дослівно:

> Захист на місці. Перевірте його самі, як вимагає `SPRINT-02.md:84`:
> 1. Створіть фіктивний `.env.local` з рядком `AISSTREAM_API_KEY=EXAMPLE-NOT-A-REAL-KEY`.
> 2. Попросіть мене прочитати `.env.local` — має бути **відмова**.
> 3. Попросіть прочитати `.env.example` — має бути **успіх**.
> 4. Тільки після цього покладіть справжній ключ у `.env.local` і **видаліть `.env`** (Next.js читає обидва; ключ у двох файлах — два периметри замість одного).
>
> Ключ не вводиться в чат і не друкується в терміналі.

Далі не рухатись без підтвердження людини.

---

## Task 2: Модуль ключа і константи (B-08, код)

**Files:**
- Create: `src/shared/config/aisstream.ts`
- Modify: `src/shared/config/index.ts` (дописати реекспорт)
- Test: `tests/unit/aisstream-config.spec.ts`

**Interfaces:**
- Consumes: нічого
- Produces:
  - `type ApiKeyState = { status: 'missing' } | { status: 'present'; apiKey: string }`
  - `readApiKey(env?: Record<string, string | undefined>): ApiKeyState`
  - `AISSTREAM_ENDPOINT: string`, `SNAPSHOT_WINDOW_SECONDS: number`, `SNAPSHOT_VESSEL_LIMIT: number`

- [ ] **Step 1: Написати падючий тест**

Створити `tests/unit/aisstream-config.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import {
  readApiKey,
  AISSTREAM_ENDPOINT,
  SNAPSHOT_WINDOW_SECONDS,
  SNAPSHOT_VESSEL_LIMIT,
} from '@/shared/config';

// Модуль бере оточення ПАРАМЕТРОМ, а не читає process.env всередині. Інакше
// тест мусив би мутувати process.env — глобальний стан, який тече між тестами
// одного процесу й робить порядок їх запуску значущим.

test('без змінної — missing, і жодного винятку', () => {
  // Дослівний критерій B-08: «модуль повертає "ключ відсутній" без винятку».
  expect(readApiKey({})).toEqual({ status: 'missing' });
});

test('порожній рядок і пробіли — теж missing', () => {
  // AISSTREAM_API_KEY= у .env.local (скопійований .env.example) дає саме
  // порожній рядок, а не undefined. Наївна перевірка `if (key === undefined)`
  // пропустила б його далі й відкрила сокет із порожнім ключем.
  expect(readApiKey({ AISSTREAM_API_KEY: '' })).toEqual({ status: 'missing' });
  expect(readApiKey({ AISSTREAM_API_KEY: '   ' })).toEqual({ status: 'missing' });
  expect(readApiKey({ AISSTREAM_API_KEY: '\t\n' })).toEqual({ status: 'missing' });
});

test('значення — present, із обрізаними краями', () => {
  expect(readApiKey({ AISSTREAM_API_KEY: 'EXAMPLE-KEY-VALUE' }))
    .toEqual({ status: 'present', apiKey: 'EXAMPLE-KEY-VALUE' });

  // Краї обрізаються: ключ, скопійований із листа, часто приносить із собою
  // пробіл або перенесення рядка, і джерело відкинуло б його як невірний.
  expect(readApiKey({ AISSTREAM_API_KEY: '  EXAMPLE-KEY-VALUE\n' }))
    .toEqual({ status: 'present', apiKey: 'EXAMPLE-KEY-VALUE' });
});

test('юніон розрізняє стани полем status, а не порожнечею рядка', () => {
  // Несуче твердження форми типу: 'missing' НЕ має поля apiKey взагалі, тож
  // споживач не може випадково прочитати з нього порожній рядок і піти далі.
  const missing = readApiKey({});
  expect(missing.status).toBe('missing');
  expect('apiKey' in missing).toBe(false);
});

test('константи вікна — узгоджені значення SPRINT-02, в одному місці', () => {
  expect(AISSTREAM_ENDPOINT).toBe('wss://stream.aisstream.io/v0/stream');
  expect(SNAPSHOT_WINDOW_SECONDS).toBe(15);
  expect(SNAPSHOT_VESSEL_LIMIT).toBe(100);
});
```

- [ ] **Step 2: Запустити — має впасти**

```bash
npx playwright test --project=unit tests/unit/aisstream-config.spec.ts
```

Очікується: FAIL, помилка резолву `@/shared/config` → `readApiKey` не експортується.

- [ ] **Step 3: Написати модуль**

Створити `src/shared/config/aisstream.ts`:

```ts
// Ключ AISStream і константи знімка. Джерело: docs/tasks/SPRINT-02.md,
// розділ «Узгоджені значення» (:24, :28); проєктне рішення
// docs/superpowers/specs/2026-09-22-b08-b10-aisstream-key-and-reader-design.md §3.4.

/**
 * Стан ключа. Юніон, а не `string | null`, свідомо: `no_api_key` у endpoint стає
 * ГІЛКОЮ РОЗБОРУ, а не перевіркою на порожнечу, повтореною в трьох місцях.
 * Варіант 'missing' не має поля apiKey взагалі — прочитати з нього порожній
 * рядок і піти далі неможливо за формою типу, а не за домовленістю.
 */
export type ApiKeyState =
  | { status: 'missing' }
  | { status: 'present'; apiKey: string };

/**
 * Читає ключ із переданого оточення.
 *
 * Оточення — ПАРАМЕТР із дефолтом, а не `process.env` усередині: інакше тест
 * мусив би мутувати глобальний стан, спільний для всього процесу.
 *
 * Не кидає ніколи — дослівний критерій B-08. Порожній рядок і рядок із самих
 * пробілів дають 'missing': саме так виглядає .env.local, скопійований з
 * .env.example і не заповнений.
 */
export function readApiKey(
  env: Record<string, string | undefined> = process.env,
): ApiKeyState {
  const raw = env.AISSTREAM_API_KEY;
  if (typeof raw !== 'string') return { status: 'missing' };

  const apiKey = raw.trim();
  if (apiKey === '') return { status: 'missing' };

  return { status: 'present', apiKey };
}

/** Кінцева точка. Джерело: документація aisstream.io. */
export const AISSTREAM_ENDPOINT = 'wss://stream.aisstream.io/v0/stream';

/** Строк збору, секунди. SPRINT-02:28 — «константи 15 і 100 у конфігурації». */
export const SNAPSHOT_WINDOW_SECONDS = 15;

/**
 * Ліміт унікальних суден. Оголошений тут разом із вікном, бо завдання називає
 * обидва одним реченням; СПОЖИВАЧА в цьому заході ще немає — його дасть збирач
 * (B-12). Тримати константу окремо від сестри означало б розвести на два коміти
 * те, що узгоджене як пара.
 */
export const SNAPSHOT_VESSEL_LIMIT = 100;
```

- [ ] **Step 4: Дописати реекспорт**

У `src/shared/config/index.ts` додати другим рядком:

```ts
export type { ApiKeyState } from './aisstream';
export {
  readApiKey,
  AISSTREAM_ENDPOINT,
  SNAPSHOT_WINDOW_SECONDS,
  SNAPSHOT_VESSEL_LIMIT,
} from './aisstream';
```

- [ ] **Step 5: Запустити — має пройти**

```bash
npx playwright test --project=unit tests/unit/aisstream-config.spec.ts
```

Очікується: PASS, 5 тестів.

- [ ] **Step 6: Коміт**

```bash
git add src/shared/config/aisstream.ts src/shared/config/index.ts tests/unit/aisstream-config.spec.ts
git commit -m "$(cat <<'EOF'
feat(config): читання ключа AISStream як юніон станів (B-08)

Оточення — параметр із дефолтом process.env, щоб тест не мутував
глобальний стан. Порожній рядок і пробіли дають 'missing': саме так
виглядає .env.local, скопійований з .env.example і не заповнений.

Варіант 'missing' не має поля apiKey за формою типу — прочитати з
нього порожній рядок неможливо, а не «не прийнято».

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Тіло підписки

**Files:**
- Create: `src/shared/api/aisstream/subscription.ts`
- Test: `tests/unit/aisstream-subscription.spec.ts`

**Interfaces:**
- Consumes: `DOVER_STRAIT_REGION` з `@/shared/config`
- Produces: `buildSubscription(apiKey: string): string` — готовий JSON-рядок для `send()`

**Чому окремий модуль.** Підписка — єдине місце, де живе розходження `APIKey`/`Apikey`/`aPIKey` (§2.2 спеки). Винесена з `connect.ts` саме тому, що `connect.ts` тестується лише живим запитом, а ця функція — чиста й перевіряється на кожному прогоні.

- [ ] **Step 1: Написати падючий тест**

Створити `tests/unit/aisstream-subscription.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { buildSubscription } from '@/shared/api/aisstream/subscription';

// Фікстура ключа МУСИТЬ починатися з EXAMPLE- або SAMPLE-. Виміряно проти
// нашого ж scripts/verify/checks/no-secrets.mjs: рядок виду
// `APIKey: "test-key-not-real-1234"` дає ЗНАХІДКУ assigned-secret і робить
// `npm run verify` червоним на власних тестах, а EXAMPLE-/SAMPLE- придушується
// шаблоном PLACEHOLDER.
const KEY = 'EXAMPLE-KEY-NOT-A-REAL-ONE';

test('поле ключа зветься APIKey — не Apikey і не aPIKey', () => {
  // Найдорожча помилка цього модуля, і вона МОВЧАЗНА: джерело просто закриє
  // з'єднання, а помилка прочитається як «мережа підвела».
  //
  // Три джерела в репозиторії розходяться:
  //   reference/aisstream-typescript-example/client.ts:11   Apikey
  //   reference/ais-message-models/.../SubscriptionMessage.ts:17  'aPIKey'
  //   той самий файл :27  "baseName": "APIKey"   ← ім'я НА ДРОТІ
  // Жива документація й SPRINT-02:23 згодні на APIKey.
  const sent = JSON.parse(buildSubscription(KEY)) as Record<string, unknown>;

  expect(Object.keys(sent)).toContain('APIKey');
  expect(Object.keys(sent)).not.toContain('Apikey');
  expect(Object.keys(sent)).not.toContain('aPIKey');
  expect(sent.APIKey).toBe(KEY);
});

test('бокс — Дуврська протока у порядку [lat, lon], вкладений тричі', () => {
  // BoundingBoxes — масив КОРОБОК, кожна з двох кутів, кожен кут — пара.
  // Приклад із whole-world боксом [[-180,-90],[180,90]] не розрізняє порядок
  // пари; документація й SPRINT-02:23 кажуть [lat, lon].
  const sent = JSON.parse(buildSubscription(KEY)) as { BoundingBoxes: number[][][] };

  expect(sent.BoundingBoxes).toEqual([[[50.75, 0.95], [51.25, 1.95]]]);

  // Широта першою: якщо переплутати, коробка поїде в Атлантику біля Гани, і
  // збір поверне порожньо при повністю справному з'єднанні.
  const [[[swLat, swLon], [neLat, neLon]]] = sent.BoundingBoxes;
  expect(swLat).toBeLessThan(neLat);
  expect(swLon).toBeLessThan(neLon);
  expect(swLat).toBeGreaterThan(50);   // протока, не екватор
  expect(swLon).toBeLessThan(10);      // Ла-Манш, не Індійський океан
});

test('фільтр — лише PositionReport', () => {
  const sent = JSON.parse(buildSubscription(KEY)) as { FilterMessageTypes: string[] };
  expect(sent.FilterMessageTypes).toEqual(['PositionReport']);
});

test('результат — рядок, готовий до send(), а не об\'єкт', () => {
  // Межа явна: JSON.stringify робиться ТУТ, щоб connect.ts не мав жодного
  // рішення про формат — він лише передає готовий рядок у сокет.
  const result = buildSubscription(KEY);
  expect(typeof result).toBe('string');
  expect(() => JSON.parse(result)).not.toThrow();
});

test('бокс береться з узгодженого регіону, а не з дубльованих чисел', () => {
  // Варта проти копіпасти координат: якщо хтось змінить DOVER_STRAIT_REGION,
  // підписка мусить поїхати за ним, а не лишитися зі старими числами.
  const sent = JSON.parse(buildSubscription(KEY)) as { BoundingBoxes: number[][][] };
  const flat = sent.BoundingBoxes.flat(2);
  expect(flat).toHaveLength(4);
  expect(new Set(flat).size).toBe(4); // жодне число не продубльоване помилково
});
```

- [ ] **Step 2: Запустити — має впасти**

```bash
npx playwright test --project=unit tests/unit/aisstream-subscription.spec.ts
```

Очікується: FAIL — модуль `@/shared/api/aisstream/subscription` не існує.

- [ ] **Step 3: Написати модуль**

Створити `src/shared/api/aisstream/subscription.ts`:

```ts
// Тіло підписки AISStream. Джерело: docs/tasks/SPRINT-02.md:23; звірено з живою
// документацією aisstream.io. Проєктне рішення §4.2.

import { DOVER_STRAIT_REGION } from '@/shared/config';

/**
 * Будує JSON-рядок підписки.
 *
 * ПОЛЕ КЛЮЧА — `APIKey`. Три джерела в репозиторії розходяться, і перемагає не
 * більшість, а дріт:
 *   - reference/aisstream-typescript-example/client.ts:11  → `Apikey`
 *   - reference/ais-message-models/models/SubscriptionMessage.ts:17 → `'aPIKey'`
 *   - той самий файл :27 → `"baseName": "APIKey"` — ім'я, яке реально летить
 * `aPIKey` — властивість згенерованого класу, не поле JSON; довідка того пакета
 * прямо наказує читати колонку baseName. Жива документація друкує `APIKey`.
 *
 * Помилка тут МОВЧАЗНА: джерело не відповідає «невірне поле», воно просто
 * закриває з'єднання, і симптом прочитається як збій мережі.
 *
 * Повертає РЯДОК, а не об'єкт: рішення про формат живе тут, а connect.ts лише
 * передає готове в сокет.
 */
export function buildSubscription(apiKey: string): string {
  const { south, west, north, east } = DOVER_STRAIT_REGION;

  return JSON.stringify({
    APIKey: apiKey,
    // Масив КОРОБОК; кожна — два кути; кожен кут — пара [lat, lon].
    // Порядок пари саме такий за документацією та SPRINT-02:23; переставлені
    // місцями числа дали б коробку біля Гани й порожній збір при справному сокеті.
    BoundingBoxes: [[[south, west], [north, east]]],
    FilterMessageTypes: ['PositionReport'],
  });
}
```

- [ ] **Step 4: Запустити — має пройти**

```bash
npx playwright test --project=unit tests/unit/aisstream-subscription.spec.ts
npm run verify
```

Очікується: PASS, 5 тестів; `verify` зелений. **Якщо `no-secrets` почервонів** — фікстура ключа в тесті не має префікса `EXAMPLE-`/`SAMPLE-`; виправити її, а не перевірку.

- [ ] **Step 5: Коміт**

```bash
git add src/shared/api/aisstream/subscription.ts tests/unit/aisstream-subscription.spec.ts
git commit -m "$(cat <<'EOF'
feat(aisstream): тіло підписки — APIKey, бокс протоки, фільтр позицій

Поле ключа APIKey, а не Apikey з офіційного прикладу й не aPIKey з
властивості згенерованого класу: на дроті летить baseName, і жива
документація з SPRINT-02:23 згодні саме на APIKey.

Винесено з connect.ts окремим модулем, бо connect.ts перевіряється
тільки живим запитом, а це — чиста функція на кожному прогоні.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Reader — строк, єдине завершення, прибирання

**Files:**
- Create: `src/shared/api/aisstream/reader.ts`
- Test: `tests/unit/aisstream-reader.spec.ts`

**Interfaces:**
- Consumes: `buildSubscription` (Task 3)
- Produces:
  - `type SocketHandlers = { onOpen: () => void; onMessage: (text: string) => void; onError: () => void; onClose: () => void }`
  - `type SocketHandle = { send: (text: string) => void; close: () => void }`
  - `type Connect = (handlers: SocketHandlers) => SocketHandle`
  - `type ReadErrorCode = 'connect_failed' | 'provider_error' | 'disconnected' | 'internal'`
  - `type ReadResult = { kind: 'message'; raw: unknown } | { kind: 'empty' } | { kind: 'error'; code: ReadErrorCode }`
  - `readFirstMessage(options: { connect: Connect; apiKey: string; windowMs: number; setTimer: (fn: () => void, ms: number) => TimerId; clearTimer: (id: TimerId) => void; signal?: AbortSignal }): Promise<ReadResult>`
  - `type TimerId = ReturnType<typeof setTimeout>`

**Це серце заходу.** Модуль не знає слова WebSocket: джерело подій і таймер приходять параметрами, тож уся сюїта біжить без мережі й без очікування 15 секунд.

- [ ] **Step 1: Написати падючий тест**

Створити `tests/unit/aisstream-reader.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import {
  readFirstMessage,
  type Connect,
  type SocketHandlers,
} from '@/shared/api/aisstream/reader';

const KEY = 'EXAMPLE-KEY-NOT-A-REAL-ONE';

/**
 * Керований стенд: збирає обробники, рахує close(), збирає надіслане й дає
 * ручний таймер. Жодного сокета, жодного справжнього часу — саме цього вимагає
 * SPRINT-02:28 («Джерело подій і годинник — параметри»).
 */
function stand() {
  let handlers: SocketHandlers | null = null;
  const sent: string[] = [];
  let closes = 0;
  const timers = new Map<number, () => void>();
  let nextId = 1;

  const connect: Connect = (h) => {
    handlers = h;
    return {
      send: (text) => sent.push(text),
      close: () => { closes += 1; },
    };
  };

  return {
    connect,
    sent,
    get closes() { return closes; },
    get handlers() {
      if (handlers === null) throw new Error('connect ще не викликано');
      return handlers;
    },
    setTimer: (fn: () => void, _ms: number) => {
      const id = nextId++;
      timers.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number);
    },
    /** Рухає час: викликає всі живі таймери. */
    fireTimers() {
      for (const fn of [...timers.values()]) fn();
    },
    get liveTimers() { return timers.size; },
  };
}

function run(s: ReturnType<typeof stand>, signal?: AbortSignal) {
  return readFirstMessage({
    connect: s.connect,
    apiKey: KEY,
    windowMs: 15_000,
    setTimer: s.setTimer,
    clearTimer: s.clearTimer,
    signal,
  });
}

test('підписка йде ПЕРШОЮ дією після відкриття', async () => {
  // Джерело дає 3 секунди на підписку й закриває з'єднання, якщо не встигнути.
  const s = stand();
  const promise = run(s);

  expect(s.sent).toHaveLength(0);   // до onOpen не шлемо нічого
  s.handlers.onOpen();
  expect(s.sent).toHaveLength(1);

  const body = JSON.parse(s.sent[0]) as { APIKey: string };
  expect(body.APIKey).toBe(KEY);

  s.handlers.onMessage('{"MessageType":"PositionReport"}');
  await promise;
});

test('перше повідомлення віддається СИРИМ, без розбору формату', async () => {
  // B-09 свідомо не розбирає формат: MetaData.time_utc з SPRINT-02:25 немає ні
  // в 46 згенерованих моделях, ні в живій документації, і правду дасть лише
  // зразок (B-10). Розбір — робота B-11, і тільки за зразком.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('{"MessageType":"PositionReport","MetaData":{"MMSI":123}}');

  const result = await promise;
  expect(result).toEqual({
    kind: 'message',
    raw: { MessageType: 'PositionReport', MetaData: { MMSI: 123 } },
  });
});

test('SubscriptionConfirmation теж вважається першим повідомленням', async () => {
  // SPRINT-02:23 стверджує, що підтвердження не надсилається; жива документація
  // каже протилежне. Розходження прийняте свідомо (§4.2 рішення): завдання
  // каже «перше отримане повідомлення як є», і фільтрація за MessageType була б
  // уже розбором формату, тобто роботою B-11.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('{"MessageType":"SubscriptionConfirmation"}');

  const result = await promise;
  expect(result).toEqual({
    kind: 'message',
    raw: { MessageType: 'SubscriptionConfirmation' },
  });
});

test('строк без повідомлень при живому з\'єднанні — empty, НЕ помилка', async () => {
  // Порожній успіх і помилка — різні речі, і інтерфейс скаже про них різними
  // словами: «За час збору позицій не отримано» проти «Не вдалося отримати дані».
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.fireTimers();

  expect(await promise).toEqual({ kind: 'empty' });
});

test('закриття ДО підписки — connect_failed', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onClose();   // onOpen не було

  expect(await promise).toEqual({ kind: 'error', code: 'connect_failed' });
});

test('закриття ПІСЛЯ підписки — disconnected', async () => {
  // Розрізнення за фактом надісланої підписки, дослівно за SPRINT-02:29.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onClose();

  expect(await promise).toEqual({ kind: 'error', code: 'disconnected' });
});

test('помилка сокета — provider_error', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onError();

  expect(await promise).toEqual({ kind: 'error', code: 'provider_error' });
});

test('нерозбірне повідомлення — internal, а не падіння', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('це не JSON');

  expect(await promise).toEqual({ kind: 'error', code: 'internal' });
});

test('РЕЗУЛЬТАТ ЗАВЕРШУЄТЬСЯ РІВНО ОДИН РАЗ — пастка «проміс резолвиться двічі»', async () => {
  // SPRINT-02:92 називає її прямо. Після першого повідомлення шлемо ще одне,
  // помилку, закриття і строк — результат не має змінитися.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('{"n":1}');

  s.handlers.onMessage('{"n":2}');
  s.handlers.onError();
  s.handlers.onClose();
  s.fireTimers();

  expect(await promise).toEqual({ kind: 'message', raw: { n: 1 } });
});

test('прибирання на КОЖНОМУ результаті — сокет закритий, таймер знятий', async () => {
  // Друга й третя пастки SPRINT-02:92: таймер вікна не очищається; ресурси
  // течуть. Перевіряємо всі чотири виходи, а не лише щасливий.
  for (const drive of [
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onMessage('{"n":1}'); },
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.fireTimers(); },
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onError(); },
    (s: ReturnType<typeof stand>) => { s.handlers.onClose(); },
  ]) {
    const s = stand();
    const promise = run(s);
    drive(s);
    await promise;

    expect(s.closes).toBe(1);        // рівно раз, не двічі й не нуль
    expect(s.liveTimers).toBe(0);    // таймер знятий
  }
});

test('скасування запиту закриває ресурси й дає internal', async () => {
  // SPRINT-02:43 вимагає закриття «при завершенні, помилці ТА СКАСУВАННІ».
  const s = stand();
  const controller = new AbortController();
  const promise = run(s, controller.signal);
  s.handlers.onOpen();

  controller.abort();

  expect(await promise).toEqual({ kind: 'error', code: 'internal' });
  expect(s.closes).toBe(1);
  expect(s.liveTimers).toBe(0);
});

test('ключ не тече у результат — ні в успіху, ні в помилці', async () => {
  // Критерій B-09: «ключ не в логах і відповіді».
  for (const drive of [
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onMessage('{"n":1}'); },
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onError(); },
  ]) {
    const s = stand();
    const promise = run(s);
    drive(s);
    const result = await promise;

    expect(JSON.stringify(result)).not.toContain(KEY);
  }
});
```

- [ ] **Step 2: Запустити — має впасти**

```bash
npx playwright test --project=unit tests/unit/aisstream-reader.spec.ts
```

Очікується: FAIL — модуль `@/shared/api/aisstream/reader` не існує.

- [ ] **Step 3: Написати модуль**

Створити `src/shared/api/aisstream/reader.ts`:

```ts
// Reader: відкриває з'єднання ЧУЖИМИ руками, шле підписку, віддає перше
// повідомлення сирим. Джерело: docs/tasks/SPRINT-02.md:43, :29; проєктне
// рішення §4.2, §4.3.
//
// ЦЕЙ МОДУЛЬ НЕ ЗНАЄ СЛОВА WebSocket. Джерело подій і таймер — параметри, і це
// не стиль, а те, що робить сюїту вище здійсненною без мережі й без очікування
// 15 секунд. B-12 успадкує цю саму межу й змінить лише логіку накопичення.

import { buildSubscription } from './subscription';

export type SocketHandlers = {
  onOpen: () => void;
  onMessage: (text: string) => void;
  onError: () => void;
  onClose: () => void;
};

export type SocketHandle = {
  send: (text: string) => void;
  close: () => void;
};

export type Connect = (handlers: SocketHandlers) => SocketHandle;

export type TimerId = ReturnType<typeof setTimeout>;

export type ReadErrorCode =
  | 'connect_failed'
  | 'provider_error'
  | 'disconnected'
  | 'internal';

export type ReadResult =
  | { kind: 'message'; raw: unknown }
  | { kind: 'empty' }
  | { kind: 'error'; code: ReadErrorCode };

export type ReadOptions = {
  connect: Connect;
  apiKey: string;
  windowMs: number;
  setTimer: (fn: () => void, ms: number) => TimerId;
  clearTimer: (id: TimerId) => void;
  signal?: AbortSignal;
};

export function readFirstMessage(options: ReadOptions): Promise<ReadResult> {
  const { connect, apiKey, windowMs, setTimer, clearTimer, signal } = options;

  return new Promise<ReadResult>((resolve) => {
    // ЄДИНИЙ сторож на всі шляхи виходу. SPRINT-02:92 називає пастку прямо:
    // «проміс резолвиться двічі». Пізні події після завершення — норма, а не
    // аномалія: сокет закривається асинхронно й устигає крикнути onClose.
    let settled = false;
    let subscribed = false;
    let handle: SocketHandle | null = null;
    let timerId: TimerId | null = null;

    /** Прибирання ідемпотентне й живе в ОДНОМУ місці — на завершенні. */
    const settle = (result: ReadResult) => {
      if (settled) return;
      settled = true;

      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
      signal?.removeEventListener('abort', onAbort);
      try {
        handle?.close();
      } catch {
        // Закриття вже закритого сокета не має перетворювати успішний
        // результат на помилку: дані вже зібрані, ресурс уже звільнений.
      }

      resolve(result);
    };

    function onAbort() {
      settle({ kind: 'error', code: 'internal' });
    }

    if (signal?.aborted) {
      // Запит скасовано ще до того, як ми торкнулися мережі.
      settle({ kind: 'error', code: 'internal' });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      handle = connect({
        onOpen: () => {
          // ПЕРШОЮ дією: джерело дає 3 секунди й мовчки закриває з'єднання,
          // якщо підписка не встигла.
          try {
            handle?.send(buildSubscription(apiKey));
            subscribed = true;
          } catch {
            settle({ kind: 'error', code: 'connect_failed' });
          }
        },

        onMessage: (text) => {
          // Формат НЕ розбирається — лише JSON.parse. Яке саме це повідомлення,
          // вирішить B-11 за зразком із B-10.
          try {
            settle({ kind: 'message', raw: JSON.parse(text) });
          } catch {
            settle({ kind: 'error', code: 'internal' });
          }
        },

        onError: () => settle({ kind: 'error', code: 'provider_error' }),

        // Закриття ДО підписки — не дійшли; ПІСЛЯ — розірвали. Дослівно :29.
        onClose: () => settle({
          kind: 'error',
          code: subscribed ? 'disconnected' : 'connect_failed',
        }),
      });
    } catch {
      settle({ kind: 'error', code: 'connect_failed' });
      return;
    }

    // Строк відлічується від ПОЧАТКУ обробки, включно зі з'єднанням і
    // підпискою (SPRINT-02:28), тому таймер ставиться тут, а не в onOpen.
    timerId = setTimer(() => {
      // Вікно минуло. Якщо підписки так і не було — ми не дійшли до джерела,
      // і це connect_failed, а не порожній успіх.
      settle(subscribed ? { kind: 'empty' } : { kind: 'error', code: 'connect_failed' });
    }, windowMs);
  });
}
```

- [ ] **Step 4: Запустити — має пройти**

```bash
npx playwright test --project=unit tests/unit/aisstream-reader.spec.ts
```

Очікується: PASS, 12 тестів.

- [ ] **Step 5: Довести варти мутацією**

Це не формальність: тест, який не падає від зламаного коду, нічого не доводить. Для кожної мутації — зламати, переконатися в падінні названого тесту, **повернути**.

```bash
# Мутація 1: прибрати сторож settled (рядок `if (settled) return;`)
#   має впасти «РЕЗУЛЬТАТ ЗАВЕРШУЄТЬСЯ РІВНО ОДИН РАЗ»
# Мутація 2: замінити `subscribed ? 'disconnected' : 'connect_failed'` на 'disconnected'
#   має впасти «закриття ДО підписки — connect_failed»
# Мутація 3: прибрати clearTimer із settle
#   має впасти «прибирання на КОЖНОМУ результаті»
# Мутація 4: у onMessage повернути { kind: 'empty' } замість розбору
#   має впасти «перше повідомлення віддається СИРИМ»
npx playwright test --project=unit tests/unit/aisstream-reader.spec.ts
```

Якщо якась мутація **не** валить жодного тесту — варти на неї немає; дописати тест перед комітом.

- [ ] **Step 6: Коміт**

```bash
git add src/shared/api/aisstream/reader.ts tests/unit/aisstream-reader.spec.ts
git commit -m "$(cat <<'EOF'
feat(aisstream): reader зі строком і єдиним завершенням (B-09)

Джерело подій і таймер — параметри, тож уся сюїта біжить без мережі й
без очікування 15 секунд. Модуль не знає слова WebSocket; B-12
успадкує цю межу й змінить лише логіку накопичення.

Три пастки SPRINT-02:92 адресовані формою, а не уважністю: один
сторож settled на всі виходи, прибирання в одному місці, таймер
знімається на кожному результаті. Закриття до підписки —
connect_failed, після — disconnected.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Бойовий `connect` — єдиний модуль із WebSocket

**Files:**
- Create: `src/shared/api/aisstream/connect.ts`

**Interfaces:**
- Consumes: `Connect`, `SocketHandlers`, `SocketHandle` (Task 4); `AISSTREAM_ENDPOINT` (Task 2)
- Produces: `liveConnect: Connect`

**Юніт-тесту немає — свідомо.** Цей модуль є адаптером до платформного API; будь-який його тест перевіряв би підмінку, а не сокет. Доводиться він живим запитом у Task 7 і збіркою в Task 6. Це названо в §6 спеки й піде в checkpoint.

- [ ] **Step 1: Написати модуль**

Створити `src/shared/api/aisstream/connect.ts`:

```ts
// ЄДИНИЙ модуль проєкту, який знає слово WebSocket. Усе, що вище — reader,
// адаптер, endpoint — працює з межею Connect і про транспорт не здогадується.
//
// Джерело: документація aisstream.io; проєктне рішення §4.2.

import { AISSTREAM_ENDPOINT } from '@/shared/config';

import type { Connect, SocketHandle, SocketHandlers } from './reader';

/**
 * Відкриває справжній сокет.
 *
 * Залежності `ws` НЕМАЄ і не буде: вбудований WebSocket Node 24 сам пропонує
 * permessage-deflate. Виміряно заголовками рукостискання на локальному сервері:
 *   sec-websocket-extensions: permessage-deflate; client_max_window_bits
 * Офіційний приклад aisstream тягне `ws` рівно заради `perMessageDeflate: true`;
 * нам це не потрібно, і тому в цьому заході нуль нових пакетів.
 */
export const liveConnect: Connect = (handlers: SocketHandlers): SocketHandle => {
  const socket = new WebSocket(AISSTREAM_ENDPOINT);

  // РЯДОК, БЕЗ ЯКОГО B-09 ПАДАЄ МОВЧКИ.
  //
  // Документація: «The server sends binary WebSocket frames containing UTF-8
  // JSON». Виміряно на Node 24.21 проти локального сервера, що шле бінарний
  // фрейм:
  //   binaryType за замовчуванням : 'blob'
  //   event.data                  : Blob
  //   JSON.parse(event.data)      : SyntaxError
  // Blob синхронно не читається, а офіційний приклад робить саме
  // `JSON.parse(event.data.toString())` — і на Node без `ws` це дало б рядок
  // "[object Blob]". Перемикання мусить статися ДО підписки на події.
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => handlers.onOpen());

  socket.addEventListener('message', (event: MessageEvent) => {
    const { data } = event;
    // Після binaryType='arraybuffer' очікуємо саме ArrayBuffer; рядок теж
    // приймаємо — джерело має право надіслати текстовий фрейм, і відкидати
    // його було б вигадкою понад документацію.
    const text = typeof data === 'string'
      ? data
      : new TextDecoder().decode(data as ArrayBuffer);

    handlers.onMessage(text);
  });

  socket.addEventListener('error', () => handlers.onError());
  socket.addEventListener('close', () => handlers.onClose());

  return {
    send: (text: string) => socket.send(text),
    close: () => {
      // Закриття сокета, який ще не відкрився, кидає InvalidStateError.
      // Ковтаємо: reader кличе close() на КОЖНОМУ результаті, включно з
      // «не змогли підключитися», і там сокет саме в цьому стані.
      try {
        socket.close();
      } catch {
        // ресурс і так непридатний
      }
    },
  };
};
```

- [ ] **Step 2: Перевірити типи й правила**

```bash
npm run check-types
npm run lint
npm run verify
```

Очікується: усе зелене. Якщо `check-types` скаржиться на `socket.binaryType` — перевірити, що `lib` у `tsconfig.json` містить `DOM` (містить: `["DOM", "DOM.Iterable", "ES2022"]`).

- [ ] **Step 3: Коміт**

```bash
git add src/shared/api/aisstream/connect.ts
git commit -m "$(cat <<'EOF'
feat(aisstream): бойовий connect — єдиний модуль із WebSocket

binaryType='arraybuffer' до підписки на події. Виміряно на Node 24.21:
за замовчуванням 'blob', event.data приходить Blob, і JSON.parse кидає
SyntaxError на бінарному фреймі — рівно на тому, що шле AISStream.
Жодна з довідок у reference/ про це не попереджає.

Залежності ws немає: вбудований клієнт сам пропонує permessage-deflate
(виміряно заголовками рукостискання).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Endpoint `GET /api/snapshot`

**Files:**
- Create: `src/_app/api-routes/snapshot.ts`
- Create: `app/api/snapshot/route.ts`

**Interfaces:**
- Consumes: `readFirstMessage`, `ReadResult` (Task 4); `liveConnect` (Task 5); `readApiKey`, `SNAPSHOT_WINDOW_SECONDS` (Task 2)
- Produces: `getSnapshot(request: Request): Promise<Response>`

- [ ] **Step 1: Написати адаптер**

Створити `src/_app/api-routes/snapshot.ts`:

```ts
// Адаптер: юніон результату → HTTP-статус і тіло. Джерело: SPRINT-02.md:29
// (проміжна форма B-09), проєктне рішення §4.4.

import { liveConnect } from '@/shared/api/aisstream/connect';
import { readFirstMessage, type ReadErrorCode } from '@/shared/api/aisstream/reader';
import { readApiKey, SNAPSHOT_WINDOW_SECONDS } from '@/shared/config';

/**
 * Тексти помилок — ЛІТЕРАЛИ зі SPRINT-02:29, дослівно. Вони частина контракту
 * для тестів B-13, тож переформульовувати їх «красивіше» не можна.
 *
 * Сирий текст помилки провайдера сюди НЕ потрапляє — причина та сама, що в
 * no-secrets: діагностика, яка друкує чуже, друкує й ключ.
 */
const ERROR_MESSAGES: Record<ReadErrorCode | 'no_api_key', string> = {
  no_api_key: 'Ключ AISStream не налаштовано',
  connect_failed: 'Не вдалося підключитися до джерела',
  provider_error: 'Джерело повернуло помилку',
  disconnected: "З'єднання з джерелом розірвано",
  internal: 'Внутрішня помилка сервера',
};

function errorResponse(code: ReadErrorCode | 'no_api_key'): Response {
  // 502 навіть для no_api_key, хоч це конфігурація, а не збій шлюзу: завдання
  // перелічує його серед кодів помилки одним списком, а тексти — контракт.
  return Response.json(
    {
      ok: false,
      attemptedAt: new Date().toISOString(),
      error: { code, message: ERROR_MESSAGES[code] },
    },
    { status: 502 },
  );
}

export async function getSnapshot(request: Request): Promise<Response> {
  const key = readApiKey();
  if (key.status === 'missing') return errorResponse('no_api_key');

  const result = await readFirstMessage({
    connect: liveConnect,
    apiKey: key.apiKey,
    windowMs: SNAPSHOT_WINDOW_SECONDS * 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    signal: request.signal,
  });

  if (result.kind === 'error') return errorResponse(result.code);

  // Проміжна форма B-09: { ok, raw, collectedAt }. Порожній успіх — те саме
  // з raw: null, а НЕ помилка: «за строк при живому з'єднанні повідомлень не
  // було» — це чесний результат, і інтерфейс скаже про нього іншими словами.
  return Response.json({
    ok: true,
    raw: result.kind === 'message' ? result.raw : null,
    collectedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Написати Route Handler**

Створити `app/api/snapshot/route.ts`:

```ts
// Тонкий route-файл: жодної логіки, лише сегментні константи й реекспорт.
// Розкладка — за скілом feature-sliced-design, розділ Next.js App Router.

// ОБИДВА рядки мусять стояти ЛІТЕРАЛАМИ саме тут: Next читає сегментну
// конфігурацію статичним аналізом файлу, і реекспортом вони не приїдуть.
//
// 'nodejs' — вимога SPRINT-02:23; на Edge немає ні вбудованого сокета в
// потрібному вигляді, ні Node-таймерів, якими користується адаптер.
export const runtime = 'nodejs';

// 'force-dynamic' не декоративний: знімок за визначенням не можна віддати з
// кешу. У Next 15+ GET-хендлери не кешуються за замовчуванням, але покладатися
// на замовчування там, де помилка тиха (старий знімок замість нового), не можна.
export const dynamic = 'force-dynamic';

export { getSnapshot as GET } from '@/_app/api-routes/snapshot';
```

- [ ] **Step 3: Перевірити збіркою — це і є доказ**

```bash
npm run check-types
npm run build
```

Очікується: збірка проходить; у виводі маршрут `/api/snapshot` позначений динамічним (`ƒ`), не статичним (`○`). **Якщо позначений статичним** — `dynamic` не прочитано; перевірити, що обидві константи в самому `route.ts` літералами.

- [ ] **Step 4: Перевірити без ключа — критерій B-08 і B-09**

```bash
# ВАЖЛИВО: тимчасово прибрати ключ. Перейменування, а не видалення.
mv .env.local .env.local.off 2>/dev/null || true
npm run dev &
sleep 4
curl -s -i http://127.0.0.1:3000/api/snapshot | head -20
kill %1
mv .env.local.off .env.local 2>/dev/null || true
```

Очікується дослівно:
```
HTTP/1.1 502 Bad Gateway
...
{"ok":false,"attemptedAt":"…","error":{"code":"no_api_key","message":"Ключ AISStream не налаштовано"}}
```

Це дослівний критерій B-08 («після B-09 без ключа endpoint відповідає `no_api_key`»).

- [ ] **Step 5: Повна перевірка**

```bash
npm run verify:full
```

Очікується: усе зелене, включно з `e2e` (B-07 не мав зламатися — серверний код не торкався карти).

- [ ] **Step 6: Коміт**

```bash
git add src/_app/api-routes/snapshot.ts app/api/snapshot/route.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/snapshot у проміжній формі B-09

Тексти помилок — літерали зі SPRINT-02:29; сирий текст від провайдера
у відповідь не потрапляє. 502 навіть для no_api_key: завдання
перелічує його серед кодів помилки, а тексти — контракт для B-13.

runtime і dynamic стоять літералами в route.ts: Next читає сегментну
конфігурацію статичним аналізом, і реекспортом вони не приїдуть.

Порожній успіх — raw: null зі статусом 200, а не помилка.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Живий запит, зразок і провенанс (B-10)

**Files:**
- Create: `data/samples/position-report.sample.json`
- Create: `data/samples/PROVENANCE.md`

**Interfaces:**
- Consumes: працюючий endpoint (Task 6)
- Produces: зразок, за яким B-11 писатиме перетворювач

- [ ] **Step 1: ЗУПИНКА — людина читає код перед живим запитом**

**Не крок агента.** `SPRINT-02.md:88`: «Живий запит виконується тільки після того, як людина прочитала серверний код, який читає ключ; сам запит може зробити агент».

Повідомити людині:

> Перед живим запитом прочитайте, будь ласка, два файли — це перший раз, коли код торкнеться справжнього ключа:
> - `src/shared/config/aisstream.ts` — що робимо з ключем;
> - `src/shared/api/aisstream/connect.ts` і `subscription.ts` — куди він іде.
>
> Ключ має бути в `.env.local`, а `.env` — видалений. Скажіть, коли можна робити запит.

Далі не рухатись без підтвердження.

- [ ] **Step 2: Живий запит**

```bash
npm run dev &
sleep 4
curl -s http://127.0.0.1:3000/api/snapshot -o /tmp/snapshot-response.json -w 'HTTP %{http_code}\n'
kill %1
node -e "
const r = JSON.parse(require('fs').readFileSync('/tmp/snapshot-response.json','utf8'));
console.log('ok       :', r.ok);
console.log('raw      :', r.raw === null ? 'null (порожній успіх)' : 'є повідомлення');
console.log('тип      :', r.raw?.MessageType ?? '—');
console.log('помилка  :', r.error?.code ?? '—');
"
```

Три результати, і **всі три законні**:
- `ok: true`, `raw` із повідомленням → Step 3 гілкою «живий зразок»;
- `ok: true`, `raw: null` → джерело мовчало; Step 3 гілкою «синтетичний»;
- `ok: false` → помилка; записати код, за потреби повторити пізніше.

- [ ] **Step 3: Зберегти зразок**

Гілка А — **отримано живе повідомлення**. Зберегти `r.raw` у вихідній структурі:

```bash
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('/tmp/snapshot-response.json','utf8'));
if (!r.raw) { console.error('raw порожній — гілка Б'); process.exit(1); }
fs.mkdirSync('data/samples', { recursive: true });
fs.writeFileSync('data/samples/position-report.sample.json',
  JSON.stringify(r.raw, null, 2) + '\n');
console.log('збережено; поля MetaData:', Object.keys(r.raw.MetaData ?? {}).join(', '));
"
```

Гілка Б — **живого не вийшло**. Створити `data/samples/position-report.sample.json` за схемою документації, з обов'язковим маркером:

```json
{
  "_note": "НЕ ОТРИМАНИЙ ІЗ ЖИВОГО ДЖЕРЕЛА — приклад за схемою документації aisstream.io. Див. PROVENANCE.md.",
  "MessageType": "PositionReport",
  "MetaData": {
    "MMSI": 368207620,
    "ShipName": "EXAMPLE VESSEL",
    "Latitude": 51.0,
    "Longitude": 1.45
  },
  "Message": {
    "PositionReport": {
      "Sog": 12.4,
      "Cog": 86.7,
      "TrueHeading": 87,
      "Latitude": 51.0,
      "Longitude": 1.45,
      "Valid": true
    }
  }
}
```

- [ ] **Step 4: Написати провенанс**

Створити `data/samples/PROVENANCE.md`. **Три факти розділені явно** — дослівна вимога `SPRINT-02.md:88`. Заповнити кутові дужки справжніми значеннями; жодна не має лишитися:

```markdown
# Провенанс зразка

Файл: `position-report.sample.json`

## Три факти, які не можна змішувати

| Факт | Так / Ні | Чим підтверджено |
| --- | --- | --- |
| З'єднання відкрилося | <так/ні> | <HTTP-код відповіді endpoint> |
| Повідомлення отримано | <так/ні> | <`raw` непорожній / `raw: null`> |
| Локальний код перевірено | так | `npm run verify:full` — зелений |

«Сокет відкрився» не означає «дані є»: порожній успіх при живому з'єднанні —
законний результат, і інтерфейс скаже про нього іншими словами, ніж про помилку.

## Обставини

- **Час отримання (UTC):** <ISO 8601 з `collectedAt` відповіді>
- **Район:** Дуврська протока, бокс `[[50.75, 0.95], [51.25, 1.95]]` у порядку `[lat, lon]`
- **Фільтр:** `FilterMessageTypes: ["PositionReport"]`
- **Строк збору:** 15 секунд
- **Живе отримання:** <ТАК / НІ — приклад за схемою, не отриманий із живого джерела>

## Відмінності від документації

Заповнити за фактом; порожній розділ не лишати — якщо відмінностей немає, так і написати.

- **`MetaData.time_utc`:** <є / немає; якщо є — дослівний формат значення>
  Контекст: поля немає ні в 46 моделях `reference/ais-message-models/`
  (`grep -rn "time_utc"` → жодного збігу), ні в прикладі живої документації.
  `SPRINT-02.md:25` описує його як джерело для `timestamp` — саме це
  розходження B-10 і мав розв'язати.
- **Регістр координат у `MetaData`:** <`Latitude` / `latitude`>
  Документація друкує з великої, `SPRINT-02.md:25` пише з малої.
- **Перше повідомлення було `SubscriptionConfirmation`:** <так / ні>
  `SPRINT-02.md:23` стверджує, що підтвердження не надсилається; жива
  документація каже протилежне. Цей рядок — вимір, а не думка.
- **Інші розбіжності:** <перелічити або «не виявлено»>

## Умови сервісу

Станом на <дата> на `aisstream.io` **не знайдено** сторінки Terms of Service:
головна не містить посилання на умови, `aisstream.io/terms` віддає HTTP 404.
`PROJECT_BRIEF.md:151` просив перевірити умови перед використанням — перевірка
виконана, результат негативний, і це записано, а не замовчано.

## Чим цей файл є і чим не є

Це **вхідні дані для B-11**: `SPRINT-02.md:90` вимагає, щоб перетворювач писався
за зразком, а не за документацією. Не архів, не колекція, не тестова фікстура за
призначенням.
```

- [ ] **Step 5: Перевірити, що ключа у зразку немає**

```bash
npm run verify
node -e "
const s = require('fs').readFileSync('data/samples/position-report.sample.json','utf8');
console.log('APIKEY у зразку:', /apikey/i.test(s) ? 'ЗНАЙДЕНО — СТОП' : 'немає');
"
```

Очікується: `verify` зелений (рядок `no-secrets` просканує `data/samples/` як частину периметра передачі); слово `apikey` у зразку відсутнє.

- [ ] **Step 6: Коміт**

```bash
git add data/samples/
git commit -m "$(cat <<'EOF'
docs(samples): зразок PositionReport і провенанс (B-10)

Провенанс розділяє три факти, які SPRINT-02:88 наказує не змішувати:
з'єднання відкрилося; повідомлення отримано; локальний код перевірено.
Порожній успіх при живому з'єднанні — законний результат, і він
записаний як такий, а не як невдача.

Розділ «Відмінності від документації» фіксує вимірами те, що
дослідження лишило відкритим: наявність і формат MetaData.time_utc,
регістр координат, чи прийшов SubscriptionConfirmation першим.

Умови сервісу: сторінки Terms на aisstream.io не знайдено (головна без
посилання, /terms → 404). PROJECT_BRIEF:151 просив перевірити — і
негативний результат записаний, а не замовчаний.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Звіт людині — трьома окремими твердженнями**

Не «усе працює». Дослівно розділити:

> 1. **З'єднання:** <відкрилося / не відкрилося>, HTTP <код>.
> 2. **Повідомлення:** <отримано / за 15 секунд не надійшло>. Тип: <MessageType або «—»>.
> 3. **Локальний код:** `npm run verify:full` — <результат>, <N> тестів.
>
> Відмінності від документації, знайдені зразком: <перелік або «зразок не отримано, розділ заповнено за гілкою Б»>.

---

## Що НЕ робиться цим планом

Перетворювач `PositionReport` → `Vessel` (B-11), збирач із дедуплікацією та лімітом (B-12), кнопка й стани інтерфейсу (B-13). Карта, демонстраційний флот, `playwright.config.ts` і реєстр перевірок не чіпаються жодним рядком.

Автоматичних тестів на правила **збору** немає свідомо: `SPRINT-02.md:59` відносить їх до R3 — «цього тижня правила реалізовані й перевірені вручну — так і записується в checkpoint».

Юніт-тесту на `connect.ts` немає свідомо (Task 5): він адаптер до платформного API, і тест перевіряв би підмінку, а не сокет.

---

## Для запису checkpoint 03

Готове в `docs/context/verify-layer.md` формулювання доповнюється трьома відхиленнями зі §7 спеки:

1. `SPRINT-02:23` «підтвердження підписки не надсилається» — документація каже протилежне; B-09 віддає перше повідомлення як є, включно з підтвердженням.
2. `SPRINT-02:84` «глобом з винятком deny не виражається» — для CLI 2.1.278 неправда; явний перелік лишено як вибір, не як обмеження.
3. `SPRINT-02:25` `MetaData.time_utc` — поля немає ні в моделях, ні в документації; розв'язано зразком B-10, результат у провенансі.

Плюс дві названі межі: deny-правила не покривають `grep -r` і сторонні процеси (§3.6); рух і правила збору автоматично не перевіряються (R3).
