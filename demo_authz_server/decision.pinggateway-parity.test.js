'use strict';

/**
 * decision.pinggateway-parity.test.js
 *
 * Proves the mock authz-server decision route consumes the EXACT 18-key payload
 * that PingGateway's p1az-decision.groovy emits (parity with the Node gateway's
 * buildAuthorizeParameters), and returns PERMIT for an allowed call and DENY for a
 * denied one. This is the authz-server-parity gate for the PingGateway path: the
 * Groovy filter is the new authorize caller, and the mock already accepts what it
 * sends — no mock change required.
 *
 * The 18 keys are the full base set from
 * demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts buildAuthorizeParameters().
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The two identities the gateway answers to, and the comma-joined form k8s
// produces for MCP_GW_RESOURCE_URI. Hoisted so a URI appears exactly once —
// these are repeated across most assertions below.
const GATEWAY_AUD = 'mcpgateway.ping.demo';                 // PG_GATEWAY_RESOURCE_URI (short name)
const GATEWAY_ID  = 'https://api.ping.demo:3036/mcp';       // PG_GATEWAY_RESOURCE_ID (uri)
const BOTH_AUDS   = `${GATEWAY_AUD},${GATEWAY_ID}`;
const FOREIGN_AUD = 'https://evil.example/mcp';

let OVERLAY;
let decisionHandler;
let userLookup;

function fresh() {
  for (const m of ['./ruleStore', './pingOneUserLookup', './routes/decision']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  userLookup = require('./pingOneUserLookup');
  mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  decisionHandler = require('./routes/decision');
}

function makeRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

// The full 18-key payload the Groovy filter emits (same keys + order as
// buildAuthorizeParameters). Override individual keys per case.
function groovyParams(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    DecisionContext:   'McpToolCall',
    McpMethod:         'tools/call',
    ToolName:          'create_transfer',
    ClientId:          'user-1',
    ActClientId:       'agent-1',
    ActChainDepth:     '0',
    MayActSub:         '',
    TokenScopes:       'read write transfer',
    TokenAudience:     GATEWAY_AUD,
    TokenAudActual:    GATEWAY_AUD,
    McpResourceUri:    GATEWAY_AUD,
    TokenExp:          String(now + 300),
    TokenIat:          String(now - 30),
    TokenNbf:          String(now - 30),
    TokenIss:          '',
    TransactionAmount: '10',
    TransactionType:   'transfer',
    ToAccountId:       'acct-2',
    Vertical:          'banking',
    ...extra,
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `pg-parity-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = GATEWAY_AUD;
  // Rule 2 is act-only now: groovyParams' default actor ('agent-1') must be a
  // recognized authorized actor, not just may_act-matched.
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  delete process.env.PINGONE_ENVIRONMENT_ID; // disable iss check
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

test('PERMIT — full 18-key Groovy payload for an allowed call', async () => {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: groovyParams() } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('DENY — same payload but aud does not include the gateway resource uri', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenAudActual: 'some.other.aud' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /invalid_aud/);
});

test('PERMIT — PingGateway aud accepted when MCP_GW_RESOURCE_URI lists both audiences', async () => {
  process.env.MCP_GW_RESOURCE_URI = BOTH_AUDS;
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: groovyParams({
          ToolName: 'get_my_accounts',
          TokenScopes: 'gateway:mcp:invoke',
          TokenAudActual: GATEWAY_ID,
          TokenAudience: BOTH_AUDS,
          McpResourceUri: BOTH_AUDS,
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('PERMIT — user_profile_card (Path B) with PingGateway aud', async () => {
  process.env.MCP_GW_RESOURCE_URI = BOTH_AUDS;
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: groovyParams({
          ToolName: 'user_profile_card',
          TokenScopes: 'gateway:mcp:invoke',
          TokenAudActual: GATEWAY_ID,
          TokenAudience: BOTH_AUDS,
          McpResourceUri: BOTH_AUDS,
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('DENY — TokenAudience does not match McpResourceUri (HasValidMcpAudience parity)', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ McpResourceUri: 'https://other.mcp.server/mcp' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /invalid_aud/);
});

test('PERMIT — gateway:mcp:invoke (Exchange #2 default) bypasses banking-scope check', async () => {
  // The PingGateway-path token carries only the gateway-hop scope, no banking
  // scopes; Rule 3 must treat it as via-gateway or every tool call is denied.
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenScopes: 'gateway:mcp:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('PERMIT — legacy pinggateway:invoke scope still recognized', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenScopes: 'pinggateway:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('DENY — same payload but missing a required scope (insufficient_scope)', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: groovyParams({ TokenScopes: 'read' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /insufficient_scope/);
});

test('mock consumes every one of the 18 Groovy keys (no key triggers a parse error)', async () => {
  // Sanity: the handler reads req.body.parameters and never throws on the full set.
  const res = makeRes();
  await assert.doesNotReject(
    decisionHandler({ params: { workerId: 'p' }, body: { parameters: groovyParams() } }, res),
  );
  assert.ok(res.body && typeof res.body.decision === 'string');
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 parameter set (planning/authz-fix-contract.md)
//
// SCOPE — read before adding to this block.
//
// The C1 change that mattered most lives in the CALLER, not here:
// p1az-decision.groovy used to set TokenAudience AND McpResourceUri to the same
// PG_GATEWAY_RESOURCE_URI, so Rule 0c compared a value to itself and could never
// deny. **That tautology was never in the mock, and this file cannot observe it.**
// The mock only ever sees the two values it is handed; whether the caller derived
// them from one variable or two is invisible from here. Any test in this file
// claiming to prove "the tautology is gone" is proving nothing — an earlier
// revision of this block did exactly that, and all six of its cases passed
// unchanged against decision.js from eb26b9c6d^.
//
// **The groovy caller is therefore UNTESTED from this file.** Covering it needs a
// test that executes p1az-decision.groovy (ping-gateway/, workstream B) — not a
// mock-side assertion. Do not add one here and do not re-add assertions over
// literals this file's own helper wrote (`p.Amount === p.TransactionAmount` on a
// two-line-old literal, `!('IntentTokenValid' in p)` on a helper that never sets
// it) — those restate the fixture, not the behaviour.
//
// What IS mock-observable, and what the cases below pin, is the behaviour
// eb26b9c6d changed inside routes/decision.js. Each case is fix-sensitive:
// reverting decision.js to eb26b9c6d^ turns it RED.
// ─────────────────────────────────────────────────────────────────────────────

// The payload the UPDATED Groovy filter emits. Mirrors the live values verified in
// the ping-gateway container: PG_GATEWAY_RESOURCE_URI=mcpgateway.ping.demo,
// PG_GATEWAY_RESOURCE_ID=https://api.ping.demo:3036/mcp, and a token whose real
// aud is the resource ID.
function c1Params(extra = {}) {
  return {
    ...groovyParams(),
    ClientId: 'user-1',
    UserId: 'user-1',
    TokenAudience: GATEWAY_ID,   // REAL aud, no longer the expected URI
    TokenAudActual: GATEWAY_ID,
    McpResourceUri: GATEWAY_ID,  // resolved to the identity the aud targeted
    Amount: '10',                // C1 rule 2 — moves with TransactionAmount
    TransactionAmount: '10',
    Timestamp: new Date().toISOString(),
    ...extra,
  };
}

beforeEach(() => {
  // Both gateway identities are accepted audiences, matching
  // jwks-token-validation.groovy (aud == PG_GATEWAY_RESOURCE_URI || PG_GATEWAY_RESOURCE_ID).
  process.env.MCP_GW_RESOURCE_URI = BOTH_AUDS;
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
});

test('C1 — PERMIT: real aud in TokenAudience still permits (no live regression)', async () => {
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: c1Params({ TokenScopes: 'gateway:mcp:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 Rule 0c — a single real aud PERMITs against a comma-joined McpResourceUri (set compare, not string equality)', async () => {
  // FIX-SENSITIVE. Rule 0c used to be `TokenAudience !== McpResourceUri`. Once the
  // caller began sending the token's ONE real aud while McpResourceUri still lists
  // every accepted audience (k8s comma-joins them), string equality DENYed the
  // normal production flow. Pre-fix decision.js returns DENY invalid_aud here.
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: c1Params({
          TokenScopes: 'gateway:mcp:invoke',
          TokenAudience: GATEWAY_ID,   // the one aud the token really carries
          McpResourceUri: BOTH_AUDS,   // every identity the gateway accepts
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 Rule 0c — a foreign aud still DENYs when it intersects nothing', async () => {
  // Companion to the case above: widening to a set compare must not make Rule 0c
  // permissive. This one passes both pre- and post-fix (Rule 0b catches it first)
  // and is kept as a guard on the widening, NOT as proof the tautology is gone.
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: { parameters: c1Params({ TokenAudience: FOREIGN_AUD, McpResourceUri: BOTH_AUDS }) },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /invalid_aud/);
});

test('C1 Rule 2.5 — McpFirstTool (the BFF context) now enforces require-act', async () => {
  // FIX-SENSITIVE. Rule 2.5 was gated on `DecisionContext === 'McpToolCall'`, so
  // every BFF-originated call skipped the UC16 impersonation block (docs §5.5).
  // Pre-fix decision.js PERMITs this; post-fix it DENYs missing_act.
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: c1Params({
          DecisionContext: 'McpFirstTool',
          ToolName: 'create_transfer',   // requiresAgentMediation in the SoT
          ActClientId: '',               // no act claim => impersonation
          TokenScopes: 'gateway:mcp:invoke',
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /missing_act/);
});

test('C1 Rule 3 — a token carrying a real per-tool scope is enforced against it (F11)', async () => {
  // FIX-SENSITIVE. Rule 3 used to disable itself for ANY token holding the
  // gateway-hop scope, so per-tool scope was enforced nowhere. The bypass now
  // survives only when the token has no per-tool scope to check. Here the token
  // supplies a real topology scope ('read') but not the one the write tool needs,
  // so the check must run. Pre-fix decision.js PERMITs this.
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: c1Params({
          ToolName: 'create_transfer',
          TokenScopes: 'gateway:mcp:invoke read',
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /insufficient_scope/);
});

test('C1 Rule 3 — gateway-hop scope ALONE still bypasses the per-tool check', async () => {
  // The other half of F11: a caller that genuinely cannot express per-tool scopes
  // must keep working, or the default topology denies every tool call.
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: c1Params({ ToolName: 'create_transfer', TokenScopes: 'gateway:mcp:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 C2 — every decision carries a cloud statement code and a policy_source', async () => {
  // FIX-SENSITIVE. The mock returned only `reason`; consumers merged six response
  // shapes to cover mock-vs-cloud (F9). Pre-fix decision.js emits neither field.
  const permitRes = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: c1Params({ TokenScopes: 'gateway:mcp:invoke' }) } },
    permitRes,
  );
  assert.deepStrictEqual(permitRes.body.statements, [{ code: 'mcp-tool-authorized' }]);
  assert.strictEqual(permitRes.body.policy_source, 'p1az-mock');

  const denyRes = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: c1Params({ TokenAudActual: FOREIGN_AUD }) } },
    denyRes,
  );
  assert.strictEqual(denyRes.body.decision, 'DENY');
  assert.deepStrictEqual(denyRes.body.statements, [{ code: 'mcp-invalid-audience' }]);
  assert.strictEqual(denyRes.body.policy_source, 'p1az-mock');
});

test('C1 — the full updated key set never triggers a parse error', async () => {
  const res = makeRes();
  await assert.doesNotReject(
    decisionHandler(
      {
        params: { workerId: 'p' },
        body: {
          parameters: c1Params({
            TokenScopes: 'gateway:mcp:invoke',
            Acr: 'Multi_Factor',
            IntentTokenValid: 'true',
            IntentMatchesTool: 'true',
            RarAuthorizationDetails: JSON.stringify([{ type: 'payment_initiation' }]),
            TratPurp: 'transfer_funds',
            Cnf: 'abc123jkt',
            CandidateTools: JSON.stringify(['get_my_accounts']),
          }),
        },
      },
      res,
    ),
  );
  assert.ok(res.body && typeof res.body.decision === 'string');
});
