// Throwaway visual check: open Mission Control after the P1AZ button removal.
const { test, expect } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');
const { settle, requireVertical } = require('./helpers/uiProbe');

test('mission control drawer renders without the live P1AZ button', async ({ page }) => {
  await loginAsCustomer(page);
  await requireVertical(page, 'banking');
  await settle(page);

  const trigger = page.getByTestId('demo-steps-trigger');
  await trigger.click();
  await expect(page.getByTestId('demo-steps-popout')).toBeVisible();

  await expect(page.getByTestId('demo-live-p1az')).toHaveCount(0);
  await expect(page.getByTestId('demo-steps-clear')).toBeVisible();
  await expect(page.getByTestId('demo-steps-stop-agent')).toBeVisible();

  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/mission-control-after.png' });
});
