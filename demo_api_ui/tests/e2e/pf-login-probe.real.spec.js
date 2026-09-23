const { test } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');

test('PF login probe', async ({ page }) => {
  const base = process.env.E2E_BASE_URL || 'https://local.ping-devops.com:4000';
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text().slice(0, 160)); });
  try {
    await loginAsCustomer(page);
    console.log('LOGIN OK url:', page.url());
    await page.waitForTimeout(2000);
    const who = await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()).catch(() => null));
    console.log('session user:', JSON.stringify(who).slice(0, 200));
  } catch (e) {
    console.log('LOGIN FAIL:', e.message.slice(0, 300));
  }
});
