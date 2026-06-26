#!/usr/bin/env node
'use strict';
/**
 * Rerun CareConnect core-chip pipeline and print agent/MCP replies,
 * token exchange events, and Authorize rules + admin app-events.
 *
 * Usage:
 *   cd demo_api_ui && E2E_BASE_URL=https://demo-api-server:3001 node tests/e2e/scripts/careconnect-pipeline-trace.js
 *   E2E_VERTICAL=retail E2E_BASE_URL=https://demo-api-server:3001 node tests/e2e/scripts/careconnect-pipeline-trace.js
 */
const path = require('path');
const fs = require('fs');
const { chromium, request: playwrightRequest } = require('@playwright/test');

const envFile = path.join(__dirname, '../.env.e2e');
if (fs.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
}

const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
  waitForE2eBaseUrl,
} = require('../helpers/realLogin');
const { activateVertical } = require('../helpers/chipPipeline');
const {
  getVerticalCoreChips,
  resolveE2eVerticalId,
} = require('../helpers/verticalCoreChips');

const BASE_URL =
  process.env.E2E_BASE_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'https://demo-api-server:3001';
const VERTICAL = resolveE2eVerticalId();
const CORE_CHIPS = getVerticalCoreChips(VERTICAL);

function summarizeTokenEvent(e) {
  const claims = e?.claims || {};
  return {
    label: e?.label,
    explanation: e?.explanation,
    aud: claims.aud || claims.audience,
    scope: claims.scope,
    sub: claims.sub,
    client_id: claims.client_id,
    act: claims.act ? { sub: claims.act?.sub } : undefined,
    exp: claims.exp,
  };
}

