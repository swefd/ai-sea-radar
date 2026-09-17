import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface CheckResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Playwright запускає тести з теки, де лежить `playwright.config.ts`, тобто з кореня
 * репозиторію. Якщо це колись перестане бути правдою, тест мусить сказати «скрипта
 * немає», а не «перевірка впала»: підміна причини — рівно те, від чого весь шар.
 */
export function checkPath(fileName: string): string {
  const full = path.resolve(process.cwd(), 'scripts/verify/checks', fileName);
  if (!existsSync(full)) {
    throw new Error(`Скрипта перевірки немає за шляхом ${full} (cwd: ${process.cwd()})`);
  }
  return full;
}

/** Запускає перевірку тим самим інтерпретатором, що й Playwright — без оболонки. */
export function runCheck(fileName: string, ...args: string[]): CheckResult {
  const result = spawnSync(process.execPath, [checkPath(fileName), ...args], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

export function writeFixtureFiles(root: string, files: Record<string, string>): void {
  for (const [relPath, contents] of Object.entries(files)) {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

/** Тека без git — для перевірок, що читають лише конкретний файл. */
export function makeFixtureDir(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sea-radar-check-'));
  writeFixtureFiles(root, files);
  return root;
}

/** Справжній git-репозиторій: `--exclude-standard` — саме те, що має працювати. */
export function makeFixtureRepo(files: Record<string, string>): string {
  const root = makeFixtureDir(files);
  // `init.defaultBranch` задано явно — так само, як у hash.spec.ts: `init -q` не
  // глушить пораду про гілку за замовчуванням, тож без цього вивід фікстури
  // залежав би від глобального ~/.gitconfig машини, на якій її створили.
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root });
  return root;
}

export function removeFixture(root: string): void {
  rmSync(root, { recursive: true, force: true });
}
