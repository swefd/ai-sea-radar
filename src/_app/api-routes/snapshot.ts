// Адаптер: юніон результату → HTTP-статус і тіло. Джерело: SPRINT-02.md:29
// (проміжна форма B-09), проєктне рішення §4.4.

import { liveConnect } from '@/shared/api/aisstream/connect';
import { readFirstMessage, type ReadErrorCode } from '@/shared/api/aisstream/reader';
import { readApiKey, SNAPSHOT_WINDOW_SECONDS } from '@/shared/config';

/**
 * Тексти помилок — ЛІТЕРАЛИ зі SPRINT-02:29, дослівно. Вони частина контракту
 * для тестів B-13, тож переформульовувати їх «красивіше» не можна.
 *
 * Сирий текст помилки провайдера сюди НЕ потрапляє — причина та сама, що в
 * no-secrets: діагностика, яка друкує чуже, друкує й ключ.
 */
const ERROR_MESSAGES: Record<ReadErrorCode | 'no_api_key', string> = {
  no_api_key: 'Ключ AISStream не налаштовано',
  connect_failed: 'Не вдалося підключитися до джерела',
  provider_error: 'Джерело повернуло помилку',
  disconnected: "З'єднання з джерелом розірвано",
  internal: 'Внутрішня помилка сервера',
};

function errorResponse(code: ReadErrorCode | 'no_api_key'): Response {
  // 502 навіть для no_api_key, хоч це конфігурація, а не збій шлюзу: завдання
  // перелічує його серед кодів помилки одним списком, а тексти — контракт.
  return Response.json(
    {
      ok: false,
      attemptedAt: new Date().toISOString(),
      error: { code, message: ERROR_MESSAGES[code] },
    },
    { status: 502 },
  );
}

export async function getSnapshot(request: Request): Promise<Response> {
  const key = readApiKey();
  if (key.status === 'missing') return errorResponse('no_api_key');

  const result = await readFirstMessage({
    connect: liveConnect,
    apiKey: key.apiKey,
    windowMs: SNAPSHOT_WINDOW_SECONDS * 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    signal: request.signal,
  });

  if (result.kind === 'error') return errorResponse(result.code);

  // Проміжна форма B-09: { ok, raw, collectedAt }. Порожній успіх — те саме
  // з raw: null, а НЕ помилка: «за строк при живому з'єднанні повідомлень не
  // було» — це чесний результат, і інтерфейс скаже про нього іншими словами.
  return Response.json({
    ok: true,
    raw: result.kind === 'message' ? result.raw : null,
    collectedAt: new Date().toISOString(),
  });
}
