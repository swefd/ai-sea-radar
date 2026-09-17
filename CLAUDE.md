# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

B-01 delivered the skeleton: `package.json`, `tsconfig.json`, `next.config.ts`, `.nvmrc`, `.gitignore`, `app/layout.tsx`, `app/page.tsx`, a lock file, and a git repo on `main`. B-02 onward extends it — do not re-scaffold. The verify layer (`scripts/verify/`, `.claude/hooks/`, `.claude/settings.json`) came after B-02; it is working method, not a backlog item — see "Перевірка".

## What Sea Radar is

A local web app for a maritime training centre: a map of the Dover Strait with ships on it and a card per ship, run on the instructor's laptop during a lesson. Localhost only, loopback only, single user, nothing deployed.

## Requirements live in `docs/tasks/`

- `PROJECT_BRIEF.md` — the client contract: user stories US-01…US-10 with acceptance criteria.
- `SPRINT-01.md` — the current sprint (release R1, items B-01…B-07, covering US-01…US-04). Part A is what to build; Part B is the working method.
- `ABOUT.md` — how the course and its deliverables are organised.

Later sprint files are handed over **one at a time, deliberately**. Build only what is in the folder; do not design for requirements that have not arrived. Read the task file itself, never a summary of it.

Checkpoints go in `docs/checkpoints/CHECKPOINT-0N.md`, following `docs/checkpoints/TEMPLATE.md`. Neither exists yet — the template arrives with the course materials, so do not invent one and do not create the folder. What the verify layer owes that record is drafted in `docs/context/verify-layer.md`.

## Worked examples live in `reference/` — check there before writing from scratch

Six third-party repositories are checked out under `reference/` as study material. **They are not a dependency, not an import target, and not part of the deliverable** — but they are the reason several things in this project should not be invented. Before writing bearing maths, a Playwright config, an architecture decision or AIS parsing, look for the example that already exists.

Each subfolder has its own `CLAUDE.md` naming the two or three files worth opening and the traps in the rest. `reference/CLAUDE.md` is the index and carries the full rules; what follows is the short version.

| About to write… | Read first |
| --- | --- |
| `courseDeg` as the initial great-circle bearing (B-06) | `reference/geodesy/` — `latlon-spherical.js:222`, `dms.js:330`. ~10 lines to port |
| `playwright.config.ts` that boots the dev server (B-07) | `reference/bulletproof-react/apps/nextjs-app/playwright.config.ts` |
| strict `tsconfig.json`, file and folder conventions (B-01) | `reference/bulletproof-react/` — start at its `AGENTS.md` |
| a decision about where a module belongs | `reference/fsd-documentation/` **and** the installed `feature-sliced-design` skill (skill first) |
| an abstraction to remove real, existing duplication | `reference/design-patterns-typescript/` — read-only, see below |
| _(R2+, not now)_ AISStream messages and the socket handshake | `reference/ais-message-models/`, `reference/aisstream-typescript-example/` |

**Rules, non-negotiable:**

- **Copy, never install.** No extra dependencies this sprint — not `geodesy`, not `ws`, not `@aisstream/aisstream`. Port the few lines needed into the app's own source with a comment naming the origin.
- **Never `import` from `../reference/...`**, in app code or tests, at runtime or at type level.
- **Read-only.** Four of the six are live git checkouts; never edit a file there.
- **A reference shows _how_, never _what_.** `docs/tasks/` decides scope. React Query, Zustand, Tailwind, MSW, Vitest and Storybook appear in these repos; none of them is thereby permitted.
- **`design-patterns-typescript` is CC BY-NC-ND.** Read for the idea, write your own; its code must not be copied or adapted into the app. Everything else is MIT or ISC — port with attribution.
- **Don't read ahead.** The two AIS folders belong to R2. This sprint does not prepare for real data, and that includes studying it.
- **Keep it out of the build and out of the repo.** `reference/` holds 532 `.ts`/`.tsx` files, so exclude it from `tsconfig.json`, ESLint and Playwright's `testDir`, and list it in `.gitignore` when B-01 creates the repo — `fsd-documentation/.git` alone is 407 MB, and the client inspects the handed-over files.

