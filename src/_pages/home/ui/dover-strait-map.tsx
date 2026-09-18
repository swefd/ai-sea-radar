'use client';

import dynamic from 'next/dynamic';

import type { LeafletMapProps } from './leaflet-map';

// Leaflet звертається до `document` під час обчислення модуля, тому модуль
// карти не має потрапляти в серверний рендеринг. `ssr: false` дозволений
// лише в клієнтських компонентах — звідси цей посередник.
//
// Тип пропсів береться `import type`, тобто стирається компілятором і модуль
// карти за собою не тягне; межа `ssr: false` лишається цілою.
const LeafletMap = dynamic(
  () => import('./leaflet-map').then((module) => module.LeafletMap),
  { ssr: false },
);

// Обидва файли клієнтські, тож це звичайна клієнт-клієнтська межа: колбек
// проходить як є, обмежень серіалізації тут немає. Межа RSC лежить на рівень
// вище, між серверною сторінкою і власником стану, і через неї не передається
// нічого.
export function DoverStraitMap(props: LeafletMapProps) {
  return <LeafletMap {...props} />;
}
