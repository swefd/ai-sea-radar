// Межа між транспортом і тим, хто читає події: збирач (B-12) і бойовий
// `liveConnect`. Типи колись жили в reader.ts (B-09) і винесені сюди без зміни
// форми, щоб збирач від нього не залежав — план B-11…B-13, 0.5; сам reader
// прибрано в B-12, коли endpoint перейшов на збирач.

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
 * Джерело подій. Збирач не знає, що за ним — сокет, підставка чи запис.
 *
 * Реалізація МОЖЕ смикати обробники синхронно, ще не повернувши handle:
 * збирач це витримує (див. `subscribe()` і варту на таймері). Покладатися на
 * зворотне не можна: у тестах джерелом подій є синхронна підставка, а не
 * `liveConnect`.
 */
export type Connect = (handlers: SocketHandlers) => SocketHandle;

export type TimerId = ReturnType<typeof setTimeout>;

export type ReadErrorCode =
  | 'connect_failed'
  | 'provider_error'
  | 'disconnected'
  | 'internal';
