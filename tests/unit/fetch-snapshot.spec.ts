import { test, expect } from '@playwright/test';

import { fetchSnapshot } from '@/_pages/home/lib/fetch-snapshot';

// Клієнтський шлях до `/api/snapshot`. Усе, що не є відповіддю зрозумілої
// форми, стає `null`: інтерфейс перекладає його в помилку "Немає відповіді
// сервера" і не зависає в стані завантаження (план SPRINT-03, Review Focus 4).
// Мережі немає: `fetch` підставний, відповіді — літерали.

function stub(result: () => Promise<Response>): typeof fetch {
  return (() => result()) as typeof fetch;
}

test('відхилений проміс fetch → null', async () => {
  const result = await fetchSnapshot(stub(() => Promise.reject(new TypeError('Failed to fetch'))));
  expect(result).toBeNull();
});

test('тіло не JSON → null', async () => {
  expect(await fetchSnapshot(stub(async () => new Response('not json')))).toBeNull();
});

test('JSON без булевого ok → null', async () => {
  expect(await fetchSnapshot(stub(async () => new Response('{}')))).toBeNull();
});

test('помилка сервера з тілом 502 повертається як є', async () => {
  const body = {
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'internal', message: 'Внутрішня помилка сервера' },
  };
  const result = await fetchSnapshot(stub(async () => Response.json(body, { status: 502 })));
  expect(result).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'internal', message: 'Внутрішня помилка сервера' },
  });
});
