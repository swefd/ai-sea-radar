import { test, expect } from '@playwright/test';

import {
  DEMO_ROUTES,
  DEMO_TICK_MS,
  fleetAtTick,
  lastFleetTick,
  vesselAtTick,
  type DemoRoute,
} from '@/entities/vessel';

// Арифметика кроку демонстраційного флоту: §3.1, §3.5 і §7 проєктного рішення
// B-05/B-06.
//
// ЩО ЦІ ТЕСТИ ДОВОДЯТЬ — І ЧОГО НЕ ДОВОДЯТЬ, сказано вузько навмисно (§7).
// `vesselAtTick` кличеться з ЯВНИМ номером тіка — це звичайний аргумент функції,
// а не підмінений годинник. Отже доведено: де судно на тіку N, коли швидкість
// стає 0, що далі воно не змінюється, який азимут у відрізка. НЕ доведено:
// що тік стається кожні 2000 мс, що значок рухається на екрані й що таймери не
// накопичуються. Це межа, яку SPRINT-01.md:46 кладе на цей тиждень; керований
// час — робота R3.
//
// Азимут перевіряється ЧЕРЕЗ `vesselAtTick`, а не прямим імпортом `lib/geo.ts`.
// Так доводиться весь ланцюг — формула, порядок аргументів і те, що результат
// справді доїхав до поля `courseDeg`, — а не сама лише тригонометрія.

/** Момент старту в тестах — фіксований, щоб `timestamp` був порівнюваним літералом. */
const STARTED_AT = Date.parse('2026-09-18T12:00:00.000Z');

/** Маршрут із двох названих точок: інструмент для випадків, яких немає в даних. */
function routeOf(points: readonly { lat: number; lon: number }[]): DemoRoute {
  return { id: 'test', name: 'Тест', speedKnots: 10, points };
}

// ------------------------------------------------------------------- азимут

test('азимут: опорне число geodesy — і саме ПОЧАТКОВИЙ, не кінцевий', () => {
  // Cambridge -> Paris. Джерело чисел — chrisveness/geodesy, документація
  // initialBearingTo (latlon-spherical.js:222) і test/latlon-spherical-tests.js.
  const vessel = vesselAtTick(
    routeOf([
      { lat: 52.205, lon: 0.119 },
      { lat: 48.857, lon: 2.351 },
    ]),
    0,
    STARTED_AT,
  );

  // 156.2° — початковий азимут. РОЗРІЗНЯЛЬНИЙ ВИПАДОК: `finalBearingTo` тієї ж
  // пари дає 157.9°, і сплутати одне з одним — найпростіша помилка цього
  // завдання. Ці 1.7° — єдине, що її ловить; жоден інший тест файлу не
  // відрізнив би дві формули.
  expect(vessel.courseDeg).not.toBeNull();
  expect(vessel.courseDeg as number).toBeCloseTo(156.1666, 3);
  expect(Number((vessel.courseDeg as number).toFixed(1))).toBe(156.2);
  expect(Number((vessel.courseDeg as number).toFixed(1))).not.toBe(157.9);
});

test('азимут: зворотний напрямок — 337.9°, тобто wrap360 справді працює', () => {
  // Paris -> Cambridge. `atan2` дає тут від'ємне число (близько -22.1°), і без
  // приведення до [0, 360) у `courseDeg` поїхало б значення поза оголошеним
  // доменом. Далі `Math.round(-22.1) % 360` надрукувало б "-22°", а значок
  // повернувся б не в той бік — і ні tsc, ні лінтер цього не бачать (§3.5).
  const vessel = vesselAtTick(
    routeOf([
      { lat: 48.857, lon: 2.351 },
      { lat: 52.205, lon: 0.119 },
    ]),
    0,
    STARTED_AT,
  );

  expect(vessel.courseDeg as number).toBeCloseTo(337.8904, 3);
  expect(Number((vessel.courseDeg as number).toFixed(1))).toBe(337.9);
});

test('азимут: кожен курс демонстраційного флоту — всередині [0, 360)', () => {
  // Домен із ТЗ. У TypeScript він не виражений, тож стереже його рівно це.
  for (const route of DEMO_ROUTES) {
    for (let tick = 0; tick <= route.points.length; tick += 1) {
      const course = vesselAtTick(route, tick, STARTED_AT).courseDeg;
      expect(course, `${route.id} тік ${tick}`).not.toBeNull();
      expect(course as number, `${route.id} тік ${tick}`).toBeGreaterThanOrEqual(0);
      expect(course as number, `${route.id} тік ${tick}`).toBeLessThan(360);
    }
  }
});

