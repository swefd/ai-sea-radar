// Ручні декларації до registry.mjs (R-08): tsconfig має allowJs: false, тож без
// них імпорт .mjs із .ts — TS7016. `check-types` порівняти їх із .mjs НЕ може:
// TypeScript резолвить './registry.mjs' сюди й самого .mjs не читає ніколи.
// Єдина перевірка відповідності — рантайм-імпорт кожного імені з
// tests/unit/run.spec.ts (R-48).
export type Tier = 'fast' | 'full';

export interface Check {
  id: string;
  tier: Tier;
  cmd: string;
  needs: string[];
  after: string[];
  proves: string;
  blindSpot: string;
  timeoutMs?: number;
  emptyProbe?: { cmd: string; reason: string };
}

export interface Precondition {
  describe: string;
  probe: (root: string) => boolean;
}

export declare const DEFAULT_TIMEOUT_MS: number;
export declare const CHECKS: Check[];
export declare const PRECONDITIONS: Record<string, Precondition>;
export declare function browsersPath(root: string): string;
