// Ручні декларації до stdout.mjs (R-08): tsconfig має allowJs: false, тож без
// них імпорт .mjs із .ts — TS7016.
//
// Повертається число БАЙТІВ, а не рядок і не void: різниця між «дійшло все» і
// «дійшло стільки» — це те саме питання, заради якого модуль існує.
export type RawWrite = (fd: number, buffer: Buffer, offset: number, length: number) => number;

export declare function writeAllSync(fd: number, text: string, write?: RawWrite): number;
