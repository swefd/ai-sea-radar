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

function harness(drive: (h: SocketHandlers) => void, query = '') {
  const timers: Array<() => void> = [];
  const timerMs: number[] = [];
  let handlers: SocketHandlers | null = null;
  let connects = 0;
  const sent: string[] = [];
  const connect: Connect = (h) => {
    connects += 1;
    handlers = h;
    return { send: (text) => { sent.push(text); }, close: () => {} };
  };
  const handler = createSnapshotHandler({
    toItem: (raw) => ((raw as { v?: boolean }).v === true ? VESSEL : null),
    connect,
    now: () => NOW,
    env: ENV,
    setTimer: (fn, ms) => { timers.push(fn); timerMs.push(ms); return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => {},
  });
  const run = async () => {
    const pending = handler(new Request(`http://127.0.0.1:3000/api/snapshot${query}`));
    await Promise.resolve();
    if (handlers !== null) drive(handlers);
    for (const fn of timers) fn();
    return pending;
  };
  return Object.assign(run, { get connects() { return connects; }, timerMs, sent });
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
    includeClassB: false,
    diagnostics: { connectMs: 0, messages: 1, rejected: 0, byType: { other: 1 } },
  });
});

test('window=120&classB=1: вікно 120 000 мс у таймері, у відповіді 120 і includeClassB', async () => {
  const run = harness((h) => { h.onOpen(); }, '?window=120&classB=1');
  const response = await run();
  expect(run.timerMs).toEqual([120_000]);
  expect(await response.json()).toMatchObject({ ok: true, windowSeconds: 120, includeClassB: true });
});

test('classB=1 доходить до підписки', async () => {
  const run = harness((h) => { h.onOpen(); }, '?classB=1');
  await run();
  const subscription = JSON.parse(run.sent[0]) as { FilterMessageTypes: string[] };
  expect(subscription.FilterMessageTypes).toEqual(['PositionReport', 'StandardClassBPositionReport']);
});

test('некоректні параметри: HTTP 400, invalid_params, мережі не торкалися', async () => {
  const run = harness(() => {}, '?window=99999');
  const response = await run();
  expect(response.status).toBe(400);
  expect(run.connects).toBe(0);
  expect(await response.json()).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'invalid_params', message: 'Некоректні параметри запиту' },
    diagnostics: null,
  });
});

test('некоректні параметри перевіряються раніше за ключ', async () => {
  const handler = createSnapshotHandler({ toItem: () => null, env: {}, now: () => NOW });
  const response = await handler(new Request('http://127.0.0.1:3000/api/snapshot?classB=2'));
  expect(response.status).toBe(400);
  expect((await response.json() as { error: { code: string } }).error.code).toBe('invalid_params');
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
    diagnostics: null,
  });
});

const NOT_OPENED = { connectMs: null, messages: 0, rejected: 0, byType: {} };
const OPENED_SILENT = { connectMs: 0, messages: 0, rejected: 0, byType: {} };

for (const [label, drive, code, message, diagnostics] of [
  ['помилка до відкриття', (h: SocketHandlers) => h.onError(), 'connect_failed', 'Не вдалося підключитися до джерела', NOT_OPENED],
  ['обрив після підписки (error, потім close)', (h: SocketHandlers) => { h.onOpen(); h.onError(); h.onClose(); }, 'disconnected', "З'єднання з джерелом розірвано", OPENED_SILENT],
  ['розрив після підписки', (h: SocketHandlers) => { h.onOpen(); h.onClose(); }, 'disconnected', "З'єднання з джерелом розірвано", OPENED_SILENT],
  ['помилка провайдера кадром', (h: SocketHandlers) => { h.onOpen(); h.onMessage('{"error":"Api Key Is Not Valid"}'); }, 'provider_error', 'Джерело повернуло помилку',
    { connectMs: 0, messages: 1, rejected: 0, byType: { other: 1 } }],
] as const) {
  test(`${label}: HTTP 502, ${code}`, async () => {
    const response = await harness(drive)();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false, attemptedAt: '2026-01-01T12:00:00.000Z', error: { code, message }, diagnostics,
    });
  });
}

test('ключ не потрапляє ні в 400, ні в діагностику', async () => {
  const bad = await harness(() => {}, '?window=1')();
  expect(await bad.text()).not.toContain(ENV.AISSTREAM_API_KEY);
  const ok = await harness((h) => { h.onOpen(); h.onMessage('{"v":true}'); })();
  expect(await ok.text()).not.toContain(ENV.AISSTREAM_API_KEY);
});

