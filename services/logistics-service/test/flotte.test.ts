import { describe, expect, it } from 'vitest';
import {
  FLOTTE_VIDE,
  addEntry,
  closeShift,
  confierMoto,
  declareMoto,
  documentsDus,
  logCourse,
  openShift,
  utilisation,
  type FlotteSnapshot,
} from '../src/flotte.js';

/** FLOTTE-1 — the records, one law per case. Ids are minted by the caller. */

const T = '2026-09-18T09:00:00.000Z';
const day = (n: number): string => new Date(Date.parse(T) + n * 86_400_000).toISOString();
let seq = 0;
const mint = () => `id-${(seq += 1)}`;

function deuxMotos(): FlotteSnapshot {
  seq = 0;
  const a = declareMoto(FLOTTE_VIDE, { commandId: 'c-a', label: 'Moto A', fleetTranche: 1 }, T, mint);
  if (!a.ok) throw new Error('a');
  const b = declareMoto(a.snap, { commandId: 'c-b', label: 'Moto B', fleetTranche: 1, odometerKm: 1_200 }, T, mint);
  if (!b.ok) throw new Error('b');
  return b.snap;
}

describe('declareMoto · addEntry — the founder’s facts, replayed by command id', () => {
  it('declares, amends by id, replays without a second moto, refuses malformed and unknown by name', () => {
    const snap = deuxMotos();
    expect(Object.values(snap.motos).map((m) => m.label)).toEqual(['Moto A', 'Moto B']);
    const again = declareMoto(snap, { commandId: 'c-a', label: 'ignored', fleetTranche: 9 }, T, mint);
    expect(again.ok && again.replayed).toBe(true);
    expect(Object.keys(snap.motos)).toHaveLength(2);
    const amended = declareMoto(snap, { commandId: 'c-a2', vehicleId: 'id-1', label: 'Moto A bis', fleetTranche: 2, status: 'maintenance' }, T, mint);
    expect(amended.ok && amended.moto).toMatchObject({ vehicleId: 'id-1', label: 'Moto A bis', fleetTranche: 2, status: 'maintenance', odometerKm: 0 });
    expect(declareMoto(snap, { commandId: 'c-x', label: '', fleetTranche: 1 }, T, mint)).toEqual({ ok: false, reason: 'malformed' });
    expect(declareMoto(snap, { commandId: 'c-y', label: 'M', fleetTranche: 0 }, T, mint)).toEqual({ ok: false, reason: 'malformed' });
    expect(declareMoto(snap, { commandId: 'c-z', vehicleId: 'nope', label: 'M', fleetTranche: 1 }, T, mint)).toEqual({ ok: false, reason: 'unknown_vehicle' });
  });

  it('an entry moves the odometer only forward, files a document under its kind, and replays once', () => {
    let snap = deuxMotos();
    const r1 = addEntry(snap, { commandId: 'e-1', vehicleId: 'id-2', kind: 'compteur', odometerKm: 1_300 }, T, mint);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    snap = r1.snap;
    expect(snap.motos['id-2']!.odometerKm).toBe(1_300);
    expect(addEntry(snap, { commandId: 'e-2', vehicleId: 'id-2', kind: 'compteur', odometerKm: 1_250 }, T, mint)).toEqual({ ok: false, reason: 'odometer_goes_backwards' });
    expect(addEntry(snap, { commandId: 'e-3', vehicleId: 'id-2', kind: 'compteur' }, T, mint)).toEqual({ ok: false, reason: 'malformed' });
    const r2 = addEntry(snap, { commandId: 'e-4', vehicleId: 'id-2', kind: 'document', doc: { kind: 'assurance', expiresAt: day(10) } }, T, mint);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    snap = r2.snap;
    const r3 = addEntry(snap, { commandId: 'e-5', vehicleId: 'id-2', kind: 'document', doc: { kind: 'assurance', expiresAt: day(400) } }, T, mint);
    if (!r3.ok) throw new Error('r3');
    expect(r3.snap.motos['id-2']!.docs).toEqual([{ kind: 'assurance', expiresAt: day(400) }]);
    expect(r3.snap.entries).toHaveLength(3);
    const replay = addEntry(r3.snap, { commandId: 'e-5', vehicleId: 'id-2', kind: 'document', doc: { kind: 'assurance', expiresAt: day(9) } }, T, mint);
    expect(replay.ok && replay.replayed).toBe(true);
    expect(addEntry(snap, { commandId: 'e-6', vehicleId: 'nope', kind: 'energie', kwh: 2 }, T, mint)).toEqual({ ok: false, reason: 'unknown_vehicle' });
    expect(addEntry(snap, { commandId: 'e-7', vehicleId: 'id-2', kind: 'maintenance', costFcfa: 12.5 }, T, mint)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('documents due: past ones flagged « expire », the ones inside the window listed, a retired moto skipped', () => {
    let snap = deuxMotos();
    for (const [vehicleId, kind, exp] of [['id-1', 'assurance', day(-1)], ['id-1', 'carte-grise', day(20)], ['id-2', 'assurance', day(90)]] as const) {
      const r = addEntry(snap, { commandId: `d-${vehicleId}-${kind}`, vehicleId, kind: 'document', doc: { kind, expiresAt: exp } }, T, mint);
      if (!r.ok) throw new Error('doc');
      snap = r.snap;
    }
    expect(documentsDus(snap, T)).toEqual([
      { vehicleId: 'id-1', label: 'Moto A', kind: 'assurance', expiresAt: day(-1), expire: true },
      { vehicleId: 'id-1', label: 'Moto A', kind: 'carte-grise', expiresAt: day(20), expire: false },
    ]);
    const retired = declareMoto(snap, { commandId: 'ret', vehicleId: 'id-1', label: 'Moto A', fleetTranche: 1, status: 'retired' }, T, mint);
    if (!retired.ok) throw new Error('ret');
    expect(documentsDus(retired.snap, T)).toEqual([]);
  });
});

describe('shifts and courses — recorded by the system, utilization derived', () => {
  it('a rider’s shift opens on the moto he holds, a delivery lands on it once, and deliveries/moto/day is a count over the window', () => {
    let snap = deuxMotos();
    const c = confierMoto(snap, 'id-1', 'rider-1');
    if (!c.ok) throw new Error('c');
    snap = c.snap;
    // Handing him the other moto takes the first back — one moto per rider.
    const c2 = confierMoto(snap, 'id-2', 'rider-1');
    if (!c2.ok) throw new Error('c2');
    expect(c2.snap.motos['id-1']!.checkedOutBy).toBeNull();
    expect(c2.snap.motos['id-2']!.checkedOutBy).toBe('rider-1');
    expect(confierMoto(snap, 'nope', 'rider-1')).toEqual({ ok: false, reason: 'unknown_vehicle' });

    snap = openShift(snap, 'rider-1', T, mint);
    expect(snap.shifts).toEqual([{ shiftId: 'id-3', riderId: 'rider-1', vehicleId: 'id-1', startedAt: T, endedAt: null }]);
    expect(openShift(snap, 'rider-1', day(0.1), mint).shifts, 'one open shift per rider').toHaveLength(1);
    snap = logCourse(snap, { orderId: 'o-1', riderId: 'rider-1', kind: 'livree', at: day(0.2) });
    snap = logCourse(snap, { orderId: 'o-1', riderId: 'rider-1', kind: 'livree', at: day(0.3) }); // the at-least-once wire
    snap = logCourse(snap, { orderId: 'o-2', riderId: 'rider-1', kind: 'retournee', at: day(0.4) });
    snap = logCourse(snap, { orderId: 'o-3', riderId: 'rider-2', kind: 'livree', at: day(0.5) }); // no moto, no shift
    snap = logCourse(snap, { orderId: 'o-old', riderId: 'rider-1', kind: 'livree', at: day(-20) }); // outside the window
    expect(snap.courses).toHaveLength(4);
    expect(snap.courses[0]).toMatchObject({ orderId: 'o-1', vehicleId: 'id-1', kind: 'livree' });
    expect(snap.courses[2]).toMatchObject({ orderId: 'o-3', vehicleId: null });
    snap = closeShift(snap, 'rider-1', day(0.6));
    expect(snap.shifts[0]!.endedAt).toBe(day(0.6));
    expect(closeShift(snap, 'rider-1', day(0.7)).shifts[0]!.endedAt, 'closing twice moves nothing').toBe(day(0.6));

    const u = utilisation(snap, day(1), 14);
    expect(u).toMatchObject({ windowDays: 14, livrees: 2, retournees: 1, motosActives: 2, tauxEchec: 0.333 });
    expect(u.livraisonsParMotoParJour).toBe(Math.round((2 / (2 * 14)) * 100) / 100);
    expect(u.parMoto).toEqual([
      { vehicleId: 'id-1', label: 'Moto A', livrees: 1, retournees: 1 },
      { vehicleId: 'id-2', label: 'Moto B', livrees: 0, retournees: 0 },
    ]);
  });

  it('with no moto declared the yardstick is null — never a division by an invented fleet; with no course the failure rate is null', () => {
    const u = utilisation(FLOTTE_VIDE, T);
    expect(u).toMatchObject({ livrees: 0, retournees: 0, motosActives: 0, livraisonsParMotoParJour: null, tauxEchec: null, parMoto: [] });
  });
});
