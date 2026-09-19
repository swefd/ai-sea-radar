import { test, expect } from '@playwright/test';

import { DEMO_ROUTES, DEMO_TICK_MS } from '@/entities/vessel';
import { DOVER_STRAIT_REGION } from '@/shared/config';

// Дані демонстраційного флоту: ТЗ (docs/tasks/SPRINT-01.md, B-05 і розділ
// "Узгоджені значення") та §3.2 проєктного рішення B-05/B-06.
//
// ЩО ЦЕЙ ФАЙЛ СТЕРЕЖЕ І ЧОГО НЕ СТЕРЕЖЕ. Він перевіряє ІНВАРІАНТИ маршрутів —
// кількість точок, межі району, відсутність збіжних сусідів, — а не самі
// координати. Порівнювати кожен літерал із його копією в тесті означало б
// переписати дані двічі й нічого не довести: тест ходив би за правкою слідом.
// Інваріанти ж переживають правку і червоніють саме тоді, коли вона неправильна.
//
// Один виняток — значення, узгоджені текстом ТЗ, а не обрані виконавцем:
// ідентифікатори, імена та `DEMO_TICK_MS`. Вони пиняться дослівно, як
// "Немає даних" у vessel-format.spec.ts: їх не можна "поліпшити", їх можна
// тільки порушити.

test('тік — 2000 мс, дослівно з ТЗ', () => {
  // Число живе в одному місці (model/demo-routes.ts) і приходить сюди імпортом.
  // Якби тест ніс власну копію, розходження двох копій він би й не побачив.
  expect(DEMO_TICK_MS).toBe(2000);
});

test('три судна з узгодженими ідентифікаторами та іменами', () => {
  expect(DEMO_ROUTES).toHaveLength(3);
  expect(DEMO_ROUTES.map((route) => route.id)).toEqual(['demo-1', 'demo-2', 'demo-3']);
  // Імена — літерали ТЗ. Дефіс тут U+002D, а не тире: передрук з клавіатури
  // дав би на екран схожий рядок, який не збігається побайтово.
  expect(DEMO_ROUTES.map((route) => route.name)).toEqual([
    'Демо-судно 1',
    'Демо-судно 2',
    'Демо-судно 3',
  ]);
});

test('у кожного маршруту 8-12 точок — межі ТЗ, обидві включно', () => {
  for (const route of DEMO_ROUTES) {
    expect(route.points.length, route.id).toBeGreaterThanOrEqual(8);
    expect(route.points.length, route.id).toBeLessThanOrEqual(12);
  }
});

test('довжини маршрутів різні — судна зупиняються по черзі, а не разом', () => {
  // Не косметика. Три різні довжини роблять вимогу US-03 "дійшовши до кінця
  // маршруту, судно зупиняється й стоїть" спостережною на занятті: перше судно
  // стає, поки два інші ще йдуть. Однакові довжини дали б одну спільну мить,
  // у якій зупинку не відрізнити від зупинки всієї сторінки.
  const lengths = DEMO_ROUTES.map((route) => route.points.length);
  expect(new Set(lengths).size).toBe(lengths.length);
});

test('кожна точка — всередині району з конфігурації', () => {
  // Район читається з @/shared/config, а не переписується числами сюди: інакше
  // зсув району в конфігурації лишив би цей тест зеленим над судном за межами
  // карти. Прямокутник із ТЗ: 50.75..51.25 N, 0.95..1.95 E.
  for (const route of DEMO_ROUTES) {
    route.points.forEach((point, index) => {
      const where = `${route.id}[${index}]`;
      expect(point.lat, where).toBeGreaterThanOrEqual(DOVER_STRAIT_REGION.south);
      expect(point.lat, where).toBeLessThanOrEqual(DOVER_STRAIT_REGION.north);
      expect(point.lon, where).toBeGreaterThanOrEqual(DOVER_STRAIT_REGION.west);
      expect(point.lon, where).toBeLessThanOrEqual(DOVER_STRAIT_REGION.east);
    });
  }
});

test('жодні дві СУСІДНІ точки не збігаються — інакше азимут дав би null', () => {
  // Пастка названа в reference/geodesy/CLAUDE.md: initialBearingTo для збіжних
  // точок повертає NaN, а наш порт — null. І те, й те означало б нейтральний
  // значок і "Немає даних" посеред руху, тобто судно, що на один тік "забуло"
  // свій курс. У даних цього бути не сміє, і стереже це саме цей рядок.
  //
  // Саме СУСІДНІ: маршрут, що повертається у власну точку через кілька кроків,
  // азимуту не ламає, тож забороняти всі повтори було б забороною ширшою за
  // причину.
  for (const route of DEMO_ROUTES) {
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1];
      const current = route.points[index];
      expect(
        previous.lat === current.lat && previous.lon === current.lon,
        `${route.id}: точки ${index - 1} і ${index} збігаються`,
      ).toBe(false);
    }
  }
});

test('швидкість кожного маршруту — додатне число', () => {
  // Точні значення (18.0 / 12.5 / 20.5) свідомо НЕ пиняться: їх обрав виконавець,
  // а не ТЗ, і вони мають право змінитися без зміни тесту. Додатність — інша
  // річ: нуль у літералі зробив би судно, що "стоїть" уже на старті, і зламав
  // би єдиний спостережний доказ різниці між 0 kn і "Немає даних" (§7).
  for (const route of DEMO_ROUTES) {
    expect(Number.isFinite(route.speedKnots), route.id).toBe(true);
    expect(route.speedKnots, route.id).toBeGreaterThan(0);
  }
});
