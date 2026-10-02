# R4 — не втрачати картину у разі збою: план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Розділити «показаний набір» і «результат останньої спроби» на два незалежні стани (B-18), довести це браузерними тестами (B-19), пройти приймання (B-20), написати README (B-21) і запис CHECKPOINT-03b.

**Architecture:** У `VesselView` один `LoadState` замінюють два `useState`, `Shown` і `Attempt`. Тексти рядка спроби рахує чиста функція `attemptLine` у новому `lib/attempt-line.ts`. Панель отримує рядок спроби й постійну підказку поза `.body`. Інтеграція (`fetchSnapshot`, endpoint), карта й картка не змінюються.

**Tech Stack:** Node 24 · TypeScript 6 strict · Next.js 16 App Router · React · Leaflet 1.9.4 · Playwright Test (проєкти `unit` і `e2e`).

**Spec:** `docs/superpowers/specs/2026-10-02-r4-change-request-design.md`. Завдання: `docs/tasks/SPRINT-03b-CHANGE-REQUEST.md` (далі CR).

## Global Constraints

- Колишня поведінка — узгоджене правило R2, не баг. У комітах і коментарях пишемо «нова вимога R4», не «виправлення».
- Тексти — літерали з CR, дослівно: `Завантаження…` (U+2026), `Спроба HH:MM:SS UTC: …`, `Спроба: не вдалося отримати дані: Немає відповіді сервера`, `Після оновлення сторінки знову показуються демонстраційні дані`.
- Усі часи інтерфейсу — з тіл відповідей (`collectedAt`, `attemptedAt`), ніколи з `Date.now()` браузера.
- Нових залежностей немає. Жодного `import` з `reference/`.
- `movement.spec.ts`, `select.spec.ts`, `tile-cache.spec.ts` і тест `snapshot.spec.ts` «успіх, судно без швидкості й курсу» — **без жодної правки**.
- `waitForTimeout` у тестах заборонений; час сторінки рухає лише `page.clock`.
- Перед кожним `--project=e2e` порт 3000 має бути вільний: `lsof -iTCP:3000 -sTCP:LISTEN` дає порожньо. Інакше `reuseExistingServer` перевірятиме чужий сервер.
- Завжди передавай `--project`. Голий `npx playwright test` не піднімає dev-сервер.
- Значення ключа AISStream агент не читає, не шукає й не друкує.
- Коментарі в коді — українською, тієї ж щільності, що й у сусідніх файлах. Багаторядкові коментарі в TSX — лише `//` над розміткою, ніколи `{/* … */}` (`vessel-panel.tsx:10-16`). Кожен рядок CSS-коментаря починається з `*`.
- Коміти закінчуються рядком `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Гілка — `sprint-03b`. Тег і GitHub Release створює людина, агент — ні.

## Review Focus

1. **Кнопка, натиснута, поки демо ще рухається, а відповідь — порожній успіх.** Демо має рухатися далі, підпис «Демонстраційні дані». Тест: Task 3, «порожній успіх при демонстрації».
2. **Обране демо-судно, а прийшов непорожній успіх.** `demo-1` у новому наборі немає, тож картка закривається, а не показує застаріле демо-судно. Тест: Task 3, «обране демо-судно після успіху».
3. **Вибір під час очікування.** Картка обраного судна лишається відкритою, поки запит триває (D6). Тест: Task 3, сценарій 2.
4. **Повторний збій після збою.** Рядок спроби показує новий час, а набір і підпис — і далі останній успіх. Тест: Task 3, сценарій 4 (помилка після порожньої).
5. **Згорнута панель.** Рядок спроби й підказку видно і в згорнутій панелі. Тест: Task 3, сценарій 12.

---

## Карта файлів

| Файл | Дія | Відповідальність |
| --- | --- | --- |
| `src/_pages/home/lib/attempt-line.ts` | створити | тип `Attempt` і чиста функція `attemptLine` — усі тексти рядка спроби |
| `tests/unit/attempt-line.spec.ts` | створити | шість текстів літералами |
| `src/_pages/home/ui/vessel-view.tsx` | змінити | два стани `Shown` і `Attempt`, новий `handleLoad` |
| `src/_pages/home/ui/vessel-panel.tsx` | змінити | проп `attempt`, рядок спроби й підказка поза `.body` |
| `src/_pages/home/ui/vessel-panel.module.css` | змінити | `.notice` → `.attempt`, новий `.hint` |
| `tests/e2e/snapshot.spec.ts` | змінити | 12 сценаріїв CR `:42…:53` |
| `README.md` | створити | B-21 |
| `docs/checkpoints/CHECKPOINT-03b.md` | створити | запис checkpoint |
| `CLAUDE.md` | змінити | `Status`, перелік checkpoint, порядок панелі |

---

### Task 1: Тексти рядка спроби — `attemptLine`

**Files:**
- Create: `src/_pages/home/lib/attempt-line.ts`
- Test: `tests/unit/attempt-line.spec.ts`

**Interfaces:**
- Consumes: `formatTimestamp(timestamp: string): string` і `type SnapshotResponse` з `@/entities/vessel`; `NO_SERVER_RESPONSE` з `./snapshot-caption`.
- Produces:
  ```ts
  export type Attempt =
    | { kind: 'none' }
    | { kind: 'loading' }
    | { kind: 'done'; response: SnapshotResponse | null };
  export function attemptLine(attempt: Attempt): string | null;
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/attempt-line.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

import { attemptLine } from '@/_pages/home/lib/attempt-line';

// Рядок результату спроби, CR :25…:28. Очікування — літерали з завдання;
// час — з тіла відповіді, тому в кожному випадку він свій і не 12:00:00
// за збігом.

const SUCCESS = {
  ok: true as const,
  vessels: [],
  collectedAt: '2026-01-01T12:00:00.000Z',
  windowSeconds: 15,
  count: 3,
  truncated: false,
  reason: 'window_elapsed' as const,
};

test('до першого натискання рядка немає', () => {
  expect(attemptLine({ kind: 'none' })).toBeNull();
});

test('очікування: "Завантаження…"', () => {
  expect(attemptLine({ kind: 'loading' })).toBe('Завантаження…');
});

test('непорожній успіх: час collectedAt і кількість', () => {
  expect(attemptLine({ kind: 'done', response: SUCCESS })).toBe(
    'Спроба 12:00:00 UTC: отримано суден: 3',
  );
});

test('порожній успіх: час collectedAt', () => {
  expect(
    attemptLine({
      kind: 'done',
      response: { ...SUCCESS, count: 0, collectedAt: '2026-01-01T12:01:00.000Z' },
    }),
  ).toBe('Спроба 12:01:00 UTC: за час збору позицій не отримано');
});

test('помилка: час attemptedAt і message з відповіді', () => {
  expect(
    attemptLine({
      kind: 'done',
      response: {
        ok: false,
        attemptedAt: '2026-01-01T12:02:03.000Z',
        error: { code: 'no_api_key', message: 'Ключ AISStream не налаштовано' },
      },
    }),
  ).toBe('Спроба 12:02:03 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано');
});

