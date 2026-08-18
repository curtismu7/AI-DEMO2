// Does each token-chain hop actually produce evidence on the gateway that is
// CURRENTLY CONFIGURED? Run deliberately against a live stack, not in CI:
//
//   cd demo_api_ui && npm run test:e2e:real -- chain-hops-reachable
//
// WHY THIS EXISTS
// Three times on 2026-08-17/18 a chain feature shipped correct, tested, and
// inert, because the code sat somewhere the request never reaches:
//
//   #1951  gateway filter stages -> TraceStepCard, which focus mode never mounts
//   #1977  MCP handshake header -> demo_mcp_gateway (Node), while tool calls go
//          to PingGateway (IG)
//   #1949  discovery -> passed the client-credentials token, which has no `sub`,
//          so the gateway rejected it and every run used the hardcoded catalog
//
// Unit tests cannot catch these. They prove the step MODEL is right, and
// FocusModeChainRenders proves the COMPONENT renders — neither observes which
// service actually produced the evidence. This does, by asserting hop ids in a
// real response from the running stack.
//
// THREE THINGS MAKE THIS HONEST, and removing any one of them makes it lie:
//
//  1. It targets /api/agent/invoke. The MCP Inspector's invoke route passes
//     forceDirectMcpAudience:true and dials the MCP server directly, never
//     through PingGateway — asserting gateway hops there tests the wrong host,
//     which is the very mistake being guarded against.
//  2. forceHeuristic:true. The container pins an LLM mode and the local model
//     frequently answers from context without calling a tool; four consecutive
//     live runs on 2026-08-17 made no tool call at all, which is
//     indistinguishable from a broken feature. This is the same mechanism the
//     SPA's chips use and makes the tool call deterministic.
//  3. It asserts only GATEWAY-ONLY hop ids. When the real chain cannot be
//     resolved, agentInvokeRoute falls back to buildSessionPreviewTokenEvents,
//     which SYNTHESIZES events. That builder emits user-token / exchange /
//     introspection but never gw-* or mcp_challenge, so those ids cannot be
//     faked by a preview.
//
// Point 3 is measured, not assumed. Running these same assertions against the
// Inspector route (the non-gateway path) returned 12 token events — the whole
// two-exchange chain, user-token through two-ex-final-token — and none of the
// three ids below. An assertion on `exchange` or `two-ex-*` would therefore
// pass on a stack whose gateway is entirely bypassed. These three do not.
'use strict';
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

// Super Sports is the repo's default vertical for tests that pick one.
// The phrase is lifted from config/verticals/sporting-goods/routing.fixture.json
// so the heuristic router maps it to a read-only tool by construction.
const VERTICAL = 'sporting-goods';
const PROMPT = 'show my invoices';

// Hops any gateway-routed tool call must produce. Each maps to a step in
// demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js, and none of them
// can be produced by the preview fallback (see note 3 above).
const REQUIRED = [
  ['mcp_challenge', 'the credential-less 401 probe (services/mcpChallengeProbe.js) ran'],
  ['gw-authorize', "the gateway's OWN PingOne Authorize call, distinct from the BFF's"],
  ['gw-filter-chain', 'the filter stages the chain renders as separate hops'],
];

// Present or absent depending on WHICH gateway is configured. Reported, never
// asserted — failing on these would just encode today's deployment.
const CONFIG_DEPENDENT = [
  // Correctly absent here: the Agent Gateway opens its MCP session to DISCOVER
  // tools, so these land on /api/demo-agent/tools (see the discovery test below,
  // where they are asserted), not on an invoke response. Measured 2026-08-18 —
  // the tool-call leg produces initialize / notifications/initialized /
  // tools/list on the MCP server and no tools/call at all.
  //
  // The old label here read "Node gateway only, inert on IG (#1977)". That was
  // true of #1977's plumbing and is no longer true of anything: #2049 carries the
  // handshake in the tools/list _meta and it is verified live. Left in this list
  // because ABSENT is the right answer for THIS leg, not because it is broken.
  ['mcp-initialize', 'MCP handshake — belongs to the discovery leg, asserted there'],
  ['mcp-initialized', 'ditto'],
  ['two-ex-exchange1', 'first RFC 8693 call — two-exchange mode only'],
];

/** The `phase` each mcp_challenge event was recorded under (tools/list | tools/call). */
const challengePhases = (body) =>
  (body.tokenEvents || [])
    .filter((e) => (e.id || e.type) === 'mcp_challenge')
    .map((e) => e.phase || e.details?.phase || e.data?.phase)
    .filter(Boolean);

