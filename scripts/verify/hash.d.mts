// Ручні декларації до hash.mjs (R-08): tsconfig має allowJs: false, тож без них
// імпорт .mjs із .ts — TS7016. Задача 5 дописує сюди `listRepoFiles` — один рядок,
// не переписування файлу.
export declare const SOURCE_PREFIXES: readonly string[];
export declare const SOURCE_FILES: readonly string[];
export declare function isSourcePath(relPath: string): boolean;
export declare function listRepoFiles(root: string): string[];
export declare function listSourceFiles(root: string): string[];
export declare function sourceHash(root: string): {
  hash: string;
  fileCount: number;
  files: string[];
};