test('немає відповіді: без часу', () => {
  expect(attemptLine({ kind: 'done', response: null })).toBe(
    'Спроба: не вдалося отримати дані: Немає відповіді сервера',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/attempt-line.spec.ts`
Expected: FAIL — модуль `@/_pages/home/lib/attempt-line` не знайдено.

- [ ] **Step 3: Write minimal implementation**

`src/_pages/home/lib/attempt-line.ts`:

```ts
// Рядок результату останньої спроби, CR :25…:28 дослівно. Чиста функція без
// React, як `snapshot-caption.ts`: юніт-проєкт пінить тексти літералами, а
// панель лише показує результат.
//
// Це ДРУГИЙ із двох незалежних станів R4 (CR :23). Перший — показаний набір із
// підписом джерела — живе у `VesselView`, і цей рядок про нього нічого не знає:
// невдала спроба змінює тільки рядок, ніколи підпис.
//
// Час — ТІЛЬКИ з тіла відповіді (CR :33): `collectedAt` в успіху, `attemptedAt`
// у помилці. Без відповіді часу немає взагалі, і рядок його не вигадує
// браузерним годинником.

import { formatTimestamp, type SnapshotResponse } from '@/entities/vessel';

import { NO_SERVER_RESPONSE } from './snapshot-caption';

/** `null` у `done` — відповіді немає або тіло не розібране (`fetchSnapshot`). */
export type Attempt =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'done'; response: SnapshotResponse | null };

const LOADING_LINE = 'Завантаження…';
const FAILED = 'не вдалося отримати дані';

export function attemptLine(attempt: Attempt): string | null {
  switch (attempt.kind) {
    case 'none':
      return null;
    case 'loading':
      return LOADING_LINE;
    case 'done': {
      const { response } = attempt;
      if (response === null) {
        return `Спроба: ${FAILED}: ${NO_SERVER_RESPONSE}`;
      }
      if (!response.ok) {
        return `Спроба ${formatTimestamp(response.attemptedAt)}: ${FAILED}: ${response.error.message}`;
      }
      if (response.count === 0) {
        return `Спроба ${formatTimestamp(response.collectedAt)}: за час збору позицій не отримано`;
      }
      return `Спроба ${formatTimestamp(response.collectedAt)}: отримано суден: ${response.count}`;
    }
  }
}
```

Також онови коментар над `NO_SERVER_RESPONSE` у `src/_pages/home/lib/snapshot-caption.ts:13-16`: фраза «той самий текст, який R4 пізніше пише в рядку спроби» стає теперішнім часом.

```ts
// Причина, коли сервер не дав тіла зрозумілої форми. Не з переліку
// SPRINT-02:29 (там коди сервера), а рішення плану SPRINT-03; з R4 його пише
// рядок спроби (`attempt-line.ts`). Живе тут, поруч з іншими текстами панелі.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit tests/unit/attempt-line.spec.ts`
Expected: PASS, 6 passed.

Run: `npm run verify`
Expected: усі рядки fast-рівня PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/_pages/home/lib/attempt-line.ts src/_pages/home/lib/snapshot-caption.ts tests/unit/attempt-line.spec.ts
git commit -m "feat(home): рядок результату спроби — тексти R4 (B-18)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Два стани у `VesselView`, панель R4, регресія старих тестів

Ця задача **навмисно** закінчується червоними старими e2e. Регресія — доказ зміни (CR `:83`): мають почервоніти рівно п'ять тестів `snapshot.spec.ts`, а `movement`, `select`, `tile-cache` і тест «судно без швидкості й курсу» — лишитися зеленими. Переписує їх Task 3.

**Files:**
- Modify: `src/_pages/home/ui/vessel-view.tsx` (весь файл)
- Modify: `src/_pages/home/ui/vessel-panel.tsx:26-38`, `:68`, `:89-93`, `:99`, `:127-131`
- Modify: `src/_pages/home/ui/vessel-panel.module.css:212-224`, `:305-308`

**Interfaces:**
- Consumes (Task 1): `type Attempt`, `attemptLine(attempt: Attempt): string | null` з `../lib/attempt-line`.
- Produces: `VesselPanel` props — `vessel: Vessel | null`, `caption: string`, `attempt: string | null` (було `notice`), `loading: boolean`, `onLoad: () => void`. DOM-контракт для Task 3: рядок спроби — `<p role="status">` у `aside`; підказка — текст `Після оновлення сторінки знову показуються демонстраційні дані`; обидва поза `#vessel-panel-body`.

- [ ] **Step 1: Baseline — старі e2e зелені до зміни**

Run: `lsof -iTCP:3000 -sTCP:LISTEN` — порожньо.
Run: `npx playwright test --project=e2e`
Expected: 15 passed (movement 3, select 4, snapshot 6, tile-cache 2).

- [ ] **Step 2: Панель — проп `attempt`, рядок спроби й підказка**

У `src/_pages/home/ui/vessel-panel.tsx` заміни інтерфейс пропсів (`:26-38`):

```tsx
// Панель нічого не вирішує про дані: підпис, рядок спроби й стан кнопки
// приходять готовими від `VesselView`, єдиного власника обох станів R4. Тут
// лише розкладка й власний стан згортання.
interface VesselPanelProps {
  readonly vessel: Vessel | null;
  /** Що зараз на карті — підпис показаного набору (CR :23). */
  readonly caption: string;
  /** Результат останньої спроби (CR :25…:28); `null` — натискань ще не було. */
  readonly attempt: string | null;
  /** Триває збір: кнопка заблокована, удруге натиснути не можна (SPRINT-02:11). */
  readonly loading: boolean;
  readonly onLoad: () => void;
}

const LOAD_BUTTON_LABEL = 'Завантажити справжні позиції';

// Постійна підказка, CR :32 дослівно: набір живе лише в пам'яті сторінки, і
// людина має знати це ДО того, як оновить її посеред заняття.
const RELOAD_HINT = 'Після оновлення сторінки знову показуються демонстраційні дані';
```

(Рядок `const LOAD_BUTTON_LABEL = …` уже існує на `:40` — не дублюй його, лише додай `RELOAD_HINT` після нього.)

Рядок `:68` заміни на:

```tsx
// Порядок згори вниз зафіксований у CR :34: кнопка, підпис джерела, рядок
// результату спроби, підказка, картка.
```

Абзац про `.notice` (`:89-93`) заміни на:

```tsx
// `.attempt` — рядок результату останньої спроби, `role="status"`, щоб читач
// екрана оголосив результат, якого людина чекала. Стоїть одразу під шапкою й
// поза `.body` з тієї ж причини, що й підпис: збій більше не стирає карту
// (CR :27), і без цього рядка людина не дізналася б, що спроба не вдалася.
// Рендериться лише після першого натискання (CR :25) — порожній вузол зі
// статусом був би шумом.
//
// `.hint` — постійна підказка про оновлення сторінки (CR :32), теж поза
// `.body`: «постійна» означає видима й згорнутою панеллю.
```

Сигнатуру (`:99`) заміни на:

```tsx
export function VesselPanel({ vessel, caption, attempt, loading, onLoad }: VesselPanelProps) {
```

Блок `notice` (`:127-131`) заміни на:

```tsx
      {attempt !== null && (
        <p className={styles.attempt} role="status">
          {attempt}
        </p>
      )}

      <p className={styles.hint}>{RELOAD_HINT}</p>
```

- [ ] **Step 3: CSS — `.attempt` і `.hint`**

У `src/_pages/home/ui/vessel-panel.module.css` заміни блок `.notice` (коментар `:212-213` і правило `:214-224`) на:

```css
/* Рядок результату спроби — під шапкою, поза `.body`. Нижній відступ малий:
 * під ним завжди стоїть підказка, а вже вона закриває блок повним відступом. */
.attempt {
  flex-shrink: 0;
  margin: 0;
  box-sizing: border-box;
  padding: 0 1rem 0.5rem;

  color: var(--ink);
  font-size: 0.8125rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* Постійна підказка (CR :32) — приглушена: вона довідкова, а не результат дії.
 * Нижній відступ є завжди: під нею або картка, або кінець панелі. */
.hint {
  flex-shrink: 0;
  margin: 0;
  box-sizing: border-box;
  padding: 0 1rem 0.875rem;

  color: var(--dim);
  font-size: 0.75rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
```

У коментарі над `.collapsed .body` (`:305-308`) заміни фразу «Висота панелі тоді — рівно кнопка, шапка й пояснення, хай скільки рядків займає підпис.» на:

```css
 * `inert` знімає його з фокуса. Висота панелі тоді — рівно кнопка, шапка,
 * рядок спроби й підказка, хай скільки рядків займає підпис. */
```

- [ ] **Step 4: `VesselView` — два стани**

Заміни весь `src/_pages/home/ui/vessel-view.tsx` на:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

import {
  DEMO_ROUTES,
  DEMO_TICK_MS,
  SOURCE_LABELS,
  fleetAtTick,
  lastFleetTick,
} from '@/entities/vessel';

import { attemptLine, type Attempt } from '../lib/attempt-line';
import { fetchSnapshot } from '../lib/fetch-snapshot';
import { snapshotCaption, type SnapshotSuccess } from '../lib/snapshot-caption';
import { DoverStraitMap } from './dover-strait-map';
import { VesselPanel } from './vessel-panel';

// Єдиний власник вибору — і єдине місце застосунку, де є таймер і де взагалі
// згадується `Date.now()`. Клієнтська межа піднята рівно сюди, а не на всю
// сторінку: `home-page.tsx` лишається серверним, бо стану він не потребує.
//
// Компонент рендериться і на сервері (клієнтський ≠ виключений із SSR), тож
// початковий вибір — `null`, а в завжди видимій частині панелі немає нічого,
// похідного від часу: інакше годинник складальної машини запікся б у HTML
// і дав розбіжність при гідратації. `startedAt` серверного рендера й
// клієнтського РІЗНІ — розбіжності немає не тому, що вони збігаються, а тому,
// що з них нічого не рендериться, поки вибір порожній. Рядок спроби до
// першого натискання відсутній, підказка — статичний текст.

/**
 * Тік, на якому стає ОСТАННЄ судно. Похідне від даних (найдовший маршрут — 12
 * точок, тобто 11), а не літерал: зайва точка в маршруті рухає його сама.
 *
 * Обчислення на рівні модуля, а не в тілі компонента: це чиста функція від
 * сталих даних, і рахувати її на кожен рендер не було б за що.
 */
const LAST_TICK = lastFleetTick(DEMO_ROUTES);

/**
 * Показаний набір — ПЕРШИЙ із двох незалежних станів R4 (CR :23). Другий —
 * результат останньої спроби (`Attempt`, `attempt-line.ts`), і з цим він не
 * перетинається: невдала спроба змінює лише рядок спроби.
 *
 * `snapshot` — лише НЕПОРОЖНІЙ успіх; це умова в `handleLoad`. Порожній успіх
 * і помилка набір не змінюють (CR :27). Назад у `demo` стан не повертається —
 * лише оновленням сторінки (CR :32).
 *
 * До R4 тут був один `LoadState`, і в `error` набору не було де лежати — так
 * узгоджувало SPRINT-02:30…:35. Лист замовника № 3 змінив вимогу після досвіду
 * занять: збій більше не стирає карту.
 */
type Shown = { kind: 'demo' } | { kind: 'snapshot'; response: SnapshotSuccess };

export function VesselView() {
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: 'demo' });
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'none' });

  // Команда карті «до початкового виду» — лічильник, а не прапорець (див.
  // `LeafletMapProps.resetViewKey`).
  const [resetViewKey, setResetViewKey] = useState(0);

  // ЄДИНА ЗАКОННА ФОРМА моменту старту, і це виміряно проти справжнього конфігу
  // цього репозиторію, а не обрано на смак: `eslint-plugin-react-hooks@7.1.1`
  // приносить правила React Compiler, і `useRef(Date.now())` дає помилку
  // `react-hooks/purity` навіть якщо `.current` не читати в рендері; голий
  // `Date.now()` у тілі компонента — теж. Лінивий ініціалізатор `useState` —
  // чистий, бо його викликає React, а не рендер.
  const [startedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(0);

  // Лічильник тіків для перевірки "після hot reload один тік за інтервал, не
  // два" (критерій B-06). Живе в `ref`, а не в стані: він нічого не рендерить,
  // і зайвий ререндер на кожен тік був би платою ні за що. `useRef(0)` чистий —
  // на відміну від `useRef(Date.now())`, ініціалізатор тут нічого не кличе.
  const ticksRef = useRef(0);

  // Поки показана демонстрація і останнє судно не стало. На `tick === LAST_TICK`
  // стає `false`, ефект чиститься, і новий інтервал не створюється: через ~22 с
  // застосунок повністю тихий — таймерів немає, рендерів немає, Leaflet не
  // діфить маркери. Останній тік при цьому ВІДБУВАЄТЬСЯ: на
  // `tick === LAST_TICK - 1` умова ще істинна, інтервал спрацьовує, і аж тоді
  // ефект чиститься.
  //
  // Від спроби рух НЕ залежить (CR :26, :27): під час запиту й після збою
  // демонстрація рухається далі. Зупиняє її лише заміна набору непорожнім
  // успіхом (CR :28), а справжні судна між завантаженнями не рухаються
  // (SPRINT-02:37). Той самий ефект на `[running]` і прибирає інтервал, тож
  // окремого механізму зупинки немає.
  const running = shown.kind === 'demo' && tick < LAST_TICK;

  useEffect(() => {
    if (!running) {
      return;
    }

    const intervalId = setInterval(() => {
      ticksRef.current += 1;

      // ЛОГ СТОЇТЬ ТУТ, А НЕ ВСЕРЕДИНІ АПДЕЙТЕРА `setTick`, і це не стиль.
      // React має право викликати апдейтер двічі під StrictMode — апдейтери
      // мусять бути чистими. Лог звідти друкував би два рядки на інтервал і
      // власноруч виготовив би рівно ту поломку, яку критерій B-06 шукає.
      //
      // `console.info`, а не `console.debug`: DevTools Chrome типово ховає
      // рівень Verbose, тобто саме `debug`. Критерій B-06 перевіряється очима
      // в консолі, тож повідомлення, якого за типових налаштувань не видно,
      // не виконувало б своєї єдиної роботи.
      if (process.env.NODE_ENV !== 'production') {
        console.info('[demo-fleet] tick', ticksRef.current);
      }

      setTick((previous) => previous + 1);
    }, DEMO_TICK_MS);

    // Прибирання — перший із двох механізмів, що не дають таймерам
    // накопичуватися: його кличе і подвійне монтування StrictMode, і Fast
    // Refresh. Другий механізм — те, що інтервал створюється ВСЕРЕДИНІ ефекту:
    // інтервал на рівні модуля пережив би hot reload і дав би саме два тіки за
    // інтервал.
    //
    // Залежність саме `[running]`, а не `[tick]`: з `[tick]` інтервал
    // знищувався б і створювався щотіка — таймер лишався б один, але фаза
    // скидалася б щоразу, і вимір "один тік за інтервал" перестав би щось
    // означати.
    return () => {
      clearInterval(intervalId);
    };
  }, [running]);

  // Уся робота кнопки — в обробнику, не в ефекті й не в рендері: запит — наслідок
  // дії людини, і правила React Compiler тримають побічні дії саме тут.
  //
  // Набір, підпис і вибір на час запиту НЕ чіпаються (CR :26): картка
  // закривається лише вибором іншого судна, а судно лишається на карті.
  // Повторне натискання під час збору неможливе — кнопка `disabled`, поки
  // спроба `loading`, і це єдиний захист: другого запиту обробник не очікує.
  // З тієї ж причини `shown` із замикання актуальний — інших записувачів у
  // нього немає.
  //
  // Усі `set*` після `await` стоять в одному синхронному відрізку, тож React
  // зводить їх в один рендер: карта, картка, підпис і рядок спроби
  // змінюються разом — це і є «атомарно» з CR :28.
  async function handleLoad() {
    setAttempt({ kind: 'loading' });

    const response = await fetchSnapshot();
    setAttempt({ kind: 'done', response });

    // Лише непорожній успіх замінює набір (CR :27, :28).
    if (response === null || !response.ok || response.count === 0) {
      return;
    }

    // Обраний id, якого немає в новому наборі, скидається В СТАНІ, а не лише
    // ховається через `find` нижче: інакше він «воскрес» би з наступним
    // знімком, де це судно знову є, і картка відкрилася б сама.
    const ids = new Set(response.vessels.map((vessel) => vessel.id));
    setSelectedVesselId((id) => (id !== null && ids.has(id) ? id : null));

    // Вид повертається лише на ПЕРШИЙ непорожній успіх (CR :29), тобто на
    // переході з демонстрації: далі людина могла сама наблизитися до ділянки,
    // і наступний знімок не має її звідти висмикувати.
    if (shown.kind === 'demo') {
      setResetViewKey((previous) => previous + 1);
    }

    // Набір замінюється цілком, без злиття з попереднім (CR :30): судна, якого
    // немає в новій відповіді, на карті більше немає — і це не «вийшло з району».
    setShown({ kind: 'snapshot', response });
  }

  // Усе видиме — похідне від двох станів і двох чисел. Карта й картка читають
  // РЕЗУЛЬТАТ ОДНОГО ВИРАЗУ, тож розійтися їм нема на чому. Демонстраційний
  // флот рахується лише поки показана демонстрація.
  const vessels =
    shown.kind === 'demo' ? fleetAtTick(DEMO_ROUTES, tick, startedAt) : shown.response.vessels;
  const caption = shown.kind === 'demo' ? SOURCE_LABELS.demo : snapshotCaption(shown.response);

  // У стані лежить тільки id, ніколи копія судна: судно застаріло б з першим
  // же тіком, а id — ні. Саме тому оновлення картки на тіку безкоштовне.
  const selectedVessel = vessels.find((vessel) => vessel.id === selectedVesselId) ?? null;

  return (
    <>
      <DoverStraitMap
        vessels={vessels}
        selectedVesselId={selectedVesselId}
        // Сетер передається напряму, тож вибір — присвоєння, а не перемикач:
        // повторний клік по тому самому судну записує той самий id, `find`
        // повертає те саме судно, і картка не закривається. Гарантія тут
        // саме в цьому, а не в тому, що React пропустить ререндер.
        onSelectVessel={setSelectedVesselId}
        resetViewKey={resetViewKey}
      />
      <VesselPanel
        vessel={selectedVessel}
        caption={caption}
        attempt={attemptLine(attempt)}
        loading={attempt.kind === 'loading'}
        onLoad={handleLoad}
      />
    </>
  );
}
```

- [ ] **Step 5: Типи, лінт, юніт**

Run: `npm run check-types && npm run lint && npx playwright test --project=unit`
Expected: без помилок; unit — усі passed, на 6 більше, ніж на `main`.

Якщо `react-hooks` правило скаржиться на читання `shown` в обробнику — не обходь `eslint-disable`; зупинись і доповідай.

- [ ] **Step 6: Регресія — почервоніли рівно очікувані**

Run: `lsof -iTCP:3000 -sTCP:LISTEN` — порожньо.
Run: `mkdir -p .superpowers/r4 && npx playwright test --project=e2e 2>&1 | tee .superpowers/r4/regression-red.txt`
Expected: **5 failed, 10 passed**. Червоні — рівно ці тести `snapshot.spec.ts`:

| Тест | Чому червоний |
| --- | --- |
| `успіх з одним судном: значок, підпис і картка справжнього судна` | `getByRole('status')` тепер 1 — рядок спроби |
| `порожній успіх: суден немає, підпис із "суден: 0" і пояснення` | демо лишається: 3 значки, підпис «Демонстраційні дані» |
| `помилка: карта порожня, "Даних на карті немає" і причина з відповіді` | демо лишається, текст рядка інший |
| `завантаження: кнопка заблокована, демо зупинене, вибір прибрано` | під час очікування 3 значки й відкрита картка |
| `відповідь без тіла: помилка "Немає відповіді сервера", а не вічне завантаження` | текст рядка інший, демо лишається |

Зелені: `movement.spec.ts` (3), `select.spec.ts` (4), `tile-cache.spec.ts` (2), `успіх, судно без швидкості й курсу` (1).

Якщо почервонів будь-який тест поза цим списком — **зупинись**: зміна вийшла за межі (CR `:83`). Не правь тест, доповідай.

- [ ] **Step 7: Commit**

`.superpowers/` у `.gitignore`, файл виводу не комітиться.

Run: `npm run verify` — fast-рівень зелений (e2e у ньому немає).

```bash
git add src/_pages/home/ui/vessel-view.tsx src/_pages/home/ui/vessel-panel.tsx src/_pages/home/ui/vessel-panel.module.css
git commit -m "feat(home): показаний набір і результат спроби — два стани R4 (B-18)

