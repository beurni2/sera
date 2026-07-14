import { mintCommandId, type CommandId } from './commandId';

/**
 * SERA-S1 · the PERSISTENT OUTBOX primitive (GP-SERA · SE-I06: offline writes may
 * be queued, but finality waits for the authoritative server ack; the envelope law
 * `command_id`, Execution-Contract §5.6). Mirrors the in-repo B2.1 pattern already
 * realized server-side in `logistics-service/assignment-lease.ts` (idempotent on
 * `command_id`; only successes settle): the CLIENT half of exactly-once.
 *
 * The rule the founder ruling forces (`COMMAND-ID-MINT.md`): the `command_id` is
 * minted CLIENT-SIDE, exactly ONCE at intent, PERSISTED with the entry, and NEVER
 * recomputed — the anti-pattern being killed is `sos-${riderId}-${raisedAt}`
 * (`demo/store.ts:396`), an id minted per ATTEMPT that a reboot-retry regenerates,
 * so the authority sees two commands (a lost action shown pending forever, or a
 * double-charge).
 *
 * PURE + PORT-BASED: persistence is a `OutboxStore` port (the document-dir adapter
 * on device, a temp-file/in-memory fake in tests). No custody write, no screen, no
 * franc. SERA-S1 wires nothing — S2/S3 route real writes through this next.
 */

/** A durable write intent — its `command_id` is minted once and travels unchanged. */
export interface OutboxEntry {
  readonly commandId: CommandId;
  /** The write kind (e.g. a future 'sos.raise' / 'delivery.evidence') — opaque here. */
  readonly kind: string;
  /** The command payload — opaque to the outbox; serialized as-is. */
  readonly payload: unknown;
  /** 'pending' until the authority settles it; queued = pending, never done offline. */
  readonly status: 'pending' | 'settled';
}

/** The persistence port. Implemented by the expo-file-system document-dir store on
 * device (survives kill+reboot); faked in tests. Read returns null when unset. */
export interface OutboxStore {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

/**
 * The idempotent outcome the authority surfaced for one flushed entry — the lease's
 * vocabulary (`assignment-lease.ts`): `applied` (accepted for the first time) ·
 * `idempotentReplay` (this `command_id` was already applied — no second effect) ·
 * `collision-refused` (refused: a conflicting command, e.g. `rider_already_leased`).
 */
export type FlushOutcome = 'applied' | 'idempotentReplay' | 'collision-refused';

/** Carries an entry to the authority WITH ITS PERSISTED `command_id`, returns the
 * surfaced idempotent outcome. The real sender posts to the service at assembly. */
export type OutboxSender = (entry: OutboxEntry) => Promise<FlushOutcome>;

const serialize = (entries: readonly OutboxEntry[]): string => JSON.stringify(entries);
const deserialize = (raw: string): OutboxEntry[] => JSON.parse(raw) as OutboxEntry[];

/**
 * Restore-on-open: read the persisted queue. On the document dir this survives an
 * app kill and a device reboot (unlike the cache dir); an empty/absent store is [].
 */
export async function restore(store: OutboxStore): Promise<OutboxEntry[]> {
  const raw = await store.read();
  return raw === null || raw === '' ? [] : deserialize(raw);
}

/**
 * Persist a pre-built entry whose `command_id` was ALREADY minted once at intent
 * (e.g. the SOS raise mints at the gesture, for instant UI, then persists in the
 * background). The entry's id is never recomputed here. `enqueue` = mint + append.
 */
export async function append(store: OutboxStore, entry: OutboxEntry): Promise<void> {
  const existing = await restore(store);
  await store.write(serialize([...existing, entry]));
}

/**
 * Enqueue a write intent: mint the `command_id` ONCE here, persist
 * `{commandId, kind, payload, status:'pending'}`. The minted id is the one every
 * later flush/retry reuses — it is never recomputed.
 */
export async function enqueue(store: OutboxStore, kind: string, payload: unknown): Promise<OutboxEntry> {
  const entry: OutboxEntry = { commandId: mintCommandId(), kind, payload, status: 'pending' };
  await append(store, entry);
  return entry;
}

export interface FlushResult {
  readonly commandId: CommandId;
  readonly outcome: FlushOutcome;
}

/**
 * Flush-on-reconnect: carry each PENDING entry to the authority with its PERSISTED
 * `command_id` (never re-minted), record the surfaced outcome, and persist the
 * settled queue. `applied`/`idempotentReplay` settle and drop from pending (the
 * authority holds the truth — a replay is not a second effect); `collision-refused`
 * is SURFACED and KEPT pending (the caller resolves it — the outbox never silently
 * drops a refused command). Pure over the store; the sender is the only I/O.
 */
export async function flush(store: OutboxStore, send: OutboxSender): Promise<FlushResult[]> {
  const entries = await restore(store);
  const results: FlushResult[] = [];
  const remaining: OutboxEntry[] = [];
  for (const entry of entries) {
    if (entry.status !== 'pending') {
      remaining.push(entry);
      continue;
    }
    const outcome = await send(entry); // send carries entry.commandId — the persisted one, unchanged
    results.push({ commandId: entry.commandId, outcome });
    if (outcome === 'collision-refused') {
      remaining.push(entry); // surfaced, kept for the caller — never a silent drop
    }
    // 'applied' | 'idempotentReplay' → settled at the authority; dropped from pending
  }
  await store.write(serialize(remaining));
  return results;
}
