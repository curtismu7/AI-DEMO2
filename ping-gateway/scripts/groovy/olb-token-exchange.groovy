/*
 * olb-token-exchange.groovy
 *
 * Exchange #3: exchanges the inbound gateway-scoped token (gateway:mcp:invoke)
 * for a backend OLB token (mcpserver.ping.demo / read) using client_secret_post.
 *
 * MCP HTTP session lifecycle (per MCP spec):
 *   1. POST /mcp {"method":"initialize"} → receive Mcp-Session-Id
 *   2. Forward actual request with Mcp-Session-Id header
 *
 * On exchange failure: returns 401 {"error":"token_exchange_failed","pingone_error":"..."}.
 */

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

// ── Env ───────────────────────────────────────────────────────────────────────
def tokenEndpoint   = System.getenv('PINGONE_TOKEN_ENDPOINT') ?: ''
def teClientId      = System.getenv('TE_CLIENT_ID') ?: ''
def teClientSecret  = System.getenv('TE_CLIENT_SECRET') ?: ''
def olbAudience     = System.getenv('PG_OLB_RESOURCE_URI') ?: ''
def olbScope        = System.getenv('PG_OLB_SCOPE') ?: ''
def mcpBaseUrl      = System.getenv('PG_OLB_BACKEND_URL') ?: 'http://mcp-server:8080'
def mcpUrl          = mcpBaseUrl.replaceAll('/+$', '') + '/mcp'

// ── Blocking HTTP helper (form-encoded) ──────────────────────────────────────
def httpPostForm = { String url, String reqBody ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'POST'
        conn.doOutput = true
        conn.connectTimeout = 5000
        conn.readTimeout = 10000
        conn.setRequestProperty('Content-Type', 'application/x-www-form-urlencoded')
        conn.outputStream.withWriter('UTF-8') { it.write(reqBody) }
        def code = conn.responseCode
        def body = ''
        try { body = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: '' } catch (Exception ignored) {}
        return [code: code, body: body]
    } catch (Exception e) {
        logger.warn('[OlbExchange] httpPostForm failed: ' + e.message)
        return [code: 0, body: '']
    }
}

// ── Blocking HTTP helper (JSON, returns response headers too) ─────────────────
def httpPostJson = { String url, String jsonBody, Map hdrs ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'POST'
        conn.doOutput = true
        conn.connectTimeout = 5000
        conn.readTimeout = 10000
        hdrs.each { k, v -> conn.setRequestProperty(k as String, v as String) }
        conn.outputStream.withWriter('UTF-8') { it.write(jsonBody) }
        def code = conn.responseCode
        def respHeaders = conn.headerFields  // Map<String, List<String>>
        def body = ''
        try { body = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: '' } catch (Exception ignored) {}
        return [code: code, body: body, headers: respHeaders]
    } catch (Exception e) {
        logger.warn('[OlbExchange] httpPostJson failed: ' + e.message)
        return [code: 0, body: '', headers: [:]]
    }
}

// ── Extract subject token from inbound Authorization header ───────────────────
def authHeader = request.headers.getFirst('Authorization') ?: ''
def subjectToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''

if (!subjectToken) {
    logger.warn('[OlbExchange] No bearer token in Authorization header')
    def r = new Response(Status.UNAUTHORIZED)
    r.entity.setString('{"error":"no_subject_token"}')
    return Promises.newResultPromise(r)
}

// ── Exchange #3: get OLB token from PingOne ───────────────────────────────────
def params = [
    'grant_type'           : 'urn:ietf:params:oauth:grant-type:token-exchange',
    'subject_token'        : subjectToken,
    'subject_token_type'   : 'urn:ietf:params:oauth:token-type:access_token',
    'requested_token_type' : 'urn:ietf:params:oauth:token-type:access_token',
    'audience'             : olbAudience,
    'scope'                : olbScope,
    'client_id'            : teClientId,
    'client_secret'        : teClientSecret,
]
def formBody = params.collect { k, v ->
    java.net.URLEncoder.encode(k, 'UTF-8') + '=' + java.net.URLEncoder.encode(v as String, 'UTF-8')
}.join('&')

logger.info('[OlbExchange] REQUEST → ' + tokenEndpoint + ' audience=' + olbAudience + ' scope=' + olbScope)
def exchangeResp = httpPostForm(tokenEndpoint, formBody)
logger.info('[OlbExchange] RESPONSE HTTP ' + exchangeResp.code)

