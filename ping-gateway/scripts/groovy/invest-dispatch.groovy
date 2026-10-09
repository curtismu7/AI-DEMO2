/*
 * invest-dispatch.groovy — route resource-server-backed tools to the invest backend.
 *
 * IG selects a route by URI PATH. Everything the BFF posts goes to `/mcp`, which
 * `01-mcp-olb.json` claims, so every tool landed on the banking MCP server — and a
 * resource-server tool came back as `Unknown tool: "<name>"` inside an HTTP 200.
 * The `/mcp/invest` route exists but nothing ever requests that path.
 *
 * A condition cannot fix this: the backend is chosen by the tool NAME, which lives
 * in the JSON-RPC body, and IG conditions are evaluated before the body is read.
 * So this runs as a filter inside the `/mcp` route and dispatches on the body:
 *
 *   tools/call for an invest-backend tool → Exchange #3 → POST the same JSON-RPC
 *   envelope to demo_mcp_resource_server, and return its response (terminal — the
 *   OLB exchange and reverse proxy below never run).
 *
 *   anything else → next.handle(), i.e. the OLB path, unchanged.
 *
 * The backend hop is HTTP because the resource server now serves MCP over
 * `POST /mcp`; it used to be WebSocket-only, which IG cannot speak at all.
 *
 * Idioms mirror olb-token-exchange.groovy (RFC 8707 `resource=`, client_secret_post,
 * self-forward via HttpURLConnection — http.send().get() deadlocks the Vert.x event
 * loop) and apikey-dispatch.groovy (read the body, dispatch by tool name).
 *
 * Inbound token validation, scope enforcement and the P1AZ decision all run in
 * earlier filters on this route, so by the time we run the caller is authorized.
 * P1AZ in particular still sees the ORIGINAL inbound token, so the a2aDelegated
 * tools keep being judged on their nested `act` chain — this filter only changes
 * which backend receives the call, never whether it is allowed.
 *
 * The four invest tools call back into the BFF (`/api/investment/.../portfolio`).
 * That route accepts PINGONE_RESOURCE_MCP_RESOURCE_SERVER_URI (comma-list; must
 * include mcp-invest.ping.demo after #1269). refresh-service-envs upserts it from
 * scope-topology.json so Exchange #3 tokens are not 401'd against a stale
 * mcp-resource-server-only value.
 */
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

// Tools served by demo_mcp_resource_server rather than the banking MCP server.
// Mirrors AIRLINES_TOOLS + INVEST_TOOLS in demo_mcp_gateway/src/router.ts.
//
// pay_airline_fee / cancel_airline_reservation / sensitive_airline_bookings /
// sensitive_passenger_record were missing here even though router.ts has always
// had them (found 2026-08-24 while chasing a live UC7 pay_airline_fee failure):
// demo_mcp_gateway is scaled to 0 replicas on the SE cluster, so this Groovy
// filter — not router.ts — is what actually dispatches every tool call there,
// and an airlines write tool absent from this set falls through to the OLB
// chain, where the BFF's airlines plugin disowns it ("no handler for
// pay_airline_fee"). Adding the remaining four completes the mirror.
//
// It did not. get_loyalty_status and redeem_miles were still absent, and UC38
// died the same way -- "no handler for redeem_miles" -- with the P1AZ decision
// reading PERMIT, because dispatch happens after authorization. Found live
// 2026-08-26. Three hand-kept copies of this list existed (here, router.ts, and
// the dispatch test's own array) with no parity gate between them, so each fix
// corrected one copy and left the others to be rediscovered.
//
// demo_mcp_gateway/tests/airlinesDispatch.test.ts now derives the expected set
// from demo_mcp_resource_server's exported AIRLINES_TOOL_NAMES and holds BOTH
// this file and router.ts to it. Add a handler there and this list is required
// to follow.
def INVEST_BACKEND_TOOLS = [
    'get_airline_bookings',
    'get_flight_status',
    'check_seat_availability',
    'pay_airline_fee',
    'book_airline_flight',
    'cancel_airline_reservation',
    'sensitive_airline_bookings',
    'sensitive_passenger_record',
    'get_loyalty_status',
    'redeem_miles',
    'get_investment_accounts',
    'get_investment_balance',
    'get_investment_transactions',
    'get_portfolio_summary',
] as Set

