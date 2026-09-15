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
  ]),
  ...nextVitals,
  {
    // Node-глобали для всього, що виконує НЕ браузер: скрипти шару й хуки.
    // Конфіг Next/React дає файлам браузерні глобали, тож без цього блоку
    // `no-undef` червонітиме на кожному `process` і `Buffer` у `.mjs`.
    // Об'єкт виписано літералом: пакет `globals` НЕ встановлюється —
    // CLAUDE.md забороняє залежності понад три з кроку 2.
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
  },
]);
