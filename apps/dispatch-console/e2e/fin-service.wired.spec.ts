import { expect, test } from '@playwright/test';

/**
 * ═══ MANIFESTE-1 — the riders' manifests and « Autoriser la fin de service », DRIVEN ═══
 *
 * SE-I03 (one manifest, one current stop) on the founder's screen, and the
 * SE3.2 exception lever. The REAL built page (logistics base a same-origin
 * path; only the wire is answered here, contract-certified to the door:
 * 401 on a wrong key, 409 by name, 200 with the packages it covers).
 *
 * The four questions: did the tree survive the tap · is the lever present AND
 * pressable AND wired — and does NOTHING leave the desk before he chooses
 * where the package goes · does a refused act leave a way out · can he reach
 * the next step (the row reporting « en attente du coursier » on the board's
 * own re-read).
 *
 * The Worker half is proven where it lives:
 * `services/logistics-service/test/manifeste.e2e.test.ts` drives this
 * console's own port against BOTH real Workers.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

const BASE = '/sera-logistique';
const KEY = 'la-cle-du-fondateur';

type Json = Record<string, unknown>;

test('a rider carrying a package is listed with his ONE current stop → the lever opens a card and sends NOTHING → « Annuler » closes it → the first choice is refused by name and the card stays → the second is recorded → the row reads « en attente du coursier »', async ({ page }) => {
  const manifestes: Record<string, Json> = {
    'rider-boss': {
      id: 'man-rider-boss', riderId: 'rider-boss', version: 2, status: 'active',
      orderedStops: ['livraison-as-1'], custodyInventory: ['pkg-1'],
      stops: [{ stopId: 'livraison-as-1', kind: 'livraison', orderId: 'ord-1' }],
      currentStop: { stopId: 'livraison-as-1', kind: 'livraison', orderId: 'ord-1' },
      custodyReadings: [{ orderId: 'ord-1', reading: 'coursier', asOf: '2026-09-18T09:00:00.000Z' }],
    },
    'rider-awa': {
      id: 'man-rider-awa', riderId: 'rider-awa', version: 1, status: 'active',
      orderedStops: ['ramassage-as-2', 'livraison-as-2'], custodyInventory: [],
      stops: [{ stopId: 'ramassage-as-2', kind: 'ramassage', orderId: 'ord-2' }, { stopId: 'livraison-as-2', kind: 'livraison', orderId: 'ord-2' }],
      currentStop: { stopId: 'ramassage-as-2', kind: 'ramassage', orderId: 'ord-2' },
      custodyReadings: [{ orderId: 'ord-2', reading: 'ailleurs', asOf: '2026-09-18T09:00:00.000Z' }],
    },
  };
  const finDeService: Record<string, Json> = {};
  const authorizations: Json[] = [];
  await page.route(`**${BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(BASE.length);
    if (request.headers()['authorization'] !== `Bearer ${KEY}`) {
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      return;
    }
    if (path === '/ops/riders') return route.fulfill({ json: { ok: true, riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true }, { riderId: 'rider-awa', displayName: 'Awa', certified: true }] } });
    if (path === '/ops/rider-codes') return route.fulfill({ json: { ok: true, codes: [] } });
    if (path === '/ops/board') {
      return route.fulfill({
        json: {
          ok: true,
          board: {
            queued: [],
            riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false }, { riderId: 'rider-awa', displayName: 'Awa', certified: true, assignable: false }],
            assignments: [],
            aReprogrammer: [],
            enDeuxiemePassage: [],
            manifestes,
            finDeService,
          },
        },
      });
    }
    if (path === '/ops/shift/exception' && request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      authorizations.push(body);
      // The first: custody could not be read — refused by name, never « done ».
      if (authorizations.length === 1) return route.fulfill({ status: 503, json: { ok: false, reason: 'custody_unverifiable' } });
      finDeService[body['riderId'] as string] = { dispatcherAckId: body['command_id'], nextOwner: body['nextOwner'], packageIds: ['pkg-1'], at: '2026-09-18T18:00:00.000Z' };
      return route.fulfill({ json: { ok: true, status: 'autorisee', packageIds: ['pkg-1'], nextOwner: body['nextOwner'], at: '2026-09-18T18:00:00.000Z' } });
    }
    await route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });

  await page.goto('/');
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();

  // The two riders, each with ONE current stop; only the carrying one has the lever.
  const desk = page.locator('.manifeste-desk');
  await expect(desk.locator('.manifeste-row')).toHaveCount(2);
  const boss = desk.locator('.manifeste-row', { hasText: 'Boss' });
  const awa = desk.locator('.manifeste-row', { hasText: 'Awa' });
  await expect(boss).toContainText('livraison chez le client');
  await expect(boss).toContainText('1 colis sous sa garde');
  await expect(awa).toContainText('ramassage chez le vendeur');
  await expect(awa.locator('.fin-service-lever')).toHaveCount(0);
  const lever = boss.locator('.fin-service-lever');
  await expect(lever).toBeEnabled();

  // The lever opens the card and sends NOTHING.
  await lever.click();
  await expect(boss.locator('.fin-service-card')).toBeVisible();
  await expect(boss.locator('.fin-service-card')).toContainText('Le colis reste sous sa garde');
  expect(authorizations).toHaveLength(0);

  // « Annuler » closes it — nothing sent.
  await boss.locator('.fin-service-annuler').click();
  await expect(boss.locator('.fin-service-card')).toHaveCount(0);
  expect(authorizations).toHaveLength(0);

  // The first choice: refused by name (custody could not be read); the card stays, with the reason.
  await boss.locator('.fin-service-lever').click();
  await boss.locator('.fin-service-base').click();
  await expect(boss.locator('.reprog-notice')).toContainText("La garde n'a pas pu être vérifiée");
  await expect(boss.locator('.fin-service-card')).toBeVisible();
  expect(authorizations).toHaveLength(1);
  expect(authorizations[0]).toMatchObject({ riderId: 'rider-boss', nextOwner: { kind: 'return_to_hub_task', ref: 'pkg-1' } });
  const firstId = authorizations[0]!['command_id'];

  // The other choice with NOBODY named: refused here, nothing sent, the card stays.
  await boss.locator('.fin-service-autre').click();
  await expect(boss.locator('.reprog-notice')).toContainText('Dites quel coursier reprend le colis.');
  await expect(boss.locator('.fin-service-card')).toBeVisible();
  expect(authorizations).toHaveLength(1);

  // The courier named: recorded with WHO; the SAME command id rides the retry.
  await boss.locator('.fin-service-coursier').fill('Awa');
  await boss.locator('.fin-service-autre').click();
  await expect(desk.locator('.reprog-fait').first()).toContainText('Fin de service autorisée');
  expect(authorizations).toHaveLength(2);
  expect(authorizations[1]).toMatchObject({ command_id: firstId, riderId: 'rider-boss', nextOwner: { kind: 'reassignment', ref: 'Awa' } });
  // The board's own re-read: the row now reads « en attente du coursier », no lever.
  await expect(boss).toContainText('Autorisation donnée, en attente du coursier.');
  await expect(boss).toContainText('Un autre coursier reprend le colis');
  await expect(boss.locator('.fin-service-lever')).toHaveCount(0);
  await expect(boss.locator('.fin-service-card')).toHaveCount(0);
});

test('a package the ledger still places with a rider whose course the desk took back is listed with NO stop and the plain sentence — the lever is there', async ({ page }) => {
  await page.route(`**${BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(BASE.length);
    if (request.headers()['authorization'] !== `Bearer ${KEY}`) return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    if (path === '/ops/riders') return route.fulfill({ json: { ok: true, riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true }] } });
    if (path === '/ops/rider-codes') return route.fulfill({ json: { ok: true, codes: [] } });
    if (path === '/ops/board') {
      return route.fulfill({
        json: {
          ok: true,
          board: {
            queued: [], riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false }], assignments: [], aReprogrammer: [], enDeuxiemePassage: [],
            manifestes: { 'rider-boss': { id: 'man-rider-boss', riderId: 'rider-boss', version: 2, status: 'active', orderedStops: [], custodyInventory: ['pkg-9'], stops: [], currentStop: null, custodyReadings: [{ orderId: 'ord-9', reading: 'coursier', asOf: '2026-09-18T09:00:00.000Z' }] } },
            finDeService: {},
          },
        },
      });
    }
    await route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });
  await page.goto('/');
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();
  const boss = page.locator('.manifeste-desk .manifeste-row', { hasText: 'Boss' });
  await expect(boss).toContainText('Colis sous sa garde, sans course.');
  await expect(boss).not.toContainText('Étape en cours');
  await expect(boss.locator('.fin-service-lever')).toBeEnabled();
});
