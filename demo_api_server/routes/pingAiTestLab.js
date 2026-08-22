'use strict';
/**
 * pingAiTestLab.js — Ping AI Test Lab (/api/admin/ping-ai-test-lab)
 *
 * Demo readiness checks — prove the live banking demo stack is up and the
 * launcher paths work. Three suites:
 *   stack    — process reachability (PingCLI, MCP servers, gateway, agent)
 *   mcp      — live MCP tool calls (PingOne MCP, demo MCP via RFC 8693, gateway)
 *   usecases — launcher use cases (UC1 PERMIT + attack-sim DENY; no LLM)
 *
 * Pattern follows routes/pingcli.js: everything runnable is defined server-side
 * and addressed by key; the client never supplies executable input.
 *
 * Auth enforced by authenticateToken at the server.js mount.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const configStore = require('../services/configStore');

const router = express.Router();

// Same resolution as routes/pingcli.js: /app/bin is often the repo's macOS
// Mach-O binary via the Docker bind mount and cannot exec in Linux pods.
const PINGCLI_BIN =
  process.env.PINGCLI_BIN ||
  (fs.existsSync('/usr/local/bin/pingcli')
    ? '/usr/local/bin/pingcli'
    : path.join(__dirname, '..', 'bin', 'pingcli'));

function demoMcpHttpBase() {
  const raw = process.env.MCP_SERVER_URL
    || configStore.getEffective('mcp_server_url')
    || 'ws://localhost:8080';
  return raw.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

async function probeHttp(url, { timeoutMs = 5000, headers = undefined } = {}) {
  const t0 = Date.now();
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    validateStatus: () => true,
    ...(headers ? { headers } : {}),
  });
  return { httpStatus: resp.status, latencyMs: Date.now() - t0 };
}

/** Dedicated health port for the LangChain process (AG-UI /run on :8888 is secret-gated). */
function langchainHealthUrl() {
  if (process.env.LANGCHAIN_AGENT_HEALTH_URL) {
    return process.env.LANGCHAIN_AGENT_HEALTH_URL.replace(/\/$/, '');
  }
  const runUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://langchain-agent:8888';
  const healthPort = process.env.HEALTH_HTTP_PORT || '8890';
  try {
    const u = new URL(runUrl);
    u.port = healthPort;
    u.pathname = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return `http://langchain-agent:${healthPort}`;
  }
}

/** Tag the request so bffMcpToolExecutor / token-chain stamp the catalog slug. */
function withUseCaseId(req, useCaseId) {
  req.body = { ...(req.body || {}), useCaseId };
  return req;
}

/**
 * PERMIT path: run a banking read tool through the BFF RFC 8693 chain.
 * Mirrors UC1 ("Delegated access with proof") — expectedOutcome PERMIT.
 */
async function runUseCasePermitTool(req, { useCaseId, tool }) {
  const { userToken, userId, sessionId } = sessionAuthContext(req);
  if (!userToken) return { status: 'not_run', detail: { reason: NEEDS_SESSION, useCaseId } };
  withUseCaseId(req, useCaseId);
  const { executeBffTool } = require('../services/bffMcpToolExecutor');
  const tokenEvents = [];
  const raw = await executeBffTool({
    name: tool, args: {}, userId, userToken, req, tokenEvents, sessionId,
  });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  const failed = parsed && typeof parsed === 'object' && (parsed.error || parsed.isError);
  const chainIds = tokenEvents.map((e) => e.id);
  const hasExchange = chainIds.some((id) => /exchange|exchanged|mcp|actor/i.test(id || ''));
  return {
    status: failed ? 'fail' : 'pass',
    detail: {
      useCaseId,
      expectedOutcome: 'PERMIT',
      tool,
      tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
      hasTokenExchangeEvidence: hasExchange,
      resultPreview: typeof raw === 'string' ? raw.slice(0, 400) : raw,
      ...(failed ? { reason: parsed.error || parsed.message || 'tool returned error' } : {}),
    },
  };
}

/**
 * DENY path: run a catalog attack sim; pass when the gateway rejects as expected.
 */
