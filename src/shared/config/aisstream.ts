// Ключ AISStream і константи знімка. Джерело: docs/tasks/SPRINT-02.md,
// розділ «Узгоджені значення» (:24, :28); проєктне рішення
// docs/superpowers/specs/2026-09-22-b08-b10-aisstream-key-and-reader-design.md §3.4.

/**
 * Стан ключа. Юніон, а не `string | null`, свідомо: `no_api_key` у endpoint стає
 * ГІЛКОЮ РОЗБОРУ, а не перевіркою на порожнечу, повтореною в трьох місцях.
 * Варіант 'missing' не має поля apiKey взагалі — прочитати з нього порожній
 * рядок і піти далі неможливо за формою типу, а не за домовленістю.
 */
export type ApiKeyState =
  | { status: 'missing' }
  | { status: 'present'; apiKey: string };

/**
 * Читає ключ із переданого оточення.
 *
 * Оточення — ПАРАМЕТР із дефолтом, а не `process.env` усередині: інакше тест
 * мусив би мутувати глобальний стан, спільний для всього процесу.
 *
 * Не кидає ніколи — дослівний критерій B-08. Порожній рядок і рядок із самих
 * пробілів дають 'missing': саме так виглядає .env.local, скопійований з
 * .env.example і не заповнений.
 */
export function readApiKey(
  env: Record<string, string | undefined> = process.env,
): ApiKeyState {
  const raw = env.AISSTREAM_API_KEY;
  if (typeof raw !== 'string') return { status: 'missing' };

  const apiKey = raw.trim();
  if (apiKey === '') return { status: 'missing' };

  return { status: 'present', apiKey };
}

/** Кінцева точка. Джерело: документація aisstream.io. */
export const AISSTREAM_ENDPOINT = 'wss://stream.aisstream.io/v0/stream';

/** Строк збору, секунди. SPRINT-02:28 — «константи 15 і 100 у конфігурації». */
export const SNAPSHOT_WINDOW_SECONDS = 15;

/**
 * Дозволені вікна збору, секунди. Погоджено замовником 2026-09-29
 * (docs/superpowers/specs/2026-09-29-snapshot-settings-design.md §3.3):
 * повзунок інтерфейсу ходить саме цими кроками, а сервер іншого не приймає —
 * інакше ручний `?window=99999` тримав би сокет добу.
 */
export const SNAPSHOT_WINDOW_OPTIONS = [15, 30, 60, 120, 180, 240, 300] as const;

/** Налаштування однієї спроби. Не зберігаються між запусками (PROJECT_BRIEF:113). */
export type SnapshotSettings = {
  readonly windowSeconds: number;
  readonly includeClassB: boolean;
};

/** Без параметрів — дослівно поведінка R2: 15 с, лише PositionReport. */
export const DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings = {
  windowSeconds: SNAPSHOT_WINDOW_SECONDS,
  includeClassB: false,
};

/**
 * Ліміт унікальних суден. Оголошений тут разом із вікном, бо завдання називає
 * обидва одним реченням; СПОЖИВАЧА в цьому заході ще немає — його дасть збирач
 * (B-12). Тримати константу окремо від сестри означало б розвести на два коміти
 * те, що узгоджене як пара.
 */
export const SNAPSHOT_VESSEL_LIMIT = 100;
