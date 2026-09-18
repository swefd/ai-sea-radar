'use client';

import { useEffect, useRef } from 'react';
import * as L from 'leaflet';

import { INITIAL_VIEW, OSM_TILE_LAYER } from '@/shared/config';
import type { Vessel } from '@/entities/vessel';

import 'leaflet/dist/leaflet.css';
// Порядок цих двох імпортів — не стиль. `leaflet.css` задає
// `.leaflet-marker-icon` позиціювання специфічністю одного класу, рівно такою
// ж, як у будь-якого класу CSS-модуля, тож виграє аркуш, що прийшов пізніше.
// Значок тягне свій модуль за собою, і тягнути його треба саме тут, зсередини
// `ssr:false`-піддерева: досяжний із серверного графа, він потрапив би в
// `<head>` раніше за `leaflet.css`, і Leaflet мовчки перекрив би позиціювання.
import {
  createVesselIcon,
  updateVesselIcon,
} from '@/entities/vessel/ui/vessel-icon';
import styles from './leaflet-map.module.css';

export interface LeafletMapProps {
  readonly vessels: readonly Vessel[];
  readonly selectedVesselId: string | null;
  readonly onSelectVessel: (vesselId: string) => void;
}

// Реєстр тримає і маркер, і наш дочірній вузол значка: корінь маркера належить
// Leaflet (він пише туди `transform` на кожен зум), а все наше — на дитині.
interface VesselMarker {
  readonly marker: L.Marker;
  readonly element: HTMLElement;
}

export function LeafletMap({
  vessels,
  selectedVesselId,
  onSelectVessel,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const registryRef = useRef<Map<string, VesselMarker>>(new Map());
  const onSelectVesselRef = useRef(onSelectVessel);

  // Колбек живе в ref, щоб його ідентичність не потрапила в залежності ефекту
  // маркерів: інакше кожен ререндер батька перебудовував би весь реєстр.
  useEffect(() => {
    onSelectVesselRef.current = onSelectVessel;
  }, [onSelectVessel]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      // Гілка існує лише щоб задовольнити strict: ref заповнений до ефекту.
      return;
    }

    const map = L.map(container).setView(
      [INITIAL_VIEW.center.lat, INITIAL_VIEW.center.lon],
      INITIAL_VIEW.zoom,
    );

    L.tileLayer(OSM_TILE_LAYER.urlTemplate, {
      attribution: OSM_TILE_LAYER.attribution,
    }).addTo(map);

    mapRef.current = map;
    const registry = registryRef.current;

    return () => {
      // `map.remove()` сам обходить свої шари й кличе `.remove()` на кожному,
      // тобто маркери прибирає карта. Реєстр чистить той, хто карту створив:
      // пережити карту, на яку він вказує, реєстр не може за побудовою.
      map.remove();
      mapRef.current = null;
      registry.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }

    const registry = registryRef.current;

    for (const vessel of vessels) {
      const selected = vessel.id === selectedVesselId;
      const existing = registry.get(vessel.id);

      if (existing === undefined) {
        const { icon, element } = createVesselIcon(vessel, selected);
        const marker = L.marker([vessel.lat, vessel.lon], { icon }).addTo(map);

        // Замикаємося на рядковому id, а не на об'єкті судна: об'єкт застаріє
        // з першим же тіком B-06, id — ні. Обробник вішається один раз, при
        // створенні маркера, і більше не перевішується.
        const vesselId = vessel.id;
        marker.on('click', () => {
          onSelectVesselRef.current(vesselId);
        });

        registry.set(vesselId, { marker, element });
        continue;
      }

      // Рівно дві дії: Leaflet пише `transform` кореня, ми — свій дочірній
      // вузол. Два `transform` не сперечаються, бо живуть на різних вузлах.
      // Маркер не перестворюється, тож вузол під курсором переживає оновлення
      // і клік не губиться.
      existing.marker.setLatLng([vessel.lat, vessel.lon]);
      updateVesselIcon(existing.element, vessel, selected);
    }

    const liveIds = new Set(vessels.map((vessel) => vessel.id));
    for (const [vesselId, entry] of registry) {
      if (!liveIds.has(vesselId)) {
        entry.marker.remove();
        registry.delete(vesselId);
      }
    }

    // Прибирання в цього ефекту немає свідомо: маркери валить `map.remove()`
    // з ефекту вище, і питання про порядок прибирання двох ефектів одного
    // компонента цим знімається, а не вирішується.
  }, [vessels, selectedVesselId]);

  return <div ref={containerRef} className={styles.map} />;
}
