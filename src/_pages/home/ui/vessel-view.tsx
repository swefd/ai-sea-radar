'use client';

import { useState } from 'react';

import { DEMO_VESSELS } from '@/entities/vessel';

import { DoverStraitMap } from './dover-strait-map';
import { VesselPanel } from './vessel-panel';

// Єдиний власник вибору. Клієнтська межа піднята рівно сюди, а не на всю
// сторінку: `home-page.tsx` лишається серверним, бо стану він не потребує.
//
// Компонент рендериться і на сервері (клієнтський ≠ виключений із SSR), тож
// початковий вибір — `null`, а в завжди видимій частині панелі немає нічого,
// похідного від часу: інакше годинник складальної машини запікся б у HTML
// і дав розбіжність при гідратації.
export function VesselView() {
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);

  // У стані лежить тільки id, ніколи копія судна: і карта, і картка беруть
  // судно з того самого масиву. Саме це робить вимогу «карта й картка читають
  // з одного стану» структурною, а не декларативною, і саме це зробить
  // оновлення картки на тіку B-06 безкоштовним.
  const selectedVessel =
    DEMO_VESSELS.find((vessel) => vessel.id === selectedVesselId) ?? null;

  return (
    <>
      <DoverStraitMap
        vessels={DEMO_VESSELS}
        selectedVesselId={selectedVesselId}
        // Сетер передається напряму, тож вибір — присвоєння, а не перемикач:
        // повторний клік по тому самому судну записує той самий id, `find`
        // повертає те саме судно, і картка не закривається. Гарантія тут
        // саме в цьому, а не в тому, що React пропустить ререндер.
        onSelectVessel={setSelectedVesselId}
      />
      <VesselPanel vessel={selectedVessel} />
    </>
  );
}
