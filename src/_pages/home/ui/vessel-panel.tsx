// Панель ширяє над картою й може згортатися. Стан згортання — ВЛАСНИЙ стан
// панелі, а не піднятий у `VesselView`: від нього не залежить ні карта, ні
// вибір судна, тож піднімати його означало б ганяти зайві ререндери власника
// таймера на кожне натискання.
//
// Директива тут потрібна саме через цей стан. Сусідній `vessel-card.tsx`
// свідомо лишається без неї (хуків не має), і це не розбіжність: межу
// проводить той файл, якому вона справді потрібна.
//
// ПРОЗА ЖИВЕ НАД РОЗМІТКОЮ, А НЕ ВСЕРЕДИНІ НЕЇ, і це не стиль. Багаторядковий
// коментар виду `{/* … */}` робить сліпою позицію периметра: оракул тесту
// `no-ref-imports.spec.ts` рахує коментарем лише рядок, що починається з `//`,
// `*` або `/*`, а рядок `{/*` під це не підпадає — тож продовження такого
// коментаря він оголошує живим кодом, у якому сканер порушення не бачить.
// Та сама угода записана у `vessel-card.tsx`; тут вона коштувала двох сліпих
// позицій і червоного юніт-рядка, перш ніж її дотримали.
'use client';

import { useState } from 'react';

import { SOURCE_LABELS, type Vessel } from '@/entities/vessel';
import { VesselCard } from '@/entities/vessel/ui/vessel-card';

import styles from './vessel-panel.module.css';

interface VesselPanelProps {
  readonly vessel: Vessel | null;
}

/**
 * Шеврон. Інлайновий SVG, а не символ шрифту: гліф залежав би від того, що
 * встановлено в системі, а `currentColor` дає керування кольором із CSS.
 *
 * `aria-hidden`, бо значення несе текст кнопки — інакше читач екрана прочитав
 * би ту саму дію двічі.
 */
function ChevronIcon({ pointsUp }: { readonly pointsUp: boolean }) {
  return (
    <svg
      className={styles.chevron}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={pointsUp ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
    </svg>
  );
}

// Порядок згори вниз зафіксований у ТЗ: кнопка, підпис джерела, картка. Перше
// місце цього тижня порожнє, і саме порожнє: заглушка була б кодом, якого ніхто
// не замовляв, а порядок вона тримає й так.
//
// Кнопка згортання того місця НЕ ЗАЙМАЄ і зайняти не може: вона живе в шапці
// панелі, поруч із підписом джерела, тобто поза колонкою вмісту, де стоятиме
// «Завантажити справжні позиції» з B-13.
//
// ЩО ТРИМАЄ РОЗМІТКА НИЖЧЕ, згори вниз:
//
// `.aurora` — сяйво під склом окремим вузлом. Власним тлом панелі воно бути не
// може: `backdrop-filter` розмиває те, що ПОЗАДУ елемента, і градієнт самої
// панелі він не зачепив би.
//
// `.source` — підпис джерела, видимий ЗАВЖДИ, у тому числі згорнутою панеллю.
// US-06 вимагає, щоб на екрані було написано, які саме дані показано, тому
// згортання ховає вміст, а не панель цілком: інакше вимога зникала б разом
// із нею.
//
// `.body` — вміст, що лишається в DOM і згорнутою панеллю; ховає його CSS.
// Умовний рендер скидав би позицію прокручування картки на кожне згортання, а
// доказу більше не давав би: `inert` знімає вміст і з фокуса, і з дерева
// доступності, тобто з погляду клавіатури та читача екрана його немає.
export function VesselPanel({ vessel }: VesselPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.aurora} aria-hidden="true" />

      <div className={styles.header}>
        <p className={styles.source}>{SOURCE_LABELS.demo}</p>

        <button
          type="button"
          className={styles.toggle}
          onClick={() => setCollapsed((previous) => !previous)}
          aria-expanded={!collapsed}
          aria-controls="vessel-panel-body"
        >
          <ChevronIcon pointsUp={!collapsed} />
          <span className={styles.toggleLabel}>{collapsed ? 'Показати' : 'Згорнути'}</span>
        </button>
      </div>

      <div className={styles.body} id="vessel-panel-body" inert={collapsed}>
        {/* місце під кнопку */}
        {vessel !== null && <VesselCard vessel={vessel} />}
      </div>
    </aside>
  );
}
