// PLANTED NEGATIVE FIXTURE — a rogue drain that bypasses the binding path:
// pulls raw items off the private queue and plants them as accepted
// evidence without submitDeliveryEvidence's strict parse + chain/seal
// binding. The offline-flush-binding gate must catch BOTH accesses.
export function directDrain(spine: Record<string, unknown>): void {
  const queue = (spine as { pendingOfflineEvidence: unknown[] }).pendingOfflineEvidence;
  const raw = queue.pop();
  (spine as { evidenceSubmitted: unknown }).evidenceSubmitted = raw;
}
