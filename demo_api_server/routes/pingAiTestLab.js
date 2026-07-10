'use strict';
/**
 * pingAiTestLab.js — Ping AI Test Lab (/api/admin/ping-ai-test-lab)
 *
 * Exercises Ping's AI surface from the BFF and returns structured pass/fail
 * results for four suites:
 *   skills — Ping Agent Skills catalog + connectivity checks
 *   mcp    — live MCP calls (hosted PingOne MCP, demo MCP server, gateway)
 *   agent  — LangChain agent scenarios, one per Agent Skill domain
 *   evals  — ping-bench CIAM eval rows: read-only PingOne Management API checks
 *
 * Pattern follows routes/pingcli.js: everything runnable is defined server-side
 * and addressed by key; the client never supplies executable input.
 *
 * Headless-identity constraint (user requirement): PingOne is exercised ONLY
 * through the CLI, Agent Skills, and MCP servers — never direct Management API
 * calls. Eval checks resolve to read-only tools on the hosted PingOne MCP
 * server (tools/call with a worker token). Checks that would mutate the
 * environment, or have no read-only MCP tool, report not_run — never executed.
 *
 * Auth enforced by authenticateToken at the server.js mount.
 */
const express = require('express');
const http = require('http');
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const configStore = require('../services/configStore');

const router = express.Router();

const PINGCLI_BIN = process.env.PINGCLI_BIN || '/app/bin/pingcli';

const EVAL_ROWS = require('../data/ciamEvalChecks.json').rows;

// ---------------------------------------------------------------------------
// Suite 1 — Agent Skills catalog + connectivity checks
// ---------------------------------------------------------------------------

// The six Ping Identity Agent Skills (developer.pingidentity.com/build-with-ai).
const AGENT_SKILLS = [
  { name: 'ping-quickstart',         purpose: 'Routes requests to the right Ping skill; identifies platform and use case.' },
  { name: 'ping-foundation',         purpose: 'Platform setup, administration, and configuration across PingOne, AIC, and self-managed software.' },
  { name: 'ping-orchestration',      purpose: 'Authentication flow and journey design across DaVinci, AIC journeys, and PingAM trees.' },
  { name: 'ping-universal-services', purpose: 'Shared services configuration: PingOne Protect, Verify, MFA, Credentials, IGA, Authorize.' },
  { name: 'ping-app-integration',    purpose: 'Code-level SDK integration for Android, iOS, React, and JavaScript apps.' },
  { name: 'ping-identity-for-ai',    purpose: 'Securing AI agents and LLM applications using Ping\'s five-pillar architecture.' },
];
const SKILLS_INSTALL = '/plugin marketplace add https://github.com/pingidentity/agent-plugins';

