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

import { useState, type MouseEvent } from 'react';

import type { Vessel } from '@/entities/vessel';
import { VesselCard } from '@/entities/vessel/ui/vessel-card';

import styles from './vessel-panel.module.css';

// Панель нічого не вирішує про дані: підпис, пояснення й стан кнопки приходять
// готовими від `VesselView`, єдиного власника стану спроби. Тут лише розкладка
// й власний стан згортання.
interface VesselPanelProps {
  readonly vessel: Vessel | null;
  /** Що зараз на карті — підпис стану, SPRINT-02:30…:35. */
  readonly caption: string;
  /** Пояснення для порожнього успіху й помилки; `null` — пояснювати нічого. */
  readonly notice: string | null;
  /** Триває збір: замість кнопки завантаження — «Скасувати» (специфікація 2026-09-29 §5.1). */
  readonly loading: boolean;
  readonly onLoad: () => void;
  /** Обриває поточну спробу; кнопка є лише в loading. */
  readonly onCancel: () => void;
}

const LOAD_BUTTON_LABEL = 'Завантажити справжні позиції';
const CANCEL_BUTTON_LABEL = 'Скасувати';

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

// Порядок згори вниз зафіксований у ТЗ: кнопка, підпис джерела, картка.
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
// панеллю: єдина дія застосунку не має ховатися за іншою кнопкою. У `loading`
// та сама кнопка стає «Скасувати» — рішення власника 2026-10-02, що замінило
// `disabled` з SPRINT-02:11: удруге завантажити не можна, бо такої кнопки
// зараз немає. Елемент DOM один і той самий, тож фокус клавіатури на ньому
// лишається. Другий клік подвійного кліку (`detail > 1`) влучає вже в
// «Скасувати» — його відкинуто, інакше подвійний клік обривав би власну спробу.
//
// `.source` — підпис стану, видимий ЗАВЖДИ, у тому числі згорнутою панеллю.
// US-06 вимагає, щоб на екрані було написано, які саме дані показано, тому
// згортання ховає вміст, а не панель цілком: інакше вимога зникала б разом
// із нею.
//
// `.notice` — пояснення порожнього успіху чи помилки, `role="status"`, щоб
// читач екрана оголосив результат спроби, якої людина чекала. Стоїть одразу
// під шапкою й поза `.body` з тієї ж причини, що й підпис: без нього
// «суден: 0» і «Даних на карті немає» лишилися б без причини. Рендериться
// лише коли є що сказати — порожній вузол зі статусом був би шумом.
//
// `.body` — вміст, що лишається в DOM і згорнутою панеллю; ховає його CSS.
// Умовний рендер скидав би позицію прокручування картки на кожне згортання, а
// доказу більше не давав би: `inert` знімає вміст і з фокуса, і з дерева
// доступності, тобто з погляду клавіатури та читача екрана його немає.
export function VesselPanel({ vessel, caption, notice, loading, onLoad, onCancel }: VesselPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  function handleCancelClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail > 1) return;
    onCancel();
  }

  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.aurora} aria-hidden="true" />

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.load} ${loading ? styles.cancel : ''}`}
          onClick={loading ? handleCancelClick : onLoad}
        >
          {loading ? CANCEL_BUTTON_LABEL : LOAD_BUTTON_LABEL}
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

      {notice !== null && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.body} id="vessel-panel-body" inert={collapsed}>
        {vessel !== null && <VesselCard vessel={vessel} />}
      </div>
    </aside>
  );
}
