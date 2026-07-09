import { makeHealthFetch } from '@sera/observability';
import type { AssignmentLease, DeliveryTask, PickupTask, RouteManifest } from '@platform/contracts';

/**
 * logistics-service stub (WO-SE0.1): Logistics&Dispatch (OWNED, §5.2) —
 * single assignment authority (SE-I01). Canonical shapes imported from the
 * pin, never redefined. No dispatch logic, no Durable Objects at this slice.
 */
export const SERVICE_NAME = 'logistics-service';

/** The canonical shapes this service will serve views of. */
export type LogisticsServiceShapes = {
  assignmentLease: AssignmentLease;
  pickupTask: PickupTask;
  deliveryTask: DeliveryTask;
  routeManifest: RouteManifest;
};

export * from './assignment-authority.js';
export * from './shift-location.js';

export const handleRequest = makeHealthFetch(SERVICE_NAME);

export default { fetch: handleRequest };
