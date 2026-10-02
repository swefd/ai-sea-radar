import { test, expect } from '@playwright/test';

import { snapshotCaption } from '@/_pages/home/lib/snapshot-caption';

// Підпис знімка, SPRINT-02:33. Очікування — літерали з завдання.

const BASE = {
  ok: true as const,
  vessels: [],
  collectedAt: '2026-01-01T12:00:00.000Z',
  windowSeconds: 15,
  count: 3,
  truncated: false,
  reason: 'window_elapsed' as const,
  includeClassB: false,
  diagnostics: { connectMs: 0, messages: 0, rejected: 0, byType: {} },
};

test('успіх: підпис дослівно', () => {
  expect(snapshotCaption(BASE)).toBe(
    'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 3 · вибірка неповна',
  );
});

test('порожній успіх: суден 0', () => {
  expect(snapshotCaption({ ...BASE, count: 0 })).toBe(
    'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 0 · вибірка неповна',
  );
});

test('ліміт: хвіст " · зупинено на ліміті 100"', () => {
  expect(snapshotCaption({ ...BASE, count: 100, truncated: true, reason: 'limit_reached' })).toBe(
    'AISStream · знімок за 15 с · отримано 12:00:00 UTC · суден: 100 · вибірка неповна · зупинено на ліміті 100',
  );
});
