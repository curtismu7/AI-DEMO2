'use strict';

/**
 * decision.mockCloudParity.test.js
 *
 * Pins the two places where the MOCK PDP and the CLOUD policy had drifted apart
 * after 1e8619d09 widened the cloud's `IsMcpFirstToolRequest` condition.
 *
 * 1. DecisionContext routing (item 1).
 *    `snapshots/gen-authorize-snapshot.js` MCP_DECISION_CONTEXTS lists four
 *    contexts — McpFirstTool, McpToolCall, McpToolsList, McpRequest — and every
 *    one of them now routes to the cloud's MCP Delegation policy, whose deny
 *    rules are all tool-name or identity keyed and whose catch-all is
 *    `Permit Valid Tool Invocation`. The mock had no routing notion at all: a
 *    session-lifecycle `McpRequest` (initialize / ping / notifications — no
 *    ToolName) fell through into the tool-scoped rules and died on Rule 3's
 *    unknown-tool DENY. Same DecisionContext, opposite verdict.
 *
 *    Note the mock's `MCP_TOOL_CALL_CONTEXTS` is deliberately NOT widened to
 *    match that four-entry list — see the comment on the constant in
 *    routes/decision.js. It gates rule APPLICABILITY, not policy ROUTING.
 *
 * 2. UserRole (item 4).
 *    The BFF removed its code-level admin gate-bypass (F5) and now forwards the
 *    caller's role as `UserRole` (pingOneAuthorizeService.js:570) so the POLICY
 *    decides what admin means. The mock ignored the key entirely, which made the
 *    parameter pure decoration.
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

async function decide(parameters) {
  const res = makeRes();
  await decisionHandler({ params: { workerId: 'p' }, body: { parameters } }, res);
  return res.body;
}

/** A token-valid, identity-valid base payload. Only the keys under test vary. */
function base(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    DecisionContext:   'McpToolCall',
    McpMethod:         'tools/call',
    ToolName:          'create_transfer',
    ClientId:          'user-1',
    ActClientId:       'agent-1',
    ActChainDepth:     '0',
    TokenScopes:       'gateway:mcp:invoke',
    TokenAudience:     GATEWAY_AUD,
    TokenAudActual:    GATEWAY_AUD,
    McpResourceUri:    GATEWAY_AUD,
    TokenExp:          String(now + 300),
    TokenIat:          String(now - 30),
    TokenNbf:          String(now - 30),
    TokenIss:          '',
    ...extra,
  };
}

