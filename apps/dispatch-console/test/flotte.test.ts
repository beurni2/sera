import { describe, expect, it } from 'vitest';
import {
  COUT_LIGNES,
  OVERHEAD_ITEMS,
  SCALAR_FIELDS,
  coutsVue,
  entreeKey,
  flotteRefusKey,
  flotteVue,
  francs,
  hypothesesDepuisSaisie,
  motoStatutKey,
  saisieDepuisHypotheses,
} from '../src/flotte';

/** FLOTTE-1 — the desk's pure read and the founder's typed hypotheses. */

const scalar = { riderCostPerShiftFcfa: 8_000, deliveriesPerShift: 8, electricityPerDeliveryFcfa: 100, failedAttemptRate: 0.2, monthlyDispatchOverheadFcfa: 60_000, monthlyDeliveries: 600 };
const items = Object.fromEntries(OVERHEAD_ITEMS.map((k) => [k, 10_000]));
const H = { ...scalar, monthlyFleetOverheadFcfa: items };

describe('flotteVue — the fleet book, read defensively', () => {
  it('motos, entries, shifts, utilization, papers due and the hypotheses (flattened per scenario)', () => {
    const v = flotteVue({
      ok: true,
      motos: [{ vehicleId: 'moto-1', label: 'Moto A', fleetTranche: 1, status: 'active', odometerKm: 1_350, docs: [{ kind: 'assurance', expiresAt: '2026-10-01' }], checkedOutBy: 'rider-1' }, { label: 'sans id' }],
      entries: [{ entryId: 'e-1', vehicleId: 'moto-1', at: '2026-09-18T09:00:00.000Z', kind: 'maintenance', note: 'plaquettes', costFcfa: 12_000, odometerKm: 1_350, kwh: null }, { kind: 'carburant' }],
      shifts: [{ riderId: 'rider-1', vehicleId: 'moto-1', startedAt: '2026-09-18T08:00:00.000Z', endedAt: null }],
      hypotheses: { low: H, base: H, high: H },
      utilisation: { windowDays: 14, livrees: 3, retournees: 1, motosActives: 1, livraisonsParMotoParJour: 0.21, tauxEchec: 0.25, parMoto: [{ vehicleId: 'moto-1', label: 'Moto A', livrees: 3, retournees: 1 }] },
      documentsDus: [{ vehicleId: 'moto-1', label: 'Moto A', kind: 'assurance', expiresAt: '2026-10-01', expire: false }],
    });
    expect(v.motos).toEqual([{ vehicleId: 'moto-1', label: 'Moto A', fleetTranche: 1, status: 'active', odometerKm: 1_350, docs: [{ kind: 'assurance', expiresAt: '2026-10-01' }], checkedOutBy: 'rider-1' }]);
    expect(v.entries).toHaveLength(1);
    expect(v.entries[0]).toMatchObject({ kind: 'maintenance', costFcfa: 12_000, kwh: null });
    expect(v.shifts[0]).toEqual({ riderId: 'rider-1', vehicleId: 'moto-1', startedAt: '2026-09-18T08:00:00.000Z', endedAt: null });
    expect(v.utilisation).toMatchObject({ livrees: 3, retournees: 1, livraisonsParMotoParJour: 0.21, tauxEchec: 0.25 });
    expect(v.documentsDus).toHaveLength(1);
    expect(v.hypotheses?.base).toMatchObject({ riderCostPerShiftFcfa: 8_000, depreciation: 10_000, failedAttemptRate: 0.2 });
    expect(Object.keys(v.hypotheses!.low)).toHaveLength(SCALAR_FIELDS.length + OVERHEAD_ITEMS.length);
  });

  it('an empty or malformed book blanks nothing; a half set of hypotheses reads as none', () => {
    const v = flotteVue(null);
    expect(v).toMatchObject({ motos: [], entries: [], shifts: [], hypotheses: null, documentsDus: [] });
    expect(v.utilisation).toMatchObject({ livrees: 0, motosActives: 0, livraisonsParMotoParJour: null, tauxEchec: null, parMoto: [] });
    expect(flotteVue({ hypotheses: { low: H, base: H } }).hypotheses).toBeNull();
    expect(flotteVue({ hypotheses: { low: H, base: H, high: { ...H, deliveriesPerShift: 'huit' } } }).hypotheses).toBeNull();
  });

  it('coutsVue takes the three whole rows or nothing', () => {
    const ligne = { directDeliveryCost: 1_375, returnDeliveryCost: 2_200, allocatedFleetOverhead: 200, allocatedDispatchOverhead: 100, fullyLoadedDeliveryCost: 1_675, deliveryFunding: 1_500, deliveryContributionMargin: 125 };
    expect(coutsVue({ ok: true, couts: { low: ligne, base: ligne, high: { ...ligne, deliveryContributionMargin: -50 } } })?.high.deliveryContributionMargin).toBe(-50);
    expect(coutsVue({ ok: true, couts: { low: ligne, base: ligne } })).toBeNull();
    expect(coutsVue({ ok: true, couts: { low: ligne, base: ligne, high: { ...ligne, directDeliveryCost: 1.5 } } })).toBeNull();
    expect(COUT_LIGNES).toHaveLength(7);
  });
});

