// Тіло відповіді `GET /api/snapshot` у фінальній формі. Джерело:
// docs/tasks/SPRINT-02.md:29, дослівно; план B-11…B-13, 0.5.
//
// Тип живе тут, а не поруч з обробником у `_app`: інтерфейс (`_pages`)
// імпортує його, а `_pages` не має права імпортувати `_app`.

import type { Vessel } from './vessel';

export type SnapshotErrorCode =
  | 'no_api_key' | 'connect_failed' | 'provider_error' | 'disconnected' | 'internal';

export type SnapshotResponse =
  | {
      ok: true;
      vessels: Vessel[];
      collectedAt: string;
      windowSeconds: number;
      count: number;
      truncated: boolean;
      reason: 'window_elapsed' | 'limit_reached';
    }
  | { ok: false; attemptedAt: string; error: { code: SnapshotErrorCode; message: string } };
