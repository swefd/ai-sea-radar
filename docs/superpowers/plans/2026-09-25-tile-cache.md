# Кеш тайлів карти — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** переглянуті онлайн тайли карти лишаються видимими, коли мережа зникла або погіршилась.

**Architecture:** service worker перехоплює лише GET до хоста тайлів, зберігає відповіді в Cache API і віддає їх за стратегією «спершу кеш, мережа у фоні». Строки бере із заголовків OSM. Логіка рішень — чисті функції в окремому модулі, який перевіряють unit-тести; SW компілюється вже встановленим `tsc` у `public/`.

**Tech Stack:** TypeScript 6 strict · Next.js App Router · Service Worker + Cache API · Playwright Test (`unit`, `e2e`)

**Spec:** `docs/superpowers/specs/2026-09-25-tile-cache-design.md`

## Global Constraints

- Нових залежностей немає. `package.json` отримує лише скрипти.
- `map.ts`, `L.tileLayer`, `urlTemplate`, атрибуція не змінюються. Хост тайлів вписаний лише в `OSM_TILE_LAYER.urlTemplate`.
- Строки свіжості й вікна — із заголовків відповіді. Якщо директиви немає, діє 7 днів із політики OSM.
- SW обробляє лише `GET` до хоста тайлів. Для решти `respondWith` не викликається.
- Файли SW лежать у корені `public/`, згенеровані, у `.gitignore`.
- `tests/e2e/select.spec.ts` не змінюється жодним рядком.
- Тести шукають судна лише за `data-vessel-id` (CLAUDE.md).

## Відхилення від спеки, прийняте в цьому плані

