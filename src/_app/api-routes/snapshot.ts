// Адаптер: результат збирача → HTTP-статус і тіло. Джерело: SPRINT-02.md:29
// (фінальна форма B-12), проєктне рішення §4.4; план
// docs/superpowers/plans/2026-09-29-sprint-03.md, задача 3.
//
// Фабрика, а не голий обробник: перетворювач, джерело подій, годинник,
// оточення й таймери — параметри. Інакше форму відповіді довелося б
// перевіряти через справжній сокет і справжні 15 секунд.

import type { SnapshotErrorCode, SnapshotResponse, Vessel } from '@/entities/vessel';
import { vesselFromPositionReport } from '@/entities/vessel';
import { collect } from '@/shared/api/aisstream/collector';
import { liveConnect } from '@/shared/api/aisstream/connect';
import type { Connect, TimerId } from '@/shared/api/aisstream/transport';
import { readApiKey, SNAPSHOT_VESSEL_LIMIT } from '@/shared/config';

import { parseSnapshotParams } from './snapshot-params';

/**
 * Тексти помилок — ЛІТЕРАЛИ зі SPRINT-02:29, дослівно. Вони частина контракту
 * для тестів B-13, тож переформульовувати їх «красивіше» не можна.
 *
 * Сирий текст помилки провайдера сюди НЕ потрапляє — причина та сама, що в
 * no-secrets: діагностика, яка друкує чуже, друкує й ключ.
 */
const ERROR_MESSAGES: Record<SnapshotErrorCode, string> = {
  no_api_key: 'Ключ AISStream не налаштовано',
  connect_failed: 'Не вдалося підключитися до джерела',
  provider_error: 'Джерело повернуло помилку',
  disconnected: "З'єднання з джерелом розірвано",
  internal: 'Внутрішня помилка сервера',
  invalid_params: 'Некоректні параметри запиту',
};

export type SnapshotHandlerDeps = {
  /**
   * Без дефолту СВІДОМО: `_app` міг би підставити перетворювач сам, але тоді
   * тест, який забув його передати, мовчки перевіряв би бойовий розбір
   * замість своєї межі.
   */
  toItem: (raw: unknown) => Vessel | null;
  connect?: Connect;
  now?: () => number;
  env?: Record<string, string | undefined>;
  setTimer?: (fn: () => void, ms: number) => TimerId;
  clearTimer?: (id: TimerId) => void;
};

function errorResponse(code: SnapshotErrorCode, at: number, status = 502): Response {
  // 502 навіть для no_api_key, хоч це конфігурація, а не збій шлюзу: завдання
  // перелічує його серед кодів помилки одним списком, а тексти — контракт.
  return Response.json(
    {
      ok: false,
      attemptedAt: new Date(at).toISOString(),
      error: { code, message: ERROR_MESSAGES[code] },
    } satisfies SnapshotResponse,
    { status },
  );
}

export function createSnapshotHandler(
  deps: SnapshotHandlerDeps,
): (request: Request) => Promise<Response> {
  const {
    toItem,
    connect = liveConnect,
    now = Date.now,
    env = process.env,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = deps;

  return async (request) => {
    // Параметри — раніше за ключ: некоректний запит не має торкатися ні
    // оточення, ні мережі. 400, а не 502: це вада запиту, а не джерела.
    const settings = parseSnapshotParams(new URL(request.url).searchParams);
    if (settings === null) return errorResponse('invalid_params', now(), 400);

    // Час спроби для no_api_key — момент перевірки: до збирача справа не
    // дійшла, і іншого `finishedAt`, ніж «зараз», у цієї спроби немає.
    const key = readApiKey(env);
    if (key.status === 'missing') return errorResponse('no_api_key', now());

    let result;
    try {
      // `collect` викликається СИНХРОННО, до першого await: з'єднання й
      // таймер вікна стартують у момент запиту, а не на наступному тіку.
      result = await collect({
        connect,
        apiKey: key.apiKey,
        windowMs: settings.windowSeconds * 1000,
        limit: SNAPSHOT_VESSEL_LIMIT,
        toItem,
        now,
        setTimer,
        clearTimer,
        signal: request.signal,
      });
    } catch {
      // Збирач не мав би кидати — усі його гілки резолвляться. Але якщо
      // кине, назовні йде `internal` з фіксованим текстом, а не повідомлення
      // винятку: у ньому може опинитися будь-що, включно з ключем.
      return errorResponse('internal', now());
    }

    // Час — `finishedAt` збирача, а не повторний now(): той момент, коли
    // результат справді склався, а не коли до нього дійшла серіалізація.
    if (result.kind === 'error') return errorResponse(result.code, result.finishedAt);

    // Порожній успіх — той самий 200 з vessels: [] і count: 0, а НЕ помилка:
    // «за строк при живому з'єднанні позицій не було» — чесний результат, і
    // інтерфейс скаже про нього іншими словами.
    return Response.json({
      ok: true,
      vessels: result.items,
      collectedAt: new Date(result.finishedAt).toISOString(),
      windowSeconds: settings.windowSeconds,
      count: result.items.length,
      // Неповнота — похідна від причини завершення, а не окремий прапор
      // збирача: одне джерело правди на одну обставину.
      truncated: result.reason === 'limit_reached',
      reason: result.reason,
      includeClassB: settings.includeClassB,
    } satisfies SnapshotResponse);
  };
}

export const getSnapshot = createSnapshotHandler({ toItem: vesselFromPositionReport });
