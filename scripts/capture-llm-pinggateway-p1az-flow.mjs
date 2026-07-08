#!/usr/bin/env node
/**
 * Capture screenshots for docs/use-cases/llm-pinggateway-p1az-flow-test.md
 * Run: node scripts/capture-llm-pinggateway-p1az-flow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/screenshots/llm-pinggateway-p1az-flow');
const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:4000';

fs.mkdirSync(OUT, { recursive: true });

const SAMPLE_TOKEN_EVENTS = [
  {
    id: 'user-token',
    label: 'User OIDC access token (session)',
    status: 'complete',
    claims: { sub: 'user-123', scope: 'openid profile banking:read' },
  },
  {
    id: 'exchanged-token',
    label: 'RFC 8693 delegated token (aud=mcp-gateway)',
    status: 'complete',
    exchangeMethod: 'with-actor',
    claims: { sub: 'user-123', aud: 'mcp-gateway', act: { sub: 'agent-client-id' } },
  },
  {
    id: 'mcp-gateway-route',
    label: 'Ping Agent Gateway — introspect + route',
    status: 'complete',
    routedVia: 'gateway',
  },
  {
    id: 'gw-authorize',
    label: 'PingOne Authorize (P1AZ) — PERMIT',
    status: 'complete',
    authorizeDecision: 'PERMIT',
    authorizeEngine: 'pingone',
    decision: 'PERMIT',
  },
  {
    id: 'mcp-tool-result',
    label: 'MCP tool result — get_my_accounts',
    status: 'complete',
  },
];

const CUSTOMER_USER = {
  id: 'user-123',
  username: 'demo-customer',
  email: 'customer@bank.com',
  firstName: 'Demo',
  lastName: 'Customer',
  name: 'Demo Customer',
  role: 'customer',
};

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function mockCustomer(page) {
  const ok = (body) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/auth/oauth/user/status', (r) =>
    r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })),
  );
  await page.route('**/api/auth/oauth/status', (r) =>
    r.fulfill(ok({ authenticated: false, user: null })),
  );
  await page.route('**/api/auth/session**', (r) =>
    r.fulfill(ok({ authenticated: true, user: CUSTOMER_USER })),
  );
  await page.route('**/api/tokens/session-preview**', (r) =>
    r.fulfill(ok({ tokenEvents: SAMPLE_TOKEN_EVENTS })),
  );
  await page.route('**/api/token-chain**', (r) =>
    r.fulfill(ok({ tokenEvents: SAMPLE_TOKEN_EVENTS })),
  );
  await page.route('**/api/admin/feature-flags**', (r) =>
    r.fulfill(ok({ flags: [{ id: 'ff_show_agent_in_middle', value: true }] })),
  );
  await page.route('**/api/admin/config**', (r) => r.fulfill(ok({ config: {} })));
  await page.route('**/api/config/vertical**', (r) => r.fulfill(ok({ manifest: null })));
  await page.route('**/api/verticals/**', (r) => r.fulfill(ok({ id: 'banking' })));
  await page.route('**/api/health/**', (r) => r.fulfill(ok({ status: 'ok' })));
  await page.route('**/api/mcp/tool', (r) =>
    r.fulfill(
      ok({
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accounts: [
                    { id: 'acc_001', account_type: 'checking', balance: 1500 },
                    { id: 'acc_002', account_type: 'savings', balance: 8200.5 },
                  ],
                },
                null,
                2,
              ),
            },
          ],
        },
        gwAuditTrail: {
          decision: 'PERMIT',
          engine: 'pingone',
          tool: 'get_my_accounts',
        },
      }),
    ),
  );
  await page.route('**/ws**', (r) => r.abort());
}

async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
  await panel.waitFor({ state: 'visible', timeout: 25000 });
}

async function clickMyAccounts(page) {
  const popout = page.locator('.ba-actions-popout');
  if (!(await popout.isVisible().catch(() => false))) {
    await page.locator('button.ba-actions-trigger').first().click();
    await popout.waitFor({ state: 'visible', timeout: 10000 });
  }
  await page
    .locator('button.ba-popout-list-item')
    .filter({ has: page.locator('.ba-popout-item-name', { hasText: /^My Accounts$/ }) })
    .click();
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP api.ping.demo 127.0.0.1'],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // 1 — Architecture token-flow diagram (no auth)
  await page.goto(`${BASE}/architecture/token-flow.html`, { waitUntil: 'networkidle' });
  await shot(page, '01-architecture-token-flow');

  // 2 — Token Lab static page (BFF public)
  await page.goto(`${BASE}/pinggateway-test.html`, { waitUntil: 'networkidle' });
  await shot(page, '02-token-lab');

  // 3–5 — Agent dashboard flow (mocked session + MCP gateway/P1AZ response)
  await mockCustomer(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await ensureAgentReady(page);
  await shot(page, '03-agent-dashboard');

  await page.locator('input.ba-input').fill('Show my accounts');
  await shot(page, '04-agent-prompt');

  await clickMyAccounts(page);
  await page.waitForTimeout(2500);
  await shot(page, '05-agent-response');

  // Token chain panel if visible
  const chainBtn = page.locator('button').filter({ hasText: /Token Chain/i }).first();
  if (await chainBtn.isVisible().catch(() => false)) {
    await chainBtn.click();
    await page.waitForTimeout(1000);
    await shot(page, '06-token-chain');
  }

  // Gateway tester (admin mock path)
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/auth/oauth/status', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { ...CUSTOMER_USER, role: 'admin' } }),
    }),
  );
  await page.route('**/api/**', (r) => {
    const url = r.request().url();
    if (url.includes('/api/mcp-gateway/active')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          usePingGateway: true,
          name: 'PingOne Agent Gateway',
          authzBackend: 'Real PingOne Authorize',
        }),
      });
    }
    if (url.includes('/api/mcp-gateway/test')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          gateway: { name: 'PingOne Agent Gateway', authzBackend: 'real (PingOne Authorize)' },
          result: { content: [{ type: 'text', text: '{"accounts":[{"id":"acc_001","balance":1500}]}' }] },
          gwAuditTrail: {
            decision: 'PERMIT',
            engine: 'pingone',
            tool: 'get_my_accounts',
            authorizeRequest: { ToolName: 'get_my_accounts', ClientId: 'user-123' },
            authorizeResponse: { decision: 'PERMIT' },
          },
        }),
      });
    }
    if (url.includes('/api/mcp/inspector/tools')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [{ name: 'get_my_accounts', description: 'List accounts' }],
        }),
      });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${BASE}/setup?tab=mcp-gateway&subtab=tester`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '07-gateway-tester');

  await browser.close();
  console.log('Capture complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