Project-local notes (not third-party) are in `docs/context/`: `clean-code-ts.md`, a Next.js note on lazy-loading client components that bears on the client-only Leaflet mount in B-02, and `verify-layer.md` — what the verify layer owes the checkpoint record.

## Stack (fixed by SPRINT-01)

Node.js 24 · TypeScript 6.x `strict` · Next.js App Router + React · Leaflet 1.9.x · Playwright Test.

- Leaflet is **client-only** — it touches `window` and will break SSR and `next build`. Verify with a build, not by eye.
- Playwright Test is the **only** test runner. Do not add a second testing framework.
- Every agreed value below lives in **one** config location.
- Playwright Test runs two projects: `unit` (no browser) and `e2e` (chromium). Same runner, one config — there is still no second testing framework.
- ESLint 9 with a flat config came later, with the verify layer, not with SPRINT-01. It is a verification tool, not an application dependency — see "Перевірка".

## Commands

Run `nvm use` first — it reads `.nvmrc` (Node 24), the one place the version is pinned.

```
npm run dev      # http://localhost:3000 — binds 127.0.0.1:3000 explicitly; loopback only
npm run build    # next build — the SSR guard for Leaflet; run it as an acceptance check

npm run lint          # eslint .
npm run check-types   # tsc --noEmit

npm run verify             # the check registry, fast tier — run this after a change
npm run verify:full        # fast + build + e2e
npm run verify:checkpoint  # full, and a SKIPPED counts as a failure — see "Перевірка"

npx playwright test --project=unit          # unit tests: no browser, no dev server
npx playwright test --project=e2e           # browser tests; boots the dev server
npx playwright test                         # both projects; boots the dev server
npx playwright test path/to/file.spec.ts    # one file
npx playwright test -g "card opens"         # one test by name
```

Playwright's browser download is slow — run it in the background. Always pass `--project`: the dev server is booted for any selection that can include `e2e`, and a server failure in a unit run reads as a unit-test failure.

## Перевірка

Шар перевірки живе у `scripts/verify/` (реєстр, раннер, звіт, самі перевірки) і в `.claude/hooks/` (два хуки, які їх кличуть). Реєстр — **дані, не скрипти**: щоб додати перевірку, дописують `scripts/verify/registry.mjs`, а `run.mjs` не чіпають.

Тут — те, що треба знати, щоб **працювати**: команди, статуси, хуки і межі, узгоджені на цей спринт. Дослівні тексти `proves`/`blindSpot` із реєстру живуть у `docs/context/verify-layer.md` — див. нижче, чому саме так.

Числа, які цей розділ повторює за кодом — точні версії трьох інструментів перевірки і два таймаути хуків, — стереже `tests/unit/claude-md-pinned-values.spec.ts`. Піднімуть їх у `package.json` чи `.claude/settings.json`, а тут не оновлять — тест почервоніє; без нього проза дрейфувала б мовчки.

Розділ українською всередині англійського документа — свідомо: угоди цього шару, включно з текстами реєстру, узгоджені українською, і переклад завів би другу їх редакцію — рівно те роздвоєння, проти якого написане правило «Every agreed value below lives in **one** config location».

### Команди

| Команда | Що запускає | Коли |
| --- | --- | --- |
| `npm run verify` | рівень `fast` — усе, що не потребує браузера, демона чи мережі | після кожної зміни; ціль — секунди |
| `npm run verify:full` | `fast` + `build` + `e2e` | перед передачею людині й перед checkpoint |
| `npm run verify:checkpoint` | `full` із `--no-skip`: пропуск стає провалом | момент запису checkpoint |

CI в цьому проєкті немає й не передбачено («localhost only, loopback only, nothing deployed»), тож роль «моменту, коли пропуск недопустимий» відіграє checkpoint. Під `--no-skip` у запис не може потрапити зелене, під яким половина не бігла.

**Сьогодні `verify:checkpoint` виходить кодом 1, і це його робота, а не дефект.** `tests/e2e/` порожня — e2e-тести належать B-07, не цьому шару, — тож рядок `e2e` чесно каже `SKIPPED — 0 тестів написано`, а `--no-skip` так само чесно відмовляється назвати таку передачу повністю перевіреною. **Ворота готовності — `verify:full`.** Щойно тести B-07 з'являться **і проходитимуть**, обидві команди стануть зеленими без жодної правки коду шару; полагодити тут нічого. Про самі ненаписані тести шар нічого не обіцяє: написані й червоні дадуть `FAILED`, і це теж його робота.

