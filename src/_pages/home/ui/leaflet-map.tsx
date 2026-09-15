'use client';

import { useEffect, useRef } from 'react';
import * as L from 'leaflet';

import { INITIAL_VIEW, OSM_TILE_LAYER } from '@/shared/config';

import 'leaflet/dist/leaflet.css';
import styles from './leaflet-map.module.css';

export function LeafletMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const map = L.map(container).setView(
      [INITIAL_VIEW.center.lat, INITIAL_VIEW.center.lon],
      INITIAL_VIEW.zoom,
    );

    L.tileLayer(OSM_TILE_LAYER.urlTemplate, {
      attribution: OSM_TILE_LAYER.attribution,
    }).addTo(map);

    return () => {
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className={styles.map} />;
}