// Scope to request on the backend token, per tool. Must match the tool's
// requiredScopes in scope-topology.json or the resource server answers -32005.
def SCOPE_FOR_TOOL = [
    get_airline_bookings       : 'airlines:read',
    get_flight_status          : 'airlines:read',
    check_seat_availability    : 'airlines:read',
    pay_airline_fee            : 'airlines:read airlines:write',
    book_airline_flight        : 'airlines:read airlines:write',
    cancel_airline_reservation : 'airlines:read airlines:write',
    sensitive_airline_bookings : 'airlines:read sensitive:read',
    sensitive_passenger_record : 'read',
    get_loyalty_status         : 'airlines:read',
    redeem_miles               : 'airlines:read airlines:write',
    get_investment_accounts    : 'invest:read',
    get_investment_balance     : 'invest:read',
    get_investment_transactions: 'invest:read',
    get_portfolio_summary      : 'invest:read',
]

// ── Env ───────────────────────────────────────────────────────────────────────
def tokenEndpoint  = System.getenv('PINGONE_TOKEN_ENDPOINT') ?: ''
def teClientId     = System.getenv('TE_CLIENT_ID') ?: ''
def teClientSecret = System.getenv('TE_CLIENT_SECRET') ?: ''
// PingFederate secondary issuer (2026-09-22 A2A-under-PF): PF-issued subject
// tokens cannot be exchanged by PingOne. Route Exchange #3 to PF when the
// subject's iss matches PF_ISSUER_URI.
def pfIssuer        = System.getenv('PF_ISSUER_URI') ?: ''
def pfTokenEndpoint = System.getenv('PF_TOKEN_ENDPOINT') ?: ''
def pfTeClientId    = System.getenv('PF_TE_CLIENT_ID') ?: ''
def pfTeClientSecret= System.getenv('PF_TE_CLIENT_SECRET') ?: ''
def pfTeAuthMethod  = (System.getenv('PF_TE_AUTH_METHOD') ?: 'basic').toLowerCase()
def pfExchangeConfigValid = {
    if (!pfIssuer || !pfTokenEndpoint || !pfTeClientId || !pfTeClientSecret) return false
    if (!(pfTeAuthMethod in ['basic', 'client_secret_basic', 'post', 'client_secret_post'])) return false
    try {
        def issuerUri = new java.net.URI(pfIssuer)
        def endpointUri = new java.net.URI(pfTokenEndpoint)
        return issuerUri.scheme?.equalsIgnoreCase('https') && endpointUri.scheme?.equalsIgnoreCase('https') &&
            issuerUri.authority && issuerUri.authority == endpointUri.authority &&
            !issuerUri.userInfo && !endpointUri.userInfo && endpointUri.path
    } catch (Exception ignored) {
        return false
    }
}
def investAudience = System.getenv('PG_MCP_RESOURCE_SERVER_URI') ?: ''
def investBaseUrl  = System.getenv('PG_INVEST_BACKEND_URL') ?: 'http://mcp-resource-server:8081'
def investMcpUrl   = investBaseUrl.replaceAll('/+$', '') + '/mcp'

// ── Read the JSON-RPC envelope ────────────────────────────────────────────────
def bodyStr = ''
try { bodyStr = request.entity.string ?: '' } catch (Exception ignored) {}

def rpc
try { rpc = new JsonSlurper().parseText(bodyStr ?: '{}') } catch (Exception ignored) { rpc = [:] }

def toolName = (rpc?.method == 'tools/call') ? (rpc?.params?.name as String) : null

// Not ours — hand back to the OLB chain untouched.
if (!toolName || !INVEST_BACKEND_TOOLS.contains(toolName)) {
    return next.handle(context, request)
}

def rpcId = rpc?.id

// A JSON-RPC error rides a 200 envelope; an HTTP error code would surface in the
// UI as a transport failure instead of a tool failure.
def rpcError = { id, code, message ->
    def r = new Response(Status.OK)
    r.headers.put('Content-Type', ['application/json'])
    r.entity.setString(JsonOutput.toJson([jsonrpc: '2.0', id: id, error: [code: code, message: message]]))
    return r
}
def safeScopeList = { Object scopes ->
    if (!(scopes instanceof Collection)) return []
    return scopes.findAll { it instanceof String && (it as String) ==~ /[A-Za-z0-9*:._\/-]{1,128}/ }
        .unique().take(64)
}
// The BFF maps JSON-RPC -32005 to its scope-recovery response. Preserve only
// that code and bounded scope names; never forward backend error text or data.
def sanitizeMcpResponse = { String body ->
    try {
        def envelope = new JsonSlurper().parseText(body ?: '{}')
        if (envelope?.error) {
            def err = envelope.error
            if (err.code == -32005) {
                def errorData = err.data instanceof Map ? err.data : [:]
                def requiredSource = errorData.requiredScopes instanceof Collection
                    ? errorData.requiredScopes
                    : (errorData.requiredScope instanceof String ? [errorData.requiredScope] : [])
                def requiredScopes = safeScopeList(requiredSource)
                def availableScopes = safeScopeList(errorData.availableScopes)
                def missingScopes = requiredScopes.findAll { !availableScopes.contains(it) }
                return [
                    body: JsonOutput.toJson([
                        jsonrpc: '2.0',
                        id: envelope.id,
                        error: [
                            code: -32005,
                            message: 'insufficient_scope',
                            data: [requiredScopes: requiredScopes, missingScopes: missingScopes, availableScopes: availableScopes],
                        ],
                    ]),
                    isError: true,
                    scopeDenied: true,
                ]
            }
            return [
                body: JsonOutput.toJson([jsonrpc: '2.0', id: envelope.id, error: [code: -32603, message: 'mcp_tool_call_failed']]),
                isError: true,
                scopeDenied: false,
            ]
        }
        return [body: body ?: '{}', isError: false, scopeDenied: false]
    } catch (Exception ignored) {
        return [body: JsonOutput.toJson([jsonrpc: '2.0', id: rpcId, error: [code: -32603, message: 'mcp_tool_call_failed']]), isError: true, scopeDenied: false]
    }
}