### Статуси

Спека шару (§3.2) називає п'ять, і жоден не зводиться до іншого:

| Статус | Значення | Блокує |
| --- | --- | --- |
| `PASSED` | Виконалася, проблем не знайшла | ні |
| `FAILED` | Передумова була, перевірка виконалася, знайшла проблему | так |
| `SKIPPED` | Передумови справді не було (немає браузера, бінарника, 0 тестів). **Про код не говорить нічого** | лише за `--no-skip` |
| `NOT_RUN` | Перевірка з `after:` не запускалася, бо впала та, від якої вона залежить | так |
| `UNRUNNABLE` | Сама перевірка не змогла запуститися: `spawn ENOENT`, код виходу 127, нерозбірний вивід | так |

Розрізнення `FAILED` / `UNRUNNABLE` — не педантизм. Повідомити «перевірка впала», коли вона ніколи не могла запуститися, означає стверджувати щось про код, якого ніхто не перевіряв. Окремо: Playwright, що знайшов нуль тестів, дає `SKIPPED` з причиною «0 тестів написано», а **не** `PASSED`.

### Таблиця `proves` / `blindSpot` — у `docs/context/verify-layer.md`

Що кожна перевірка доводить і чого **не** доводить, дослівними текстами з реєстру, —
розділ 2 того файлу. Тут його навмисно немає: це довідка, яку відкривають свідомо, а не
настанова, потрібна щоходу. Там-таки лежить решта матеріалу для запису checkpoint і
повний перелік названих меж шару.

Розходження того розділу з `scripts/verify/registry.mjs` стереже
`tests/unit/verify-layer-doc.spec.ts`.

### Рух перевіряється візуально

Комірка `blindSpot` рядка `e2e` виконує пряму вимогу SPRINT-01: «Рух цього тижня перевіряється візуально; автоматична перевірка руху з керованим часом - завдання релізу R3, і в записі checkpoint це так і записується». Жоден рядок реєстру на рух не дивиться, і це не прогалина реалізації, а межа, узгоджена на цей спринт.

### Залежності, додані шаром — свідомий виняток

| Пакет | Версія | Навіщо |
| --- | --- | --- |
| `eslint` | `9.39.5` | рядок `lint`. Саме 9.x, і це вимір, а не обережність: `eslint-config-next` заявляє `eslint: >=9.0.0`, тобто формально дозволяє 10, але плагіни, які він тягне залежностями, доходять лише до `^9` — `eslint-plugin-react` до `^9.7`, `eslint-plugin-jsx-a11y` і `eslint-plugin-import` до `^9`. Це знімок встановленого дерева, а не обіцянка: після оновлення `eslint-config-next` перелік може стати іншим |
| `eslint-config-next` | `16.3.5` | точно під `next@16.3.5` |
| `@playwright/test` | `1.63.0` | рядки `unit` і `e2e`; прямо передбачений критерієм B-07 |

Це виняток із правила «no extra dependencies» у розділі Boundaries, і він свідомий: усі три — **інструменти перевірки, не залежності застосунку**, жодна не потрапляє до коду, що виконується в браузері. Другий тестовий раннер **не додається**: юніт-тести виконує Playwright Test окремим проєктом `unit` без браузера, тож критерій B-07 «інших тестових фреймворків немає» лишається виконаним — і це стереже рядок `deps-allowlist`, який звіряє `package.json` із літеральним списком в обидва боки.

### Два хуки

| Подія | Скрипт | Що робить |
| --- | --- | --- |
| `PostToolUse` на `Edit`/`Write` | `.claude/hooks/edit-check.mjs` | дає **lead**, ніколи статус: посеред рефакторингу код законно зламаний, і змушувати чинити файл 1 із 3 було б шкідливо. Канал блокування в цій події існує — неблокування тут вибір, а не обмеження |
| `Stop` | `.claude/hooks/stop-gate.mjs` | **єдине місце шару, де народжується статус.** Запускає `fast`-рівень над деревом, яке назвала подія, і на блокувальному вердикті не дає завершити хід |

