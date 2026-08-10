import { expect, test } from '@playwright/test';
import { seraTheme as theme } from '@platform/ui-tokens/legacy';

// DoD: "rider shell + console shell boot with ui-tokens theme sera".
// This drives the real built console in a real Chromium.

function hexToRgb(hex: string): string {
  const n = hex.replace('#', '');
  return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
}

test('the console shell boots on the sera theme with catalog strings', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Séra — Console');

  const brand = page.locator('h1');
  await expect(brand).toHaveText('Séra');
  // Grand Teint: the brand is ink; the amber accent is spent on the theme strip.
  await expect(brand).toHaveCSS('color', hexToRgb(theme.colours.ink));

  await expect(page.locator('body')).toHaveCSS('background-color', hexToRgb(theme.colours.sand));
  // WO-6.9-e: five sections — the ready queue, the LIVE BOARD (D3), the
  // EXCEPTIONS DESK (D4), the BREAK-GLASS honest shell (D5), the follow-up.
  // SE-LIVE-4e adds a SIXTH: « Codes coursiers », the founder mints the code a
  // rider types to enter Séra. PURGE-ESSAI adds a SEVENTH: « Courses du
  // tableau », the real board he retires his test courses from — the two LIVE
  // sections, together at the bottom. The count is pinned deliberately so a
  // section cannot appear or vanish unnoticed, so it is raised here on purpose
  // rather than loosened.
  await expect(page.locator('h2')).toHaveCount(7);
  await expect(page.locator('h2').first()).toHaveText('Prêt à assigner');
  await expect(page.locator('h2').nth(1)).toHaveText('Tableau en direct');
  await expect(page.locator('h2').nth(2)).toHaveText('Bureau des exceptions');
  await expect(page.locator('h2').nth(3)).toHaveText('Remise exceptionnelle');
  await expect(page.locator('h2').nth(4)).toHaveText('Suivi des colis');
  await expect(page.locator('h2').nth(5)).toHaveText('Courses du tableau');
  await expect(page.locator('h2').nth(6)).toHaveText('Codes coursiers');
  await expect(page.getByText('Temps de contrôle au ramassage : 165 s — Dans la cible')).toBeVisible();
  await expect(page.getByText('12:18 · Retour au vendeur · Argent pas prêt')).toBeVisible();
  // D7 staffed-hours default — copy only.
  await expect(page.locator('.hours-note')).toHaveText('Service en journée.');
});

test('WO-2.7 item 2 (NB⑤): the door line is SIGNAL-DRIVEN — honest pending BEFORE the signal, « Confirmé par le réseau » only AFTER it', async ({ page }) => {
  await page.goto('/');

  // BEFORE any signal: the honest pending state — nothing claims the network
  // confirmed what it has not.
  await expect(page.locator('.door-line')).toHaveText('Paiement au seuil : En attente du réseau');
  await expect(page.getByText('Confirmé par le réseau')).toHaveCount(0);

  // The sandbox « Essai » path feeds the follower a REAL provider-class
  // signal (strict-parsed, provenance-checked, deduped) — only then does the
  // confirmed state render.
  await page.locator('button.door-demo').click();
  await expect(page.locator('.door-line')).toHaveText('Paiement au seuil : Confirmé par le réseau');
  await expect(page.locator('button.door-demo')).toBeHidden();
});

test('WO-1.2 manual assignment: landmark-first task card → « Donner la course » → honest waiting state', async ({ page }) => {
  await page.goto('/');

  // SE0.3: landmark-first display order — landmark, then directions, then zone.
  const lines = page.locator('.location-line');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveText('Face à la pharmacie du marché');
  await expect(lines.nth(1)).toHaveText('Deuxième porte bleue après le kiosque');
  await expect(lines.nth(2)).toHaveText('Gounghin');

  // §2.3 step 10: the dispatcher assigns ONE task to ONE rider, manually.
  await page.locator('select').selectOption('rider-issa');
  await page.locator('button.assign').click();

  // The task leaves the queue; the console shows the honest waiting state —
  // acknowledged is a RIDER action, never implied by assignment itself.
  await expect(page.locator('#queue-body .status-line')).toHaveText("En attente de l'accord du livreur.");
  await expect(page.locator('.task-card')).toHaveCount(0);
});

