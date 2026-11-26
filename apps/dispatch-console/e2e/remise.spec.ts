import { expect, test } from '@playwright/test';

/**
 * « Codes de la cliente bloqués », in a real browser, NOT connected.
 *
 * The preview server serves a build made with no `VITE_SERA_LOGISTICS_BASE`,
 * so what a browser proves here is the not-connected state: the desk says so
 * in his words and offers no lever it cannot honour. The wired path lives in
 * `e2e/remise.wired.spec.ts` and, against both real Workers, in
 * `services/logistics-service/test/code-bloque.e2e.test.ts`.
 *
 * ⚠ BOUND: nothing here claims anything about appearance.
 */

test('the locked-codes desk says it is not connected, and offers no button', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Codes de la cliente bloqués' })).toBeVisible();

  const desk = page.locator('.remise-desk');
  await expect(desk).toBeVisible();
  // « Aucun code bloqué » here would be a lie: the console has asked nothing.
  await expect(desk.locator('.remise-state')).toHaveText("Cette console n'est pas reliée à Séra.");
  await expect(desk.locator('.remise-hint')).toContainText('adresse du service');
  await expect(desk.locator('button')).toHaveCount(0);
});
