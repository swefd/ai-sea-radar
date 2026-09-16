export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  length: number;
}

export declare function scanLine(line: string): { pattern: string; length: number }[];
export declare function scanForSecrets(root: string): {
  findings: SecretFinding[];
  scanned: number;
  binarySkipped: number;
  excludedSkipped: number;
};