test('азимут: збіжні точки дають null, а не NaN', () => {
  // Свідоме розходження з оригіналом (reference/geodesy/CLAUDE.md): geodesy
  // повертає NaN, наш контракт — `number | null`. NaN не є ні числом із
  // [0, 360), ні null: картка надрукувала б "NaN°", а значок повернувся б у
  // NaN градусів, тобто не повернувся б зовсім, і жодна гілка "невідомо" не
  // спрацювала б.
  const vessel = vesselAtTick(
    routeOf([
      { lat: 51.1, lon: 1.4 },
      { lat: 51.1, lon: 1.4 },
    ]),
    0,
    STARTED_AT,
  );

  expect(vessel.courseDeg).toBeNull();
  expect(Number.isNaN(vessel.courseDeg as unknown as number)).toBe(false);
});

test('азимут: спільна ОДНА координата — це не збіг точок', () => {
  // ПРЯМА ВАРТА проти `||` замість `&&` у перевірці збігу — мутації, яку решта
  // сюїти пропускає. Виміряно: заміна `&&` на `||` у `initialBearingDeg`
  // лишала всі 23 тести зеленими, бо в сьогоднішніх маршрутах немає жодної
  // пари сусідніх точок зі спільною широтою чи довготою. Наслідок мутації
  // тихий і саме тому небезпечний: судно, чиї сусідні точки випадково поділили
  // одну координату, на цілий тік лишилося б без курсу — нейтральний круглий
  // значок і "Немає даних" посеред руху, тимчасом як воно йде.
  //
  // Числа — з того ж порту: між точками однакової широти азимут НЕ рівно 90°,
  // бо велике коло відхиляється до полюса. Рівні 0° і 180° дає тільки спільна
  // довгота.
  const east = vesselAtTick(
    routeOf([
      { lat: 51.1, lon: 1.4 },
      { lat: 51.1, lon: 1.5 },
    ]),
    0,
    STARTED_AT,
  );
  expect(east.courseDeg).not.toBeNull();
  expect(east.courseDeg as number).toBeCloseTo(89.9611, 3);

  const north = vesselAtTick(
    routeOf([
      { lat: 51.1, lon: 1.4 },
      { lat: 51.2, lon: 1.4 },
    ]),
    0,
    STARTED_AT,
  );
  expect(north.courseDeg).toBe(0);

  const south = vesselAtTick(
    routeOf([
      { lat: 51.2, lon: 1.4 },
      { lat: 51.1, lon: 1.4 },
    ]),
    0,
    STARTED_AT,
  );
  expect(south.courseDeg).toBe(180);
});

test('азимут: маршрут коротший за дві точки дає null і не кидає', () => {
  // §6, помилковий стан. У даних такий маршрут неможливий (це стереже
  // demo-routes.spec.ts), але гілка мусить існувати: без неї звернення до
  // points[1] дало б undefined і виняток при читанні .lat — тобто впав би
  // рендер усієї сторінки, а не одне поле.
  const vessel = vesselAtTick(routeOf([{ lat: 51.1, lon: 1.4 }]), 0, STARTED_AT);

  expect(vessel.courseDeg).toBeNull();
  expect(vessel.lat).toBe(51.1);
  expect(vessel.lon).toBe(1.4);
});

// -------------------------------------------------- позиція, курс і час кроку

test('на тіку N судно в точці N — поки точки не скінчилися', () => {
  const route = DEMO_ROUTES[0];

  for (let tick = 0; tick < route.points.length; tick += 1) {
    const vessel = vesselAtTick(route, tick, STARTED_AT);
    expect(vessel.lat, `тік ${tick}`).toBe(route.points[tick].lat);
    expect(vessel.lon, `тік ${tick}`).toBe(route.points[tick].lon);
  }
});

