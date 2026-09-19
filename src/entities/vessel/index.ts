// Публічний вхід ЧИСТОГО ЯДРА зрізу `entities/vessel`: тип, демонстраційні дані,
// формати, підписи, стан значка. Це імпортують і серверний граф Next.js, і юніт-тести.
//
// ЦЕЙ ФАЙЛ НЕ СМІЄ РЕЕКСПОРТУВАТИ НІЧОГО З ui/ — ні картку, ні значок.
// Зріз має три входи, і це межа середовища, а не стиль (§3.1 проєктного рішення
// B-03/B-04). Дві незалежні причини, обидві виміряні:
//
//   1. Серверна збірка. `leaflet` кидає `ReferenceError: window is not defined` уже
//      на завантаженні модуля, а його package.json оголошує лише "main" — ні
//      `exports`, ні `sideEffects: false`, тож пакет не tree-shakable. Реекспорт
//      значка звідси затягнув би `leaflet` у серверний граф і вбив `next build`.
//      Позначити значок 'use client' НЕ рятує: його експорти стали б клієнтськими
//      посиланнями, і серверний компонент не зміг би їх викликати.
//   2. Юніт-раннер. Playwright реєструє трансформ для .ts/.tsx/.js/.jsx/.mjs/.mts/
//      .cjs/.cts — `.css` там немає. Імпорт CSS-модуля з юніт-проєкту дає
//      ERR_UNKNOWN_FILE_EXTENSION ".css" і валить прогін форматів.
//
// Два інші входи беруться шляхом, а не звідси:
//   @/entities/vessel/ui/vessel-card   React + CSS, SSR-безпечний
//   @/entities/vessel/ui/vessel-icon   leaflet + CSS, лише зсередини ssr:false
//
// Стереже цю межу тільки `npm run build` — жоден рядок реєстру перевірок на неї
// не дивиться.

export type { Vessel, VesselSource } from './model/vessel';

// Демонстраційний флот віддається МАРШРУТАМИ й чистою функцією кроку, а не
// готовим масивом суден: із B-05 судно — похідне від маршруту й номера тіка.
// `DEMO_VESSELS` із B-03 тут більше немає, і це заплановане заміщення, а не
// втрата — споживачі й далі отримують `readonly Vessel[]`, тільки тепер із
// `fleetAtTick`.
export type { DemoRoute, RoutePoint } from './model/demo-routes';
export { DEMO_ROUTES, DEMO_TICK_MS } from './model/demo-routes';
export { fleetAtTick, lastFleetTick, vesselAtTick } from './lib/demo-fleet';

export {
  UNKNOWN_VALUE,
  SOURCE_LABELS,
  formatCoordinates,
  formatSpeed,
  formatCourse,
  formatTimestamp,
  formatSource,
  formatName,
} from './lib/vessel-format';

export type { VesselIconState } from './lib/vessel-icon-state';
export { vesselIconState } from './lib/vessel-icon-state';
