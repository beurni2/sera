/**
 * RENDU-RÉEL — expo-file-system, backed by an in-MEMORY map.
 *
 * ⚠ IT IS A REAL STORE, not a no-op. The act-memory and outbox paths are how a
 * killed app recovers a course, and a double that silently dropped writes
 * would make « the phone remembers » look true when it is not — the exact
 * §9.8 failure. Writes persist for the life of the test process and read back.
 *
 * ⚠ ITS BOUNDS ARE THE INSTALLED NATIVE CODE'S (expo-file-system 57.0.6,
 * Android, `FileSystemFile.kt`, `FileSystemPath.kt`, `fsops/CopyMoveStrategy.kt`),
 * and it is never kinder than that code:
 *
 *   · `write` TRUNCATES FIRST, then writes (`outputStream(append = false)`):
 *     a phone that dies mid-write leaves an empty or half file, never the old
 *     one. A write the disk refuses has already truncated when it throws.
 *   · `create` THROWS when the file exists (`createNewFile` returns false).
 *   · `move(dest, { overwrite: true })` DELETES THE DESTINATION FIRST, then
 *     renames — a phone that dies between the two leaves no destination and a
 *     whole source. Without `overwrite` it throws when the destination exists.
 *     A missing source throws.
 *   · `text()` is asynchronous and throws on a missing file.
 *   · `rename` is not modelled: nothing in the app calls it.
 *
 * The `__` controls stand for what a phone does on its own — dying, a full
 * disk. They never make an operation succeed that the native code would fail.
 */
const files = new Map<string, string>();

/** A phone that dies at one exact point, on the next operation on a file whose
 *  name STARTS WITH `name` (so `sera-outbox.json` covers its `.tmp` too).
 *  One-shot: it fires once, then clears. */
export type Death =
  | { readonly at: 'write-truncated'; readonly name: string }
  | { readonly at: 'write-half'; readonly name: string }
  | { readonly at: 'move-before'; readonly name: string }
  | { readonly at: 'move-after-delete'; readonly name: string };

let death: Death | null = null;
let refusing: string | null = null;

/** What the test sees when the stand-in phone dies: nothing after it ran. */
export class PhoneDied extends Error {
  constructor(at: string) {
    super(`the phone died (${at})`);
  }
}

const nameOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1);

export const Paths = { document: { uri: 'memory://document/' } };

export class File {
  uri: string;
  constructor(dir: { uri: string } | string, name?: string) {
    const base = typeof dir === 'string' ? dir : dir.uri;
    this.uri = name === undefined ? base : `${base}${name}`;
  }
  get exists(): boolean {
    return files.has(this.uri);
  }
  create(): void {
    if (files.has(this.uri)) throw new Error('UnableToCreateException: file already exists or could not be created');
    files.set(this.uri, '');
  }
  async text(): Promise<string> {
    const held = files.get(this.uri);
    if (held === undefined) throw new Error(`FileNotFound: ${this.uri}`);
    return held;
  }
  write(contents: string): void {
    const name = nameOf(this.uri);
    files.set(this.uri, '');
    if (refusing !== null && name.includes(refusing)) throw new Error('ENOSPC: no space left on device');
    if (death !== null && name.startsWith(death.name) && death.at === 'write-truncated') {
      death = null;
      throw new PhoneDied('write-truncated');
    }
    if (death !== null && name.startsWith(death.name) && death.at === 'write-half') {
      death = null;
      files.set(this.uri, contents.slice(0, Math.floor(contents.length / 2)));
      throw new PhoneDied('write-half');
    }
    files.set(this.uri, contents);
  }
  async move(dest: File, options?: { overwrite?: boolean }): Promise<void> {
    const name = nameOf(this.uri);
    const held = files.get(this.uri);
    if (death !== null && name.startsWith(death.name) && death.at === 'move-before') {
      death = null;
      throw new PhoneDied('move-before');
    }
    if (held === undefined) throw new Error(`UnableToMoveException: no source at ${this.uri}`);
    if (files.has(dest.uri)) {
      if (options?.overwrite !== true) throw new Error('DestinationAlreadyExistsException');
      files.delete(dest.uri);
    }
    if (death !== null && name.startsWith(death.name) && death.at === 'move-after-delete') {
      death = null;
      throw new PhoneDied('move-after-delete');
    }
    files.delete(this.uri);
    files.set(dest.uri, held);
    this.uri = dest.uri;
  }
  delete(): void {
    files.delete(this.uri);
  }
}

/** For tests that need a clean phone between courses. */
export function __resetFiles(): void {
  files.clear();
  death = null;
  refusing = null;
}

/** The phone dies at this point of the next matching operation. */
export function __dieAt(d: Death | null): void {
  death = d;
}

/** Every write to a file whose name contains this fragment hits a full disk
 *  (`null` gives the space back). */
export function __refuseWrites(fragment: string | null): void {
  refusing = fragment;
}

/** What is on the stand-in phone right now, by file name. */
export function __files(): Record<string, string> {
  return Object.fromEntries([...files].map(([uri, body]) => [nameOf(uri), body]));
}

/** Put bytes on the phone as an earlier app (or a dying one) left them. */
export function __seed(name: string, body: string): void {
  files.set(`${Paths.document.uri}${name}`, body);
}
