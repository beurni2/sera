import { makeHealthFetch } from '@sera/observability';
import type { EvidenceBundle, ValidationDecision } from '@platform/contracts';

/**
 * evidence-service stub (WO-SE0.1): Evidence&Validation (OWNED, §5.2) —
 * "Evidence supports, never releases" (§5.5); no type/path from
 * EvidenceBundle to any settlement mutation. Canonical shapes imported from
 * the pin, never redefined. No evidence capture at this slice.
 */
export const SERVICE_NAME = 'evidence-service';

/** The canonical shapes this service will serve views of. */
export type EvidenceServiceShapes = {
  evidenceBundle: EvidenceBundle;
  validationDecision: ValidationDecision;
};

export * from './readiness-evidence.js';

export const handleRequest = makeHealthFetch(SERVICE_NAME);

export default { fetch: handleRequest };