Обидва беруть корінь дерева з поля `cwd` вхідної події, а **не** з `$CLAUDE_PROJECT_DIR`: у git worktree змінна лишається на головному checkout, і гейт перевіряв би не те дерево, яке редагують. Змінна каже тільки, **де лежить скрипт**.

Таймаути задані явно — `PostToolUse` 120 с, `Stop` 300 с, — бо дефолт command-хука дорівнює **600 с**, а гейт, що висить десять хвилин, зламаний. Число 60 с, яке ходить поруч, стосується хуків **типу `agent`**, не command-хуків.

Перші два числа попереднього абзацу стереже тест, названий вище. Два останні — **ні, і не можуть**: вони з документації Claude Code, а не з файлу цього репозиторію, тож у разі її зміни ця фраза застаріє мовчки. Звіряйте їх із документацією, а не з цим рядком.

`Stop` мусить лишатися **більшим** за власний таймаут раннера в гейті (`RUNNER_TIMEOUT_MS` у `stop-gate.mjs`), і причина сильніша за акуратність: Claude Code скасовує command-хук, що вперся в таймаут, **відкидаючи його вивід**. Гейт, який чесно вирішив блокувати, віддав би цей вердикт у порожнечу. Нерівність тримає тест, а не коментар.

**Увімкнення перевірено формою, але не спрацюванням.** `.claude/settings.json` валідний, обидві події на місці, шляхи абсолютні й розкриваються, таймаути явні, і кожна команда справді запускається (перевірено синтетичним входом: на зламаному дереві `edit-check` дає lead із помилкою типу, `stop-gate` — блокування й код виходу 2, на зеленому — код 0). Чого це **не** доводить: що Claude Code ці хуки викликає. Хуки читаються на старті сесії, а перезапустити сесію може лише людина. Точні кроки живої перевірки — у `docs/context/verify-layer.md`.

### Коли ламається сам гейт, захистом є людина, а не механізм

Зламавшись сам — раннер не запустився, звіт нерозбірний, ключа `reused` немає, — гейт виходить кодом 0 і друкує `systemMessage`. Документація описує `systemMessage` як повідомлення **користувачеві**, а для події `Stop` єдиний канал, що доходить до моделі, — це `decision: block` разом із кодом 2. Другого каналу немає, і переводити власну поломку гейта на блокування відкинуто свідомо: зламаний гейт не дає моделі предмета для лагодження, тож це був би livelock без виходу.

Отже: шар боронить від «зелено, хоч насправді зламано». Від «шар мовчить, бо зламався сам» боронить не він, а людина, яка читає повідомлення. Друге трапляється рідше, але воно можливе, і подавати його як покрите було б тією самою неправдою, яку шар ловить у чужому коді.

### Чого цей шар не доводить

Розділ обов'язковий: шар, який не називає власних сліпих плям, сам стає тим, від чого мав би берегти.

- **Нічого візуального.** Сіра карта, картка, що роз'їхалася, значок під неправильним кутом — усе це проходить кожен рядок реєстру. SPRINT-01 покладає це на очі, і так і лишається.
- **Нічого про рух.** Свідомо, до R3.
- **Нічого про формати з ТЗ**, поки хтось не напише unit-тест на кожен. Тека `tests/unit/` більше не порожня, але живуть у ній тести **самого шару перевірки**: рядок `unit` зелений за них, а не за формати картки.
- **Нічого про судження моделі.** Findings Клода лишаються lead: хук їх не рахує й не може перевірити. Це припис у тексті блокування, а не механізм.
- **Нічого про те, чого немає в реєстрі.** Реєстр — межа того, що шар узагалі бачить.
- **Не доводить, що написані тести виконалися.** `test.only` за невимкненого `forbidOnly` або суцільний `test.skip` дають код виходу 0, і рядки `unit`/`e2e` показують `PASSED` за прогін, у якому не виконано жодного твердження (відтворено, не виведено з конфігу).
- **Не доводить, що `blindSpot` каже правду.** Ці тексти **рецензовані, не перевірені**: жоден тест не спіймав би комірку, яка обіцяє більше, ніж ловить перевірка. Кожне розширення, яке тут сталося, знайшла людина, що читала текст проти коду.
- **Не доводить, що зелена сюїта стереже.** Зелений тест доводить, що перевірка **проходить**, а не що вона **вартує**. За час побудови шару мутаційне тестування знайшло шість тестів, які мали назву варти, а вартували щось сусіднє; кожен був зелений і кожен виглядав доречно. Друге твердження доводилося окремо й вручну, для кожної зміни.
- **Нічого про те, що Claude Code справді вантажить ці хуки** — див. «Два хуки» вище.
- **Не бачить `.claude/settings.local.json`.** Файл у `.gitignore`, тож перелік переданих файлів його не повертає й хеш свіжості його не бачить: правка в ньому лишає закешоване зелене на вигляд чинним.

