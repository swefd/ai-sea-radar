// Flat config. `next lint` видалено в Next 16 — ESLint викликається напряму.
// `eslint-config-next/core-web-vitals` експортує масив flat-конфігів.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  globalIgnores([
    // Дефолтні ігнори eslint-config-next перелічено явно, бо поведінка
    // успадкованих ignore-патернів не має бути припущенням: у flat-конфігу
    // глобальні ігнори НАКОПИЧУЮТЬСЯ, і покладатися на це наосліп — те саме,
    // що не знати периметра лінту.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Чуже й не наше. 532 сторонні .ts/.tsx — CLAUDE.md, reference/CLAUDE.md.
    'reference/**',
    // Звіти шару перевірки та робочі копії Claude Code.
    '.verify/**',
    '.claude/worktrees/**',
    // Робоча тека контролера: чернетки плану й пре-флайт копії майбутніх
    // файлів. Flat-конфіг не читає `.gitignore`, тож без цього рядка `eslint .`
    // заходить у неї — а `lint` перезапускає кожна задача 2–12 (R-09), і
    // випадкова помилка в чернетці зробила б червоною задачу, чий виконавець
    // цих файлів навіть не має права чіпати (R-37).
    '.superpowers/**',
  ]),
  ...nextVitals,
  {
    // Блок для всього, що виконує НЕ браузер: скрипти шару й хуки.
    //
    // Несучі тут дві речі — звуження `files:` і `rules`. `no-undef` вмикається
    // свідомо: `eslint-config-next@16.3.5` не вмикає його ніде, а `tsc` цих
    // файлів не бачить зовсім — R-08 фіксує `allowJs: false`, тож `.mjs` не
    // потрапляє у програму TypeScript. Без цього рядка код шару не перевіряє
    // НІЩО, і звичайна одруківка в імені доживає до запуску (R-38).
    //
    // `globals` нижче — свідомий ПОВТОР, а не необхідність. `nextVitals` уже
    // оголошує і браузерний, і Node-овий набір для `**/*.mjs`: його власний
    // об'єкт несе `files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}']` поряд із
    // `globals: {...globals.browser, ...globals.node}`
    // (eslint-config-next/dist/index.js:109-113 і :139), тож усі дев'ять імен
    // приходять звідти й без нас. Повтор лишається з тієї самої причини, що й
    // явний перелік ігнорів вище: успадкована поведінка не має бути
    // припущенням. З увімкненим `no-undef` ціна такого припущення зросла —
    // оновлення, що перетасує `globals.node`, інакше зробило б червоним кожен
    // `process` у шарі (R-40). Пакет `globals` НЕ встановлюється: CLAUDE.md
    // забороняє залежності понад три з кроку 2, тож об'єкт виписано літералом.
    files: ['scripts/**/*.mjs', '.claude/hooks/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
]);
