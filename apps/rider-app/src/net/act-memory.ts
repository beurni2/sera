
/**
 * ═══ SE-LIVE-4c-ix · WHAT THE PHONE REMEMBERS ABOUT AN ACT ═══
 *
 * FOUNDER RULING (2026-08-07), on how to close verifier blocker A6:
 * « persisting act on the phone ».
 *
 * ⚠ THE HARM. Act state lived only in React state, and the app performs no
 * custody read (the 4b allowlist deliberately opens none to a rider). So an OS
 * kill between an ACCEPTED verification and the seal — routine on a 1 GB
 * Android, which kills backgrounded apps — left the rider staring at the
 * checklist again, against a pickup code that was already spent.
 * `pickup_code_refused` for ever, `maySeal` never true, the package
 * unsealable. On the target device class that is not an edge case.
 *
 * ═══ ⚠ WHAT IS REMEMBERED, AND WHAT IS DELIBERATELY FORGOTTEN ═══
 *
 * REMEMBERED: which order, and which stage was reached. That is enough to put
 * the rider back where they were.
 *
 * ⚠ `attemptIds` WAS HERE AND IS GONE (verifier blocker A4, round three). It was
 * persisted, round-tripped, documented as « so a retry after a relaunch is still
 * the SAME command to custody and replays rather than re-applying » — and never
 * read back by anything. Worse, it could not have worked: `attemptFor` keys an
 * attempt by its CONTENT, and that content includes the pickup code (which is a
 * secret this file must never hold) and the photo ref (which changes the moment
 * the rider retakes it). A restored id could never match a rebuilt key. A field
 * whose stated purpose is impossible is worse than no field: it reads like the
 * problem is handled.
 *
 * **NEVER WRITTEN: the pickup code, the seal id, or the rider's own code.**
 * They are two of the four secrets and a live credential. The whole reason the
 * custody ACTS are not queued offline (`custody-acts.ts`) is that the outbox
 * writes its payload to the document store in plaintext; remembering the
 * secrets here would smuggle in exactly what that refusal exists to prevent.
 * A rider whose phone was killed re-types the seal id off the seal in their
 * hand and hears the pickup code from the dispatcher again — both are still
 * available to them, and neither has to rest on the device.
 *
 * A test asserts the persisted bytes contain neither secret.
 */

/** The stage this order has reached, as far as the LEDGER told this phone.
 *  VRAI-ROUTE added the two road rungs between the seal and the door —
 *  'departed' and 'arrived' — so an app killed mid-road restores the right
 *  screen instead of re-offering « En route » for a departure the ledger
 *  already holds. Same law as the first three: only ever what the LEDGER
 *  answered, and never a secret. */
export type ActStage = 'none' | 'verification_accepted' | 'custody_taken' | 'departed' | 'arrived';

export interface ActMemory {
  readonly orderId: string;
  readonly stage: ActStage;
}

const KEY = 'custody-act-memory.v1';

/** Reuses the app's existing document-dir store shape — one durable surface,
 *  not a second one nobody remembers to clear. */
export interface ActMemoryStore {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

/**
 * ⚠ `asActMemoryStore(outboxStore)` USED TO LIVE HERE, and it was blocker A1.
 * « The key namespaces them apart » was wrong: the outbox writes a JSON ARRAY
 * and this writes a JSON OBJECT, so sharing one file meant each destroyed the
 * other — a dead SOS in one order, a lost custody stage in the other. The act
 * memory now has its own file (`createDocumentActMemoryStore`). Nothing may
 * hand it the outbox's store again, and `rememberAct` refuses an array root so
 * that a future attempt fails loudly instead of eating the queue.
 */

export async function loadActMemory(store: ActMemoryStore, orderId: string): Promise<ActMemory | null> {
  const raw = await store.read();
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unreadable memory is no memory — never a crash on a rider's launch.
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const held = (parsed as Record<string, unknown>)[KEY];
  if (held === null || typeof held !== 'object') return null;
  const m = held as Record<string, unknown>;
  // ⚠ IT MUST NAME THIS ORDER. Restoring one order's stage onto another is how
  // a rider would be shown a seal screen for goods they never verified.
  if (m['orderId'] !== orderId) return null;
  const stage = m['stage'];
  return {
    orderId,
    stage:
      stage === 'verification_accepted' ||
      stage === 'custody_taken' ||
      stage === 'departed' ||
      stage === 'arrived'
        ? stage
        : 'none',
  };
}

/**
 * Remember a stage. Read-modify-write on one key so this never clobbers
 * whatever else shares the store.
 *
 * ⚠ THE GUARD IS THE TEST THAT SCANS WHAT ACTUALLY LANDS ON DISK — the same
 * shape as the credential scans elsewhere. This function cannot police what a
 * future caller hands it.
 */
export async function rememberAct(store: ActMemoryStore, memory: ActMemory): Promise<void> {
  const raw = await store.read();
  let root: Record<string, unknown> = {};
  if (raw !== null && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      // ⚠ AN ARRAY IS SOMEONE ELSE'S FILE (blocker A1). `typeof [] === 'object'`,
      // so this once accepted the outbox's queue as its root and then wrote it
      // back as an object — silently deleting every pending write, an SOS
      // among them. Refuse loudly rather than destroy what we do not own.
      if (Array.isArray(parsed)) {
        throw new Error('act-memory: refusing to write over a non-memory store');
      }
      if (parsed !== null && typeof parsed === 'object') root = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('act-memory:')) throw error;
      root = {};
    }
  }
  root[KEY] = memory;
  await store.write(JSON.stringify(root));
}

/** Forget this order entirely — used when the rider signs out, so a shared or
 *  handed-on phone carries nothing about someone else's package. */
export async function forgetActs(store: ActMemoryStore): Promise<void> {
  const raw = await store.read();
  if (raw === null || raw === '') return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return;
    const root = parsed as Record<string, unknown>;
    delete root[KEY];
    await store.write(JSON.stringify(root));
  } catch {
    // Nothing readable to forget.
  }
}
