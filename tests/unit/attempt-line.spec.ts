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
