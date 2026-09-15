'use client';

import dynamic from 'next/dynamic';

// Leaflet звертається до `document` під час обчислення модуля, тому модуль
// карти не має потрапляти в серверний рендеринг. `ssr: false` дозволений
// лише в клієнтських компонентах — звідси цей посередник.
const LeafletMap = dynamic(
  () => import('./leaflet-map').then((module) => module.LeafletMap),
  { ssr: false },
);

export function DoverStraitMap() {
  return <LeafletMap />;
}
