import { expect, test } from '@playwright/test';

/**
 * SE-LIVE-4e — the rider code desk, in a real browser.
 *
 * ⚠ WHAT THIS COVERS AND WHAT IT DOES NOT, stated rather than implied. The
 * preview server serves a build made with no `VITE_SERA_LOGISTICS_BASE`, so
 * what a browser can prove here is the NOT-CONFIGURED path — which is exactly
 * what the founder sees if he starts the console without the base, and the
 * state most likely to be got wrong (an empty desk reading as « no riders »).
 *
 * The WIRED path is proven where it actually lives:
 *   · `services/logistics-service/test/rider-codes.e2e.test.ts` drives this
 *     console's own port against the REAL Worker in miniflare — register,
 *     list, mint, revoke, bad key — and checks the minted code opens the
 *     rider door.
 *   · `test/rider-codes.test.ts` covers every decision the screen makes.
 */

test('the rider code desk says it is not connected, instead of showing an empty roster', async ({ page }) => {
  await page.goto('/');

  const heading = page.getByRole('heading', { name: 'Codes coursiers' });
  await expect(heading).toBeVisible();

  const desk = page.locator('.codes-desk');
  await expect(desk).toBeVisible();
  // The honest state. « Aucun coursier » here would be a lie — the console has
  // not asked anybody.
  await expect(desk.locator('.codes-state')).toHaveText('Cette console n\'est pas reliée à Séra.');
  await expect(desk.locator('.codes-hint')).toContainText('adresse du service');

  // And it offers no act it cannot perform: no key field, no mint, no revoke.
  await expect(desk.locator('.codes-key')).toHaveCount(0);
  await expect(desk.locator('.codes-give')).toHaveCount(0);
  await expect(desk.locator('.codes-register')).toHaveCount(0);
});

test('the desk is the LAST section — dispatch keeps the top of the screen', async ({ page }) => {
  await page.goto('/');
  /**
   * A dispatcher's screen is ordered by urgency. Minting a code is
   * administration: it must never push live work down the page.
   *
   * The SOS alert is NOT the anchor here — it is `hidden` until an incident is
   * raised, because an always-on alert is a fake alarm, so it has no box to
   * measure. The anchor is the first real section heading, which is always
   * present.
   */
  const headings = page.locator('h2');
  const count = await headings.count();
  await expect(headings.nth(count - 1)).toHaveText('Codes coursiers');

  const first = await headings.first().boundingBox();
  const desk = await page.locator('.codes-desk').boundingBox();
  expect(first).not.toBeNull();
  expect(desk).not.toBeNull();
  expect(desk?.y ?? 0).toBeGreaterThan(first?.y ?? 0);
});
