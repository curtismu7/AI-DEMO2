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

const GATEWAY_AUD = 'mcpgateway.ping.demo';

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
  process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp';
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
          TokenAudActual: 'https://api.ping.demo:3036/mcp',
          TokenAudience: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
          McpResourceUri: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('PERMIT — user_profile_card (Path B) with PingGateway aud', async () => {
  process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp';
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
          TokenAudActual: 'https://api.ping.demo:3036/mcp',
          TokenAudience: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
          McpResourceUri: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp',
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
// p1az-decision.groovy previously set TokenAudience AND McpResourceUri to the same
// PG_GATEWAY_RESOURCE_URI, so Rule 0c (and the cloud's HasValidMcpAudience) compared
// a value to itself and could never deny. It now sends the token's REAL aud as
// TokenAudience and resolves McpResourceUri to whichever gateway identity that aud
// targeted — PG_GATEWAY_RESOURCE_URI (short name) or PG_GATEWAY_RESOURCE_ID (uri).
// It also adds Amount, Acr, Timestamp, CandidateTools and the binding-evidence keys.
// ─────────────────────────────────────────────────────────────────────────────

const GATEWAY_ID = 'https://api.ping.demo:3036/mcp';

// The payload the UPDATED Groovy filter emits. Mirrors the live values verified in
// the ping-gateway container: PG_GATEWAY_RESOURCE_URI=mcpgateway.ping.demo,
// PG_GATEWAY_RESOURCE_ID=https://api.ping.demo:3036/mcp, and a token whose real
// aud is the resource ID.
function c1Params(extra = {}) {
  const base = groovyParams();
  delete base.ClientId;
  return {
    ...base,
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
  process.env.MCP_GW_RESOURCE_URI = `${GATEWAY_AUD},${GATEWAY_ID}`;
});

test('C1 — PERMIT: real aud in TokenAudience still permits (no live regression)', async () => {
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    { params: { workerId: 'p' }, body: { parameters: c1Params({ TokenScopes: 'gateway:mcp:invoke' }) } },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 — DENY: a FOREIGN aud now trips the audience rule (tautology is gone)', async () => {
  // Before the fix this was unreachable: TokenAudience was hardcoded to the expected
  // URI, so TokenAudience === McpResourceUri held for EVERY token, including one
  // minted for a different MCP server (confused deputy).
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: c1Params({
          TokenAudience: 'https://evil.example/mcp',
          McpResourceUri: GATEWAY_AUD, // unresolved => falls back to the canonical URI
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'DENY');
  assert.match(res.body.reason, /invalid_aud/);
});

test('C1 rule 2 — Amount and TransactionAmount carry the same value', async () => {
  const p = c1Params({ Amount: '10', TransactionAmount: '10' });
  assert.strictEqual(p.Amount, p.TransactionAmount);
  // The mock reads TransactionAmount; the cloud Trust Framework only defines Amount.
  // Sending one without the other silently drops the amount on that side.
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: p } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 rule 3 — omitted binding evidence is treated as unknown, not as a violation', async () => {
  // The gateway omits IntentTokenValid/IntentMatchesTool when INTENT_TOKEN_SECRET is
  // unset (verified in-container: intentValid stays null => keys omitted). Omission
  // must NOT deny — only a verified-absent 'false' may.
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const p = c1Params({ TokenScopes: 'gateway:mcp:invoke' });
  assert.ok(!('IntentTokenValid' in p), 'binding evidence must be absent, not false');
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: p } }, res);
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 — verified intent evidence (valid + tool permitted) is accepted', async () => {
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler(
    {
      params: { workerId: 'p' },
      body: {
        parameters: c1Params({
          TokenScopes: 'gateway:mcp:invoke',
          IntentTokenValid: 'true',
          IntentMatchesTool: 'true',
        }),
      },
    },
    res,
  );
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body && res.body.reason}`);
});

test('C1 — the full updated key set never triggers a parse error', async () => {
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
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
