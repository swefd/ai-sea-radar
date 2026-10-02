'use client';

import { useEffect, useRef, useState } from 'react';

import {
  DEMO_ROUTES,
  DEMO_TICK_MS,
  SOURCE_LABELS,
  fleetAtTick,
  lastFleetTick,
} from '@/entities/vessel';

import { attemptLine, type Attempt } from '../lib/attempt-line';
import { fetchSnapshot } from '../lib/fetch-snapshot';
import { snapshotCaption, type SnapshotSuccess } from '../lib/snapshot-caption';
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
// що з них нічого не рендериться, поки вибір порожній. Рядок спроби до
// першого натискання відсутній, підказка — статичний текст.

/**
 * Тік, на якому стає ОСТАННЄ судно. Похідне від даних (найдовший маршрут — 12
 * точок, тобто 11), а не літерал: зайва точка в маршруті рухає його сама.
 *
 * Обчислення на рівні модуля, а не в тілі компонента: це чиста функція від
 * сталих даних, і рахувати її на кожен рендер не було б за що.
 */
const LAST_TICK = lastFleetTick(DEMO_ROUTES);

/**
 * Показаний набір — ПЕРШИЙ із двох незалежних станів R4 (CR :23). Другий —
 * результат останньої спроби (`Attempt`, `attempt-line.ts`), і з цим він не
 * перетинається: невдала спроба змінює лише рядок спроби.
 *
 * `snapshot` — лише НЕПОРОЖНІЙ успіх; це умова в `handleLoad`. Порожній успіх
 * і помилка набір не змінюють (CR :27). Назад у `demo` стан не повертається —
 * лише оновленням сторінки (CR :32).
 *
 * До R4 тут був один `LoadState`, і в `error` набору не було де лежати — так
 * узгоджувало SPRINT-02:30…:35. Лист замовника № 3 змінив вимогу після досвіду
 * занять: збій більше не стирає карту.
 */
type Shown = { kind: 'demo' } | { kind: 'snapshot'; response: SnapshotSuccess };

export function VesselView() {
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: 'demo' });
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'none' });

  // Команда карті «до початкового виду» — лічильник, а не прапорець (див.
  // `LeafletMapProps.resetViewKey`).
  const [resetViewKey, setResetViewKey] = useState(0);

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

  // Поки показана демонстрація і останнє судно не стало. На `tick === LAST_TICK`
  // стає `false`, ефект чиститься, і новий інтервал не створюється: через ~22 с
  // застосунок повністю тихий — таймерів немає, рендерів немає, Leaflet не
  // діфить маркери. Останній тік при цьому ВІДБУВАЄТЬСЯ: на
  // `tick === LAST_TICK - 1` умова ще істинна, інтервал спрацьовує, і аж тоді
  // ефект чиститься.
  //
  // Від спроби рух НЕ залежить (CR :26, :27): під час запиту й після збою
  // демонстрація рухається далі. Зупиняє її лише заміна набору непорожнім
  // успіхом (CR :28), а справжні судна між завантаженнями не рухаються
  // (SPRINT-02:37). Той самий ефект на `[running]` і прибирає інтервал, тож
  // окремого механізму зупинки немає.
  const running = shown.kind === 'demo' && tick < LAST_TICK;

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
  // Набір, підпис і вибір на час запиту НЕ чіпаються (CR :26): картка
  // закривається лише вибором іншого судна, а судно лишається на карті.
  // Повторне натискання під час збору неможливе — кнопка `disabled`, поки
  // спроба `loading`, і це єдиний захист: другого запиту обробник не очікує.
  // З тієї ж причини `shown` із замикання актуальний — інших записувачів у
  // нього немає.
  //
  // Усі `set*` після `await` стоять в одному синхронному відрізку, тож React
  // зводить їх в один рендер: карта, картка, підпис і рядок спроби
  // змінюються разом — це і є «атомарно» з CR :28.
  async function handleLoad() {
    setAttempt({ kind: 'loading' });

    const response = await fetchSnapshot();
    setAttempt({ kind: 'done', response });

    // Лише непорожній успіх замінює набір (CR :27, :28).
    if (response === null || !response.ok || response.count === 0) {
      return;
    }

    // Обраний id, якого немає в новому наборі, скидається В СТАНІ, а не лише
    // ховається через `find` нижче: інакше він «воскрес» би з наступним
    // знімком, де це судно знову є, і картка відкрилася б сама.
    const ids = new Set(response.vessels.map((vessel) => vessel.id));
    setSelectedVesselId((id) => (id !== null && ids.has(id) ? id : null));

    // Вид повертається лише на ПЕРШИЙ непорожній успіх (CR :29), тобто на
    // переході з демонстрації: далі людина могла сама наблизитися до ділянки,
    // і наступний знімок не має її звідти висмикувати.
    if (shown.kind === 'demo') {
      setResetViewKey((previous) => previous + 1);
    }

    // Набір замінюється цілком, без злиття з попереднім (CR :30): судна, якого
    // немає в новій відповіді, на карті більше немає — і це не «вийшло з району».
    setShown({ kind: 'snapshot', response });
  }

  // Усе видиме — похідне від двох станів і двох чисел. Карта й картка читають
  // РЕЗУЛЬТАТ ОДНОГО ВИРАЗУ, тож розійтися їм нема на чому. Демонстраційний
  // флот рахується лише поки показана демонстрація.
  const vessels =
    shown.kind === 'demo' ? fleetAtTick(DEMO_ROUTES, tick, startedAt) : shown.response.vessels;
  const caption = shown.kind === 'demo' ? SOURCE_LABELS.demo : snapshotCaption(shown.response);

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
        attempt={attemptLine(attempt)}
        loading={attempt.kind === 'loading'}
        onLoad={handleLoad}
      />
    </>
  );
}
