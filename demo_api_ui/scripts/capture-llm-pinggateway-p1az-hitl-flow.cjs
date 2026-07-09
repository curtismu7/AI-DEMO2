#!/usr/bin/env node
/**
 * Capture screenshots for docs/use-cases/llm-pinggateway-p1az-hitl-flow-test.md
 * Run: cd demo_api_ui && node scripts/capture-llm-pinggateway-p1az-hitl-flow.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/screenshots/llm-pinggateway-p1az-hitl-flow');
const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:4000';

fs.mkdirSync(OUT, { recursive: true });

const HITL_TOKEN_EVENTS = [
  { id: 'user-token', label: 'User OIDC access token (session)', status: 'complete', claims: { sub: 'user-123' } },
  { id: 'exchanged-token', label: 'RFC 8693 delegated token (aud=mcp-gateway)', status: 'complete', exchangeMethod: 'with-actor', claims: { aud: 'mcp-gateway', act: { sub: 'agent-client-id' } } },
  { id: 'mcp-gateway-route', label: 'Ping Agent Gateway — introspect + route', status: 'complete', routedVia: 'gateway' },
  { id: 'gw-authorize', label: 'PingOne Authorize (P1AZ) — INDETERMINATE', status: 'complete', authorizeDecision: 'INDETERMINATE', authorizeEngine: 'pingone', decision: 'INDETERMINATE' },
  { id: 'gw-hitl-challenge-type', label: 'Gateway HITL — consent_required', status: 'complete', challengeType: 'consent_required' },
];

const CUSTOMER_USER = { id: 'user-123', username: 'demo-customer', email: 'customer@bank.com', firstName: 'Demo', lastName: 'Customer', name: 'Demo Customer', role: 'customer' };

const ACCOUNTS = {
  accounts: [
    { id: 'acc_001', accountType: 'checking', account_type: 'checking', balance: 1500, name: 'Checking' },
    { id: 'acc_002', accountType: 'savings', account_type: 'savings', balance: 8200.5, name: 'Savings' },
  ],
};

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function mockCustomerHitl(page) {
  const ok = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/oauth/user/status', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/auth/oauth/status', (r) => r.fulfill(ok({ authenticated: false, user: null })));
  await page.route('**/api/auth/session**', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/tokens/session-preview**', (r) => r.fulfill(ok({ tokenEvents: HITL_TOKEN_EVENTS })));
  await page.route('**/api/token-chain**', (r) => r.fulfill(ok({ tokenEvents: HITL_TOKEN_EVENTS })));
  await page.route('**/api/admin/feature-flags**', (r) => r.fulfill(ok({
    flags: [
      { id: 'ff_show_agent_in_middle', value: true },
      { id: 'ff_hitl_enabled', value: true },
      { id: 'ff_mcp_gateway_pinggateway', value: true },
    ],
  })));
  await page.route('**/api/admin/config**', (r) => r.fulfill(ok({ config: {} })));
  await page.route('**/api/config/vertical**', (r) => r.fulfill(ok({ manifest: null })));
  await page.route('**/api/verticals/**', (r) => r.fulfill(ok({ id: 'banking' })));
  await page.route('**/api/accounts/my**', (r) => r.fulfill(ok(ACCOUNTS)));
  await page.route('**/api/accounts**', (r) => r.fulfill(ok(ACCOUNTS)));
  await page.route('**/api/transactions**', (r) => r.fulfill(ok({ transactions: [] })));
  await page.route('**/api/admin/app-events**', (r) => r.fulfill(ok({ ok: true })));
  await page.route('**/api/demo-agent/tools**', (r) => r.fulfill(ok({
    availableTools: [{ name: 'create_transfer', permitted: true }, { name: 'get_my_accounts', permitted: true }],
    vertical: 'banking',
  })));
  await page.route('**/api/demo-agent/nl**', (r) => r.fulfill(ok({
    result: {
      kind: 'banking',
      banking: { action: 'transfer', params: { fromId: 'checking', toId: 'savings', amount: 500 } },
    },
    source: 'heuristic',
  })));
  await page.route('**/api/mcp-gateway/**', (r) => r.fulfill(ok({
    usePingGateway: true,
    name: 'PingOne Agent Gateway',
    authzBackend: 'Real PingOne Authorize',
  })));
  await page.route('**/api/mcp/inspector/tools**', (r) => r.fulfill(ok({
    tools: [{ name: 'create_transfer', description: 'Transfer between accounts' }],
  })));
  await page.route('**/api/authorize/rules**', (r) => r.fulfill(ok({ rules: [] })));
  await page.route('**/api/health/**', (r) => r.fulfill(ok({ status: 'ok' })));
  await page.route('**/api/mcp/tool**', async (route) => {
    const req = route.request();
    let tool = '';
    try {
      tool = req.postDataJSON()?.tool || '';
    } catch { /* ignore */ }
    if (tool === 'create_transfer') {
      await route.fulfill({
        status: 428,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'hitl_required',
          message: 'This transfer requires your approval before the agent can proceed.',
          amount: 500,
          fromAccountId: 'acc_001',
          toAccountId: 'acc_002',
          type: 'transfer',
          hitl_threshold_usd: 250,
          hitl: { type: 'consent', challengeId: 'hitl-challenge-demo-001' },
          tokenEvents: HITL_TOKEN_EVENTS,
        }),
      });
      return;
    }
    await route.fulfill(ok({
      result: { content: [{ type: 'text', text: JSON.stringify(ACCOUNTS, null, 2) }] },
      gwAuditTrail: { decision: 'PERMIT', engine: 'pingone', tool: tool || 'get_my_accounts' },
    }));
  });
  await page.route('**/ws**', (r) => r.abort());
  await page.route('**/api/mcp/flow/**', (r) => r.abort());
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP api.ping.demo 127.0.0.1'] });
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })).newPage();

  await page.goto(`${BASE}/architecture/token-flow.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, '01-architecture-token-flow');

  await mockCustomerHitl(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  await shot(page, '02-agent-dashboard');

  const prompt = 'transfer $500 from checking to savings';
  await page.locator('input.ba-input').fill(prompt);
  await shot(page, '03-transfer-prompt');

  await page.locator('input.ba-input').press('Enter');
  await page.locator('.acm-hitl-badge').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, '04-hitl-consent-modal');

  const chainBtn = page.locator('button').filter({ hasText: /Token Chain/i }).first();
  if (await chainBtn.isVisible().catch(() => false)) {
    await page.evaluate(() => document.querySelectorAll('.lo-backdrop').forEach((el) => el.remove()));
    await chainBtn.click({ force: true });
    await page.waitForTimeout(1500);
    await shot(page, '06-token-chain-hitl');
  }

  await page.locator('.acm-agree-cb').check();
  await page.waitForTimeout(400);
  await shot(page, '05-hitl-consent-checked');

  await browser.close();
  console.log('Capture complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
