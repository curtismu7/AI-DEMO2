'use strict';

/**
 * decision.contract.test.js — mock/cloud contract parity for the mock PDP.
 *
 * Pins five findings from docs/authorization-decision-split.md:
 *
 *  F11 (item 3)  Rule 3 disabled itself. The per-tool scope check was skipped
 *                whenever the token carried `gateway:mcp:invoke` /
 *                `pinggateway:invoke`. On the default topology the final token
 *                carries ONLY `gateway:mcp:invoke`, so per-tool scope was
 *                enforced nowhere in the system. It now enforces against
 *                TokenScopes whenever the caller supplies any real per-tool
 *                scope, and bypasses only when it genuinely cannot (gateway-hop
 *                scope alone).
 *
 *  F9 (item 4)   The mock returned only {decision, reason, decision_id} and never
 *                emitted `statements`, so consumers merged six response shapes to
 *                paper over the drift. It now emits `statements[].code` using the
 *                SAME codes as the cloud snapshot, while keeping `reason`.
 *
 *  C2 (item 5)   Every decision carries policy_source: 'p1az-mock'.
 *
 *  §5.5 (item 6) Rules 2.5 (UC16 require-act) and 3d (entitlement tier) were gated
 *                on DecisionContext === 'McpToolCall'. The BFF sends 'McpFirstTool',
 *                so both were skipped for every BFF-originated call.
 *
 *  §5.3 (item 7) Rule 0c compared TokenAudience to McpResourceUri when both
 *                gateways sent the same value for both — a tautology. Under
 *                contract C1 TokenAudience becomes the token's REAL aud, which
 *                makes the rule meaningful; it must still PERMIT the normal flow
 *                where the real aud legitimately equals the gateway resource URI,
 *                including when McpResourceUri carries several audiences.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATEWAY_AUD = 'mcpgateway.ping.demo';
const ACTOR = 'agent-1';

let OVERLAY;
let decisionHandler;
let userLookup;

/** Statement codes defined by the real cloud snapshot — the parity vocabulary. */
const CLOUD_CODES = new Set(
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'snapshots', 'Super_Banking_Transaction_Authorization_P1AZ.snapshot.json'),
      'utf8',
    ),
  )
    .filter((o) => o.type === 'Statement')
    .map((o) => o.code),
);

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

function baseParams(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    DecisionContext: 'McpToolCall',
    McpMethod: 'tools/call',
    ToolName: 'get_my_accounts',
    ClientId: 'user-1',
    ActClientId: ACTOR,
    TokenScopes: 'read',
    TokenAudience: GATEWAY_AUD,
    TokenAudActual: GATEWAY_AUD,
    McpResourceUri: GATEWAY_AUD,
    TokenExp: String(now + 300),
    TokenIat: String(now - 30),
    ...extra,
  };
}

async function decide(extra = {}) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters: baseParams(extra) } }, res);
  return res.body;
}

