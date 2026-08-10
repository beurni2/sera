/**
 * RENDU-RÉEL — expo-file-system, backed by an in-MEMORY map.
 *
 * ⚠ IT IS A REAL STORE, not a no-op. The act-memory and outbox paths are how a
 * killed app recovers a course, and a double that silently dropped writes
 * would make « the phone remembers » look true when it is not — the exact
 * §9.8 failure. Writes persist for the life of the test process and read back.
 */
const files = new Map<string, string>();

export const Paths = { document: { uri: 'memory://document/' } };

export class File {
  readonly uri: string;
  constructor(dir: { uri: string } | string, name?: string) {
    const base = typeof dir === 'string' ? dir : dir.uri;
    this.uri = name === undefined ? base : `${base}${name}`;
  }
  get exists(): boolean {
    return files.has(this.uri);
  }
  create(): void {
    if (!files.has(this.uri)) files.set(this.uri, '');
  }
  text(): string {
    return files.get(this.uri) ?? '';
  }
  write(contents: string): void {
    files.set(this.uri, contents);
  }
  delete(): void {
    files.delete(this.uri);
  }
}

/** For tests that need a clean phone between courses. */
export function __resetFiles(): void {
  files.clear();
}
