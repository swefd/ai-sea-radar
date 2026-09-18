import { SOURCE_LABELS, type Vessel } from '@/entities/vessel';
import { VesselCard } from '@/entities/vessel/ui/vessel-card';

import styles from './vessel-panel.module.css';

interface VesselPanelProps {
  readonly vessel: Vessel | null;
}

// Порядок згори вниз зафіксований у ТЗ: кнопка, підпис джерела, картка. Перше
// місце цього тижня порожнє, і саме порожнє: заглушка була б кодом, якого ніхто
// не замовляв, а порядок вона тримає й так.
export function VesselPanel({ vessel }: VesselPanelProps) {
  return (
    <aside className={styles.panel}>
      {/* місце під кнопку */}
      <p className={styles.source}>{SOURCE_LABELS.demo}</p>
      {vessel !== null && <VesselCard vessel={vessel} />}
    </aside>
  );
}
