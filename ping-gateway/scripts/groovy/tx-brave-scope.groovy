// ping-gateway/scripts/groovy/tx-brave-scope.groovy
//
// Agent Gateway (IG) demo policy for /mcp/brave: the tools/call query
// argument must not contain a blocked term (bank policy demo: no
// crypto-related searches via the agent gateway) before reaching the real
// Brave Search API.
//
// NOTE ON SCOPE: an earlier revision of this filter also checked the
// caller's token client_id (either scope-membership, then client-identity)
// as a second, per-caller allow/deny signal. Both were removed after live
// testing on the real PingOne environment proved neither is demonstrable
// here: no client_credentials-obtainable token can pass the gateway's base
// rsFilter admission gate at all (confirmed for every app in
// scope-topology.json — only the two-exchange delegation chain ever mints
// an rsFilter-passing token), and that chain's token always carries the
// SAME top-level client_id (the MCP Token Exchanger) regardless of which
// user or specialist agent is acting — the per-specialist identity lives in
// a nested act.sub claim that only varies via the A2A chat delegation path,
// out of scope for this plan (see the implementation plan's Task 2/Task 4
// design notes for the full live-tested proof). A per-caller identity check
// is left for a future plan that's allowed to drive that path.
//
// Also checks a live feature flag (ff_brave_mcp_showcase) the same way
// tx-weather-scope.groovy checks ff_weather_mcp_showcase.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_BRAVE_FLAG_URL') ?: ''

def BLOCKED_TERMS = ['bitcoin', 'cryptocurrency', 'crypto'] as Set

// Live flag check against the BFF: ff_brave_mcp_showcase (on/off). Fails OPEN
// (a demo toggle, not a security control) — same posture as tx-weather-scope's
// weatherFlags() closure. The content check below remains fail-closed
// regardless of this call's outcome.
def braveFlags = {
    def result = [enabled: true]
    if (!flagUrl) return result
    try {
        def conn = new URL(flagUrl).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'GET'
        conn.connectTimeout = 2000
        conn.readTimeout = 3000
        if (internalSecret) conn.setRequestProperty('x-internal-gateway-secret', internalSecret)
        def code = conn.responseCode
        if (code != 200) {
            logger.warn('[TxBraveScope] flag check HTTP ' + code + ' — failing open (enabled)')
            return result
        }
        def respBody = conn.inputStream?.text ?: '{}'
        def parsed = new JsonSlurper().parseText(respBody)
        result.enabled = parsed.enabled != false
        return result
    } catch (Exception e) {
        logger.warn('[TxBraveScope] flag check failed: ' + e.message + ' — failing open (enabled)')
        return result
    }
}

def denied = { Object id, String message ->
    def resp = new Response(Status.FORBIDDEN)
    resp.headers.put('Content-Type', 'application/json')
    resp.entity.setString(JsonOutput.toJson([
        jsonrpc: '2.0',
        id: id,
        error: [code: -32000, message: message],
    ]))
    return Promises.newResultPromise(resp)
}

def body
try {
    body = new JsonSlurper().parseText(request.entity.string ?: '')
} catch (Exception e) {
    body = null
}

def id = (body instanceof Map && body.containsKey('id')) ? body.id : null

def flags = braveFlags()
if (!flags.enabled) {
    return denied(id, 'Agent Gateway: Brave search capability disabled (ff_brave_mcp_showcase is off)')
}

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

// ── Content blocklist ─────────────────────────────────────────────────────
def params = body.params
def args = (params instanceof Map) ? params.arguments : null
def query = (args instanceof Map) ? args.query : null
if (query instanceof String) {
    def normalized = query.toLowerCase()
    def hit = BLOCKED_TERMS.find { normalized.contains(it) }
    if (hit) {
        return denied(id, "Agent Gateway: Brave search query contains a blocked term ('${hit}') — demo bank policy")
    }
}

return next.handle(context, request)
