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

import { Fragment, useEffect, useState, type MouseEvent } from 'react';

import type { Vessel } from '@/entities/vessel';
import { VesselCard } from '@/entities/vessel/ui/vessel-card';
import { SNAPSHOT_WINDOW_OPTIONS, type SnapshotSettings } from '@/shared/config';

import { progressLabel, windowLabel, windowValueText } from '../lib/snapshot-details';

import styles from './vessel-panel.module.css';

// Панель нічого не вирішує про дані: підпис, рядок спроби й стан кнопки
// приходять готовими від `VesselView`, єдиного власника обох станів R4. Тут
// лише розкладка й власний стан згортання.
interface VesselPanelProps {
  readonly vessel: Vessel | null;
  /** Що зараз на карті — підпис показаного набору (SPRINT-03b:23). */
  readonly caption: string;
  /** Результат останньої спроби (SPRINT-03b:25…:28); `null` — натискань ще не було. */
  readonly attempt: string | null;
  /** Триває збір: замість кнопки завантаження — «Скасувати» (специфікація 2026-09-29 §5.1). */
  readonly loading: boolean;
  readonly onLoad: () => void;
  /** Обриває поточну спробу; кнопка є лише в loading. */
  readonly onCancel: () => void;
  /** Налаштування наступної спроби — стан `VesselView`, тут лише показ. */
  readonly settings: SnapshotSettings;
  readonly onSettingsChange: (next: SnapshotSettings) => void;
  /** Рядок діагностики для «Докладно»; `null` — блоку немає. */
  readonly details: string | null;
}

const LOAD_BUTTON_LABEL = 'Завантажити справжні позиції';
const CANCEL_BUTTON_LABEL = 'Скасувати';

// Постійна підказка, SPRINT-03b:32 дослівно: набір живе лише в пам'яті
// сторінки, і людина має знати це ДО того, як оновить її посеред заняття.
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

/** Крок оновлення смуги. Чверть секунди — досить, щоб лічильник цілих секунд
 * не запізнювався помітно, і замало, щоб ганяти рендер без потреби. */
const PROGRESS_TICK_MS = 250;

/**
 * Смуга збору з лічильником секунд. Відлік — браузерний годинник від монтування,
 * тобто від натискання: сервер свого прогресу не шле, тож це оцінка за
 * вибраним вікном, а не стан збору. Компонент живе лише в `loading`, тому
 * таймер з'являється з натисканням і зникає з відповіддю чи «Скасувати»:
 * демонстраційного руху й `page.clock` тестів руху він не торкається.
 */
function CollectProgress({ windowSeconds }: { readonly windowSeconds: number }) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const elapsedMs = now - startedAt;
  const label = progressLabel(elapsedMs, windowSeconds);
  const fraction = Math.min(elapsedMs / (windowSeconds * 1000), 1);

  return (
    <div className={styles.progress}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Збір позицій"
        aria-valuemin={0}
        aria-valuemax={windowSeconds}
        aria-valuenow={Math.min(Math.floor(elapsedMs / 1000), windowSeconds)}
        aria-valuetext={label}
      >
        <span className={styles.fill} style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className={styles.progressText}>
        <span>Збір позицій…</span>
        <span>{label}</span>
      </p>
    </div>
  );
}

/**
 * Підпис джерела, що переноситься лише МІЖ сегментами « · », а не посеред
 * «12:00:00 UTC». Розділювач іде в кінець попереднього сегмента, щоб рядок не
 * починався з крапки, а пробіл — поза сегментом, де він і є місцем переносу.
 * Текст абзацу лишається тим самим рядком, тож тести, що шукають підпис
 * точним збігом, його знаходять.
 */
function Caption({ text }: { readonly text: string }) {
  const segments = text.split(' · ');
  const last = segments.length - 1;
  return (
    <p className={styles.source}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          <span className={styles.segment}>{index < last ? `${segment} ·` : segment}</span>
          {index < last ? ' ' : null}
        </Fragment>
      ))}
    </p>
  );
}

