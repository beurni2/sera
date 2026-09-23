import { expect, test } from '@playwright/test';

/**
 * ═══ COLIS-2 — « Retirer » on a package, DRIVEN in a real browser ═══
 *
 * The founder (2026-09-23): « « Retirer » on your console removes the whole
 * package. » The REAL built page (logistics base a same-origin path; only the
 * wire is answered here, contract-certified to the retire door: 401 on a wrong
 * key, 409 `colis_en_course` for one article of a bag a rider carries unless
 * `colisEntier`, 200 `retire` otherwise — and the board re-read says what is
 * left, as the Worker's own board does).
 *
 * The four questions: did the tree survive the tap · is each lever present
 * AND pressable AND wired — and does NOTHING leave the desk before he
 * confirms · does a refused act leave a way out · can he reach the next step
 * (the row gone on the board's own re-read).
 *
 * The Worker half is proven where it lives:
 * `services/logistics-service/test/retirer.e2e.test.ts` (COLIS-2) drives this
 * console's own port against the REAL Worker.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

const BASE = '/sera-logistique';
const KEY = 'la-cle-du-fondateur';

type Json = Record<string, unknown>;

/** A small board the door edits as the Worker would: a waiting package of
 *  two, a package of two in Boss's hands, and one plain waiting course. */
function monde() {
  const etat = {
    attente: ['ord-a1', 'ord-a2'],
    enMains: ['ord-p1', 'ord-p2'],
    seule: true,
  };
  const appels: Json[] = [];
  const board = (): Json => ({
    queued: [
      ...(etat.attente.length > 0
        ? [{ taskId: 'task-a', orderId: etat.attente[0], ...(etat.attente.length > 1 ? { colis: { orderIds: etat.attente } } : {}) }]
        : []),
      ...(etat.seule ? [{ taskId: 'task-s', orderId: 'ord-s' }] : []),
    ],
    riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: etat.enMains.length === 0 }],
    assignments: etat.enMains.length > 0 ? [{ assignmentId: 'as-p', taskId: 'task-p', orderId: 'ord-p1', riderId: 'rider-boss', status: 'acknowledged' }] : [],
    colisEnCourse: etat.enMains.length > 0 ? { 'as-p': { packageId: 'col-p', orderIds: etat.enMains, reglement: {} } } : {},
    aReprogrammer: [],
    enDeuxiemePassage: [],
  });
  const retirer = (body: Json): { status: number; json: Json } => {
    appels.push(body);
    const orderId = body['orderId'] as string;
    if (etat.enMains.includes(orderId)) {
      if (body['colisEntier'] !== true) return { status: 409, json: { ok: false, reason: 'colis_en_course', orderIds: etat.enMains } };
      etat.enMains = [];
      return { status: 200, json: { ok: true, status: 'retire', removed: {} } };
    }
    if (etat.attente.includes(orderId)) {
      etat.attente = etat.attente.filter((id) => id !== orderId);
      return { status: 200, json: { ok: true, status: 'retire', removed: {} } };
    }
    if (orderId === 'ord-s' && etat.seule) {
      etat.seule = false;
      return { status: 200, json: { ok: true, status: 'retire', removed: {} } };
    }
    return { status: 200, json: { ok: true, status: 'inconnu' } };
  };
  return { board, retirer, appels };
}

/** `lectureInitiale`: what the FIRST board read answers, when the desk must
 *  have read a board the Worker has since moved past. */
