import { expect, test } from '@playwright/test';

/**
 * ═══ REPROGRAMMATION-2 — « Renvoyer au vendeur », DRIVEN in a real browser ═══
 *
 * The founder's other decision on a rescheduled course (Sera-Build-Spec §6.5:
 * « dispatcher applies … return »). The REAL built page (logistics base a
 * same-origin path; only the wire is answered here, contract-certified to the
 * decider door: 401 on a wrong key, 409 by name, 200 with custody's instant).
 *
 * The four questions: did the tree survive the tap · is the lever present AND
 * pressable AND wired — and does NOTHING leave the desk before he confirms ·
 * does a refused act leave a way out · can he reach the next step (the row
 * gone on the board's own re-read, the decision reported in his words).
 *
 * The wired Worker half is proven where it lives:
 * `services/logistics-service/test/reprogrammation.e2e.test.ts` drives this
 * console's own port against BOTH real Workers.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

const BASE = '/sera-logistique';
const KEY = 'la-cle-du-fondateur';
const DECIDE_AT = '2026-09-17T10:00:00.000Z';

type Json = Record<string, unknown>;

test('the course on its 2e passage is listed with the fixed window → « Renvoyer au vendeur » opens a confirmation and sends NOTHING → « Annuler » closes it → confirmed: the door refuses by name, the lever stays usable → confirmed again on the SAME command: the decision lands, is reported in his words, and the row leaves on the board’s own re-read', async ({ page }) => {
  const enDeuxiemePassage: Json[] = [
    { orderId: 'ord-2e', taskId: 'task-2', assignmentId: 'as-1', riderId: 'rider-boss', passage: 2, window: { start: '2026-09-18T10:00:00.000Z', end: '2026-09-18T12:00:00.000Z' } },
  ];
  const aReprogrammer: Json[] = [
    { orderId: 'ord-attente', taskId: 'task-9', assignmentId: 'as-9', riderId: 'rider-boss', reasonCode: 'unusable_location', recordedAt: '2026-09-17T09:16:00.000Z' },
  ];
  const decisions: Json[] = [];
  let boardReads = 0;
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
      boardReads += 1;
      return route.fulfill({
        json: {
          ok: true,
          board: {
            queued: [],
            riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false }],
            assignments: [{ assignmentId: 'as-1', taskId: 'task-2', orderId: 'ord-2e', riderId: 'rider-boss', status: 'acknowledged' }],
            aReprogrammer,
            enDeuxiemePassage,
          },
        },
      });
    }
    if (path === '/ops/retour/decider' && request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      decisions.push(body);
      // The first: custody could not be reached — said as such, never « done ».
      if (decisions.length === 1) return route.fulfill({ status: 503, json: { ok: false, reason: 'custody_unreachable' } });
      // The second: custody recorded the return; the board no longer lists the course.
      enDeuxiemePassage.length = 0;
      return route.fulfill({ json: { ok: true, status: 'retour_decide', decideAt: DECIDE_AT, outcome: { family: 'return' } } });
    }
    return route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });

  await page.goto('/');
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();

  const desk = page.locator('.reprog-desk');
  // Both lists on the desk: the course waiting for a passage keeps its fixer
  // AND gets the lever home; the course on its 2e passage has the lever only.
  await expect(desk.locator('.reprog-row')).toHaveCount(2);
  const deuxieme = desk.locator('.reprog-row-deuxieme');
  await expect(deuxieme.locator('.reprog-row-order')).toHaveText('ord-2e');
  await expect(deuxieme.locator('.reprog-row-etat')).toContainText('2e passage fixé');
  await expect(deuxieme.locator('.reprog-row-etat')).toContainText('colis avec Boss');
  await expect(deuxieme.locator('.reprog-row-depuis')).toContainText('Passage prévu');
  await expect(deuxieme.locator('button.reprog-fixer')).toHaveCount(0);
  await expect(desk.locator('button.reprog-renvoyer')).toHaveCount(2);
  const lever = deuxieme.locator('button.reprog-renvoyer');
  await expect(lever).toHaveText('Renvoyer au vendeur');
  await expect(lever).toBeEnabled();

  // The lever asks; it does not act. Nothing left the desk.
  await lever.click();
  const card = deuxieme.locator('.reprog-renvoi-card');
  await expect(card.locator('.reprog-renvoi-titre')).toHaveText('Renvoyer ce colis au vendeur ?');
  await expect(card).toContainText('ord-2e');
  await expect(card).toContainText('Aucun frais pour le client.');
  expect(decisions).toHaveLength(0);
  // Cancel is a way out, and it too sends nothing.
  await card.locator('button.reprog-renvoi-annuler').click();
  await expect(deuxieme.locator('.reprog-renvoi-card')).toHaveCount(0);
  await expect(lever).toBeEnabled();
  expect(decisions).toHaveLength(0);

  // Confirmed: the door says custody was out of reach — the sentence on the
  // row, the lever usable again, the course still listed.
  await lever.click();
  await deuxieme.locator('button.reprog-renvoi-confirmer').click();
  await expect(deuxieme.locator('.reprog-notice')).toHaveText("Le service de garde n'a pas répondu. Réessayez.");
  await expect(deuxieme.locator('button.reprog-renvoyer')).toBeEnabled();
  await expect(desk.locator('.reprog-row')).toHaveCount(2);
  expect(decisions).toHaveLength(1);
  expect(decisions[0]!['orderId']).toBe('ord-2e');
  expect(String(decisions[0]!['command_id'])).toMatch(/^cmd-console-renvoi-ord-2e-/);

  // Confirmed again: the SAME command id (custody replays by it if the first
  // relay landed after all), and the decision lands — reported in his words,
  // the row gone because the BOARD says so, the waiting course untouched.
  const readsBefore = boardReads;
  await deuxieme.locator('button.reprog-renvoyer').click();
  await deuxieme.locator('button.reprog-renvoi-confirmer').click();
  await expect(desk.locator('.reprog-fait')).toContainText('ord-2e — Retour décidé. Le coursier ramène le colis au vendeur.');
  await expect(desk.locator('.reprog-row')).toHaveCount(1);
  await expect(desk.locator('.reprog-row-order')).toHaveText('ord-attente');
  expect(decisions).toHaveLength(2);
  expect(decisions[1]!['command_id']).toBe(decisions[0]!['command_id']);
  expect(boardReads).toBeGreaterThan(readsBefore);
  // The waiting course's lever home is still there — and its fixer too.
  await expect(desk.locator('button.reprog-renvoyer')).toHaveCount(1);
  await expect(desk.locator('button.reprog-fixer')).toHaveCount(1);
  // The tree survived every tap.
  await expect(page.getByRole('heading', { name: 'Codes coursiers' })).toBeVisible();
});
