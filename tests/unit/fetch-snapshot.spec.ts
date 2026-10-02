import { test, expect } from '@playwright/test';

import { fetchSnapshot } from '@/_pages/home/lib/fetch-snapshot';
import { DEFAULT_SNAPSHOT_SETTINGS } from '@/shared/config';

// Клієнтський шлях до `/api/snapshot`. Усе, що не є відповіддю зрозумілої
// форми, стає `null`: інтерфейс перекладає його в помилку "Немає відповіді
// сервера" і не зависає в стані завантаження (план SPRINT-03, Review Focus 4).
// Мережі немає: `fetch` підставний, відповіді — літерали.

function stub(result: () => Promise<Response>): typeof fetch {
  return (() => result()) as typeof fetch;
}

test('відхилений проміс fetch → null', async () => {
  const result = await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, undefined, stub(() => Promise.reject(new TypeError('Failed to fetch'))));
  expect(result).toBeNull();
});

test('тіло не JSON → null', async () => {
  expect(await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, undefined, stub(async () => new Response('not json')))).toBeNull();
});

test('JSON без булевого ok → null', async () => {
  expect(await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, undefined, stub(async () => new Response('{}')))).toBeNull();
});

test('помилка сервера з тілом 502 повертається як є', async () => {
  const body = {
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'internal', message: 'Внутрішня помилка сервера' },
  };
  const result = await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, undefined, stub(async () => Response.json(body, { status: 502 })));
  expect(result).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'internal', message: 'Внутрішня помилка сервера' },
  });
});

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
    DEFAULT_SNAPSHOT_SETTINGS, controller.signal, (() => Promise.resolve(response as unknown as Response)) as typeof fetch,
  );
  expect(result).toBe('cancelled');
});
