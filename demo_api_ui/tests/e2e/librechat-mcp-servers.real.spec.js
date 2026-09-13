// Every MCP server door declared in librechat/librechat.yaml, driven through
// LibreChat's own UI against the live stack.
//
//   cd demo_api_ui && PLAYWRIGHT_SKIP_WEBSERVER=1 \
//     npm run test:e2e:real -- librechat-mcp-servers
//
// Through the PingOne Privilege LLM gateway instead of the local proxy, add:
//   LIBRECHAT_E2E_PROVIDER='PingOne Privilege (OpenAI)' LIBRECHAT_E2E_MODEL=gpt-4o-mini
//
// Prerequisites:
//   - the librechat/ stack is up          (docker compose -f librechat/docker-compose.yml up -d)
//   - the main stack's mcp-server on :8080 (aidemo-mcp)
//   - the gpt-oss tier on :8096, via :8090 (every tool call), or the Privilege
//     provider with PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI in librechat/.env
//
// What "proven" means here: the agent's reply renders LibreChat's own
// "Ran <tool>" marker for that server AND the answer contains data only the
// tool could have returned.
'use strict';
const { test, expect } = require('@playwright/test');

const LC = process.env.LIBRECHAT_URL || 'http://localhost:3080';
const PROVIDER = process.env.LIBRECHAT_E2E_PROVIDER || 'Local LLM Proxy';
// gpt-oss-20b is the only local tier with --jinja, i.e. tool calls
const MODEL = process.env.LIBRECHAT_E2E_MODEL || 'gpt-oss-20b';
const ACCOUNT = {
  name: 'LibreChat E2E',
  username: 'librechat_e2e',
  email: process.env.LIBRECHAT_E2E_EMAIL || 'librechat-e2e@example.com',
  password: process.env.LIBRECHAT_E2E_PASSWORD || 'LibreChatE2e!2026',
};

// One entry per mcpServers key in librechat/librechat.yaml.
const DOORS = [
  {
    server: 'aidemo-mcp',
    tool: 'get_my_accounts',
    prompt: 'What are my account balances?',
    // get_my_accounts on aidemo-mcp, 2026-09-13: checking 3,400 / savings 6,600.
    // ponytail: hardcoded balances drift when the demo store changes (they were
    // 10,000 / 15,000 before) — read them from the tool first if that recurs.
    reply: /3[,.]?400|6[,.]?600/,
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
  // redirect=false keeps the local form when librechat/.env sets
  // OPENID_AUTO_REDIRECT=true (LibreChat's Login reads exactly that param).
  await page.goto(`${LC}/login?redirect=false`);
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

// Mirrors what the Agent Builder stores when you pick one tool from one MCP
// server: the server marker plus `<tool>_mcp_<server>`.
async function createAgent(request, { server, tool }) {
  const tools = [`sys__server__sys_mcp_${server}`, `${tool}_mcp_${server}`];
  const r = await request.post(`${LC}/api/agents`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: {
      name: `e2e ${server}`,
      provider: PROVIDER,
      model: MODEL,
      tools,
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
      for (const { server } of DOORS) {
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
});
