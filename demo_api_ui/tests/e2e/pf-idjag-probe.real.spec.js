const { test } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');

test('PF id-jag probe', async ({ page }) => {
  const base = process.env.E2E_BASE_URL || 'https://local.ping-devops.com:4000';
  await loginAsCustomer(page);
  await page.waitForTimeout(1500);
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/demo-agent/tools', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ tool: 'get_my_accounts', arguments: {} }) });
    return { status: r.status, body: (await r.text()).slice(0, 400) };
  });
  console.log('TOOLS RESULT:', JSON.stringify(res));
});
