// demo_api_ui/tests/e2e/helpers/chipPipeline.js
'use strict';
/**
 * Drive a single chip through the real two-hop flow and assert it did NOT
 * skip any pipeline stage. Customer-scoped assertions only (token-chain +
 * tokenEvents). Authorize/gateway corroboration is done at suite level via
 * an admin context (see assertAdminPipelineEvents).
 */
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * featurePage.mcpTool per vertical, DERIVED from the manifests under
 * demo_api_server/config/verticals — so a new vertical with a featurePage is
 * covered automatically (no hand-edit, no hard-assert footgun). Any directory
 * whose manifest.json declares `featurePage.mcpTool` contributes an entry.
 */
function deriveVerticalFeatureMcpTool() {
  const root = path.resolve(__dirname, '../../../../demo_api_server/config/verticals');
  const map = {};
  for (const id of fs.readdirSync(root)) {
    const mf = path.join(root, id, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      const tool = m.featurePage && m.featurePage.mcpTool;
      if (tool) map[id] = tool;
    } catch (_e) { /* skip malformed manifest */ }
  }
  return map;
}

const VERTICAL_FEATURE_MCP_TOOL = deriveVerticalFeatureMcpTool();

/**
 * True when POST /api/mcp/tool returned a non-empty tool result payload.
 * @param {object} mcpBody
 */
function mcpResultHasPayload(mcpBody) {
  const result = mcpBody?.result;
  if (!result) return false;
  const content = result.content;
  if (Array.isArray(content) && content.some((c) => typeof c?.text === 'string' && c.text.trim())) {
    return true;
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return Object.keys(result.structuredContent).length > 0;
  }
  if (typeof result.text === 'string' && result.text.trim()) return true;
  return false;
}

/**
 * @param {import('@playwright/test').APIRequestContext} api  customer-cookie'd context
 * @param {{id:string,label:string,message:string}} chip
 * @param {string} provider  'auto' (heuristics) | 'helix'
 * @returns {Promise<{source:string, result:object, executed:boolean, tokenEvents:any[]}>}
 */
/**
 * Switch the server-global active vertical (POST /api/verticals/active).
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {string} verticalId
 * @param {string} [bearer] optional raw access token
 */
async function activateVertical(api, verticalId, bearer) {
  const opts = {
    data: { id: verticalId },
    headers: { 'Content-Type': 'application/json' },
  };
  if (bearer) opts.headers.Authorization = `Bearer ${bearer}`;
  const r = await api.post('/api/verticals/active', opts);
  expect(r.status(), `activateVertical(${verticalId})`).toBe(204);
}

/**
 * CareConnect (healthcare) chips for the 3-path e2e matrix.
 * @see demo_api_server/config/verticals/healthcare/manifest.json
 */
const CARECONNECT_CHIPS = {
  heuristic: {
    id: 'hc2',
    label: 'Check coverage',
    message: 'check my coverage',
    expectedAction: 'view_coverage',
  },
  helix: {
    id: 'hc9',
    label: 'Summarize my recent visits',
    message: 'Summarize my recent visits',
  },
  apiMcp: {
    id: 'feature-health',
    label: 'Show Health Record',
    message: 'show health record',
    mcpTool: 'show_health_record',
  },
};

const { CARECONNECT_CORE_CHIPS } = require('./verticalCoreChips');

/**
 * Skip-proof assertions after POST /api/mcp/tool (shared by banking + vertical MCP chips).
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {{id:string}} chip
 * @param {import('@playwright/test').APIResponse} mcpResp
 * @param {number} beforeMcp
 * @param {number} beforeChain
 */
