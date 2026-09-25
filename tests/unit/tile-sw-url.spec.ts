import { test, expect } from '@playwright/test';

import { OSM_TILE_LAYER } from '@/shared/config';
import { TILE_SW_SCOPE, tileServiceWorkerUrl } from '@/_app/tile-cache/tile-sw-url';

// Синтетичний шаблон, а не OSM: тест доводить, що хост ВИВОДИТЬСЯ з шаблону,
// а не вписаний у функцію. З OSM-шаблоном обидва варіанти зеленіли б однаково.
test('хост у адресі SW виводиться з шаблону тайлів', () => {
  expect(tileServiceWorkerUrl('https://tiles.example.test/{z}/{x}/{y}.png')).toBe(
    '/tile-sw.js?host=tiles.example.test',
  );
});

test('шаблон зі схемою й портом дає лише hostname', () => {
  expect(tileServiceWorkerUrl('http://tiles.example.test:8080/{z}/{x}/{y}.png')).toBe(
    '/tile-sw.js?host=tiles.example.test',
  );
});

// SW мусить лежати в корені: область дії за замовчуванням — тека скрипта, і
// `/tile-sw/tile-sw.js` не контролював би сторінку `/` (спека §4.3).
test('SW у корені й обслуговує весь origin', () => {
  const url = tileServiceWorkerUrl(OSM_TILE_LAYER.urlTemplate);
  expect(new URL(url, 'http://127.0.0.1:3000').pathname).toBe('/tile-sw.js');
  expect(TILE_SW_SCOPE).toBe('/');
});

test('узгоджений шаблон дає узгоджений хост', () => {
  expect(tileServiceWorkerUrl(OSM_TILE_LAYER.urlTemplate)).toBe(
    `/tile-sw.js?host=${new URL(OSM_TILE_LAYER.urlTemplate).hostname}`,
  );
});
