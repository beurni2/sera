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

/**
 * Is this exact write still undelivered?
 *
 * ⚠ WRITTEN FOR THE SOS (verifier blocker A4). `drainOnReconnect` answers « how
 * many remain », which cannot tell a rider whether THEIR alert got out — and
 * « Séra a reçu l'alerte » is a sentence that must never be shown on a guess.
 * `flush` drops what settled, so an entry that is gone from the queue is one
 * the server acknowledged, and one still present is one still owed.
 */
export async function stillPending(store: OutboxStore, commandId: string): Promise<boolean> {
  return (await restore(store)).some((entry) => entry.commandId === commandId);
}
