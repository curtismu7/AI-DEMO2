const { test, expect } = require('@playwright/test');

test('Academy preview fits the declared 320px minimum viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/academy-preview.html');

  await expect(page.getByRole('button', { name: /dark mode/i })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});