Нова вимога листа № 3: збій або порожня відповідь не змінюють набір і
підпис джерела; лише непорожній успіх замінює набір. П'ять e2e станів R2/B-13
у snapshot.spec.ts тепер червоні за задумом — їх переписує наступний коміт.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Тести контракту R4 — `snapshot.spec.ts` (B-19)

**Files:**
- Modify: `tests/e2e/snapshot.spec.ts` (весь файл, крім тесту `успіх, судно без швидкості й курсу`, який переноситься дослівно)

**Interfaces:**
- Consumes (Task 2): DOM — `<p role="status">` (рядок спроби), підпис джерела текстом, підказка текстом, кнопка «Згорнути», `[data-vessel-id]`, `aside dl > div` (картка). `blockExternal` з `./support/offline`.
- Produces: нічого для інших задач. Список змінених старих тестів — для Task 7.

**Як влаштовано файл:**
- `/api/snapshot` віддається з **черги** обробників: N-те натискання отримує N-ту відповідь; зайвий запит скасовується (`abort`), тобто стає видимою помилкою, а не мовчазним повтором.
- Відповідь можна **притримати** промісом (`held`), щоб твердження про очікування не були гонкою.
- Тести, яким потрібен рух часу, ставлять `page.clock.install` **без паузи** до `goto`: час іде сам, а `runFor` додає тіки. Пауза тут не потрібна — точних координат демо ці тести не перевіряють, лише «змінилися / не змінилися». Тому крокування по 100 мс з `movement.spec.ts` тут немає.
- Рух демо перевіряється на `demo-3` — найдовшому маршруті (12 точок, 22 с), щоб за час завантаження сторінки він не встиг стати.
- Кожне натискання закінчується очікуванням **кінцевого** тексту рядка спроби — це і є момент, коли відповідь застосована.

