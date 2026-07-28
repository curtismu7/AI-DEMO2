'use strict';

/**
 * Item 3 (correlation propagation): the mock Authorization Server must
 *  (1) read the gateway-forwarded X-Correlation-ID / X-Request-ID, bind it to
 *      the request context, and echo it back, and
 *  (2) emit a structured authz_decision audit record (with the correlation id +
 *      tool/sub/actor) for every DENY / INDETERMINATE outcome.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const correlationMiddleware = require('./correlationId');
const { runWithCorrelation, getCorrelationId } = require('./correlationContext');

const AUD = process.env.MCP_GATEWAY_RESOURCE_URI || 'mcpgateway.ping.demo';
// Rule 2 is act-only now: the fixtures' baseline actor ('agent-1') must be a
// recognized authorized actor, not just may_act-matched. Must be set BEFORE
// routes/decision is required — ruleStore.js reads this env var once, at
// module-load time, into authorizedActorClientId.
process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID = process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID || 'agent-1';

function mkRes() {
  return {
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    json(b) { this.body = b; },
  };
}

test('correlation middleware reads X-Correlation-ID, echoes it, and binds context', () => {
  const req = { headers: { 'x-correlation-id': 'cid-abc' } };
  const res = mkRes();
  let boundId;
  correlationMiddleware(req, res, () => { boundId = getCorrelationId(); });
  assert.strictEqual(req.correlationId, 'cid-abc');
  assert.strictEqual(res.headers['X-Correlation-ID'], 'cid-abc');
  assert.strictEqual(boundId, 'cid-abc');
});

test('correlation middleware falls back to X-Request-ID, else generates one', () => {
  const res1 = mkRes();
  correlationMiddleware({ headers: { 'x-request-id': 'req-xyz' } }, res1, () => {});
  assert.strictEqual(res1.headers['X-Correlation-ID'], 'req-xyz');

  const res2 = mkRes();
  correlationMiddleware({ headers: {} }, res2, () => {});
  assert.ok(res2.headers['X-Correlation-ID'] && res2.headers['X-Correlation-ID'].length > 0);
});

test('a DENY emits a structured authz_decision audit line carrying the correlation id', async (t) => {
  // Mocked INSIDE the running test, matching decision.contract.test.js's
  // fresh() — node:test's MockTracker only intercepts calls made once a test
  // context is active; mocking at module top-level (before any test starts)
  // silently no-ops, and routes/decision must be required fresh AFTER the
  // mock is in place so its internal `pingOneUserLookup.lookupUser` calls
  // resolve against the mocked implementation, not the real one (which fails
  // closed without live PingOne credentials in test/CI).
  for (const m of ['./pingOneUserLookup', './routes/decision']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
  }
  const userLookup = require('./pingOneUserLookup');
  t.mock.method(userLookup, 'lookupUser', async () => ({ found: true, enabled: true, status: 'ACTIVE' }));
  const decisionHandler = require('./routes/decision');

  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try {
    // Unknown tool → Rule 3 DENY. Wrap in the correlation context the middleware
    // would have established for a real request.
    await runWithCorrelation('cid-deny-1', () =>
      decisionHandler(
        {
          params: { workerId: 'p' },
          body: {
            parameters: {
              DecisionContext: 'McpToolCall',
              ToolName: 'totally_unknown_tool',
              ClientId: 'demoUser',
              ActClientId: 'agent-1',
              MayActSub: 'agent-1', // matches actor → passes Rule 2 so the DENY lands on Rule 3 (unknown tool)
              TokenAudience: AUD,
              TokenAudActual: AUD,
              TokenScopes: 'read',
            },
          },
        },
        mkRes(),
      ),
    );
  } finally {
    console.log = orig;
  }

  const auditLine = lines.find((l) => l.includes('"evt":"authz_decision"'));
  assert.ok(auditLine, 'expected a structured authz_decision audit line');
  const record = JSON.parse(auditLine);
  assert.strictEqual(record.decision, 'DENY');
  assert.strictEqual(record.correlationId, 'cid-deny-1');
  assert.strictEqual(record.tool, 'totally_unknown_tool');
  assert.strictEqual(record.sub, 'demoUser');
  assert.strictEqual(record.actor, 'agent-1');
  assert.match(record.reason, /unknown_tool/);
});
