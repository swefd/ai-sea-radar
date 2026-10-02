'use client';

import { useEffect, useRef, useState } from 'react';

import {
  DEMO_ROUTES,
  DEMO_TICK_MS,
  SOURCE_LABELS,
  fleetAtTick,
  lastFleetTick,
  type Vessel,
} from '@/entities/vessel';
import { DEFAULT_SNAPSHOT_SETTINGS } from '@/shared/config';

import { fetchSnapshot } from '../lib/fetch-snapshot';
import {
  NO_SERVER_RESPONSE,
  snapshotCaption,
  type SnapshotSuccess,
} from '../lib/snapshot-caption';
import { DoverStraitMap } from './dover-strait-map';
import { VesselPanel } from './vessel-panel';

// Єдиний власник вибору — і єдине місце застосунку, де є таймер і де взагалі
// згадується `Date.now()`. Клієнтська межа піднята рівно сюди, а не на всю
// сторінку: `home-page.tsx` лишається серверним, бо стану він не потребує.
//
// Компонент рендериться і на сервері (клієнтський ≠ виключений із SSR), тож
// початковий вибір — `null`, а в завжди видимій частині панелі немає нічого,
// похідного від часу: інакше годинник складальної машини запікся б у HTML
// і дав розбіжність при гідратації. `startedAt` серверного рендера й
// клієнтського РІЗНІ — розбіжності немає не тому, що вони збігаються, а тому,
// що з них нічого не рендериться, поки вибір порожній.

/**
 * Тік, на якому стає ОСТАННЄ судно. Похідне від даних (найдовший маршрут — 12
 * точок, тобто 11), а не літерал: зайва точка в маршруті рухає його сама.
 *
 * Обчислення на рівні модуля, а не в тілі компонента: це чиста функція від
 * сталих даних, і рахувати її на кожен рендер не було б за що.
 */
const LAST_TICK = lastFleetTick(DEMO_ROUTES);

/**
 * Результат ОСТАННЬОЇ спроби (SPRINT-02:30…:35). Порожній успіх — це `success`
 * із `count: 0`, а не окремий варіант: підпис у нього той самий, різниться
 * лише пояснення, і окремий вид дублював би відповідь сервера.
 *
 * У `error` набору немає за побудовою — полю `vessels` там нема де лежати.
 * «Дбайливо» зберегти попередній набір після помилки тут неможливо формою
 * типу, а не домовленістю: SPRINT-02:91 прямо називає це поверненням на
 * доопрацювання.
 *
 * `cancelled` — людина сама обірвала спробу; суден немає, як і в `error`, але
 * це не помилка (специфікація 2026-09-29 §5.2).
 */
type LoadState =
  | { kind: 'idle-demo' }
  | { kind: 'loading' }
  | { kind: 'success'; response: SnapshotSuccess }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

// Тексти станів — дослівно з SPRINT-02:31…:35.
const LOADING_CAPTION = 'Завантаження…';
const NO_DATA_CAPTION = 'Даних на карті немає';
const EMPTY_NOTICE = 'За час збору позицій не отримано';
// Специфікація 2026-09-29 §5.2.
const CANCELLED_NOTICE = 'Завантаження скасовано';

/** Порожній набір — модульна стала, щоб його ідентичність не мінялася з рендером
 * і ефект маркерів не перезапускався без причини. */
const NO_VESSELS: readonly Vessel[] = [];

/** Підпис і пояснення — чисте похідне від стану, без жодного `useState`. */
function describe(load: LoadState): { caption: string; notice: string | null } {
  switch (load.kind) {
    case 'idle-demo':
      return { caption: SOURCE_LABELS.demo, notice: null };
    case 'loading':
      return { caption: LOADING_CAPTION, notice: null };
    case 'success':
      return {
        caption: snapshotCaption(load.response),
        notice: load.response.count === 0 ? EMPTY_NOTICE : null,
      };
    case 'error':
      return { caption: NO_DATA_CAPTION, notice: `Не вдалося отримати дані: ${load.message}` };
    case 'cancelled':
      return { caption: NO_DATA_CAPTION, notice: CANCELLED_NOTICE };
  }
}

