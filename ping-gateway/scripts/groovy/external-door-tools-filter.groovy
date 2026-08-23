/*
 * external-door-tools-filter.groovy — trims tools/list to a small curated
 * set for 00-mcp-external-door.json traffic (LM Studio, Claude Desktop,
 * self-registered DCR clients).
 *
 * Why: MCPMessageHandler.handleListTools deliberately returns ALL ~44
 * banking tools unfiltered — "scope and vertical filtering belong to the
 * gateway + PingOne Authorize... filtering here too would double-filter"
 * (oauth-mcp/src/server/MCPMessageHandler.ts). That's correct for the
 * internal BFF flow, but the full tool set's schemas/descriptions run to
 * ~18K tokens, which blew past LM Studio's local model context window
 * (8192 tokens) on first live test — a self-registered, less-trusted
 * external client shouldn't get the full internal surface anyway. This is
 * the gateway-side filtering point the comment above points to.
 *
 * The allowed set matches oauth-mcp's own documented publicAccess +
 * restrictedAccess split (see /.well-known/mcp-server, oauth-mcp/README.md
 * "AI Client Setup") — read-only tools plus the small restricted set,
 * excluding admin/vertical-action/everything-else.
 */
import groovy.json.JsonSlurper
import groovy.json.JsonOutput

def ALLOWED_TOOLS = [
    'get_my_accounts', 'get_account_balance', 'get_my_transactions', 'sequential_think',
    'get_sensitive_account_details', 'create_deposit', 'create_withdrawal', 'create_transfer', 'query_user_by_email',
] as Set

// Deliberately does NOT read request.entity at all: reading it drains the stream,
// and every downstream reader (P1AZDecision, then the reverse proxy forwarding to
// mcp-server) needs it intact. A first attempt read-and-inspected the request body
// to detect tools/list and hung the gateway's Vert.x event-loop thread on the very
// first live deploy (empty body forwarded upstream, ReverseProxyHandler waited on a
// response that never completed). Detecting by RESPONSE shape instead needs no
// request-entity access at all: only a tools/list response ever has result.tools as
// a list (tools/call has result.content, initialize has result.protocolVersion, ...).
return next.handle(context, request).thenOnResult { rsp ->
    if (rsp.status.code != 200) return
    try {
        def body = new JsonSlurper().parseText(rsp.entity.string ?: '')
        def tools = body?.result?.tools
        if (tools instanceof List) {
            def before = tools.size()
            body.result.tools = tools.findAll { it?.name in ALLOWED_TOOLS }
            logger.info('[ExternalDoorToolsFilter] tools/list trimmed ' + before + ' -> ' + body.result.tools.size())
            rsp.entity.setString(JsonOutput.toJson(body))
        }
    } catch (Exception e) {
        logger.warn('[ExternalDoorToolsFilter] could not filter tools/list response: ' + e.message)
    }
}