// ── Blocking HTTP helpers ─────────────────────────────────────────────────────
def httpPostForm = { String url, String reqBody, Map hdrs ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'POST'
        conn.doOutput = true
        conn.connectTimeout = 5000
        conn.readTimeout = 10000
        conn.setRequestProperty('Content-Type', 'application/x-www-form-urlencoded')
        hdrs.each { k, v -> conn.setRequestProperty(k as String, v as String) }
        conn.outputStream.withWriter('UTF-8') { it.write(reqBody) }
        def code = conn.responseCode
        def text = ''
        try { text = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: '' } catch (Exception ignored) {}
        return [code: code, body: text]
    } catch (Exception e) {
        logger.warn('[InvestDispatch] token endpoint transport error')
        return [code: 0, body: '']
    }
}

def httpPostJson = { String url, String reqBody, String bearer ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'POST'
        conn.doOutput = true
        conn.connectTimeout = 5000
        conn.readTimeout = 30000
        conn.setRequestProperty('Content-Type', 'application/json')
        conn.setRequestProperty('Accept', 'application/json')
        if (bearer) conn.setRequestProperty('Authorization', 'Bearer ' + bearer)
        conn.outputStream.withWriter('UTF-8') { it.write(reqBody) }
        def code = conn.responseCode
        def text = ''
        try { text = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: '' } catch (Exception ignored) {}
        return [code: code, body: text]
    } catch (Exception e) {
        logger.warn('[InvestDispatch] backend transport error')
        return [code: 0, body: '']
    }
}

// ── Subject token ─────────────────────────────────────────────────────────────
def authHeader = request.headers.getFirst('Authorization') ?: ''
def subjectToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
if (!subjectToken) {
    logger.warn('[InvestDispatch] No bearer token in Authorization header')
    return Promises.newResultPromise(rpcError(rpcId, -32001, 'No subject token'))
}

// Determine the issuer before checking provider-specific configuration. A PF
// subject must fail closed here instead of falling through to PingOne.
def subjectIss = ''
def subjectTyp = ''
try {
    def p = subjectToken.split('\\.', -1)
    if (p.length == 3) {
        subjectIss = new JsonSlurper().parseText(new String(java.util.Base64.getUrlDecoder().decode(p[1]), 'UTF-8'))['iss'] ?: ''
        subjectTyp = new JsonSlurper().parseText(new String(java.util.Base64.getUrlDecoder().decode(p[0]), 'UTF-8'))['typ'] ?: ''
    }
} catch (Exception ignored) {}
def isPfSubject = pfIssuer && subjectIss == pfIssuer
if (isPfSubject && !pfExchangeConfigValid()) {
    logger.warn('[InvestDispatch] PF Exchange #3 is not configured')
    return Promises.newResultPromise(rpcError(rpcId, -32603, 'pf_exchange_not_configured'))
}

if (!isPfSubject && (!tokenEndpoint || !teClientId || !teClientSecret || !investAudience)) {
    logger.warn('[InvestDispatch] Missing exchange config (PINGONE_TOKEN_ENDPOINT / TE_CLIENT_ID / TE_CLIENT_SECRET / PG_MCP_RESOURCE_SERVER_URI)')
    return Promises.newResultPromise(rpcError(rpcId, -32603, 'Invest backend not configured'))
}

