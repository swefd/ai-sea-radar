// Складання DOM значка судна. Проєктне рішення B-03/B-04, §3.4.
//
// Це ОКРЕМИЙ вхід зрізу `entities/vessel`, і `index.ts` ядра його не
// реекспортує: `leaflet` кидає `ReferenceError: window is not defined` уже на
// завантаженні модуля, а юніт-раннер Playwright не має трансформу для `.css`.
// Імпортувати цей файл можна лише зсередини `ssr:false`-піддерева карти.
//
// ПОРЯДОК ІМПОРТУ CSS — пастка, невидима з коду, і саме тому вона тут записана.
// `leaflet.css` задає `.leaflet-marker-icon { position: absolute; left: 0;
// top: 0 }` специфічністю одного класу — рівно такою ж, як у будь-якого класу
// CSS-модуля; між рівними перемагає аркуш, що прийшов пізніше. Тому імпорт
// цього модуля мусить стояти ПІСЛЯ `import 'leaflet/dist/leaflet.css'` у
// файлі, який його вносить у граф. Переставиш вище — Leaflet мовчки перекриє
// позиціювання значка, і жодні автоматичні ворота цього репозиторію цього не
// побачать: `edit-check` не дивиться на `.css`, а рівень `fast` не має нічого
// візуального.
//
// Номери рядків у коментарях нижче — проти `leaflet@1.9.4`; перевіряйте за
// іменем символу, не за числом.

import * as L from 'leaflet';

import { vesselIconState, type Vessel } from '@/entities/vessel';

import styles from './vessel-icon.module.css';

/**
 * Сторона коробки значка в пікселях. Число живе тільки тут, бо Leaflet вимагає
 * його в опціях; CSS-модуль рахує всі свої розміри у відсотках від цієї коробки
 * і другої копії не тримає.
 */
const ICON_SIZE_PX = 28;

export function createVesselIcon(
  vessel: Vessel,
  selected: boolean,
): { readonly icon: L.DivIcon; readonly element: HTMLElement } {
  // СВІЖИЙ елемент на кожен маркер. `DivIcon.createIcon` робить
  // `empty(div); div.appendChild(options.html)` (`leaflet-src.js:11082-11084`), а
  // `appendChild` ПЕРЕНОСИТЬ вузол — вузол має рівно одного батька. Спільний
  // елемент (як і спільний об'єкт опцій) змусив би значок стрибнути до маркера,
  // що відрендерився останнім.
  const element = document.createElement('div');
  applyVesselIconState(element, vessel, selected);

  const icon = L.divIcon({
    // `Element`, а не рядок: рядкова форма `html` іде в `innerHTML` і є одним із
    // двох innerHTML-стоків Leaflet. Тут немає інтерполяції HTML взагалі, тож
    // ім'я судна не має шляху в розмітку — а `<b>Демо</b>` не має шансу стати
    // тегом.
    html: element,
    // Клас КОРЕНЯ задається тільки тут. Записаний на елемент, він був би
    // стертий: `_setIconStyles` жорстко присвоює `img.className` (`:7438`).
    // Заразом цей рядок витісняє типовий `leaflet-div-icon`, який дістає з
    // `leaflet.css` білий фон і рамку — коробку за кожним судном.
    className: styles.marker,
    // `iconAnchor` задається ЯВНО, хоч `_setIconStyles` і вивів би його з
    // `iconSize`: `_panOnFocus` читає `iconAnchor` напряму й підставляє (0, 0),
    // коли його немає, а `autoPanOnFocus` типово `true` — фокус на маркері
    // зсунув би карту.
    iconSize: [ICON_SIZE_PX, ICON_SIZE_PX],
    iconAnchor: [ICON_SIZE_PX / 2, ICON_SIZE_PX / 2],
  });

  return { icon, element };
}

/**
 * Оновлює наявний значок НА МІСЦІ — і це єдиний дозволений шлях.
 *
 * `marker.setIcon` кличе `empty(div)` і знищує дочірній вузол разом з
 * атрибутами, за якими значок знаходять тести; заразом гине вузол під курсором,
 * тобто губиться клік. Тому `setIcon` не викликається ніколи.
 */
export function updateVesselIcon(element: HTMLElement, vessel: Vessel, selected: boolean): void {
  applyVesselIconState(element, vessel, selected);
}

function applyVesselIconState(element: HTMLElement, vessel: Vessel, selected: boolean): void {
  // Гілка 'course' | 'neutral' і кут приходять із чистого ядра зрізу й тут не
  // дублюються: юніт-тест не може імпортувати цей файл (CSS), тож копія рішення
  // тут була б копією, яку не перевіряє ніщо.
  const state = vesselIconState(vessel.courseDeg);

  // Обидва атрибути — на ДОЧІРНЬОМУ вузлі: `divIcon` не має опції атрибутів, а
  // корінь належить Leaflet. `data-vessel-id` пишеться щоразу, а не лише при
  // створенні, щоб значок не спирався на припущення про чужий реєстр: тести
  // шукають судна виключно за цими двома атрибутами.
  element.setAttribute('data-vessel-id', vessel.id);
  element.setAttribute('data-icon', state.kind);

  const classNames = [styles.glyph, state.kind === 'course' ? styles.course : styles.neutral];
  if (selected) {
    classNames.push(styles.selected);
  }
  element.className = classNames.join(' ');

  // Обертання — теж на дочірньому вузлі. `transform` кореня належить Leaflet:
  // `_setPos` (`:7986`) → `setPosition` (`:2543`) → `setTransform` (`:2529`)
  // переписує його на кожен зум і кожен `setLatLng`. Два `transform` на різних
  // вузлах не сперечаються.
  element.style.transform = `rotate(${state.rotationDeg}deg)`;
}