- [ ] **Step 1: Переписати файл**

Заміни весь `tests/e2e/snapshot.spec.ts` на:

```ts
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { blockExternal } from './support/offline';

// Контракт R4, CR :40…:53 (B-19): два незалежні стани — показаний набір із
// підписом джерела і результат останньої спроби окремим рядком.
// `/api/snapshot` підмінено `page.route` літеральними відповідями: сервер,
// ключ і AISStream тут не беруть участі, мережа заблокована. Отже доведено
// реакцію інтерфейсу на ФОРМУ відповіді, а не доступність AISStream (CR :91).
//
// Тексти порівнюються точно — вони частина контракту. Усі часи — літерали з
// тіл підмінених відповідей; годинник браузера жодного тексту не дає (CR :33).
//
// ЩО ЗМІНИЛОСЯ ПРОТИ R2 і чому (CR :55, :83). Тести станів R2 з B-16
// («порожній успіх: суден немає…», «помилка: карта порожня…») і три тести B-13
// («успіх з одним судном…», «завантаження: … демо зупинене, вибір прибрано»,
// «відповідь без тіла…») кодували правило «показуємо результат останньої
// спроби» — лист замовника № 3 його змінив. Тест «судно без швидкості й
// курсу» перенесено без правок.

const SUCCESS_ONE = {
  ok: true, collectedAt: '2026-01-01T12:00:00.000Z', windowSeconds: 15, count: 1,
  truncated: false, reason: 'window_elapsed',
  vessels: [{ id: '210385000', name: 'P&O PIONEER', lat: 51.1, lon: 1.3, speedKnots: 0,
    courseDeg: 48.2, timestamp: '2026-01-01T11:59:56.513Z', source: 'aisstream' }],
};
const SUCCESS_UNKNOWN = { ...SUCCESS_ONE, vessels: [{ ...SUCCESS_ONE.vessels[0], speedKnots: null, courseDeg: null }] };
const ERROR_NO_KEY = { ok: false, attemptedAt: '2026-01-01T12:00:00.000Z',
  error: { code: 'no_api_key', message: 'Ключ AISStream не налаштовано' } };

// Друга спроба — на хвилину пізніше, щоб час у рядку спроби відрізнявся від
// часу в підписі: саме ця різниця доводить, що підпис не оновився.
const EMPTY_LATER = { ...SUCCESS_ONE, collectedAt: '2026-01-01T12:01:00.000Z', vessels: [], count: 0 };
const ERROR_LATER = { ok: false, attemptedAt: '2026-01-01T12:01:00.000Z',
  error: { code: 'disconnected', message: "З'єднання з джерелом розірвано" } };
const ERROR_LATEST = { ...ERROR_LATER, attemptedAt: '2026-01-01T12:02:00.000Z' };
/** Те саме судно в тих самих координатах — другий непорожній успіх. */
const SUCCESS_AGAIN = { ...SUCCESS_ONE, collectedAt: '2026-01-01T12:01:00.000Z' };
/** Те саме судно, нова позиція й новий час повідомлення. */
const SUCCESS_MOVED = { ...SUCCESS_AGAIN, vessels: [{ ...SUCCESS_ONE.vessels[0],
  lat: 51.2, lon: 1.4, timestamp: '2026-01-01T12:00:58.000Z' }] };
/** Інше судно: обраного `210385000` у цьому наборі немає. */
const SUCCESS_OTHER = { ...SUCCESS_AGAIN, vessels: [{ ...SUCCESS_ONE.vessels[0],
  id: '235000001', name: 'OTHER', lat: 51.05, lon: 1.6 }] };
const SUCCESS_TRUNCATED = { ...SUCCESS_ONE, truncated: true, reason: 'limit_reached' };

const BUTTON = 'Завантажити справжні позиції';
const DEMO_CAPTION = 'Демонстраційні дані';
const CAPTION_1200 = 'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 1 · вибірка неповна';
const HINT = 'Після оновлення сторінки знову показуються демонстраційні дані';
const REAL = '[data-vessel-id="210385000"]';
const DEMO = '[data-vessel-id^="demo-"]';

type Handler = (route: Route) => Promise<void>;

function loadButton(page: Page) {
  return page.getByRole('button', { name: BUTTON });
}

/** Рядок результату спроби — єдиний `role="status"` на сторінці. */
function attemptLine(page: Page) {
  return page.getByRole('status');
}

function caption(page: Page, text: string) {
  return page.getByText(text, { exact: true });
}

/** Значення поля картки за підписом — той самий прийом, що в select.spec.ts. */
function cardField(page: Page, label: string) {
  return page
    .locator('aside dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .locator('dd');
}

function card(page: Page) {
  return page.locator('aside dl');
}

/** Незвернений корінь маркера Leaflet — його рамку пише лише `setLatLng` і вид карти. */
function markerRoot(page: Page, selector: string) {
  return page.locator('.leaflet-marker-icon', { has: page.locator(selector) });
}

function json(body: unknown, status: number): Handler {
  return (route) => route.fulfill({ status, json: body });
}

/** Відповідь, яку тест відпускає сам: без цього очікування тривало б мілісекунди. */
function held(body: unknown, status: number): { handler: Handler; release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    handler: async (route) => {
      await gate;
      await route.fulfill({ status, json: body });
    },
    release,
  };
}

/**
 * Мережа заблокована, `/api/snapshot` віддає відповіді з черги — N-те
 * натискання отримує N-ту. Зайвий запит скасовується: це видима помилка в
 * рядку спроби, а не мовчазний повтор останньої відповіді.
 *
 * `clock` — `page.clock.install` БЕЗ паузи: час іде сам, `runFor` додає тіки.
 * Ставиться до `goto`, інакше демо стартує за справжнім годинником.
 *
 * Очікування першого значка — готовність, а не перевірка: карта вантажиться
 * окремим чанком `ssr: false`.
 */
async function open(page: Page, handlers: Handler | Handler[], { clock = false } = {}) {
  // Одиночний обробник — щоб тест «судно без швидкості й курсу» перейшов з R2
  // байт у байт (CR :55: він без правок).
  const queue = Array.isArray(handlers) ? handlers : [handlers];
  if (clock) {
    await page.clock.install({ time: new Date('2026-01-01T11:59:00.000Z') });
  }
  await blockExternal(page);
  let next = 0;
  await page.route('**/api/snapshot', (route) => {
    const handler = queue[next];
    next += 1;
    return handler === undefined ? route.abort() : handler(route);
  });
  await page.goto('/');
  await page.locator('[data-vessel-id]').first().waitFor();
}

/** Натиснути й дочекатися КІНЦЕВОГО тексту рядка — моменту, коли відповідь застосована. */
async function load(page: Page, expectedLine: string) {
  await loadButton(page).click();
  await expect(attemptLine(page)).toHaveText(expectedLine);
}

/**
 * Рамка, що не змінюється між двома читаннями: зум і перетягування Leaflet
 * анімовані, і рамка в середині анімації нічого б не доводила. `expect.poll`
 * сам повторює читання з інтервалом — `waitForTimeout` не потрібен.
 */
async function settledBox(locator: Locator) {
  let previous = '';
  await expect.poll(async () => {
    const current = JSON.stringify(await locator.boundingBox());
    const settled = current !== 'null' && current === previous;
    previous = current;
    return settled;
  }, { intervals: [250] }).toBe(true);
  return JSON.parse(previous) as { x: number; y: number; width: number; height: number };
}

test('успіх 12:00:00: набір замінений, підпис і рядок спроби, рух демонстрації зупинено', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200)], { clock: true });
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  // Набір замінено цілком: лише судно відповіді, жодного демо-судна (CR :30).
  await expect(page.locator('[data-vessel-id]')).toHaveCount(1);
  await expect(page.locator(REAL)).toHaveCount(1);
  await expect(caption(page, CAPTION_1200)).toBeVisible();

  await page.locator(REAL).click();
  await expect(cardField(page, 'Ідентифікатор')).toHaveText('210385000');
  await expect(cardField(page, 'Швидкість')).toHaveText('0 kn');
  await expect(cardField(page, 'Джерело')).toHaveText('AISStream');
  await expect(cardField(page, 'Координати')).toHaveText('51.10000, 1.30000');

  // CR :51: кілька тіків — справжні судна між завантаженнями не рухаються,
  // і демо не повертається.
  await page.clock.runFor(10_000);
  await expect(cardField(page, 'Координати')).toHaveText('51.10000, 1.30000');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('11:59:56 UTC');
  await expect(page.locator(DEMO)).toHaveCount(0);
});

test('повторне очікування: попередній набір на карті, кнопка заблокована, "Завантаження…"', async ({ page }) => {
  const second = held(SUCCESS_AGAIN, 200);
  await open(page, [json(SUCCESS_ONE, 200), second.handler]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  // Вибір ДО другого натискання: картка має пережити очікування (D6).
  await page.locator(REAL).click();
  await expect(card(page)).toHaveCount(1);

  await loadButton(page).click();

  await expect(loadButton(page)).toBeDisabled();
  await expect(attemptLine(page)).toHaveText('Завантаження…');
  await expect(page.locator(REAL)).toHaveCount(1);
  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(card(page)).toHaveCount(1);

  second.release();

  await expect(attemptLine(page)).toHaveText('Спроба 12:01:00 UTC: отримано суден: 1');
  await expect(loadButton(page)).toBeEnabled();
});

test('порожня відповідь 12:01:00 після успіху 12:00:00: набір і підпис збережені', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(EMPTY_LATER, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await load(page, 'Спроба 12:01:00 UTC: за час збору позицій не отримано');

  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator('[data-vessel-id]')).toHaveCount(1);
  await expect(page.locator(REAL)).toHaveCount(1);
});

test('помилка 12:01:00 після успіху 12:00:00: набір і підпис збережені', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(ERROR_LATER, 502)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await load(page, "Спроба 12:01:00 UTC: не вдалося отримати дані: З'єднання з джерелом розірвано");

  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator(REAL)).toHaveCount(1);
  await expect(loadButton(page)).toBeEnabled();
});

test('збій за збоєм: рядок показує останню спробу, підпис — і далі останній успіх', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(EMPTY_LATER, 200), json(ERROR_LATEST, 502)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await load(page, 'Спроба 12:01:00 UTC: за час збору позицій не отримано');
  await load(page, "Спроба 12:02:00 UTC: не вдалося отримати дані: З'єднання з джерелом розірвано");

  await expect(caption(page, CAPTION_1200)).toBeVisible();
  await expect(page.locator(REAL)).toHaveCount(1);
});

test('помилка при демонстрації: судна рухаються, підпис "Демонстраційні дані", рядок без ключа', async ({ page }) => {
  await open(page, [json(ERROR_NO_KEY, 502)], { clock: true });

  // demo-3 — найдовший маршрут (22 с): за час завантаження сторінки він не стане.
  await page.locator('[data-vessel-id="demo-3"]').click();
  await load(page, 'Спроба 12:00:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано');

  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);

  const before = await cardField(page, 'Координати').textContent();
  await page.clock.runFor(4_000);
  await expect(cardField(page, 'Координати')).not.toHaveText(before ?? '');
});

test('порожній успіх при демонстрації: демо рухається далі, підпис не змінюється', async ({ page }) => {
  await open(page, [json(EMPTY_LATER, 200)], { clock: true });

  await page.locator('[data-vessel-id="demo-3"]').click();
  await load(page, 'Спроба 12:01:00 UTC: за час збору позицій не отримано');

  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);

  const before = await cardField(page, 'Координати').textContent();
  await page.clock.runFor(4_000);
  await expect(cardField(page, 'Координати')).not.toHaveText(before ?? '');
});

test('обраного судна немає в новому наборі: картка закрита, набори не злиті', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(SUCCESS_OTHER, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await page.locator(REAL).click();
  await expect(card(page)).toHaveCount(1);

  await load(page, 'Спроба 12:01:00 UTC: отримано суден: 1');

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(REAL)).toHaveCount(0);
  await expect(page.locator('[data-vessel-id="235000001"]')).toHaveCount(1);
});

test('обране демо-судно після непорожнього успіху: картка закрита', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200)]);
  await page.locator('[data-vessel-id="demo-1"]').click();
  await expect(card(page)).toHaveCount(1);

  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  await expect(card(page)).toHaveCount(0);
});

test('обране судно є в новому наборі: картка показує нові координати й час', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(SUCCESS_MOVED, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  await page.locator(REAL).click();
  await expect(cardField(page, 'Координати')).toHaveText('51.10000, 1.30000');

  await load(page, 'Спроба 12:01:00 UTC: отримано суден: 1');

  await expect(cardField(page, 'Координати')).toHaveText('51.20000, 1.40000');
  await expect(cardField(page, 'Час повідомлення')).toHaveText('12:00:58 UTC');
});

test('успіх, судно без швидкості й курсу: "Немає даних" і нейтральний значок', async ({ page }) => {
  await open(page, json(SUCCESS_UNKNOWN, 200));
  await loadButton(page).click();

  const vessel = page.locator('[data-vessel-id="210385000"]');
  await expect(vessel).toHaveAttribute('data-icon', 'neutral');

  await vessel.click();
  await expect(cardField(page, 'Швидкість')).toHaveText('Немає даних');
  await expect(cardField(page, 'Курс')).toHaveText('Немає даних');
});

test('успіх з truncated: підпис закінчується на " · зупинено на ліміті 100"', async ({ page }) => {
  await open(page, [json(SUCCESS_TRUNCATED, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');

  await expect(caption(page, `${CAPTION_1200} · зупинено на ліміті 100`)).toBeVisible();
});

test('другий непорожній успіх після зсуву карти: центр і масштаб не змінилися', async ({ page }) => {
  await open(page, [json(SUCCESS_ONE, 200), json(SUCCESS_AGAIN, 200)]);
  await load(page, 'Спроба 12:00:00 UTC: отримано суден: 1');
  const initial = await settledBox(markerRoot(page, REAL));

  // Людина наблизилась і зсунула карту. Перетягування — з порожнього місця
  // карти ліворуч від панелі, не з маркера.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.mouse.move(400, 500);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 10 });
  await page.mouse.up();
  const shifted = await settledBox(markerRoot(page, REAL));
  // Без цього порівняння нижче нічого б не доводило: вид мав справді змінитися.
  expect(shifted).not.toEqual(initial);

  // Те саме судно в тих самих координатах: рамка маркера змінилася б лише від
  // зміни виду карти.
  await load(page, 'Спроба 12:01:00 UTC: отримано суден: 1');
  expect(await settledBox(markerRoot(page, REAL))).toEqual(shifted);
});

test('відповідь без тіла: "Немає відповіді сервера" без часу, набір збережений', async ({ page }) => {
  await open(page, [(route) => route.fulfill({ status: 502, body: '' })]);
  await load(page, 'Спроба: не вдалося отримати дані: Немає відповіді сервера');

  await expect(loadButton(page)).toBeEnabled();
  await expect(caption(page, DEMO_CAPTION)).toBeVisible();
  await expect(page.locator(DEMO)).toHaveCount(3);
});

test('підказка про оновлення сторінки є завжди, і рядок спроби видно згорнутою панеллю', async ({ page }) => {
  await open(page, [json(ERROR_NO_KEY, 502)]);

  // До першого натискання: підказка є, рядка спроби немає (CR :25).
  await expect(page.getByText(HINT, { exact: true })).toBeVisible();
  await expect(attemptLine(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Згорнути' }).click();
  await load(page, 'Спроба 12:00:00 UTC: не вдалося отримати дані: Ключ AISStream не налаштовано');

  await expect(page.getByText(HINT, { exact: true })).toBeVisible();
  await expect(attemptLine(page)).toBeVisible();
});
```

