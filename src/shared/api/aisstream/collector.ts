// Збирач B-12: відкриває з'єднання чужими руками, шле підписку й накопичує
// найновішу позицію на id до ліміту або до кінця вікна. Джерело:
// docs/tasks/SPRINT-02.md:28, :29, :92; SPRINT-03.md:43…:58; план
// docs/superpowers/plans/2026-09-29-sprint-03.md, задача 2.
//
// Механіка «завершитися рівно раз» успадкована від reader.ts (B-09, прибраний
// у B-12, коли endpoint перейшов на збирач) дослівно за змістом: один сторож `settle`, `subscribe()`, що витримує синхронний onOpen,
// повторне закриття handle після повернення `connect`, варта `if (!settled)`
// над таймером. Змінено лише те, ЩО накопичується, і дві навмисні розбіжності:
// помилка сокета ДО відкриття — `connect_failed` (SPRINT-02:29; reader тут
// відповідав `provider_error`), і битий JSON пропускається, а не валить спробу.
//
// Модуль не знає ні WebSocket, ні Date.now, ні entities/: джерело подій,
// годинник і перетворювач — параметри. Саме це робить B-15 здійсненним без
// мережі й без очікування 15 секунд.

import { buildSubscription } from './subscription';
import type { Connect, ReadErrorCode, SocketHandle, TimerId } from './transport';

/** Мінімум, який збирачу треба знати про елемент: ключ і час для «найновіша на id». */
export type Collectable = { readonly id: string; readonly timestamp: string };

export type CollectOptions<T extends Collectable> = {
  connect: Connect;
  apiKey: string;
  windowMs: number;
  limit: number;
  /**
   * Перетворювач — ПАРАМЕТР: shared/ не імпортує entities/. `null` — «не валідна
   * позиція», включно з SubscriptionConfirmation; збирач такі мовчки пропускає.
   */
  toItem: (raw: unknown) => T | null;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TimerId;
  clearTimer: (id: TimerId) => void;
  signal?: AbortSignal;
};

export type CollectResult<T> =
  | { kind: 'done'; items: T[]; reason: 'window_elapsed' | 'limit_reached'; finishedAt: number }
  | { kind: 'error'; code: ReadErrorCode; finishedAt: number };

/** Результат без часу: `finishedAt` ставить лише `settle`, щоб жодна гілка його не забула. */
type Outcome<T> =
  | { kind: 'done'; items: T[]; reason: 'window_elapsed' | 'limit_reached' }
  | { kind: 'error'; code: ReadErrorCode };

/** Кадр помилки джерела: об'єкт із рядковим полем `error`. */
function isProviderError(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    && typeof (raw as { error?: unknown }).error === 'string';
}

