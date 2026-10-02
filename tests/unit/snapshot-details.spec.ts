import { test, expect } from '@playwright/test';

import { diagnosticsLine, windowLabel, windowValueText } from '@/_pages/home/lib/snapshot-details';

// Тексти панелі налаштувань і блоку «Докладно» — специфікація 2026-09-29
// §5.1, §5.4. Очікування — літерали.

test('мітки вікна: до хвилини — секунди, далі — хвилини', () => {
  expect([15, 30, 60, 120, 180, 240, 300].map(windowLabel))
    .toEqual(['15 с', '30 с', '60 с', '2 хв', '3 хв', '4 хв', '5 хв']);
});

test('aria-valuetext з українськими відмінками', () => {
  expect([15, 30, 60, 120, 180, 240, 300].map(windowValueText)).toEqual([
    '15 секунд', '30 секунд', '60 секунд', '2 хвилини', '3 хвилини', '4 хвилини', '5 хвилин',
  ]);
});

test('діагностика успіху', () => {
  expect(diagnosticsLine(
    { connectMs: 213, messages: 11, rejected: 0, byType: { PositionReport: 11 } }, 4,
  )).toBe("з'єднання: 0,2 с · повідомлень: 11 (PositionReport: 11) · відкинуто: 0 · суден: 4");
});

test('кілька типів — у сталому порядку, other останнім', () => {
  expect(diagnosticsLine(
    { connectMs: 1500, messages: 6, rejected: 1, byType: { other: 1, StandardClassBPositionReport: 2, PositionReport: 3 } }, 5,
  )).toBe("з'єднання: 1,5 с · повідомлень: 6 (PositionReport: 3, StandardClassBPositionReport: 2, інші: 1) · відкинуто: 1 · суден: 5");
});

test('помилка: без суден; з\'єднання не відкрите; повідомлень 0 — без дужок', () => {
  expect(diagnosticsLine({ connectMs: null, messages: 0, rejected: 0, byType: {} }, null))
    .toBe("з'єднання: не відкрито · повідомлень: 0 · відкинуто: 0");
});
