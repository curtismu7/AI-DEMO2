/** Fresh session default vertical = United (airlines). */
const { test, expect } = require('@playwright/test');
const { getE2eBaseUrl } = require('./helpers/realLogin');

test('fresh session defaults to United Airlines vertical', async ({ page }) => {
  await page.goto(getE2eBaseUrl(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const active = await page.request.get(`${getE2eBaseUrl().replace(/\/$/, '')}/api/verticals/active`);
  const body = await active.json();
  console.log('[airlines-default] active:', body.id);
  expect(body.id).toBe('airlines');
});
