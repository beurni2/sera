import { append, type OutboxStore } from './outbox';
import type { CommandId } from './commandId';

/**
 * SERA-S2 · custody evidence on the outbox (GP-SERA · SE-I06: "Offline evidence
 * may be queued, but custody/delivery validation + financial release remain
 * pending until authoritative SERVER ACK."). The delivery-evidence capture is a
 * durable write intent — it rides the S1 outbox so it survives an app kill and a
 * device reboot, and it is delivered AT-LEAST-ONCE with dedup on the PERSISTED
 * `command_id` (the outbox's `applied | idempotentReplay | collision-refused`,
 * mirroring `assignment-lease.ts`). That flush outcome IS the authoritative ack:
 * only `applied`/`idempotentReplay` unlock the drop (custody-flow
 * `stepAfterEvidenceAck`); merely being online never does.
 *
 * The `command_id` is minted ONCE at the capture gesture (via canon
 * `mintCommandId`) and is the evidence's stable identity — a reboot-retry reuses
 * it, so the authority never records two captures for one photo.
 *
 * This layer OWNS only the durable persistence; the in-memory custody step + its
 * finality lock stay in `demo/store.ts` / `custody-flow.ts`. No franc.
 */

/** The outbox `kind` for a delivery-evidence capture — the sender routes it to the
 * delivery-evidence command; the flush outcome is the authoritative server ack. */
export const EVIDENCE_KIND = 'delivery.evidence';

/** The persisted evidence-capture intent (what a reconnect replays for its ack). */
export interface EvidenceCaptureIntent {
  readonly courseId: string;
  readonly capturedAt: string;
}

/**
 * Persist a delivery-evidence capture to the outbox with its ALREADY-MINTED
 * `command_id` (minted once at the gesture, the capture's identity). Appended
 * `pending`; a reconnect flush carries it with this exact id — never a fresh one.
 * Fire-and-forget from the UI: the in-memory step already showed `evidence_pending`
 * instantly, and it stays LOCKED until the flush returns the authoritative ack.
 */
export async function appendEvidence(
  store: OutboxStore,
  commandId: CommandId,
  intent: EvidenceCaptureIntent,
): Promise<void> {
  await append(store, { commandId, kind: EVIDENCE_KIND, payload: intent, status: 'pending' });
}
