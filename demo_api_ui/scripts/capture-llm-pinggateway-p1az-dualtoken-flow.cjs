#!/usr/bin/env node
/**
 * Capture screenshots for dual-token (Path B) flow — banking_resource_server.
 * Run: cd demo_api_ui && node scripts/capture-llm-pinggateway-p1az-dualtoken-flow.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/screenshots/llm-pinggateway-p1az-dualtoken-flow');
const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:4000';

fs.mkdirSync(OUT, { recursive: true });

const IDENTITY_PAYLOAD = {
  credentialPath: 'dual_token',
  badge: 'ACCESS + ID-TOKEN PATH',
  color: 'teal',
  accessTokenClaims: {
    sub: 'user-123',
    aud: 'https://api.ping.demo:3001',
    scope: 'openid profile banking:read',
    act: { sub: 'super-banking-agent-client' },
  },
  idTokenClaims: {
    sub: 'user-123',
    name: 'Demo Customer',
    email: 'customer@bank.com',
    preferred_username: 'demo-customer',
  },
  idTokenSource: 'wire',
  message:
    'banking_resource_server decoded your access token and id_token server-side. CLAIMS ONLY — no raw JWT crosses this boundary.',
  returnTo: '/dashboard',
  returnLabel: 'Back to Dashboard',
};

const DUALTOKEN_TOKEN_EVENTS = [
  { id: 'user-token', label: 'User OIDC access token (session)', status: 'complete', claims: { sub: 'user-123', scope: 'openid profile banking:read' } },
  { id: 'exchanged-token', label: 'RFC 8693 delegated token (aud=mcp-gateway)', status: 'complete', exchangeMethod: 'with-actor', claims: { aud: 'mcp-gateway', act: { sub: 'agent-client-id' } } },
  { id: 'mcp-gateway-route', label: 'Ping Agent Gateway — introspect + route (dual_token disposition)', status: 'complete', routedVia: 'gateway', disposition: 'dual_token' },
  { id: 'gw-authorize', label: 'PingOne Authorize (P1AZ) — PERMIT (profile:read)', status: 'complete', authorizeDecision: 'PERMIT', authorizeEngine: 'pingone', decision: 'PERMIT' },
  { id: 'gw-credential-forward', label: 'Gateway forwards access + id_token to banking_resource_server', status: 'complete', credentialPath: 'dual_token' },
  { id: 'mcp-tool-result', label: 'MCP tool result — user_profile_card', status: 'complete' },
];

const CUSTOMER_USER = { id: 'user-123', username: 'demo-customer', email: 'customer@bank.com', firstName: 'Demo', lastName: 'Customer', name: 'Demo Customer', role: 'customer' };

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function mockCustomerDualToken(page) {
  const ok = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/oauth/user/status', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/auth/oauth/status', (r) => r.fulfill(ok({ authenticated: false, user: null })));
  await page.route('**/api/auth/session**', (r) => r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })));
  await page.route('**/api/tokens/session-preview**', (r) => r.fulfill(ok({ tokenEvents: DUALTOKEN_TOKEN_EVENTS })));
  await page.route('**/api/token-chain**', (r) => r.fulfill(ok({ tokenEvents: DUALTOKEN_TOKEN_EVENTS })));
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
  await page.route('**/api/resource-server/identity**', (r) => r.fulfill(ok(IDENTITY_PAYLOAD)));
  await page.route('**/api/demo-agent/tools**', (r) => r.fulfill(ok({
    availableTools: [{ name: 'user_profile_card', permitted: true }, { name: 'show_mortgage', permitted: true }],
    vertical: 'banking',
  })));
  await page.route('**/api/mcp/tool**', async (route) => {
    const req = route.request();
    let tool = '';
    try { tool = req.postDataJSON()?.tool || ''; } catch { /* ignore */ }
    if (tool === 'user_profile_card') {
      await route.fulfill(ok({
        result: {
          content: [{ type: 'text', text: JSON.stringify(IDENTITY_PAYLOAD, null, 2) }],
          _meta: {
            credentialPath: 'dual_token',
            apiCall: 'POST /api/resource-server/identity',
            note: 'Gateway forwarded access + id_token; BFF decoded claims server-side.',
          },
        },
        tokenEvents: DUALTOKEN_TOKEN_EVENTS,
        gwAuditTrail: { decision: 'PERMIT', engine: 'pingone', tool: 'user_profile_card', disposition: 'dual_token' },
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

  await mockCustomerDualToken(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  await shot(page, '01-agent-dashboard');

  const chip = page.locator('button').filter({ hasText: /Access \+ ID-Token Path Demo/i }).first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    await shot(page, '02-dualtoken-chip-clicked');
  } else {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('banking-agent-action', { detail: { actionId: 'dual_token_demo' } }));
    });
  }

  await page.waitForURL('**/path/dualtoken-info**', { timeout: 25000 });
  await page.locator('.aitp-title').filter({ hasText: /banking_resource_server/i }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await shot(page, '03-dualtoken-info-page');

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  const chip2 = page.locator('button').filter({ hasText: /Access \+ ID-Token Path Demo/i }).first();
  if (await chip2.isVisible().catch(() => false)) {
    await chip2.click();
    await page.waitForURL('**/path/dualtoken-info**', { timeout: 25000 });
  }
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 25000 });
  const chainBtn = page.locator('button').filter({ hasText: /Token Chain/i }).first();
  if (await chainBtn.isVisible().catch(() => false)) {
    await page.evaluate(() => document.querySelectorAll('.lo-backdrop').forEach((el) => el.remove()));
    await chainBtn.click({ force: true });
    await page.waitForTimeout(1500);
    await shot(page, '04-token-chain-dualtoken');
  }

  await browser.close();
  console.log('Capture complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
