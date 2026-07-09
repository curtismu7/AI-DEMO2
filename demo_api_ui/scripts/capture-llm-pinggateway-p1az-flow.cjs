#!/usr/bin/env node
/**
 * Capture screenshots for docs/use-cases/llm-pinggateway-p1az-flow-test.md
 * Run: cd demo_api_ui && node scripts/capture-llm-pinggateway-p1az-flow.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/screenshots/llm-pinggateway-p1az-flow');
const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:4000';

fs.mkdirSync(OUT, { recursive: true });

const SAMPLE_TOKEN_EVENTS = [
  { id: 'user-token', label: 'User OIDC access token (session)', status: 'complete', claims: { sub: 'user-123' } },
  { id: 'exchanged-token', label: 'RFC 8693 delegated token (aud=mcp-gateway)', status: 'complete', exchangeMethod: 'with-actor', claims: { aud: 'mcp-gateway', act: { sub: 'agent-client-id' } } },
  { id: 'mcp-gateway-route', label: 'Ping Agent Gateway — introspect + route', status: 'complete', routedVia: 'gateway' },
  { id: 'gw-authorize', label: 'PingOne Authorize (P1AZ) — PERMIT', status: 'complete', authorizeDecision: 'PERMIT', authorizeEngine: 'pingone', decision: 'PERMIT' },
  { id: 'mcp-tool-result', label: 'MCP tool result — get_my_accounts', status: 'complete' },
];

const CUSTOMER_USER = { id: 'user-123', username: 'demo-customer', email: 'customer@bank.com', firstName: 'Demo', lastName: 'Customer', name: 'Demo Customer', role: 'customer' };

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function mockCustomer(page) {
  const ok = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/oauth/user/status', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/auth/oauth/status', (r) => r.fulfill(ok({ authenticated: false, user: null })));
  await page.route('**/api/auth/session**', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/tokens/session-preview**', (r) => r.fulfill(ok({ tokenEvents: SAMPLE_TOKEN_EVENTS })));
  await page.route('**/api/token-chain**', (r) => r.fulfill(ok({ tokenEvents: SAMPLE_TOKEN_EVENTS })));
  await page.route('**/api/admin/feature-flags**', (r) => r.fulfill(ok({ flags: [{ id: 'ff_show_agent_in_middle', value: true }] })));
  await page.route('**/api/admin/config**', (r) => r.fulfill(ok({ config: {} })));
  await page.route('**/api/config/vertical**', (r) => r.fulfill(ok({ manifest: null })));
  await page.route('**/api/verticals/**', (r) => r.fulfill(ok({ id: 'banking' })));
  await page.route('**/api/accounts**', (r) => r.fulfill(ok({ accounts: [{ id: 'acc_001', account_type: 'checking', balance: 1500 }] })));
  await page.route('**/api/transactions**', (r) => r.fulfill(ok({ transactions: [] })));
  await page.route('**/api/admin/app-events**', (r) => r.fulfill(ok({ ok: true })));
  await page.route('**/api/pingone-test/config**', (r) => r.fulfill(ok({})));
  await page.route('**/api/demo-agent/**', (r) => r.fulfill(ok({
    source: 'helix',
    message: 'Here are your accounts: checking $1,500 and savings $8,200.50.',
    tool: 'get_my_accounts',
    executed: true,
  })));
  await page.route('**/api/mcp-gateway/**', (r) => r.fulfill(ok({
    usePingGateway: true,
    name: 'PingOne Agent Gateway',
    authzBackend: 'Real PingOne Authorize',
  })));
  await page.route('**/api/mcp/inspector/tools**', (r) => r.fulfill(ok({
    tools: [{ name: 'get_my_accounts', description: 'List accounts' }],
  })));
  await page.route('**/api/authorize/rules**', (r) => r.fulfill(ok({ rules: [] })));
  await page.route('**/api/health/**', (r) => r.fulfill(ok({ status: 'ok' })));
  await page.route('**/api/mcp/tool', (r) => r.fulfill(ok({
    result: { content: [{ type: 'text', text: JSON.stringify({ accounts: [{ id: 'acc_001', account_type: 'checking', balance: 1500 }] }, null, 2) }] },
    gwAuditTrail: { decision: 'PERMIT', engine: 'pingone', tool: 'get_my_accounts' },
  })));
  await page.route('**/ws**', (r) => r.abort());
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP api.ping.demo 127.0.0.1'] });
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })).newPage();

  await page.goto(`${BASE}/architecture/token-flow.html`, { waitUntil: 'networkidle' });
  await shot(page, '01-architecture-token-flow');

  await page.goto(`${BASE}/pinggateway-test.html`, { waitUntil: 'networkidle' });
  await shot(page, '02-token-lab');

  await mockCustomer(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  await shot(page, '03-agent-dashboard');

  await page.locator('input.ba-input').fill('Show my accounts');
  await shot(page, '04-agent-prompt');

  await page.locator('input.ba-input').press('Enter');
  await page.waitForTimeout(4000);
  await shot(page, '05-agent-response');

  const chainBtn = page.locator('button').filter({ hasText: /Token Chain/i }).first();
  if (await chainBtn.isVisible().catch(() => false)) {
    await chainBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, '06-token-chain');
  }

  await page.goto(`${BASE}/setup?tab=mcp-gateway&subtab=tester`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '07-gateway-tester');

  await browser.close();
  console.log('Capture complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