// Порядок згори вниз зафіксований у SPRINT-03b:34: кнопка, підпис джерела,
// рядок результату спроби, підказка, картка. Панель поділена на три секції з
// власними заголовками, і цей порядок вони тримають.
//
// ЩО ТРИМАЄ РОЗМІТКА НИЖЧЕ, згори вниз:
//
// `.aurora` — сяйво під склом окремим вузлом. Власним тлом панелі воно бути не
// може: `backdrop-filter` розмиває те, що ПОЗАДУ елемента, і градієнт самої
// панелі він не зачепив би.
//
// «Новий знімок» — повзунок вікна й прапорець класу B, під ними кнопка: їх
// вибирають ДО натискання. `<fieldset disabled>` блокує обидва одним атрибутом
// під час збору. `aria-label` повзунка явний, бо видимий `<label>` містить
// змінне число, а тест і читач екрана шукають стале ім'я. Секція поза `.body`,
// тож видима й згорнутою панеллю: єдина дія застосунку не має ховатися за
// іншою кнопкою.
//
// Кнопка завантаження. У `loading` та сама кнопка стає «Скасувати» — рішення
// власника 2026-10-02, що замінило `disabled` з SPRINT-02:11: удруге
// завантажити не можна, бо такої кнопки зараз немає. Елемент DOM один і той
// самий, тож фокус клавіатури на ньому лишається. Другий клік подвійного кліку
// (`detail > 1`) влучає вже в «Скасувати» — його відкинуто, інакше подвійний
// клік обривав би власну спробу. Над нею в `loading` — смуга збору.
//
// «Дані на карті» — підпис стану, видимий ЗАВЖДИ, у тому числі згорнутою
// панеллю. US-06 вимагає, щоб на екрані було написано, які саме дані показано,
// тому згортання ховає вміст, а не панель цілком: інакше вимога зникала б разом
// із нею. Кнопка згортання — у заголовку цієї секції: вона ховає те, що нижче.
//
// `.attempt` — рядок результату останньої спроби, `role="status"`, щоб читач
// екрана оголосив результат, якого людина чекала. Поза `.body` з тієї ж
// причини, що й підпис: збій більше не стирає карту (SPRINT-03b:27), і без
// цього рядка людина не дізналася б, що спроба не вдалася. Рендериться лише
// після першого натискання (SPRINT-03b:25) — порожній вузол зі статусом був би
// шумом.
//
// `.hint` — постійна підказка про оновлення сторінки (SPRINT-03b:32), теж поза
// `.body`: «постійна» означає видима й згорнутою панеллю.
//
// `.body` — «Обране судно» і «Докладно» (закритий за замовчуванням,
// специфікація 2026-09-29 §5.4). Лишається в DOM і згорнутою панеллю; ховає
// його CSS. Умовний рендер скидав би позицію прокручування картки на кожне
// згортання, а доказу більше не давав би: `inert` знімає вміст і з фокуса, і з
// дерева доступності, тобто з погляду клавіатури та читача екрана його немає.
// Вміст `.body` стоїть без переносів між виразами — див. `.body:empty` у CSS.
export function VesselPanel({
  vessel,
  caption,
  attempt,
  loading,
  onLoad,
  onCancel,
  settings,
  onSettingsChange,
  details,
}: VesselPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  function handleCancelClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail > 1) return;
    onCancel();
  }

  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.aurora} aria-hidden="true" />

      <section className={styles.section}>
        <h2 className={styles.eyebrow}>Новий знімок</h2>

        <fieldset className={styles.settings} disabled={loading}>
          <label className={styles.settingRow} htmlFor="snapshot-window">
            <span>Вікно збору</span>
            <span className={styles.settingValue}>{windowLabel(settings.windowSeconds)}</span>
          </label>
          <input
            id="snapshot-window"
            className={styles.slider}
            type="range"
            min={0}
            max={SNAPSHOT_WINDOW_OPTIONS.length - 1}
            step={1}
            value={SNAPSHOT_WINDOW_OPTIONS.indexOf(settings.windowSeconds as (typeof SNAPSHOT_WINDOW_OPTIONS)[number])}
            aria-label="Вікно збору"
            aria-valuetext={windowValueText(settings.windowSeconds)}
            onChange={(event) =>
              onSettingsChange({ ...settings, windowSeconds: SNAPSHOT_WINDOW_OPTIONS[Number(event.target.value)] })
            }
          />
          <div className={styles.ticks} aria-hidden="true">
            {SNAPSHOT_WINDOW_OPTIONS.map((seconds) => (
              <span key={seconds}>{windowLabel(seconds)}</span>
            ))}
          </div>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={settings.includeClassB}
              onChange={(event) => onSettingsChange({ ...settings, includeClassB: event.target.checked })}
            />
            Малі судна (клас B)
          </label>
        </fieldset>

        {loading && <CollectProgress windowSeconds={settings.windowSeconds} />}

        <button
          type="button"
          className={`${styles.load} ${loading ? styles.cancel : ''}`}
          onClick={loading ? handleCancelClick : onLoad}
        >
          {loading ? CANCEL_BUTTON_LABEL : LOAD_BUTTON_LABEL}
        </button>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.eyebrow}>Дані на карті</h2>
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
        <Caption text={caption} />
        {attempt !== null && (
          <p className={styles.attempt} role="status">
            {attempt}
          </p>
        )}
        <p className={styles.hint}>{RELOAD_HINT}</p>
      </section>

      <div className={styles.body} id="vessel-panel-body" inert={collapsed}>{vessel !== null && (
        <section className={styles.cardSection}>
          <h2 className={styles.eyebrow}>Обране судно</h2>
          <VesselCard vessel={vessel} />
        </section>
      )}{details !== null && (
        <details className={styles.details}>
          <summary>Докладно</summary>
          <p>{details}</p>
        </details>
      )}</div>
    </aside>
  );
}
