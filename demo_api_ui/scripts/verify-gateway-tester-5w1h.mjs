#!/usr/bin/env node
/**
 * Verify Agent Gateway Tester 5W1H UI (static + live mcpAudit table).
 * Run: cd demo_api_ui && node scripts/verify-gateway-tester-5w1h.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'https://localhost:30400';
const MCP_AUDIT = {
  eventName: 'MCP_TOOL_CALL',
  who: { userSub: 'user-4511829e', agentSub: 'agent-demo-01', actDepth: 1 },
  what: { mcpMethod: 'tools/call', tool: 'get_my_accounts' },
  when: Date.now(),
  where: { resourceId: 'mcp-olb', routePath: '/mcp/olb', vertical: 'olb' },
  how: { decision: 'PERMIT', result: 'forwarded', backend: 'pingone' },
};

const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.route('**/api/auth/oauth/status', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { id: 'admin-1', username: 'admin@test', role: 'admin', name: 'Test Admin' },
      }),
    }),
  );

  const CONFIG_PAYLOAD = {
    mcpMode: 'pingone',
    mock: { enabled: true, running: true, devBypass: false, url: 'http://ping-gateway:8080', health: { ok: true } },
    config: {
      gatewayResourceUri: 'https://gw/mcp',
      upstreamMcpUrl: 'http://mcp-server:8080',
      pingOneEnvUrl: 'https://auth.pingone.com/env',
      pingOneResourceId: 'res-1',
      gatewayPublicUrl: 'https://gw',
      mcpScope: 'mcp:invoke',
      introspectEndpoint: 'https://auth.pingone.com/env/as/introspect',
    },
    envVars: { required: {}, optional: {} },
    pingGatewayJson: {},
    pingGatewayAdminJson: {},
  };

  await page.route('**/api/**', (r) => {
    const url = r.request().url();
    if (url.includes('/api/admin/mcp-gateway/config')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CONFIG_PAYLOAD),
      });
    }
    if (url.includes('/api/admin/config')) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ config: {} }) });
    }
    if (url.includes('/api/mcp-gateway/active')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          usePingGateway: true,
          name: 'PingOne Agent Gateway',
          simulated: false,
          authzBackend: 'Real PingOne Authorize',
          url: 'http://ping-gateway:8080',
        }),
      });
    }
    if (url.includes('/api/mcp-gateway/test')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          durationMs: 142,
          gateway: {
            usePingGateway: true,
            name: 'PingOne Agent Gateway',
            authzBackend: 'real (PingOne Authorize)',
          },
          result: { content: [{ type: 'text', text: '{"accounts":[{"id":"acc_001"}]}' }] },
          gwAuditTrail: {
            decision: 'PERMIT',
            engine: 'pingone',
            tool: 'get_my_accounts',
            authorizeRequest: { ToolName: 'get_my_accounts', ClientId: 'user-4511829e' },
            authorizeResponse: { decision: 'PERMIT' },
            mcpAudit: MCP_AUDIT,
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
    if (url.includes('/api/authorize/rules')) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rules: [] }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const testerUrl = `${BASE}/configure?tab=mcp-gateway&subtab=tester`;
  await page.goto(testerUrl, { waitUntil: 'networkidle', timeout: 60000 });
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (!bodyText.includes('Agent Gateway Tester')) {
    console.log('PAGE SNIPPET:', bodyText.slice(0, 1200));
  }

  const staticHeading = page.getByText(/McpAuditFilter — who \/ what \/ when \/ where \/ how/i);
  record('Static 5W1H section visible', await staticHeading.isVisible().catch(() => false));

  const docLink = page.locator('a[href*="docs.pingidentity.com/pinggateway/2026/mcp"]').first();
  record('MCP security gateway doc link', await docLink.isVisible().catch(() => false));

  await page.getByRole('button', { name: /Send through Agent Gateway/i }).click();
  await page.waitForTimeout(1500);

  const liveHeading = page.getByRole('heading', { name: /Live McpAuditFilter event \(5W1H\)/i });
  record('Live 5W1H table after tool call', await liveHeading.isVisible().catch(() => false));

  const whoCell = page.locator('td').filter({ hasText: 'user-4511829e' }).first();
  record('mcpAudit.who.userSub rendered', await whoCell.isVisible().catch(() => false));

  const toolCell = page.locator('code').filter({ hasText: 'get_my_accounts' }).first();
  record('mcpAudit.what.tool rendered', await toolCell.isVisible().catch(() => false));

  const permitCell = page.locator('td').filter({ hasText: 'PERMIT' }).first();
  record('mcpAudit.how.decision PERMIT rendered', await permitCell.isVisible().catch(() => false));

  const jsonBlock = page.locator('pre').filter({ hasText: 'MCP_TOOL_CALL' }).first();
  record('mcpAudit JSON block present', await jsonBlock.isVisible().catch(() => false));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- Summary ---');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
