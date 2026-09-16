// Рукописні декларації: .ts-тест імпортує .mjs, а allowJs: false + strict
// дають TS7016. Заразом це документує публічний API хука.
export declare const CODE_EXTENSIONS: string[];
export declare const IGNORED_PREFIXES: string[];
/** Записи `globalIgnores`, які є іменами файлів, а не теками. */
export declare const IGNORED_FILES: string[];
export declare const TYPECHECK_CACHE_DIR: string;

/** Рядок, за яким «перевірки не було» упізнається і оком, і тестом. */
export declare const NOT_RUN_PREFIX: string;
/** Бюджет lead у БАЙТАХ — межа обрізання truncateBytes. */
export declare const MAX_LEAD_BYTES: number;

export interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

/** Відповідь інструмента: ненульовий вихід — теж відповідь, а не виняток. */
export interface ToolRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Чи вийшов шлях за межі дерева, яке назвала подія (`..`, `../…`, абсолютний). */
export declare function isOutsideRoot(relPath: string): boolean;
export declare function isCheckablePath(relPath: string): boolean;
export declare function parseTscErrors(stdout: string): TscError[];

/**
 * Порожній рядок означає «вердикт був»; будь-що інше — гучний текст про те, що
 * перевірка не виконалась. Саме тому це окремі експортовані функції: рішення
 * «вердикт чи незапуск» мусить бути перевірюваним без запуску інструментів.
 */
export declare function tscNotRun(run: ToolRun, errorCount: number): string;
export declare function eslintNotRun(run: ToolRun): string;

export declare function formatLead(
  relPath: string,
  eslintText: string,
  errors: TscError[],
  notices?: string[],
): string;
