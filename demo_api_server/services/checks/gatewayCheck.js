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
const RESOURCE_ID = 'accounts:self';

const realPath = {
  id: 'gateway.real_path', name: 'Real gateway path (introspect → authorize → mcp-call)',
  category: 'Agent Gateway', heavy: true,
  appliesWhen: (flags) => flags.ff_mcp_gateway_pinggateway === true,
  async run(ctx) {
    const userToken = ctx.req?.session?.oauthTokens?.accessToken;
    if (!userToken || userToken === '_cookie_session') {
      return { status: 'skip', detail: 'No live user session token — log in and re-run to test the real gateway' };
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

    // Hop 1: introspection
    let r = await callPingGateway('POST', '/introspect', { token: gwToken });
    if (!(r.statusCode < 300 && r.body?.active)) return fail('introspect', `active=${r.body?.active} status=${r.statusCode}`);
    hops.push({ name: 'introspect', status: 'pass', detail: 'active=true' });

    // Hop 2: authorize
    r = await callPingGateway('POST', '/authorize', { token: gwToken, resourceId: RESOURCE_ID });
    if (!(r.statusCode < 300 && r.body?.decision === 'PERMIT')) return fail('authorize', `decision=${r.body?.decision} status=${r.statusCode}`);
    hops.push({ name: 'authorize', status: 'pass', detail: 'PERMIT' });

    // Hop 3: MCP tools/call
    r = await callPingGateway('POST', '/mcp', { jsonrpc: '2.0', method: 'tools/call', params: { name: TOOL_NAME, arguments: {} } });
    if (!(r.statusCode < 300 && r.body?.result && !r.body?.error)) return fail('mcp-call', `status=${r.statusCode} error=${JSON.stringify(r.body?.error) || 'none'}`);
    hops.push({ name: 'mcp-call', status: 'pass', detail: 'tools/call result ok' });

    return { status: 'pass', detail: 'introspect + authorize + mcp-call all succeeded', meta: { hops } };
  },
};

register(realPath);
module.exports = { realPath };
