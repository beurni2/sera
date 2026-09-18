import { RouteManifestSchema } from '@platform/contracts';
import { describe, expect, it } from 'vitest';
import { courierActor, deriveManifest, heldPackageIds, type CustodianFact, type ManifestCourse } from '../src/route-manifest.js';

/**
 * MANIFESTE-1 — the pure derivation, against SE3.1's four sentences and
 * SE-I03. The seam (`test/manifeste.e2e.test.ts`) proves it on two real
 * Workers; here the law itself, one sentence per case.
 */

const T = '2026-09-18T09:00:00.000Z';
const course = (over: Partial<ManifestCourse> = {}): ManifestCourse => ({
  assignmentId: 'as-1', taskId: 'task-1', orderId: 'ord-1', active: true, retourOuvert: false, retourDecide: false, ...over,
});
const facts = (m: Record<string, CustodianFact>) => (orderId: string) => m[orderId];

describe('deriveManifest — one manifest, one current stop, from the book and the ledger', () => {
  it('is the canon RouteManifest shape (strict), and its id is the rider’s — one active manifest by construction', () => {
    const m = deriveManifest('rider-1', [course()], facts({}));
    const canon = RouteManifestSchema.parse({ id: m.id, riderId: m.riderId, version: m.version, orderedStops: m.orderedStops, custodyInventory: m.custodyInventory, status: m.status });
    expect(canon.id).toBe('man-rider-1');
    expect(deriveManifest('rider-1', [course()], facts({})).id).toBe(m.id);
  });

  it('before custody: two stops, the pickup FIRST is the one current stop, nothing carried, the reading unknown (no custody answer yet)', () => {
    const m = deriveManifest('rider-1', [course()], facts({}));
    expect(m.stops.map((s) => s.kind)).toEqual(['ramassage', 'livraison']);
    expect(m.currentStop?.kind).toBe('ramassage');
    expect(m.custodyInventory).toEqual([]);
    expect(m.status).toBe('active');
    expect(m.version).toBe(1);
    expect(m.custodyReadings).toEqual([{ orderId: 'ord-1', reading: 'inconnue', asOf: null }]);
  });

  it('custody with the courier (the ledger’s word): the pickup stop is done, the delivery is current, the package is carried, the version advanced', () => {
    const m = deriveManifest('rider-1', [course()], facts({ 'ord-1': { custodian: courierActor('rider-1'), packageId: 'pkg-1', asOf: T } }));
    expect(m.stops.map((s) => s.kind)).toEqual(['livraison']);
    expect(m.currentStop?.stopId).toBe('livraison-as-1');
    expect(m.custodyInventory).toEqual(['pkg-1']);
    expect(m.version).toBe(2);
    expect(m.custodyReadings[0]).toEqual({ orderId: 'ord-1', reading: 'coursier', asOf: T });
  });

  it('custody with someone else (seller before pickup, customer after the drop) is NOT carried — the seller case walks both stops, the customer case is a closed course the book no longer lists', () => {
    const seller = deriveManifest('rider-1', [course()], facts({ 'ord-1': { custodian: 'seller:sup-1', packageId: 'pkg-1', asOf: T } }));
    expect(seller.stops.map((s) => s.kind)).toEqual(['ramassage', 'livraison']);
    expect(seller.custodyInventory).toEqual([]);
    expect(seller.custodyReadings[0]?.reading).toBe('ailleurs');
    const closed = deriveManifest('rider-1', [], facts({ 'ord-1': { custodian: 'customer', packageId: 'pkg-1', asOf: T } }));
    expect(closed.status).toBe('closed');
    expect(closed.currentStop).toBeNull();
  });

  it('a return open or decided makes the current stop « retour », never « livraison »', () => {
    const held = facts({ 'ord-1': { custodian: courierActor('rider-1'), packageId: 'pkg-1', asOf: T } });
    expect(deriveManifest('rider-1', [course({ retourOuvert: true })], held).currentStop?.kind).toBe('retour');
    expect(deriveManifest('rider-1', [course({ retourDecide: true })], held).currentStop?.kind).toBe('retour');
  });

  it('« cancelled task can’t leave custody inventory »: a taken-back course whose package the ledger still places with the rider stays carried, with NO stop, and the manifest cannot close', () => {
    const m = deriveManifest('rider-1', [course({ active: false })], facts({ 'ord-1': { custodian: courierActor('rider-1'), packageId: 'pkg-1', asOf: T } }));
    expect(m.stops).toEqual([]);
    expect(m.currentStop).toBeNull();
    expect(m.custodyInventory).toEqual(['pkg-1']);
    expect(m.status).toBe('active');
  });

  it('« package accounted at close »: closed ONLY with no stop and nothing carried', () => {
    expect(deriveManifest('rider-1', [], facts({})).status).toBe('closed');
    expect(deriveManifest('rider-1', [course({ active: false })], facts({ 'ord-1': { custodian: 'seller:sup-1', packageId: 'pkg-1', asOf: T } })).status).toBe('closed');
  });

  it('batch-capable data model: two courses order their stops course by course, and the head is still the ONE current stop', () => {
    const m = deriveManifest(
      'rider-1',
      [course(), course({ assignmentId: 'as-2', taskId: 'task-2', orderId: 'ord-2' })],
      facts({ 'ord-1': { custodian: courierActor('rider-1'), packageId: 'pkg-1', asOf: T } }),
    );
    expect(m.orderedStops).toEqual(['livraison-as-1', 'ramassage-as-2', 'livraison-as-2']);
    expect(m.currentStop?.stopId).toBe('livraison-as-1');
    expect(m.custodyInventory).toEqual(['pkg-1']);
  });

  it('heldPackageIds is the inventory — the SE3.2 declaration, never a caller’s claim', () => {
    const held = facts({ 'ord-1': { custodian: courierActor('rider-1'), packageId: 'pkg-1', asOf: T } });
    expect(heldPackageIds('rider-1', [course()], held)).toEqual(['pkg-1']);
    expect(heldPackageIds('rider-2', [course()], held)).toEqual([]);
    expect(heldPackageIds('rider-1', [course()], facts({}))).toEqual([]);
  });
});
