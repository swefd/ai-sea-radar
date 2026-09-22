import { test, expect } from '@playwright/test';

import {
  readApiKey,
  AISSTREAM_ENDPOINT,
  SNAPSHOT_WINDOW_SECONDS,
  SNAPSHOT_VESSEL_LIMIT,
} from '@/shared/config';

// Модуль бере оточення ПАРАМЕТРОМ, а не читає process.env всередині. Інакше
// тест мусив би мутувати process.env — глобальний стан, який тече між тестами
// одного процесу й робить порядок їх запуску значущим.

test('без змінної — missing, і жодного винятку', () => {
  // Дослівний критерій B-08: «модуль повертає "ключ відсутній" без винятку».
  expect(readApiKey({})).toEqual({ status: 'missing' });
});

test('порожній рядок і пробіли — теж missing', () => {
  // AISSTREAM_API_KEY= у .env.local (скопійований .env.example) дає саме
  // порожній рядок, а не undefined. Наївна перевірка `if (key === undefined)`
  // пропустила б його далі й відкрила сокет із порожнім ключем.
  expect(readApiKey({ AISSTREAM_API_KEY: '' })).toEqual({ status: 'missing' });
  expect(readApiKey({ AISSTREAM_API_KEY: '   ' })).toEqual({ status: 'missing' });
  expect(readApiKey({ AISSTREAM_API_KEY: '\t\n' })).toEqual({ status: 'missing' });
});

test('значення — present, із обрізаними краями', () => {
  expect(readApiKey({ AISSTREAM_API_KEY: 'EXAMPLE-KEY-VALUE' }))
    .toEqual({ status: 'present', apiKey: 'EXAMPLE-KEY-VALUE' });

  // Краї обрізаються: ключ, скопійований із листа, часто приносить із собою
  // пробіл або перенесення рядка, і джерело відкинуло б його як невірний.
  expect(readApiKey({ AISSTREAM_API_KEY: '  EXAMPLE-KEY-VALUE\n' }))
    .toEqual({ status: 'present', apiKey: 'EXAMPLE-KEY-VALUE' });
});

test('юніон розрізняє стани полем status, а не порожнечею рядка', () => {
  // Несуче твердження форми типу: 'missing' НЕ має поля apiKey взагалі, тож
  // споживач не може випадково прочитати з нього порожній рядок і піти далі.
  const missing = readApiKey({});
  expect(missing.status).toBe('missing');
  expect('apiKey' in missing).toBe(false);
});

test('константи вікна — узгоджені значення SPRINT-02, в одному місці', () => {
  expect(AISSTREAM_ENDPOINT).toBe('wss://stream.aisstream.io/v0/stream');
  expect(SNAPSHOT_WINDOW_SECONDS).toBe(15);
  expect(SNAPSHOT_VESSEL_LIMIT).toBe(100);
});
