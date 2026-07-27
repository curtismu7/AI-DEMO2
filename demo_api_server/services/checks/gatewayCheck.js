'use strict';
const { callPingGateway } = require('../pingGatewayClient');
const oauth = require('../oauthService');
const configStore = require('../configStore');
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
      // PingGateway (IG) requires the token aud to be its HTTPS resource URI
      // and a coarse gateway-invoke scope — not the demo/Node gateway audience.
      // Matches resolveExpectedMcpResourceUri() (mcpToolAuthorizationService.js)
      // and the Exchange #2 aud/scope resolution in agentMcpTokenService.js.
      const aud = configStore.getEffective('pingone_resource_pinggateway_uri');
      const scope = configStore.getEffective('gateway_mcp_invoke_scope') || 'gateway:mcp:invoke';
      gwToken = await oauth.performTokenExchange(userToken, aud, [scope]);
    } catch (err) { return fail('token-exchange', err.message); }

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
      });
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
