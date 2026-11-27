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
  /** Keep bytes that do not read as this store's file under a new name. They
   *  are never parsed again and never deleted: a damaged queue may still hold
   *  a rider's SOS, and only a person may decide it is gone. */
  keepAside(raw: string): Promise<void>;
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

/**
 * ONE READ-MODIFY-WRITE AT A TIME, PER STORE. Two of them interleaving is how a
 * second SOS was lost: both read the same list, and the later write erased the
 * other's entry. Every read and write of a store runs in this lane, in order.
 * ⚠ Nothing in it ever waits on the network — a send that hangs for 15 s must
 * never hold up the save of the next alert.
 */
const lanes = new WeakMap<object, Promise<unknown>>();
export function inLane<T>(store: object, work: () => Promise<T>): Promise<T> {
  const run = (lanes.get(store) ?? Promise.resolve()).then(work);
  lanes.set(store, run.catch(() => undefined));
  return run;
}

/** The entries some drain of this store is sending right now. Another drain
 *  leaves them to it, so a new SOS is never queued behind a send that hangs. */
const inFlight = new WeakMap<object, Set<string>>();

/**
 * Read the queue. Bytes that are not a list — half a file, the old shared
 * shape, or a file that exists with zero bytes — are DAMAGED: kept aside, never
 * parsed as truth, and a fresh list starts, so the next save works instead of
 * failing for ever. Call it only inside the lane.
 *
 * Zero bytes is never something this outbox writes (an empty list is « [] »):
 * it is what a dead in-place write or a power loss right after a move leaves,
 * and whatever SOS it held is gone. Only NO file at all is a new phone.
 */
async function readQueue(store: OutboxStore): Promise<OutboxEntry[]> {
  const raw = await store.read();
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (Array.isArray(parsed)) return parsed as OutboxEntry[];
  await store.keepAside(raw);
  await store.write(serialize([]));
  return [];
}

/**
 * Restore-on-open: read the persisted queue. On the document dir this survives an
 * app kill and a device reboot (unlike the cache dir); an empty/absent store is [].
 */
export function restore(store: OutboxStore): Promise<OutboxEntry[]> {
  return inLane(store, () => readQueue(store));
}

/**
 * Persist a pre-built entry whose `command_id` was ALREADY minted once at intent
 * (e.g. the SOS raise mints at the gesture, for instant UI, then persists in the
 * background). The entry's id is never recomputed here. `enqueue` = mint + append.
 */
export function append(store: OutboxStore, entry: OutboxEntry): Promise<void> {
  return inLane(store, async () => {
    const existing = await readQueue(store);
    await store.write(serialize([...existing, entry]));
  });
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
 *
 * ⚠ IT REMOVES WHAT SETTLED, IT DOES NOT WRITE BACK WHAT IT READ. The sends run
 * outside the lane, so a rider can save another SOS while one is in the air;
 * writing back the list read before the sends erased that SOS. The file is read
 * again, in the lane, and only the ids this flush settled leave it.
 */
export async function flush(store: OutboxStore, send: OutboxSender): Promise<FlushResult[]> {
  const entries = await restore(store);
  const sending = inFlight.get(store) ?? new Set<string>();
  inFlight.set(store, sending);
  const results: FlushResult[] = [];
  const settled = new Set<string>();
  for (const entry of entries) {
    // Not pending, or already in the air from another drain: left where it is.
    if (entry.status !== 'pending' || sending.has(entry.commandId)) continue;
    sending.add(entry.commandId);
    let outcome: FlushOutcome;
    try {
      outcome = await send(entry); // send carries entry.commandId — the persisted one, unchanged
    } finally {
      sending.delete(entry.commandId);
    }
    results.push({ commandId: entry.commandId, outcome });
    // 'applied' | 'idempotentReplay' → settled at the authority; dropped from pending.
    // 'collision-refused' → surfaced, kept for the caller — never a silent drop.
    if (outcome !== 'collision-refused') settled.add(entry.commandId);
  }
  if (settled.size > 0) {
    await inLane(store, async () => {
      const now = await readQueue(store);
      await store.write(serialize(now.filter((entry) => !settled.has(entry.commandId))));
    });
  }
  return results;
}
