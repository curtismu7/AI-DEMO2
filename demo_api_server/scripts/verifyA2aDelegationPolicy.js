#!/usr/bin/env node
'use strict';
/**
 * verifyA2aDelegationPolicy.js — does the REAL PingOne Authorize policy enforce
 * the claim the A2A demo makes?
 *
 * THE CLAIM
 *
 *   "A nested act chain (act:{specialist → generalist}) bound to the user was
 *    minted, and PingOne Authorize permitted the specialist to run <tool>."
 *
 * ...and, per demoAgentLangGraphService, "the generalist alone is DENIED".
 * The whole point of UC2 is that delegation is REQUIRED — a specialist with a
 * depth-2 chain gets in, the generalist on its own does not.
 *
 * WHY THIS SCRIPT EXISTS
 *
 * On 2026-07-26 the local mock enforced that rule (authz-server Rule 1c) while
 * the REAL decision endpoint did not. Probed directly:
 *
 *     depth-2 sensitive_patient_records  -> PERMIT   (correct)
 *     depth-1 sensitive_patient_records  -> PERMIT   (should be DENY)
 *
 * So routing A2A at real PingOne Authorize would have produced a genuinely real
 * decision that no longer distinguishes delegated from non-delegated access —
 * the control would silently stop existing while looking more legitimate. That
 * is the worst possible trade, and it is invisible unless something asks.
 *
 * Run this the moment the delegation rule is authored, and before flipping A2A
 * to the real engine. READ-ONLY: it evaluates decisions, it never writes policy,
 * grants, or config.
 *
 * Usage:
 *   node demo_api_server/scripts/verifyA2aDelegationPolicy.js
 *   node demo_api_server/scripts/verifyA2aDelegationPolicy.js --vertical healthcare
 *
 * Exit 0 only when every vertical satisfies: depth-2 PERMIT and depth-1 DENY.
 */

const path = require('path');

// demo_api_server/.env is gitignored, so a git WORKTREE does not have one and a
// bare relative path silently loads nothing — dotenv reports "injected env (0)"
// rather than throwing. Derive the main checkout from git (same fix as
// tests/e2e/helpers/repoRoots.js) and fall back to the local path.
function envPath() {
  const local = path.resolve(__dirname, '..', '.env');
  if (require('fs').existsSync(local)) return local;
  try {
    const common = require('child_process')
      .execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    if (common) {
      const candidate = path.join(path.dirname(common), 'demo_api_server', '.env');
      if (require('fs').existsSync(candidate)) return candidate;
    }
  } catch (_) { /* git unavailable */ }
  return local;
}
require('dotenv').config({ path: envPath() });

const { A2A_SPECIALISTS } = require('../config/a2aSpecialists');

const argv = process.argv.slice(2);
const valOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID;
const CLIENT_ID = process.env.PINGONE_WORKER_CLIENT_ID;
const CLIENT_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET;
const REGION = String(process.env.PINGONE_REGION || 'NA').toUpperCase();
// IG's decision endpoint. Env first so a re-provisioned tenant does not need a
// code change; the default is the id observed in the running IG's own logs.
const DECISION_ENDPOINT_ID =
  process.env.PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID
  || process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID
  || '1f9e9c71-9e84-47dd-8f91-54197564930c';

const HOSTS = {
  NA: { auth: 'auth.pingone.com', api: 'api.pingone.com' },
  EU: { auth: 'auth.pingone.eu', api: 'api.pingone.eu' },
  AP: { auth: 'auth.pingone.asia', api: 'api.pingone.asia' },
  CA: { auth: 'auth.pingone.ca', api: 'api.pingone.ca' },
};
const { auth: AUTH_HOST, api: API_HOST } = HOSTS[REGION] || HOSTS.NA;

/** The IG hop's coarse scope + audience — fine-grained authz is the policy's job. */
const GATEWAY_SCOPE = 'gateway:mcp:invoke';
const GATEWAY_AUD = process.env.PINGONE_RESOURCE_PINGGATEWAY_URI || 'https://api.ping.demo:3036/mcp';
/** Stand-in subject; the policy keys on the act chain and tool, not this id. */
const SUBJECT = process.env.A2A_PROBE_SUBJECT || '1aee74ae-3d09-4bcf-a69f-7e1bc225b761';
const GENERALIST = process.env.A2A_PROBE_GENERALIST || '71e878ea-2d79-4760-b570-66f00cbeffe7';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function workerToken() {
  const res = await fetch(`https://${AUTH_HOST}/${ENV_ID}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new Error(`worker token failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 160)}`);
  return body.access_token;
}

/**
 * Evaluate one decision. PingOne rate-limits this endpoint hard (429), and a 429
 * is NOT a verdict — retrying rather than recording it stops a rate limit from
 * being mistaken for a policy answer.
 */
async function decide(token, params, tries = 5) {
  for (let i = 0; i < tries; i += 1) {
    const res = await fetch(`https://${API_HOST}/v1/environments/${ENV_ID}/decisionEndpoints/${DECISION_ENDPOINT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ parameters: params }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 429) {
      return { decision: body.decision || null, status: res.status, body };
    }
    await sleep(3000 * (i + 1));
  }
  return { decision: null, status: 429, body: { code: 'REQUEST_LIMITED' } };
}

