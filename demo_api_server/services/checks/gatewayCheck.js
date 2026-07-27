'use strict';
const { callPingGateway } = require('../pingGatewayClient');
// Static, NOT a lazy require inside run(): the jest setup calls resetModules(),
// which gives a lazy require a FRESH module and silently bypasses jest.mock —
// the check then passes in isolation while failing under test for no visible
// reason. Same landmine as the LLM intent-grammar suite.
const { resolveMcpAccessTokenWithEvents } = require('../agentMcpTokenService');
const { register } = require('./registry');

// Read-only banking tool for the mcp-call probe. Confirmed against
// mcp-tool-schemas.json (Task 3 Step 1): source "olb", inputSchema.required
// is [] (no required arguments), so the empty {} arguments object below is
// valid for this tool — unlike get_account_balance, whose schema requires
// account_id and would reject an empty-args call.
const TOOL_NAME = 'get_my_accounts';

const realPath = {
  id: 'gateway.real_path', name: 'Real gateway path (introspect -> authorize -> mcp-call)',
  category: 'Agent Gateway',
  severity: 'gate',
  // Default run when PingGateway is selected — required for READY on SE.
  appliesWhen: (flags) => flags.ff_mcp_gateway_pinggateway === true,
  async run(ctx) {
    const userToken = ctx.req?.session?.oauthTokens?.accessToken;
    if (!userToken || userToken === '_cookie_session') {
      return {
        status: 'fail',
        detail: 'No live user session token',
        nextAction: 'Sign in with the demo user, open Demo check, Run again',
      };
    }
    const hops = [];
    const fail = (name, detail) => { hops.push({ name, status: 'fail', detail }); return { status: 'fail', detail: `${name}: ${detail}`, meta: { hops } }; };

    let gwToken;
    try {
      // Mint the token the way the DEMO does, not a bespoke exchange.
      //
      // This used to call performTokenExchange directly with an aud/scope pair
      // assembled here. Both resolved correctly (aud
      // https://api.ping.demo:3036/mcp, scope gateway:mcp:invoke — identical to
      // what IG sees on a working call), and IG still answered 401. A token that
      // merely carries the right aud and scope is not the same token the real
      // path presents: resolveMcpAccessTokenWithEvents does the full two-exchange
      // chain and the surrounding context the gateway authenticates against.
      //
      // A check that mints its own credential does not test the demo — it tests
      // the check. Using the production path means a red here is a real finding
      // about the demo, which is the only kind worth showing before a talk.
      const minted = await resolveMcpAccessTokenWithEvents(ctx.req, TOOL_NAME, {});
      gwToken = typeof minted === 'string' ? minted : (minted && (minted.token || minted.accessToken));
      if (!gwToken) return fail('token-exchange', 'no MCP access token was minted for this session');
    } catch (err) { return fail('token-exchange', (err && (err.message || err.code)) || 'token minting failed'); }

    // ONE authenticated tools/call. There is deliberately no /introspect or
    // /authorize hop: those were written for the Node demo gateway, but this
    // check is gated to ff_mcp_gateway_pinggateway === true, i.e. it only ever
    // runs against PingGateway (IG) — where they are FILTERS INSIDE the route
    // chain, not endpoints. Probed live: /introspect 404, /authorize 404,
    // /mcp 401, /health 200. So the gate could never pass in the only mode it
    // runs in, and had been failing for that reason alone.
    //
    // Introspection and the authorize decision still happen; they are reported
    // in IG's own filter chain. WHO decided and what is enforcing is asserted
    // by gateway.posture, which reads it from the source rather than inferring
    // it from three round trips that never existed.
    let r;
    try {
      r = await callPingGateway('POST', '/mcp', {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: TOOL_NAME, arguments: {} },
      }, { token: gwToken });
    } catch (err) {
      // Name the hop. Unwrapped, a transport error escaped to the runner and
      // arrived as a bare code with no indication of where it happened.
      return fail('mcp-call', (err && (err.message || err.code)) || 'transport error');
    }
    if (r.statusCode === 401 || r.statusCode === 403) {
      return fail('mcp-call', `gateway refused the token (status ${r.statusCode}) — enforcement is ON and this token did not satisfy it`);
    }
    if (!(r.statusCode < 300 && r.body?.result && !r.body?.error)) {
      return fail('mcp-call', `status=${r.statusCode} error=${JSON.stringify(r.body?.error) || 'none'}`);
    }
    hops.push({ name: 'mcp-call', status: 'pass', detail: `${TOOL_NAME} tools/call returned a result` });

    return {
      status: 'pass',
      detail: `${TOOL_NAME} completed through the real gateway path`,
      meta: { hops },
    };
  },
};

register(realPath);
module.exports = { realPath };
