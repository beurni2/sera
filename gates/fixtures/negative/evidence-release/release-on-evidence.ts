// NEGATIVE FIXTURE: a path from EvidenceBundle to a settlement mutation —
// the no-evidence-release gate MUST fail on this file. Never import this.
import type { EvidenceBundle, SettlementObligation } from '@platform/contracts';
export function releaseSettlementOnEvidence(bundle: EvidenceBundle): Partial<SettlementObligation> {
  return { orderId: bundle.packageId, state: 'Paid' }; // banned: evidence never releases
}