// ── Exchange #3 → the invest backend audience ─────────────────────────────────
// RFC 8707: PingOne needs `resource=` to narrow to ONE resource server when the
// TE client holds grants on several; `audience=` alone is silently ignored and
// the issued token keeps the gateway aud, which the backend then rejects.
def wantScope = SCOPE_FOR_TOOL[toolName]
logger.info('[InvestDispatch] provider=' + (isPfSubject ? 'pingfederate' : 'pingone') + ' subject_typ=' + (subjectTyp ?: '(unset)'))
// Only an exactly typed PF ID-JAG subject uses id-jag typing. All other
// subjects, including ordinary PF ATM access tokens, use access_token.
def subjectType = (isPfSubject && subjectTyp == 'oauth-id-jag+jwt')
    ? 'urn:ietf:params:oauth:token-type:id-jag'
    : 'urn:ietf:params:oauth:token-type:access_token'
def exEndpoint  = isPfSubject ? pfTokenEndpoint : tokenEndpoint
def exClientId  = isPfSubject ? pfTeClientId : teClientId
def exClientSecret = isPfSubject ? pfTeClientSecret : teClientSecret
def params = [
    'grant_type'          : 'urn:ietf:params:oauth:grant-type:token-exchange',
    'subject_token'       : subjectToken,
    'subject_token_type'  : subjectType,
    'requested_token_type': 'urn:ietf:params:oauth:token-type:access_token',
    // PF mode: resource OMITTED - PF reuses the cached persistent grant for
    // this (client, subject, scope) key, whose token carries aud
    // https://api.ping.demo:3036/mcp; the invest backend accepts that audience
    // (compose env) and the P1AZ decision at the gateway is the real gate.
    'resource'            : (isPfSubject ? null : investAudience),
    'client_id'           : exClientId,
    'client_secret'       : exClientSecret,
]
if (wantScope) params['scope'] = wantScope

def exchangeHeaders = [:]
if (isPfSubject && pfTeAuthMethod in ['basic', 'client_secret_basic']) {
    params.remove('client_id')
    params.remove('client_secret')
    def basic = java.util.Base64.getEncoder().encodeToString((exClientId + ':' + exClientSecret).getBytes('UTF-8'))
    exchangeHeaders['Authorization'] = 'Basic ' + basic
}

def formBody = params.findAll { it.value != null }.collect { k, v ->
    java.net.URLEncoder.encode(k, 'UTF-8') + '=' + java.net.URLEncoder.encode(v as String, 'UTF-8')
}.join('&')

logger.info('[InvestDispatch] tool=' + toolName + ' request provider=' + (isPfSubject ? 'pingfederate' : 'pingone'))
def exchangeResp = httpPostForm(exEndpoint, formBody, exchangeHeaders)
logger.info('[InvestDispatch] Exchange #3 HTTP ' + exchangeResp.code)

if (exchangeResp.code != 200) {
    logger.warn('[InvestDispatch] Exchange failed HTTP ' + exchangeResp.code + ' provider=' + (isPfSubject ? 'pingfederate' : 'pingone'))
    def errResp = new Response(Status.UNAUTHORIZED)
    errResp.headers.put('Content-Type', ['application/json'])
    errResp.entity.setString(JsonOutput.toJson([
        error       : 'token_exchange_failed',
        tool        : toolName,
        http_status : exchangeResp.code,
    ]))
    return Promises.newResultPromise(errResp)
}

def issuedToken = null
try { issuedToken = new JsonSlurper().parseText(exchangeResp.body ?: '{}')?.access_token as String } catch (Exception ignored) {}
if (!issuedToken) {
    logger.warn('[InvestDispatch] No access_token in exchange response')
    return Promises.newResultPromise(rpcError(rpcId, -32603, 'No access_token in exchange response'))
}

// ── Forward the original JSON-RPC envelope to the resource server ─────────────
def beResp = httpPostJson(investMcpUrl, bodyStr, issuedToken)
logger.info('[InvestDispatch] resource server HTTP ' + beResp.code)

if (beResp.code == 0) {
    return Promises.newResultPromise(rpcError(rpcId, -32603, 'Invest backend unreachable'))
}

def safeBackend = sanitizeMcpResponse(beResp.body ?: '')
if (safeBackend.scopeDenied || safeBackend.isError) {
    def out = new Response(Status.OK)
    out.headers.put('Content-Type', ['application/json'])
    out.entity.setString(safeBackend.body)
    return Promises.newResultPromise(out)
}

if (beResp.code != 200) {
    logger.warn('[InvestDispatch] resource server request failed HTTP ' + beResp.code)
    return Promises.newResultPromise(rpcError(rpcId, -32603, 'mcp_tool_call_failed'))
}

// Successful MCP tool results pass through unchanged. Error envelopes above
// use a stable message and never echo a backend response body.
def out = new Response(Status.OK)
out.headers.put('Content-Type', ['application/json'])
out.entity.setString(beResp.body ?: '{}')
return Promises.newResultPromise(out)
