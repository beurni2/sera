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
