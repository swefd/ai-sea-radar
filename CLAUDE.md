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

Джерело істини для таблиць нижче — той самий `registry.mjs`. Таблиця тут — ручна копія, і копію стереже `tests/unit/claude-md-registry.spec.ts`: розходження робить тест червоним, а не мовчазним.

Розділ українською всередині англійського документа — свідомо. Тексти `proves` і `blindSpot` узгоджені українською й перенесені сюди **дослівно**; переклад завів би другу редакцію тієї самої угоди, тобто рівно те роздвоєння, проти якого написане правило «Every agreed value below lives in **one** config location».

### Команди

| Команда | Що запускає | Коли |
| --- | --- | --- |
| `npm run verify` | рівень `fast` — усе, що не потребує браузера, демона чи мережі | після кожної зміни; ціль — секунди |
| `npm run verify:full` | `fast` + `build` + `e2e` | перед передачею людині й перед checkpoint |
| `npm run verify:checkpoint` | `full` із `--no-skip`: пропуск стає провалом | момент запису checkpoint |

CI в цьому проєкті немає й не передбачено («localhost only, loopback only, nothing deployed»), тож роль «моменту, коли пропуск недопустимий» відіграє checkpoint. Під `--no-skip` у запис не може потрапити зелене, під яким половина не бігла.

**Сьогодні `verify:checkpoint` виходить кодом 1, і це його робота, а не дефект.** `tests/e2e/` порожня — e2e-тести належать B-07, не цьому шару, — тож рядок `e2e` чесно каже `SKIPPED — 0 тестів написано`, а `--no-skip` так само чесно відмовляється назвати таку передачу повністю перевіреною. **Ворота готовності — `verify:full`.** Коли B-07 напише тести, обидві команди стануть зеленими без жодної правки коду; полагодити тут нічого.

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

### Що кожна перевірка доводить — і чого не доводить

Рівень `fast`:

