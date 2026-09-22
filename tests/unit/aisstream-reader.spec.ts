import { test, expect } from '@playwright/test';

import {
  readFirstMessage,
  type Connect,
  type SocketHandlers,
} from '@/shared/api/aisstream/reader';

const KEY = 'EXAMPLE-KEY-NOT-A-REAL-ONE';

/**
 * Керований стенд: збирає обробники, рахує close(), збирає надіслане й дає
 * ручний таймер. Жодного сокета, жодного справжнього часу — саме цього вимагає
 * SPRINT-02:28 («Джерело подій і годинник — параметри»).
 */
function stand() {
  let handlers: SocketHandlers | null = null;
  const sent: string[] = [];
  let closes = 0;
  const timers = new Map<number, () => void>();
  let nextId = 1;

  const connect: Connect = (h) => {
    handlers = h;
    return {
      send: (text) => sent.push(text),
      close: () => { closes += 1; },
    };
  };

  return {
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
    clearTimer: (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number);
    },
    /** Рухає час: викликає всі живі таймери. */
    fireTimers() {
      for (const fn of [...timers.values()]) fn();
    },
    get liveTimers() { return timers.size; },
  };
}

function run(s: ReturnType<typeof stand>, signal?: AbortSignal) {
  return readFirstMessage({
    connect: s.connect,
    apiKey: KEY,
    windowMs: 15_000,
    setTimer: s.setTimer,
    clearTimer: s.clearTimer,
    signal,
  });
}

test('підписка йде ПЕРШОЮ дією після відкриття', async () => {
  // Джерело дає 3 секунди на підписку й закриває з'єднання, якщо не встигнути.
  const s = stand();
  const promise = run(s);

  expect(s.sent).toHaveLength(0);   // до onOpen не шлемо нічого
  s.handlers.onOpen();
  expect(s.sent).toHaveLength(1);

  const body = JSON.parse(s.sent[0]) as { APIKey: string };
  expect(body.APIKey).toBe(KEY);

  s.handlers.onMessage('{"MessageType":"PositionReport"}');
  await promise;
});

test('перше повідомлення віддається СИРИМ, без розбору формату', async () => {
  // B-09 свідомо не розбирає формат: MetaData.time_utc з SPRINT-02:25 немає ні
  // в 46 згенерованих моделях, ні в живій документації, і правду дасть лише
  // зразок (B-10). Розбір — робота B-11, і тільки за зразком.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('{"MessageType":"PositionReport","MetaData":{"MMSI":123}}');

  const result = await promise;
  expect(result).toEqual({
    kind: 'message',
    raw: { MessageType: 'PositionReport', MetaData: { MMSI: 123 } },
  });
});

test('SubscriptionConfirmation теж вважається першим повідомленням', async () => {
  // SPRINT-02:23 стверджує, що підтвердження не надсилається; жива документація
  // каже протилежне. Розходження прийняте свідомо (§4.2 рішення): завдання
  // каже «перше отримане повідомлення як є», і фільтрація за MessageType була б
  // уже розбором формату, тобто роботою B-11.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('{"MessageType":"SubscriptionConfirmation"}');

  const result = await promise;
  expect(result).toEqual({
    kind: 'message',
    raw: { MessageType: 'SubscriptionConfirmation' },
  });
});

test('строк без повідомлень при живому з\'єднанні — empty, НЕ помилка', async () => {
  // Порожній успіх і помилка — різні речі, і інтерфейс скаже про них різними
  // словами: «За час збору позицій не отримано» проти «Не вдалося отримати дані».
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.fireTimers();

  expect(await promise).toEqual({ kind: 'empty' });
});

test('строк БЕЗ відкриття — connect_failed, а не порожній успіх', async () => {
  // Дослівна вимога SPRINT-02:29: «кінець строку без відкриття або без
  // надісланої підписки» — це connect_failed. Без цього тесту хибна гілка
  // таймера не має варти: заміна її на безумовний { kind: 'empty' } не валить
  // жодного іншого тесту (виміряно).
  //
  // Різниця не термінологічна. `empty` каже інтерфейсу «за час збору позицій
  // не отримано», тобто джерело мовчало при справному з'єднанні; тут же
  // з'єднання не відкрилося взагалі, і сказати треба інше.
  const s = stand();
  const promise = run(s);   // onOpen НЕ кличемо — сокет так і не відкрився
  s.fireTimers();

  expect(await promise).toEqual({ kind: 'error', code: 'connect_failed' });
  expect(s.closes).toBe(1);
  expect(s.liveTimers).toBe(0);
});