function demoMcpHttpBase() {
  const raw = process.env.MCP_SERVER_URL
    || configStore.getEffective('mcp_server_url')
    || 'ws://localhost:8080';
  return raw.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

async function probeHttp(url, { timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  const resp = await axios.get(url, { timeout: timeoutMs, validateStatus: () => true });
  return { httpStatus: resp.status, latencyMs: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Suite 3 — agent scenarios (one per Agent Skill domain)
// ---------------------------------------------------------------------------

const AGENT_SCENARIOS = [
  {
    key: 'agent_ping_quickstart', skill: 'ping-quickstart',
    prompt: 'Which Ping Identity product would I use to add customer login to a web application? Answer briefly.',
    expect: ['pingone', 'ciam', 'login', 'identity'],
  },
  {
    key: 'agent_ping_foundation', skill: 'ping-foundation',
    prompt: 'What is a PingOne worker application and what is it used for? Answer briefly.',
    expect: ['worker', 'client credentials', 'management', 'api', 'admin'],
  },
  {
    key: 'agent_ping_orchestration', skill: 'ping-orchestration',
    prompt: 'In one short paragraph, what is a PingOne DaVinci flow?',
    expect: ['davinci', 'flow', 'orchestrat', 'authentication', 'no-code'],
  },
  {
    key: 'agent_ping_universal_services', skill: 'ping-universal-services',
    prompt: 'What does PingOne Protect do? Answer briefly.',
    expect: ['risk', 'protect', 'signal', 'fraud', 'threat'],
  },
  {
    key: 'agent_ping_app_integration', skill: 'ping-app-integration',
    prompt: 'Briefly, how does a single-page app sign users in with OIDC Authorization Code flow plus PKCE against PingOne?',
    expect: ['pkce', 'authorization code', 'redirect', 'token', 'code_verifier'],
  },
  {
    key: 'agent_ping_identity_for_ai', skill: 'ping-identity-for-ai',
    prompt: 'Explain briefly how this demo uses RFC 8693 token exchange so the AI agent can access banking data on my behalf.',
    expect: ['token exchange', '8693', 'actor', 'on behalf', 'delegat'],
  },
];

const AGENT_SCENARIO_TIMEOUT_MS = Number(process.env.TESTLAB_AGENT_TIMEOUT_MS) || 60000;

/**
 * Run one message through the LangChain agent (same upstream call as
 * aguiSseProxy) but collect the AG-UI SSE stream server-side into final text.
 */
function collectAgentText({ message, sessionId, authToken }) {
  const agentUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://langchain-agent:8888';
  const body = JSON.stringify({
    message,
    session_id: sessionId,
    auth_token: authToken,
    run_id: `lab_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
  });
  return new Promise((resolve, reject) => {
    const u = new URL(agentUrl);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'text/event-stream',
          'x-internal-gateway-secret': process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me',
        },
      },
      (agentRes) => {
        let buf = '';
        let text = '';
        let events = 0;
        agentRes.setEncoding('utf8');
        agentRes.on('data', (chunk) => {
          buf += chunk;
          let idx = buf.indexOf('\n\n');
          while (idx !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            idx = buf.indexOf('\n\n');
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              events += 1;
              try {
                const evt = JSON.parse(line.slice(5).trim());
                if (evt.type === 'TEXT_MESSAGE_CONTENT' && typeof evt.delta === 'string') text += evt.delta;
                if (evt.type === 'ERROR') reject(new Error(evt.error || evt.message || 'agent stream error'));
              } catch { /* non-JSON frame — ignore */ }
            }
          }
        });
        agentRes.on('end', () => resolve({ text, events, httpStatus: agentRes.statusCode }));
        agentRes.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(AGENT_SCENARIO_TIMEOUT_MS, () => req.destroy(new Error(`agent timed out after ${AGENT_SCENARIO_TIMEOUT_MS}ms`)));
    req.write(body);
    req.end();
  });
}

function gradeScenario(scenario, text) {
  const lower = (text || '').toLowerCase();
  const hits = scenario.expect.filter((kw) => lower.includes(kw.toLowerCase()));
  const pass = hits.length >= 2 && lower.length > 60;
  return { pass, keywordHits: hits, keywordsExpected: scenario.expect };
}

// ---------------------------------------------------------------------------
// Suite 4 — CIAM eval engine (read-only PingOne checks)
// ---------------------------------------------------------------------------

function getPath(obj, dotted) {
  return String(dotted || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function evalCondition(cond, data) {
  switch (cond && cond.type) {
    case 'ok':
      return true; // reaching here means the GET succeeded
    case 'nonEmptyArray': {
      const v = getPath(data, cond.field);
      return Array.isArray(v) && v.length > 0;
    }
    case 'anyItemMatches': {
      const v = getPath(data, cond.field);
      if (!Array.isArray(v)) return false;
      const where = cond.where || {};
      return v.some((item) => Object.entries(where).every(([k, val]) => getPath(item, k) === val));
    }
    case 'fieldTruthy':
      return !!getPath(data, cond.field);
    case 'fieldEquals':
      return getPath(data, cond.field) === cond.value;
    default:
      return false;
  }
}

/**
 * Resolve the read-only hosted-MCP tool that reads the resource an authored
 * check points at. Authored checks name a Management-API-style resource path
 * (e.g. "/populations"); per the headless constraint we never GET it directly —
 * instead we find the PingOne MCP server's list/read tool for that resource.
 */
function resolveMcpToolForPath(path, tools) {
  const resource = String(path || '').replace(/^\//, '').split(/[/?]/)[0];
  if (!resource) return null;
  const plural = resource.toLowerCase();
  const singular = plural.replace(/ies$/, 'y').replace(/s$/, '');
  const isRead = (n) => /^(list|readall|readone|read|get|search)/i.test(n);
  // Only tools whose REQUIRED inputs we can actually supply (environmentId) —
  // otherwise e.g. /signOnPolicies resolves to listApplicationSignOnPolicyAssignments
  // (requires applicationId) and every call dies with -32602.
  const satisfiable = (t) => (t.inputSchema?.required || []).every((p) => p === 'environmentId' || p === 'limit');
  const matches = tools.filter((t) => {
    const n = t.name.toLowerCase();
    return isRead(n) && satisfiable(t) && (n.includes(plural) || n.includes(singular));
  });
  if (!matches.length) return null;
  // Prefer collection reads (list*/readAll*) over single-item reads, and
  // shorter names over longer (e.g. listPopulations over listPopulationUsers).
  matches.sort((a, b) => {
    const rank = (t) => (/^(list|readall)/i.test(t.name) ? 0 : 1);
    return rank(a) - rank(b) || a.name.length - b.name.length;
  });
  return matches[0];
}

/** Extract the JSON body from an MCP tools/call result. */
function mcpResultBody(result) {
  if (result && typeof result.structuredContent === 'object' && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const text = (result?.content || []).find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function evalConditionLenient(cond, body) {
  if (evalCondition(cond, body)) return true;
  if (!cond || !cond.field) return false;
  // MCP tools sometimes unwrap the HAL envelope: retry without "_embedded."
  // and against a bare array body.
  const bare = cond.field.replace(/^_embedded\./, '');
  if (bare !== cond.field && evalCondition({ ...cond, field: bare }, body)) return true;
  // Some tools return the collection as a bare array instead of a HAL envelope.
  if (Array.isArray(body) && (cond.type === 'nonEmptyArray' || cond.type === 'anyItemMatches')) {
    return evalCondition({ ...cond, field: 'items' }, { items: body });
  }
  return false;
}

async function runEvalCheck(check) {
  const run = check.run;
  if (!run || run.kind !== 'api') {
    return { checkId: check.checkId, status: 'not_run', reason: 'manual verification required (not executable as a read-only check)' };
  }
  if ((run.method || 'GET').toUpperCase() !== 'GET') {
    return { checkId: check.checkId, status: 'not_run', reason: 'only read-only checks are executed live' };
  }
  const t0 = Date.now();
  try {
    const { listTools, callTool } = require('../services/mcpPingOneHttpAdapter');
    const tools = await listTools();
    const tool = resolveMcpToolForPath(run.path, tools);
    if (!tool) {
      return {
        checkId: check.checkId,
        status: 'not_run',
        latencyMs: Date.now() - t0,
        reason: `no read-only PingOne MCP tool found for resource ${run.path} (headless policy: no direct Management API calls)`,
      };
    }
    const args = {};
    const props = tool.inputSchema?.properties || {};
    const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID') || '';
    if (props.environmentId) args.environmentId = envId;
    const result = await callTool(tool.name, args);
    if (result && result.isError) {
      const text = (result.content || []).find((c) => c.type === 'text')?.text || 'tool returned isError';
      return { checkId: check.checkId, status: 'fail', latencyMs: Date.now() - t0, mcpTool: tool.name, reason: String(text).slice(0, 300) };
    }
    const body = mcpResultBody(result);
    if (body == null) {
      return { checkId: check.checkId, status: 'fail', latencyMs: Date.now() - t0, mcpTool: tool.name, reason: 'MCP tool returned no parseable JSON body' };
    }
    const pass = evalConditionLenient(run.condition, body);
    return {
      checkId: check.checkId,
      status: pass ? 'pass' : 'fail',
      latencyMs: Date.now() - t0,
      mcpTool: tool.name,
      ...(pass ? {} : { reason: `condition ${run.condition && run.condition.type} not met (via MCP tool ${tool.name})` }),
    };
  } catch (err) {
    return { checkId: check.checkId, status: 'fail', latencyMs: Date.now() - t0, reason: err.message };
  }
}

async function runEvalRow(row) {
  const t0 = Date.now();
  const checks = [];
  for (const check of row.pingone || []) {
    // Sequential within a row — keeps worker-token pressure and rate limits low.
    // eslint-disable-next-line no-await-in-loop
    checks.push(await runEvalCheck(check));
  }
  const ran = checks.filter((c) => c.status === 'pass' || c.status === 'fail');
  const status = ran.length === 0 ? 'not_run' : ran.every((c) => c.status === 'pass') ? 'pass' : 'fail';
  return {
    key: `eval:${row.id}`,
    suite: 'evals',
    label: `${row.id} — ${row.title}`,
    status,
    latencyMs: Date.now() - t0,
    detail: {
      stage: row.stage,
      useCase: row.useCase,
      assignee: row.assignee,
      checks,
      aic: 'not_configured (no AIC tenant in this demo)',
      note: 'Only read-only PingOne checks execute; manual/mutating checks report not_run.',
    },
  };
}

// ---------------------------------------------------------------------------
// Test registry (suites 1–3; suite 4 rows come from EVAL_ROWS)
// ---------------------------------------------------------------------------

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
  // -- skills suite ---------------------------------------------------------
  {
    key: 'skills_catalog', suite: 'skills', label: 'Agent Skills catalog (6 skills)',
    run: async () => ({
      status: 'pass',
      detail: { install: SKILLS_INSTALL, skills: AGENT_SKILLS },
    }),
  },
  {
    key: 'conn_pingcli', suite: 'skills', label: 'PingCLI available (pingcli --version)',
    run: () => new Promise((resolve) => {
      const { execFile } = require('node:child_process');
      execFile(PINGCLI_BIN, ['--version'], { timeout: 10000 }, (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') {
          resolve({ status: 'not_configured', detail: { reason: `pingcli binary not present at ${PINGCLI_BIN} (available inside the Docker BFF image)` } });
        } else if (err) {
          resolve({ status: 'fail', detail: { error: err.message, output: String(stderr || stdout).slice(0, 200) } });
        } else {
          resolve({ status: 'pass', detail: { version: String(stdout).trim().slice(0, 120) } });
        }
      });
    }),
  },
  {
    key: 'conn_pingone_mcp', suite: 'skills', label: 'Hosted PingOne MCP server reachable (tools/list)',
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
    key: 'conn_demo_mcp', suite: 'skills', label: 'Demo MCP server health (:8080)',
    run: async () => {
      const base = demoMcpHttpBase();
      const { httpStatus } = await probeHttp(`${base}/health`);
      return { status: httpStatus === 200 ? 'pass' : 'fail', detail: { url: `${base}/health`, httpStatus } };
    },
  },
  {
    key: 'conn_mcp_gateway', suite: 'skills', label: 'MCP gateway reachable',
    run: async () => {
      const { getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
      const url = getMcpGatewayHttpUrl();
      const { httpStatus } = await probeHttp(url.replace(/\/mcp\/?$/, '') + '/health');
      // Any HTTP answer proves the gateway process is up; /health may 404 on
      // some gateway builds.
      return { status: 'pass', detail: { url, httpStatus } };
    },
  },
  {
    key: 'conn_langchain_agent', suite: 'skills', label: 'LangChain agent reachable',
    run: async () => {
      const agentUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://langchain-agent:8888';
      const { httpStatus } = await probeHttp(`${agentUrl}/health`);
      return { status: 'pass', detail: { url: agentUrl, httpStatus } };
    },
  },
  {
    key: 'conn_agent_docs_llms_txt', suite: 'skills', label: 'Agent-ready docs: llms.txt',
    run: async () => {
      const url = 'https://developer.pingidentity.com/build-with-ai/llms.txt';
      const { httpStatus, latencyMs } = await probeHttp(url, { timeoutMs: 8000 });
      return { status: httpStatus === 200 ? 'pass' : 'fail', detail: { url, httpStatus, latencyMs } };
    },
  },
  {
    key: 'conn_agent_docs_md', suite: 'skills', label: 'Agent-ready docs: docs-for-agents.md',
    run: async () => {
      const url = 'https://developer.pingidentity.com/build-with-ai/docs-for-agents.md';
      const { httpStatus, latencyMs } = await probeHttp(url, { timeoutMs: 8000 });
      return { status: httpStatus === 200 ? 'pass' : 'fail', detail: { url, httpStatus, latencyMs } };
    },
  },
  {
    key: 'conn_aic_mcp', suite: 'skills', label: 'AIC MCP server',
    run: async () => ({
      status: 'not_configured',
      detail: { reason: 'No PingOne Advanced Identity Cloud tenant is configured for this demo; the AIC MCP server ships with the Ping agent-plugins for AIC tenants.' },
    }),
  },
  {
    key: 'conn_davinci_mcp', suite: 'skills', label: 'DaVinci MCP server',
    run: async () => ({
      status: 'not_configured',
      detail: { reason: 'DaVinci MCP server is not wired into this demo; it ships with the Ping agent-plugins for DaVinci flow management.' },
    }),
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
      // Pick a read-only tool by name; never call anything that isn't clearly a read.
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
    key: 'mcp_demo_tool_call', suite: 'mcp', label: 'Demo MCP server tool via RFC 8693 chain (get_my_accounts)',
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
      return {
        status: 'pass',
        detail: {
          gatewayUrl: url,
          decision: gwAuditTrail?.decision || null,
          tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
          contentItems: result?.content?.length ?? 0,
        },
      };
    },
  },

  // -- agent suite ----------------------------------------------------------
  ...AGENT_SCENARIOS.map((scenario) => ({
    key: scenario.key,
    suite: 'agent',
    label: `Agent scenario: ${scenario.skill}`,
    run: async (req) => {
      const { userToken, sessionId } = sessionAuthContext(req);
      if (!userToken) return { status: 'not_run', detail: { reason: NEEDS_SESSION } };
      const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
      let authToken = '';
      try {
        ({ token: authToken } = await resolveMcpAccessTokenWithEvents(req, 'agui_run'));
      } catch (err) {
        return { status: 'not_run', detail: { reason: `token exchange failed: ${err.message}` } };
      }
      const { text, events } = await collectAgentText({ message: scenario.prompt, sessionId, authToken });
      const grade = gradeScenario(scenario, text);
      return {
        status: grade.pass ? 'pass' : 'fail',
        detail: {
          skill: scenario.skill,
          prompt: scenario.prompt,
          responseExcerpt: (text || '').slice(0, 500),
          responseLength: (text || '').length,
          sseEvents: events,
          grading: grade,
          note: 'Heuristic keyword grade — the full LLM-as-judge rubric is applied in the evals report, not here.',
        },
      };
    },
  })),
];

const TESTS_BY_KEY = new Map(TESTS.map((t) => [t.key, t]));
const EVAL_ROWS_BY_ID = new Map(EVAL_ROWS.map((r) => [r.id, r]));

const SUITES = [
  { key: 'skills', label: 'Agent Skills & connectivity', description: 'Ping Agent Skills catalog plus reachability of every AI surface this demo integrates.' },
  { key: 'mcp', label: 'MCP live tests', description: 'Real MCP calls: hosted PingOne MCP server, demo MCP server through the RFC 8693 chain, and the active gateway.' },
  { key: 'agent', label: 'Agent skill scenarios', description: 'One LangChain-agent prompt per Ping Agent Skill domain, graded heuristically.' },
  { key: 'evals', label: 'CIAM evals (ping-bench)', description: 'Deterministic read-only PingOne checks from the AI-First Headless CIAM eval set.' },
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

// Last completed run, kept in memory for export/report generation.
let lastRun = null;

function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /suites — catalog of suites, tests, and eval rows (no execution).
router.get('/suites', (_req, res) => {
  res.json({
    suites: SUITES.map((s) => ({
      ...s,
      tests: s.key === 'evals'
        ? EVAL_ROWS.map((r) => ({
            key: `eval:${r.id}`,
            label: `${r.id} — ${r.title}`,
            stage: r.stage,
            assignee: r.assignee,
            checkCount: (r.pingone || []).length,
            runnableCount: (r.pingone || []).filter((c) => c.run && c.run.kind === 'api').length,
          }))
        : TESTS.filter((t) => t.suite === s.key).map((t) => ({ key: t.key, label: t.label })),
    })),
    evalRowCount: EVAL_ROWS.length,
  });
});

// POST /run { testKey } — run a single test (or eval row via "eval:<id>").
router.post('/run', express.json(), async (req, res) => {
  const { testKey } = req.body || {};
  if (!testKey || typeof testKey !== 'string') {
    return res.status(400).json({ error: 'missing_test_key' });
  }
  if (testKey.startsWith('eval:')) {
    const row = EVAL_ROWS_BY_ID.get(testKey.slice(5));
    if (!row) return res.status(400).json({ error: 'unknown_test', testKey });
    return res.json(await runEvalRow(row));
  }
  const test = TESTS_BY_KEY.get(testKey);
  if (!test) return res.status(400).json({ error: 'unknown_test', testKey });
  res.json(await executeTest(test, req));
});

// GET /run-all?suites=skills,mcp — SSE, one `result` event per test, `done` at end.
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
  send('meta', { suites: active.map((s) => s.key), startedAt, evalRowCount: EVAL_ROWS.length });

  for (const suite of active) {
    if (closed) break;
    if (suite.key === 'evals') {
      // Rows run in small batches; checks within a row stay sequential.
      const BATCH = 4;
      for (let i = 0; i < EVAL_ROWS.length && !closed; i += BATCH) {
        const batch = EVAL_ROWS.slice(i, i + BATCH);
        // eslint-disable-next-line no-await-in-loop
        const rowResults = await Promise.all(batch.map((row) => runEvalRow(row)));
        for (const r of rowResults) { results.push(r); send('result', r); }
      }
    } else {
      for (const test of TESTS.filter((t) => t.suite === suite.key)) {
        if (closed) break;
        // eslint-disable-next-line no-await-in-loop
        const r = await executeTest(test, req);
        results.push(r);
        send('result', r);
      }
    }
  }

  lastRun = {
    startedAt,
    finishedAt: new Date().toISOString(),
    environmentId: process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID') || null,
    suites: active.map((s) => s.key),
    summary: summarize(results),
    results,
  };
  send('done', { summary: lastRun.summary, total: results.length });
  res.end();
});

// GET /results/latest — last completed run (for export / report generation).
router.get('/results/latest', (_req, res) => {
  if (!lastRun) return res.status(404).json({ error: 'no_run_yet' });
  res.json(lastRun);
});

module.exports = router;
