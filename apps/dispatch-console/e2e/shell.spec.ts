import { expect, test } from '@playwright/test';
import { seraTheme as theme } from '@platform/ui-tokens';

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
  await expect(brand).toHaveCSS('color', hexToRgb(theme.colors.primary));

  await expect(page.locator('body')).toHaveCSS('background-color', hexToRgb(theme.colors.surface));
  await expect(page.locator('h2')).toHaveText('Prêt à assigner');
  await expect(page.locator('.empty-state')).toHaveText('Aucune course à assigner pour le moment.');
});
