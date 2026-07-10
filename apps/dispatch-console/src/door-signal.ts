import { PlatformEventSchema } from '@platform/contracts';
import { checkProducerActor } from '@sera/custody-service/actor-provenance';

/**
 * WO-2.7 item 2 (WO-2.4 NB⑤) — the console's door-payment line is
 * SIGNAL-DRIVEN: « Confirmé par le réseau » renders ONLY when a lawful
 * `payment.door_leg_confirmed.v1` has actually been consumed here — strict
 * parse, actor provenance (item 1's registry — one registry, imported, not
 * copied), duplicate absorption. Before the signal: an honest pending line.
 * This is a VIEW-side follower — custody truth stays in the spine
 * (consumeDoorPaidSignal); at E2 assembly this follower subscribes to the
 * live event stream instead of the sandbox emitter.
 */
export class DoorSignalFollower {
  private confirmedOrders = new Set<string>();
  private consumedCommandIds = new Set<string>();

  consume(raw: unknown): { ok: true; duplicate: boolean } | { ok: false; reason: 'signal_invalid' | 'producer_actor_mismatch' } {
    const parsed = PlatformEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.name !== 'payment.door_leg_confirmed.v1') {
      return { ok: false, reason: 'signal_invalid' };
    }
    const event = parsed.data;
    const provenance = checkProducerActor(event.name, event.envelope.actor);
    if (!provenance.ok) return { ok: false, reason: 'producer_actor_mismatch' };
    if (this.consumedCommandIds.has(event.envelope.command_id)) return { ok: true, duplicate: true };
    this.consumedCommandIds.add(event.envelope.command_id);
    const orderId = (event.payload as Record<string, unknown>)['order_id'];
    if (typeof orderId === 'string') this.confirmedOrders.add(orderId);
    return { ok: true, duplicate: false };
  }

  isConfirmed(orderId: string): boolean {
    return this.confirmedOrders.has(orderId);
  }
}