if (exchangeResp.code != 200) {
    logger.warn('[OlbExchange] Exchange FAILED HTTP ' + exchangeResp.code + ' body=' + exchangeResp.body)
    def errResp = new Response(Status.UNAUTHORIZED)
    errResp.headers.put('Content-Type', ['application/json'])
    def pingOneError = [:]
    try { pingOneError = new JsonSlurper().parseText(exchangeResp.body ?: '{}') } catch (Exception ignored) {}
    errResp.entity.setString(JsonOutput.toJson([
        error         : 'token_exchange_failed',
        http_status   : exchangeResp.code,
        pingone_error : pingOneError,
    ]))
    return Promises.newResultPromise(errResp)
}

def exchangeParsed = new JsonSlurper().parseText(exchangeResp.body ?: '{}')
def issuedToken = exchangeParsed?.access_token as String

if (!issuedToken) {
    logger.warn('[OlbExchange] No access_token in exchange response')
    def errResp = new Response(Status.BAD_GATEWAY)
    errResp.entity.setString('{"error":"no_access_token_in_exchange"}')
    return Promises.newResultPromise(errResp)
}
logger.info('[OlbExchange] Exchange #3 succeeded — token_type=' + (exchangeParsed?.token_type ?: '?'))

// ── MCP session: send initialize to get Mcp-Session-Id ───────────────────────
def initHdrs = [
    'Content-Type'        : 'application/json',
    'Authorization'       : 'Bearer ' + issuedToken,
    'MCP-Protocol-Version': '2025-11-25',
]
def initBody = JsonOutput.toJson([
    jsonrpc: '2.0',
    id     : 'pg-init-1',
    method : 'initialize',
    params : [
        protocolVersion: '2025-11-25',
        capabilities   : [:],
        clientInfo     : [name: 'PingGateway', version: '2026.3'],
    ],
])
logger.info('[OlbExchange] Sending MCP initialize to ' + mcpUrl)
def initResp = httpPostJson(mcpUrl, initBody, initHdrs)
logger.info('[OlbExchange] MCP initialize response HTTP ' + initResp.code)

if (initResp.code != 200) {
    logger.warn('[OlbExchange] MCP initialize FAILED: ' + initResp.body)
    def errResp = new Response(Status.BAD_GATEWAY)
    errResp.headers.put('Content-Type', ['application/json'])
    errResp.entity.setString(JsonOutput.toJson([error: 'mcp_initialize_failed', http_status: initResp.code, detail: initResp.body]))
    return Promises.newResultPromise(errResp)
}

// Extract Mcp-Session-Id (Node sends lowercase header name)
def sessionIdList = initResp.headers['mcp-session-id'] ?: initResp.headers['Mcp-Session-Id']
def sessionId = sessionIdList?.getAt(0) as String

if (!sessionId) {
    logger.warn('[OlbExchange] No Mcp-Session-Id in initialize response headers: ' + initResp.headers.keySet())
    def errResp = new Response(Status.BAD_GATEWAY)
    errResp.entity.setString('{"error":"no_mcp_session_id"}')
    return Promises.newResultPromise(errResp)
}
logger.info('[OlbExchange] MCP session established: ' + sessionId)

// ── Forward tool call directly via httpPostJson (bypasses ReverseProxyHandler) ─
// reason: request.entity can be consumed by upstream filters (McpValidation,
// P1AZDecision both read the body); the ReverseProxyHandler then forwards an
// empty body, causing the MCP server to return a parse error wrapped as 403.
def rawBody = ''
try { rawBody = request.entity.string ?: '' } catch (Exception ignored) {}
logger.info('[OlbExchange] Forwarding tool call directly session=' + sessionId + ' body_len=' + rawBody.length())

def toolHdrs = [
    'Content-Type'        : 'application/json',
    'Accept'              : 'application/json, text/event-stream',
    'Authorization'       : 'Bearer ' + issuedToken,
    'MCP-Protocol-Version': '2025-11-25',
    'mcp-session-id'      : sessionId,
]
def toolResp = httpPostJson(mcpUrl, rawBody, toolHdrs)
logger.info('[OlbExchange] MCP direct response HTTP ' + toolResp.code
    + ' body_preview=' + (toolResp.body?.take(200) ?: '(empty)'))

// Build IG response from MCP server result. Forward the MCP server's own status so
// 4xx semantics (e.g. a 403 auth/HITL challenge) reach the BFF intact rather than
// being flattened to 502 — collapsing every non-200 to BAD_GATEWAY hid those signals.
// Only a transport failure (code 0) maps to 502.
def igStatus = (toolResp.code > 0) ? Status.valueOf(toolResp.code) : Status.BAD_GATEWAY
def finalResp = new Response(igStatus)
finalResp.headers.put('Content-Type', ['application/json'])
if (toolResp.body) finalResp.entity.setString(toolResp.body)
return Promises.newResultPromise(finalResp)
