// Ручні декларації: tsconfig має allowJs: false, тож імпорт цього .mjs із .spec.ts —
// TS7016. Тримати синхронно з експортами руками; розбіжність ловить `check-types`.
export type VersionMap = Record<string, string>;

export declare const ALLOWED: {
  dependencies: VersionMap;
  devDependencies: VersionMap;
};

/**
 * Вхід — `unknown`, а не `Record<string, unknown>`, і це навмисне відхилення від
 * брифа: маніфест приходить із `JSON.parse`, тобто типом не є нічим, а варта на
 * не-об'єкт усередині функції — частина її контракту, а не оборона понад нього.
 * З вужчим оголошенням тест на цю варту довелося б писати через каст, тобто
 * документувати найважливішу гілку як порушення типів.
 */
export declare function checkManifest(manifest: unknown): string[];