test.describe('token-chain hops are reachable on the configured gateway', () => {
  test('a real tool call produces evidence for every gateway-path hop', async ({ page, context }) => {
    // requireRealLoginEnv returns a boolean for skipping; it does not throw.
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');
    await loginAsCustomer(page);

    const resp = await context.request.post('/api/agent/invoke', {
      data: { prompt: PROMPT, vertical: VERTICAL, forceHeuristic: true },
      timeout: 120_000,
    });
    expect(resp.status(), 'invoke status').toBe(200);

    const body = await resp.json();
    const ids = (body.tokenEvents || []).map((e) => e.id || e.type);
    const toolsCalled = body.toolsCalled || [];
    console.log(`[hops] toolsCalled=${JSON.stringify(toolsCalled)}`);
    console.log(`[hops] ${ids.length} token events: ${JSON.stringify(ids)}`);

    // A run that never called a tool proves nothing either way. Fail on it
    // explicitly rather than reporting the missing hops as a feature bug — that
    // ambiguity is what made every live check inconclusive on 2026-08-17.
    expect(
      toolsCalled.length,
      `no tool was called, so no hop could be produced — the run did not exercise ` +
        `the path. Check that "${PROMPT}" still maps to a tool in ` +
        `${VERTICAL}/routing.fixture.json.`,
    ).toBeGreaterThan(0);

    // No gateway configured at all: the probe records mcp_challenge_skipped and
    // every gw-* hop is legitimately absent. That is a deployment this check
    // does not apply to — say so, rather than reporting three missing hops.
    expect(
      ids,
      'this stack has no MCP gateway configured (mcp_challenge_skipped / ' +
        'no_gateway_configured), so gateway hops cannot exist and this check ' +
        'does not apply here',
    ).not.toContain('mcp_challenge_skipped');

    for (const [id, why] of REQUIRED) {
      expect(ids, `${id} — ${why}`).toContain(id);
    }

    // This request carries the tools/call leg only. Discovery is a SEPARATE
    // request (services/agentToolsResolver.js is wired to /agent/init and
    // /demo-agent/tools, never to /invoke), so an invoke response legitimately
    // contains no tools/list challenge — asserting one here would fail against
    // a healthy stack. The tools/list leg is covered by its own test below.
    expect(challengePhases(body), 'the tools/call leg was probed').toContain('tools/call');

    for (const [id, why] of CONFIG_DEPENDENT) {
      console.log(`[hops] ${ids.includes(id) ? 'present' : 'ABSENT '} ${id} — ${why}`);
    }
  });

  // The other half of the question this work started from: "in the MCP dance we
  // call once for the tool list, get 401, then call again after authn — I don't
  // see 2 calls." That first leg is discovery, and it rides on its own request.
  test('discovery produces the tools/list challenge', async ({ page, context }) => {
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');
    await loginAsCustomer(page);

    const resp = await context.request.post('/api/demo-agent/tools', {
      data: { vertical: VERTICAL },
      timeout: 60_000,
    });
    expect(resp.status(), 'tools status').toBe(200);

    const body = await resp.json();
    const ids = (body.tokenEvents || []).map((e) => e.id || e.type);
    console.log(`[list] ${(body.availableTools || []).length} tools, events: ${JSON.stringify(ids)}`);
    console.log(`[list] challenge phases: ${JSON.stringify(challengePhases(body))}`);

    // Discovery falling back to the hardcoded catalog is exactly regression
    // #1949, where a token with no `sub` was rejected and every run silently
    // used the BANKING tool list. `degraded` is how that surfaces.
    expect(body.degraded, `discovery degraded: ${body.degradedReason || 'no reason given'}`)
      .toBeFalsy();
    expect(challengePhases(body), 'the tools/list leg was probed').toContain('tools/list');

    // The MCP lifecycle. This is the leg that opens the session: the Agent
    // Gateway is the MCP client here and runs initialize ->
    // notifications/initialized -> tools/list -> close, per call.
    //
    // Asserted rather than reported, because it is now verified live (#2049) and
    // because it took three attempts to get here — #1977 put the report on the
    // gateway's HTTP response header while discovery arrives over a WebSocket,
    // and #2023 instrumented a Groovy script that never executes. Both shipped
    // green. If this ever goes quiet again, that is a regression, not a
    // configuration difference, and it should fail rather than print a note.
    expect(ids, 'the gateway reported the MCP session it opened').toContain('mcp-initialize');
    expect(ids, 'and the notification that makes the session usable')
      .toContain('mcp-initialized');
  });
});
