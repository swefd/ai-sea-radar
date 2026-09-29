import { test, expect } from '@playwright/test';

import { collect } from '@/shared/api/aisstream/collector';
import type { Connect, SocketHandlers } from '@/shared/api/aisstream/transport';

// Тести збирача, B-15 (docs/tasks/SPRINT-03.md:43…:58). Без WebSocket і без
// глобального Date: джерело подій і годинник — параметри з R2 (SPRINT-03:23).
// Очікування — літерали, записані до assertions.
//
// `toItem` тут — ТЕСТОВА межа, не перетворювач: той доведено окремо
// (position-report.spec.ts). Збирачу досить знати id і timestamp.

const KEY = 'EXAMPLE-KEY-NOT-A-REAL-ONE';
const T0 = 1767268800000; // 2026-01-01T12:00:00.000Z

type Item = { id: string; timestamp: string; p: string; name: string | null };

function stand() {
  let handlers: SocketHandlers | null = null;
  const sent: string[] = [];
  let closes = 0;
  const timers = new Map<number, () => void>();
  let nextId = 1;
  let clock = T0;

  const connect: Connect = (h) => {
    handlers = h;
    return { send: (text) => sent.push(text), close: () => { closes += 1; } };
  };

  const stand = {
    connect,
    sent,
    get closes() { return closes; },
    get handlers() {
      if (handlers === null) throw new Error('connect ще не викликано');
      return handlers;
    },
    setTimer: (fn: () => void, _ms: number) => {
      const id = nextId++;
      timers.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); },
    fireTimers() { for (const fn of [...timers.values()]) fn(); },
    get liveTimers() { return timers.size; },
    now: () => clock,
    advance(ms: number) { clock += ms; },
    /** Подає повідомлення JSON-текстом, як це робить сокет. */
    send(message: object) { stand.handlers.onMessage(JSON.stringify(message)); },
  };
  return stand;
}

function toItem(raw: unknown): Item | null {
  const r = raw as { id?: unknown; t?: unknown; p?: unknown; name?: string | null; skip?: boolean };
  if (r.skip === true || typeof r.id !== 'string' || typeof r.t !== 'string' || typeof r.p !== 'string') {
    return null;
  }
  return { id: r.id, timestamp: r.t, p: r.p, name: r.name ?? null };
}

function run(s: ReturnType<typeof stand>, opts: { limit?: number; signal?: AbortSignal } = {}) {
  return collect<Item>({
    connect: s.connect,
    apiKey: KEY,
    windowMs: 15_000,
    limit: opts.limit ?? 100,
    toItem,
    now: s.now,
    setTimer: s.setTimer,
    clearTimer: s.clearTimer,
    signal: opts.signal,
  });
}

/** Після будь-якого результату: з'єднання закрите рівно раз, таймерів немає (SPRINT-03:58). */
function expectReleased(s: ReturnType<typeof stand>) {
  expect(s.closes).toBe(1);
  expect(s.liveTimers).toBe(0);
}

test('підписка йде першою дією після відкриття', async () => {
  const s = stand();
  const promise = run(s);
  expect(s.sent).toHaveLength(0);
  s.handlers.onOpen();
  expect(s.sent).toHaveLength(1);
  expect((JSON.parse(s.sent[0]) as { APIKey: string }).APIKey).toBe(KEY);
  s.fireTimers();
  await promise;
});

test('два однакові повідомлення про A → один об\'єкт A', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P1' });
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P1' });
  s.fireTimers();
  expect(await promise).toEqual({
    kind: 'done',
    items: [{ id: 'A', timestamp: '2026-01-01T12:00:00Z', p: 'P1', name: null }],
    reason: 'window_elapsed',
    finishedAt: 1767268800000,
  });
  expectReleased(s);
});

test('A 12:01 з P2, потім A 12:00 з P1 → лишається P2 (час, не порядок приходу)', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:01:00Z', p: 'P2' });
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P1' });
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.items : null).toEqual([
    { id: 'A', timestamp: '2026-01-01T12:01:00Z', p: 'P2', name: null },
  ]);
});

test('A 12:00 з P1, потім A 12:01 з P2 → P2 (новіше замінює)', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P1' });
  s.send({ id: 'A', t: '2026-01-01T12:01:00Z', p: 'P2' });
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.items : null).toEqual([
    { id: 'A', timestamp: '2026-01-01T12:01:00Z', p: 'P2', name: null },
  ]);
});

test('однаковий час, різні позиції → лишається перша прийнята', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00.000Z', p: 'P1' });
  s.send({ id: 'A', t: '2026-01-01T12:00:00.000Z', p: 'P2' });
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.items : null).toEqual([
    { id: 'A', timestamp: '2026-01-01T12:00:00.000Z', p: 'P1', name: null },
  ]);
});

test('різниця в одну мілісекунду вже рахується', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00.000Z', p: 'P1' });
  s.send({ id: 'A', t: '2026-01-01T12:00:00.001Z', p: 'P2' });
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.items[0].p : null).toBe('P2');
});

