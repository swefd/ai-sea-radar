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

import type { SnapshotResponse } from '@/entities/vessel';

const SNAPSHOT_URL = '/api/snapshot';

export async function fetchSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<SnapshotResponse | null> {
  try {
    const response = await fetchImpl(SNAPSHOT_URL, { cache: 'no-store' });
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    if (typeof (body as { ok?: unknown }).ok !== 'boolean') return null;
    return body as SnapshotResponse;
  } catch {
    return null;
  }
}
