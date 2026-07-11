'use strict';
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

test('code explorer: search + ask return real results', async ({ browser }) => {
  test.skip(!requireRealLoginEnv(), 'needs creds');
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await loginAsCustomer(page);
  await page.close();

  const st = await ctx.request.get('/api/code-search/default-status');
  console.log('default-status:', (await st.text()).slice(0, 200));

  const cb = await ctx.request.get('/api/code-search/codebases');
  const cbBody = await cb.json().catch(() => ({}));
  console.log('codebases:', JSON.stringify(cbBody).slice(0, 300));

  const search = await ctx.request.post('/api/code-search/search', {
    data: { query: 'find authentication logic', codebase_id: 'ai-demo2-default' }, timeout: 60_000,
  });
  console.log('search status:', search.status());
  const sBody = await search.json().catch(() => ({}));
  console.log('search sample:', JSON.stringify(sBody).slice(0, 400));
  expect(search.status(), 'search returns 200').toBe(200);

  const ask = await ctx.request.post('/api/code-search/ask', {
    data: { question: 'Summarize the architecture', codebase_id: 'ai-demo2-default' }, timeout: 180_000,
  });
  console.log('ask status:', ask.status());
  const aBody = await ask.json().catch(() => ({}));
  console.log('ask answer:', JSON.stringify(String(aBody.answer || '')).slice(0, 400));
  expect(ask.status(), 'ask returns 200').toBe(200);
  expect(String(aBody.answer || '').trim().length, 'ask answer is substantive').toBeGreaterThan(50);
  expect(Array.isArray(aBody.sources) && aBody.sources.length > 0, 'ask has sources').toBe(true);
  await ctx.close();
});
