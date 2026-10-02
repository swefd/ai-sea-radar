// Картка одного судна. Джерело: docs/tasks/SPRINT-01.md (B-04), US-04 у
// docs/tasks/PROJECT_BRIEF.md, проєктне рішення B-03/B-04 §3.5, §3.6 і §10.
//
// Директиви 'use client' тут свідомо немає. Компонент не має ні хуків, ні
// обробників подій, тож він SSR-безпечний, і §3.1 рішення називає його саме так:
// "клієнтський, але SSR-безпечний". Клієнтську межу проводить власник стану
// вибору вище по дереву; повторити її ще й тут означало б зафіксувати картку
// клієнтською без жодної причини з її боку.
//
// Другий вхід зрізу (@/entities/vessel/ui/vessel-card), а не реекспорт із
// index.ts: у ядро ходить і серверний граф, і юніт-раннер, а цей файл тягне
// CSS-модуль, на якому юніт-раннер дає ERR_UNKNOWN_FILE_EXTENSION.

import type { ReactElement } from 'react';

// Через публічний вхід ядра, а не відносним шляхом: цикл неможливий, бо index.ts
// ядра не сміє реекспортувати нічого з ui/ (§3.1), і це стереже `npm run build`.
import {
  type Vessel,
  formatCoordinates,
  formatCourse,
  formatName,
  formatSource,
  formatSpeed,
  formatTimestamp,
} from '@/entities/vessel';

import styles from './vessel-card.module.css';

interface VesselCardProps {
  readonly vessel: Vessel;
}

type FieldKey = 'name' | 'id' | 'coordinates' | 'speed' | 'course' | 'timestamp' | 'source';

interface VesselField {
  readonly key: FieldKey;
  readonly label: string;
  readonly value: string;
}

/**
 * Значок перед підписом поля — контури 24×24 штрихом `currentColor`. Значок
 * лише допомагає оку знайти рядок; значення несе текст підпису, тому SVG
 * `aria-hidden` і читач екрана його пропускає.
 */
const FIELD_ICON: Record<FieldKey, ReactElement> = {
  name: <path d="M3 17l2 4h14l2-4-9-3-9 3zM12 3v11M8 7l4-4 4 4" />,
  id: <path d="M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM7 10h4M7 14h6" />,
  coordinates: <path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
  speed: <path d="M4 15a8 8 0 1116 0M12 15l4-5" />,
  course: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7l3 8-3-2-3 2z" />,
  timestamp: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2" />,
  source: <path d="M4 12a8 8 0 0116 0M7.5 12a4.5 4.5 0 019 0M12 12v8" />,
};

/**
 * Картка нічого не вирішує: вона показує одне судно, передане пропсом. Вибір
 * судна лишається у власника стану, а форматування — у чистому ядрі зрізу, тож
 * тут немає жодного `toFixed` і жодної гілки на `null`.
 *
 * Кнопки закриття немає, і це вимога (§8), а не спрощення: картка закривається
 * вибором іншого судна.
 */
export function VesselCard({ vessel }: VesselCardProps): ReactElement {
  // Масив, а не сім однакових блоків JSX: порядок полів згори вниз — вимога
  // завдання, і тримати її в одному місці, яке можна прочитати очима згори вниз,
  // надійніше, ніж у розмітці, де її видно між тегами.
  const fields: readonly VesselField[] = [
    { key: 'name', label: 'Назва', value: formatName(vessel.name) },
    // "Ідентифікатор", а не "MMSI" (§10): демонстраційні `demo-1`… не є MMSI, і
    // такий підпис був би дрібною неправдою в інтерфейсі, який бачить замовник.
    { key: 'id', label: 'Ідентифікатор', value: vessel.id },
    {
      key: 'coordinates',
      label: 'Координати',
      value: formatCoordinates(vessel.lat, vessel.lon),
    },
    { key: 'speed', label: 'Швидкість', value: formatSpeed(vessel.speedKnots) },
    { key: 'course', label: 'Курс', value: formatCourse(vessel.courseDeg) },
    {
      key: 'timestamp',
      label: 'Час повідомлення',
      value: formatTimestamp(vessel.timestamp),
    },
    { key: 'source', label: 'Джерело', value: formatSource(vessel.source) },
  ];

  // `data-vessel-id` на картці свідомо НЕМАЄ, хоч і проситься: цей атрибут
  // належить значкам, і тест B-07 рахує ним судна на сторінці. Друге входження
  // на кожне обране судно зробило б той підрахунок неправильним.
  //
  // Значення нижче підставлене як {вираз}, ніколи через dangerouslySetInnerHTML:
  // JSX екранує текст, тому судно з ім'ям <b>Демо</b> показує теги символами —
  // критерій приймання B-04.
  //
  // Пояснення стоїть тут, а не коментарем усередині JSX, і це не смак: оракул
  // периметра в `no-ref-imports.spec.ts` рахує коментарем лише рядок, що
  // починається з `//`, `*` або `/*`. Рядок `{/*` під це не підпадає, тож
  // продовження такого коментаря він оголошує сліпою позицією периметра.
  return (
    <dl className={styles.card}>
      {fields.map((field) => (
        <div className={styles.row} key={field.key}>
          <dt className={styles.label}>
            <svg
              className={styles.icon}
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {FIELD_ICON[field.key]}
            </svg>
            {field.label}
          </dt>
          <dd className={styles.value}>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}