Перенесений тест «судно без швидкості й курсу» викликає `open(page, json(...))` з одним обробником — тому `open` приймає `Handler | Handler[]`. **Не правь сам тест.**

- [ ] **Step 2: Тест без правок справді без правок**

Run: `diff <(git show main:tests/e2e/snapshot.spec.ts | sed -n '/без швидкості й курсу/,/^});/p') <(sed -n '/без швидкості й курсу/,/^});/p' tests/e2e/snapshot.spec.ts) && echo SAME`
Expected: `SAME`.

- [ ] **Step 3: Прогін**

Run: `lsof -iTCP:3000 -sTCP:LISTEN` — порожньо.
Run: `npx playwright test --project=e2e tests/e2e/snapshot.spec.ts`
Expected: 15 passed.

Якщо падає тест «другий непорожній успіх після зсуву карти» на `not.toEqual(initial)` — перетягування не зсунуло карту (наприклад, `mouse.down` прийшов на маркер чи панель). Виміряй координати маркера (`markerRoot(...).boundingBox()`) і перенеси точку перетягування в порожнє місце; **не послаблюй** твердження.

Якщо падає тест з `clock: true` до першого твердження (значок не з'являється) — `install` без паузи заважає чанку карти. Тоді зупинись і доповідай: обхід через крокування `movement.spec.ts` можливий, але це рішення людини.

- [ ] **Step 4: Повний e2e і межа змін**

Run: `npx playwright test --project=unit --project=e2e`
Expected: усі passed; e2e — 24 (movement 3, select 4, snapshot 15, tile-cache 2).

Run: `git diff --stat main -- tests/e2e/`
Expected: змінено **лише** `tests/e2e/snapshot.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/snapshot.spec.ts
git commit -m "test(e2e): контракт R4 — набір зберігається у разі збою (B-19)

Переписано під нову вимогу листа № 3: стани R2 з B-16 (порожній успіх,
помилка) і три тести B-13 (успіх, завантаження, відповідь без тіла).
Тест «судно без швидкості й курсу» перенесено без правок. movement,
select і tile-cache не змінювались.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Мутації — тести стережуть пастки CR `:89`

Зелений тест доводить, що перевірка проходить, а не що вона стереже. Кожну пастку тимчасово закладаємо в код продукту, переконуємось, що тест червоніє, і відкочуємо. **Жодну мутацію не комітити.**

**Files:**
- Modify (тимчасово, з відкатом): `src/_pages/home/ui/vessel-view.tsx`
- Create (не комітиться): `.superpowers/r4/mutations.md`

**Interfaces:**
- Consumes: код Task 2, тести Task 3.
- Produces: таблиця мутацій для Task 7 (CHECKPOINT-03b §3.2).

**Порядок для кожної мутації:**
1. Внести правку.
2. `npx playwright test --project=e2e tests/e2e/snapshot.spec.ts 2>&1 | tail -30`
3. Записати в `.superpowers/r4/mutations.md`: номер, правка, які тести почервоніли.
4. `git checkout -- src/_pages/home/ui/vessel-view.tsx && git status --porcelain src app` — має бути порожньо.

Перед першою: `lsof -iTCP:3000 -sTCP:LISTEN` — порожньо.

- [ ] **Step 1: M18-1 — набори зливаються**

У `handleLoad` заміни `setShown({ kind: 'snapshot', response });` на:

```ts
    setShown({
      kind: 'snapshot',
      response: {
        ...response,
        vessels: [...(shown.kind === 'snapshot' ? shown.response.vessels : []), ...response.vessels]
          .filter((v, i, all) => all.findIndex((w) => w.id === v.id) === i),
      },
    });
```

Expected red: «обраного судна немає в новому наборі: картка закрита, набори не злиті» (`235000001` і `210385000` обидва на карті).

- [ ] **Step 2: M18-2 — підпис оновлюється на невдалій спробі**

Заміни умову `if (response === null || !response.ok || response.count === 0)` на `if (response === null || !response.ok)`.

Expected red: «порожня відповідь 12:01:00 після успіху…», «збій за збоєм…», «порожній успіх при демонстрації…».

- [ ] **Step 3: M18-3 — демо зупиняється при натисканні**

Заміни `const running = shown.kind === 'demo' && tick < LAST_TICK;` на:

```ts
  const running = shown.kind === 'demo' && attempt.kind === 'none' && tick < LAST_TICK;
```

Expected red: «помилка при демонстрації…», «порожній успіх при демонстрації…».

- [ ] **Step 4: M18-4 — картка показує судно старого набору**

Пастка — картка тримає КОПІЮ судна, зроблену в момент кліку, а не шукає його за `id` у поточному наборі. Додай після рядка `const vessels = …`:

```ts
  const [pinned, setPinned] = useState<Vessel | null>(null);
```

(імпортуй `type Vessel` з `@/entities/vessel`), заміни рядок `selectedVessel` на:

```ts
  const selectedVessel =
    pinned !== null && pinned.id === selectedVesselId
      ? pinned
      : (vessels.find((vessel) => vessel.id === selectedVesselId) ?? null);
```

і проп карти `onSelectVessel={setSelectedVesselId}` на:

```tsx
        onSelectVessel={(id) => {
          setSelectedVesselId(id);
          setPinned(vessels.find((vessel) => vessel.id === id) ?? null);
        }}
```

Хук `useState` після обчислення `vessels` — законний (не умовний, порядок сталий). Ця мутація зламала б і рух картки демо в `movement.spec.ts`, але прогін тут — лише `snapshot.spec.ts`.

Expected red: «обране судно є в новому наборі: картка показує нові координати й час».

- [ ] **Step 5: M18-5 — вид повертається на кожному успіху**

Заміни `if (shown.kind === 'demo') {` перед `setResetViewKey` на `if (true) {`.

Expected red: «другий непорожній успіх після зсуву карти…».

- [ ] **Step 6: M18-6 — вибір скидається на початку запиту (стара поведінка R2)**

Додай першим рядком `handleLoad`: `setSelectedVesselId(null);`

Expected red: «повторне очікування: попередній набір на карті…» (картка зникла під час очікування).

- [ ] **Step 7: Підсумок і чистота дерева**

Run: `git status --porcelain src app`
Expected: порожньо.

Run: `npx playwright test --project=e2e tests/e2e/snapshot.spec.ts`
Expected: 15 passed — код повернувся.

Якщо будь-яка мутація лишила всі тести зеленими — **зупинись**: тест не стереже пастку. Доповідай, якого твердження бракує; не дописуй його без погодження.

Коміту немає.

---

### Task 5: Приймання — автоматична частина (B-20)

**Files:**
- Create (не комітиться): `.superpowers/r4/verify-full.txt`, `.superpowers/r4/verify-checkpoint.txt`, `.superpowers/r4/tests.txt`

**Interfaces:**
- Consumes: гілка після Task 3.
- Produces: вивід команд для Task 6 (README) і Task 7 (checkpoint §3).

- [ ] **Step 1: Порт і Node**

Run: `lsof -iTCP:3000 -sTCP:LISTEN; node -v`
Expected: перша команда — порожньо; `v24.x`. Якщо порт зайнятий — **зупинись і скажи людині, хто його тримає**; не вбивай чужий процес.

- [ ] **Step 2: Тести, типи, збірка окремо (CR `:59`)**

Run: `npx playwright test --project=unit --project=e2e 2>&1 | tee .superpowers/r4/tests.txt | tail -5`
Expected: `N passed`, жодного failed/skipped.

Run: `npm run check-types; echo EXIT=$?`
Expected: `EXIT=0`.

Run: `npm run build 2>&1 | tail -15; echo EXIT=$?`
Expected: `EXIT=0`, маршрути `/` і `/api/snapshot` у таблиці.

- [ ] **Step 3: `verify:full` і `verify:checkpoint`**

Run: `npm run verify:full 2>&1 | tee .superpowers/r4/verify-full.txt | tail -15; echo EXIT=${PIPESTATUS[0]}`
Expected: 8 × PASSED, `EXIT=0`.

Run: `npm run verify:checkpoint 2>&1 | tee .superpowers/r4/verify-checkpoint.txt | tail -15; echo EXIT=${PIPESTATUS[0]}`
Expected: 8 × PASSED, жодного SKIPPED, `EXIT=0`.

Будь-який статус, крім PASSED, читай за скілом `verify`.

- [ ] **Step 4: `.env.local` не відстежується (CR `:62`, частина агента)**

Run: `git ls-files | grep -F .env.local; echo EXIT=$?`
Expected: порожній вивід, `EXIT=1`.

Пошук **значення** ключа агент не виконує (CLAUDE.md, «Secrets»): це крок людини, Task 5b.

Коміту немає.

---

### Task 5b: Приймання — ручна частина (людина)

**Агент цей крок не виконує й не імітує.** Він передає людині чек-лист нижче й чекає результатів, щоб записати їх у checkpoint (Task 7). Значення ключа людина не вводить у чат.

- [ ] **Без ключа (CR `:60`, `:93`).** Перейменувати `.env.local` (наприклад, на `.env.local.off`), перезапустити `npm run dev`, відкрити http://localhost:3000, натиснути «Завантажити справжні позиції».
  Очікується: демо-судна на місці й рухаються; підпис «Демонстраційні дані»; рядок «Спроба HH:MM:SS UTC: не вдалося отримати дані: Ключ AISStream не налаштовано»; підказка є. `npm run build` проходить.
- [ ] **Пошук значення ключа (CR `:62`, D3).** У робочій копії, `.next/static` і `git archive` коміту під тег, наприклад:
  `grep -rIlF "$(cat .env.local.off | cut -d= -f2-)" . --exclude-dir=node_modules --exclude-dir=.git --exclude=.env.local.off`;
  `grep -rIlF "<те саме>" .next/static`;
  `git archive HEAD | tar -xO | grep -cF "<те саме>"`.
  Очікується: нічого не знайдено, лічильник `0`.
- [ ] **З ключем (CR `:61`).** Повернути `.env.local`, перезапустити, натиснути.
  Записати: рядок спроби дослівно (час і кількість суден) **або** текст недоступності джерела.

Результат людина повідомляє агенту текстом: що побачила, без значення ключа.

---

### Task 6: README (B-21)

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: вивід Task 5 (`.superpowers/r4/*.txt`) — підсумкові рядки вставляються в README дослівно.
- Produces: README для Task 7 і для людини (US-10).

- [ ] **Step 1: Написати README**

`README.md` (заповни `<…>` рядками з `.superpowers/r4/`; дослівно, без прикрас):

````markdown
# Sea Radar

Локальна програма для заняття: карта Дуврської протоки з суднами й картка кожного судна.
Працює на ноутбуці викладача, лише на цьому комп'ютері (адреса 127.0.0.1), для одного
користувача. Нічого не розгортається в інтернеті.

Після запуску на карті рухаються три демонстраційні судна. Кнопка «Завантажити справжні
позиції» робить **знімок на момент натискання**: сервер 15 секунд збирає позиції з
AISStream і повертає те, що встиг отримати. Вибірка неповна: у знімок потрапляють лише судна, що надіслали позицію за ці 15 секунд, і
це не спостереження в реальному часі. Щоб оновити картину, натисніть кнопку ще раз.

## Що потрібно

- Node.js 24 (версія записана в `.nvmrc`); зручно через `nvm`.
- Доступ до інтернету — для тайлів карти й для AISStream.
- Ключ AISStream (https://aisstream.io) — лише для справжніх позицій. Без ключа працює
  демонстрація.

## Встановлення й запуск

```bash
nvm use                       # перемикає на Node 24 з .nvmrc
npm ci                        # встановлює залежності точно за package-lock.json
cp .env.example .env.local    # файл для ключа
npm run dev                   # запуск; відкрити http://localhost:3000
```

### Куди вписати ключ

Відкрийте `.env.local` у текстовому редакторі. У ньому один рядок:

```
AISSTREAM_API_KEY=
```

Допишіть ключ після `=` і збережіть файл, потім перезапустіть `npm run dev`. Ключ
читається лише сервером програми й не потрапляє в браузер. Файл `.env.local` не
передається разом із програмою — не надсилайте його й не вставляйте ключ у листи чи чати.

## Як перевірити, що все працює

1. Відкрийте http://localhost:3000 — на карті три судна «Демо-судно 1…3», вони рухаються
   приблизно 22 секунди й зупиняються. Клік по судну відкриває картку.
2. Натисніть «Завантажити справжні позиції». Кнопка блокується, під підписом з'являється
   «Завантаження…», а за ~15 секунд — рядок результату спроби:
   - з ключем і доступним джерелом: «Спроба HH:MM:SS UTC: отримано суден: N», на карті —
     справжні судна, підпис «AISStream · знімок за 15 с · отримано … · вибірка неповна»;
   - без ключа: «Спроба HH:MM:SS UTC: не вдалося отримати дані: Ключ AISStream не
     налаштовано», демонстрація лишається на карті.

Автоматичні перевірки (ключ не потрібен, жоден тест не звертається до AISStream):

```bash
npx playwright install chromium   # один раз: браузер для тестів
npm run verify:full               # типи, лінт, юніт-тести, збірка, браузерні тести
```

Очікуваний результат — вісім рядків `PASSED`. Вивід на момент передачі:

```
<останні 10 рядків .superpowers/r4/verify-full.txt>
```

Окремі команди:

```bash
npx playwright test --project=unit --project=e2e   # усі тести
npm run check-types                                # перевірка типів
npm run build                                      # збірка
```

```
<підсумковий рядок .superpowers/r4/tests.txt, напр. «433 passed (20.1s)»>
```

Перед браузерними тестами порт 3000 має бути вільним: якщо там уже працює `npm run dev`
або інша програма, тести перевірятимуть її.

## Що на карті, коли спроба не вдалася

На екрані два окремі рядки:

- **підпис джерела** — що саме зараз на карті й коли воно отримане;
- **рядок результату спроби** — чим закінчилося останнє натискання і коли.

Карта змінюється **лише** тоді, коли прийшов непорожній результат. Якщо джерело не
відповіло, повернуло помилку або за 15 секунд не прислало жодної позиції, на карті лишається
те, що було, — демонстрація або попередній знімок, — а підпис і далі чесно називає його
джерело й час. Про невдалу спробу повідомляє лише рядок результату спроби.

Після оновлення сторінки знову показуються демонстраційні дані: знімки ніде не
зберігаються.

## Що програма вміє і чого не вміє

Вміє: показати демонстраційні судна в русі; за натисканням отримати знімок справжніх
позицій у районі 50.75°N 0.95°E — 51.25°N 1.95°E; показати картку судна з назвою,
ідентифікатором (MMSI), координатами, швидкістю, курсом, часом повідомлення й джерелом.

Не вміє і не має вміти: оновлюватися сама за таймером; гарантувати, що в знімку є кожне судно протоки;
зберігати історію чи трек судна; шукати й фільтрувати; працювати з іншими районами;
зберігати знімок після оновлення сторінки; відкриватися з іншого комп'ютера.

## Відомі обмеження

- Знімок збирається 15 секунд і містить не більше 100 суден; на ліміті підпис закінчується
  « · зупинено на ліміті 100».
- Судно, якого немає в новому знімку, просто не прислало позицію за ці 15 секунд — це не
  означає, що воно покинуло район.
- «Немає даних» у полі картки — джерело не передало значення; `0 kn` — справжня нульова
  швидкість.
- Курс — це курс відносно ґрунту, а не напрям носа судна.
- Браузерні тести перевіряють реакцію інтерфейсу на підмінені відповіді сервера, а не
  доступність AISStream.
````

- [ ] **Step 2: Заборонені слова**

Run: `grep -inE 'моніторинг|усі судна району' README.md; echo EXIT=$?`
Expected: порожньо, `EXIT=1`.

Run: `grep -inE 'моніторинг|(у|в)сі судна' README.md; echo EXIT=$?`
Expected: порожньо, `EXIT=1` — і варіант «всі судна» теж не обходить критерій. Якщо щось знайдено — переформулюй.

- [ ] **Step 3: Кожна команда README виконана (CR `:65`)**

Виконай по черзі й порівняй з описаним результатом, записуючи вивід у `.superpowers/r4/readme-run.txt`:

```bash
nvm use
npm ci
test -f .env.local || echo "немає .env.local — cp .env.example .env.local створив би його"
npx playwright install chromium
npm run verify:full
npx playwright test --project=unit --project=e2e
npm run check-types
npm run build
```

`cp .env.example .env.local` **не виконуй**, якщо `.env.local` уже існує — він перезаписав би ключ людини. Запиши це в журнал як «не виконано: перезаписало б наявний файл».

`npm run dev` — запусти у фоні, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/` має дати `200`, потім зупини процес. Перед цим порт 3000 вільний.

Якщо результат розійшовся з README — виправ README, не команду.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): встановлення, перевірки, правило збереження набору (B-21)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: CHECKPOINT-03b і `CLAUDE.md`

Починати **лише після** того, як людина повідомила результати Task 5b. Без них розділи §4 і §5 записуються як «не виконано, передано людині» — не вигадуються.

**Files:**
- Create: `docs/checkpoints/CHECKPOINT-03b.md`
- Modify: `CLAUDE.md:9`, `:20`, `:25`, `:130`

**Interfaces:**
- Consumes: `.superpowers/r4/{tests,verify-full,verify-checkpoint,mutations,readme-run}.txt|md`, результати людини, `git log --oneline main..HEAD`.

- [ ] **Step 1: Записати CHECKPOINT-03b**

Структура — як у CHECKPOINT-03 (`TEMPLATE.md` досі відсутній; не вигадувати). Шапка:

```markdown
# CHECKPOINT-03b — Реліз R4: не втрачати картину у разі збою

**Тег:** не встановлено — рішення людини (GitHub Release) · **Коміт коду:** `<sha останнього коміту коду>` · **Гілка:** `sprint-03b`
(від `main` на `1d95b52`) · **Дата запису:** <дата>

Охоплює `docs/tasks/SPRINT-03b-CHANGE-REQUEST.md` — B-18…B-21; зміна US-06 і US-07, закриття
US-10. Фінальний стан проєкту.

> **Назва й архів.** CR `:69` називає цей запис «checkpoint 06» і вимагає архів. Рішення людини
> (2026-10-02): запис — CHECKPOINT-03b; архіву немає, замість нього GitHub Release. Пошук
> значення ключа «у вмісті архіву» виконано по `git archive` коміту під тег — zip вихідного
> коду GitHub Release збирається з дерева тегу тим самим способом.
```

Розділи і що в кожному:

1. **Запуск** — посилання на `README.md` і три команди з нього.
2. **Що зроблено** — таблиця B-18…B-21 з комітами; рамка «нова вимога, не баг» (CR `:87`); список змінених файлів коду.
3. **Які команди виконані й з яким результатом** — вивід `verify:full`, `verify:checkpoint`, підсумок тестів по файлах; §3.1 — **список змінених старих тестів** (5 тестів `snapshot.spec.ts` з причиною кожного — таблиця з Task 2, Step 6) і доказ `git diff --stat main -- tests/e2e/`; §3.2 — мутації M18-1…M18-6 з `.superpowers/r4/mutations.md`, по рядку: пастка, правка, що почервоніло.
4. **Що перевірено вручну** — результати Task 5b дослівно (без ключа; пошук ключа: три місця, три нулі).
5. **Статус живого джерела** — результат одного ручного завантаження з часом і кількістю суден, або зафіксована недоступність.
6. **Що доведено чим** (CR `:111`) — три списки: доведено тестами (12 сценаріїв, юніт текстів, рух/вибір без правок); доведено ручним підключенням; **не доведено** (доступність AISStream; повнота вибірки; поведінка на Node іншої версії; скидання виду при першому успіху e2e перевірено лише непрямо — тест 9 доводить «не скидається вдруге»).
7. **Відхилення від завдання за весь блок R1…R4** — зібрати з розділів «Відхилення» CHECKPOINT-01, -02, -03 (дослівно або посиланням на рядок), плюс R4:
   - CR `:55` — змінено не лише тести B-16, а й три тести B-13, бо вони кодували той самий змінений контракт;
   - D1–D3 — назва checkpoint, архів → GitHub Release, пошук ключа по `git archive`;
   - D6 — вибір зберігається під час запиту (CR про це мовчить; випливає з правила картки R1).
8. **Обмеження** — з README «Відомі обмеження» плюс: e2e на підміненій відповіді власного endpoint; `page.clock` керує сторінкою, не сервером.
9. **Що лишилося поза межами** — CR `:73` і заборони брифу назавжди; nice to have `:113…:117` не робилися.
10. **Що за людиною** — тег, GitHub Release, злиття `sprint-03b` у `main`.

- [ ] **Step 2: Оновити `CLAUDE.md`**

`CLAUDE.md:9` — заміни речення «Release R3 … R4 (`SPRINT-03b-CHANGE-REQUEST.md`) is next.» на:

```
Release R3 (B-14…B-17) is closed by `docs/checkpoints/CHECKPOINT-03.md`. Release R4 (B-18…B-21, `SPRINT-03b-CHANGE-REQUEST.md`) is closed by `docs/checkpoints/CHECKPOINT-03b.md` on branch `sprint-03b` — the final state of the project.
```

`CLAUDE.md:20` — заміни «`SPRINT-03b-CHANGE-REQUEST.md` — R4; next.» на «`SPRINT-03b-CHANGE-REQUEST.md` — R4, B-18…B-21, US-06/US-07 change, US-10; closed.»

`CLAUDE.md:25` — заміни «The folder holds CHECKPOINT-01, -02, -04 and -05;» на «The folder holds CHECKPOINT-01, -02, -03 and -03b (R4 is named 03b by decision, not 06);».

`CLAUDE.md:130` — заміни «Panel order top to bottom: button (added later), source label, card.» на:

```
Panel order top to bottom (R4): button, source label, last-attempt line, the permanent reload hint, card.
```

Після правок `CLAUDE.md`:

Run: `npx playwright test --project=unit tests/unit/pinned-prose-values.spec.ts tests/unit/verify-layer-doc.spec.ts`
Expected: passed — сторожі прози не зачеплені.

- [ ] **Step 3: Фінальний прогін**

Run: `lsof -iTCP:3000 -sTCP:LISTEN` — порожньо.
Run: `npm run verify:checkpoint; echo EXIT=$?`
Expected: 8 × PASSED, `EXIT=0` (у документах `no-secrets` теж сканує нові файли).

- [ ] **Step 4: Commit**

```bash
git add docs/checkpoints/CHECKPOINT-03b.md CLAUDE.md
git commit -m "docs(checkpoint): CHECKPOINT-03b — R4 закрито (B-18…B-21)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Тег, GitHub Release і злиття в `main` — людина.