function params({ tool, depth, vertical, actClientId }) {
  return {
    DecisionContext: 'McpToolCall',
    McpMethod: 'tools/call',
    // Amount is unconditional, mirroring the PEP (pingOneAuthorizeService sends
    // Amount 0 for reads since the #1310 INDETERMINATE->DENY fix): the live
    // amount-cap comparison returns INDETERMINATE when the operand is absent.
    // Per-rule `extra` overlays override this for write probes.
    Amount: 0,
    TransactionAmount: '0',
    ToolName: tool,
    ClientId: SUBJECT,
    UserId: SUBJECT,
    Vertical: vertical,
    TokenScopes: GATEWAY_SCOPE,
    McpResourceUri: GATEWAY_AUD,
    TokenAudience: GATEWAY_AUD,
    ActChainDepth: String(depth),
    ...(depth >= 2
      ? { ActClientId: actClientId || '', NestedActClientId: GENERALIST, MayActSub: GENERALIST }
      : { ActClientId: GENERALIST }),
  };
}

async function main() {
  for (const [k, v] of [['PINGONE_ENVIRONMENT_ID', ENV_ID], ['PINGONE_WORKER_CLIENT_ID', CLIENT_ID], ['PINGONE_WORKER_CLIENT_SECRET', CLIENT_SECRET]]) {
    if (!v) { console.error(`[a2a-policy] missing ${k} in demo_api_server/.env`); process.exit(1); }
  }

  const only = valOf('--vertical', null);
  const entries = Object.entries(A2A_SPECIALISTS).filter(([vertical]) => !only || vertical === only);
  if (!entries.length) { console.error(`[a2a-policy] no specialist for vertical "${only}"`); process.exit(1); }

  console.log(`[a2a-policy] env=${ENV_ID} decisionEndpoint=${DECISION_ENDPOINT_ID}`);
  console.log('[a2a-policy] contract: depth-2 (specialist) PERMIT, depth-1 (generalist alone) DENY\n');

  const token = await workerToken();

  // Control. If this is not PERMIT the endpoint is not answering normally, and
  // every DENY below would be meaningless agreement rather than enforcement.
  const control = await decide(token, params({ tool: 'get_my_accounts', depth: 1, vertical: 'banking' }));
  console.log(`  control   get_my_accounts depth-1 -> ${control.decision || `HTTP ${control.status}`}`);
  if (control.decision !== 'PERMIT') {
    console.error('\n[a2a-policy] ABORT — the control probe did not PERMIT, so this endpoint is not evaluating normally.');
    console.error('             Nothing below would be trustworthy. Check the decision endpoint id and worker role.');
    process.exit(1);
  }
  console.log('');

  const rows = [];
  for (const [vertical, cfg] of entries) {
    const tool = (cfg.tools || [])[0];
    if (!tool) continue;
    const actClientId = process.env[`PINGONE_A2A_${String(cfg.appKey).toUpperCase()}_AGENT_CLIENT_ID`] || '';

    await sleep(1200);
    const d2 = await decide(token, params({ tool, depth: 2, vertical, actClientId }));
    await sleep(1200);
    const d1 = await decide(token, params({ tool, depth: 1, vertical }));

    const ok = d2.decision === 'PERMIT' && d1.decision === 'DENY';
    rows.push({ vertical, tool, d2: d2.decision, d1: d1.decision, ok });
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'}  ${vertical.padEnd(15)} ${tool.padEnd(30)} depth2=${String(d2.decision)} depth1=${String(d1.decision)}`,
    );
  }

  const bad = rows.filter((r) => !r.ok);
  console.log('');
  if (!bad.length) {
    console.log(`[a2a-policy] PASS — ${rows.length}/${rows.length} enforce delegation. Safe to point A2A at the real engine.`);
    process.exit(0);
  }

  const permitsUndelegated = bad.filter((r) => r.d1 === 'PERMIT');
  console.log(`[a2a-policy] FAIL — ${bad.length} of ${rows.length} do not enforce delegation.`);
  if (permitsUndelegated.length) {
    console.log('');
    console.log('  The real policy PERMITS the generalist acting ALONE on:');
    for (const r of permitsUndelegated) console.log(`      ${r.vertical}/${r.tool}`);
    console.log('');
    console.log('  UC2 claims the opposite — that delegation is REQUIRED and the generalist is');
    console.log('  denied. Until a rule DENIES ActChainDepth < 2 for these tools, switching A2A');
    console.log('  to the real engine removes the control while making it look more legitimate.');
    console.log('  The local mock (authz-server Rule 1c) does enforce it, which is why the demo');
    console.log('  works today.');
  }
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => { console.error('[a2a-policy] failed:', err.message); process.exit(1); });
}

module.exports = { decide, params, workerToken };
