// Структура судна. Джерело: docs/tasks/SPRINT-01.md, розділ "Узгоджені значення";
// проєктне рішення docs/superpowers/specs/2026-09-18-b03-b04-vessel-and-card-design.md §3.1.

export type VesselSource = 'demo' | 'aisstream';

/**
 * Одна форма для демонстраційних і справжніх суден — щоб поява AIS у пізнішому
 * релізі не роздвоїла тип і формати картки.
 *
 * `null` і `0` — різні стани: `null` означає "невідомо" й рендериться як
 * "Немає даних", а нульова швидкість — справжнє значення й рендериться як `0 kn`.
 *
 * Поля `readonly`: судно — знімок стану на `timestamp`, а не змінюваний об'єкт.
 * Рух у B-06 замінює елемент масиву, а не мутує наявний, інакше React не побачить
 * зміни за посиланням.
 */
export interface Vessel {
  readonly id: string;
  /** Порожній рядок нормалізується до `null` на вході, не в форматувальнику. */
  readonly name: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly speedKnots: number | null;
  /** Курс над ґрунтом (COG), не heading. Домен [0, 360). */
  readonly courseDeg: number | null;
  /** ISO 8601 із зоною. Рядок без зони парситься як локальний час. */
  readonly timestamp: string;
  readonly source: VesselSource;
}