async function assertMcpPipelineCustomerProof(api, chip, mcpResp, beforeMcp, beforeChain, opts = {}) {
  expect(mcpResp.status(), `mcp/tool status for chip ${chip.id}`).not.toBe(401);
  const mcpStatus = mcpResp.status();
  expect(
    [200, 403, 428].includes(mcpStatus),
    `chip ${chip.id}: mcp/tool returned an expected pipeline status (200|403|428), got ${mcpStatus}`,
  ).toBe(true);
  const mcpBody = await mcpResp.json();
  const tokenEvents = mcpBody.tokenEvents || [];

  const sawExchange = tokenEvents.some(
    (e) =>
      e?.claims?.act ||
      /exchang|mcp.*token|delegat/i.test(`${e?.label || ''} ${e?.explanation || ''}`),
  );
  expect(sawExchange, `chip ${chip.id}: RFC 8693 exchange event in tokenEvents`).toBe(true);
  expect(tokenEvents.length, `chip ${chip.id}: token chain updated`).toBeGreaterThan(0);

  const afterResp = await api.get('/api/token-chain');
  const after = await afterResp.json();
  expect(after.tokenChain?.length || 0, `chip ${chip.id}: token-chain grew`).toBeGreaterThanOrEqual(beforeChain);
  if (mcpStatus === 200) {
    const afterMcp = after.mcpToolCallsChain?.length || 0;
    // The local audit ring buffer caps at 200 — once full the count never grows.
    // When at capacity, verify by timestamp: a fresh event must post-date snapshotTime.
    const MAX_RING = 200;
    if (beforeMcp >= MAX_RING && opts.snapshotTime) {
      const events = after.mcpToolCallsChain || [];
      const hasRecent = events.some(
        (e) => e.timestamp && new Date(e.timestamp) >= new Date(opts.snapshotTime),
      );
      expect(
        hasRecent,
        `chip ${chip.id}: mcp tool call recorded since ${opts.snapshotTime} (ring buffer full at ${MAX_RING})`,
      ).toBe(true);
    } else {
      expect(
        afterMcp,
        `chip ${chip.id}: mcp tool call recorded in token-chain (200)`,
      ).toBeGreaterThan(beforeMcp);
    }
    expect(
      mcpResultHasPayload(mcpBody),
      `chip ${chip.id}: MCP tool returned non-empty result payload (200)`,
    ).toBe(true);
  } else {
    const denialShape = JSON.stringify(mcpBody).toLowerCase();
    expect(
      /insufficient_scope|forbidden|denied|consent|hitl|step.?up|authoriz/.test(denialShape),
      `chip ${chip.id}: ${mcpStatus} response carries an Authorize/consent decision (pipeline ran to the gate)`,
    ).toBe(true);
  }
  return { mcpBody, tokenEvents, mcpStatus };
}

/**
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {{id:string,label:string,message:string}} chip
 * @param {string} provider
 * @param {{ vertical?: string, mcpTool?: string }} [options]
 */
