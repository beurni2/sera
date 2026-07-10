/**
 * WO-2.7 item 1 — ACTOR PROVENANCE, the IN-PROCESS layer (WO-2.4 NB③).
 * Every signal Séra consumes carries envelope.actor; this registry names,
 * per event name, the ONE producer class allowed to emit it, and classifies
 * actors by prefix. A consumed signal whose actor is not in its event's
 * registered producer class is REFUSED CLOSED and raises
 * reconciliation.alert.v1 at the consumption point.
 *
 * SCOPE, stated explicitly: this is the in-process layer BENEATH E3's
 * transport-level webhook authenticity (signature verification — the
 * Real-Money-Gate item). It is NOT a replacement: an in-process actor
 * string is claims, not proof; E3 adds the cryptographic transport root
 * and this layer keeps catching in-process mis-wiring after it.
 *
 * Versioned DATA: mock actors stand in for their real producer classes
 * until E1/E2 assembly replaces them — swapping an entry is a data change,
 * never a logic change.
 */

export const ACTOR_PROVENANCE_V1 = {
  version: 'actor-provenance.v1',
  /** event name → the ONE producer class lawfully emitting it. */
  producerClassByEvent: {
    'payment.checkout_leg_confirmed.v1': 'payment_provider',
    'payment.door_leg_confirmed.v1': 'payment_provider',
    'delivery.evidence_submitted.v1': 'custody',
    'delivery.validated.v1': 'custody',
    'protection.claim_opened.v1': 'custody',
    'settlement.supplier_payable.v1': 'commerce_settlement',
    'logistics.task_ready.v1': 'logistics',
  },
  /** actor prefix → producer class (first match wins). Mock entries are the
   * §3 stand-ins until assembly. */
  actorPrefixClasses: [
    { prefix: 'shop:commerce-core', producerClass: 'payment_provider' },
    { prefix: 'mock:shop-door-payment-emitter', producerClass: 'payment_provider' },
    { prefix: 'custody-service:', producerClass: 'custody' },
    { prefix: 'mock:commerce-eligibility-consumer', producerClass: 'commerce_settlement' },
    { prefix: 'logistics-service:', producerClass: 'logistics' },
    { prefix: 'dispatcher:', producerClass: 'dispatch' },
  ],
} as const;

export type ProvenanceCheck =
  | { ok: true; producerClass: string }
  | { ok: false; reason: 'producer_actor_mismatch'; eventName: string; actor: string; expectedClass: string; actorClass: string | null };

/**
 * Closed check: an unregistered event name or an unclassifiable actor is a
 * mismatch, never a pass — provenance that cannot be established does not
 * exist.
 */
export function checkProducerActor(eventName: string, actor: string): ProvenanceCheck {
  const expectedClass =
    ACTOR_PROVENANCE_V1.producerClassByEvent[eventName as keyof typeof ACTOR_PROVENANCE_V1.producerClassByEvent];
  const actorClass =
    ACTOR_PROVENANCE_V1.actorPrefixClasses.find((entry) => actor.startsWith(entry.prefix))?.producerClass ?? null;
  if (expectedClass === undefined) {
    return { ok: false, reason: 'producer_actor_mismatch', eventName, actor, expectedClass: 'unregistered_event', actorClass };
  }
  if (actorClass !== expectedClass) {
    return { ok: false, reason: 'producer_actor_mismatch', eventName, actor, expectedClass, actorClass };
  }
  return { ok: true, producerClass: actorClass };
}