test('друге повідомлення про A з ім\'ям null → ім\'я null (об\'єкт замінений цілком)', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P1', name: 'ALPHA' });
  s.send({ id: 'A', t: '2026-01-01T12:01:00Z', p: 'P2', name: null });
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.items : null).toEqual([
    { id: 'A', timestamp: '2026-01-01T12:01:00Z', p: 'P2', name: null },
  ]);
});

test('100 унікальних суден → limit_reached негайно, 101-е не прийняте, таймер знятий', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  for (let i = 1; i <= 101; i += 1) s.send({ id: `V${i}`, t: '2026-01-01T12:00:00Z', p: 'P' });
  const result = await promise;
  expect(result.kind).toBe('done');
  expect(result.kind === 'done' ? result.reason : null).toBe('limit_reached');
  expect(result.kind === 'done' ? result.items.length : null).toBe(100);
  expect(result.kind === 'done' ? result.items.some((v) => v.id === 'V101') : null).toBe(false);
  expectReleased(s);
});

test('100 повідомлень про одне судно → одне судно, збір триває до кінця вікна', async () => {
  const s = stand();
  let finished = false;
  const promise = run(s).then((r) => { finished = true; return r; });
  s.handlers.onOpen();
  for (let i = 0; i < 100; i += 1) s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(s.liveTimers).toBe(1);
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.reason : null).toBe('window_elapsed');
  expect(result.kind === 'done' ? result.items.length : null).toBe(1);
});

test('вікно при живому з\'єднанні без повідомлень → done, 0 суден, window_elapsed', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.fireTimers();
  expect(await promise).toEqual({ kind: 'done', items: [], reason: 'window_elapsed', finishedAt: 1767268800000 });
  expectReleased(s);
});

test('з\'єднання не відкрилося до кінця строку → connect_failed', async () => {
  const s = stand();
  const promise = run(s);
  s.fireTimers();
  expect(await promise).toEqual({ kind: 'error', code: 'connect_failed', finishedAt: 1767268800000 });
  expectReleased(s);
});

test('помилка сокета до відкриття → connect_failed негайно', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onError();
  expect(await promise).toEqual({ kind: 'error', code: 'connect_failed', finishedAt: 1767268800000 });
  expectReleased(s);
});

test('помилка провайдера після трьох валідних → provider_error, без часткового набору', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  for (const id of ['A', 'B', 'C']) s.send({ id, t: '2026-01-01T12:00:00Z', p: 'P' });
  s.handlers.onError();
  expect(await promise).toEqual({ kind: 'error', code: 'provider_error', finishedAt: 1767268800000 });
  expectReleased(s);
});

test('розрив після трьох валідних → disconnected, без часткового набору', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  for (const id of ['A', 'B', 'C']) s.send({ id, t: '2026-01-01T12:00:00Z', p: 'P' });
  s.handlers.onClose();
  expect(await promise).toEqual({ kind: 'error', code: 'disconnected', finishedAt: 1767268800000 });
  expectReleased(s);
});

test('закриття до підписки → connect_failed', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onClose();
  expect(await promise).toEqual({ kind: 'error', code: 'connect_failed', finishedAt: 1767268800000 });
});

test('помилка провайдера після ліміту → лишається успіх, другого завершення немає', async () => {
  const s = stand();
  const promise = run(s, { limit: 2 });
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.send({ id: 'B', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.handlers.onError();
  s.handlers.onClose();
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.reason : null).toBe('limit_reached');
  // Друге завершення видно лише за побічними діями — resolve() двічі мовчить.
  expectReleased(s);
});

test('скасування до кінця вікна → не успіх, з\'єднання закрите, таймери зняті', async () => {
  const s = stand();
  const controller = new AbortController();
  const promise = run(s, { signal: controller.signal });
  s.handlers.onOpen();
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  controller.abort();
  expect(await promise).toEqual({ kind: 'error', code: 'internal', finishedAt: 1767268800000 });
  expectReleased(s);
});

test('finishedAt — час переданого годинника в момент завершення', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.advance(15_000);
  s.fireTimers();
  expect((await promise).finishedAt).toBe(1767268815000);
});

test('toItem → null і биткий JSON пропускаються, спроба триває', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.send({ skip: true });
  s.handlers.onMessage('це не JSON');
  expect(s.closes).toBe(0);
  s.send({ id: 'A', t: '2026-01-01T12:00:00Z', p: 'P' });
  s.fireTimers();
  const result = await promise;
  expect(result.kind === 'done' ? result.items.length : null).toBe(1);
});

test('ключ не тече в результат', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onError();
  expect(JSON.stringify(await promise)).not.toContain(KEY);
  expect(s.sent.join('')).toContain(KEY);
});

test('connect, що смикає onOpen синхронно, — підписка все одно йде', async () => {
  const s = stand();
  const syncConnect: Connect = (h) => { const handle = s.connect(h); h.onOpen(); return handle; };
  const promise = collect<Item>({
    connect: syncConnect, apiKey: KEY, windowMs: 15_000, limit: 100, toItem,
    now: s.now, setTimer: s.setTimer, clearTimer: s.clearTimer,
  });
  expect(s.sent).toHaveLength(1);
  s.fireTimers();
  expect((await promise).kind).toBe('done');
});
