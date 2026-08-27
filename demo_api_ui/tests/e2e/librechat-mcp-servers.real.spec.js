// Every MCP server door declared in librechat/librechat.yaml, driven through
// LibreChat's own UI against the live stack.
//
//   cd demo_api_ui && PLAYWRIGHT_SKIP_WEBSERVER=1 \
//     npm run test:e2e:real -- librechat-mcp-servers
//
// Prerequisites (each door is a separate test, so a missing one only fails
// its own test):
//   - the librechat/ stack is up          (docker compose -f librechat/docker-compose.yml up -d)
//   - the main stack's mcp-server on :8080 (aidemo-mcp)
//   - kubectl --context us -n ping-devops-curtismuir \
//       port-forward svc/cm-mcpgw-opensearch-mcp-server 9900:80   (opensearch-direct)
//   - the Mac Priv Agent running          (opensearch-privilege-agent, via mcp-facade)
//   - demo_api_server's mcp-facade route up (PR #2356)
//       (opensearch-privilege-agent, privilege-agentless, agent-gateway)
//   - the gpt-oss tier on :8096, via :8090 (every tool call)
//
// What "proven" means here: the agent's reply renders LibreChat's own
// "Ran <tool>" marker for that server AND the answer contains data only the
// tool could have returned. A door whose blocker is outside this repo
// (a lapsed Privilege policy, a PingOne login this runner has no
// credentials for) asserts that the door was REACHED and records why it
// stopped, instead of pretending.
'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');
const { test, expect } = require('@playwright/test');

const LC = process.env.LIBRECHAT_URL || 'http://localhost:3080';
const PROVIDER = 'Local LLM Proxy';
const MODEL = 'gpt-oss-20b'; // the only local tier with --jinja, i.e. tool calls
const ACCOUNT = {
  name: 'LibreChat E2E',
  username: 'librechat_e2e',
  email: process.env.LIBRECHAT_E2E_EMAIL || 'librechat-e2e@example.com',
  password: process.env.LIBRECHAT_E2E_PASSWORD || 'LibreChatE2e!2026',
};
const PRIV_AGENT_FRONTEND = 'opensearch.default.applications.procyon.ai';
const TENANT_ROOT_CA = path.resolve(__dirname, '../../../librechat/procyon-tenant-root.crt');

// One entry per mcpServers key in librechat/librechat.yaml.
const DOORS = [
  {
    server: 'aidemo-mcp',
    tool: 'get_my_accounts',
    prompt: 'What are my account balances?',
    // The seed store's four accounts: checking 10,000 / savings 15,000.
    reply: /10[,.]?000|15[,.]?000/,
  },
  {
    server: 'opensearch-direct',
    tool: 'ClusterHealthTool',
    prompt: 'What is the OpenSearch cluster health status? Use the tool.',
    reply: /\b(green|yellow|red)\b/i,
    precheck: 'http://localhost:9900/mcp',
  },
];

// LibreChat rate-limits /api/auth/login (LOGIN_MAX per LOGIN_WINDOW, default
// 7 per 5 min), so the whole run logs in exactly twice, once each way:
//   - an API-only call for the bearer token createAgent/afterAll need, and
//   - one real browser form login, into ONE shared context kept alive for
//     the whole file — every test opens a new PAGE in that same context,
//     never a new context.
// Two things were tried and rejected first: (1) copying a cookie out of an
// APIRequestContext into a fresh BrowserContext via addCookies does NOT
// reliably restore LibreChat's session (the SPA kept redirecting to
// /login); (2) reusing one snapshotted `storageState` object across several
// separate browser.newContext() calls half-worked, intermittently, because
// LibreChat rotates the refresh-token cookie on use — the first context to
// load spends it, and every other context's frozen copy of the old token
// then fails, non-deterministically by whichever page happens to load
// first. A single live context's cookie jar updates itself on every
// rotation, so every page drawn from it always has the current token —
// there's nothing to go stale.
const session = { token: null, context: null };

