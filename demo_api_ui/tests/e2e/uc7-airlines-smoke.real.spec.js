/** UC7 on the new default vertical: pay a $600 change fee → pay_airline_fee → P1AZ step-up. */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, getE2eBaseUrl } = require('./helpers/realLogin');

test('UC7 $600 change fee on United (default vertical) end to end', { timeout: 240_000 }, async ({ page }) => {
  await loginAsCustomer(page);
  await page.waitForTimeout(2000);
  const resp = await page.request.post(`${getE2eBaseUrl().replace(/\/$/, '')}/api/agent/invoke`, {
    data: { prompt: 'pay a $600 change fee', vertical: 'airlines' },
  });
  const json = await resp.json().catch(() => ({}));
  console.log('[uc7-ua] status:', resp.status(), '| toolsCalled:', JSON.stringify(json.toolsCalled || []));
  console.log('[uc7-ua] reply:', String(json.reply || '').slice(0, 200).replace(/\s+/g, ' '));
  await page.screenshot({ path: 'evidence/uc7-airlines-smoke.png' });
  expect(json.toolsCalled).toContain('pay_airline_fee');
});
