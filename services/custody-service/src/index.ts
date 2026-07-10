import { makeHealthFetch } from '@sera/observability';
import type { CustodyRecord, PickupVerification } from '@platform/contracts';

/**
 * custody-service stub (WO-SE0.1): Custody (OWNED, §5.2) — one current
 * custodian; verify-then-seal-then-custody (SE-I04/SE-I05). Canonical shapes
 * imported from the pin, never redefined. No custody ledger DO at this slice.
 */
export const SERVICE_NAME = 'custody-service';

/** The canonical shapes this service will serve views of. */
export type CustodyServiceShapes = {
  custodyRecord: CustodyRecord;
  pickupVerification: PickupVerification;
};

export * from './custody-transition.js';

export const handleRequest = makeHealthFetch(SERVICE_NAME);

export default { fetch: handleRequest };
export * from './custody-ledger.js';
export * from './secret-registry.js';
export * from './pickup-verification-policy.js';
export * from './custody-spine.js';