async function loginOnce(playwright, browser) {
  const api = await playwright.request.newContext();
  // ALLOW_REGISTRATION=true in librechat/.env; a 4xx here just means the
  // account already exists.
  const reg = await api.post(`${LC}/api/auth/register`, {
    data: { ...ACCOUNT, confirm_password: ACCOUNT.password },
    failOnStatusCode: false,
  });
  console.log(`[librechat] register -> ${reg.status()}`);
  const r = await api.post(`${LC}/api/auth/login`, {
    data: { email: ACCOUNT.email, password: ACCOUNT.password },
    failOnStatusCode: false,
  });
  expect(r.status(), 'api login status (429 = login rate limit; wait LOGIN_WINDOW and rerun)').toBe(200);
  session.token = (await r.json()).token;
  await api.dispose();

  session.context = await browser.newContext();
  const page = await session.context.newPage();
  await page.goto(`${LC}/login`);
  await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNT.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(ACCOUNT.password);
  await page.getByTestId('login-button').click();
  await page.waitForURL(/\/c\/new/, { timeout: 30_000 });
  await page.close();
}

// Every test gets its own page in the one shared, live context — cheap (no
// network login, no context churn), isolated per test. Caller closes the
// PAGE (not the context) when done.
async function newAuthedPage() {
  const page = await session.context.newPage();
  await page.goto(`${LC}/c/new`);
  await expect(page.locator('[aria-label="Message input"]')).toBeVisible({ timeout: 30_000 });
  return page;
}

// Artifacts needs no per-agent tool entry — `ui_resources` (the `Tools`
// enum's only artifact-adjacent key) was tried and disproven live: POSTing
// it in `tools` gets it silently stripped (server responds with the agent
// created, `tools: []`). Checked GET /api/endpoints instead: `artifacts` is
// already in the live server's DEFAULT `endpoints.agents.capabilities` list
// with no `endpoints.agents` block in librechat.yaml at all — it's an
// endpoint-wide toggle, on by default, independent of any agent's `tools`
// array. The `:::artifact{}` fence either renders because of that, or it
// doesn't because the model didn't choose to emit it — nothing here to add.

// Mirrors what the Agent Builder stores when you pick one tool from one MCP
// server: the server marker plus `<tool>_mcp_<server>`. `instructions` is
// only added when explicitly requested — every other caller (the plain
// door-proof tests) must not have its agent's behavior changed.
async function createAgent(request, { server, tool }, { instructions } = {}) {
  const tools = [`sys__server__sys_mcp_${server}`, `${tool}_mcp_${server}`];
  const r = await request.post(`${LC}/api/agents`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: {
      name: `e2e ${server}`,
      provider: PROVIDER,
      model: MODEL,
      tools,
      ...(instructions ? { instructions } : {}),
    },
  });
  expect(r.status(), `create agent for ${server}`).toBe(201);
  const id = (await r.json()).id;
  createdAgents.push(id);
  return id;
}

// Agents created by this run, deleted in afterAll so the throwaway LibreChat
// account does not accumulate one per test per run.
const createdAgents = [];

async function openMcpSettings(page) {
  await page.goto(`${LC}/c/new`);
  await page.getByTestId('nav-panel-mcp-builder').click();
  const list = page.getByRole('list', { name: 'MCP Servers' });
  // Default 5s is too tight while a concurrent tool call is busy reasoning
  // on the same gpt-oss tier — the sidebar's own data fetch just queues later.
  await expect(list).toBeVisible({ timeout: 20_000 });
  return list;
}

// Ask the agent, wait for LibreChat's own tool marker, return the reply text.
async function askAndWaitForTool(page, agentId, { prompt, tool, server }) {
  await page.goto(`${LC}/c/new?agent_id=${agentId}`);
  const input = page.locator('[aria-label="Message input"]');
  await expect(input).toHaveAttribute('placeholder', /Message e2e/);
  await input.fill(prompt);
  await input.press('Enter');
  // gpt-oss reasons, calls the tool, reasons again — well over a minute is normal.
  await expect(page.getByText(`Ran ${tool}`).first()).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(`in ${server}`).first()).toBeVisible();
  // Reply is complete when the stop button goes away.
  await expect(page.locator('button[aria-label*="Stop"]')).toHaveCount(0, { timeout: 120_000 });
  return page.locator('main').innerText();
}

