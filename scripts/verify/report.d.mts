// Ручні декларації до report.mjs (R-08), і так само неперевірені компілятором:
// `allowJs: false` означає, що TypeScript ніколи не читає .mjs, тож розбіжність
// між цим файлом і реалізацією лишається зеленою в `check-types`. Єдиний захист —
// рантаймовий імпорт із tests/unit/report.spec.ts, який кличе КОЖНУ назву звідси (R-48).
//
// Специфікатор рантайму, не декларації — так само, як у run.d.mts задачі 3.
import type { CheckResult, Options } from './run.mjs';

export interface Report {
  schema: 1;
  startedAt: string;
  durationMs: number;
  root: string;
  tier: Options['tier'];
  noSkip: boolean;
  only: string[];
  hash: string;
  fileCount: number;
  reused: boolean;
  key: string;
  blocking: boolean;
  exitCode: 0 | 1;
  results: CheckResult[];
}

/** Конверт stdout: рівно шість ключів (R-16 + R-73), у зафіксованому порядку. */
export interface StdoutReport {
  tier: Options['tier'];
  root: string;
  noSkip: boolean;
  sourceHash: string;
  results: Pick<CheckResult, 'id' | 'status' | 'reason' | 'durationMs'>[];
  /** R-73: відтворене зелене — інше твердження, ніж свіже. Останній ключ. */
  reused: boolean;
}

export declare function truncateBytes(text: string, maxBytes?: number): string;
export declare function wantsColor(stream: { isTTY?: boolean } | null | undefined, env?: Record<string, string | undefined>): boolean;
export declare function formatTable(results: CheckResult[], opts?: { color?: boolean }): string;
export declare function cacheKey(opts: { hash: string; tier: Options['tier']; noSkip: boolean; only: string[] }): string;
export declare function toReport(input: {
  root: string; tier: Options['tier']; noSkip: boolean; only: string[];
  hash: string; fileCount: number; reused: boolean; blocking: boolean;
  results: CheckResult[];
  startedAt?: number; durationMs?: number;
}): Report;
export declare function toStdoutJson(report: Report): StdoutReport;
export declare function writeReport(root: string, report: Report): string;
export declare function readReport(root: string): Report | null;
export declare function readFreshPass(root: string, key: string): Report | null;