Повніший перелік названих меж — із вимірами й причиною, чому кожну лишили, — у `docs/context/verify-layer.md`.

## Agreed values

**Region.** Dover Strait, 50.75°N/0.95°E → 51.25°N/1.95°E. Initial view: centre 51.00°N, 1.45°E, zoom 10. Tiles: OpenStreetMap Standard, attribution "© OpenStreetMap contributors".

**Vessel** — one shape for demo and real ships: `id` (string; `demo-1`…`demo-3`), `name` (string | `null`; empty string → `null`), `lat`, `lon`, `speedKnots` (number | `null`), `courseDeg` (number in [0, 360) | `null` — course over ground, not heading), `timestamp` (ISO 8601 with zone), `source` (`'demo'` | `'aisstream'`).

**`0` and `null` are different things.** Unknown renders as "Немає даних"; a real zero speed renders as `0 kn`.

**Card formats**, literally: coordinates `toFixed(5)` keeping trailing zeros (`51.00000, 1.45678`); speed to one decimal with no trailing zeros plus suffix (`12.3 kn`, `12 kn`, `0 kn`); course `Math.round % 360` plus degree sign (`135°`); time `12:00:00 UTC`; source "Демонстраційні дані" / "AISStream". Name renders as **text, not HTML** — a vessel named `<b>Демо</b>` must show the tags as characters.

**Card behaviour.** No close button. It closes only by selecting a different vessel; a repeat click on the same vessel and a click on the map both leave the selection unchanged. Panel order top to bottom: button (added later), source label, card.

**Icon.** Oriented by `courseDeg`; neutral circle when `null`. Carries `data-vessel-id="<id>"` and `data-icon="course"|"neutral"` — tests locate vessels by these attributes and nothing else.

**Demo ships.** Three, named "Демо-судно 1"…"Демо-судно 3". Each has 8–12 route points inside the region and a speed in knots, written as literals. `DEMO_TICK_MS = 2000`. Course is the initial great-circle bearing of the segment — at start toward point two, afterwards from previous point to current. Step time is real browser time; at start, the moment the timer launched. On the same tick the ship reaches its last point, speed becomes `0` and nothing changes after that. A page refresh restarts from the beginning. No pause, no rewind, no looping.

The map and the card must read from the same state, and one tick drives all ships. Clear timers on unmount — they must not accumulate across re-renders or hot reloads.

## Boundaries this sprint

No real data, no fetch button, no server-side scaffolding, no "for later" folders, no example code from `create-next-app`, no extra **application** dependencies — the three verification tools (`eslint`, `eslint-config-next`, `@playwright/test`) are a deliberate exception, justified and recorded in "Перевірка". Real AIS data is a later release; do not prepare for it.

The brief also rules these out permanently: zones and alerts, track history and playback, search and filters, multiple regions, saved settings, live streaming, remote access, hosting, predictions.

## Secrets

Never read or print secrets. The AISStream key must not reach source, delivered files, or the screen — the client checks the handed-over files for it during acceptance.

## Working method

One or two requests per backlog item, each carrying: the boundaries, the check that proves it done, and a pointer to the task file. Plan B-01…B-04 before the first edit, with no edits during planning. After each item: show the diff against the task, change no code, and separate what a test proved from what was only checked visually — then accept, return, or stop. Movement this sprint is verified visually; automated movement tests with controlled time are R3, and the checkpoint record says so.
