import { test, expect } from '@playwright/test';

import { createSnapshotHandler } from '@/_app/api-routes/snapshot';
import type { Vessel } from '@/entities/vessel';
import type { Connect, SocketHandlers } from '@/shared/api/aisstream/transport';

// Форма відповіді /api/snapshot (SPRINT-02:29). Тексти й коди — літерали з
// завдання, час — з переданого годинника. Мережі немає: connect підставний.

const NOW = 1767268800000; // 2026-01-01T12:00:00.000Z
const ENV = { AISSTREAM_API_KEY: 'EXAMPLE-KEY-NOT-A-REAL-ONE' };

const VESSEL: Vessel = {
  id: '210385000', name: 'P&O PIONEER', lat: 51.1, lon: 1.3,
  speedKnots: 0, courseDeg: 48.2, timestamp: '2026-01-01T11:59:59.000Z', source: 'aisstream',
};

function harness(drive: (h: SocketHandlers) => void) {
  const timers: Array<() => void> = [];
  let handlers: SocketHandlers | null = null;
  const connect: Connect = (h) => { handlers = h; return { send: () => {}, close: () => {} }; };
  const handler = createSnapshotHandler({
    toItem: (raw) => ((raw as { v?: boolean }).v === true ? VESSEL : null),
    connect,
    now: () => NOW,
    env: ENV,
    setTimer: (fn) => { timers.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => {},
  });
  return async () => {
    const pending = handler(new Request('http://127.0.0.1:3000/api/snapshot'));
    await Promise.resolve();
    if (handlers !== null) drive(handlers);
    for (const fn of timers) fn();
    return pending;
  };
}

test('успіх: HTTP 200 і фінальна форма з метаданими', async () => {
  const response = await harness((h) => { h.onOpen(); h.onMessage('{"v":true}'); })();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    vessels: [VESSEL],
    collectedAt: '2026-01-01T12:00:00.000Z',
    windowSeconds: 15,
    count: 1,
    truncated: false,
    reason: 'window_elapsed',
  });
});

test('порожній успіх: vessels [], count 0', async () => {
  const response = await harness((h) => { h.onOpen(); })();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, vessels: [], count: 0, reason: 'window_elapsed' });
});

test('без ключа: HTTP 502, no_api_key, текст дослівно', async () => {
  const handler = createSnapshotHandler({ toItem: () => null, env: {}, now: () => NOW });
  const response = await handler(new Request('http://127.0.0.1:3000/api/snapshot'));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'no_api_key', message: 'Ключ AISStream не налаштовано' },
  });
});

for (const [label, drive, code, message] of [
  ['помилка до відкриття', (h: SocketHandlers) => h.onError(), 'connect_failed', 'Не вдалося підключитися до джерела'],
  ['помилка після відкриття', (h: SocketHandlers) => { h.onOpen(); h.onError(); }, 'provider_error', 'Джерело повернуло помилку'],
  ['розрив після підписки', (h: SocketHandlers) => { h.onOpen(); h.onClose(); }, 'disconnected', "З'єднання з джерелом розірвано"],
] as const) {
  test(`${label}: HTTP 502, ${code}`, async () => {
    const response = await harness(drive)();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false, attemptedAt: '2026-01-01T12:00:00.000Z', error: { code, message },
    });
  });
}

test('ключ не потрапляє у відповідь', async () => {
  const response = await harness((h) => { h.onOpen(); h.onError(); })();
  expect(await response.text()).not.toContain(ENV.AISSTREAM_API_KEY);
});