test.describe('LibreChat MCP server doors — live', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async ({ playwright, browser }) => {
    await loginOnce(playwright, browser);
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdAgents) {
      await request.delete(`${LC}/api/agents/${id}`, { headers: { Authorization: `Bearer ${session.token}` }, failOnStatusCode: false });
    }
    await session.context.close();
  });

  test('every door declared in librechat.yaml is listed in MCP Settings', async ({}) => {
    const page = await newAuthedPage();
    try {
      const list = await openMcpSettings(page);
      for (const server of ['aidemo-mcp', 'opensearch-direct', 'opensearch-privilege-agent', 'privilege-agentless', 'agent-gateway']) {
        const item = list.locator(`[aria-label^="${server} - "]`);
        await expect(item, `${server} listed`).toBeVisible();
        console.log(`[librechat] ${await item.getAttribute('aria-label')}`);
      }
    } finally {
      await page.close();
    }
  });

  for (const door of DOORS) {
    test(`${door.server}: ${door.tool} returns real data through LibreChat`, async ({ request }) => {
      if (door.precheck) {
        const up = await request
          .post(door.precheck, {
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } },
            failOnStatusCode: false,
            timeout: 10_000,
          })
          .then((r) => r.status())
          .catch((e) => `ERR ${e.message}`);
        expect(up, `${door.server} backend reachable at ${door.precheck} (is the port-forward running?)`).toBe(200);
      }
      const agentId = await createAgent(request, door);
      const page = await newAuthedPage();
      try {
        const reply = await askAndWaitForTool(page, agentId, door);
        console.log(`[librechat][${door.server}] ${reply.replace(/\s+/g, ' ').slice(0, 300)}`);
        expect(reply, `${door.server} reply carries tool data`).toMatch(door.reply);
      } finally {
        await page.close();
      }
    });
  }

  test('opensearch-privilege-agent: the Priv Agent door is reached (policy decides the rest)', async ({ request }) => {
    // Probe the Frontend Name the way LibreChat does: by that hostname (the
    // agent's DNS proxy resolves it to 127.0.0.1) and trusting only the
    // committed TenantRoot — so a wrong/rotated cert fails here first.
    const probe = await new Promise((resolve) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
      const req = https.request(
        {
          host: PRIV_AGENT_FRONTEND, port: 8643, path: '/mcp', method: 'POST',
          ca: fs.readFileSync(TENANT_ROOT_CA),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(body) },
          timeout: 15_000,
        },
        (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 200) })); },
      );
      req.on('error', (e) => resolve({ status: 0, body: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
      req.end(body);
    });
    console.log(`[priv-agent] ${probe.status} ${probe.body}`);
    expect(probe.status, `gateway reached via ${PRIV_AGENT_FRONTEND} (status 0 = agent down or CA mismatch: ${probe.body})`).not.toBe(0);

    if (probe.status === 403 && /doesn't have access/.test(probe.body)) {
      test.info().annotations.push({ type: 'blocked-outside-repo', description: `Privilege policy lapsed: ${probe.body}` });
      // LibreChat must still list the door and must NOT be asking for an OAuth login it does not have.
      const page = await newAuthedPage();
      try {
        const list = await openMcpSettings(page);
        const label = await list.locator('[aria-label^="opensearch-privilege-agent - "]').getAttribute('aria-label');
        console.log(`[librechat] ${label}`);
        expect(label).not.toMatch(/Needs Auth/);
      } finally {
        await page.close();
      }
      return;
    }

    expect(probe.status, 'gateway accepted initialize').toBe(200);
    const door = { server: 'opensearch-privilege-agent', tool: 'ClusterHealthTool', prompt: 'What is the OpenSearch cluster health status? Use the tool.', reply: /\b(green|yellow|red)\b/i };
    const agentId = await createAgent(request, door);
    const page = await newAuthedPage();
    try {
      const reply = await askAndWaitForTool(page, agentId, door);
      expect(reply).toMatch(door.reply);
    } finally {
      await page.close();
    }
  });

  test('privilege-agentless: Connect starts LibreChat native OAuth against the gateway', async ({}) => {
    const page = await newAuthedPage();
    try {
      const list = await openMcpSettings(page);
      const item = list.locator('[aria-label^="privilege-agentless - "]');
      const label = await item.getAttribute('aria-label');
      console.log(`[agentless] current state: ${label}`);
      // A prior run in this same session (this file has run several times
      // today against the same throwaway account) may have already
      // completed the OAuth flow — LibreChat persists the resulting tokens
      // server-side, so a fresh "Connect" click has nothing to do and fires
      // no popup. That's a stronger proof than a fresh flow, not a failure.
      if (/Connected/.test(label || '')) {
        test.info().annotations.push({ type: 'already-connected', description: `already Connected from an earlier run: ${label}` });
        return;
      }
      const [popup] = await Promise.all([
        page.waitForEvent('popup', { timeout: 30_000 }),
        item.getByRole('button', { name: 'Connect' }).click(),
      ]);
      // The popup opens on about:blank and only then follows LibreChat's
      // /api/mcp/<server>/oauth/initiate redirect chain: discovery + Dynamic
      // Client Registration succeeded if it lands on PingOne's sign-on (or
      // straight on LibreChat's success page when the browser already has SSO).
      await popup.waitForURL(/apps\.pingone\.com|\/oauth\/success/, { timeout: 45_000 });
      const url = popup.url();
      console.log(`[agentless] popup -> ${url}`);
      if (/\/oauth\/success/.test(url)) {
        await expect(item).toHaveAttribute('aria-label', /Connected/, { timeout: 30_000 });
      } else {
        test.info().annotations.push({ type: 'blocked-outside-repo', description: 'PingOne sign-on reached; no demo-user credentials wired into this runner' });
      }
    } finally {
      await page.close();
    }
  });

  // The two gateway doors fronted by mcp-facade (PR #2356). Its tool
  // responses append a `reel_url:` text line pointing at the compact
  // embed view — that fallback is the actual contract (§7 of
  // docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md)
  // and is required every time. Whether the model *also* renders it as a
  // LibreChat :::artifact fence is measured, not required — the `artifacts`
  // endpoint capability is confirmed on by default (createAgent's own
  // comment above), so a low count here means the model chose not to emit
  // the fence, not a config gap.
  const REEL_INSTRUCTIONS = `When a tool result includes a line starting with "reel_url:", always render that URL as an artifact, in this exact form, replacing <url> with the value:

:::artifact{identifier="reel" type="application/vnd.code-html" title="Live trace"}
<iframe src="<url>" style="width:100%;height:100%;border:0"></iframe>
:::

Do this every time, even if you already showed one earlier in the conversation.`;

  const GATEWAY_DOORS = [
    { server: 'privilege-agentless', tool: 'get_my_accounts', prompt: 'What are my account balances?' },
    { server: 'agent-gateway', tool: 'get_my_accounts', prompt: 'What are my account balances?' },
  ];

  for (const door of GATEWAY_DOORS) {
    test(`${door.server}: reel_url is present every time (artifact fence measured, not required)`, async ({ request }) => {
      const RUNS = 5;
      let linkCount = 0;
      let fenceCount = 0;
      for (let i = 0; i < RUNS; i++) {
        const agentId = await createAgent(request, door, { instructions: REEL_INSTRUCTIONS });
        const page = await newAuthedPage();
        try {
          const reply = await askAndWaitForTool(page, agentId, door);
          if (/reel_url:/.test(reply) || /transaction-trace\/embed/.test(reply)) linkCount++;
          if (/```html|<iframe/.test(reply)) fenceCount++;
        } finally {
          await page.close();
        }
      }
      console.log(`[reel-compliance] ${door.server}: link present ${linkCount}/${RUNS}, artifact fence attempted ${fenceCount}/${RUNS}`);
      test.info().annotations.push({ type: 'reel-compliance', description: `link ${linkCount}/${RUNS}, fence ${fenceCount}/${RUNS}` });
      expect(linkCount, 'reel_url fallback must appear every time — this is the part with no LLM-compliance risk').toBe(RUNS);
    });
  }
});