test('WO-4.3 lease: the PROPOSED assignment states its deadline — « Course proposée — répondez avant HH:MM » from the lease expiresAt', async ({ page }) => {
  await page.goto('/');
  await page.locator('select').selectOption('rider-issa');
  await page.locator('button.assign').click();

  // The waiting line stays (never implies the rider's accord)…
  await expect(page.locator('#queue-body .status-line')).toHaveText("En attente de l'accord du livreur.");
  // …and the trust line says what happens next, on the LEASE's own clock.
  await expect(page.locator('#queue-body .deadline-line')).toHaveText(
    /^Course proposée — répondez avant \d{2}:\d{2}$/,
  );
  await expect(page.locator('.task-card')).toHaveCount(0);
});

test('WO-6.1 (ruling ⑤) the « done » lever marks the proposed course delivered — releaseOnCompletion, honest state', async ({ page }) => {
  await page.goto('/');
  await page.locator('select').selectOption('rider-issa');
  await page.locator('button.assign').click();

  // the waiting state carries the « done » lever
  await expect(page.locator('#queue-body .status-line')).toHaveText("En attente de l'accord du livreur.");
  const done = page.locator('button.done');
  await expect(done).toHaveText('Marquer la course remise');

  // the lever exercises the service's releaseOnCompletion → honest completed state
  await done.click();
  await expect(page.locator('#queue-body .status-line')).toHaveText('Course remise. Le bail est libéré.');
  await expect(page.locator('button.done')).toHaveCount(0);
});

test('WO-4.3 lease expiry: past the 5-min window the honest expired state shows and the task is BACK in the queue', async ({ page }) => {
  // The mocked clock must exist before the page arms its sweep interval.
  await page.clock.install();
  await page.goto('/');
  await page.locator('select').selectOption('rider-issa');
  await page.locator('button.assign').click();
  await expect(page.locator('.task-card')).toHaveCount(0);

  // No answer within the lease window: ONE sweep expires the lease at THE
  // authority and returns the assignment to the queue (assignment.expired.v1).
  await page.clock.fastForward('06:00');
  await expect(page.locator('#queue-body .status-line')).toHaveText(
    'Temps passé sans réponse. La course revient dans la file.',
  );
  await expect(page.locator('.task-card')).toHaveCount(1);
  await expect(page.locator('#queue-body .deadline-line')).toHaveCount(0); // no stale deadline claim
});

test('WO-6.3 SOS: a raised incident lands at the TOP, states custody + coarse location, and the dispatcher acknowledges', async ({ page }) => {
  await page.goto('/');

  // No incident by default — the console never fakes an alarm.
  await expect(page.locator('.sos-alert')).toBeHidden();

  // Raise the sandbox incident (« (aperçu) ») — the alert appears at the TOP,
  // ahead of the ready-queue heading.
  await page.locator('button.sos-raise').click();
  const alert = page.locator('.sos-alert');
  await expect(alert).toBeVisible();
  // it is the FIRST element inside main, ahead of every queue item
  await expect(page.locator('main > *').first()).toHaveClass(/sos-alert/);
  await expect(alert.locator('.sos-title')).toHaveText('SOS — un livreur a besoin d\'aide');
  // coarse location present (the rider is on shift) — never a fabricated fix
  await expect(alert.getByText(/Localisation : /)).toBeVisible();
  // custody stays legible: the rider still holds the package (not orphaned)
  await expect(alert.locator('.sos-custody')).toHaveText(
    'Le colis reste avec le livreur. La garde ne bouge pas.',
  );

  // the dispatcher acknowledges — the incident shows acknowledged, ack lever gone
  await page.locator('button.sos-ack').click();
  await expect(alert.locator('.sos-ackd')).toHaveText('Vu. Réponse en cours.');
  await expect(page.locator('button.sos-ack')).toHaveCount(0);
});

test('WO-6.3 SOS: a queued (offline) incident shows « En attente du réseau » and the ack lever is DISABLED', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.sos-raise-queued').click();

  const alert = page.locator('.sos-alert');
  await expect(alert).toBeVisible();
  await expect(alert).toHaveClass(/queued/);
  await expect(alert.getByText('En attente du réseau.')).toBeVisible();
  // you cannot acknowledge what has not arrived — the lever is present BUT disabled
  const ack = page.locator('button.sos-ack');
  await expect(ack).toBeDisabled();
  await expect(alert.getByText('On ne répond pas à un SOS qui n\'est pas encore arrivé.')).toBeVisible();
});
