'use client';

import { useEffect } from 'react';

import { OSM_TILE_LAYER } from '@/shared/config';

import { TILE_SW_SCOPE, tileServiceWorkerUrl } from './tile-sw-url';

/**
 * Реєструє service worker кешу тайлів один раз і нічого не рендерить.
 *
 * Невдача не ламає сторінку: карта працює як без кешу (спека §6). Тому лише
 * `console.warn`, а на екрані нічого.
 */
export function RegisterTileCache() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker
      .register(tileServiceWorkerUrl(OSM_TILE_LAYER.urlTemplate), {
        type: 'module',
        scope: TILE_SW_SCOPE,
      })
      .catch((error: unknown) => {
        console.warn('Кеш тайлів недоступний: карта працюватиме лише з мережею.', error);
      });
  }, []);

  return null;
}
