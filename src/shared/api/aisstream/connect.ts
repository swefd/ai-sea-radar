// ЄДИНИЙ модуль проєкту, який знає слово WebSocket. Усе, що вище — reader,
// адаптер, endpoint — працює з межею Connect і про транспорт не здогадується.
//
// Джерело: документація aisstream.io; проєктне рішення §4.2.

import { AISSTREAM_ENDPOINT } from '@/shared/config';

import type { Connect, SocketHandle, SocketHandlers } from './reader';

/**
 * Відкриває справжній сокет.
 *
 * Залежності `ws` НЕМАЄ і не буде: вбудований WebSocket Node 24 сам пропонує
 * permessage-deflate. Виміряно заголовками рукостискання на локальному сервері:
 *   sec-websocket-extensions: permessage-deflate; client_max_window_bits
 * Офіційний приклад aisstream тягне `ws` рівно заради `perMessageDeflate: true`;
 * нам це не потрібно, і тому в цьому заході нуль нових пакетів.
 */
export const liveConnect: Connect = (handlers: SocketHandlers): SocketHandle => {
  const socket = new WebSocket(AISSTREAM_ENDPOINT);

  // РЯДОК, БЕЗ ЯКОГО B-09 ПАДАЄ МОВЧКИ.
  //
  // Документація: «The server sends binary WebSocket frames containing UTF-8
  // JSON». Виміряно на Node 24.21 проти локального сервера, що шле бінарний
  // фрейм:
  //   binaryType за замовчуванням : 'blob'
  //   event.data                  : Blob
  //   JSON.parse(event.data)      : SyntaxError
  // Blob синхронно не читається, а офіційний приклад робить саме
  // `JSON.parse(event.data.toString())` — і на Node без `ws` це дало б рядок
  // "[object Blob]". Перемикання мусить статися ДО підписки на події.
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => handlers.onOpen());

  socket.addEventListener('message', (event: MessageEvent) => {
    const { data } = event;
    // Після binaryType='arraybuffer' очікуємо саме ArrayBuffer; рядок теж
    // приймаємо — джерело має право надіслати текстовий фрейм, і відкидати
    // його було б вигадкою понад документацію.
    const text = typeof data === 'string'
      ? data
      : new TextDecoder().decode(data as ArrayBuffer);

    handlers.onMessage(text);
  });

  socket.addEventListener('error', () => handlers.onError());
  socket.addEventListener('close', () => handlers.onClose());

  return {
    send: (text: string) => socket.send(text),
    close: () => {
      // Закриття сокета, який ще не відкрився, кидає InvalidStateError.
      // Ковтаємо: reader кличе close() на КОЖНОМУ результаті, включно з
      // «не змогли підключитися», і там сокет саме в цьому стані.
      try {
        socket.close();
      } catch {
        // ресурс і так непридатний
      }
    },
  };
};
