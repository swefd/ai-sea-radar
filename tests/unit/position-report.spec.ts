import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test, expect } from '@playwright/test';

import { parseAisTimeUtc, vesselFromPositionReport } from '@/entities/vessel';

// Тести перетворювача, B-14. Очікування — ЛІТЕРАЛИ, переписані з
// docs/tasks/SPRINT-03.md:30…:39 і зі зразка ДО написання assertions: жодне
// очікуване значення не обчислюється перетворювачем (SPRINT-03:22).
//
// Вхід — живий зразок data/samples/position-report.sample.json і СИНТЕТИЧНІ
// варіанти на його основі; кожен синтетичний варіант так і названий у тесті.

const SAMPLE_PATH = path.join(process.cwd(), 'data/samples/position-report.sample.json');

type Json = Record<string, unknown>;

/** Свіжа глибока копія зразка на кожен виклик — варіанти не течуть між тестами. */
function sample(): Json {
  return JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as Json;
}

/** Синтетичний варіант: зразок із переписаними полями MetaData / PositionReport. */
function synthetic(meta: Json = {}, report: Json = {}): Json {
  const raw = sample();
  const metaData = raw.MetaData as Json;
  const message = raw.Message as { PositionReport: Json };
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) delete metaData[key];
    else metaData[key] = value;
  }
  for (const [key, value] of Object.entries(report)) {
    if (value === undefined) delete message.PositionReport[key];
    else message.PositionReport[key] = value;
  }
  return raw;
}

test('живий зразок → судно з ідентифікатором, координатами, швидкістю, курсом, часом', () => {
  // Значення переписані руками з data/samples/position-report.sample.json.
  expect(vesselFromPositionReport(sample())).toEqual({
    id: '210385000',
    name: 'P&O PIONEER',
    lat: 51.12287333333334,
    lon: 1.3346183333333335,
    speedKnots: 0,
    courseDeg: 48.2,
    timestamp: '2026-09-25T17:33:56.513Z',
    source: 'aisstream',
  });
});

test('синтетичний: назви немає → null', () => {
  expect(vesselFromPositionReport(synthetic({ ShipName: undefined }))?.name).toBeNull();
});

test('синтетичний: назва з пробілів → null', () => {
  expect(vesselFromPositionReport(synthetic({ ShipName: '   ' }))?.name).toBeNull();
});

test('синтетичний: пробіли по краях назви обрізаються', () => {
  expect(vesselFromPositionReport(synthetic({ ShipName: '  P&O PIONEER  ' }))?.name).toBe('P&O PIONEER');
});

test('швидкість 0 лишається 0, а не null (зразок)', () => {
  expect(vesselFromPositionReport(sample())?.speedKnots).toBe(0);
});

for (const [label, sog] of [
  ['102.3 («недоступно»)', 102.3],
  ['-1', -1],
  ['рядок', '12'],
  ['відсутня', undefined],
] as const) {
  test(`синтетичний: швидкість ${label} → null, позиція прийнята`, () => {
    const vessel = vesselFromPositionReport(synthetic({}, { Sog: sog }));
    expect(vessel).not.toBeNull();
    expect(vessel?.speedKnots).toBeNull();
    expect(vessel?.lat).toBe(51.12287333333334);
  });
}

test('синтетичний: швидкість 102.2 — межа, приймається', () => {
  expect(vesselFromPositionReport(synthetic({}, { Sog: 102.2 }))?.speedKnots).toBe(102.2);
});

for (const [label, cog] of [
  ['360 («недоступно»)', 360],
  ['-0.1', -0.1],
  ['відсутній', undefined],
] as const) {
  test(`синтетичний: курс ${label} → null, позиція прийнята`, () => {
    const vessel = vesselFromPositionReport(synthetic({}, { Cog: cog }));
    expect(vessel).not.toBeNull();
    expect(vessel?.courseDeg).toBeNull();
  });
}

test('синтетичний: курс 0 лишається 0', () => {
  expect(vesselFromPositionReport(synthetic({}, { Cog: 0 }))?.courseDeg).toBe(0);
});

for (const [label, report] of [
  ['широта 91 («недоступно»)', { Latitude: 91 }],
  ['довгота 181 («недоступно»)', { Longitude: 181 }],
  ['широта 95', { Latitude: 95 }],
  ['довгота -200', { Longitude: -200 }],
  ['широта рядком', { Latitude: '51.1' }],
  ['довгота рядком', { Longitude: '1.3' }],
  ['широти немає', { Latitude: undefined }],
  ['довгота NaN-подібна (null)', { Longitude: null }],
] as const) {
  test(`синтетичний: ${label} → позиція відкинута, судна 0,0 немає`, () => {
    expect(vesselFromPositionReport(synthetic({}, report))).toBeNull();
  });
}

for (const [label, mmsi] of [
  ['відсутній', undefined],
  ['порожній рядок', ''],
  ['рядок із пробілів', '   '],
] as const) {
  test(`синтетичний: MMSI ${label} → позиція відкинута`, () => {
    expect(vesselFromPositionReport(synthetic({ MMSI: mmsi }))).toBeNull();
  });
}

test('синтетичний: MMSI рядком → той самий рядок', () => {
  expect(vesselFromPositionReport(synthetic({ MMSI: '210385000' }))?.id).toBe('210385000');
});

for (const [label, time] of [
  ['сміття', 'not a time'],
  ['порожній', ''],
  ['з хвостом', '2026-09-25 17:33:56.513832924 +0000 UTC garbage'],
  ['неіснуюча дата 30 лютого', '2026-02-30 12:00:00 +0000 UTC'],
  ['відсутній', undefined],
] as const) {
  test(`синтетичний: час ${label} → позиція відкинута`, () => {
    expect(vesselFromPositionReport(synthetic({ time_utc: time }))).toBeNull();
  });
}

test('SubscriptionConfirmation → null', () => {
  expect(vesselFromPositionReport({ MessageType: 'SubscriptionConfirmation' })).toBeNull();
});

test('не об\'єкт → null', () => {
  expect(vesselFromPositionReport(null)).toBeNull();
  expect(vesselFromPositionReport('PositionReport')).toBeNull();
});

test('parseAisTimeUtc: наносекунди обрізаються до мілісекунд, не округлюються', () => {
  expect(parseAisTimeUtc('2026-09-25 17:33:56.513832924 +0000 UTC')).toBe('2026-09-25T17:33:56.513Z');
  expect(parseAisTimeUtc('2026-09-25 17:33:56.999999999 +0000 UTC')).toBe('2026-09-25T17:33:56.999Z');
});

test('parseAisTimeUtc: без дробу і з коротким дробом', () => {
  expect(parseAisTimeUtc('2026-01-01 12:00:00 +0000 UTC')).toBe('2026-01-01T12:00:00.000Z');
  expect(parseAisTimeUtc('2026-01-01 12:00:00.5 +0000 UTC')).toBe('2026-01-01T12:00:00.500Z');
});

test('parseAisTimeUtc: числовий зсув застосовується (Date.parse його ігнорує)', () => {
  expect(parseAisTimeUtc('2026-01-01 13:00:00 +0100 CET')).toBe('2026-01-01T12:00:00.000Z');
  expect(parseAisTimeUtc('2026-01-01 07:00:00 -0500 EST')).toBe('2026-01-01T12:00:00.000Z');
});