export function collect<T extends Collectable>(options: CollectOptions<T>): Promise<CollectResult<T>> {
  const { connect, apiKey, windowMs, limit, toItem, now, setTimer, clearTimer, signal } = options;

  return new Promise<CollectResult<T>>((resolve) => {
    // ЄДИНИЙ сторож на всі шляхи виходу — пастка SPRINT-02:92 «проміс
    // резолвиться двічі». Пізні події після ліміту — норма: сокет закривається
    // асинхронно й устигає крикнути onError/onClose, і вони НЕ мають
    // перетворити вже зібраний успіх на помилку (SPRINT-03:53).
    let settled = false;
    let subscribed = false;
    let opened = false;
    let handle: SocketHandle | null = null;
    let timerId: TimerId | null = null;

    // Одна позиція на id. Map, а не масив: заміна «цілком» — це просто set(),
    // і старий об'єкт не домішується до нового (ім'я null перемагає ім'я).
    const byId = new Map<string, T>();

    /** Прибирання ідемпотентне й живе в ОДНОМУ місці — на завершенні. */
    const settle = (outcome: Outcome<T>) => {
      if (settled) return;
      settled = true;

      // Таймер знімається на КОЖНІЙ гілці, не лише на вікні: після ліміту
      // незнятий таймер — друга пастка SPRINT-02:92, і в процесі сервера
      // він жив би ще 15 секунд після відповіді.
      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
      signal?.removeEventListener('abort', onAbort);
      try {
        handle?.close();
      } catch {
        // Закриття вже закритого сокета не має перетворювати результат на
        // інший: дані вже зібрані, ресурс уже звільнений.
      }

      // Час — за переданим годинником у момент завершення (SPRINT-02:28), а
      // не в момент старту: з нього endpoint зробить collectedAt/attemptedAt.
      resolve({ ...outcome, finishedAt: now() });
    };

    /**
     * Надсилання підписки, стійке до ПОРЯДКУ подій. `onOpen` може прийти
     * синхронно, ще до того, як `connect` повернув handle; тоді відправка
     * відкладається до присвоєння нижче. Ідемпотентна.
     */
    const subscribe = () => {
      if (subscribed || handle === null) return;
      try {
        handle.send(buildSubscription(apiKey));
        subscribed = true;
      } catch {
        settle({ kind: 'error', code: 'connect_failed' });
      }
    };

    // Скасування — `internal`, рішення людини (план, «Rulings»). Головне тут
    // не код, а те, чого НЕМАЄ: жодного часткового набору, лише прибирання.
    function onAbort() {
      settle({ kind: 'error', code: 'internal' });
    }

    const accept = (item: T) => {
      const existing = byId.get(item.id);
      if (existing === undefined) {
        byId.set(item.id, item);
        // Ліміт перевіряється одразу після вставки НОВОГО id і завершує
        // негайно — тому 101-й id фізично не може потрапити в набір.
        if (byId.size === limit) {
          settle({ kind: 'done', items: [...byId.values()], reason: 'limit_reached' });
        }
        return;
      }
      // СТРОГО більше. `>=` пройшов би тести «новіше замінює», але при рівних
      // мітках підмінив би першу прийняту позицію (SPRINT-02:28, SPRINT-03:47).
      // Повтор того самого id ліміт не наближає — вікно триває.
      if (Date.parse(item.timestamp) > Date.parse(existing.timestamp)) {
        byId.set(item.id, item);
      }
    };

    if (signal?.aborted) {
      // Запит скасовано ще до того, як ми торкнулися мережі.
      settle({ kind: 'error', code: 'internal' });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      handle = connect({
        onOpen: () => {
          // ПЕРШОЮ дією: джерело дає 3 секунди й мовчки закриває з'єднання,
          // якщо підписка не встигла.
          opened = true;
          subscribe();
        },

        onMessage: (text) => {
          if (settled) return;

          // Збір — потік, а не одна відповідь: один битий кадр не має вбивати
          // знімок, тому НЕ `internal`, як у колишньому reader, а пропуск.
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            return;
          }

          // Помилку AISStream шле КАДРОМ `{ "error": "..." }`, а не подією
          // сокета (модель ModelError документації джерела). Без цієї гілки
          // кадр ішов би в toItem → null і пропадав мовчки, а за живого
          // з'єднання спроба віддала б частковий набір як успіх (F2, B-17;
          // SPRINT-03:52). Текст помилки не зберігається — SPRINT-02:29.
          if (isProviderError(raw)) {
            settle({ kind: 'error', code: 'provider_error' });
            return;
          }

          // Помилка в перетворювачі — вада нашого коду, а не джерела; кидок із
          // обробника сокета пішов би повз проміс. Тому `internal`, чесно.
          let item: T | null;
          try {
            item = toItem(raw);
          } catch {
            settle({ kind: 'error', code: 'internal' });
            return;
          }
          if (item === null) return;

          accept(item);
        },

        // До відкриття — не дійшли до джерела: `connect_failed` негайно
        // (SPRINT-02:29). ПІСЛЯ відкриття подія `error` — збій транспорту, і
        // WebSocket за нею завжди шле `close` (виміряно на Node 24.21:
        // обрив TCP дає `error → close(1006)`). Класифікує саме `onClose`:
        // інакше обрив після підписки читався б як «джерело повернуло
        // помилку», а не «з'єднання розірвано» (F1, B-17). Якщо `close` не
        // прийде, завершить таймер вікна.
        onError: () => {
          if (!opened) settle({ kind: 'error', code: 'connect_failed' });
        },

        // Закриття ДО підписки — не дійшли; ПІСЛЯ — розірвали. Дослівно :29.
        onClose: () => settle({
          kind: 'error',
          code: subscribed ? 'disconnected' : 'connect_failed',
        }),
      });
    } catch {
      settle({ kind: 'error', code: 'connect_failed' });
      return;
    }

    // Обробник міг спрацювати синхронно, доки `handle` ще був `null`. Тоді
    // підписка не пішла, і надолужити її треба саме тут — після присвоєння.
    if (opened) subscribe();

    // Протилежний бік того самого: результат уже є, а сокет аж тепер
    // з'явився. Без цього рядка він лишився б відкритим.
    if (settled) {
      try {
        handle?.close();
      } catch {
        // ресурс і так непридатний
      }
    }

    // Строк відлічується від ПОЧАТКУ обробки, включно зі з'єднанням і
    // підпискою (SPRINT-02:28), тому таймер ставиться тут, а не в onOpen.
    // `if (!settled)`: якщо результат уже є, знімати таймер було б нікому.
    if (!settled) {
      timerId = setTimer(() => {
        // Вікно минуло. З підпискою — успіх, хай і порожній; без неї ми не
        // дійшли до джерела, і це connect_failed, а не «нікого немає».
        settle(subscribed
          ? { kind: 'done', items: [...byId.values()], reason: 'window_elapsed' }
          : { kind: 'error', code: 'connect_failed' });
      }, windowMs);
    }
  });
}