describe('the founder’s hypotheses, from the form and back', () => {
  const saisie = () => {
    const s: Record<string, string> = {};
    for (const sc of ['low', 'base', 'high']) {
      for (const [k, v] of Object.entries(scalar)) s[`${sc}.${k}`] = String(v);
      for (const item of OVERHEAD_ITEMS) s[`${sc}.${item}`] = '10000';
    }
    return s;
  };
  it('54 strings become the door’s itemized set; the rate may carry a comma; a bad field refuses the whole set by name', () => {
    const r = hypothesesDepuisSaisie({ ...saisie(), 'base.failedAttemptRate': '0,25' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hypotheses['low']).toEqual(H);
    expect(r.hypotheses['base']).toMatchObject({ failedAttemptRate: 0.25 });
    expect(hypothesesDepuisSaisie({ ...saisie(), 'high.deliveriesPerShift': '' })).toEqual({ ok: false, champ: 'high.deliveriesPerShift' });
    expect(hypothesesDepuisSaisie({ ...saisie(), 'low.electricityPerDeliveryFcfa': '12.5' })).toEqual({ ok: false, champ: 'low.electricityPerDeliveryFcfa' });
    expect(hypothesesDepuisSaisie({ ...saisie(), 'low.failedAttemptRate': '1' })).toEqual({ ok: false, champ: 'low.failedAttemptRate' });
    expect(hypothesesDepuisSaisie({ ...saisie(), 'base.insurance': '-1' })).toEqual({ ok: false, champ: 'base.insurance' });
  });
  it('the stored set comes back as the same strings', () => {
    const v = flotteVue({ hypotheses: { low: H, base: H, high: H } });
    const back = saisieDepuisHypotheses(v.hypotheses!);
    expect(back['low.riderCostPerShiftFcfa']).toBe('8000');
    expect(back['high.supervision']).toBe('10000');
    expect(hypothesesDepuisSaisie(back)).toEqual({ ok: true, hypotheses: { low: H, base: H, high: H } });
  });
  it('every word is a catalog key, and francs are spaced', () => {
    expect(motoStatutKey('retired')).toBe('flotte.statut_retiree');
    expect(entreeKey('energie')).toBe('flotte.entree_energie');
    expect(flotteRefusKey('odometer_goes_backwards')).toBe('flotte.refus_compteur');
    expect(flotteRefusKey('hypotheses_absentes')).toBe('flotte.hypotheses_absentes');
    expect(flotteRefusKey('x')).toBe('flotte.echec');
    expect(francs(1_234_567)).toBe('1 234 567 F');
    expect(francs(-375)).toBe('-375 F');
    expect(francs(0)).toBe('0 F');
  });
});