export function VesselView() {
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: 'idle-demo' });

  // Команда карті «до початкового виду» — лічильник, а не прапорець (див.
  // `LeafletMapProps.resetViewKey`). Чи був уже непорожній успіх — ref, а не
  // стан: він нічого не рендерить, і читається лише в обробнику, не в рендері.
  const [resetViewKey, setResetViewKey] = useState(0);
  const hadNonEmptySuccessRef = useRef(false);

  // Контролер ПОТОЧНОЇ спроби. Ref, а не стан: він нічого не рендерить. Він же
  // — ознака «чия це відповідь»: спроба, чий контролер уже не поточний
  // (скасовано або розмонтовано), свій результат не записує.
  const attemptRef = useRef<AbortController | null>(null);

  // Розмонтування (hot reload, закриття) обриває запит: інакше сервер тримав
  // би сокет до кінця вікна — а воно тепер буває й 5 хвилин.
  useEffect(() => () => attemptRef.current?.abort(), []);

  // ЄДИНА ЗАКОННА ФОРМА моменту старту, і це виміряно проти справжнього конфігу
  // цього репозиторію, а не обрано на смак: `eslint-plugin-react-hooks@7.1.1`
  // приносить правила React Compiler, і `useRef(Date.now())` дає помилку
  // `react-hooks/purity` навіть якщо `.current` не читати в рендері; голий
  // `Date.now()` у тілі компонента — теж. Лінивий ініціалізатор `useState` —
  // чистий, бо його викликає React, а не рендер.
  const [startedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(0);

  // Лічильник тіків для перевірки "після hot reload один тік за інтервал, не
  // два" (критерій B-06). Живе в `ref`, а не в стані: він нічого не рендерить,
  // і зайвий ререндер на кожен тік був би платою ні за що. `useRef(0)` чистий —
  // на відміну від `useRef(Date.now())`, ініціалізатор тут нічого не кличе.
  const ticksRef = useRef(0);

  // Поки останнє судно не стало. На `tick === LAST_TICK` стає `false`, ефект
  // чиститься, і новий інтервал не створюється: через ~22 с застосунок
  // повністю тихий — таймерів немає, рендерів немає, Leaflet не діфить маркери.
  // Останній тік при цьому ВІДБУВАЄТЬСЯ: на `tick === LAST_TICK - 1` умова ще
  // істинна, інтервал спрацьовує, і аж тоді ефект чиститься.
  //
  // Поза `idle-demo` не тікає нічого: натискання кнопки зупиняє демонстрацію
  // (SPRINT-02:31), а справжні судна між завантаженнями не рухаються
  // (SPRINT-02:37). Той самий ефект на `[running]` і прибирає інтервал, тож
  // окремого механізму зупинки немає. Назад в `idle-demo` застосунок не
  // повертається — лише оновленням сторінки (SPRINT-02:13).
  const running = load.kind === 'idle-demo' && tick < LAST_TICK;

  useEffect(() => {
    if (!running) {
      return;
    }

    const intervalId = setInterval(() => {
      ticksRef.current += 1;

      // ЛОГ СТОЇТЬ ТУТ, А НЕ ВСЕРЕДИНІ АПДЕЙТЕРА `setTick`, і це не стиль.
      // React має право викликати апдейтер двічі під StrictMode — апдейтери
      // мусять бути чистими. Лог звідти друкував би два рядки на інтервал і
      // власноруч виготовив би рівно ту поломку, яку критерій B-06 шукає.
      //
      // `console.info`, а не `console.debug`: DevTools Chrome типово ховає
      // рівень Verbose, тобто саме `debug`. Критерій B-06 перевіряється очима
      // в консолі, тож повідомлення, якого за типових налаштувань не видно,
      // не виконувало б своєї єдиної роботи.
      if (process.env.NODE_ENV !== 'production') {
        console.info('[demo-fleet] tick', ticksRef.current);
      }

      setTick((previous) => previous + 1);
    }, DEMO_TICK_MS);

    // Прибирання — перший із двох механізмів, що не дають таймерам
    // накопичуватися: його кличе і подвійне монтування StrictMode, і Fast
    // Refresh. Другий механізм — те, що інтервал створюється ВСЕРЕДИНІ ефекту:
    // інтервал на рівні модуля пережив би hot reload і дав би саме два тіки за
    // інтервал.
    //
    // Залежність саме `[running]`, а не `[tick]`: з `[tick]` інтервал
    // знищувався б і створювався щотіка — таймер лишався б один, але фаза
    // скидалася б щоразу, і вимір "один тік за інтервал" перестав би щось
    // означати.
    return () => {
      clearInterval(intervalId);
    };
  }, [running]);

  // Уся робота кнопки — в обробнику, не в ефекті й не в рендері: запит — наслідок
  // дії людини, і правила React Compiler тримають побічні дії саме тут.
  //
  // Вибір скидається ДО запиту: у `loading` суден немає (SPRINT-02:31), і
  // картка, що пережила б їх, показувала б судно, якого на карті нема. Повторне
  // натискання під час збору неможливе — у `loading` кнопки завантаження немає,
  // на її місці «Скасувати». Та й без цього відповідь чужої спроби не пишеться.
  async function handleLoad() {
    const attempt = new AbortController();
    attemptRef.current = attempt;
    setSelectedVesselId(null);
    setLoad({ kind: 'loading' });

    const response = await fetchSnapshot(DEFAULT_SNAPSHOT_SETTINGS, attempt.signal);

    // Відповідь чужої спроби — ігнор. Стан уже записав той, хто її обірвав.
    if (attemptRef.current !== attempt) return;
    attemptRef.current = null;

    if (response === 'cancelled') return;

    if (response === null) {
      setLoad({ kind: 'error', message: NO_SERVER_RESPONSE });
      return;
    }
    if (!response.ok) {
      setLoad({ kind: 'error', message: response.error.message });
      return;
    }

    setLoad({ kind: 'success', response });

    // Вид повертається лише на ПЕРШИЙ непорожній успіх (SPRINT-02:33): далі
    // людина могла сама наблизитися до ділянки, і наступний знімок не має
    // її звідти висмикувати.
    if (response.count > 0 && !hadNonEmptySuccessRef.current) {
      hadNonEmptySuccessRef.current = true;
      setResetViewKey((previous) => previous + 1);
    }
  }

  // Стан пише САМ обробник, а не гілка 'cancelled' у handleLoad: відповідь
  // обірваного запиту може й не прийти, а людина має побачити результат одразу.
  function handleCancel() {
    attemptRef.current?.abort();
    attemptRef.current = null;
    setLoad({ kind: 'cancelled' });
  }

  // Усе видиме — похідне від стану спроби й двох чисел. Карта й картка читають
  // РЕЗУЛЬТАТ ОДНОГО ВИРАЗУ, тож розійтися їм нема на чому. Демонстраційний
  // флот рахується лише в `idle-demo`.
  const vessels =
    load.kind === 'idle-demo'
      ? fleetAtTick(DEMO_ROUTES, tick, startedAt)
      : load.kind === 'success'
        ? load.response.vessels
        : NO_VESSELS;
  const { caption, notice } = describe(load);

  // У стані лежить тільки id, ніколи копія судна: судно застаріло б з першим
  // же тіком, а id — ні. Саме тому оновлення картки на тіку безкоштовне.
  const selectedVessel = vessels.find((vessel) => vessel.id === selectedVesselId) ?? null;

  return (
    <>
      <DoverStraitMap
        vessels={vessels}
        selectedVesselId={selectedVesselId}
        // Сетер передається напряму, тож вибір — присвоєння, а не перемикач:
        // повторний клік по тому самому судну записує той самий id, `find`
        // повертає те саме судно, і картка не закривається. Гарантія тут
        // саме в цьому, а не в тому, що React пропустить ререндер.
        onSelectVessel={setSelectedVesselId}
        resetViewKey={resetViewKey}
      />
      <VesselPanel
        vessel={selectedVessel}
        caption={caption}
        notice={notice}
        loading={load.kind === 'loading'}
        onLoad={handleLoad}
        onCancel={handleCancel}
      />
    </>
  );
}
