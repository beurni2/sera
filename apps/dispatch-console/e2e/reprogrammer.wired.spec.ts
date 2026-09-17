import { expect, test } from '@playwright/test';

/**
 * ═══ REPROGRAMMATION-1 — the next-passage desk, DRIVEN in a real browser ═══
 *
 * FOUNDER STANDING ORDER (2026-08-10): « the screen is driven, never only
 * read » — and where no harness exists yet, the first slice that touches a
 * screen builds the equivalent. This is the dispatch console's: the REAL
 * built page (a build whose logistics base is a SAME-ORIGIN path, so the
 * console's own port fetches `/sera-logistique/ops/…` and this test answers
 * as the logistics Worker would — nothing of the console is stubbed, only the
 * wire), the real key field, the real inputs, the real lever.
 *
 * The four questions, answered here: did the tree survive the tap · is the
 * primary action present AND pressable AND wired to something · does a
 * refused act leave a way out · can the founder reach the next step (the row
 * gone on the board's own re-read, the fix reported in his words).
 *
 * The WIRED WORKER half is proven where it lives:
 * `services/logistics-service/test/reprogrammation.e2e.test.ts` drives this
 * console's own port against BOTH real Workers. The answers faked here are
 * contract-certified to that door: 401 on a wrong key, 409 by name, 200 with
 * the follow-up task's id.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

const BASE = '/sera-logistique';
const KEY = 'la-cle-du-fondateur';

type Json = Record<string, unknown>;

test('the founder enters his key → the course custody sent back is listed with its reason and its rider → an incomplete window is refused before anything is sent → the door’s refusal is said on the row and the lever stays usable → the fix lands, is reported in his words, and the row leaves on the board’s own re-read', async ({ page }) => {
  const aReprogrammer: Json[] = [
    { orderId: 'ord-reprog', taskId: 'task-1', assignmentId: 'as-1', riderId: 'rider-boss', reasonCode: 'honest_absence', recordedAt: '2026-09-17T09:16:00.000Z' },
  ];
  const fixes: Json[] = [];
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
            assignments: [{ assignmentId: 'as-1', taskId: 'task-1', orderId: 'ord-reprog', riderId: 'rider-boss', status: 'acknowledged' }],
            aReprogrammer,
          },
        },
      });
    }
    if (path === '/ops/reprogrammer' && request.method() === 'POST') {
      const body = request.postDataJSON() as Json;
      fixes.push(body);
      // The first fix: the wire had not landed yet — the door refuses by name.
      if (fixes.length === 1) return route.fulfill({ status: 409, json: { ok: false, reason: 'order_not_rescheduled' } });
      // The second: the follow-up task opens; the board no longer lists the course.
      aReprogrammer.length = 0;
      return route.fulfill({ json: { ok: true, duplicate: false, taskId: 'task-2', priorTaskIds: ['task-1'], passage: 2, fenetre: body['fenetre'] } });
    }
    return route.fulfill({ status: 404, json: { ok: false, reason: 'not_found' } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Prochain passage à fixer' })).toBeVisible();
  const desk = page.locator('.reprog-desk');
  // Before the key: an honest sentence, no lever.
  await expect(desk.locator('.reprog-state')).toHaveText('Entrez la clé dans « Codes coursiers » pour voir ces courses.');
  await expect(desk.locator('button.reprog-fixer')).toHaveCount(0);

  // ONE key door for the live half of the console.
  await page.locator('.codes-key').fill(KEY);
  await page.locator('button.codes-key-open').click();

  // The course custody sent back, listed off the real board read: the order,
  // the reason in plain words, the rider by name.
  await expect(desk.locator('.reprog-row')).toHaveCount(1);
  await expect(desk.locator('.reprog-row-order')).toHaveText('ord-reprog');
  await expect(desk.locator('.reprog-row-etat')).toContainText('Client absent');
  await expect(desk.locator('.reprog-row-etat')).toContainText('colis avec Boss');
  const lever = desk.locator('button.reprog-fixer');
  await expect(lever).toHaveText('Fixer le passage');
  await expect(lever).toBeEnabled();

  // An incomplete window is refused HERE, in words, and nothing is sent.
  await lever.click();
  await expect(desk.locator('.reprog-notice')).toHaveText('Choisissez le jour et les deux heures.');
  expect(fixes).toHaveLength(0);

  // A future window, in his local time.
  const demain = new Date(Date.now() + 24 * 3_600_000);
  const jour = `${demain.getFullYear()}-${String(demain.getMonth() + 1).padStart(2, '0')}-${String(demain.getDate()).padStart(2, '0')}`;
  await desk.getByLabel('Jour').fill(jour);
  await desk.getByLabel('De').fill('10:00');
  await desk.getByLabel('À').fill('12:00');
  await lever.click();

  // The door refused by name: the sentence on the row, the lever usable again,
  // the day he typed still there — a refusal never wipes his work.
  await expect(desk.locator('.reprog-notice')).toHaveText("Séra n'a pas encore reçu l'absence. Relisez dans un instant.");
  await expect(lever).toBeEnabled();
  await expect(desk.getByLabel('Jour')).toHaveValue(jour);
  await expect(desk.getByLabel('De')).toHaveValue('10:00');
  expect(fixes).toHaveLength(1);
  const first = fixes[0]!;
  expect(first['orderId']).toBe('ord-reprog');
  expect(String(first['command_id'])).toMatch(/^cmd-console-reprog-ord-reprog-/);
  const fenetre = first['fenetre'] as Json;
  expect(Date.parse(String(fenetre['start']))).toBeLessThan(Date.parse(String(fenetre['end'])));
  expect(Date.parse(String(fenetre['end'])) - Date.parse(String(fenetre['start']))).toBe(2 * 3_600_000);

  // The second tap is a FRESH act (a new command id), and it lands: reported
  // in his words, and the row leaves because the BOARD says so.
  const readsBefore = boardReads;
  await lever.click();
  await expect(desk.locator('.reprog-fait')).toContainText("ord-reprog — C'est fixé pour");
  await expect(desk.locator('.reprog-fait')).toContainText('Le coursier le voit sur son téléphone.');
  await expect(desk.locator('.reprog-row')).toHaveCount(0);
  await expect(desk.locator('.reprog-state')).toHaveText('Aucun passage à fixer.');
  expect(fixes).toHaveLength(2);
  expect(fixes[1]!['command_id']).not.toBe(first['command_id']);
  expect(boardReads).toBeGreaterThan(readsBefore);
  // The tree survived every tap: the codes desk beside it is still whole.
  await expect(page.getByRole('heading', { name: 'Codes coursiers' })).toBeVisible();
});

test('a refused key escalates the whole desk to the one door sentence — no list, no lever', async ({ page }) => {
  await page.route(`**${BASE}/**`, (route) => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
  await page.goto('/');
  await page.locator('.codes-key').fill('pas-la-bonne');
  await page.locator('button.codes-key-open').click();
  const desk = page.locator('.reprog-desk');
  await expect(desk.locator('.reprog-state')).toHaveText('Cette clé ne fonctionne pas.');
  await expect(desk.locator('button.reprog-fixer')).toHaveCount(0);
});