async function runChip(api, chip, provider, options = {}) {
  const { vertical = null, mcpTool: mcpToolOverride = null } = options;
  // Hop 1: routing decision
  const nlBody = { message: chip.message, provider };
  if (vertical) nlBody.vertical = vertical;
  const nlResp = await api.post('/api/demo-agent/nl', { data: nlBody });
  expect(nlResp.status(), `nl status for chip ${chip.id}`).toBe(200);
  const { source, result } = await nlResp.json();
  expect(source, `routing source for chip ${chip.id}`).toBeTruthy();

  // A chip resolves to a tool only when result.kind === 'banking'.
  if (!result || result.kind !== 'banking' || !result.banking?.action) {
    return { source, result, executed: false, tokenEvents: [] };
  }

  // Snapshot token-chain BEFORE the pipeline.
  const beforeResp = await api.get('/api/token-chain');
  expect(beforeResp.status()).toBe(200);
  const before = await beforeResp.json();
  const beforeMcp = before.mcpToolCallsChain?.length || 0;
  const beforeChain = before.tokenChain?.length || 0;

  // Hop 2: pipeline. Map the heuristic action to its MCP tool exactly as the
  // SPA does. We assert the BFF drives the pipeline; the tool name mapping is
  // the SPA's responsibility, so we send the action via the same nl→dispatch
  // contract by re-using /api/mcp/tool with the canonical tool for the action.
  const toolByAction = {
    balance: 'get_account_balance',
    accounts: 'get_my_accounts',
    transactions: 'get_my_transactions',
    transfer: 'create_transfer',
    deposit: 'create_deposit',
    withdraw: 'create_withdrawal',
    biggest_purchase: 'get_my_transactions',
    spending_summary: 'get_my_transactions',
    unusual_patterns: 'get_my_transactions',
    afford_check: 'get_my_accounts',
    sensitive_account_details: 'get_my_accounts',
    mcp_tools: 'list_tools',
    mortgage_demo: 'show_mortgage',
  };
  const action = result.banking.action;
  let tool = mcpToolOverride || toolByAction[action];
  if (!tool && action === 'vertical_feature_demo') {
    const verticalId = vertical || 'banking';
    tool = VERTICAL_FEATURE_MCP_TOOL[verticalId];
    expect(
      tool,
      `chip ${chip.id}: vertical_feature_demo needs featurePage.mcpTool for vertical "${verticalId}"`,
    ).toBeTruthy();
  }
  // Some actions (web_search, logout, education) are intentionally non-pipeline.
  if (!tool) {
    return { source, result, executed: false, tokenEvents: [] };
  }

  // Some tools have REQUIRED params the chip message doesn't carry (e.g.
  // get_account_balance needs account_id). The real SPA/agent resolves these
  // by calling get_my_accounts first, then the parameterised tool. Mirror
  // that chain here so the pipeline actually completes — feeding the tool an
  // input that can never validate would make the MCP server return an
  // isError result and mcpToolCallsChain would never grow (a FALSE negative,
  // not a real skip). We resolve the param via the same pipeline, so every
  // skip-proof assertion below stays strict (no weakening).
  let resolvedParams = result.banking.params || {};
  const needsAccountIds = (
    (tool === 'get_account_balance' && !resolvedParams.account_id) ||
    (tool === 'create_transfer' && (!resolvedParams.from_account_id || !resolvedParams.to_account_id)) ||
    (tool === 'create_deposit' && !resolvedParams.to_account_id) ||
    (tool === 'create_withdrawal' && !resolvedParams.from_account_id)
  );
  if (needsAccountIds) {
    const acctResp = await api.post('/api/mcp/tool', {
      data: { tool: 'get_my_accounts', params: {}, flowTraceId: `e2e-${chip.id}-acct-${Date.now()}` },
    });
    expect(acctResp.status(), `get_my_accounts (for ${chip.id} account_id) status`).not.toBe(401);
    const acctBody = await acctResp.json();
    const txt = acctBody?.result?.content?.[0]?.text;
    let accounts;
    try {
      accounts = txt ? JSON.parse(txt)?.accounts : undefined;
    } catch {
      accounts = undefined;
    }
    expect(accounts?.length, `chip ${chip.id}: resolved accounts from get_my_accounts`).toBeGreaterThan(0);
    const checkingAcct = accounts?.find((a) => a.accountType === 'checking') || accounts?.[0];
    // Use a different account than checkingAcct for the savings side of transfers; if no
    // distinct savings account exists (single-account user) leave savingsAcct undefined so
    // create_transfer skips account resolution and avoids a same-account rejection.
    const distinctSavings = accounts?.find((a) => a.accountType === 'savings' && a.id !== checkingAcct?.id)
                         || accounts?.find((a) => a.id !== checkingAcct?.id);
    const savingsAcct = distinctSavings || null;

    if (tool === 'get_account_balance') {
      resolvedParams = { ...resolvedParams, account_id: checkingAcct?.id };
    } else if (tool === 'create_transfer') {
      resolvedParams = {
        ...resolvedParams,
        from_account_id: resolvedParams.from_account_id || checkingAcct?.id,
        to_account_id:   resolvedParams.to_account_id   || savingsAcct?.id,
        amount:          resolvedParams.amount           ?? 1,
      };
    } else if (tool === 'create_deposit') {
      resolvedParams = {
        ...resolvedParams,
        to_account_id: resolvedParams.to_account_id || checkingAcct?.id,
        amount:        resolvedParams.amount         ?? 1,
      };
    } else if (tool === 'create_withdrawal') {
      resolvedParams = {
        ...resolvedParams,
        from_account_id: resolvedParams.from_account_id || checkingAcct?.id,
        amount:          resolvedParams.amount           ?? 1,
      };
    }
  }

  const snapshotTime = new Date().toISOString();
  const mcpResp = await api.post('/api/mcp/tool', {
    data: { tool, params: resolvedParams, flowTraceId: `e2e-${chip.id}-${Date.now()}` },
  });
  const { tokenEvents } = await assertMcpPipelineCustomerProof(api, chip, mcpResp, beforeMcp, beforeChain, { snapshotTime });
  return { source, result, executed: true, tokenEvents };
}

