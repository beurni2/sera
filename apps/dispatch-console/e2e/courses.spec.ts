import { expect, test } from '@playwright/test';

/**
 * PURGE-ESSAI — « Courses du tableau », in a real browser.
 *
 * WHAT THIS COVERS AND WHAT IT DOES NOT, stated rather than implied. The
 * preview server serves a build made with no `VITE_SERA_LOGISTICS_BASE`, so
 * what a browser can prove here is the NOT-CONFIGURED path — and, crucially,
 * that a DESTRUCTIVE desk offers no lever it cannot honour: no « Retirer », no
 * « Tout retirer », nothing that could remove a course the console has not
 * even asked the board about.
 *
 * The WIRED path is proven where it actually lives:
 *   · `services/logistics-service/test/retirer.e2e.test.ts` drives THIS
 *     console's own port against the REAL Worker in miniflare — compose,
 *     assign, accept, retire — and asks the BOARD and the reads for the
 *     outcome instead of believing the response.
 *   · `test/courses.test.ts` covers every decision the screen makes.
 */

test('the courses desk says it is not connected, and offers no removal it cannot perform', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Courses du tableau' })).toBeVisible();

  const desk = page.locator('.courses-desk');
  await expect(desk).toBeVisible();
  // The honest state. « Aucune course » here would be a lie — the console has
  // not asked the board anything.
  await expect(desk.locator('.courses-state')).toHaveText("Cette console n'est pas reliée à Séra.");
  await expect(desk.locator('.courses-hint')).toContainText('adresse du service');

  // NO DESTRUCTIVE LEVER EXISTS IN A STATE THAT CANNOT ACT.
  await expect(desk.locator('button.courses-retirer')).toHaveCount(0);
  await expect(desk.locator('button.courses-tout')).toHaveCount(0);
  await expect(desk.locator('button.courses-confirmer')).toHaveCount(0);
});

test('retiring is never the primary action: no filled ink lever, and dispatch keeps the top of the screen', async ({ page }) => {
  await page.goto('/');

  // The console's primary levers are the filled ink buttons (« Donner la
  // course »). The courses desk carries none of them — its grammar whispers.
  const desk = page.locator('.courses-desk');
  await expect(desk.locator('button.assign')).toHaveCount(0);
  await expect(desk.locator('button.done')).toHaveCount(0);

  // Administration sits under live work: the desk is below the first heading,
  // and the codes desk still closes the page (its own spec pins that).
  const first = await page.locator('h2').first().boundingBox();
  const box = await desk.boundingBox();
  expect(first).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box?.y ?? 0).toBeGreaterThan(first?.y ?? 0);
});