test('курс: на старті — до другої точки, далі — від попередньої до поточної', () => {
  // Правило ТЗ дослівно. Обидві половини потрібні: реалізація, що завжди бере
  // відрізок [i, i+1], дала б на тіку 0 те саме число й розійшлася б лише далі
  // — тобто перший тік її б не викрив.
  const route = DEMO_ROUTES[0];

  const atStart = vesselAtTick(route, 0, STARTED_AT);
  const atFirstStep = vesselAtTick(route, 1, STARTED_AT);

  // Тік 0 і тік 1 дивляться на ОДИН І ТОЙ САМИЙ відрізок p0 -> p1, тож курс
  // збігається. Це не тавтологія: реалізація "завжди [i, i+1]" дала б на тіку 1
  // курс наступного відрізка, і рівність зламалася б.
  expect(atStart.courseDeg).toBe(atFirstStep.courseDeg);

  // Виміряні значення маршруту demo-1 (§3.2): 226° на старті, 232° на тіку 4 —
  // обхід банки Варн, — 223° на тіку 5. Пиняться саме ті три, де маршрут
  // помітно повертає: рівний курс на всіх тіках не відрізнив би правильну
  // реалізацію від тієї, що рахує азимут одного першого відрізка назавжди.
  const rounded = (tick: number): number =>
    Math.round(vesselAtTick(route, tick, STARTED_AT).courseDeg as number);

  expect(rounded(0)).toBe(226);
  expect(rounded(4)).toBe(232);
  expect(rounded(5)).toBe(223);
});

test('час кроку — момент старту плюс номер тіка, у ISO 8601 із зоною', () => {
  const route = DEMO_ROUTES[0];

  expect(vesselAtTick(route, 0, STARTED_AT).timestamp).toBe('2026-09-18T12:00:00.000Z');
  expect(vesselAtTick(route, 1, STARTED_AT).timestamp).toBe('2026-09-18T12:00:02.000Z');
  expect(vesselAtTick(route, 3, STARTED_AT).timestamp).toBe('2026-09-18T12:00:06.000Z');

  // Зона обов'язкова: рядок без неї парситься як локальний час машини, і
  // картка показала б чужий годинник під підписом UTC.
  expect(vesselAtTick(route, 3, STARTED_AT).timestamp.endsWith('Z')).toBe(true);

  // Крок дорівнює саме DEMO_TICK_MS, а не зашитій у тест двійці.
  const step =
    Date.parse(vesselAtTick(route, 2, STARTED_AT).timestamp)
    - Date.parse(vesselAtTick(route, 1, STARTED_AT).timestamp);
  expect(step).toBe(DEMO_TICK_MS);
});

// ------------------------------------------------------------------ зупинка

test('на останній точці швидкість 0 — і саме тим самим тіком', () => {
  const route = DEMO_ROUTES[0];
  const last = route.points.length - 1;

  // Тіком РАНІШЕ швидкість ще літеральна. Без цього рядка тест був би зелений
  // над реалізацією, що обнуляє швидкість на тік раніше або взагалі завжди.
  expect(vesselAtTick(route, last - 1, STARTED_AT).speedKnots).toBe(route.speedKnots);

  // Тим самим тіком, яким судно приходить на останню точку, — вимога ТЗ.
  const arrived = vesselAtTick(route, last, STARTED_AT);
  expect(arrived.speedKnots).toBe(0);
  expect(arrived.lat).toBe(route.points[last].lat);
  expect(arrived.lon).toBe(route.points[last].lon);

  // Саме 0, ніколи null: нуль і "невідомо" — різні речі, і картка мусить
  // надрукувати "0 kn", а не "Немає даних" (US-04).
  expect(arrived.speedKnots).not.toBeNull();
});

test('після останнього тіка судно не змінюється взагалі', () => {
  const route = DEMO_ROUTES[0];
  const last = route.points.length - 1;

  const arrived = vesselAtTick(route, last, STARTED_AT);

  // Порівняння цілих об'єктів, а не окремих полів: так рядок ловить і те поле,
  // про яке ніхто не подумав. Час теж замерзає — його заморожує той самий
  // clamp, що й позицію, тож окремого прапорця "зупинилося" немає й розсинхрону
  // нема на чому статися (§3.1).
  for (const tick of [last + 1, last + 2, 99, 1000]) {
    expect(vesselAtTick(route, tick, STARTED_AT), `тік ${tick}`).toEqual(arrived);
  }
});

test('курс на зупинці — курс останнього відрізка, а не null', () => {
  // Судно, що стало, зберігає орієнтацію значка: воно прийшло сюди курсом і не
  // розвернулося. Реалізація, що на зупинці віддає null, дала б нейтральний
  // круглий значок і "Немає даних" — видима, але неправильна поведінка.
  const route = DEMO_ROUTES[0];
  const last = route.points.length - 1;

  const arrived = vesselAtTick(route, last, STARTED_AT);
  const approaching = vesselAtTick(route, last - 1, STARTED_AT);

  expect(arrived.courseDeg).not.toBeNull();
  expect(arrived.courseDeg).not.toBe(approaching.courseDeg);
  expect(Math.round(arrived.courseDeg as number)).toBe(227);
});

