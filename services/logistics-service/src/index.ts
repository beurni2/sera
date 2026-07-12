import { makeHealthFetch } from '@sera/observability';
import type { AssignmentLease, DeliveryTask, PickupTask, RouteManifest } from '@platform/contracts';

/**
 * logistics-service: Logistics&Dispatch (OWNED, §5.2) — single assignment
 * authority (SE-I01). Canonical shapes imported from the pin, never
 * redefined. WO-1.2 adds E1 dispatch-thin: rider registry (SE0.2), kernel
 * delivery locations (SE0.3), ready-queue intake (SE1.1), and MANUAL
 * assignment (§2.3 step 10). WO-4.3 (SE2.1) adds the atomic AssignmentLease
 * Durable Object (worker/assignment-lease-do.ts — ONE object, THE dispatch
 * authority) with its pure decision core + the leased grant path. Still no
 * auto-assign, no ranking, no routing — the dispatcher chooses.
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
export * from './assignment-lease.js';
export * from './leased-assignment.js';
export * from './shift-location.js';
export * from './rider-registry.js';
export * from './delivery-location.js';
export * from './ready-queue.js';
export * from './manual-assignment.js';
export * from './reschedule.js';
export * from './mocks/shopplus-funding-mock.js';
export * from './mocks/boutik-readiness-mock.js';

export const handleRequest = makeHealthFetch(SERVICE_NAME);

export default { fetch: handleRequest };
