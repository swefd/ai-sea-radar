// Тіло відповіді `GET /api/snapshot` у фінальній формі. Джерело:
// docs/tasks/SPRINT-02.md:29, дослівно; план B-11…B-13, 0.5.
//
// Тип живе тут, а не поруч з обробником у `_app`: інтерфейс (`_pages`)
// імпортує його, а `_pages` не має права імпортувати `_app`.

import type { Vessel } from './vessel';

export type SnapshotErrorCode =
  | 'no_api_key' | 'connect_failed' | 'provider_error' | 'disconnected' | 'internal'
  | 'invalid_params';

/**
 * Діагностика спроби (специфікація 2026-09-29 §3.2). Форма та сама, що
 * `CollectDiagnostics` збирача, але оголошена окремо: `entities` не імпортує
 * `shared/api`, а інтерфейс читає саме цей тип.
 */
export type SnapshotDiagnostics = {
  connectMs: number | null;
  messages: number;
  rejected: number;
  byType: Record<string, number>;
};

export type SnapshotResponse =
  | {
      ok: true;
      vessels: Vessel[];
      collectedAt: string;
      windowSeconds: number;
      count: number;
      truncated: boolean;
      reason: 'window_elapsed' | 'limit_reached';
      includeClassB: boolean;
      diagnostics: SnapshotDiagnostics;
    }
  | {
      ok: false;
      attemptedAt: string;
      error: { code: SnapshotErrorCode; message: string };
      diagnostics: SnapshotDiagnostics | null;
    };
