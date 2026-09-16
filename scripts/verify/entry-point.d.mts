// Ручні декларації до entry-point.mjs (R-08): tsconfig має allowJs: false, тож без
// них імпорт .mjs із .ts — TS7016.
//
// Параметр — `import.meta.filename` викликача; `.mjs` передають його самі, тож
// сигнатура з одним обов'язковим рядком і є контрактом.
export declare function isEntryPoint(moduleFilename: string): boolean;