// ----------------------------------------------------------- решта полів і флот

test('решта полів судна — з маршруту, джерело завжди demo', () => {
  const route = DEMO_ROUTES[1];
  const vessel = vesselAtTick(route, 2, STARTED_AT);

  expect(vessel.id).toBe(route.id);
  expect(vessel.name).toBe(route.name);
  expect(vessel.source).toBe('demo');
});

test('один тік рухає весь флот — і кожне судно своїм маршрутом', () => {
  const fleet = fleetAtTick(DEMO_ROUTES, 3, STARTED_AT);

  expect(fleet).toHaveLength(DEMO_ROUTES.length);
  expect(fleet.map((vessel) => vessel.id)).toEqual(DEMO_ROUTES.map((route) => route.id));

  // Кожен елемент дорівнює тому, що дає власний маршрут на тому ж тіку: карта
  // й картка читають один результат, тож розійтися їм нема на чому (§3.1).
  fleet.forEach((vessel, index) => {
    expect(vessel).toEqual(vesselAtTick(DEMO_ROUTES[index], 3, STARTED_AT));
  });
});

test('судна стають ПО ЧЕРЗІ, кожне на своєму тіку', () => {
  // Пряма варта проти спільної зупинки: реалізація, що рахує "останній тік"
  // один раз на весь флот (наприклад, за найдовшим маршрутом), зупинила б
  // коротші судна не там, де в них скінчився маршрут.
  const stopTicks = DEMO_ROUTES.map((route) => route.points.length - 1);

  stopTicks.forEach((stopTick, index) => {
    const route = DEMO_ROUTES[index];

    // На власному тіку зупинки — вже 0.
    expect(fleetAtTick(DEMO_ROUTES, stopTick, STARTED_AT)[index].speedKnots, route.id).toBe(0);

    // На тік раніше — ще рухається. (У demo-1 це тік 6, коли двоє інших ще йдуть.)
    expect(
      fleetAtTick(DEMO_ROUTES, stopTick - 1, STARTED_AT)[index].speedKnots,
      route.id,
    ).toBe(route.speedKnots);
  });
});

test('останній тік флоту — найдовший маршрут, і після нього все завмерло', () => {
  const last = lastFleetTick(DEMO_ROUTES);

  // 11 = 12 точок demo-3 мінус одна. Число не пиниться літералом: воно похідне
  // від даних, і зайва точка в маршруті мусить рухати його сама.
  expect(last).toBe(Math.max(...DEMO_ROUTES.map((route) => route.points.length - 1)));

  // Саме на цьому тіку зупиняється ОСТАННЄ судно — тобто інтервал у
  // vessel-view.tsx має право спинитися рівно тут і не раніше.
  const frozen = fleetAtTick(DEMO_ROUTES, last, STARTED_AT);
  expect(frozen.every((vessel) => vessel.speedKnots === 0)).toBe(true);
  expect(fleetAtTick(DEMO_ROUTES, last - 1, STARTED_AT).some((vessel) => vessel.speedKnots !== 0)).toBe(
    true,
  );

  // І далі нічого не міняється — доказ, що зупинка інтервалу нічого не ховає.
  expect(fleetAtTick(DEMO_ROUTES, last + 1, STARTED_AT)).toEqual(frozen);
  expect(fleetAtTick(DEMO_ROUTES, 99, STARTED_AT)).toEqual(frozen);
});

test('чистота: той самий вхід дає той самий вихід, а вхідні дані не змінюються', () => {
  // `fleetAtTick` не має права мутувати маршрути: вони `readonly` за типом, але
  // тип зникає при компіляції, а Object.freeze тут ніхто не кличе.
  const before = JSON.stringify(DEMO_ROUTES);

  const first = fleetAtTick(DEMO_ROUTES, 5, STARTED_AT);
  const second = fleetAtTick(DEMO_ROUTES, 5, STARTED_AT);

  expect(first).toEqual(second);
  expect(JSON.stringify(DEMO_ROUTES)).toBe(before);

  // Новий масив і нові об'єкти на кожен виклик — саме цього вимагає React:
  // рух замінює елемент, а не мутує наявний, інакше зміни не видно за
  // посиланням (коментар у model/vessel.ts).
  expect(first).not.toBe(second);
  expect(first[0]).not.toBe(second[0]);
});
