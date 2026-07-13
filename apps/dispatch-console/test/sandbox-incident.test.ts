import { describe, expect, it } from 'vitest';
import {
  acknowledgeSos,
  canAcknowledge,
  SANDBOX_INCIDENT_QUEUED,
  SANDBOX_INCIDENT_RAISED,
  type IncidentView,
} from '../src/sandbox-incident';

/**
 * WO-6.4 (ruling ④) — RESPONDER-MATCH on the console's acknowledgeSos, proven
 * both ways: a mismatched responder REFUSES at runtime (throws, no mutation) and
 * at the type level (a record naming a different human than its responder is not
 * a representable IncidentView). Mirrors the rider store's sos-drill (b2)/(b3).
 */
describe('console SOS acknowledgeSos — responder-match (WO-6.4 ④)', () => {
  it('the incident’s OWN responder acknowledges, and is the one credited', () => {
    expect(canAcknowledge(SANDBOX_INCIDENT_RAISED)).toBe(true);
    const acked = acknowledgeSos(SANDBOX_INCIDENT_RAISED, SANDBOX_INCIDENT_RAISED.responder);
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('dispatcher'); // == responder
  });

  it('a MISMATCHED responder THROWS and mutates nothing (runtime)', () => {
    // SANDBOX_INCIDENT_RAISED.responder is 'dispatcher' → a 'founder' ack is refused
    expect(() => acknowledgeSos(SANDBOX_INCIDENT_RAISED, 'founder')).toThrow(/dispatcher/);
    // the constant is untouched (acknowledgeSos returns a new object, never mutates)
    expect(SANDBOX_INCIDENT_RAISED.status).toBe('raised');
    expect(SANDBOX_INCIDENT_RAISED.acknowledgedBy).toBeNull();
  });

  it('the status guard still fires FIRST — a queued incident is unacknowledgeable regardless of responder', () => {
    expect(canAcknowledge(SANDBOX_INCIDENT_QUEUED)).toBe(false);
    expect(() => acknowledgeSos(SANDBOX_INCIDENT_QUEUED, SANDBOX_INCIDENT_QUEUED.responder)).toThrow(/queued/);
  });

  it('a record naming a DIFFERENT human than its responder is UNREPRESENTABLE (type-level)', () => {
    const base = {
      id: 'i', correlationId: 'c', riderId: 'rider-issa', riderName: 'Issa O. (démo)',
      activeTaskId: null, coarseLocation: null, onShift: true,
      hours: 'out_of_hours' as const, status: 'acknowledged' as const,
    };
    // CONTROL — a founder-incident credited to the FOUNDER typechecks:
    const honest: IncidentView = { ...base, responder: 'founder', acknowledgedBy: 'founder' };
    expect(honest.acknowledgedBy).toBe('founder');
    // @ts-expect-error — WO-6.4 ④: crediting the DISPATCHER on a founder incident is not a representable IncidentView
    const lying: IncidentView = { ...base, responder: 'founder', acknowledgedBy: 'dispatcher' };
    expect(lying.responder).toBe('founder');
  });
});
