#!/usr/bin/env node
/**
 * Capture screenshots for docs/use-cases/llm-pinggateway-p1az-mortgage-flow-test.md
 * Run: cd demo_api_ui && node scripts/capture-llm-pinggateway-p1az-mortgage-flow.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/screenshots/llm-pinggateway-p1az-mortgage-flow');
const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:4000';

fs.mkdirSync(OUT, { recursive: true });

const MORTGAGE_PAYLOAD = {
  mortgage: {
    propertyAddress: '1234 Maple Street, Springfield, IL 62704',
    term: '30-year fixed',
    originationDate: '2019-06-15',
    interestRate: 3.875,
    loanAmount: 425000,
    currentBalance: 387542.18,
    monthlyPayment: 1998.42,
    nextPaymentDate: '2026-08-01',
    currency: 'USD',
  },
  source: 'banking_api_resource_server',
  authMechanism: 'X-API-Key (shared secret)',
  note: 'Gateway swapped OAuth bearer for service API key before calling the mortgage backend.',
};

const MORTGAGE_TOKEN_EVENTS = [
  { id: 'user-token', label: 'User OIDC access token (session)', status: 'complete', claims: { sub: 'user-123', scope: 'mortgage:read' } },
  { id: 'exchanged-token', label: 'RFC 8693 delegated token (aud=mcp-gateway)', status: 'complete', exchangeMethod: 'with-actor', claims: { aud: 'mcp-gateway', act: { sub: 'agent-client-id' } } },
  { id: 'mcp-gateway-route', label: 'Ping Agent Gateway — introspect + route (api_key disposition)', status: 'complete', routedVia: 'gateway', disposition: 'api_key' },
  { id: 'gw-authorize', label: 'PingOne Authorize (P1AZ) — PERMIT (mortgage:read)', status: 'complete', authorizeDecision: 'PERMIT', authorizeEngine: 'pingone', decision: 'PERMIT' },
  { id: 'gw-credential-swap', label: 'Gateway credential swap — OAuth bearer → service API key', status: 'complete', credentialPath: 'api_key', apiKeyMaskedLast4: '0000' },
  { id: 'mcp-tool-result', label: 'MCP tool result — show_mortgage', status: 'complete' },
];

const CUSTOMER_USER = { id: 'user-123', username: 'demo-customer', email: 'customer@bank.com', firstName: 'Demo', lastName: 'Customer', name: 'Demo Customer', role: 'customer' };

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function mockCustomerMortgage(page) {
  const ok = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/oauth/user/status', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/auth/oauth/status', (r) => r.fulfill(ok({ authenticated: false, user: null })));
  await page.route('**/api/auth/session**', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/tokens/session-preview**', (r) => r.fulfill(ok({ tokenEvents: MORTGAGE_TOKEN_EVENTS })));
  await page.route('**/api/token-chain**', (r) => r.fulfill(ok({ tokenEvents: MORTGAGE_TOKEN_EVENTS })));
  await page.route('**/api/admin/feature-flags**', (r) => r.fulfill(ok({
    flags: [
      { id: 'ff_show_agent_in_middle', value: true },
      { id: 'ff_mcp_gateway_pinggateway', value: true },
    ],
  })));
  await page.route('**/api/admin/config**', (r) => r.fulfill(ok({ config: {} })));
  await page.route('**/api/config/vertical**', (r) => r.fulfill(ok({ manifest: null })));
  await page.route('**/api/verticals/**', (r) => r.fulfill(ok({ id: 'banking' })));
  await page.route('**/api/accounts/my**', (r) => r.fulfill(ok({
    accounts: [
      { id: 'acc_001', accountType: 'checking', balance: 1500 },
      { id: 'acc_002', accountType: 'savings', balance: 8200.5 },
    ],
  })));
  await page.route('**/api/transactions**', (r) => r.fulfill(ok({ transactions: [] })));
  await page.route('**/api/demo-agent/nl**', (r) => r.fulfill(ok({
    result: { kind: 'banking', banking: { action: 'mortgage_demo' } },
    source: 'heuristic',
  })));
  await page.route('**/api/demo-agent/tools**', (r) => r.fulfill(ok({
    availableTools: [{ name: 'show_mortgage', permitted: true }, { name: 'get_my_accounts', permitted: true }],
    vertical: 'banking',
  })));
  await page.route('**/api/mcp/tool**', async (route) => {
    const req = route.request();
    let tool = '';
    try { tool = req.postDataJSON()?.tool || ''; } catch { /* ignore */ }
    if (tool === 'show_mortgage') {
      await route.fulfill(ok({
        result: {
          content: [{ type: 'text', text: JSON.stringify(MORTGAGE_PAYLOAD, null, 2) }],
          _meta: {
            credentialPath: 'api_key',
            apiKeyMaskedLast4: '0000',
            apiCall: 'GET /mortgage',
            note: MORTGAGE_PAYLOAD.note,
          },
        },
        tokenEvents: MORTGAGE_TOKEN_EVENTS,
        gwAuditTrail: { decision: 'PERMIT', engine: 'pingone', tool: 'show_mortgage', disposition: 'api_key' },
      }));
      return;
    }
    await route.fulfill(ok({ result: { content: [{ type: 'text', text: '{}' }] }, tokenEvents: [] }));
  });
  await page.route('**/ws**', (r) => r.abort());
  await page.route('**/api/mcp/flow/**', (r) => r.abort());
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP api.ping.demo 127.0.0.1'] });
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })).newPage();

  await page.goto(`${BASE}/architecture/token-flow.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  await shot(page, '01-architecture-token-flow');

  await mockCustomerMortgage(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  await shot(page, '02-agent-dashboard');

  await page.locator('input.ba-input').fill('show my mortgage');
  await shot(page, '03-mortgage-prompt');

  await page.locator('input.ba-input').press('Enter');
  await page.waitForURL('**/path/mortgage**', { timeout: 25000 });
  await page.locator('.mpp-title').filter({ hasText: 'Mortgage account' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await shot(page, '04-mortgage-app-page');

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  await page.locator('input.ba-input').fill('show my mortgage');
  await page.locator('input.ba-input').press('Enter');
  await page.waitForURL('**/path/mortgage**', { timeout: 25000 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  const chainBtn = page.locator('button').filter({ hasText: /Token Chain/i }).first();
  if (await chainBtn.isVisible().catch(() => false)) {
    await page.evaluate(() => document.querySelectorAll('.lo-backdrop').forEach((el) => el.remove()));
    await chainBtn.click({ force: true });
    await page.waitForTimeout(1500);
    await shot(page, '05-token-chain-mortgage');
  }

  await browser.close();
  console.log('Capture complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
