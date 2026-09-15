// Ручні декларації до run.mjs (R-08), і так само неперевірені компілятором:
// їхню відповідність рантайму тримає лише tests/unit/run.spec.ts (R-48).
//
// Специфікатор — './registry.mjs' (рантайм-шлях), а не './registry.d.mts':
// декларацію TS знаходить сам. Обидві форми компілюються за поточного
// moduleResolution: "bundler", але лише перша переживе перехід на "node16".
import type { Check, Precondition, Tier } from './registry.mjs';

export type Status = 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN' | 'UNRUNNABLE';

export interface CheckResult {
  id: string;
  tier: Tier;
  cmd: string;
  proves: string;
  blindSpot: string;
  status: Status;
  reason: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Options {
  tier: Tier;
  noSkip: boolean;
  only: string[];
  reuseIfFresh: boolean;
  json: boolean;
  timeoutMs: number | null;
  root: string | null;
}

export declare function isBlocking(status: Status, noSkip: boolean): boolean;
export declare function parseArgs(argv: readonly string[]): Options;
export declare function selectChecks(checks: Check[], opts: { tier: Tier; only: string[] }): Check[];
export declare function orderChecks(checks: Check[]): Check[];
export declare function classifyExit(outcome: {
  spawnError?: { code?: string; message?: string } | null;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
}): { status: Status; reason: string };
export declare function parsePlaywrightTotal(text: string): number | null;
export declare function resolveRoot(cwd: string): string;
export declare function runAll(options: {
  checks?: Check[];
  preconditions?: Record<string, Precondition>;
  root: string;
  tier: Tier;
  noSkip: boolean;
  only: string[];
  timeoutMs: number | null;
}): Promise<CheckResult[]>;