async function runUseCaseDenySim(req, { useCaseId, sim, acceptStatuses = [401, 403] }) {
  const { userToken } = sessionAuthContext(req);
  if (!userToken) return { status: 'not_run', detail: { reason: NEEDS_SESSION, useCaseId, sim } };
  const { runAttackSim } = require('../services/attackSimulatorService');
  const result = await runAttackSim(sim, req);
  if (result.errorCode === 'no_session_token') {
    return { status: 'not_run', detail: { reason: NEEDS_SESSION, useCaseId, sim } };
  }
  if (result.errorCode === 'gateway_not_configured' || result.errorCode === 'wrong_aud_not_configured') {
    return {
      status: 'not_configured',
      detail: { useCaseId, sim, reason: result.reason, errorCode: result.errorCode },
    };
  }
  // unexpected_permit means enforcement did not fire — that is a real fail.
  const denied = acceptStatuses.includes(result.status) && result.errorCode !== 'unexpected_permit';
  return {
    status: denied ? 'pass' : 'fail',
    detail: {
      useCaseId,
      expectedOutcome: 'DENY',
      sim,
      httpStatus: result.status,
      errorCode: result.errorCode,
      reason: result.reason,
      tokenChain: (result.tokenChainEvents || []).map((e) => ({
        id: e.id, label: e.label, status: e.status,
      })),
      ...(denied ? {} : { failReason: result.errorCode === 'unexpected_permit'
        ? 'gateway permitted the attack — enforcement may be off'
        : `expected DENY (${acceptStatuses.join('/')}), got ${result.status} ${result.errorCode || ''}` }),
    },
  };
}

function sessionAuthContext(req) {
  const userToken = req.session?.oauthTokens?.accessToken || '';
  return {
    userToken,
    userId: req.session?.user?.id || req.user?.id || null,
    sessionId: req.sessionID || req.session?.id || '',
  };
}

const NEEDS_SESSION = 'requires a signed-in user session with OAuth tokens (open this page from a logged-in browser session)';