test('закриття ДО підписки — connect_failed', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onClose();   // onOpen не було

  expect(await promise).toEqual({ kind: 'error', code: 'connect_failed' });
});

test('закриття ПІСЛЯ підписки — disconnected', async () => {
  // Розрізнення за фактом надісланої підписки, дослівно за SPRINT-02:29.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onClose();

  expect(await promise).toEqual({ kind: 'error', code: 'disconnected' });
});

test('помилка сокета — provider_error', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onError();

  expect(await promise).toEqual({ kind: 'error', code: 'provider_error' });
});

test('нерозбірне повідомлення — internal, а не падіння', async () => {
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('це не JSON');

  expect(await promise).toEqual({ kind: 'error', code: 'internal' });
});

test('РЕЗУЛЬТАТ ЗАВЕРШУЄТЬСЯ РІВНО ОДИН РАЗ — пастка «проміс резолвиться двічі»', async () => {
  // SPRINT-02:92 називає її прямо. Після першого повідомлення шлемо ще одне,
  // помилку, закриття і строк — результат не має змінитися.
  const s = stand();
  const promise = run(s);
  s.handlers.onOpen();
  s.handlers.onMessage('{"n":1}');

  s.handlers.onMessage('{"n":2}');
  s.handlers.onError();
  s.handlers.onClose();
  s.fireTimers();

  expect(await promise).toEqual({ kind: 'message', raw: { n: 1 } });

  // Сам лише результат подвійного завершення НЕ показує: resolve() на вже
  // вирішеному промісі тихо нічого не робить, тож `expect(await promise)` вище
  // лишався б зеленим і без сторожа. Видно його за ПОБІЧНИМИ діями — саме їх
  // і перевіряємо. Виміряно: без `if (settled) return;` closes стає 4.
  expect(s.closes).toBe(1);
  expect(s.liveTimers).toBe(0);
});

test('прибирання на КОЖНОМУ результаті — сокет закритий, таймер знятий', async () => {
  // Друга й третя пастки SPRINT-02:92: таймер вікна не очищається; ресурси
  // течуть. Перевіряємо всі чотири виходи, а не лише щасливий.
  for (const drive of [
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onMessage('{"n":1}'); },
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.fireTimers(); },
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onError(); },
    (s: ReturnType<typeof stand>) => { s.handlers.onClose(); },
  ]) {
    const s = stand();
    const promise = run(s);
    drive(s);
    await promise;

    expect(s.closes).toBe(1);        // рівно раз, не двічі й не нуль
    expect(s.liveTimers).toBe(0);    // таймер знятий
  }
});

test('скасування запиту закриває ресурси й дає internal', async () => {
  // SPRINT-02:43 вимагає закриття «при завершенні, помилці ТА СКАСУВАННІ».
  const s = stand();
  const controller = new AbortController();
  const promise = run(s, controller.signal);
  s.handlers.onOpen();

  controller.abort();

  expect(await promise).toEqual({ kind: 'error', code: 'internal' });
  expect(s.closes).toBe(1);
  expect(s.liveTimers).toBe(0);
});

test('ключ не тече у результат — ні в успіху, ні в помилці', async () => {
  // Критерій B-09: «ключ не в логах і відповіді».
  for (const drive of [
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onMessage('{"n":1}'); },
    (s: ReturnType<typeof stand>) => { s.handlers.onOpen(); s.handlers.onError(); },
  ]) {
    const s = stand();
    const promise = run(s);
    drive(s);
    const result = await promise;

    expect(JSON.stringify(result)).not.toContain(KEY);

    // Негативне твердження вище проходить ВАКУУМНО: `ReadResult` за формою
    // типу не має поля, куди ключ міг би потрапити. Лишаємо як варту на
    // випадок, якщо юніон колись розширять, але доводимо й позитивне — ключ
    // пішов рівно в один бік, у тіло підписки.
    expect(s.sent.join('')).toContain(KEY);
  }
});