Спека §4.4 пропонує `lib: WebWorker` у `tsconfig.sw.json` і `exclude` для `tile-sw.ts` у головному `tsconfig`. **Замість цього:** SW описує потрібні йому члени SW API локальним інтерфейсом і компілюється з `lib: DOM`, як решта коду. Причина: `scripts/verify/hash.mjs:78` оголошує `NON_SOURCE_PREFIXES` дзеркалом `exclude` головного `tsconfig` — «рівно воно». Новий `exclude` зламав би цю рівність. Виграш: головний `tsc` перевіряє SW під strict без жодного виключення. Ціна: локальний інтерфейс — ручний опис чужого API. Він вузький (п'ять членів), і будь-яка розбіжність із браузером проявиться в e2e. Спека оновлюється в тому ж коміті, що й цей план.

## Review Focus

1. **Перше відкриття до активації SW** — тайли, запитані до того, як SW узяв сторінку під контроль, у кеш не потрапляють. Очікувано: після одного оновлення онлайн карта працює офлайн. Пришпилено: Task 3, послідовність «відкрити → оновити → офлайн → оновити».
2. **OSM відповів 404, 429, 5xx чи непрозоро** — така відповідь не стає офлайн-копією. Пришпилено: Task 1, `isStorable`.
3. **Статика Next, HMR і `/api/snapshot` ідуть повз SW** — інакше SW зламав би розробку й кнопку R2. Пришпилено: Task 1 (`isTileRequest`) і Task 3 (жодна loopback-відповідь не `fromServiceWorker`).
4. **Нерозбірні заголовки** (`max-age=abc`, `s-maxage` поряд із `max-age`, битий `Expires`, заголовка немає) — логіка не падає і не вигадує строк. Пришпилено: Task 1.
5. **SW заблокований чи реєстрація впала** — сторінка працює як сьогодні. Пришпилено: Task 3, увесь `select.spec.ts` іде з `serviceWorkers: 'block'`.

---

### Task 1: Чиста логіка свіжості

**Files:**
- Create: `src/_app/tile-cache/tile-freshness.ts`
- Test: `tests/unit/tile-freshness.spec.ts`

**Interfaces:**
- Produces:
  - `TILE_CACHE_NAME: 'tile-cache-v1'`, `TILE_CACHE_PREFIX: 'tile-cache-'`, `FETCHED_AT_HEADER: 'x-tile-fetched-at'`, `OSM_MIN_RETENTION_MS: number`
  - `type TileCopyState = 'fresh' | 'revalidate' | 'stale-if-error' | 'expired'`
  - `classifyCopy(headers: Headers, now: number): TileCopyState`
  - `isTileRequest(method: string, url: string, tileHost: string | null): boolean`
  - `isStorable(status: number): boolean`
  - `stampFetchedAt(headers: Headers, now: number): Headers`

- [ ] **Step 1: Написати тести, що падають** — `tests/unit/tile-freshness.spec.ts` (код у репозиторії, покриває: кожен стан, межі ±1 мс, резерв 7 днів, резерв через `x-tile-fetched-at`, нерозбірні заголовки, фільтр запитів, `isStorable`, `stampFetchedAt`).
- [ ] **Step 2:** `npx playwright test --project=unit tests/unit/tile-freshness.spec.ts` — FAIL: модуля немає.
- [ ] **Step 3:** реалізувати `tile-freshness.ts`.
- [ ] **Step 4:** той самий запуск — PASS; `npm run check-types`, `npm run lint` — чисто.
- [ ] **Step 5:** коміт `feat(tile-cache): чиста логіка свіжості тайлів із заголовків OSM`.

### Task 2: Service worker, збірка і реєстрація

**Files:**
- Create: `src/_app/tile-cache/tile-sw.ts`, `src/_app/tile-cache/tile-sw-url.ts`, `src/_app/tile-cache/register-tile-cache.tsx`, `src/_app/tile-cache/index.ts`, `tsconfig.sw.json`
- Modify: `app/layout.tsx`, `package.json` (скрипти `predev`, `prebuild`, `build:sw`, `check-types`), `.gitignore`, `eslint.config.mjs`
- Test: `tests/unit/tile-sw-url.spec.ts`

**Interfaces:**
- Consumes: усе з Task 1.
- Produces: `tileServiceWorkerUrl(urlTemplate: string): string` → `/tile-sw.js?host=<hostname>`; `TILE_SW_SCOPE = '/'`; компонент `RegisterTileCache` з `@/_app/tile-cache`.

- [ ] **Step 1:** тест `tile-sw-url.spec.ts` на синтетичному шаблоні `https://tiles.example.test/{z}/{x}/{y}.png` → `/tile-sw.js?host=tiles.example.test`. FAIL.
- [ ] **Step 2:** `tile-sw-url.ts` — PASS.
- [ ] **Step 3:** `tile-sw.ts`, `tsconfig.sw.json`, скрипти, `.gitignore`, ігнор ESLint.
- [ ] **Step 4:** перевірити передумови спеки §10: `npm run build:sw` дає `public/tile-sw.js` і `public/tile-freshness.js`; `npm run check-types` зелений (головний `tsconfig` приймає `./tile-freshness.js`); `npm run lint` чистий; `npm run build` зелений.
- [ ] **Step 5:** `register-tile-cache.tsx`, `index.ts`, рядок у `app/layout.tsx`; `npm run build` зелений; `curl -sI http://127.0.0.1:3000/tile-sw.js` → `200`, `Content-Type` JavaScript.
- [ ] **Step 6:** коміт `feat(tile-cache): service worker кешу тайлів і його реєстрація`.

### Task 3: E2E

**Files:**
- Modify: `playwright.config.ts` (проєкт `e2e`: `use.serviceWorkers: 'block'`)
- Create: `tests/e2e/tile-cache.spec.ts`

- [ ] **Step 1:** `serviceWorkers: 'block'` у проєкті `e2e`; `npx playwright test --project=e2e tests/e2e/select.spec.ts` — зелений.
- [ ] **Step 2:** `tile-cache.spec.ts`: `serviceWorkers: 'allow'`, `context.route` віддає 1×1 PNG із заголовками кешу й `access-control-allow-origin: *`; відкрити, дочекатися контролю SW, оновити; перейти в офлайн (`abort` для всього не-loopback); оновити; усі `.leaflet-tile` завантажені, тайлові відповіді сторінки `fromServiceWorker()`, жодної успішної зовнішньої відповіді в офлайні. Другий тест: жодна loopback-відповідь не `fromServiceWorker()`.
- [ ] **Step 3:** `npx playwright test --project=e2e` — зелений. **Якщо перший тест червоний через те, що Chromium не приймає `cors`-відповідь на `no-cors`-запит `<img>` — зупинитися й повернутися до дизайну (спека §10.1).**
- [ ] **Step 4:** коміт `test(e2e): кеш тайлів офлайн; тести вибору — з вимкненим SW`.

### Task 4: Шар перевірки

**Files:**
- Modify: `scripts/verify/registry.mjs` (рядки `typecheck`, `e2e`: `proves`, `blindSpot`), `docs/context/verify-layer.md` (§2, дослівно ті самі тексти)

- [ ] **Step 1:** оновити тексти в обох файлах.
- [ ] **Step 2:** `npx playwright test --project=unit tests/unit/verify-layer-doc.spec.ts` — зелений.
- [ ] **Step 3:** `npm run verify:full` — зелений.
- [ ] **Step 4:** коміт `docs(verify): typecheck і e2e тепер кажуть про кеш тайлів`.