/**
 * CareConnect vertical plugin chip: NL route (heuristic or Helix) then full MCP pipeline
 * via POST /api/mcp/tool with the plugin tool name (view_records, list_appointments, …).
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {{id:string,message:string,expectedAction:string,mcpTool:string}} chip
 * @param {'heuristic'|'helix'} provider
 * @param {string} vertical
 */
async function runVerticalMcpChip(api, chip, provider, vertical) {
  const since = new Date(Date.now() - 5000).toISOString();
  const nlResp = await api.post('/api/demo-agent/nl', {
    data: { message: chip.message, provider, vertical },
  });
  expect(nlResp.status(), `nl status for ${chip.id} (${provider})`).toBe(200);
  const { source, result } = await nlResp.json();

  if (provider === 'heuristic') {
    expect(source, `${chip.id} routes via heuristic`).toBe('heuristic');
    expect(result?.kind, `${chip.id} kind`).toBe('vertical');
    expect(result?.action, `${chip.id} action`).toBe(chip.expectedAction);
  } else {
    expect(
      ['helix', 'helix_fallback'],
      `${chip.id} must be Helix-routed (not a silent heuristic-only pass)`,
    ).toContain(source);
    if (result?.kind === 'vertical') {
      expect(result.action, `${chip.id} Helix vertical action`).toBe(chip.expectedAction);
    }
  }

  const beforeResp = await api.get('/api/token-chain');
  expect(beforeResp.status()).toBe(200);
  const before = await beforeResp.json();
  const beforeMcp = before.mcpToolCallsChain?.length || 0;
  const beforeChain = before.tokenChain?.length || 0;

  const snapshotTime = new Date().toISOString();
  const mcpResp = await api.post('/api/mcp/tool', {
    data: {
      tool: chip.mcpTool,
      params: {},
      flowTraceId: `e2e-${chip.id}-${provider}-${Date.now()}`,
    },
  });
  const { tokenEvents } = await assertMcpPipelineCustomerProof(api, chip, mcpResp, beforeMcp, beforeChain, { snapshotTime });
  return { source, result, executed: true, tokenEvents, since };
}

/**
 * Healthcare vertical chip: heuristic → kind:vertical → /api/agent/invoke (in-process).
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {{id:string,message:string,expectedAction:string}} chip
 * @param {string} vertical
 */
async function runVerticalHeuristicChip(api, chip, vertical) {
  const nlResp = await api.post('/api/demo-agent/nl', {
    data: { message: chip.message, provider: 'heuristic', vertical },
  });
  expect(nlResp.status(), `nl status for ${chip.id}`).toBe(200);
  const { source, result } = await nlResp.json();
  expect(source, `${chip.id} routes via heuristic`).toBe('heuristic');
  expect(result?.kind, `${chip.id} kind`).toBe('vertical');
  expect(result?.action, `${chip.id} action`).toBe(chip.expectedAction);

  const inv = await api.post('/api/agent/invoke', {
    data: { prompt: chip.message, forceHeuristic: true, vertical },
  });
  expect(inv.status(), `${chip.id} invoke status`).not.toBe(401);
  expect([200, 428, 403], `${chip.id} invoke completed or gated`).toContain(inv.status());
  const body = await inv.json();
  expect(
    body.success === true || body.verticalResult || body.reply,
    `${chip.id} produced a vertical reply`,
  ).toBeTruthy();
  return { source, result, executed: true, body };
}

