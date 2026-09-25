// Межа між транспортом і тим, хто читає події: reader (B-09), збирач (B-12),
// бойовий `liveConnect`. Типи перенесено з reader.ts без зміни форми, щоб
// жоден модуль, крім самого reader, від нього не залежав — план B-11…B-13, 0.5.

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