beforeEach(() => {
  OVERLAY = path.join(os.tmpdir(), `mc-parity-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.AUTHZ_RULES_OVERLAY_PATH = OVERLAY;
  process.env.MCP_GATEWAY_RESOURCE_URI = GATEWAY_AUD;
  process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = 'agent-1';
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.FF_AUTHORIZE_GROUP_POLICY;
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
  fresh();
});

afterEach(() => {
  mock.restoreAll();
  try { fs.unlinkSync(OVERLAY); } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 1 — DecisionContext routing parity
// ─────────────────────────────────────────────────────────────────────────────

test('McpRequest session lifecycle (no ToolName) PERMITs — cloud routes it to the MCP policy catch-all', async () => {
  // Both gateways send McpRequest for every non-tools/call method
  // (PingOneAuthorizeClient.ts:127, p1az-decision.groovy:321). ToolName is empty
  // for those. The cloud's MCP Delegation policy reaches `Permit Valid Tool
  // Invocation`; the mock used to answer `unknown_tool: no policy defined for
  // tool ""`.
  const body = await decide(base({ DecisionContext: 'McpRequest', McpMethod: 'initialize', ToolName: '' }));
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('McpRequest with a ToolName is still evaluated as a tool request', async () => {
  // The lifecycle PERMIT must be narrow: it applies only when there is no tool
  // to evaluate. A named tool still runs the full tool-scoped chain.
  const body = await decide(base({
    DecisionContext: 'McpRequest',
    ToolName: 'definitely_not_a_real_tool',
  }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /unknown_tool/);
});

test('McpToolCall with no ToolName still DENYs — the lifecycle PERMIT must not leak into tool calls', async () => {
  const body = await decide(base({ DecisionContext: 'McpToolCall', ToolName: '' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /unknown_tool/);
});

test('McpFirstTool with no ToolName still DENYs', async () => {
  const body = await decide(base({ DecisionContext: 'McpFirstTool', ToolName: '' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /unknown_tool/);
});

test('a non-MCP DecisionContext with no ToolName is unaffected by the lifecycle PERMIT', async () => {
  // Only the four MCP contexts route to the MCP policy. Anything else keeps the
  // pre-existing behaviour.
  const body = await decide(base({ DecisionContext: 'SomethingElse', ToolName: '' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /unknown_tool/);
});

test('the tier rule does NOT fire on McpRequest — a tier ceiling is meaningless without a tool', async () => {
  // Explicit decision, not an oversight: MCP_TOOL_CALL_CONTEXTS stays a strict
  // subset of the cloud's routing list. A $9,999 amount on a session-lifecycle
  // request has no tool to price, so the tier rule must not deny it.
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  fresh();
  const body = await decide(base({
    DecisionContext: 'McpRequest',
    ToolName: '',
    TransactionAmount: '9999',
    UserGroups: JSON.stringify(['Standard']),
  }));
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('the tier rule still fires on McpFirstTool — the BFF context is a real tool call', async () => {
  // Regression guard for the widening that 1e8619d09 DID get right.
  process.env.FF_AUTHORIZE_GROUP_POLICY = 'true';
  process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT = '60000';
  fresh();
  const body = await decide(base({
    DecisionContext: 'McpFirstTool',
    ToolName: 'create_transfer',
    TransactionAmount: '2500',
    Acr: 'Multi_Factor',
    UserGroups: JSON.stringify(['Standard']),
  }));
  delete process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT;
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /tier_amount_exceeded/);
});

test('the mock routing set is byte-identical to the snapshot generator constant', async () => {
  // The defect this whole file exists for was the two sides listing different
  // contexts. routes/decision.js cannot import the generator (the authz image
  // does not ship snapshots/ — see its Dockerfile), so the list is duplicated;
  // this is the guard that keeps the duplicate honest.
  const { MCP_DECISION_CONTEXTS: cloud } = require('../snapshots/gen-authorize-snapshot');
  const mockSet = require('./routes/decision').MCP_DECISION_CONTEXTS;
  assert.deepStrictEqual([...mockSet].sort(), [...cloud].sort());
});

test('the tool-call set is a strict subset of the routing set', async () => {
  // Pins the intended relationship: every tool-call context is an MCP context,
  // and the tool-call set is deliberately SMALLER. If someone "reconciles" these
  // by making them equal, this fails and sends them to the comment explaining
  // why applicability != routing.
  const d = require('./routes/decision');
  const routing = d.MCP_DECISION_CONTEXTS;
  const toolCall = d.MCP_TOOL_CALL_CONTEXTS;
  for (const ctx of toolCall) {
    assert.ok(routing.has(ctx), `${ctx} must also be an MCP routing context`);
  }
  assert.ok(toolCall.size < routing.size, 'the tool-call set must stay a STRICT subset');
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 4 — UserRole is consumed, not decorative
// ─────────────────────────────────────────────────────────────────────────────

test('UserRole=admin DENYs a customer write tool — mirrors requireNotAdmin', async () => {
  // middleware/auth.js:1049 (requireNotAdmin) 403s an admin token on every
  // customer banking surface. The BFF used to express that as a code-level skip
  // of the whole gate (F5); with the skip removed the same invariant has to be
  // a policy rule or it is enforced nowhere on the agent path.
  const body = await decide(base({ ToolName: 'create_transfer', UserRole: 'admin' }));
  assert.strictEqual(body.decision, 'DENY');
  assert.match(body.reason, /admin_role_not_permitted/);
});

test('UserRole=admin does NOT block a read tool — admins may still observe', async () => {
  const body = await decide(base({ ToolName: 'get_my_accounts', UserRole: 'admin' }));
  assert.strictEqual(body.decision, 'PERMIT', `reason: ${body.reason}`);
});

test('UserRole=customer is unaffected', async () => {
  const body = await decide(base({ ToolName: 'create_transfer', UserRole: 'customer' }));
  assert.notStrictEqual(body.decision, 'DENY');
});

test('an absent UserRole is inert — decisions are byte-identical to the pre-UserRole mock', async () => {
  // Defensive consumption: the BFF omits the key when the session has no role,
  // and the gateways never send it at all.
  const withOut = await decide(base({ ToolName: 'create_transfer' }));
  const withEmpty = await decide(base({ ToolName: 'create_transfer', UserRole: '' }));
  assert.strictEqual(withOut.decision, withEmpty.decision);
  assert.strictEqual(withOut.reason, withEmpty.reason);
  assert.notStrictEqual(withOut.decision, 'DENY');
});

test('the admin deny carries a cloud statement code, not the bare default', async () => {
  const body = await decide(base({ ToolName: 'create_transfer', UserRole: 'admin' }));
  assert.deepStrictEqual(body.statements, [{ code: 'mcp-admin-role-not-permitted' }]);
  assert.strictEqual(body.policy_source, 'p1az-mock');
});