/** The code(s) carried on a decision's statements array. */
const codesOf = (body) => (body.statements || []).map((s) => s.code);

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `contract-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = GATEWAY_AUD;
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = ACTOR;
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.MCP_GW_RESOURCE_URI;
  delete process.env.FF_AUTHORIZE_GROUP_POLICY;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.FF_AUTHORIZE_GROUP_POLICY;
  delete process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

// ── C2 item 5: provenance on every decision ─────────────────────────────────

test('C2 — PERMIT carries policy_source p1az-mock', async () => {
  const body = await decide();
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
  assert.strictEqual(body.policy_source, 'p1az-mock');
});

test('C2 — DENY carries policy_source p1az-mock', async () => {
  const body = await decide({ TokenAudActual: 'some.other.aud', TokenAudience: 'some.other.aud' });
  assert.strictEqual(body.decision, 'DENY');
  assert.strictEqual(body.policy_source, 'p1az-mock');
});

test('C2 — INDETERMINATE carries policy_source p1az-mock', async () => {
  const body = await decide({ ToolName: 'create_withdrawal', TokenScopes: 'write' });
  assert.strictEqual(body.decision, 'INDETERMINATE');
  assert.strictEqual(body.policy_source, 'p1az-mock');
});

test('C2 — tools/list advice response carries policy_source p1az-mock', async () => {
  const body = await decide({
    DecisionContext: 'McpToolsList',
    CandidateTools: JSON.stringify(['get_my_accounts']),
    Vertical: 'banking',
  });
  assert.strictEqual(body.decision, 'PERMIT');
  assert.strictEqual(body.policy_source, 'p1az-mock');
  assert.ok(Array.isArray(body.advice), 'advice must survive the change');
});

// ── F9 item 4: statements with cloud codes, reason kept ─────────────────────

test('F9 — PERMIT emits mcp-tool-authorized and KEEPS reason (back-compat)', async () => {
  const body = await decide();
  assert.deepStrictEqual(codesOf(body), ['mcp-tool-authorized']);
  assert.strictEqual(typeof body.reason, 'string');
  assert.ok(body.reason.length > 0, 'reason must not be dropped — existing consumers match on it');
  assert.strictEqual(typeof body.decision_id, 'string');
});

test('F9 — statements must NOT carry an `id`: consumers read type||id||code, so an id shadows the code', async () => {
  // services/authorizeObligations.js classifyObligation reads
  // String(ob.type || ob.id || ob.code). A UUID `id` would win over `code` and
  // the obligation would classify to null — silently defeating every gate.
  const body = await decide({ ToolName: 'create_withdrawal', TokenScopes: 'write' });
  for (const s of body.statements) {
    assert.strictEqual(s.id, undefined, 'statement.id would shadow statement.code in the shared classifier');
    assert.strictEqual(s.type, undefined, 'statement.type would shadow statement.code in the shared classifier');
    assert.strictEqual(typeof s.code, 'string');
  }
});

test('F9 — every emitted statement code exists in the cloud snapshot vocabulary', async () => {
  const cases = [
    {},
    { TokenAudActual: 'some.other.aud', TokenAudience: 'some.other.aud' },
    { ClientId: '' },
    { ActClientId: 'not-an-authorized-actor' },
    { ToolName: 'no_such_tool_at_all' },
    { ToolName: 'create_withdrawal', TokenScopes: 'write' },
    { ToolName: 'create_transfer', TokenScopes: 'write transfer' },
    { ToolName: 'create_transfer', TokenScopes: 'write transfer', TransactionAmount: '300' },
    { ToolName: 'create_transfer', TokenScopes: 'write transfer', TransactionAmount: '99999' },
    { RequiredGroup: 'Premium', UserGroups: JSON.stringify(['Standard']) },
  ];
  for (const c of cases) {
    const body = await decide(c);
    const codes = codesOf(body);
    assert.ok(codes.length > 0, `no statements emitted for ${JSON.stringify(c)}`);
    for (const code of codes) {
      assert.ok(
        CLOUD_CODES.has(code),
        `code "${code}" is not in the cloud snapshot vocabulary (case ${JSON.stringify(c)})`,
      );
    }
  }
});

test('F9 — deny reasons map to their specific cloud codes', async () => {
  const invalidAud = await decide({ TokenAudActual: 'some.other.aud', TokenAudience: 'some.other.aud' });
  assert.deepStrictEqual(codesOf(invalidAud), ['mcp-invalid-audience']);

  const missingSub = await decide({ ClientId: '' });
  assert.deepStrictEqual(codesOf(missingSub), ['mcp-missing-user-id']);

  const badActor = await decide({ ActClientId: 'not-an-authorized-actor' });
  assert.deepStrictEqual(codesOf(badActor), ['mcp-invalid-actor']);

  const notInGroup = await decide({ RequiredGroup: 'Premium', UserGroups: JSON.stringify(['Standard']) });
  assert.deepStrictEqual(codesOf(notInGroup), ['mcp-user-not-in-group']);

  const overCeiling = await decide({
    ToolName: 'create_transfer', TokenScopes: 'write transfer', TransactionAmount: '99999',
  });
  assert.strictEqual(overCeiling.decision, 'DENY');
  assert.deepStrictEqual(codesOf(overCeiling), ['transaction-denied']);

  // A deny with no specific cloud equivalent falls back to the shared code.
  const unknownTool = await decide({ ToolName: 'no_such_tool_at_all' });
  assert.deepStrictEqual(codesOf(unknownTool), ['mcp-authorization-denied']);
});

test('F9 — step-up emits step-up-required; tool-declared consent emits HITL; amount consent emits HITL_CONSENT', async () => {
  // create_withdrawal declares challengeType step_up in the SoT and carries no amount.
  const stepUp = await decide({ ToolName: 'create_withdrawal', TokenScopes: 'write' });
  assert.strictEqual(stepUp.decision, 'INDETERMINATE');
  assert.strictEqual(stepUp.reason, 'STEP_UP', 'reason kept for back-compat');
  assert.deepStrictEqual(codesOf(stepUp), ['step-up-required']);

  // create_transfer declares challengeType consent and carries no amount — this is
  // the cloud's "MCP Require HITL Consent for sensitive tools" rule, code HITL.
  const toolConsent = await decide({ ToolName: 'create_transfer', TokenScopes: 'write transfer' });
  assert.strictEqual(toolConsent.decision, 'INDETERMINATE');
  assert.deepStrictEqual(codesOf(toolConsent), ['HITL']);

  // Amount over the confirm threshold but under step-up — the cloud's
  // "Require Consent for Mid-Value Transactions" rule, code HITL_CONSENT.
  const amountConsent = await decide({
    ToolName: 'create_transfer', TokenScopes: 'write transfer', TransactionAmount: '300',
  });
  assert.strictEqual(amountConsent.decision, 'INDETERMINATE');
  assert.deepStrictEqual(codesOf(amountConsent), ['HITL_CONSENT']);
});

// ── F11 item 3: per-tool scope actually enforced ────────────────────────────

test('F11 — gateway-hop scope ALONE still bypasses per-tool scope (caller cannot supply them)', async () => {
  const body = await decide({ TokenScopes: 'gateway:mcp:invoke' });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('F11 — legacy pinggateway:invoke alone still bypasses', async () => {
  const body = await decide({ TokenScopes: 'pinggateway:invoke' });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('F11 — gateway scope PLUS real per-tool scopes now ENFORCES them (the bug)', async () => {
  // Token can express per-tool scopes but lacks the one this tool requires.
  // Old behaviour: gateway:mcp:invoke present => scope check skipped => PERMIT.
  const body = await decide({ ToolName: 'get_my_accounts', TokenScopes: 'gateway:mcp:invoke transfer' });
  assert.strictEqual(body.decision, 'DENY', 'per-tool scope must be enforced when TokenScopes carries real scopes');
  assert.match(body.reason, /insufficient_scope/);
  assert.match(body.reason, /read/);
});

test('F11 — gateway scope plus the CORRECT per-tool scope permits', async () => {
  const body = await decide({ ToolName: 'get_my_accounts', TokenScopes: 'gateway:mcp:invoke read' });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('F11 — non-topology scopes (openid/profile) do not count as per-tool scopes, and do not weaken the check', async () => {
  // No gateway-hop scope at all: must still enforce, exactly as before.
  const body = await decide({ ToolName: 'get_my_accounts', TokenScopes: 'openid profile' });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /insufficient_scope/);
});

test('F11 — gateway-hop scope with only non-topology extras still bypasses', async () => {
  const body = await decide({ ToolName: 'get_my_accounts', TokenScopes: 'gateway:mcp:invoke openid profile' });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

// ── §5.5 item 6: McpFirstTool must reach the same rules as McpToolCall ──────

test('UC16 — require-act fires for DecisionContext McpFirstTool (BFF path), not just McpToolCall', async () => {
  const body = await decide({
    DecisionContext: 'McpFirstTool',
    ToolName: 'create_withdrawal',
    TokenScopes: 'write',
    ActClientId: '',
  });
  assert.strictEqual(body.decision, 'DENY', 'agent-mediated tool with no act claim must be denied on the BFF path');
  assert.match(body.reason, /missing_act/);
  assert.deepStrictEqual(codesOf(body), ['mcp-invalid-actor']);
});

test('UC16 — require-act still fires for McpToolCall (unchanged)', async () => {
  const body = await decide({ ToolName: 'create_withdrawal', TokenScopes: 'write', ActClientId: '' });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /missing_act/);
});

test('tier — entitlement tier fires for DecisionContext McpFirstTool (BFF path)', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  const body = await decide({
    DecisionContext: 'McpFirstTool',
    ToolName: 'create_withdrawal',
    TokenScopes: 'write',
    UserGroups: JSON.stringify(['Standard']),
  });
  assert.strictEqual(body.decision, 'DENY', 'Standard tier must not reach create_withdrawal on the BFF path');
  assert.match(body.reason, /tier_tool_not_allowed/);
  assert.deepStrictEqual(codesOf(body), ['mcp-tier-tool-not-allowed']);
});

test('tier — amount ceiling fires for McpFirstTool and maps to mcp-tier-amount-exceeded', async () => {
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  // The tier ceiling only has a reachable window when the GLOBAL hard-deny
  // ceiling (Rule 3b, default 2000) sits above the tier ceiling — otherwise
  // Rule 3b fires first and tier_amount_exceeded is unreachable, which is
  // exactly what the Standard tier's own 2000 limit would collide with.
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '5000';
  const body = await decide({
    DecisionContext: 'McpFirstTool',
    ToolName: 'create_transfer',
    TokenScopes: 'write transfer',
    TransactionAmount: '2500', // > Standard tier 2000, < global 5000
    UserGroups: JSON.stringify(['Standard']),
    Acr: 'mfa',
  });
  assert.strictEqual(body.decision, 'DENY', `reason: ${body.reason}`);
  assert.match(body.reason, /tier_amount_exceeded/);
  assert.deepStrictEqual(codesOf(body), ['mcp-tier-amount-exceeded']);
});

// ── §5.3 item 7: Rule 0c is meaningful once TokenAudience is the real aud ───

test('C1 rule 0c — real aud equal to the gateway resource uri PERMITs (normal flow)', async () => {
  const body = await decide({ TokenAudience: GATEWAY_AUD, TokenAudActual: GATEWAY_AUD, McpResourceUri: GATEWAY_AUD });
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('C1 rule 0c — real aud that is ONE OF a multi-valued McpResourceUri PERMITs', async () => {
  // Post-C1 the gateway sends the token's actual single aud while McpResourceUri
  // still lists every accepted audience. Raw string equality would spuriously DENY.
  process.env.MCP_GW_RESOURCE_URI = `${GATEWAY_AUD},https://api.ping.demo:3036/mcp`;
  delete process.env.MCP_GATEWAY_RESOURCE_URI;
  fresh();
  const res = makeRes();
  await decisionHandler({
    params: { workerId: 'p' },
    body: {
      parameters: baseParams({
        TokenAudience: 'https://api.ping.demo:3036/mcp',
        TokenAudActual: 'https://api.ping.demo:3036/mcp',
        McpResourceUri: `${GATEWAY_AUD},https://api.ping.demo:3036/mcp`,
      }),
    },
  }, res);
  assert.strictEqual(res.body.decision, 'PERMIT', `reason: ${res.body.reason}`);
});

test('C1 rule 0c — real aud for a DIFFERENT mcp server DENIES (rule is no longer a tautology)', async () => {
  // Token legitimately reached this gateway (TokenAudActual passes rule 0b) but
  // its aud names another MCP resource — exactly the case the tautology hid.
  const body = await decide({
    TokenAudience: 'https://other.mcp.server/mcp',
    TokenAudActual: GATEWAY_AUD,
    McpResourceUri: GATEWAY_AUD,
  });
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /invalid_aud/);
  assert.deepStrictEqual(codesOf(body), ['mcp-invalid-audience']);
});
