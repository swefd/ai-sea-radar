// Розбір рядка запиту `GET /api/snapshot`. Джерело: специфікація
// docs/superpowers/specs/2026-09-29-snapshot-settings-design.md §3.1.
//
// Порівняння — з РЯДКОВИМ поданням дозволених значень, а не `Number(...)`:
// `Number` прийняв би `015`, `+15`, ` 15` і `15.0`, і білий список перестав
// би бути білим. Повтор параметра — теж відмова: `getAll` бачить обидва, а
// `get` мовчки взяв би перший.

import {
  DEFAULT_SNAPSHOT_SETTINGS,
  SNAPSHOT_WINDOW_OPTIONS,
  type SnapshotSettings,
} from '@/shared/config';

const WINDOW_BY_TEXT = new Map<string, number>(
  SNAPSHOT_WINDOW_OPTIONS.map((seconds) => [String(seconds), seconds]),
);
const CLASS_B_BY_TEXT = new Map<string, boolean>([['0', false], ['1', true]]);

/** `undefined` — параметра немає; `null` — він є, але некоректний. */
function single<T>(params: URLSearchParams, name: string, allowed: Map<string, T>): T | null | undefined {
  const values = params.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length > 1) return null;
  return allowed.get(values[0]) ?? null;
}

export function parseSnapshotParams(params: URLSearchParams): SnapshotSettings | null {
  const windowSeconds = single(params, 'window', WINDOW_BY_TEXT);
  const includeClassB = single(params, 'classB', CLASS_B_BY_TEXT);
  if (windowSeconds === null || includeClassB === null) return null;

  return {
    windowSeconds: windowSeconds ?? DEFAULT_SNAPSHOT_SETTINGS.windowSeconds,
    includeClassB: includeClassB ?? DEFAULT_SNAPSHOT_SETTINGS.includeClassB,
  };
}
