import { VesselView } from './vessel-view';
import styles from './home-page.module.css';

// Компонент лишається серверним: стану він не потребує, а власник вибору —
// `VesselView` — сам бере демонстраційні дані й сам розкладає карту й панель
// прямими дітьми `.page`, тож розкладка сторінки не змінюється.
export function HomePage() {
  return (
    <main className={styles.page}>
      <VesselView />
    </main>
  );
}
