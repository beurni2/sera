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
 * with a temp-file fake; this adapter is the device binding (its native surface
 * never runs under vitest). No custody write, no franc.
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

export function createDocumentOutboxStore(): OutboxStore {
  const handle = (): File => new File(Paths.document, OUTBOX_FILE);
  return {
    async read(): Promise<string | null> {
      const file = handle();
      return file.exists ? await file.text() : null;
    },
    async write(serialized: string): Promise<void> {
      const file = handle();
      if (!file.exists) file.create();
      file.write(serialized);
    },
  };
}

/** The act memory's own durable surface — same document dir, same thin I/O,
 *  SEPARATE FILE. Same `read`/`write` port shape, so nothing else changes. */
export function createDocumentActMemoryStore(): OutboxStore {
  const handle = (): File => new File(Paths.document, ACT_MEMORY_FILE);
  return {
    async read(): Promise<string | null> {
      const file = handle();
      return file.exists ? await file.text() : null;
    },
    async write(serialized: string): Promise<void> {
      const file = handle();
      if (!file.exists) file.create();
      file.write(serialized);
    },
  };
}
