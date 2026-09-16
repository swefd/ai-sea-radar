export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  length: number;
}

/** Лічильник придушених плейсхолдером збігів. Вихідний параметр `scanLine`. */
export interface ScanStats {
  placeholderSuppressed: number;
}

export declare function scanLine(
  line: string,
  stats?: ScanStats | null,
): { pattern: string; length: number }[];
export declare function scanForSecrets(root: string): {
  findings: SecretFinding[];
  scanned: number;
  binarySkipped: number;
  excludedSkipped: number;
  placeholderSuppressed: number;
  vanished: number;
};
