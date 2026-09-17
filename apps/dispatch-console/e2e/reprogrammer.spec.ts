import { expect, test } from '@playwright/test';

/**
 * REPROGRAMMATION-1 — « Prochain passage à fixer », in a real browser, on the
 * build made with no `VITE_SERA_LOGISTICS_BASE`: the NOT-CONFIGURED path says
 * so and offers no lever it cannot honour. The WIRED desk is driven in
 * `reprogrammer.wired.spec.ts` (the `chromium-wired` project) and its Worker
 * half in `services/logistics-service/test/reprogrammation.e2e.test.ts`.
 */

test('the next-passage desk says it is not connected, and offers nothing it cannot do', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Prochain passage à fixer' })).toBeVisible();
  const desk = page.locator('.reprog-desk');
  await expect(desk).toBeVisible();
  await expect(desk.locator('.reprog-state')).toHaveText("Cette console n'est pas reliée à Séra.");
  await expect(desk.locator('.reprog-hint')).toContainText('adresse du service');
  await expect(desk.locator('button.reprog-fixer')).toHaveCount(0);
  await expect(desk.locator('input')).toHaveCount(0);
});

test('live work sits above administration: the next-passage desk comes before the courses desk and the codes desk', async ({ page }) => {
  await page.goto('/');
  const reprog = await page.locator('.reprog-desk').boundingBox();
  const courses = await page.locator('.courses-desk').boundingBox();
  const codes = await page.locator('.codes-desk').boundingBox();
  expect(reprog).not.toBeNull();
  expect(courses).not.toBeNull();
  expect(codes).not.toBeNull();
  expect(reprog?.y ?? 0).toBeLessThan(courses?.y ?? 0);
  expect(courses?.y ?? 0).toBeLessThan(codes?.y ?? 0);
});
