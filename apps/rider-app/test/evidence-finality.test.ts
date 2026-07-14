import { describe, expect, it } from 'vitest';
import {
  acceptInspection,
  applyEvidenceServerAck,
  applyProviderDoorSignal,
  beginPickup,
  captureEvidence,
  createDemoWorld,
  passVerification,
  registerSeal,
  validateDropCode,
} from '../src/demo/store';
import { POLICY_CHECK_IDS, SANDBOX_PAYMENT_MODE } from '../src/custody-flow';

/**
 * SERA-S2 (🔴) · SE-I06 — "Offline evidence may be queued, but custody/delivery
 * validation + financial release remain pending until authoritative SERVER ACK."
 *
 * The red-proof (archived at _review/SERA-S2/red-proof.log) captured the OLD code
 * advancing to 'door_inspection' on `online` — proving the pre-fix flow unlocked on
 * connectivity, not on the ack. This is that proof, grown into the finality fixture:
 * being online is NOT being acked; the drop stays LOCKED until the authoritative
 * server ack (the outbox flush outcome) lands, and a refused ack never unlocks.
 */

function driveToEvidence(): { world: ReturnType<typeof createDemoWorld>; id: string } {
  const world = createDemoWorld();
  const id = 'course-awa'; // seeded at 'affectation'
  beginPickup(world, id);
  passVerification(world, id, Object.fromEntries(POLICY_CHECK_IDS.map((c) => [c, true])));
  registerSeal(world, id); // → 'evidence'
  return { world, id };
}

const stepOf = (world: ReturnType<typeof createDemoWorld>, id: string) =>
  world.courses.find((c) => c.id === id)!.step;

describe('SERA-S2 — SE-I06 finality waits for the server ack, not for online', () => {
  it('capturing lands evidence_pending and LOCKS the drop — being online never advances it', () => {
    const { world, id } = driveToEvidence();
    expect(captureEvidence(world, id)).toBe('evidence_pending');
    // the drop is not reachable — validateDropCode requires 'drop' and throws
    expect(() => validateDropCode(world, id)).toThrow(/custody out of order/);
    expect(stepOf(world, id)).toBe('evidence_pending'); // still pending, unmoved
  });

  it('a collision-refused ack keeps it PENDING (surfaced, never a silent unlock)', () => {
    const { world, id } = driveToEvidence();
    captureEvidence(world, id);
    expect(applyEvidenceServerAck(world, id, 'collision-refused')).toBe('evidence_pending');
    expect(() => validateDropCode(world, id)).toThrow(); // drop still locked
    expect(stepOf(world, id)).toBe('evidence_pending');
  });

  it('the applied ack is the authoritative unlock: pending → door_inspection → … → delivered', () => {
    const { world, id } = driveToEvidence();
    captureEvidence(world, id);
    // the server ack, and ONLY it, advances the locked step (WO-2.4 mapping: through
    // the door inspection). Now the rest of the walk is reachable to the franc-free end.
    expect(applyEvidenceServerAck(world, id, 'applied')).toBe('door_inspection');
    acceptInspection(world, id, SANDBOX_PAYMENT_MODE);
    applyProviderDoorSignal(world, id, 'confirmed');
    expect(validateDropCode(world, id)).toBe('delivered');
    expect(world.courses.find((c) => c.id === id)!.closed).toBe(true);
  });

  it('an idempotentReplay ack also advances — a replayed ack is still the same ack', () => {
    const { world, id } = driveToEvidence();
    captureEvidence(world, id);
    expect(applyEvidenceServerAck(world, id, 'idempotentReplay')).toBe('door_inspection');
  });

  it('the ack cannot be applied before a capture — evidence_pending is the only source step', () => {
    const { world, id } = driveToEvidence(); // sits at 'evidence', not yet pending
    expect(() => applyEvidenceServerAck(world, id, 'applied')).toThrow(/custody out of order/);
  });
});