async function brancher(page: import('@playwright/test').Page, m: ReturnType<typeof monde>, lectureInitiale?: Json): Promise<void> {
  let premiere = lectureInitiale;
  await page.route(`**${BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(BASE.length);
    if (request.headers()['authorization'] !== `Bearer ${KEY}`) {
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      return;
    }
    if (path === '/ops/riders') return route.fulfill({ json: { ok: true, riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true }] } });
    if (path === '/ops/rider-codes') return route.fulfill({ json: { ok: true, codes: [] } });
    if (path === '/ops/board') {
      const board = premiere ?? m.board();
      premiere = undefined;
      return route.fulfill({ json: { ok: true, board } });
    }
    if (path === '/ops/order/retirer' && request.method() === 'POST') {
      const answer = m.retirer(request.postDataJSON() as Json);
      return route.fulfill({ status: answer.status, json: answer.json });
    }
    return route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });
  await page.goto('/');
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();
}

function ligne(page: import('@playwright/test').Page, orderId: string) {
  return page.locator('.courses-desk .courses-row').filter({ has: page.locator('.courses-row-order', { hasText: orderId }) });
}

test('a waiting package is one row per article → « Retirer » on ONE article names it alone, says the rest of the bag stays, and sends nothing before « Oui » → confirmed, only that article leaves; its package-mate stays on the board', async ({ page }) => {
  const m = monde();
  await brancher(page, m);
  const desk = page.locator('.courses-desk');

  await expect(desk.locator('.courses-row')).toHaveCount(5);
  await expect(ligne(page, 'ord-a2').locator('.courses-row-colis')).toHaveText('Même colis : ord-a1 · ord-a2');
  const lever = ligne(page, 'ord-a2').locator('button.courses-retirer');
  await expect(lever).toHaveText('Retirer');
  await expect(lever).toBeEnabled();

  // The lever asks; it does not act.
  await lever.click();
  const card = desk.locator('.courses-confirme');
  await expect(card.locator('.courses-confirme-titre')).toHaveText('Retirer cette course du tableau ?');
  await expect(card).toContainText('ord-a2');
  await expect(card).not.toContainText('ord-a1');
  await expect(card).toContainText('Seul cet article part. Les autres articles du colis restent sur le tableau.');
  expect(m.appels).toHaveLength(0);
  await card.locator('button.courses-annuler').click();
  await expect(desk.locator('.courses-confirme')).toHaveCount(0);
  expect(m.appels).toHaveLength(0);

  await lever.click();
  await desk.locator('button.courses-confirmer').click();

  // Only that article left — the board's own re-read says so.
  await expect(desk.locator('.courses-row')).toHaveCount(4);
  await expect(ligne(page, 'ord-a2')).toHaveCount(0);
  await expect(ligne(page, 'ord-a1')).toHaveCount(1);
  // Its package-mate now rides alone: no « Même colis » line left on it.
  await expect(ligne(page, 'ord-a1').locator('.courses-row-colis')).toHaveCount(0);
  expect(m.appels).toHaveLength(1);
  expect(m.appels[0]!['orderId']).toBe('ord-a2');
  expect(m.appels[0]!['colisEntier']).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Courses du tableau' })).toBeVisible();
});

test('a package in a rider’s hands says « Retirer le colis » → the confirmation names EVERY article and says they leave together → confirmed, ONE whole-bag call and both rows leave; « Tout retirer » then calls once per remaining course', async ({ page }) => {
  const m = monde();
  await brancher(page, m);
  const desk = page.locator('.courses-desk');

  const p2 = ligne(page, 'ord-p2');
  await expect(p2.locator('.courses-row-etat')).toContainText('Boss');
  await expect(p2.locator('.courses-row-colis')).toHaveText('Même colis : ord-p1 · ord-p2');
  const lever = p2.locator('button.courses-retirer');
  await expect(lever).toHaveText('Retirer le colis');

  await lever.click();
  const card = desk.locator('.courses-confirme');
  await expect(card.locator('.courses-confirme-titre')).toHaveText('Retirer tout ce colis du tableau ?');
  await expect(card).toContainText('ord-p1 · ord-p2');
  await expect(card).toContainText('Le coursier a déjà ce colis : tous ses articles quittent le tableau ensemble.');
  expect(m.appels).toHaveLength(0);
  await desk.locator('button.courses-confirmer').click();

  await expect(ligne(page, 'ord-p1')).toHaveCount(0);
  await expect(ligne(page, 'ord-p2')).toHaveCount(0);
  expect(m.appels).toEqual([expect.objectContaining({ orderId: 'ord-p2', colisEntier: true })]);
  await expect(desk.locator('.courses-notice')).toHaveCount(0);

  // « Tout retirer » over what is left: each waiting article alone.
  await desk.locator('button.courses-tout').click();
  await expect(desk.locator('.courses-confirme .courses-confirme-titre')).toHaveText('Retirer toutes les courses du tableau ?');
  await desk.locator('button.courses-confirmer').click();
  await expect(desk.locator('.courses-state')).toHaveText('Aucune course sur le tableau.');
  expect(m.appels.slice(1).map((a) => [a['orderId'], a['colisEntier']])).toEqual([
    ['ord-a1', undefined],
    ['ord-a2', undefined],
    ['ord-s', undefined],
  ]);
});

test('one article of a bag on the road, refused by the door (a rider took it between the read and the tap): the row says it did not leave, the lever stays usable, and the re-read offers the whole bag', async ({ page }) => {
  const m = monde();
  // The board the desk read still shows the package waiting…
  const lu = { ...m.board(), queued: [{ taskId: 'task-p', orderId: 'ord-p1', colis: { orderIds: ['ord-p1', 'ord-p2'] } }], assignments: [], colisEnCourse: {} };
  await brancher(page, m, lu);
  const desk = page.locator('.courses-desk');

  await expect(ligne(page, 'ord-p2').locator('button.courses-retirer')).toHaveText('Retirer');
  await ligne(page, 'ord-p2').locator('button.courses-retirer').click();
  await desk.locator('button.courses-confirmer').click();

  // …but the door answers for the bag in Boss's hands: refused, by name.
  expect(m.appels).toEqual([expect.objectContaining({ orderId: 'ord-p2' })]);
  await expect(ligne(page, 'ord-p2').locator('.courses-notice')).toHaveText("Cette course n'a pas pu être retirée.");
  // The re-read shows the truth and its right lever.
  await expect(ligne(page, 'ord-p2').locator('button.courses-retirer')).toHaveText('Retirer le colis');
  await expect(ligne(page, 'ord-p2').locator('button.courses-retirer')).toBeEnabled();
  await expect(ligne(page, 'ord-p1')).toHaveCount(1);
});

test('« Tout retirer » with a bag on the road: ONE whole-bag call for the bag, each waiting course alone — every row leaves, none is refused', async ({ page }) => {
  const m = monde();
  await brancher(page, m);
  const desk = page.locator('.courses-desk');
  await expect(desk.locator('.courses-row')).toHaveCount(5);

  await desk.locator('button.courses-tout').click();
  const card = desk.locator('.courses-confirme');
  await expect(card.locator('.courses-confirme-titre')).toHaveText('Retirer toutes les courses du tableau ?');
  // Every row is named, the bag's two articles included.
  await expect(card).toContainText('ord-a1 · ord-a2 · ord-p1 · ord-p2 · ord-s');
  expect(m.appels).toHaveLength(0);
  await desk.locator('button.courses-confirmer').click();

  await expect(desk.locator('.courses-state')).toHaveText('Aucune course sur le tableau.');
  await expect(desk.locator('.courses-notice')).toHaveCount(0);
  expect(m.appels.map((a) => [a['orderId'], a['colisEntier']])).toEqual([
    ['ord-a1', undefined],
    ['ord-a2', undefined],
    ['ord-p1', true],
    ['ord-s', undefined],
  ]);
});
