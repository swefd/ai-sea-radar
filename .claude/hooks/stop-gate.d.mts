// Рукописні декларації: .ts-тест імпортує .mjs, а allowJs: false + strict дають
// TS7016. Заразом це документує публічний API гейта.
//
// `writeAllSync` тут НЕ оголошено, і це не пропуск: спільний запис у сирий fd
// живе в `scripts/verify/stdout.mjs` (там же його декларації), гейт його імпортує,
// а другий експорт того самого символу з цього файлу створив би друге ім'я для
// однієї функції — рівно те розходження, проти якого модуль і виносили.
export interface CheckResult {
  id: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN' | 'UNRUNNABLE';
  reason: string;
}

/** Бюджет `reason` у БАЙТАХ: текст українською, тобто двобайтовий. */
export declare const REASON_MAX_BYTES: number;
/** Скільки разів поспіль гейт блокує один і той самий промпт, перш ніж відпустити. */
export declare const MAX_CONSECUTIVE_BLOCKS: number;
export declare const COUNTER_DIR: string;
/** Рядок, за яким «гейт не відпрацював» упізнається і оком, і тестом. */
export declare const GATE_NOT_RUN: string;

/**
 * Обрізання за байтами. Це `truncateBytes` із `scripts/verify/report.mjs` під
 * іменем, яким його називає гейт: різалка в дереві одна.
 */
export declare function truncateUtf8(text: string, maxBytes: number): string;

export declare function formatFailureTable(results: CheckResult[]): string;
export declare function counterKey(input: unknown): string;
export declare function blockCount(root: string, key: string): number;
export declare function bumpBlockCount(root: string, key: string): number;
export declare function resetBlockCount(root: string, key: string): void;

/**
 * Шостий ключ конверта `--json` (R-73), прочитаний строго. `unknown` — це не
 * «напевно свіжо»: конвертові, у якому `reused` не булевий, вірити не можна.
 */
export declare function readReused(report: unknown): 'fresh' | 'reused' | 'unknown';

export type GateKind = 'REFUSE' | 'PASS' | 'BLOCK';

export interface GateVerdict {
  /** REFUSE — гейт нічого не стверджує про код: fail open, але голосно. */
  kind: GateKind;
  /** Порожньо лише для зеленого, якому нема чого додати. */
  message: string;
}

export declare function decide(report: unknown): GateVerdict;