test('ключ не потрапляє у відповідь', async () => {
  const response = await harness((h) => { h.onOpen(); h.onClose(); })();
  expect(await response.text()).not.toContain(ENV.AISSTREAM_API_KEY);
});

// Годинник, що КРОКУЄ: harness вище тримає `now` нерухомим, тож не відрізнив
// би «час завершення» від «часу старту» (SPRINT-03:57). Тут старт — 12:00:00,
// і тест сам пересуває годинник до моменту завершення. `toItem` дає судно з
// id із повідомлення — щоб 100 різних суден справді були різними.
function clockHarness() {
  let clock = NOW;
  const timers: Array<() => void> = [];
  let handlers: SocketHandlers | null = null;
  const connect: Connect = (h) => { handlers = h; return { send: () => {}, close: () => {} }; };
  const handler = createSnapshotHandler({
    toItem: (raw) => {
      const id = (raw as { id?: unknown }).id;
      return typeof id === 'string' ? { ...VESSEL, id } : null;
    },
    connect,
    now: () => clock,
    env: ENV,
    setTimer: (fn) => { timers.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => {},
  });
  return {
    // `collect` викликається синхронно (snapshot.ts:78), тож після start()
    // обробники сокета вже на місці.
    start: () => handler(new Request('http://127.0.0.1:3000/api/snapshot')),
    get handlers() {
      if (handlers === null) throw new Error('connect ще не викликано');
      return handlers;
    },
    advance: (ms: number) => { clock += ms; },
    fireTimers: () => { for (const fn of timers) fn(); },
  };
}

test('collectedAt — час годинника в момент завершення, а не старту', async () => {
  const h = clockHarness();
  const pending = h.start();
  h.handlers.onOpen();
  h.advance(15_000);
  h.fireTimers();
  expect(await (await pending).json()).toMatchObject({
    ok: true,
    collectedAt: '2026-01-01T12:00:15.000Z',
    reason: 'window_elapsed',
  });
});

test('attemptedAt помилки — час годинника в момент розриву', async () => {
  const h = clockHarness();
  const pending = h.start();
  h.handlers.onOpen();
  h.advance(4_000);
  h.handlers.onClose();
  expect(await (await pending).json()).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:04.000Z',
    error: { code: 'disconnected', message: "З'єднання з джерелом розірвано" },
    diagnostics: OPENED_SILENT,
  });
});

test('100 унікальних суден: limit_reached, truncated true, count 100, 101-го немає', async () => {
  const h = clockHarness();
  const pending = h.start();
  h.handlers.onOpen();
  for (let i = 1; i <= 101; i += 1) h.handlers.onMessage(JSON.stringify({ id: `V${i}` }));
  const response = await pending;
  expect(response.status).toBe(200);
  const body = (await response.json()) as { vessels: Array<{ id: string }> };
  expect(body).toMatchObject({
    ok: true,
    count: 100,
    truncated: true,
    reason: 'limit_reached',
    windowSeconds: 15,
    collectedAt: '2026-01-01T12:00:00.000Z',
  });
  expect(body.vessels).toHaveLength(100);
  expect(body.vessels.some((v) => v.id === 'V101')).toBe(false);
});

test('скасування запиту: сокет закрито, таймер знято, успіху немає', async () => {
  let handlers: SocketHandlers | null = null;
  let closes = 0;
  let cleared = 0;
  const connect: Connect = (h) => { handlers = h; return { send: () => {}, close: () => { closes += 1; } }; };
  const handler = createSnapshotHandler({
    toItem: (raw) => ((raw as { v?: boolean }).v === true ? VESSEL : null),
    connect,
    now: () => NOW,
    env: ENV,
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => { cleared += 1; },
  });
  const controller = new AbortController();
  const pending = handler(new Request('http://127.0.0.1:3000/api/snapshot', { signal: controller.signal }));
  if (handlers === null) throw new Error('connect ще не викликано');
  const h: SocketHandlers = handlers;
  h.onOpen();
  h.onMessage('{"v":true}');
  controller.abort();
  const response = await pending;
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    ok: false,
    attemptedAt: '2026-01-01T12:00:00.000Z',
    error: { code: 'internal', message: 'Внутрішня помилка сервера' },
    diagnostics: { connectMs: 0, messages: 1, rejected: 0, byType: { other: 1 } },
  });
  expect(closes).toBe(1);
  expect(cleared).toBe(1);
});
