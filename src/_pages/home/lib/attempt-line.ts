// Рядок результату останньої спроби, CR :25…:28 дослівно. Чиста функція без
// React, як `snapshot-caption.ts`: юніт-проєкт пінить тексти літералами, а
// панель лише показує результат.
//
// Це ДРУГИЙ із двох незалежних станів R4 (CR :23). Перший — показаний набір із
// підписом джерела — живе у `VesselView`, і цей рядок про нього нічого не знає:
// невдала спроба змінює тільки рядок, ніколи підпис.
//
// Час — ТІЛЬКИ з тіла відповіді (CR :33): `collectedAt` в успіху, `attemptedAt`
// у помилці. Без відповіді часу немає взагалі, і рядок його не вигадує
// браузерним годинником.

import { formatTimestamp, type SnapshotResponse } from '@/entities/vessel';

import { NO_SERVER_RESPONSE } from './snapshot-caption';

/** `null` у `done` — відповіді немає або тіло не розібране (`fetchSnapshot`). */
export type Attempt =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'done'; response: SnapshotResponse | null };

const LOADING_LINE = 'Завантаження…';
const FAILED = 'не вдалося отримати дані';

export function attemptLine(attempt: Attempt): string | null {
  switch (attempt.kind) {
    case 'none':
      return null;
    case 'loading':
      return LOADING_LINE;
    case 'done': {
      const { response } = attempt;
      if (response === null) {
        return `Спроба: ${FAILED}: ${NO_SERVER_RESPONSE}`;
      }
      if (!response.ok) {
        return `Спроба ${formatTimestamp(response.attemptedAt)}: ${FAILED}: ${response.error.message}`;
      }
      if (response.count === 0) {
        return `Спроба ${formatTimestamp(response.collectedAt)}: за час збору позицій не отримано`;
      }
      return `Спроба ${formatTimestamp(response.collectedAt)}: отримано суден: ${response.count}`;
    }
  }
}
