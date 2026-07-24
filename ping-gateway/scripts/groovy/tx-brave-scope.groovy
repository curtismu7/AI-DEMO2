// ping-gateway/scripts/groovy/tx-brave-scope.groovy
//
// Agent Gateway (IG) demo policy for /mcp/brave: TWO independent checks must
// both pass before a tools/call reaches the real Brave Search API.
//   1. Client identity: the caller's introspected token's client_id must be
//      an ALLOWED app (an EXISTING PingOne app reused as a stand-in signal —
//      no new PingOne provisioning). Allowed: "Super Banking Investment
//      Advisor Agent" (client_id 0bba2bb8-896b-42ae-bb56-503d3c75f82e).
//      NOTE: this checks WHICH APP minted the token, not WHAT SCOPE it
//      carries — deliberately, because no client_credentials-obtainable
//      token in this PingOne environment can carry both the gateway's entry
//      scope (gateway:mcp:invoke) and invest:read on the same token (see the
//      implementation plan's Task 2 design note for the live-tested proof).
//      client_id is a public identifier, not a secret — safe to hardcode.
//   2. Content blocklist: the tools/call query argument must not contain a
//      blocked term (bank policy demo: no crypto-related searches via the
//      agent gateway).
// Also checks a live feature flag (ff_brave_mcp_showcase) the same way
// tx-weather-scope.groovy checks ff_weather_mcp_showcase.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_BRAVE_FLAG_URL') ?: ''

def ALLOWED_CLIENT_IDS = ['0bba2bb8-896b-42ae-bb56-503d3c75f82e'] as Set // Investment Advisor Agent
def BLOCKED_TERMS = ['bitcoin', 'cryptocurrency', 'crypto'] as Set

// Live flag check against the BFF: ff_brave_mcp_showcase (on/off). Fails OPEN
// (a demo toggle, not a security control) — same posture as tx-weather-scope's
// weatherFlags() closure. The scope/content checks below remain fail-closed
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

// ── Check 1: client identity ─────────────────────────────────────────────
def tokenInfo = [:]
try {
    def oauth2Ctx = contexts['oauth2']
    if (oauth2Ctx != null) {
        def accessToken = oauth2Ctx.accessToken
        if (accessToken != null) {
            def info = accessToken.getInfo()
            tokenInfo = (info instanceof Map ? info : [:]) ?: [:]
        }
    }
} catch (Exception e) {
    logger.warn('[TxBraveScope] failed to read contexts[oauth2]: ' + e.message)
}
def callerClientId = tokenInfo['client_id'] ?: ''
if (!ALLOWED_CLIENT_IDS.contains(callerClientId)) {
    return denied(id, "Agent Gateway: Brave search is not enabled for this caller (client_id not on the allowed list)")
}

// ── Check 2: content blocklist ────────────────────────────────────────────
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
