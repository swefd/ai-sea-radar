// Ручні декларації: tsconfig має allowJs: false, тож імпорт цього .mjs із .spec.ts —
// TS7016. Тримати синхронно з експортами руками; розбіжність ловить `check-types`.
export interface RefImportViolation {
  file: string;
  line: number;
  form: string;
  specifier: string;
}

export declare function scanText(relPath: string, text: string): RefImportViolation[];
export declare function scanForRefImports(root: string): {
  files: string[];
  violations: RefImportViolation[];
};
