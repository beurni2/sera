import {
  AssignmentBook,
  MockBoutikReadiness,
  MockShopPlusFunding,
  PRIVACY_NOTICE_VERSION,
  ReadyQueue,
  RiderRegistry,
} from '@sera/logistics-service';

/**
 * E1 SANDBOX WORLD for the console — the REAL logistics-service intake and
 * assignment logic driven against the §3 mocks in their well-behaved
 * configuration (funded + readiness-confirmed + non-cancelled, fresh
 * projections). This is runtime DATA feeding the shell, not interface copy —
 * UI strings live in the i18n catalog. At E1 assembly the world is replaced
 * by the live services; nothing in here is a second implementation.
 */
export function buildSandboxWorld(nowIso: string) {
  const funding = new MockShopPlusFunding({});
  const readiness = new MockBoutikReadiness({});
  funding.initiateCheckout('order-e1-0001', 'FULL_PREPAY', 'corr-e1-0001');
  funding.confirmFunding('order-e1-0001', 'collect-e1-0001', nowIso);
  readiness.recordOrderKnown('order-e1-0001', 'corr-e1-0001');
  readiness.confirmReadiness(
    {
      orderId: 'order-e1-0001',
      photoRef: {
        ref: 'media/pkg-e1.jpg',
        sha256: 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef',
        mimeType: 'image/jpeg',
      },
      readinessChallenge: 'challenge-e1',
      qty: 1,
      variant: 'taille unique',
      availableConfirmed: true,
      at: nowIso,
    },
    nowIso,
  );
  const queue = new ReadyQueue({ funding, readiness });
  queue.onTaskReady(
    {
      name: 'logistics.task_ready.v1',
      envelope: {
        command_id: 'cmd-console-ready-1',
        correlation_id: 'corr-e1-0001',
        aggregateVersion: 1,
        actor: 'logistics-service:sandbox',
        serverTime: nowIso,
        version: '1',
      },
      payload: {
        task: {
          type: 'delivery',
          id: 'task-e1-0001',
          orderId: 'order-e1-0001',
          location: {
            pin: { lat: 12.3714, lng: -1.5197 },
            zone: 'Gounghin',
            landmark: 'Face à la pharmacie du marché',
            directions: 'Deuxième porte bleue après le kiosque',
            maskedRelay: 'relay-e1',
          },
          window: { start: nowIso, end: new Date(Date.parse(nowIso) + 2 * 60 * 60 * 1000).toISOString() },
          status: 'ready',
        },
      },
    },
    nowIso,
  );
  const registry = new RiderRegistry();
  registry.register({ riderId: 'rider-issa', displayName: 'Issa', phoneAlias: 'alias-77', certified: true });
  registry.acknowledgePrivacyNotice('rider-issa', PRIVACY_NOTICE_VERSION, nowIso);
  registry.startShift('rider-issa', nowIso, 'server_confirmed');
  const book = new AssignmentBook(registry, queue);
  return { queue, book, registry, riders: [{ riderId: 'rider-issa', displayName: 'Issa' }] };
}
