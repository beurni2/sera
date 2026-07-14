import type { DispatchHours } from '../safety';
import { append, type OutboxStore } from './outbox';
import type { CommandId } from './commandId';

/**
 * SERA-S3 · SOS on the outbox (GP-SERA · the drill's software half). The rider's
 * SOS raise is a durable write intent — it rides the S1 outbox so it survives an
 * app kill and a device reboot, and it is delivered AT-LEAST-ONCE with dedup on
 * the PERSISTED `command_id` (the outbox's `applied | idempotentReplay |
 * collision-refused`, mirroring `assignment-lease.ts`).
 *
 * The `command_id` is minted ONCE at the gesture (in the raise, via canon
 * `mintCommandId`) and is the incident's stable identity — it replaces the old
 * per-attempt id `sos-${riderId}-${raisedAt}` (`demo/store.ts`), which a
 * reboot-retry regenerated (two SOS for one press, or a lost SOS shown pending).
 * The ack path is untouched: a queued SOS is still unacknowledgeable (throws).
 *
 * This layer OWNS only the durable persistence; the in-memory incident + its
 * honesty laws stay in `demo/store.ts`. No franc, no custody write.
 */

/** The outbox `kind` for a SOS raise — the sender routes it to `safety.sos_created.v1`. */
export const SOS_RAISE_KIND = 'sos.raise';

/** The persisted SOS-raise intent (what a reconnect replays). */
export interface SosRaiseIntent {
  readonly riderId: string;
  readonly hours: DispatchHours;
  readonly onShift: boolean;
  readonly activeCourseId: string | null;
  readonly raisedAt: string;
}

/**
 * Persist a SOS raise to the outbox with its ALREADY-MINTED `command_id` (minted
 * once at the gesture, the incident's identity). Appended `pending`; a reconnect
 * flush carries it with this exact id — never a fresh one. Fire-and-forget from
 * the UI: the in-memory incident already showed instantly.
 */
export async function appendSosRaise(
  store: OutboxStore,
  commandId: CommandId,
  intent: SosRaiseIntent,
): Promise<void> {
  await append(store, { commandId, kind: SOS_RAISE_KIND, payload: intent, status: 'pending' });
}
