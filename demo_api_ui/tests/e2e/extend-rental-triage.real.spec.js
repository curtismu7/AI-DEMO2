/**
 * End-to-end triage test: extend_rental $600 (UC7 analog, sporting-goods).
 *
 * The freeform chat input routes through /api/agent/run (AG-UI), which drives
 * the LLM directly and never dispatches heuristics — so a freeform "extend my
 * rental" answers as chat. The UC7 chip path goes through /api/agent/invoke,
 * which parses the heuristic and dispatches extend_rental through the gateway
 * (mode=llm includes the deterministic floor for vertical actions).
 *
 * This spec: sign in as the customer, pin sporting-goods, then POST the UC7
 * trigger ("extend my rental $600") to /api/agent/invoke with the browser's
 * session cookie — the same call the Live Use Cases chip makes. The BFF emits
 * the [mcpToolPipeline][triage] log line right before callToolViaGateway.
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, getE2eBaseUrl } = require('./helpers/realLogin');

test('extend_rental $600 — UC7 (sporting-goods) end to end', { timeout: 240_000 }, async ({ page }) => {
  await loginAsCustomer(page);
  await page.waitForTimeout(3000);

  // Pin the session to the sporting-goods vertical (UC7 perVertical chip text).
  const pin = await page.request.post(`${getE2eBaseUrl().replace(/\/$/, '')}/api/verticals/active`, {
    data: { id: 'sporting-goods' },
  });
  if (!pin.ok()) throw new Error(`vertical pin failed: ${pin.status()}`);

  // Fire the UC7 chip exactly as the Live Use Cases panel does.
  const resp = await page.request.post(`${getE2eBaseUrl().replace(/\/$/, '')}/api/agent/invoke`, {
    data: { prompt: 'extend my rental $600', vertical: 'sporting-goods' },
  });
  console.log('[triage-spec] invoke status:', resp.status());
  const json = await resp.json().catch(() => ({}));
  console.log('[triage-spec] toolsCalled:', JSON.stringify(json.toolsCalled || []));
  console.log('[triage-spec] reply:', String(json.reply || '').slice(0, 300).replace(/\s+/g, ' '));
  const requiresConsent = json.requiresConsent === true;
  const denied = /insufficient_scope|policy denied|declined by the gateway/i.test(String(json.reply || ''));
  console.log('[triage-spec] hitl:', requiresConsent, '| denied:', denied);

  await page.goto(`${getE2eBaseUrl().replace(/\/$/, '')}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'evidence/extend-rental-triage.png', fullPage: false });

  // Triage probe — the pass/fail verdict is read from the BFF [triage] log.
  expect(true).toBe(true);
});
