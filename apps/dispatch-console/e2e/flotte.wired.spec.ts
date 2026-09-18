import { expect, test } from '@playwright/test';

/**
 * ═══ FLOTTE-1 (SE7.2) — the fleet desk, DRIVEN in a real browser ═══
 *
 * The REAL built page (logistics base a same-origin path; only the wire is
 * answered here, contract-certified to the `/ops/flotte*` doors: 401 on a
 * wrong key, 400/404/409 by name, 200 with the book's own rows).
 *
 * The four questions: did the tree survive each tap · are the acts present
 * AND pressable AND wired (the bytes that left) · does a refusal leave a way
 * out (the compteur refused by name, the hypotheses refused by field) · can
 * he reach the next step (the moto on the list, the yardstick, the cost
 * table under his three scenarios). ⏳ No default figure anywhere: the cost
 * desk reads « à renseigner » until he types his numbers.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

const BASE = '/sera-logistique';
const KEY = 'la-cle-du-fondateur';
type Json = Record<string, unknown>;

const OVERHEAD = ['depreciation', 'batteryReserve', 'maintenance', 'tyresBrakes', 'insurance', 'registration', 'theftAccidentReserve', 'riderPhoneData', 'chargingInfra', 'downtime', 'supervision', 'supportReconciliation'];
const SCALARS = ['riderCostPerShiftFcfa', 'deliveriesPerShift', 'electricityPerDeliveryFcfa', 'failedAttemptRate', 'monthlyDispatchOverheadFcfa', 'monthlyDeliveries'];

test('an empty book → declare a moto → a reading refused by name → a repair noted → the moto confided to a rider → the yardstick reads; the hypotheses are « à renseigner » until typed, then the cost table shows the three scenarios', async ({ page }) => {
  const motos: Json[] = [];
  let hypotheses: Json | null = null;
  const acts: { path: string; body: Json }[] = [];
  const book = () => ({
    ok: true,
    motos,
    entries: [],
    shifts: motos.length > 0 ? [{ shiftId: 's-1', riderId: 'rider-boss', vehicleId: motos[0]!['vehicleId'], startedAt: '2026-09-18T08:00:00.000Z', endedAt: null }] : [],
    coursesCount: motos.length > 0 ? 3 : 0,
    hypotheses,
    utilisation: motos.length === 0
      ? { windowDays: 14, livrees: 0, retournees: 0, motosActives: 0, livraisonsParMotoParJour: null, tauxEchec: null, parMoto: [] }
      : { windowDays: 14, livrees: 3, retournees: 1, motosActives: 1, livraisonsParMotoParJour: 0.21, tauxEchec: 0.25, parMoto: [{ vehicleId: 'moto-1', label: 'Moto A', livrees: 3, retournees: 1 }] },
    documentsDus: [],
  });
  await page.route(`**${BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(BASE.length);
    if (request.headers()['authorization'] !== `Bearer ${KEY}`) return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    if (path === '/ops/riders') return route.fulfill({ json: { ok: true, riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true }] } });
    if (path === '/ops/rider-codes') return route.fulfill({ json: { ok: true, codes: [{ riderId: 'rider-boss', displayName: 'Boss', hasCode: true }] } });
    if (path === '/ops/board') return route.fulfill({ json: { ok: true, board: { queued: [], riders: [], assignments: [], aReprogrammer: [], enDeuxiemePassage: [], manifestes: {}, finDeService: {} } } });
    if (path === '/ops/flotte' && request.method() === 'GET') return route.fulfill({ json: book() });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      acts.push({ path, body });
      if (path === '/ops/flotte/moto') {
        const moto = { vehicleId: 'moto-1', label: body['label'], fleetTranche: body['fleetTranche'], status: 'active', odometerKm: 0, docs: [], checkedOutBy: null };
        motos.push(moto);
        return route.fulfill({ json: { ok: true, status: 'declaree', moto } });
      }
      if (path === '/ops/flotte/moto/entree') {
        if (body['kind'] === 'compteur') return route.fulfill({ status: 409, json: { ok: false, reason: 'odometer_goes_backwards' } });
        return route.fulfill({ json: { ok: true, status: 'notee', entry: { entryId: 'e-1' } } });
      }
      if (path === '/ops/flotte/moto/confier') {
        motos[0] = { ...motos[0]!, checkedOutBy: body['riderId'] };
        return route.fulfill({ json: { ok: true, status: 'confiee', moto: motos[0] } });
      }
      if (path === '/ops/flotte/hypotheses') {
        hypotheses = body['hypotheses'] as Json;
        return route.fulfill({ json: { ok: true, status: 'enregistrees', hypotheses } });
      }
    }
    if (path.startsWith('/ops/flotte/cout')) {
      const ligne = { directDeliveryCost: 1375, returnDeliveryCost: 2200, allocatedFleetOverhead: 200, allocatedDispatchOverhead: 100, fullyLoadedDeliveryCost: 1675, deliveryFunding: 1500, deliveryContributionMargin: 125 };
      return route.fulfill({ json: { ok: true, orderId: 'ord-1', deliveryFunding: 1500, couts: { low: ligne, base: { ...ligne, directDeliveryCost: 2200, deliveryContributionMargin: -700 }, high: { ...ligne, directDeliveryCost: 2625, deliveryContributionMargin: -1125 } } } });
    }
    await route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });

  await page.goto('/');
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();

  const desk = page.locator('.flotte-desk');
  await expect(desk.locator('.flotte-vide')).toContainText('Aucune moto déclarée.');
  await expect(desk.locator('.flotte-util-yardstick')).toContainText('Déclarez une moto pour lire ce chiffre.');
  await expect(desk.locator('.flotte-hyp-absentes')).toContainText('Hypothèses à renseigner.');
  await expect(desk.locator('.flotte-cout-btn')).toHaveCount(0);

  // Declare a moto: the bytes that left, the row on the list on the book's own re-read.
  await desk.locator('.flotte-label').fill('Moto A');
  await desk.locator('.flotte-tranche').fill('1');
  await desk.locator('.flotte-declarer-btn').click();
  await expect(desk.locator('.flotte-moto')).toHaveCount(1);
  expect(acts[0]).toMatchObject({ path: '/ops/flotte/moto', body: { label: 'Moto A', fleetTranche: 1 } });
  expect(String(acts[0]!.body['command_id'])).toMatch(/^cmd-console-flotte-moto-/);
  await expect(desk.locator('.flotte-moto-label')).toHaveText('Moto A');
  await expect(desk.locator('.reprog-fait').first()).toContainText('Moto déclarée.');
  // …and the yardstick now reads.
  await expect(desk.locator('.flotte-util-yardstick')).toContainText('0.21 livraisons par moto et par jour');
  await expect(desk.locator('.flotte-util')).toContainText('25 % de courses non abouties');

  // A reading refused by name: the way out is the same form, still there.
  await desk.locator('.flotte-noter-kind').selectOption('compteur');
  await desk.locator('.flotte-noter-km').fill('900');
  await desk.locator('.flotte-noter-btn').click();
  await expect(desk.locator('.flotte-notice')).toContainText('Le compteur ne peut pas reculer.');
  await expect(desk.locator('.flotte-noter-btn')).toBeEnabled();
  expect(acts[1]).toMatchObject({ path: '/ops/flotte/moto/entree', body: { vehicleId: 'moto-1', kind: 'compteur', odometerKm: 900 } });

  // A repair noted: cost and note ride the wire.
  await desk.locator('.flotte-noter-kind').selectOption('maintenance');
  await desk.locator('.flotte-noter-cout').fill('12000');
  await desk.locator('.flotte-noter-note').fill('plaquettes');
  await desk.locator('.flotte-noter-btn').click();
  await expect(desk.locator('.reprog-fait').nth(1)).toContainText('Noté.');
  expect(acts[2]).toMatchObject({ path: '/ops/flotte/moto/entree', body: { vehicleId: 'moto-1', kind: 'maintenance', costFcfa: 12000, note: 'plaquettes' } });

  // Confided to Boss.
  await desk.locator('.flotte-confier-select').selectOption('rider-boss');
  await desk.locator('.flotte-confier-btn').click();
  await expect(desk.locator('.flotte-moto-garde')).toContainText('Confiée à Boss');
  expect(acts[3]).toMatchObject({ path: '/ops/flotte/moto/confier', body: { vehicleId: 'moto-1', riderId: 'rider-boss' } });
  await expect(desk.locator('.flotte-services')).toContainText('Boss · Moto A');

  // The hypotheses: one bad field refuses the whole set, named; nothing leaves the desk.
  const before = acts.length;
  for (const s of ['low', 'base', 'high']) {
    for (const f of SCALARS) {
      const v = f === 'failedAttemptRate' ? '0,2' : f === 'deliveriesPerShift' ? '8' : f === 'monthlyDeliveries' ? '600' : f === 'riderCostPerShiftFcfa' ? '8000' : f === 'electricityPerDeliveryFcfa' ? '100' : '60000';
      await desk.locator('.flotte-hyp tr', { hasText: labelOf(f) }).locator('input').nth(['low', 'base', 'high'].indexOf(s)).fill(v);
    }
    for (const item of OVERHEAD) {
      await desk.locator('.flotte-hyp tr', { hasText: labelOf(item) }).locator('input').nth(['low', 'base', 'high'].indexOf(s)).fill('10000');
    }
  }
  await desk.locator('.flotte-hyp tr', { hasText: labelOf('deliveriesPerShift') }).locator('input').nth(1).fill('');
  await desk.locator('.flotte-hyp-btn').click();
  await expect(desk.locator('.flotte-cout-notice')).toContainText("Un chiffre n'est pas bon : Moyen — Livraisons par service");
  expect(acts.length).toBe(before);
  await desk.locator('.flotte-hyp tr', { hasText: labelOf('deliveriesPerShift') }).locator('input').nth(1).fill('8');
  await desk.locator('.flotte-hyp-btn').click();
  // The fourth report line: declared, noted, confided, then the hypotheses.
  await expect(desk.locator('.reprog-fait').nth(3)).toContainText('Hypothèses enregistrées.');
  expect(acts[before]).toMatchObject({ path: '/ops/flotte/hypotheses' });
  const sent = acts[before]!.body['hypotheses'] as Record<string, Json>;
  expect(sent['base']).toMatchObject({ riderCostPerShiftFcfa: 8000, deliveriesPerShift: 8, failedAttemptRate: 0.2, monthlyFleetOverheadFcfa: { insurance: 10000 } });
  await expect(desk.locator('.flotte-hyp-absentes')).toHaveCount(0);

  // The decomposition for one order under the three scenarios.
  await desk.locator('.flotte-cout-order').fill('ord-1');
  await desk.locator('.flotte-cout-d').fill('1500');
  await desk.locator('.flotte-cout-btn').click();
  const table = desk.locator('.flotte-cout-table');
  await expect(table).toBeVisible();
  await expect(table.locator('.flotte-cout-ligne', { hasText: 'Coût direct' })).toContainText('1 375 F');
  await expect(table.locator('.flotte-cout-ligne', { hasText: 'Coût direct' })).toContainText('2 625 F');
  await expect(table.locator('.flotte-cout-ligne', { hasText: 'Marge' })).toContainText('-700 F');
  await expect(table.locator('.flotte-cout-ligne', { hasText: 'Coût complet' })).toContainText('1 675 F');
});

function labelOf(field: string): string {
  const labels: Record<string, string> = {
    riderCostPerShiftFcfa: "Coût d'un service coursier",
    deliveriesPerShift: 'Livraisons par service',
    electricityPerDeliveryFcfa: 'Électricité par livraison',
    failedAttemptRate: 'Part des tentatives ratées',
    monthlyDispatchOverheadFcfa: 'Dispatch par mois',
    monthlyDeliveries: 'Livraisons par mois',
    depreciation: 'Usure des motos',
    batteryReserve: 'Réserve batteries',
    maintenance: 'Entretien (F par mois)',
    tyresBrakes: 'Pneus et freins',
    insurance: 'Assurance',
    registration: 'Carte grise et plaques',
    theftAccidentReserve: 'Réserve vol et accident',
    riderPhoneData: 'Téléphone et données coursier',
    chargingInfra: 'Recharge (F par mois)',
    downtime: "Temps d'arrêt",
    supervision: 'Supervision',
    supportReconciliation: 'Support et rapprochement',
  };
  return labels[field] ?? field;
}
