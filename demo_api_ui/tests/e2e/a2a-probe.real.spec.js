const { test } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');
test('probe UC2 a2a', async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await loginAsCustomer(page);
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/agent/invoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ prompt: "show my sensitive passenger record", vertical: "airlines", useCaseId: "a2a-delegation", forceHeuristic: true }),
    });
    const b = await res.json();
    return { status: res.status, error: b.error, code: b.code, reply: (b.reply||'').slice(0,150),
      events: (b.tokenEvents||[]).map(e=>(e.id||'?')+':'+(e.status||'?')+':'+((e.explanation||'')+(e.error?' ERR='+JSON.stringify(e.error):'')).slice(0,160)) };
  });
  console.log('PROBE', JSON.stringify(r, null, 1));
  await ctx.close();
});
