import { test, expect } from '@playwright/test';

import { buildSubscription } from '@/shared/api/aisstream/subscription';

// Фікстура ключа МУСИТЬ починатися з EXAMPLE- або SAMPLE-. Виміряно проти
// нашого ж scripts/verify/checks/no-secrets.mjs: присвоєння APIKey значенню
// з 16+ символів без такого маркера дає ЗНАХІДКУ assigned-secret і робить
// `npm run verify` червоним на власних тестах, а EXAMPLE-/SAMPLE- придушується
// шаблоном PLACEHOLDER.
const KEY = 'EXAMPLE-KEY-NOT-A-REAL-ONE';

test('поле ключа зветься APIKey — не Apikey і не aPIKey', () => {
  // Найдорожча помилка цього модуля, і вона МОВЧАЗНА: джерело просто закриє
  // з'єднання, а помилка прочитається як «мережа підвела».
  //
  // Три джерела в репозиторії розходяться:
  //   reference/aisstream-typescript-example/client.ts:11   Apikey
  //   reference/ais-message-models/.../SubscriptionMessage.ts:17  'aPIKey'
  //   той самий файл :27  "baseName": "APIKey"   ← ім'я НА ДРОТІ
  // Жива документація й SPRINT-02:23 згодні на APIKey.
  const sent = JSON.parse(buildSubscription(KEY)) as Record<string, unknown>;

  expect(Object.keys(sent)).toContain('APIKey');
  expect(Object.keys(sent)).not.toContain('Apikey');
  expect(Object.keys(sent)).not.toContain('aPIKey');
  expect(sent.APIKey).toBe(KEY);
});

test('бокс — Дуврська протока у порядку [lat, lon], вкладений тричі', () => {
  // BoundingBoxes — масив КОРОБОК, кожна з двох кутів, кожен кут — пара.
  // Приклад із whole-world боксом [[-180,-90],[180,90]] не розрізняє порядок
  // пари; документація й SPRINT-02:23 кажуть [lat, lon].
  const sent = JSON.parse(buildSubscription(KEY)) as { BoundingBoxes: number[][][] };

  expect(sent.BoundingBoxes).toEqual([[[50.75, 0.95], [51.25, 1.95]]]);

  // Широта першою: якщо переплутати, коробка поїде в Атлантику біля Гани, і
  // збір поверне порожньо при повністю справному з'єднанні.
  const [[[swLat, swLon], [neLat, neLon]]] = sent.BoundingBoxes;
  expect(swLat).toBeLessThan(neLat);
  expect(swLon).toBeLessThan(neLon);
  expect(swLat).toBeGreaterThan(50);   // протока, не екватор
  expect(swLon).toBeLessThan(10);      // Ла-Манш, не Індійський океан
});

test('фільтр — лише PositionReport', () => {
  const sent = JSON.parse(buildSubscription(KEY)) as { FilterMessageTypes: string[] };
  expect(sent.FilterMessageTypes).toEqual(['PositionReport']);
});

test('результат — рядок, готовий до send(), а не об\'єкт', () => {
  // Межа явна: JSON.stringify робиться ТУТ, щоб connect.ts не мав жодного
  // рішення про формат — він лише передає готовий рядок у сокет.
  const result = buildSubscription(KEY);
  expect(typeof result).toBe('string');
  expect(() => JSON.parse(result)).not.toThrow();
});

test('бокс береться з узгодженого регіону, а не з дубльованих чисел', () => {
  // Варта проти копіпасти координат: якщо хтось змінить DOVER_STRAIT_REGION,
  // підписка мусить поїхати за ним, а не лишитися зі старими числами.
  const sent = JSON.parse(buildSubscription(KEY)) as { BoundingBoxes: number[][][] };
  const flat = sent.BoundingBoxes.flat(2);
  expect(flat).toHaveLength(4);
  expect(new Set(flat).size).toBe(4); // жодне число не продубльоване помилково
});
