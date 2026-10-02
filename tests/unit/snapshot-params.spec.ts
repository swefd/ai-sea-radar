import { test, expect } from '@playwright/test';

import { parseSnapshotParams } from '@/_app/api-routes/snapshot-params';

// Білий список параметрів знімка — специфікація 2026-09-29 §3.1. Будь-що поза
// ним — null, і обробник відповідає 400 до читання ключа й до мережі.

const parse = (query: string) => parseSnapshotParams(new URLSearchParams(query));

test('без параметрів — типові 15 с і без класу B (поведінка R2)', () => {
  expect(parse('')).toEqual({ windowSeconds: 15, includeClassB: false });
});

for (const seconds of [15, 30, 60, 120, 180, 240, 300]) {
  test(`window=${seconds} приймається`, () => {
    expect(parse(`window=${seconds}`)).toEqual({ windowSeconds: seconds, includeClassB: false });
  });
}

test('classB=1 і classB=0', () => {
  expect(parse('classB=1')).toEqual({ windowSeconds: 15, includeClassB: true });
  expect(parse('window=60&classB=0')).toEqual({ windowSeconds: 60, includeClassB: false });
});

for (const query of [
  'window=14', 'window=16', 'window=99999', 'window=abc', 'window=',
  'window=015', 'window=+15', 'window=%2015', 'window=15.0', 'window=15&window=30',
  'classB=2', 'classB=true', 'classB=', 'classB=1&classB=1',
]) {
  test(`відмова: ${query}`, () => {
    expect(parse(query)).toBeNull();
  });
}

test('невідомі параметри ігноруються', () => {
  expect(parse('foo=bar&window=30')).toEqual({ windowSeconds: 30, includeClassB: false });
});
