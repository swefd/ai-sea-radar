// Тексти панелі налаштувань і блоку «Докладно». Специфікація
// docs/superpowers/specs/2026-09-29-snapshot-settings-design.md §5.1, §5.4.
// Чисті функції без React — юніт-проєкт пінить їх літералами, як і підпис.

import type { SnapshotDiagnostics } from '@/entities/vessel';

/** Мітка під повзунком. До хвилини включно — секунди, як їх і називали. */
export function windowLabel(seconds: number): string {
  return seconds <= 60 ? `${seconds} с` : `${seconds / 60} хв`;
}

/** Для читача екрана. Відмінок хвилин: 2–4 — «хвилини», 5 — «хвилин». */
export function windowValueText(seconds: number): string {
  if (seconds <= 60) return `${seconds} секунд`;
  const minutes = seconds / 60;
  return `${minutes} ${minutes < 5 ? 'хвилини' : 'хвилин'}`;
}

function minutesSeconds(total: number): string {
  if (total < 60) return `${total} с`;
  const rest = total % 60;
  return rest === 0 ? `${total / 60} хв` : `${Math.floor(total / 60)} хв ${rest} с`;
}

/**
 * Підпис під смугою збору. Час — браузерний відлік від натискання, тобто
 * оцінка: сервер свого прогресу не повідомляє. Тому понад вікно лічильник не
 * росте — відповідь може прийти пізніше, а «35 с із 30 с» читалося б як збій.
 */
export function progressLabel(elapsedMs: number, windowSeconds: number): string {
  const elapsed = Math.min(Math.floor(elapsedMs / 1000), windowSeconds);
  return `${minutesSeconds(elapsed)} із ${minutesSeconds(windowSeconds)}`;
}

/** Порядок типів сталий: інакше рядок стрибав би між однаковими спробами. */
const TYPE_ORDER = ['PositionReport', 'StandardClassBPositionReport', 'other'] as const;
const TYPE_LABEL: Record<(typeof TYPE_ORDER)[number], string> = {
  PositionReport: 'PositionReport',
  StandardClassBPositionReport: 'StandardClassBPositionReport',
  other: 'інші',
};

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace('.', ',');
}

/** `vesselCount` — `null` для помилки: суден там немає за визначенням. */
export function diagnosticsLine(d: SnapshotDiagnostics, vesselCount: number | null): string {
  const types = TYPE_ORDER
    .filter((type) => (d.byType[type] ?? 0) > 0)
    .map((type) => `${TYPE_LABEL[type]}: ${d.byType[type]}`);
  const parts = [
    `з'єднання: ${d.connectMs === null ? 'не відкрито' : `${seconds(d.connectMs)} с`}`,
    `повідомлень: ${d.messages}${types.length > 0 ? ` (${types.join(', ')})` : ''}`,
    `відкинуто: ${d.rejected}`,
  ];
  if (vesselCount !== null) parts.push(`суден: ${vesselCount}`);
  return parts.join(' · ');
}
