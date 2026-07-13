/**
 * WO-6.3 — Séra rider SAFETY rule source (SE8: "SOS visible from every rider
 * flow; ack within SLA; secure/quarantine custody; live drill before pilot").
 * Mirrors the custody-flow.ts pattern: PURE functions + typed sandbox
 * constants where BOTH branches are real code paths. The SERVICE emits the
 * canonical events; this shell only reflects them. No franc anywhere — Séra
 * emits signals, never money.
 */

/**
 * The three canonical SOS / incident event names. These MIRROR the pinned
 * @platform/contracts EVENT_NAMES (safety.sos_created.v1 ·
 * safety.sos_acknowledged.v1 · incident.opened.v1) — the SERVICE emits them,
 * the shell reflects. Names are never invented here.
 */
export const SOS_EVENTS = {
  created: 'safety.sos_created.v1',
  acknowledged: 'safety.sos_acknowledged.v1',
  incidentOpened: 'incident.opened.v1',
} as const;

export type SosStatus = 'queued' | 'raised' | 'escalated' | 'acknowledged';
export type SosResponder = 'dispatcher' | 'founder';
export type DispatchHours = 'in_hours' | 'out_of_hours';

/**
 * ACK SLA — a 60 s in-hours ack TARGET: a CTO SAFEST-DEFAULT (flagged) on the
 * OPEN SLA decision (⏳ Sera-Build-Spec:185 / Sera-Building-Plan:76 "ack within
 * SLA (named)"), versioned and founder-tunable. It is NOT a settled value — the
 * live drill MEASURES the actual ack time against it (founder ruling 2026-07-12,
 * WO-6.3 ②). Stored as VERSIONED POLICY DATA so it stays tunable at pilot, never
 * silently. NOT a timer that fakes an acknowledgment: an ack lands only through
 * acknowledgeSos (which throws on a queued incident).
 */
export const SOS_ACK_SLA_POLICY = {
  version: 'sos-ack-sla.v1',
  inHoursTargetSeconds: 60,
} as const;

/**
 * Sandbox dispatch-hours (typed data like custody-flow's CONNECTIVITY): BOTH
 * branches are REAL paths. 'in_hours' → the DISPATCHER answers on the console;
 * 'out_of_hours' → the SOS escalates to the FOUNDER's phone. The live clock /
 * on-call roster feed drives this value at assembly; the rider never sets it.
 */
export const SANDBOX_DISPATCH_HOURS: DispatchHours = 'in_hours';

/**
 * The out-of-hours escalation TRANSPORT (SMS / push / call) is an OPEN founder
 * item — WO-6.3 §2. The PATH is built and the state is real; the transport is
 * unbound (channel null). We NEVER fake an acknowledgment on an unbound
 * channel — the honesty law is structural (acknowledgeSos throws on queued).
 */
export const ESCALATION_TRANSPORT = { status: 'pending', channel: null } as const;

/** In dispatch hours the dispatcher answers; out of hours it is the founder. */
export function responderForHours(hours: DispatchHours): SosResponder {
  return hours === 'in_hours' ? 'dispatcher' : 'founder';
}

/** In-hours a raised SOS is 'raised' (dispatcher); out-of-hours 'escalated'. */
export function raisedStatusForHours(hours: DispatchHours): 'raised' | 'escalated' {
  return hours === 'in_hours' ? 'raised' : 'escalated';
}
