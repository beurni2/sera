/**
 * Rider-shell custody flow model (WO-1.3). The check ids MIRROR
 * pickup-verification-policy.v1 — the SERVICE owns the policy; the shell
 * renders its checklist from these ids via catalog keys `check.<id>`.
 * Offline law: evidence sent without the network is queued = PENDING and
 * the drop step stays LOCKED — finality never happens offline. The sandbox
 * has no live connectivity wiring (it lands at E1 assembly): CONNECTIVITY
 * below is typed data, and both branches are real code paths.
 */

export const POLICY_CHECK_IDS = [
  'order_ref',
  'identity',
  'variant',
  'colour',
  'size_label',
  'qty',
  'damage',
  'pieces',
  'manufacturer_seal',
] as const;
export type PolicyCheckId = (typeof POLICY_CHECK_IDS)[number];

export type CustodyStep =
  | 'verify'
  | 'refused'
  | 'seal'
  | 'evidence'
  | 'evidence_pending'
  | 'drop'
  | 'delivered';

/** Sandbox connectivity: 'online' at E1 so the flow is walkable end-to-end;
 * the 'offline' branch (pending evidence, locked drop) is the same code the
 * live connectivity feed drives at assembly. */
export const CONNECTIVITY: 'online' | 'offline' = 'online';

export function nextAfterEvidence(connectivity: 'online' | 'offline'): CustodyStep {
  // Offline evidence is queued = pending; the drop step stays locked.
  return connectivity === 'online' ? 'drop' : 'evidence_pending';
}
