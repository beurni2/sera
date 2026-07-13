import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POLICY_CHECK_IDS,
  type PolicyCheckId,
} from '../src/custody-flow.js';
import { SOS_EVENTS } from '../src/safety.js';
import {
  acknowledgeSos,
  beginPickup,
  clearSos,
  createDemoWorld,
  deliverQueuedSos,
  passVerification,
  raiseSos,
  registerSeal,
  type SosIncident,
} from '../src/demo/store.js';

/**
 * WO-6.3 SOS drill (SE8). The safety path proven, not claimed:
 *  (a) the FULL path emits ONLY the three canon events and acknowledges;
 *  (b) out-of-hours escalates to the founder and acknowledges;
 *  (c) OFFLINE NEVER LIES — a queued incident is UNACKNOWLEDGEABLE (throws)
 *      until the network delivers it;
 *  (d) custody is preserved — raising an SOS moves NO course (no orphan);
 *  (e) the location law — a coarse fix attaches IFF the rider is on shift;
 *  (f) NO franc anywhere in the safety surface.
 */

const RIDER = 'rider-moussa-demo';
const allChecks = (): Partial<Record<PolicyCheckId, boolean>> =>
  Object.fromEntries(POLICY_CHECK_IDS.map((id) => [id, true]));

const CANON_EVENTS = ['safety.sos_created.v1', 'safety.sos_acknowledged.v1', 'incident.opened.v1'];