function mcpResultText(body) {
  const content = body?.result?.content;
  if (Array.isArray(content) && content[0]?.text) {
    try {
      const parsed = JSON.parse(content[0].text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content[0].text;
    }
  }
  if (body?.result?.structuredContent) {
    return JSON.stringify(body.result.structuredContent, null, 2);
  }
  if (body?.reply) return body.reply;
  return JSON.stringify(body?.result || body, null, 2);
}

function filterAuthorizeEvents(events) {
  return events.filter(
    (e) =>
      e.category === 'authorize' ||
      /authoriz/i.test(e.tag || '') ||
      /authoriz/i.test(e.message || ''),
  );
}

async function traceChip(customerApi, adminApi, chip, provider) {
  const since = new Date(Date.now() - 3000).toISOString();

  const nlResp = await customerApi.post('/api/demo-agent/nl', {
    data: { message: chip.message, provider, vertical: VERTICAL },
  });
  const nlBody = nlResp.ok() ? await nlResp.json() : { error: nlResp.status() };

  const invResp = await customerApi.post('/api/agent/invoke', {
    data: { prompt: chip.message, vertical: VERTICAL },
  });
  const invBody = invResp.ok() ? await invResp.json() : await invResp.text();

  const mcpResp = await customerApi.post('/api/mcp/tool', {
    data: {
      tool: chip.mcpTool,
      params: {},
      flowTraceId: `trace-${chip.id}-${provider}-${Date.now()}`,
    },
  });
  const mcpBody = mcpResp.ok() ? await mcpResp.json() : { error: mcpResp.status() };

  const chainResp = await customerApi.get('/api/token-chain');
  const tokenChain = chainResp.ok() ? await chainResp.json() : {};

  const eventsResp = await adminApi.get(
    `/api/admin/app-events?limit=200&since=${encodeURIComponent(since)}`,
  );
  const appEvents = eventsResp.ok() ? (await eventsResp.json()).events || [] : [];

  return {
    chip: chip.label,
    message: chip.message,
    provider,
    mcpTool: chip.mcpTool,
    nl: { status: nlResp.status(), source: nlBody.source, result: nlBody.result },
    agentInvoke: {
      status: invResp.status(),
      reply: typeof invBody === 'object' ? invBody.reply : invBody,
      success: typeof invBody === 'object' ? invBody.success : undefined,
      agentPath: typeof invBody === 'object' ? invBody.agentPath : undefined,
      toolsCalled: typeof invBody === 'object' ? invBody.toolsCalled : undefined,
    },
    mcpToolCall: {
      status: mcpResp.status(),
      authorizeDecision: mcpBody.authorizeDecision,
      toolResultPreview: mcpResultText(mcpBody).slice(0, 4000),
      tokenEvents: (mcpBody.tokenEvents || []).map(summarizeTokenEvent),
    },
    tokenChainSummary: {
      tokenChainSteps: (tokenChain.tokenChain || []).slice(-8).map((s) => ({
        label: s.label,
        status: s.status,
        aud: s.claims?.aud,
      })),
      lastMcpCall: (tokenChain.mcpToolCallsChain || []).slice(-1)[0],
    },
    authorizeAppEvents: filterAuthorizeEvents(appEvents).map((e) => ({
      at: e.timestamp || e.at,
      category: e.category,
      tag: e.tag,
      message: e.message,
      metadata: e.metadata,
    })),
    mcpAppEvents: appEvents
      .filter((e) => e.category === 'mcp' || e.category === 'gateway_path')
      .slice(-5)
      .map((e) => ({
        at: e.timestamp || e.at,
        category: e.category,
        tag: e.tag,
        message: e.message,
      })),
  };
}

async function main() {
  if (!requireRealLoginEnv() || !requireAdminLoginEnv()) {
    console.error('Missing E2E_CUSTOMER_* or E2E_ADMIN_* in tests/e2e/.env.e2e');
    process.exit(1);
  }

  const probe = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });
  await waitForE2eBaseUrl(probe);
  await probe.dispose();

  const rulesResp = await playwrightRequest.newContext({
    baseURL: BASE_URL.replace(/:4000$/, ':3001').replace(/\/$/, '') || 'https://api.ping.demo:3001',
    ignoreHTTPSErrors: true,
  });
  let authorizeRules = {};
  try {
    const bffBase = BASE_URL.includes(':4000')
      ? BASE_URL.replace(':4000', ':3001')
      : 'https://api.ping.demo:3001';
    const r = await rulesResp.get(`${bffBase}/api/authorize/rules`);
    authorizeRules = r.ok() ? await r.json() : { error: r.status() };
  } catch (err) {
    authorizeRules = { error: err.message };
  }
  await rulesResp.dispose();

  const browser = await chromium.launch({ headless: true });
  const customerCtx = await browser.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });
  const adminCtx = await browser.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });

  const cPage = await customerCtx.newPage();
  await loginAsCustomer(cPage);
  const customerApi = customerCtx.request;

  const aPage = await adminCtx.newPage();
  await loginAsAdmin(aPage);
  const adminApi = adminCtx.request;

  await activateVertical(customerApi, VERTICAL);

  const report = {
    baseUrl: BASE_URL,
    vertical: VERTICAL,
    authorizeRules,
    scenarios: [],
  };

  for (const chip of CORE_CHIPS) {
    for (const provider of ['heuristic', 'helix']) {
      console.error(`Tracing ${chip.label} (${provider})…`);
      report.scenarios.push(await traceChip(customerApi, adminApi, chip, provider));
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  await activateVertical(customerApi, 'banking').catch(() => {});
  await browser.close();

  const outPath = '/tmp/careconnect-pipeline-report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n========== AUTHORIZE RULES (GET /api/authorize/rules) ==========\n');
  console.log(JSON.stringify(authorizeRules, null, 2));

  for (const s of report.scenarios) {
    console.log('\n' + '='.repeat(72));
    console.log(`${s.chip} — ${s.provider.toUpperCase()} (tool: ${s.mcpTool})`);
    console.log('='.repeat(72));
    console.log('\n--- NL routing ---');
    console.log(JSON.stringify(s.nl, null, 2));
    console.log('\n--- Agent invoke reply ---');
    console.log(JSON.stringify(s.agentInvoke, null, 2));
    console.log('\n--- MCP tool result (pipeline) ---');
    console.log(`HTTP ${s.mcpToolCall.status}`);
    if (s.mcpToolCall.authorizeDecision) {
      console.log('authorizeDecision:', JSON.stringify(s.mcpToolCall.authorizeDecision, null, 2));
    }
    console.log(s.mcpToolCall.toolResultPreview);
    console.log('\n--- Token exchanges (from mcp/tool tokenEvents) ---');
    console.log(JSON.stringify(s.mcpToolCall.tokenEvents, null, 2));
    console.log('\n--- Token chain (last steps) ---');
    console.log(JSON.stringify(s.tokenChainSummary, null, 2));
    console.log('\n--- Authorize app-events (admin) ---');
    console.log(
      s.authorizeAppEvents.length
        ? JSON.stringify(s.authorizeAppEvents, null, 2)
        : '(no authorize-category events in window — check simulated engine logs or mcpToolCall.authorizeDecision)',
    );
    if (s.mcpAppEvents.length) {
      console.log('\n--- MCP / gateway app-events ---');
      console.log(JSON.stringify(s.mcpAppEvents, null, 2));
    }
  }

  console.log(`\nFull JSON report: ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
