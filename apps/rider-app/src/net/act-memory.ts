import type { OutboxStore } from '../offline/outbox';

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
 * REMEMBERED: which order, which stage was reached, and the `command_id` of
 * each attempt. That is enough to put the rider back where they were and to
 * make a retry idempotent at custody.
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

/** The stage this order has reached, as far as the LEDGER told this phone. */
export type ActStage = 'none' | 'verification_accepted' | 'custody_taken';

export interface ActMemory {
  readonly orderId: string;
  readonly stage: ActStage;
  /** The attempt ids already used, so a retry after a relaunch is still the
   *  SAME command to custody and replays rather than re-applying. */
  readonly attemptIds: Readonly<Record<string, string>>;
}

const KEY = 'custody-act-memory.v1';

/** Reuses the app's existing document-dir store shape — one durable surface,
 *  not a second one nobody remembers to clear. */
export interface ActMemoryStore {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

/** The outbox's store satisfies this too; the key namespaces them apart. */
export const asActMemoryStore = (store: OutboxStore): ActMemoryStore => store;

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
    stage: stage === 'verification_accepted' || stage === 'custody_taken' ? stage : 'none',
    attemptIds:
      m['attemptIds'] !== null && typeof m['attemptIds'] === 'object'
        ? (m['attemptIds'] as Record<string, string>)
        : {},
  };
}

/**
 * Remember a stage. Read-modify-write on one key so this never clobbers
 * whatever else shares the store.
 *
 * ⚠ THE CALLER MUST PASS ONLY IDS. This function cannot police what a future
 * caller puts in `attemptIds`, so the guard is the test that scans what
 * actually lands on disk — the same shape as the credential scans elsewhere.
 */
export async function rememberAct(store: ActMemoryStore, memory: ActMemory): Promise<void> {
  const raw = await store.read();
  let root: Record<string, unknown> = {};
  if (raw !== null && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') root = parsed as Record<string, unknown>;
    } catch {
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
