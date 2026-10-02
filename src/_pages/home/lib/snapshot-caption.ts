// Підпис знімка AISStream, SPRINT-02:33 дослівно. Чиста функція без React:
// юніт-проєкт пінить її текст літералами, а панель лише показує результат.
//
// Час береться ТІЛЬКИ з відповіді (`collectedAt`), а не з годинника браузера:
// SPRINT-02:29 — «час спроби інтерфейс бере тільки з відповіді». Число секунд —
// теж із відповіді (`windowSeconds`), бо підпис називає домовлене вікно, а не
// фактичну тривалість; ліміт — із конфігурації, бо у відповіді його немає, а
// літерал 100 у коді продукту заборонений (одне місце для узгодженого значення).

import { formatTimestamp, type SnapshotResponse } from '@/entities/vessel';
import { SNAPSHOT_VESSEL_LIMIT } from '@/shared/config';

// Причина для стану помилки, коли сервер не дав тіла зрозумілої форми. Не
// з переліку SPRINT-02:29 (там коди сервера), а рішення плану SPRINT-03: той
// самий текст, який R4 пізніше пише в рядку спроби, тож живе він тут, поруч
// з іншими текстами панелі.
export const NO_SERVER_RESPONSE = 'Немає відповіді сервера';

export type SnapshotSuccess = Extract<SnapshotResponse, { ok: true }>;

// Доповнення, коли в підписці були малі судна: інакше два знімки з однаковим
// вікном давали б різну кількість суден без видимої причини (специфікація
// 2026-09-29 §5.3).
const CLASS_B_TAIL = ' · із малими суднами (клас B)';

export function snapshotCaption(success: SnapshotSuccess): string {
  const base =
    `AISStream · знімок за ${success.windowSeconds} с · ` +
    `отримано ${formatTimestamp(success.collectedAt)} · ` +
    `суден: ${success.count} · вибірка неповна`;
  const limited = success.truncated ? `${base} · зупинено на ліміті ${SNAPSHOT_VESSEL_LIMIT}` : base;
  return success.includeClassB ? `${limited}${CLASS_B_TAIL}` : limited;
}
