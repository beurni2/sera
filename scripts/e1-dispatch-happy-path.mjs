#!/usr/bin/env node
// WO-1.2 DoD: one manual-assignment happy path emitting enveloped events
// with the chain ids (correlation_id + delivery_task_id), plus the offline
// pending proofs (shift-start and ack queued = pending, no assignability, no
// finality). Deterministic clock and ids; exits nonzero on any divergence.
import {
  AssignmentBook,
  GrantedLeaseWitness,
  InMemoryLeaseAuthority,
  LeasedDispatch,
  MockBoutikReadiness,
  MockShopPlusFunding,
  PRIVACY_NOTICE_VERSION,
  ReadyQueue,
  RescheduleBook,
  RiderRegistry,
} from '../services/logistics-service/dist/index.js';

const T = '2026-07-09T12:00:00.000Z';
const LATER = '2026-07-09T12:01:00.000Z';

// Upstream truth (mocks, well-behaved config): funded + readiness-confirmed.
const funding = new MockShopPlusFunding({});
const readiness = new MockBoutikReadiness({});
funding.initiateCheckout('order-e1-0001', 'FULL_PREPAY', 'corr-e1-0001');
funding.confirmFunding('order-e1-0001', 'collect-e1-0001', T);
readiness.recordOrderKnown('order-e1-0001', 'corr-e1-0001');
const readinessResp = readiness.confirmReadiness(
  {
    orderId: 'order-e1-0001',
    photoRef: { ref: 'media/pkg-e1.jpg', sha256: 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef', mimeType: 'image/jpeg' },
    readinessChallenge: 'challenge-e1',
    qty: 1,
    variant: 'taille unique',
    availableConfirmed: true,
    at: T,
  },
  T,
);
if (readinessResp.outcome !== 'accepted') { console.error('readiness refused'); process.exit(1); }

// SE1.1 intake.
const queue = new ReadyQueue({ funding, readiness });
const intake = queue.onTaskReady(
  {
    name: 'logistics.task_ready.v1',
    envelope: { command_id: 'cmd-ready-1', correlation_id: 'corr-e1-0001', aggregateVersion: 1, actor: 'logistics-service:sandbox', serverTime: T, version: '1' },
    payload: {
      task: {
        type: 'delivery', id: 'task-e1-0001', orderId: 'order-e1-0001',
        location: { pin: { lat: 12.3714, lng: -1.5197 }, zone: 'Gounghin', landmark: 'Face à la pharmacie du marché', directions: 'Deuxième porte bleue après le kiosque', maskedRelay: 'relay-e1' },
        window: { start: T, end: '2026-07-09T14:00:00.000Z' }, status: 'ready',
      },
    },
  },
  T,
);
if (!intake.admitted) { console.error('intake refused:', intake.reason); process.exit(1); }

// SE0.2 riders: one OFFLINE start (stays pending, NOT assignable), then the
// server confirm arrives.
const registry = new RiderRegistry();
registry.register({ riderId: 'rider-issa', displayName: 'Issa', phoneAlias: 'alias-77', certified: true });
registry.acknowledgePrivacyNotice('rider-issa', PRIVACY_NOTICE_VERSION, T);
const offlineStart = registry.startShift('rider-issa', T, 'queued_offline');
const assignableWhilePending = registry.isAssignable('rider-issa');
registry.confirmQueuedShiftStart('rider-issa', LATER);

// §2.3 step 10: manual assignment — through the FULL WO-4.3 leased path:
// SE1.1 recheck → atomic grant at THE authority (the in-memory adapter over
// the SAME pure decideLease core; the workerd DO itself is proven in the
// vitest e2e suites) → witnessed book entry. Every pre-WO-4.3 assertion
// below is unchanged.
const witness = new GrantedLeaseWitness();
const book = new AssignmentBook(registry, queue, witness);
const dispatch = new LeasedDispatch({
  authority: new InMemoryLeaseAuthority(),
  witness,
  registry,
  queue,
  book,
  reschedules: new RescheduleBook(queue),
});
const assigned = await dispatch.assign({
  command_id: 'cmd-assign-1', taskId: 'task-e1-0001', riderId: 'rider-issa',
  dispatcherId: 'dispatcher-awa', at: LATER, newAssignmentId: 'as-e1-0001',
});
if (!assigned.ok) { console.error('assignment refused:', assigned.reason); process.exit(1); }

// Rider ack: first OFFLINE (pending, no finality — it anchors NOTHING),
// then server-confirmed (CTO ruling: the confirmed ack ANCHORS the lease at
// THE authority — the answered proposal no longer expires).
const offlineAck = await dispatch.acknowledge('as-e1-0001', 'queued_offline', LATER);
const serverAck = await dispatch.acknowledge('as-e1-0001', 'server_confirmed', LATER);

console.log('=== E1 MANUAL ASSIGNMENT — happy path ===');
console.log(`delivery_task_id  = ${assigned.assignment.taskId}`);
console.log(`order_id          = ${assigned.assignment.orderId}`);
console.log(`assignment_id     = ${assigned.assignment.assignmentId}`);
console.log(`rider_id          = ${assigned.assignment.riderId}`);
console.log(`correlation_id    = ${assigned.event.envelope.correlation_id}`);
console.log('\n=== enveloped event ===');
console.log(`${assigned.event.name} @ aggregateVersion ${assigned.event.envelope.aggregateVersion} (command ${assigned.event.envelope.command_id}, actor ${assigned.event.envelope.actor})`);
console.log(`payload: ${JSON.stringify(assigned.event.payload)}`);
console.log('\n=== offline law (queued = pending, never done) ===');
console.log(`offline shift start   → status ${offlineStart.state.status} (pending=${offlineStart.pending}); assignable while pending: ${assignableWhilePending}`);
console.log(`offline rider ack     → status ${offlineAck.status} (pending=${offlineAck.pending}); lease anchored: ${offlineAck.anchored}`);
console.log(`server-confirmed ack  → status ${serverAck.status} (pending=${serverAck.pending}); lease anchored: ${serverAck.anchored}`);

const sane =
  assigned.event.name === 'pickup.assigned.v1' &&
  assigned.event.envelope.correlation_id === 'corr-e1-0001' &&
  assigned.event.payload.delivery_task_id === 'task-e1-0001' &&
  offlineStart.state.status === 'shift_start_pending' &&
  assignableWhilePending === false &&
  offlineAck.status === 'ack_pending_offline' &&
  offlineAck.anchored === false && // an offline ack anchors NOTHING (ruling)
  serverAck.status === 'acknowledged' &&
  serverAck.anchored === true && // the answered proposal is anchored (ruling)
  book.findOneActiveViolations().length === 0;
process.exit(sane ? 0 : 1);