| id | Команда | Доводить | Не доводить |
| --- | --- | --- | --- |
| `typecheck` | `npm run --silent check-types` | Кожен `.ts`/`.tsx` проєкту компілюється під `strict` із типами Next | Нічого про поведінку в рантаймі. `skipLibCheck: true` ховає помилки чужих `.d.ts`. Leaflet не виконується, тож звернення до `window` на рівні модуля тут скомпілюється успішно. Код самого шару не дивиться зовсім: за `allowJs: false` жоден `scripts/**/*.mjs` і жоден `.claude/hooks/**/*.mjs` не потрапляє в програму TypeScript. Сусідні `.d.mts` написані руками й ніколи не звіряються зі своїм `.mjs`: оголошення може розійтися з реалізацією або бути вигадкою повністю, а `check-types` лишиться зеленим |
| `lint` | `npm run --silent lint` | Жоден файл не порушує правила `eslint-config-next` і базові правила TS | Стиль і статичні шаблони, не логіку. Правило, якого немає в конфігу, не порушується за визначенням. `no-undef` увімкнено лише для `scripts/**/*.mjs` і `.claude/hooks/**/*.mjs`, і навіть там `eslint-config-next` віддає цим файлам ще й браузерний набір глобалей — тож `window`, `document` чи `localStorage`, помилково вжиті в серверному скрипті, не позначаються ніколи. Периметр задає явний список ігнорів, а не дерево репозиторію: `reference/**`, `.verify/**`, `.claude/worktrees/**`, `.superpowers/**` і вивід збірки не лінтуються взагалі. Flat-конфіг не читає `.gitignore`, тож цей список — єдине, що визначає межу |
| `unit` | `npx playwright test --project=unit` | Чисті функції поводяться як задано — для написаних випадків | Ні DOM, ні Leaflet. Браузера не піднімає — але це домовленість тестів, а не заборона в конфігу: спека, яка звернеться до `page`, підніме chromium і в цьому проєкті. Про рендер і карту не говорить нічого. Випадок, якого ніхто не написав, не покритий. Написаний, але не виконаний випадок — теж не покритий: `test.only` за невимкненого `forbidOnly`, суцільний `test.skip` або звуження через `--grep` лишають вихід 0, а проба переліку рахує такі тести як наявні, тож `emptyProbe` не спрацьовує. Рядок покаже PASSED прогону, в якому не виконано жодного твердження |
| `no-ref-imports` | `node scripts/verify/checks/no-ref-imports.mjs` | Жоден файл із периметра свіжості (`hash.mjs:isSourcePath`) з розширенням коду або `.css` не містить специфікатора В ЛАПКАХ, у шляху якого є сегмент `reference`, у жодній із форм, які впізнає `FORMS` самої перевірки, — ні в рантаймі, ні на рівні типів, ні в багаторядковій формі, ні коли між ключовим словом і `from` стоїть коментар із крапкою з комою, — КРІМ файлів, у яких маркер коментаря або лапка стоять усередині конструкції, якої забілення коментарів не моделює. Цей виняток — КЛАС, а не перелік написань, і його межі описано в `blindSpot`. Вужче формулювання тут ставити не можна: воно вже тричі обіцяло більше, ніж ловить сканер | Тільки статичні літерали шляхів У ЛАПКАХ. `@import url(…)` без лапок — валідний CSS — проходить мовчки. Шлях, зібраний обчисленням у рантаймі, невидимий. Аліас у `paths` з `tsconfig.json`, що вказує на `reference/`, дав би імпорт, якого цей сканер не бачить. `/// <reference types="…" />` проходить мовчки: ловиться лише варіант із `path=`. Файли, ігноровані git-ом, не скануються. Периметр — це периметр хеша свіжості, звужений за розширенням, і звуження реальне: `.json`, `.scss`, `.nvmrc`, `.md` і будь-яке інше розширення поза списком не читаються взагалі, хоча в ключ свіжості входять. Сам периметр розійтися з хешем більше не може — це один і той самий `isSourcePath`, а не два узгоджені списки. Число порушень уміє занижувати: ключ дедуплікації — рядок плюс специфікатор, тож два порушення з тим самим шляхом, що починаються на ОДНОМУ рядку, дають один рядок звіту. Вердикт від цього не міняється ніколи (нуль проти не-нуля), лише N. У зворотний бік сканер свідомо перебирає: він не парсить мову, тож проза, яка саме правило ЦИТУЄ, здатна дати хибне спрацювання — і закоментований імпорт теж рахується порушенням навмисно. Це вибір «перебір безпечний, недобір — ні», а не недогляд. Ціна того ж вибору — номер рядка: збіг починається від ключового слова, тож зайвий `import` у коментарі вище, без крапки з комою між ними, здатен приписати справжнє порушення своєму рядку, а не рядку імпорту. Забілення коментарів для другого проходу знає РІВНО три речі: літерал у лапках (одинарних, подвійних, бектиках), рядковий коментар і блоковий коментар. Мови воно не розбирає. Звідси клас — і він твердження про СЛОВНИК алгоритму, а не перелік написань: маркер коментаря, що стоїть усередині будь-якої конструкції, ЯКОЇ ЗАБІЛЕННЯ НЕ МОДЕЛЮЄ, читається як справжній маркер; лапка всередині такої конструкції додатково збиває парування літералів далі за текстом. Виміряні джерела — тіло регекс-літерала, текст JSX і вкладений шаблон; перелік закритим не є, бо істинна тут перша фраза, а не список. Помилка від цього буває в ОБИДВА боки, і боки нерівні. Забілити МЕНШЕ безпечно: прохід 1 по сирому тексту лишається підлогою. Забілити БІЛЬШЕ небезпечно — саме звідси й виходить НЕДОБІР, коли збігаються чотири умови: (1) у тексті є конструкція, якої забілення не моделює; (2) через неї відкривається коментар, якого в JavaScript немає; (3) забілений цим хибним коментарем регіон накриває справжній імпорт — для блокового маркера це будь-яка відстань до першого справжнього закривача НИЖЧЕ, для рядкового лише решта ТОГО Ж рядка; (4) прохід 1 цього імпорту сам не бачить (звично: крапка з комою в коментарі відділяє ключове слово від `from`). Умови «на одному рядку» серед необхідних НЕМАЄ: вона потрібна лише гілці з рядковим маркером, а гілка з блоковим працює через довільну кількість рядків. На сьогоднішньому дереві клас нежилий, і це факт про периметр, а не властивість алгоритму: вставка справжнього порушення в кожну живу позицію периметра не губиться в жодній (виміряно). Нежилим він лишається рівно доти, доки в периметрі немає ні вкладених шаблонів, ні регекс-літерала з маркером усередині. Задача 6 поклала в периметр `checks/no-secrets.mjs` — найщільнішу тут концентрацію регекс-літералів — і клас від цього НЕ ожив: вставка порушення в кожну з 298 позицій того файлу станом на c8d7cc5 не загубилася в жодній із 153 позицій живого коду (виміряно). Число датоване, бо міряє чужий файл, який ще редагують: на 65ed7b6 позицій було 288, а вимір лишається тим самим. Прогноз «досяжно вже наступною задачею» замінено на цей вимір |
| `no-secrets` | `node scripts/verify/checks/no-secrets.mjs` | Жоден файл, що потрапляє до передачі, не містить рядків, схожих на ключ або токен | Порівняння за шаблонами: секрет у незвичному кодуванні або розбитий на рядки невидимий. Ігноровані git-ом файли не скануються — і не передаються. Бінарні файли (NUL у перших 8 КіБ) пропускаються цілком. Збіг, що містить маркер плейсхолдера, відкидається без розгляду: на цьому дереві так відкинуто 2 збіги (виміряно), тож справжній ключ, дописаний поряд зі словом EXAMPLE чи YOUR_, лишився б непоміченим. Скануються ВМІСТ файлів, а не їхні шляхи: секрет, вписаний у саму назву файлу або теки, невидимий. Поза периметром — рівно два файли, що оголошують самі шаблони: scripts/verify/checks/no-secrets.mjs і tests/unit/no-secrets.spec.ts; секрет, вписаний у будь-який із них, невидимий. Файл, що є в індексі — тобто передається, — але зник із диска між переліком і читанням, не сканується: гонку терплять, щоб вона не валила прогін. Усі чотири пропуски — бінарний, поіменний, плейсхолдерний і зниклий — порахано; перші три друкуються в підсумку кожного прогону, і зеленого теж, четвертий — лише коли він не нуль |
| `deps-allowlist` | `node scripts/verify/checks/deps-allowlist.mjs` | `package.json` збігається з літералом `ALLOWED` у самій перевірці — і по іменах, і по ТОЧНИХ версіях, в обидва боки: зайвий пакет у `dependencies` чи `devDependencies` провалює її так само, як і узгоджений, що зник. Ключі верхнього рівня — теж allowlist (`ALLOWED_TOP_LEVEL`), тож БУДЬ-ЯКИЙ незнайомий ключ провалює перевірку, навіть той, про який ніхто не думав: `peerDependencies`, `overrides`, `workspaces`, `pnpm`, `bun` і все, що з'явиться далі. Другий тестовий раннер і друга бібліотека карт провалюються як будь-який інший незнайомий пакет; denylist у перевірці змінює лише текст повідомлення, не вирок | Тільки прямі залежності одного файлу. Не доводить, що дозволена залежність узагалі використовується, і не читає `package-lock.json` — підміна пакета на тій самій версії невидима, як і будь-що в `node_modules`. Транзитивне дерево поза нею цілком: `eslint-config-next` тягне `eslint-plugin-react`, `eslint-plugin-jsx-a11y` та `eslint-plugin-import` (виміряно на c8be2cb), і про них перевірка не говорить нічого. Ключі верхнього рівня звіряються ОДНОБІЧНО і лише як імена: питається «чи немає зайвого», ніколи «чи всі на місці», а ВМІСТ дозволеного ключа не читається взагалі. Тому мовчки проходять (виміряно на копії справжнього маніфесту, 0438273): маніфест без `private`, тобто зі зниклим захистом від публікації в npm — так само як без `name`, `version` чи `scripts`; `private: false` при наявному ключі; і другий раннер, доданий рядком у `scripts` (`"test": "vitest run"`). Двобічна звірка імен закрила б лише перший із трьох випадків, тому правило лишається однобічним: наявність ключа тут не доводить нічого про його значення. Сам набір — літерали у файлі перевірки: разом із `package.json` рухаються троє — `ALLOWED`, `ALLOWED_TOP_LEVEL` і сам маніфест, — тож коміт, що править їх усіх, проходить мовчки; перевірка доводить згоду з літералами, а не з брифом, і саме цього від неї й чекають. Пріоритет allowlist над denylist спостережний лише за непорожнього перетину списків; на справжньому наборі перетин порожній (це пінить тест «перетин ALLOWED і DENIED порожній»), тож розворот пріоритету червонить рівно один тест — той, що вносить колізію сам, на час одного твердження |

Рівень `full`:

| id | Команда | Після | Доводить | Не доводить |
| --- | --- | --- | --- | --- |
| `build` | `npm run --silent build` | `typecheck` | Застосунок збирається і серверний рендер не звертається до `window` на рівні імпорту — запобіжник SSR для Leaflet | Нічого не натискає. Карта, що вийшла сірою, збірку проходить |
| `e2e` | `npx playwright test --project=e2e` | `build` | Поведінки вибору з B-07 виконуються у справжньому chromium проти dev-сервера | **Рух не перевіряє** — перевірка руху з керованим часом належить R3. Тайли заблоковані, тож про справжні зображення карти не говорить нічого. Не доводить, що dev-сервер зібрано саме з цього дерева: `reuseExistingServer: true` прийме вже піднятий сервер іншої гілки. Те саме, що й у `unit`: `test.only` за невимкненого `forbidOnly` чи суцільний `test.skip` дають вихід 0 і PASSED без жодного виконаного твердження |

**`no-secrets` не друкує знайденого.** Звіт дає `file:line`, назву шаблону й довжину збігу, ніколи сам рядок — інакше перевірка порушувала б правило, яке охороняє.

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
