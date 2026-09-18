// Формати картки судна. Джерело: docs/tasks/SPRINT-01.md, розділ "Узгоджені значення";
// таблиця §3.5 проєктного рішення B-03/B-04.
//
// Функції чисті й не знають ні про React, ні про Leaflet: юніт-раннер імпортує
// саме цей модуль, а він не тягне за собою ні CSS, ні браузерних API.
//
// `Intl` і `toLocaleString` тут заборонені, і саме тому, що інтерфейс український:
// `(51).toLocaleString('uk-UA', { minimumFractionDigits: 5 })` дає "51,00000" — кома
// як десятковий роздільник, і пара координат вийшла б із чотирма комами. Для часу
// вивід `Intl` ще й залежить від складання ICU.

import type { VesselSource } from '../model/vessel';

/** Єдиний текст невідомого значення. Не "0", не порожній рядок. */
export const UNKNOWN_VALUE = 'Немає даних';

/** Підпис джерела рендериться і в панелі (US-06), і полем картки — константа одна. */
export const SOURCE_LABELS: Readonly<Record<VesselSource, string>> = {
  demo: 'Демонстраційні дані',
  aisstream: 'AISStream',
};

/**
 * Нормалізація курсу до домену [0, 360). Округлення йде ПЕРЕД модулем: 359.7 дає
 * `0`, тоді як зворотний порядок дав би `360` — значення поза оголошеним доменом.
 *
 * Не в публічному API зрізу: це внутрішня угода, яка тримає картку й значок на
 * одному куті. Розійдись вони — судно показувало б "0°" і дивилося б у 360°.
 */
export function normalizeCourseDeg(courseDeg: number): number {
  return Math.round(courseDeg) % 360;
}

export function formatCoordinates(lat: number, lon: number): string {
  // `toFixed(5)` навмисно лишає значущі нулі: "51.00000", не "51".
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatSpeed(speedKnots: number | null): string {
  // Тільки `=== null`, ніколи `||`: `0 || UNKNOWN_VALUE` дало б "Немає даних"
  // для судна, що справді стоїть, і одним рухом зламало б US-04.
  if (speedKnots === null) {
    return UNKNOWN_VALUE;
  }

  // `Number(...)` зрізає хвостовий нуль ("12.0" → "12") і заразом прибирає -0,
  // яке зрізання рядка регексом лишило б як "-0 kn".
  return `${Number(speedKnots.toFixed(1))} kn`;
}

export function formatCourse(courseDeg: number | null): string {
  // Перевірка передує арифметиці: `Math.round(null)` дорівнює 0, тож незахищене
  // округлення надрукувало б "0°" — конкретний курс — для невідомого.
  if (courseDeg === null) {
    return UNKNOWN_VALUE;
  }

  return `${normalizeCourseDeg(courseDeg)}°`;
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  // Без цієї гілки `toISOString()` на нерозбірній даті кидає RangeError і валить
  // рендер усієї картки. У демонстраційних даних такий рядок неможливий — гілка
  // існує проти даних AIS, яких ще немає.
  if (Number.isNaN(date.getTime())) {
    return UNKNOWN_VALUE;
  }

  // `toISOString()` завжди повертає UTC, тож зріз [11, 19) — це "HH:MM:SS"
  // незалежно від зони машини.
  return `${date.toISOString().slice(11, 19)} UTC`;
}

export function formatSource(source: VesselSource): string {
  return SOURCE_LABELS[source];
}

export function formatName(name: string | null): string {
  return name ?? UNKNOWN_VALUE;
}
