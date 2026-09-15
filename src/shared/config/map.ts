// Узгоджені значення району й карти. Джерело: docs/tasks/SPRINT-01.md,
// розділ "Узгоджені значення". Кожне значення живе тільки тут.

/**
 * Дуврська протока. У B-02 прямокутник не обмежує карту: панорамування та
 * зум вільні (US-01). Значення знадобиться маршрутам демонстраційних суден.
 */
export const DOVER_STRAIT_REGION = {
  south: 50.75,
  west: 0.95,
  north: 51.25,
  east: 1.95,
} as const;

export const INITIAL_VIEW = {
  center: { lat: 51.0, lon: 1.45 },
  zoom: 10,
} as const;

export const OSM_TILE_LAYER = {
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
} as const;
