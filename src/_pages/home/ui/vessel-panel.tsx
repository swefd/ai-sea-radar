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

import type { Vessel } from '@/entities/vessel';
import { VesselCard } from '@/entities/vessel/ui/vessel-card';

import styles from './vessel-panel.module.css';

// Панель нічого не вирішує про дані: підпис, рядок спроби й стан кнопки
// приходять готовими від `VesselView`, єдиного власника обох станів R4. Тут
// лише розкладка й власний стан згортання.
interface VesselPanelProps {
  readonly vessel: Vessel | null;
  /** Що зараз на карті — підпис показаного набору (CR :23). */
  readonly caption: string;
  /** Результат останньої спроби (CR :25…:28); `null` — натискань ще не було. */
  readonly attempt: string | null;
  /** Триває збір: кнопка заблокована, удруге натиснути не можна (SPRINT-02:11). */
  readonly loading: boolean;
  readonly onLoad: () => void;
}

const LOAD_BUTTON_LABEL = 'Завантажити справжні позиції';

// Постійна підказка, CR :32 дослівно: набір живе лише в пам'яті сторінки, і
// людина має знати це ДО того, як оновить її посеред заняття.
const RELOAD_HINT = 'Після оновлення сторінки знову показуються демонстраційні дані';

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

// Порядок згори вниз зафіксований у CR :34: кнопка, підпис джерела, рядок
// результату спроби, підказка, картка.
//
// Кнопка згортання місця кнопки завантаження НЕ ЗАЙМАЄ: вона живе в шапці
// панелі, поруч із підписом, а «Завантажити справжні позиції» стоїть окремим
// рядком НАД шапкою (рішення плану SPRINT-03 «Panel order»).
//
// ЩО ТРИМАЄ РОЗМІТКА НИЖЧЕ, згори вниз:
//
// `.aurora` — сяйво під склом окремим вузлом. Власним тлом панелі воно бути не
// може: `backdrop-filter` розмиває те, що ПОЗАДУ елемента, і градієнт самої
// панелі він не зачепив би.
//
// `.actions` — кнопка завантаження. Поза `.body`, тож видима й згорнутою
// панеллю: єдина дія застосунку не має ховатися за іншою кнопкою. `disabled`
// у `loading` — це і є «удруге натиснути не можна» з SPRINT-02:11.
//
// `.source` — підпис стану, видимий ЗАВЖДИ, у тому числі згорнутою панеллю.
// US-06 вимагає, щоб на екрані було написано, які саме дані показано, тому
// згортання ховає вміст, а не панель цілком: інакше вимога зникала б разом
// із нею.
//
// `.attempt` — рядок результату останньої спроби, `role="status"`, щоб читач
// екрана оголосив результат, якого людина чекала. Стоїть одразу під шапкою й
// поза `.body` з тієї ж причини, що й підпис: збій більше не стирає карту
// (CR :27), і без цього рядка людина не дізналася б, що спроба не вдалася.
// Рендериться лише після першого натискання (CR :25) — порожній вузол зі
// статусом був би шумом.
//
// `.hint` — постійна підказка про оновлення сторінки (CR :32), теж поза
// `.body`: «постійна» означає видима й згорнутою панеллю.
//
// `.body` — вміст, що лишається в DOM і згорнутою панеллю; ховає його CSS.
// Умовний рендер скидав би позицію прокручування картки на кожне згортання, а
// доказу більше не давав би: `inert` знімає вміст і з фокуса, і з дерева
// доступності, тобто з погляду клавіатури та читача екрана його немає.
export function VesselPanel({ vessel, caption, attempt, loading, onLoad }: VesselPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.aurora} aria-hidden="true" />

      <div className={styles.actions}>
        <button type="button" className={styles.load} onClick={onLoad} disabled={loading}>
          {LOAD_BUTTON_LABEL}
        </button>
      </div>

      <div className={styles.header}>
        <p className={styles.source}>{caption}</p>

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

      {attempt !== null && (
        <p className={styles.attempt} role="status">
          {attempt}
        </p>
      )}

      <p className={styles.hint}>{RELOAD_HINT}</p>

      <div className={styles.body} id="vessel-panel-body" inert={collapsed}>
        {vessel !== null && <VesselCard vessel={vessel} />}
      </div>
    </aside>
  );
}