const TESTS = [
  // -- stack suite (demo process health) ------------------------------------
  {
    key: 'conn_pingcli', suite: 'stack', label: 'PingCLI available (pingcli --version)',
    run: () => new Promise((resolve) => {
      const { execFile } = require('node:child_process');
      execFile(PINGCLI_BIN, ['--version'], { timeout: 10000 }, (err, stdout, stderr) => {
        // ENOENT / ENOEXEC / UV "Unknown system error -8" / Exec format error
        // mean missing binary or wrong arch (macOS Mach-O on Linux) — not a fail.
        const spawnCode = err && err.code;
        const errText = `${err?.message || ''} ${stderr || ''} ${stdout || ''}`;
        const missing = !err ? false
          : spawnCode === 'ENOENT'
            || spawnCode === 'ENOEXEC'
            || spawnCode === 'EACCES'
            || /Unknown system error -8/i.test(errText)
            || /Exec format error/i.test(errText)
            || /cannot execute binary file/i.test(errText)
            || /not found/i.test(err?.message || '');
        if (missing) {
          resolve({
            status: 'not_configured',
            detail: {
              reason: `pingcli binary not available at ${PINGCLI_BIN} (use image /usr/local/bin/pingcli; /app/bin is often a macOS Mach-O)`,
              bin: PINGCLI_BIN,
              error: err.message,
            },
          });
        } else if (err) {
          resolve({
            status: 'fail',
            detail: { bin: PINGCLI_BIN, error: err.message, output: String(stderr || stdout).slice(0, 200) },
          });
        } else {
          resolve({
            status: 'pass',
            detail: { bin: PINGCLI_BIN, version: String(stdout).trim().slice(0, 120) },
          });
        }
      });
    }),
  },
  {
    key: 'conn_pingone_mcp', suite: 'stack', label: 'Hosted PingOne MCP server reachable (tools/list)',
    run: async () => {
      const { listTools } = require('../services/mcpPingOneHttpAdapter');
      const tools = await listTools();
      return {
        status: tools.length > 0 ? 'pass' : 'fail',
        detail: { toolCount: tools.length },
      };
    },
  },
  {
    key: 'conn_demo_mcp', suite: 'stack', label: 'Demo MCP server health',
    run: async () => {
      const base = demoMcpHttpBase();
      const { httpStatus } = await probeHttp(`${base}/health`);
      return { status: httpStatus === 200 ? 'pass' : 'fail', detail: { url: `${base}/health`, httpStatus } };
    },
  },
  {
    key: 'conn_mcp_gateway', suite: 'stack', label: 'MCP gateway reachable',
    run: async () => {
      const { getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
      const url = getMcpGatewayHttpUrl();
      const healthUrl = url.replace(/\/mcp\/?$/, '') + '/health';
      try {
        const { httpStatus } = await probeHttp(healthUrl);
        // Any HTTP answer proves the gateway process is up; /health may 404 on some builds.
        return { status: 'pass', detail: { url, healthUrl, httpStatus } };
      } catch (err) {
        return { status: 'fail', detail: { url, healthUrl, error: err.message } };
      }
    },
  },
  {
    key: 'conn_langchain_agent', suite: 'stack', label: 'LangChain agent reachable',
    run: async () => {
      // Prefer the ungated health server (:8890). Probing AG-UI :8888 /health
      // without the internal secret returns 401 and previously was mis-scored as pass.
      const healthBase = langchainHealthUrl();
      const runUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://langchain-agent:8888';
      let { httpStatus } = await probeHttp(`${healthBase}/health`);
      let probed = `${healthBase}/health`;
      if (httpStatus !== 200) {
        const secret = process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';
        ({ httpStatus } = await probeHttp(`${runUrl}/health`, {
          headers: { 'x-internal-gateway-secret': secret },
        }));
        probed = `${runUrl}/health`;
      }
      return {
        status: httpStatus === 200 ? 'pass' : 'fail',
        detail: { url: probed, runUrl, httpStatus },
      };
    },
  },

  // -- mcp suite ------------------------------------------------------------
  {
    key: 'mcp_pingone_tools_list', suite: 'mcp', label: 'PingOne MCP tools/list',
    run: async () => {
      const { listTools } = require('../services/mcpPingOneHttpAdapter');
      const tools = await listTools();
      return {
        status: tools.length > 0 ? 'pass' : 'fail',
        detail: { toolCount: tools.length, sample: tools.slice(0, 8).map((t) => t.name) },
      };
    },
  },
  {
    key: 'mcp_pingone_read_call', suite: 'mcp', label: 'PingOne MCP tools/call (read-only tool)',
    run: async () => {
      const { listTools, callTool } = require('../services/mcpPingOneHttpAdapter');
      const tools = await listTools();
      const tool = tools.find((t) => /^(list|get|read|search)/i.test(t.name));
      if (!tool) return { status: 'not_run', detail: { reason: 'no read-only (list*/get*) tool exposed for this worker\'s roles' } };
      const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID') || '';
      const args = {};
      const props = tool.inputSchema?.properties || {};
      if (props.environmentId) args.environmentId = envId;
      if (props.limit) args.limit = 5;
      const result = await callTool(tool.name, args);
      return {
        status: result && !result.isError ? 'pass' : 'fail',
        detail: { tool: tool.name, args, isError: !!(result && result.isError), contentItems: result?.content?.length ?? 0 },
      };
    },
  },
  {
    key: 'mcp_demo_tool_call', suite: 'mcp', label: 'Demo MCP tool via RFC 8693 (get_my_accounts)',
    run: async (req) => {
      const { userToken, userId, sessionId } = sessionAuthContext(req);
      if (!userToken) return { status: 'not_run', detail: { reason: NEEDS_SESSION } };
      const { executeBffTool } = require('../services/bffMcpToolExecutor');
      const tokenEvents = [];
      const raw = await executeBffTool({ name: 'get_my_accounts', args: {}, userId, userToken, req, tokenEvents, sessionId });
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      const failed = parsed && typeof parsed === 'object' && (parsed.error || parsed.isError);
      return {
        status: failed ? 'fail' : 'pass',
        detail: {
          tool: 'get_my_accounts',
          tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
          resultPreview: typeof raw === 'string' ? raw.slice(0, 400) : raw,
        },
      };
    },
  },
  {
    key: 'mcp_gateway_tool_call', suite: 'mcp', label: 'Tool call through active MCP gateway',
    run: async (req) => {
      const { callToolViaGateway, getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
      const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
      const { userToken } = sessionAuthContext(req);
      if (!userToken) return { status: 'not_run', detail: { reason: NEEDS_SESSION } };
      const url = getMcpGatewayHttpUrl();
      const { token, tokenEvents = [] } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
      if (!token) return { status: 'not_run', detail: { reason: 'token exchange produced no MCP token for this session' } };
      const { result, gwAuditTrail } = await callToolViaGateway(url, token, 'get_my_accounts', {}, { correlationId: req.correlationId });
      const decision = (gwAuditTrail?.decision || '').toUpperCase();
      const failed = !result || result.isError || (decision && decision !== 'PERMIT');
      return {
        status: failed ? 'fail' : 'pass',
        detail: {
          gatewayUrl: url,
          decision: gwAuditTrail?.decision || null,
          tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
          contentItems: result?.content?.length ?? 0,
        },
      };
    },
  },

  // -- usecases suite (demo launcher paths; no LLM) -------------------------
  {
    key: 'uc1_delegated_balance',
    suite: 'usecases',
    label: 'UC1 — Delegated access with proof (get_account_balance)',
    run: (req) => runUseCasePermitTool(req, {
      useCaseId: 'delegated-access-with-proof',
      tool: 'get_account_balance',
    }),
  },
  {
    key: 'uc1_gateway_accounts',
    suite: 'usecases',
    label: 'UC1 — Gateway PERMIT (get_my_accounts via MCP gateway)',
    run: async (req) => {
      const { userToken } = sessionAuthContext(req);
      if (!userToken) return { status: 'not_run', detail: { reason: NEEDS_SESSION, useCaseId: 'delegated-access-with-proof' } };
      withUseCaseId(req, 'delegated-access-with-proof');
      const { callToolViaGateway, getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
      const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
      const url = getMcpGatewayHttpUrl();
      const { token, tokenEvents = [] } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
      if (!token) {
        return { status: 'not_run', detail: { reason: 'token exchange produced no MCP token', useCaseId: 'delegated-access-with-proof' } };
      }
      const { result, gwAuditTrail } = await callToolViaGateway(
        url, token, 'get_my_accounts', {}, { correlationId: req.correlationId },
      );
      const decision = (gwAuditTrail?.decision || '').toUpperCase();
      const failed = !result || result.isError || (decision && decision !== 'PERMIT');
      return {
        status: failed ? 'fail' : 'pass',
        detail: {
          useCaseId: 'delegated-access-with-proof',
          expectedOutcome: 'PERMIT',
          tool: 'get_my_accounts',
          gatewayUrl: url,
          decision: gwAuditTrail?.decision || null,
          tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
          contentItems: result?.content?.length ?? 0,
        },
      };
    },
  },
  {
    key: 'uc5_insufficient_scope',
    suite: 'usecases',
    label: 'UC5 — Wrong / insufficient scope (gateway DENY)',
    run: (req) => runUseCaseDenySim(req, {
      useCaseId: 'insufficient-scope',
      sim: 'insufficient-scope',
    }),
  },
  {
    key: 'uc12_token_replay',
    suite: 'usecases',
    label: 'UC12 — Token theft / replay defense (gateway DENY)',
    run: (req) => runUseCaseDenySim(req, {
      useCaseId: 'token-theft-replay',
      sim: 'replayed-token',
    }),
  },
  {
    key: 'uc13_rogue_actor',
    suite: 'usecases',
    label: 'UC13 — Confused-deputy actor injection (gateway DENY)',
    run: (req) => runUseCaseDenySim(req, {
      useCaseId: 'confused-deputy-actor-injection',
      sim: 'rogue-actor',
    }),
  },
  {
    key: 'uc16_impersonation_no_act',
    suite: 'usecases',
    label: 'UC16 — Impersonation block / no-act (gateway DENY)',
    run: (req) => runUseCaseDenySim(req, {
      useCaseId: 'impersonation-blocked',
      sim: 'impersonation-no-act',
    }),
  },
];

const TESTS_BY_KEY = new Map(TESTS.map((t) => [t.key, t]));

const SUITES = [
  {
    key: 'stack',
    label: 'Demo stack health',
    description: 'Are the processes this demo needs reachable? PingCLI, PingOne MCP, demo MCP, gateway, LangChain agent.',
  },
  {
    key: 'mcp',
    label: 'Live MCP paths',
    description: 'Real tool calls: hosted PingOne MCP, demo banking MCP through RFC 8693, and the active gateway PERMIT path.',
  },
  {
    key: 'usecases',
    label: 'Demo use cases',
    description: 'Launcher paths that prove the live demo: UC1 PERMIT (delegated tools) and attack-sim DENYs (UC5/12/13/16). No LLM.',
  },
];

async function executeTest(test, req) {
  const t0 = Date.now();
  try {
    const out = await test.run(req);
    return { key: test.key, suite: test.suite, label: test.label, latencyMs: Date.now() - t0, ...out };
  } catch (err) {
    return { key: test.key, suite: test.suite, label: test.label, status: 'fail', latencyMs: Date.now() - t0, detail: { error: err.message } };
  }
}

// Last completed run per user, kept in memory for export/report generation.
// Keyed (not a single shared value) because the mount only requires
// authenticateToken — any signed-in user, not just admins — so two people
// running this concurrently used to see each other's PingOne connectivity
// and test results.
const lastRunByUser = new Map();
function _userKey(req) {
  return String(req.session?.user?.id || req.user?.id || 'anonymous');
}

function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /suites — catalog of suites and tests (no execution).
router.get('/suites', (_req, res) => {
  res.json({
    suites: SUITES.map((s) => ({
      ...s,
      tests: TESTS.filter((t) => t.suite === s.key).map((t) => ({ key: t.key, label: t.label })),
    })),
  });
});

// POST /run { testKey } — run a single allow-listed test.
router.post('/run', express.json(), async (req, res) => {
  const { testKey } = req.body || {};
  if (!testKey || typeof testKey !== 'string') {
    return res.status(400).json({ error: 'missing_test_key' });
  }
  const test = TESTS_BY_KEY.get(testKey);
  if (!test) return res.status(400).json({ error: 'unknown_test', testKey });
  res.json(await executeTest(test, req));
});

// GET /run-all?suites=stack,mcp — SSE, one `result` event per test, `done` at end.
router.get('/run-all', async (req, res) => {
  const requested = String(req.query.suites || '').split(',').map((s) => s.trim()).filter(Boolean);
  const active = requested.length ? SUITES.filter((s) => requested.includes(s.key)) : SUITES;
  if (!active.length) return res.status(400).json({ error: 'unknown_suites' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  const results = [];
  const startedAt = new Date().toISOString();
  send('meta', { suites: active.map((s) => s.key), startedAt });

  for (const suite of active) {
    if (closed) break;
    for (const test of TESTS.filter((t) => t.suite === suite.key)) {
      if (closed) break;
      // eslint-disable-next-line no-await-in-loop
      const r = await executeTest(test, req);
      results.push(r);
      send('result', r);
    }
  }

  const lastRun = {
    startedAt,
    finishedAt: new Date().toISOString(),
    environmentId: process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID') || null,
    suites: active.map((s) => s.key),
    summary: summarize(results),
    results,
  };
  lastRunByUser.set(_userKey(req), lastRun);
  send('done', { summary: lastRun.summary, total: results.length });
  res.end();
});

// GET /results/latest — last completed run (for export / report generation).
router.get('/results/latest', (req, res) => {
  const lastRun = lastRunByUser.get(_userKey(req));
  if (!lastRun) return res.status(404).json({ error: 'no_run_yet' });
  res.json(lastRun);
});

module.exports = router;
