import { File, Paths } from 'expo-file-system';
import type { OutboxStore } from './outbox';

/**
 * SERA-S1 · the DEVICE persistence adapter for the outbox — `expo-file-system`
 * (the boutik `expoDocumentStore` pattern, derived for Séra). It writes to the
 * **document directory** (`Paths.document`): the store "safe from being deleted by
 * the system" — it survives an app kill AND a device reboot, unlike the cache dir.
 * That durability is the whole point (GP-SERA: today the queue is an in-memory
 * label lost on kill).
 *
 * Thin I/O only — the outbox logic + the three fixtures test the `OutboxStore` PORT
 * with a temp-file fake; this adapter is the device binding (under vitest it runs
 * on `test/doubles/expo-file-system`, whose bounds are the native code's). No
 * custody write, no franc.
 */

const OUTBOX_FILE = 'sera-outbox.json';

/**
 * ⚠ THE ACT MEMORY GETS ITS OWN FILE, AND THIS IS NOT TIDINESS (blocker A1,
 * round four). It was pointed at the OUTBOX's file via `asActMemoryStore`, and
 * the two write INCOMPATIBLE TOP-LEVEL SHAPES into it: the outbox serialises a
 * JSON **array**, the act memory a JSON **object**. Whichever wrote first was
 * destroyed by the other, and both outcomes were live on a wired build:
 *
 *   · memory first, then the rider holds the SOS disc → `append` throws
 *     « existing is not iterable », the whole `.then` chain is skipped, so the
 *     alert is NEVER persisted and NEVER sent — while the sheet says « Alerte
 *     en cours d'envoi… ». A dead SOS that claims to be in flight.
 *   · an SOS (or any queued write) first, then a verification accepted → the
 *     stage is silently dropped, no error, `setPersistFailed` never fires. On
 *     the next OS kill the rider is back on the checklist against a pickup
 *     code the spine already consumed — exactly the harm ruling ③ was ordered
 *     to close.
 *
 * Two files, two shapes, no shared root. Reproduced against the real modules
 * before the fix and pinned by a test after it.
 */
const ACT_MEMORY_FILE = 'sera-act-memory.json';

const keptAsideListeners = new Set<() => void>();

/** Hear about every file kept aside, so the rider can be told. Returns the way
 *  to stop listening. */
export function onFileKeptAside(listener: () => void): () => void {
  keptAsideListeners.add(listener);
  return () => {
    keptAsideListeners.delete(listener);
  };
}

/**
 * ONE FILE, WRITTEN SO THAT A DYING PHONE NEVER TEARS THE ONLY COPY.
 *
 * The native `write` truncates before it writes, so writing the real file in
 * place left half a list — or nothing — when the phone died mid-write. The new
 * bytes go to `<name>.tmp` first, and only a whole `.tmp` is moved over the
 * real file. The native `move` deletes the destination before it renames, so a
 * phone that dies between the two leaves no real file and a whole `.tmp` that
 * holds the newest list: that `.tmp` is moved into place before anything reads
 * or writes again, and before a new `.tmp` could overwrite it.
 */
function documentFile(name: string): OutboxStore {
  const main = (): File => new File(Paths.document, name);
  const tmp = (): File => new File(Paths.document, `${name}.tmp`);
  const promote = async (): Promise<void> => {
    const real = main();
    const pending = tmp();
    if (!real.exists && pending.exists) await pending.move(real);
  };
  return {
    async read(): Promise<string | null> {
      await promote();
      const file = main();
      return file.exists ? await file.text() : null;
    },
    async write(serialized: string): Promise<void> {
      await promote();
      const next = tmp();
      if (!next.exists) next.create();
      next.write(serialized);
      await next.move(main(), { overwrite: true });
    },
    async keepAside(raw: string): Promise<void> {
      // `create` refuses an existing file, so kept bytes are never overwritten.
      const kept = new File(Paths.document, name.replace(/\.json$/, `.damaged-${Date.now()}.json`));
      kept.create();
      kept.write(raw);
      for (const listener of keptAsideListeners) listener();
    },
  };
}

/**
 * ONE STORE OBJECT PER FILE FOR THE LIFE OF THE APP. The outbox lane is keyed
 * by store object; a second object over the same file would get a lane of its
 * own, and its writes could overlap the first one's.
 */
let outboxStore: OutboxStore | null = null;
let actMemoryStore: OutboxStore | null = null;

export function createDocumentOutboxStore(): OutboxStore {
  return (outboxStore ??= documentFile(OUTBOX_FILE));
}

/** The act memory's own durable surface — same document dir, same thin I/O,
 *  SEPARATE FILE. Same `read`/`write` port shape, so nothing else changes. */
export function createDocumentActMemoryStore(): OutboxStore {
  return (actMemoryStore ??= documentFile(ACT_MEMORY_FILE));
}
