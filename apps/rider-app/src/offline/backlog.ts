import { flush, restore, type OutboxSender, type OutboxStore } from './outbox';

/**
 * SERA-S4 · the truthful backlog + the reconnect drain (GP-SERA · closes the arc).
 * The offline banner shows « Hors ligne : N actions en attente » where N is the
 * REAL count of pending durable writes — never a fake or a guessed number. On
 * reconnect the outbox flushes and the backlog clears to what actually remains
 * (a `collision-refused` write stays counted — surfaced, never a silent drop).
 *
 * Pure over the OutboxStore port; the sender is the only I/O. No custody write, no franc.
 */

/** The real pending count = the durable outbox's queued entries (all persisted
 * entries are `pending`; flush drops the settled ones). This is the banner's N. */
export async function pendingCount(store: OutboxStore): Promise<number> {
  return (await restore(store)).length;
}

/** Reconnect drain: flush the outbox with its persisted command_ids (at-least-once,
 * dedup at the authority), then return the count that REMAINS — the banner reads it
 * and clears with the backlog. Applied/idempotentReplay settle and drop; a
 * collision-refused write is kept and still counted (never silently vanished). */
export async function drainOnReconnect(store: OutboxStore, send: OutboxSender): Promise<number> {
  await flush(store, send);
  return pendingCount(store);
}