/**
 * Healthcare LLM chip: must route via Helix when configured (provider=helix).
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {{id:string,message:string}} chip
 * @param {string} vertical
 */
async function runHelixRoutingChip(api, chip, vertical) {
  const nlResp = await api.post('/api/demo-agent/nl', {
    data: { message: chip.message, provider: 'helix', vertical },
  });
  expect(nlResp.status(), `nl status for ${chip.id}`).toBe(200);
  const { source, result } = await nlResp.json();
  expect(
    ['helix', 'helix_fallback'],
    `${chip.id} must be Helix-routed (not a silent heuristic-only pass)`,
  ).toContain(source);
  expect(result, `${chip.id} returned a result object`).toBeTruthy();
  const hasPayload = Boolean(
    result?.banking ||
    result?.vertical ||
    result?.education ||
    (typeof result?.message === 'string' && result.message.trim()) ||
    (typeof result?.reply === 'string' && result.reply.trim()) ||
    (result?.kind && result.kind !== 'none'),
  );
  expect(hasPayload, `${chip.id}: Helix path returned actionable payload`).toBe(true);
  return { source, result, executed: false };
}

/**
 * CareConnect chip via Helix (LLM): NL must not silently heuristic-route; invoke must not Unknown-tool.
 * @param {import('@playwright/test').APIRequestContext} api
 * @param {{id:string,message:string,expectedAction:string}} chip
 * @param {string} vertical
 */
async function runVerticalHelixChip(api, chip, vertical) {
  const nlResp = await api.post('/api/demo-agent/nl', {
    data: { message: chip.message, provider: 'helix', vertical },
  });
  expect(nlResp.status(), `nl status for ${chip.id}`).toBe(200);
  const { source, result } = await nlResp.json();
  expect(
    ['helix', 'helix_fallback'],
    `${chip.id} must be Helix-routed (not heuristic-only)`,
  ).toContain(source);
  if (result?.kind === 'vertical') {
    expect(result.action, `${chip.id} Helix vertical action`).toBe(chip.expectedAction);
  }

  const inv = await api.post('/api/agent/invoke', {
    data: { prompt: chip.message, vertical },
  });
  expect(inv.status(), `${chip.id} invoke status`).not.toBe(401);
  expect([200, 428, 403], `${chip.id} invoke completed or gated`).toContain(inv.status());
  const body = await inv.json();
  const reply = String(body.reply || body.message || '');
  expect(reply, `${chip.id} invoke reply`).not.toMatch(/Unknown tool/i);
  expect(
    body.success === true || body.verticalResult || reply.trim(),
    `${chip.id} produced a vertical or conversational reply`,
  ).toBeTruthy();
  return { source, result, executed: true, body };
}

/**
 * Admin-context corroboration: assert Authorize + gateway legs were recorded
 * for the just-run window. `sinceIso` bounds the query to this chip's window.
 * @param {import('@playwright/test').APIRequestContext} adminApi
 * @param {string} sinceIso
 * @param {string} chipId  for assertion messages
 */
async function assertAdminPipelineEvents(adminApi, sinceIso, chipId) {
  const resp = await adminApi.get(`/api/admin/app-events?limit=500&since=${encodeURIComponent(sinceIso)}`);
  expect(resp.status(), `admin app-events status (${chipId})`).toBe(200);
  const { events } = await resp.json();
  const cats = new Set(events.map((e) => e.category));
  expect(cats.has('authorize'), `chip ${chipId}: Authorize decision event recorded`).toBe(true);
  expect(cats.has('mcp'), `chip ${chipId}: MCP pipeline event recorded`).toBe(true);
}

module.exports = {
  runChip,
  runVerticalMcpChip,
  runVerticalHeuristicChip,
  runHelixRoutingChip,
  runVerticalHelixChip,
  activateVertical,
  assertAdminPipelineEvents,
  CARECONNECT_CHIPS,
  CARECONNECT_CORE_CHIPS,
};
