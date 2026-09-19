// Маршрут плюс номер тіка дають судно. Проєктне рішення B-05/B-06, §3.1.
//
// Цей модуль НЕ ЗНАЄ ПРО ЧАС, ТАЙМЕРИ Й REACT: `startedAt` приходить
// аргументом, `tick` — аргументом, `Date.now()` тут не згадується жодного разу.
// Саме ця межа робить арифметику руху тестованою без керованого часу — тобто
// без підміни годинника, якої цей спринт не передбачає (керований час — R3).
//
// У стані сторінки лежать рівно два числа — `tick` і `startedAt`. Координати,
// курс, швидкість і час похідні від них. Через це вимога CLAUDE.md "карта й
// картка читають з одного стану" — структурна, а не декларативна: розійтися їм
// нема на чому, бо обидва читають результат одного виклику.

import type { Vessel } from '../model/vessel';
import { DEMO_TICK_MS, type DemoRoute } from '../model/demo-routes';
import { initialBearingDeg } from './geo';

/**
 * Останній тік ФЛОТУ — найдовший маршрут. Число похідне від даних: зайва точка
 * в будь-якому маршруті рухає його сама, тож літеральної копії немає ніде.
 *
 * Потрібне рівно одному місцю — таймеру у `vessel-view.tsx`, який на цьому
 * тіку чиститься й більше не створюється.
 */
export function lastFleetTick(routes: readonly DemoRoute[]): number {
  return routes.reduce((longest, route) => Math.max(longest, route.points.length - 1), 0);
}

/**
 * Судно на тіку `tick`.
 *
 * НЕСУЧА ТУТ — `Math.min`, і вона робить три роботи одним виразом: зупиняє
 * судно на останній точці, дає `0` швидкості ТИМ САМИМ тіком і заморожує час
 * кроку. Саме тому немає окремого прапорця "зупинилося": прапорець можна
 * розсинхронити з позицією, а `min` — ні.
 *
 * Повертається НОВИЙ об'єкт на кожен виклик. Рух замінює елемент масиву, а не
 * мутує наявний, інакше React не побачить зміни за посиланням (коментар у
 * `model/vessel.ts`).
 */
export function vesselAtTick(route: DemoRoute, tick: number, startedAt: number): Vessel {
  const lastIndex = route.points.length - 1;

  // Clamp — і зупинка судна, і заморозка його часу. Маршрут без жодної точки
  // тут не передбачений: у даних його немає, а тип, що це виражав би, зробив би
  // мертвою гілку "коротший за 2 точки" нижче, яку §6 вимагає лишити живою.
  const index = Math.min(tick, lastIndex);
  const point = route.points[index];

  return {
    id: route.id,
    name: route.name,
    lat: point.lat,
    lon: point.lon,
    // Нуль, а не `null`: судно справді стоїть, і картка мусить надрукувати
    // "0 kn", а не "Немає даних" (ТЗ: "Нуль і null - різні речі").
    speedKnots: index === lastIndex ? 0 : route.speedKnots,
    courseDeg: courseAt(route, index),
    // Похідний час, а не `Date.now()` на кожному тіку. Ціна названа в §3.1:
    // дрейф `setInterval` не враховується, і у фоновій вкладці, де браузер
    // тротлить інтервали, показаний час відстане від справжнього годинника.
    // Виграш — те, що час замерзає на СВОЇЙ останній точці тим самим `min`,
    // без окремого поля "коли це судно стало".
    timestamp: new Date(startedAt + index * DEMO_TICK_MS).toISOString(),
    source: 'demo',
  };
}

/** Один тік рухає весь флот: карта й картка читають той самий результат. */
export function fleetAtTick(
  routes: readonly DemoRoute[],
  tick: number,
  startedAt: number,
): Vessel[] {
  return routes.map((route) => vesselAtTick(route, tick, startedAt));
}

/**
 * Курс на кроці `index`: на старті — азимут до другої точки, далі — від
 * попередньої точки до поточної. Дослівно правило ТЗ.
 *
 * Судно, що стало, зберігає курс останнього відрізка: воно прийшло сюди курсом
 * і не розверталося. `null` тут означав би нейтральний круглий значок на
 * зупиненому судні.
 */
function courseAt(route: DemoRoute, index: number): number | null {
  // §6, помилковий стан: у маршруті з однією точкою (чи без них) відрізка немає,
  // а звернення до points[1] дало б undefined і виняток при читанні .lat — тобто
  // завалило б рендер усієї сторінки, а не одне поле. У даних такий маршрут
  // неможливий, і це стереже юніт-тест, а не сподівання.
  if (route.points.length < 2) {
    return null;
  }

  const from = index === 0 ? route.points[0] : route.points[index - 1];
  const to = index === 0 ? route.points[1] : route.points[index];

  return initialBearingDeg(from, to);
}