describe('SOS drill — the honest safety path (SE8)', () => {
  it('(a) FULL PATH online in-hours: raised → the created + incidentOpened events → dispatcher ack → acknowledged (only canon events)', () => {
    const world = createDemoWorld();
    const raised = raiseSos(world, {
      riderId: RIDER,
      onShift: true,
      activeCourseId: null,
      connectivity: 'online',
      hours: 'in_hours',
    });
    expect(raised.status).toBe('raised');
    expect(raised.responder).toBe('dispatcher');
    // exactly the canon created + incidentOpened, no invented name
    expect(raised.events).toEqual([SOS_EVENTS.created, SOS_EVENTS.incidentOpened]);
    expect(raised.events).toContain('safety.sos_created.v1');
    expect(raised.events).toContain('incident.opened.v1');
    expect(raised.acknowledgedAt).toBeNull();

    const acked = acknowledgeSos(world, 'dispatcher');
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('dispatcher');
    expect(acked.acknowledgedAt).not.toBeNull();
    expect(acked.events).toContain('safety.sos_acknowledged.v1');
    // every emitted event is one of the three canon names — nothing invented
    expect(acked.events.every((e) => CANON_EVENTS.includes(e))).toBe(true);
    expect(world.incident).toBe(acked);
  });

  it('(b) OUT-OF-HOURS: raised escalates to the founder, and the founder acknowledges', () => {
    const world = createDemoWorld();
    const raised = raiseSos(world, {
      riderId: RIDER,
      onShift: true,
      activeCourseId: null,
      connectivity: 'online',
      hours: 'out_of_hours',
    });
    expect(raised.status).toBe('escalated');
    expect(raised.responder).toBe('founder');
    expect(raised.events).toEqual([SOS_EVENTS.created, SOS_EVENTS.incidentOpened]);

    const acked = acknowledgeSos(world, 'founder');
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('founder');
    expect(acked.events).toContain('safety.sos_acknowledged.v1');
  });

  it('(b2) RESPONDER-MATCH (WO-6.4 ④): only the incident’s OWN responder may ack — a mismatch THROWS and leaves the record byte-unchanged (runtime)', () => {
    // out-of-hours → responder 'founder'; a DISPATCHER ack is refused
    const outWorld = createDemoWorld();
    const escalated = raiseSos(outWorld, { riderId: RIDER, onShift: true, activeCourseId: null, connectivity: 'online', hours: 'out_of_hours' });
    expect(escalated.responder).toBe('founder');
    const before = structuredClone(outWorld.incident);
    expect(() => acknowledgeSos(outWorld, 'dispatcher')).toThrow(/founder/);
    // no partial mutation: still escalated, unacknowledged, no acknowledged event
    expect(outWorld.incident).toEqual(before);
    expect(outWorld.incident?.status).toBe('escalated');
    expect(outWorld.incident?.acknowledgedBy).toBeNull();
    expect(outWorld.incident?.events).not.toContain('safety.sos_acknowledged.v1');
    // the TRUE responder still acks, and is the one credited
    const acked = acknowledgeSos(outWorld, 'founder');
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('founder');

    // symmetric: in-hours → responder 'dispatcher'; a FOUNDER ack is refused
    const inWorld = createDemoWorld();
    const raised = raiseSos(inWorld, { riderId: RIDER, onShift: true, activeCourseId: null, connectivity: 'online', hours: 'in_hours' });
    expect(raised.responder).toBe('dispatcher');
    expect(() => acknowledgeSos(inWorld, 'founder')).toThrow(/dispatcher/);
    expect(inWorld.incident?.status).toBe('raised');
    expect(inWorld.incident?.acknowledgedBy).toBeNull();
  });

  it('(b3) RESPONDER-MATCH (WO-6.4 ④): a record naming a DIFFERENT human than its responder is UNREPRESENTABLE (type-level)', () => {
    // A complete, valid base shared by both literals so the ONLY delta is
    // acknowledgedBy — the type error can be nothing but the responder-match.
    const base = {
      id: 's', correlationId: 'c', riderId: RIDER, activeCourseId: null,
      coarseLocation: null, onShift: true, hours: 'out_of_hours' as const,
      status: 'acknowledged' as const, raisedAt: '', acknowledgedAt: '', events: [] as string[],
    };
    // CONTROL — a founder-incident credited to the FOUNDER typechecks:
    const honest: SosIncident = { ...base, responder: 'founder', acknowledgedBy: 'founder' };
    expect(honest.acknowledgedBy).toBe('founder');
    // @ts-expect-error — WO-6.4 ④: crediting the DISPATCHER on a founder incident is not a representable SosIncident
    const lying: SosIncident = { ...base, responder: 'founder', acknowledgedBy: 'dispatcher' };
    // referencing `lying` keeps the directive live without asserting on the (impossible) value
    expect(lying.responder).toBe('founder');
  });

  it('(c) OFFLINE NEVER LIES: a queued incident emits NOTHING and is UNACKNOWLEDGEABLE until delivered', () => {
    const world = createDemoWorld();
    const queued = raiseSos(world, {
      riderId: RIDER,
      onShift: true,
      activeCourseId: null,
      connectivity: 'offline',
      hours: 'in_hours',
    });
    expect(queued.status).toBe('queued');
    expect(queued.events).toEqual([]); // nothing emitted — nothing was sent

    // the honesty law, structural: you cannot acknowledge what has not arrived
    expect(() => acknowledgeSos(world, 'dispatcher')).toThrow();
    expect(world.incident?.status).toBe('queued'); // still queued — no fake ack

    // reconnect: NOW it is delivered and emits the created + incidentOpened events
    const delivered = deliverQueuedSos(world);
    expect(delivered.status).toBe('raised');
    expect(delivered.events).toEqual([SOS_EVENTS.created, SOS_EVENTS.incidentOpened]);

    // only AFTER delivery can it be acknowledged
    const acked = acknowledgeSos(world, 'dispatcher');
    expect(acked.status).toBe('acknowledged');
    expect(acked.events).toContain('safety.sos_acknowledged.v1');

    // and an already-acknowledged incident is unacknowledgeable again
    expect(() => acknowledgeSos(world, 'dispatcher')).toThrow();
    // a delivered/raised incident cannot be re-delivered
    const w2 = createDemoWorld();
    raiseSos(w2, { riderId: RIDER, onShift: true, activeCourseId: null, connectivity: 'online', hours: 'in_hours' });
    expect(() => deliverQueuedSos(w2)).toThrow();
  });

  it('(d) CUSTODY PRESERVED: raising an SOS mid-custody moves NO course — the package is not orphaned', () => {
    const world = createDemoWorld();
    const id = 'course-awa';
    beginPickup(world, id);
    passVerification(world, id, allChecks());
    registerSeal(world, id); // custody has begun; the course sits at 'evidence'
    const before = structuredClone(world.courses.find((c) => c.id === id)!);
    const courseCountBefore = world.courses.length;

    raiseSos(world, {
      riderId: RIDER,
      onShift: true,
      activeCourseId: id,
      connectivity: 'online',
      hours: 'in_hours',
    });

    const after = world.courses.find((c) => c.id === id)!;
    expect(after.step).toBe(before.step); // byte-unchanged custody step
    expect(after).toEqual(before); // the whole course is untouched
    expect(world.courses).toHaveLength(courseCountBefore); // still exists — not orphaned
    expect(world.incident?.activeCourseId).toBe(id); // the incident references it, does not own it
  });

  it('(e) LOCATION LAW (SE-I08): a coarse fix attaches IFF the rider is on shift', () => {
    const onShiftWorld = createDemoWorld();
    const onShift = raiseSos(onShiftWorld, {
      riderId: RIDER,
      onShift: true,
      activeCourseId: null,
      connectivity: 'online',
      hours: 'in_hours',
    });
    expect(typeof onShift.coarseLocation).toBe('string');
    expect(onShift.coarseLocation).not.toBeNull();

    const offShiftWorld = createDemoWorld();
    const offShift = raiseSos(offShiftWorld, {
      riderId: RIDER,
      onShift: false,
      activeCourseId: null,
      connectivity: 'online',
      hours: 'in_hours',
    });
    expect(offShift.coarseLocation).toBeNull(); // off shift → no location, ever
  });

  it('clearSos resets the incident (the rider is safe / the demo resets)', () => {
    const world = createDemoWorld();
    raiseSos(world, { riderId: RIDER, onShift: true, activeCourseId: null, connectivity: 'online', hours: 'in_hours' });
    expect(world.incident).not.toBeNull();
    clearSos(world);
    expect(world.incident).toBeNull();
  });

  it('(f) NO franc anywhere on the safety surface (rule source + SOS catalog strings)', () => {
    // A rendered franc amount: digits, a real separator (space/nbsp/nnbsp), then
    // the currency unit — or the word franc. Built with \u escapes so the source
    // stays pure ASCII; mirrors the WO-6.1 no-franc scan.
    const SEP = '[\\d.,\\u00a0\\u202f ]';
    const FRANC = new RegExp(`\\d${SEP}*[\\u00a0\\u202f ](?:FCFA|CFA|F)\\b|\\bfrancs?\\b`, 'i');
    const appDir = join(import.meta.dirname, '..');
    const safety = readFileSync(join(appDir, 'src/safety.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(FRANC.exec(safety), 'safety.ts carries a franc amount').toBeNull();

    const catalog = JSON.parse(readFileSync(join(appDir, 'i18n/catalog.json'), 'utf8')) as {
      key: string;
      fr: string;
    }[];
    for (const entry of catalog.filter((e) => e.key.startsWith('sos.'))) {
      expect(FRANC.exec(entry.fr), `${entry.key} carries a franc amount: ${entry.fr}`).toBeNull();
    }
  });
});
