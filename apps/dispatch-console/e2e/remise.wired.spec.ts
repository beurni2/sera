import { expect, test } from '@playwright/test';

/**
 * ═══ « Débloquer le code », DRIVEN in a real browser ═══
 *
 * Founder ruling (2026-11-26): « drop code locks after 5 tries (console
 * unlock) », on the Séra dispatch console. The REAL built page (logistics
 * base a same-origin path); only the wire is answered here, contract-
 * certified to the logistics doors: 401 on a wrong key, the board's
 * `codesBloques` rows and `codesBloquesPartiel` flag, and `/ops/remise/
 * debloquer` answering 409 by name or 200 `{ok, status:'debloque'}`.
 *
 * The four questions: did the tree survive the tap · is the lever present AND
 * pressable AND wired — and does NOTHING leave the desk before he confirms ·
 * does a refused act leave a way out · can he reach the next step (done in
 * his words, the row gone on the board's own re-read).
 *
 * The wired Worker half is proven where it lives:
 * `services/logistics-service/test/code-bloque.e2e.test.ts` drives this
 * console's own port against BOTH real Workers.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

const BASE = '/sera-logistique';
const KEY = 'la-cle-du-fondateur';
const DROP = 'DROP-NE-DOIT-PAS-PARAITRE';

type Json = Record<string, unknown>;

function boardOf(codesBloques: Json[], partiel: boolean): Json {
  return {
    ok: true,
    board: {
      queued: [],
      riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false }],
      assignments: [{ assignmentId: 'as-1', taskId: 'task-1', orderId: 'ord-a', riderId: 'rider-boss', status: 'acknowledged' }],
      colisEnCourse: { 'as-1': { orderIds: ['ord-a', 'ord-b'] } },
      aReprogrammer: [],
      enDeuxiemePassage: [],
      codesBloques,
      codesBloquesPartiel: partiel,
    },
  };
}

test('the key comes first → the locked course is listed with its rider, both articles and since when → « Débloquer le code » opens a confirmation and sends NOTHING → « Annuler » closes it → confirmed: a refusal by name leaves the lever usable → confirmed again on the SAME command: done in his words, and the row leaves on the board\'s own re-read', async ({ page }) => {
  const locked: Json[] = [{ assignmentId: 'as-1', riderId: 'rider-boss', orderIds: ['ord-a', 'ord-b'], depuis: '2026-11-26T09:10:00.000Z' }];
  const unlocks: Json[] = [];
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
      return route.fulfill({ json: boardOf(locked, false) });
    }
    if (path === '/ops/remise/debloquer' && request.method() === 'POST') {
      unlocks.push(request.postDataJSON() as Json);
      if (unlocks.length === 1) return route.fulfill({ status: 409, json: { ok: false, reason: 'custody_refused', detail: 'refused' } });
      locked.length = 0;
      return route.fulfill({ json: { ok: true, status: 'debloque' } });
    }
    return route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });

  await page.goto('/');
  const desk = page.locator('.remise-desk');
  await expect(page.getByRole('heading', { name: 'Codes de la cliente bloqués' })).toBeVisible();
  // Before the key, the desk says what to do — and nothing was read.
  await expect(desk).toContainText('Entrez la clé dans « Codes coursiers » pour voir ces courses.');
  expect(boardReads).toBe(0);

  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();

  await expect(desk).toContainText('Cinq mauvais codes ont été tapés. Rien n\'a été remis : le coursier garde le colis.');
  await expect(desk).toContainText('Appelez la cliente et le coursier avant de débloquer.');
  const row = desk.locator('.remise-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Boss');
  await expect(row).toContainText('ord-a');
  await expect(row).toContainText('ord-b');
  await expect(row.locator('.remise-row-depuis')).toContainText('Bloqué depuis');
  await expect(desk).not.toContainText(DROP);

  const lever = row.locator('button.remise-debloquer');
  await expect(lever).toHaveText('Débloquer le code');
  await expect(lever).toBeEnabled();

  // The lever asks; it does not act.
  await lever.click();
  const card = row.locator('.remise-card');
  await expect(card).toContainText('Débloquer ce code ?');
  await expect(card).toContainText('Le coursier aura de nouveau cinq essais.');
  expect(unlocks).toHaveLength(0);
  await card.locator('button.remise-annuler').click();
  await expect(row.locator('.remise-card')).toHaveCount(0);
  await expect(lever).toBeEnabled();
  expect(unlocks).toHaveLength(0);

  // Confirmed: refused by name — the sentence on the row, the lever usable.
  await lever.click();
  await row.locator('button.remise-confirmer').click();
  await expect(row.locator('.remise-notice')).toContainText('Le code n\'a pas pu être débloqué.');
  await expect(row.locator('.remise-notice')).toContainText('Relisez le tableau, puis réessayez.');
  await expect(row.locator('button.remise-debloquer')).toBeEnabled();
  expect(unlocks).toHaveLength(1);
  expect(unlocks[0]!['orderId']).toBe('ord-a');
  expect(String(unlocks[0]!['command_id'])).toMatch(/^cmd-console-debloque-ord-a-/);

  // Confirmed again: the SAME command id, the unlock lands, in his words,
  // and the row leaves because the BOARD says so.
  const readsBefore = boardReads;
  await row.locator('button.remise-debloquer').click();
  await row.locator('button.remise-confirmer').click();
  await expect(desk.locator('.remise-fait')).toContainText('Code débloqué. Le coursier peut retaper le code.');
  await expect(desk.locator('.remise-row')).toHaveCount(0);
  await expect(desk).toContainText('Aucun code bloqué.');
  expect(unlocks).toHaveLength(2);
  expect(unlocks[1]!['command_id']).toBe(unlocks[0]!['command_id']);
  expect(boardReads).toBeGreaterThan(readsBefore);
  // The tree survived every tap.
  await expect(page.getByRole('heading', { name: 'Codes coursiers' })).toBeVisible();
});

test('a partial list says so; a board that does not answer says so; neither invents a course', async ({ page }) => {
  let mode: 'partiel' | 'panne' = 'partiel';
  await page.route(`**${BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(BASE.length);
    if (request.headers()['authorization'] !== `Bearer ${KEY}`) return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    if (path === '/ops/riders') return route.fulfill({ json: { ok: true, riders: [] } });
    if (path === '/ops/rider-codes') return route.fulfill({ json: { ok: true, codes: [] } });
    if (path === '/ops/board') {
      if (mode === 'panne') return route.fulfill({ status: 503, json: { ok: false, reason: 'unavailable' } });
      return route.fulfill({ json: boardOf([], true) });
    }
    return route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });
  await page.goto('/');
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();
  const desk = page.locator('.remise-desk');
  await expect(desk).toContainText('Aucun code bloqué.');
  await expect(desk).toContainText('Cette liste n\'est peut-être pas complète.');
  await expect(desk).toContainText('Relisez le tableau dans un instant.');
  await expect(desk.locator('button.remise-debloquer')).toHaveCount(0);

  mode = 'panne';
  await page.reload();
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();
  await expect(desk).toContainText('Le tableau n\'a pas répondu.');
  await expect(desk.locator('.remise-row')).toHaveCount(0);
});
