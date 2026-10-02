// Єдиний шлях клієнта до сервера — `fetch('/api/snapshot')`. Модулі
// `@/shared/api/aisstream/*` сюди не імпортуються: ключ і сокет живуть лише на
// сервері (SPRINT-02:24), і клієнтський граф не має навіть шансу їх затягнути.
//
// Будь-що, окрім тіла зрозумілої форми, стає `null`: мережа впала, сервер
// віддав порожнє тіло (502 без JSON), тіло не JSON або в ньому немає булевого
// `ok`. Інтерфейс перекладає `null` у помилку `NO_SERVER_RESPONSE`, тобто
// НЕ зависає в стані завантаження — саме ця пастка названа в Review Focus 4
// плану. Функція не кидає ніколи, бо кидок з обробника кліку лишив би кнопку
// заблокованою назавжди.
//
// HTTP-статус не читається навмисно: помилка приходить із 502, але з повним
// тілом `{ ok: false, … }`, і саме тіло несе причину, яку треба показати.
// Глибше за `ok` форма не перевіряється — сервер той самий застосунок, і його
// форму стереже юніт-тест обробника.
//
// Скасування — ОКРЕМИЙ результат `'cancelled'`, а не `null`: `null` інтерфейс
// показує як «Немає відповіді сервера», а людина, що сама натиснула
// «Скасувати», помилки не робила (специфікація 2026-09-29 §5.2). Ознака —
// `signal.aborted`, а не ім'я винятку: `AbortError` рушії й підставки
// кидають по-різному, а стан сигналу однаковий.

import type { SnapshotResponse } from '@/entities/vessel';
import type { SnapshotSettings } from '@/shared/config';

const SNAPSHOT_URL = '/api/snapshot';

export const SNAPSHOT_CANCELLED = 'cancelled' as const;

/** Параметри завжди явні, навіть типові: запит сам каже, чого просили. */
function snapshotUrl({ windowSeconds, includeClassB }: SnapshotSettings): string {
  return `${SNAPSHOT_URL}?window=${windowSeconds}&classB=${includeClassB ? 1 : 0}`;
}

export async function fetchSnapshot(
  settings: SnapshotSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SnapshotResponse | typeof SNAPSHOT_CANCELLED | null> {
  try {
    const response = await fetchImpl(snapshotUrl(settings), { cache: 'no-store', signal });
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    if (typeof (body as { ok?: unknown }).ok !== 'boolean') return null;
    return body as SnapshotResponse;
  } catch {
    return signal?.aborted === true ? SNAPSHOT_CANCELLED : null;
  }
}
