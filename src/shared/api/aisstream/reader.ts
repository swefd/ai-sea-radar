// Reader: відкриває з'єднання ЧУЖИМИ руками, шле підписку, віддає перше
// повідомлення сирим. Джерело: docs/tasks/SPRINT-02.md:43, :29; проєктне
// рішення §4.2, §4.3.
//
// ЦЕЙ МОДУЛЬ НЕ ЗНАЄ СЛОВА WebSocket. Джерело подій і таймер — параметри, і це
// не стиль, а те, що робить сюїту вище здійсненною без мережі й без очікування
// 15 секунд. B-12 успадкує цю саму межу й змінить лише логіку накопичення.

import { buildSubscription } from './subscription';

export type SocketHandlers = {
  onOpen: () => void;
  onMessage: (text: string) => void;
  onError: () => void;
  onClose: () => void;
};

export type SocketHandle = {
  send: (text: string) => void;
  close: () => void;
};

/**
 * Джерело подій. Reader не знає, що за ним — сокет, підставка чи запис.
 *
 * Реалізація МОЖЕ смикати обробники синхронно, ще не повернувши handle:
 * reader це витримує (див. `subscribe()` і варту на таймері). Покладатися на
 * зворотне не можна — цю межу успадкує збирач B-12, де джерелом подій буде
 * вже не `liveConnect`.
 */
export type Connect = (handlers: SocketHandlers) => SocketHandle;

export type TimerId = ReturnType<typeof setTimeout>;

export type ReadErrorCode =
  | 'connect_failed'
  | 'provider_error'
  | 'disconnected'
  | 'internal';

export type ReadResult =
  | { kind: 'message'; raw: unknown }
  | { kind: 'empty' }
  | { kind: 'error'; code: ReadErrorCode };

export type ReadOptions = {
  connect: Connect;
  apiKey: string;
  windowMs: number;
  setTimer: (fn: () => void, ms: number) => TimerId;
  clearTimer: (id: TimerId) => void;
  signal?: AbortSignal;
};

export function readFirstMessage(options: ReadOptions): Promise<ReadResult> {
  const { connect, apiKey, windowMs, setTimer, clearTimer, signal } = options;

  return new Promise<ReadResult>((resolve) => {
    // ЄДИНИЙ сторож на всі шляхи виходу. SPRINT-02:92 називає пастку прямо:
    // «проміс резолвиться двічі». Пізні події після завершення — норма, а не
    // аномалія: сокет закривається асинхронно й устигає крикнути onClose.
    let settled = false;
    let subscribed = false;
    let opened = false;
    let handle: SocketHandle | null = null;
    let timerId: TimerId | null = null;

    /** Прибирання ідемпотентне й живе в ОДНОМУ місці — на завершенні. */
    const settle = (result: ReadResult) => {
      if (settled) return;
      settled = true;

      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
      signal?.removeEventListener('abort', onAbort);
      try {
        handle?.close();
      } catch {
        // Закриття вже закритого сокета не має перетворювати успішний
        // результат на помилку: дані вже зібрані, ресурс уже звільнений.
      }

      resolve(result);
    };

    /**
     * Надсилання підписки, стійке до ПОРЯДКУ подій.
     *
     * `onOpen` не шле напряму: у момент його виклику `handle` може бути ще
     * `null` — саме так виглядає `connect`, який смикає обробник синхронно, до
     * того як повернув handle. Тоді `handle?.send(...)` МОВЧКИ нічого не
     * зробить, `subscribed` лишиться false, і строк віддасть `empty` —
     * «джерело мовчало» замість «ми не підписалися». Виміряно: підписок 0,
     * вердикт `empty`.
     *
     * Ідемпотентна: другий виклик нічого не робить, тож відкладений виклик
     * нижче безпечний навіть коли `onOpen` був асинхронний і вже відпрацював.
     */
    const subscribe = () => {
      if (subscribed || handle === null) return;
      try {
        handle.send(buildSubscription(apiKey));
        subscribed = true;
      } catch {
        settle({ kind: 'error', code: 'connect_failed' });
      }
    };

    function onAbort() {
      settle({ kind: 'error', code: 'internal' });
    }

    if (signal?.aborted) {
      // Запит скасовано ще до того, як ми торкнулися мережі.
      settle({ kind: 'error', code: 'internal' });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      handle = connect({
        onOpen: () => {
          // ПЕРШОЮ дією: джерело дає 3 секунди й мовчки закриває з'єднання,
          // якщо підписка не встигла.
          opened = true;
          subscribe();
        },

        onMessage: (text) => {
          // Формат НЕ розбирається — лише JSON.parse. Яке саме це повідомлення,
          // вирішить B-11 за зразком із B-10.
          try {
            settle({ kind: 'message', raw: JSON.parse(text) });
          } catch {
            settle({ kind: 'error', code: 'internal' });
          }
        },

        onError: () => settle({ kind: 'error', code: 'provider_error' }),

        // Закриття ДО підписки — не дійшли; ПІСЛЯ — розірвали. Дослівно :29.
        onClose: () => settle({
          kind: 'error',
          code: subscribed ? 'disconnected' : 'connect_failed',
        }),
      });
    } catch {
      settle({ kind: 'error', code: 'connect_failed' });
      return;
    }

    // Обробник міг спрацювати синхронно, доки `handle` ще був `null`. Тоді
    // підписка не пішла, і надолужити її треба саме тут — після присвоєння.
    if (opened) subscribe();

    // Те саме для протилежного боку: результат уже є, а сокет аж тепер
    // з'явився. Без цього рядка він лишився б відкритим (виміряно: closes=0).
    if (settled) {
      try {
        handle?.close();
      } catch {
        // ресурс і так непридатний
      }
    }

    // Строк відлічується від ПОЧАТКУ обробки, включно зі з'єднанням і
    // підпискою (SPRINT-02:28), тому таймер ставиться тут, а не в onOpen.
    //
    // `if (!settled)` не косметика: якщо результат уже є (connect смикнув
    // обробник синхронно), таймер нікому було б знімати — `settle` уже
    // відпрацював. Виміряно без цієї варти: таймерів створено 1, живих 1.
    if (!settled) {
      timerId = setTimer(() => {
        // Вікно минуло. Якщо підписки так і не було — ми не дійшли до джерела,
        // і це connect_failed, а не порожній успіх.
        settle(subscribed ? { kind: 'empty' } : { kind: 'error', code: 'connect_failed' });
      }, windowMs);
    }
  });
}
