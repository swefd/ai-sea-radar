import { DoverStraitMap } from './dover-strait-map';
import styles from './home-page.module.css';

export function HomePage() {
  return (
    <main className={styles.page}>
      <DoverStraitMap />
    </main>
  );
}
