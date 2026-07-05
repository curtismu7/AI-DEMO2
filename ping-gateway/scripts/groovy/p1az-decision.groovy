/*
 * PingOne Authorize decision filter — parity with the Node gateway's
 * PingOneAuthorizeClient (demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts).
 *
 * Builds the SAME 18-key `parameters` payload buildAuthorizeParameters() sends and
 * POSTs it to:
 *     <BASE>/governance/pap/alpha/policy/<P1AZ_WORKER_ID>/decision
 *
 * LIVE-SWITCHABLE backend (mock demo_authz_server vs real PingOne Authorize):
 * the BFF stamps the X-Authz-Simulated header (value = effective ff_authorize_simulated)
 * on every PingGateway-bound request. This filter reads it PER REQUEST:
 *     true                     -> P1AZ_MOCK_BASE  (demo_authz_server, no worker token)
 *     false (or header absent) -> P1AZ_REAL_BASE  (real PingOne Authorize, client_credentials worker token)
 *
 * SECURITY (demo): X-Authz-Simulated is trusted because the BFF is the sole intended
 * caller. The gateway's host port (3036) is for curl/testing only — a request reaching
 * the gateway directly could spoof this header to force the mock backend. Acceptable for
 * a teaching demo; in production the header would be stripped at the edge or replaced by a
 * server-side toggle.
 *
 * Runs after McpValidationFilter (body parsed) and before OAuth2TokenExchangeFilter
 * (exchange only happens for PERMITted requests).
 *
 * Env vars:
 *   P1AZ_MOCK_BASE          — mock authz base, e.g. http://authz-server:9001
 *   P1AZ_REAL_BASE          — real PingOne Authorize base
 *   P1AZ_WORKER_ID          — worker/policy id in the decision path
 *   P1AZ_WORKER_CLIENT_ID   — client_credentials client (REAL backend only)
 *   P1AZ_WORKER_CLIENT_SECRET
 *   PINGONE_TOKEN_ENDPOINT  — token endpoint for the worker client_credentials grant
 *   PG_GATEWAY_RESOURCE_URI — inbound gateway audience reported as TokenAudience
 *
 * Decision outcomes (fail closed): PERMIT -> continue; DENY / INDETERMINATE / error
 * / timeout / unconfigured -> 403.
 *
 * Emits X-Gw-Audit-Trail response header — JSON containing introspection result and
 * full PingOne Authorize request/response — so the BFF can parse and display it.
 *
 * NOTE: token claims are read from the introspection result. The accessor below
 * (context.attributes['oauth2AccessToken']) matches the scaffold; verify against the
 * live IG OAuth2Context during container bring-up (Phase 5).
 */

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Request
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises
import org.forgerock.util.promise.ResultHandler

// ── Env ───────────────────────────────────────────────────────────────────────
def mockBase            = System.getenv('P1AZ_MOCK_BASE') ?: ''
def realBase            = System.getenv('P1AZ_REAL_BASE') ?: ''
def workerId            = System.getenv('P1AZ_WORKER_ID') ?: ''
def tokenEndpoint       = System.getenv('PINGONE_TOKEN_ENDPOINT') ?: ''
def workerClientId      = System.getenv('P1AZ_WORKER_CLIENT_ID') ?: ''
def workerClientSecret  = System.getenv('P1AZ_WORKER_CLIENT_SECRET') ?: ''
def gatewayResourceUri  = System.getenv('PG_GATEWAY_RESOURCE_URI') ?: ''

// ── Trusted-caller gate ───────────────────────────────────────────────────────
// X-Authz-Simulated (backend selector) and X-Act-Client-Id / X-May-Act-Sub (the
// bridged delegation actor, read further below) are server-to-server signals the
// BFF sets. The IG host port is reachable directly, so a caller holding any valid
// gateway-audience token could otherwise forge them — X-Authz-Simulated: true to
// force the permissive mock backend, or X-Act-Client-Id: <a registered actor> to
// satisfy HasValidActorChain. Require the shared BFF_INTERNAL_SECRET (the same
// x-internal-gateway-secret gate the Node gateway enforces) before honoring any of
// them; an untrusted caller gets the REAL backend and an empty bridged actor, so a
// forged request fails closed at the policy.
def internalSecret  = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def presentedSecret = request.headers.getFirst('x-internal-gateway-secret') ?: ''
def trustedCaller   = false
if (internalSecret && presentedSecret) {
    trustedCaller = java.security.MessageDigest.isEqual(
        internalSecret.getBytes('UTF-8'), presentedSecret.getBytes('UTF-8'))
}
if (!trustedCaller && (request.headers.getFirst('X-Authz-Simulated') != null
        || request.headers.getFirst('X-Act-Client-Id') != null)) {
    logger.warn('[P1AZ] Untrusted caller presented delegation headers without a valid ' +
        'x-internal-gateway-secret — forcing real backend + dropping bridged actor')
}

// ── Live backend selection from the BFF-stamped header ────────────────────────
// Default to REAL PingOne Authorize when the header is absent — matches
// ff_authorize_simulated defaulting to false (all-real-servers default; the mock
// demo_authz_server is opt-in via X-Authz-Simulated: true only). Only an
// authenticated internal caller may select the mock backend.
def simulatedHeader = trustedCaller ? request.headers.getFirst('X-Authz-Simulated') : null
def simulated       = (simulatedHeader == null) ? false : (simulatedHeader.trim() == 'true')
def decisionBase    = simulated ? mockBase : realBase

// Fail closed when the selected backend is not configured (mirrors the Node
// PingOneAuthorizeClient, which DENYs when the Authorization Server is unset).
if (!decisionBase) {
    logger.warn('[P1AZ] Decision backend not configured (' + (simulated ? 'P1AZ_MOCK_BASE' : 'P1AZ_REAL_BASE') + ') — failing closed')
    def denied = new Response(Status.FORBIDDEN)
    denied.headers.put('Content-Type', 'application/json')
    denied.entity.setString(JsonOutput.toJson([
        error      : 'access_denied',
        decision   : 'DENY',
        backend    : simulated ? 'mock' : 'real',
        tool       : '',
        mcp_method : '',
    ]))
    return Promises.newResultPromise(denied)
}

// ── Worker token cache (REAL backend only; mock needs none) ───────────────────
// MUST use `globals` (the IG cross-request store), NOT `binding`: the script's
// `binding` is recreated per request, so a token cached there never survives to
// the next request and a worker token would be fetched on EVERY real-backend call.
if (globals._p1azTokenCache == null) {
    globals._p1azTokenCache = [token: null, expiresAt: 0L]
}

// ── Blocking HTTP helper using Java URLConnection ─────────────────────────────
// IG's http.send(context, ...).get() deadlocks the Vert.x event loop: the thread
// blocks waiting for a callback that needs the same event loop thread to dispatch.
// Java URLConnection blocks in native I/O (no event loop dependency), so it
// resolves without deadlock. Generates Vert.x "Thread blocked" warnings (harmless
// for a demo) but does not deadlock.
def httpPost = { String url, String reqBody, Map hdrs ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'POST'
        conn.doOutput = true
        conn.connectTimeout = 5000
        conn.readTimeout = 10000
        hdrs.each { k, v -> conn.setRequestProperty(k as String, v as String) }
        conn.outputStream.withWriter('UTF-8') { it.write(reqBody as String) }
        def code = conn.responseCode
        def responseBody = ''
        try {
            responseBody = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: ''
        } catch (Exception ignored) {}
        return [code: code, body: responseBody]
    } catch (Exception e) {
        logger.warn('[P1AZ] httpPost failed url=' + url + ': ' + e.message)
        return [code: 0, body: '']
    }
}

def fetchWorkerToken = {
    if (!tokenEndpoint || !workerClientId || !workerClientSecret) {
        logger.warn('[P1AZ] Worker client credentials not configured — cannot obtain token for REAL backend')
        return null
    }
    try {
        def encoded = (workerClientId + ':' + workerClientSecret).bytes.encodeBase64().toString()
        def r = httpPost(tokenEndpoint, 'grant_type=client_credentials', [
            'Content-Type' : 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + encoded,
        ])
        def body = new JsonSlurper().parseText(r.body ?: '{}')
        if (r.code == 200 && body.access_token) {
            def expiresIn = (body.expires_in as long) ?: 3600L
            // Renew 60s early, but never derive a past/zero TTL from a short-lived
            // token (expires_in <= 60) — that would defeat the cache and refetch
            // on every request. Floor the effective lifetime at 30s.
            def ttlSeconds = Math.max(30L, expiresIn - 60L)
            globals._p1azTokenCache = [
                token    : body.access_token as String,
                expiresAt: System.currentTimeMillis() + (ttlSeconds * 1000L)
            ]
            return body.access_token as String
        }
        logger.warn('[P1AZ] Failed to obtain worker token: HTTP ' + r.code)
        return null
    } catch (Exception e) {
        logger.warn('[P1AZ] Exception fetching worker token: ' + e.message)
        return null
    }
}

def getWorkerToken = {
    def cache = globals._p1azTokenCache
    if (cache?.token && System.currentTimeMillis() < cache.expiresAt) {
        return cache.token
    }
    return fetchWorkerToken()
}

// ── Token claims from introspection result ────────────────────────────────────
// ResourceServerFilter (used by McpProtectionFilter) stores the AccessTokenInfo
// in an OAuth2Context, NOT in attributes['oauth2AccessToken']. Access it via the
// 'contexts' script binding: contexts['oauth2'].accessToken.getInfo() → Map<String,Object>.
def tokenInfo = [:]
try {
    def oauth2Ctx = contexts['oauth2']
    if (oauth2Ctx != null) {
        def accessToken = oauth2Ctx.accessToken  // AccessTokenInfo
        if (accessToken != null) {
            def info = accessToken.getInfo()     // Map<String, Object>
            tokenInfo = (info instanceof Map ? info : [:]) ?: [:]
        }
    }
    if (tokenInfo.isEmpty()) {
        logger.warn('[P1AZ] contexts[oauth2] accessToken info empty — falling back to attributes')
        // Fallback: try attributes['oauth2AccessToken'] if OAuth2Context was not set
        def rawAttr = attributes['oauth2AccessToken']
        if (rawAttr != null) {
            def info = rawAttr instanceof Map ? rawAttr : (rawAttr.respondsTo('getInfo') ? rawAttr.getInfo() : null)
            if (info instanceof Map) tokenInfo = info
        }
    }
    logger.info('[P1AZ] tokenInfo keys: ' + tokenInfo.keySet().collect { it.toString() }.join(', '))
} catch (Exception e) {
    logger.warn('[P1AZ] tokenInfo extraction failed: ' + e.message)
}
def sub       = tokenInfo['sub'] ?: ''
// act / may_act resolution (parity with the Node gateway — demo_mcp_gateway/src/index.ts:576):
// PREFER the native token claim; FALL BACK to the BFF-stamped header bridge
// (X-Act-Client-Id / X-May-Act-Sub) on hops where PingOne does not emit native `act`
// by design — e.g. two-exchange Exchange #2, whose actor is the MCP Exchanger (not the
// AI Agent), so the resource `act` SpEL returns null. See docs/ACT_CLAIM_VERIFICATION.md.
// The headers are trusted because they are set server-to-server (BFF → gateway, loopback).
// PingOne emits act/may_act as a JSON *string* (not a nested object) when the claim is
// stamped via a resource attribute — SpEL cannot construct nested objects. Parse the
// string form so the .sub / chain-depth access works for both shapes (a native object
// claim passes through unchanged). Without this, `.sub` on a String throws
// MissingPropertyException and the whole P1AZ decision (and the request) fails.
def parseActClaim = { v ->
    if (v == null) return null
    if (v instanceof String) {
        if (v.trim().isEmpty()) return null
        // Only a JSON *object* is a usable act claim. A quoted scalar ('"x"'),
        // number, or array parses fine but then `.sub` below throws the very
        // MissingPropertyException this parser exists to prevent — treat those
        // as no native claim (header bridge takes over).
        try {
            def parsed = new groovy.json.JsonSlurper().parseText(v)
            return parsed instanceof Map ? parsed : null
        } catch (ignored) { return null }
    }
    return v instanceof Map ? v : null
}
def actClaim        = parseActClaim(tokenInfo['act'])
def mayActClaim     = parseActClaim(tokenInfo['may_act'])
def nativeActSub    = actClaim?.sub ?: ''
def nativeMayActSub = mayActClaim?.sub ?: ''
// Bridged actor headers are honored ONLY for a trusted internal caller (see the
// trusted-caller gate above); an untrusted direct caller can't inject an actor to
// satisfy HasValidActorChain. Native `act`/`may_act` from the token still apply.
def hdrActClientId  = trustedCaller ? (request.headers.getFirst('X-Act-Client-Id') ?: '') : ''
def hdrMayActSub    = trustedCaller ? (request.headers.getFirst('X-May-Act-Sub') ?: '') : ''
def actSub    = nativeActSub ?: hdrActClientId
def mayActSub = nativeMayActSub ?: hdrMayActSub
def scope     = tokenInfo['scope'] ?: ''
def tokenScopes = scope.tokenize(' ').findAll { it }.join(' ')
// TokenAudActual: the ACTUAL aud carried by the inbound token (from introspection),
// mirroring the Node gateway (decoded.aud). TokenAudience above is the logical gateway
// URI; keeping TokenAudActual = gatewayResourceUri made the two ALWAYS equal, so any
// policy rule comparing them to detect an audience mismatch / confused-deputy token
// could never fire on the PingGateway path. Fall back to the gateway URI only when
// introspection did not surface an aud.
def rawTokenAud = tokenInfo['aud']
def joinedAud = (rawTokenAud instanceof List
    ? rawTokenAud.collect { it as String }.join(' ')
    : (rawTokenAud ?: '')) as String
// Fall back to the gateway URI when introspection surfaced no aud (null, or an
// empty aud array) so TokenAudActual is never blank.
def tokenAudActual = joinedAud ?: gatewayResourceUri
def tokenExp  = tokenInfo['exp'] != null ? String.valueOf(tokenInfo['exp']) : ''
def tokenIat  = tokenInfo['iat'] != null ? String.valueOf(tokenInfo['iat']) : ''
def tokenNbf  = tokenInfo['nbf'] != null ? String.valueOf(tokenInfo['nbf']) : ''
def tokenIss  = tokenInfo['iss'] ?: ''

// act chain depth — mirrors actChainDepth() in PingOneAuthorizeClient.ts
def actChainDepth = { act ->
    def depth = 0
    def node = act
    while (node && (node.sub || node.client_id)) {
        depth += 1
        node = node.act
    }
    return depth
}
// Native act → real chain depth; header-bridge fallback represents a single actor (depth 1).
def actDepth = nativeActSub ? String.valueOf(actChainDepth(actClaim)) : (actSub ? '1' : '0')

// ── Collect introspection data for audit trail ────────────────────────────────
def introspectionData = [
    active    : true,  // if we got this far, the token was active
    sub       : sub,
    scope     : tokenScopes,
    exp       : tokenInfo['exp'],
    iss       : tokenIss,
    client_id : tokenInfo['client_id'] ?: sub,
]

// ── Parse JSON-RPC body for method / tool / args ──────────────────────────────
def mcpMethod         = ''
def toolName          = ''
def transactionAmount = ''
def transactionType   = ''
def toAccountId       = ''
try {
    def bodyStr = request.entity.string
    if (bodyStr) {
        def parsed = new JsonSlurper().parseText(bodyStr)
        mcpMethod = parsed?.method ?: ''
        if (mcpMethod == 'tools/call') {
            toolName          = parsed?.params?.name ?: ''
            def args          = parsed?.params?.arguments ?: [:]
            def amt           = args?.amount
            transactionAmount = amt != null ? String.valueOf(amt) : ''
            transactionType   = args?.transaction_type ?: toolName
            toAccountId       = args?.to_account_id ?: ''
        }
    }
} catch (Exception e) {
    logger.warn('[P1AZ] Failed to parse request body: ' + e.message)
}

// Map the MCP method to the policy DecisionContext. tools/list must be McpToolsList
// (not the catch-all McpRequest) so the cloud policy applies the discovery rules the
// BFF/Node gateway also use. NOTE: this path does not yet send CandidateTools, so the
// policy's per-tool DeniedTools advice cannot be computed here — list-level allow/deny
// applies, but greying individual tools is owned by the Node gateway / BFF paths.
def decisionContext = (mcpMethod == 'tools/call') ? 'McpToolCall'
    : (mcpMethod == 'tools/list') ? 'McpToolsList'
    : 'McpRequest'
def vertical = request.headers.getFirst('X-Vertical') ?: ''

// ── Build the parameters payload (parity with buildAuthorizeParameters) ─
// UserId + McpResourceUri are required by the cloud P1AZ MCP Delegation policy
// (HasValidUserId checks UserId; HasValidMcpAudience checks TokenAudience == McpResourceUri).
// The BFF's McpFirstTool call sends them; the gateway's McpToolCall must too.
def parameters = [
    DecisionContext  : decisionContext,
    McpMethod        : mcpMethod,
    ToolName         : toolName,
    ClientId         : sub,
    UserId           : sub,
    ActClientId      : actSub,
    ActChainDepth    : actDepth,
    MayActSub        : mayActSub,
    TokenScopes      : tokenScopes,
    TokenAudience    : gatewayResourceUri,
    TokenAudActual   : tokenAudActual,
    McpResourceUri   : gatewayResourceUri,
    TokenExp         : tokenExp,
    TokenIat         : tokenIat,
    TokenNbf         : tokenNbf,
    TokenIss         : tokenIss,
    TransactionAmount: transactionAmount,
    TransactionType  : transactionType,
    ToAccountId      : toAccountId,
    Vertical         : vertical,
]
def requestBody = JsonOutput.toJson([parameters: parameters])
// Mock backend speaks the demo_authz_server policy path. REAL backend is the PingOne
// Authorize Decision Endpoints API: POST .../v1/environments/{envId}/decisionEndpoints/{id}.
// P1AZ_REAL_BASE may be either the environment base (.../v1/environments/{envId}) or the
// full decision-endpoint URL — append the /decisionEndpoints/{workerId} segment when it is
// absent so a bare environment base cannot silently 403 (→ no `decision` → DENY-all). The
// decision-endpoint id is P1AZ_WORKER_ID (the same id the mock uses as its policy path param).
def realDecisionUrl = {
    def b = decisionBase.replaceAll('/$', '')
    b.contains('/decisionEndpoints/') ? b : (b + '/decisionEndpoints/' + workerId)
}
def decisionUrl = simulated
    ? (decisionBase.replaceAll('/$', '') + '/governance/pap/alpha/policy/' + workerId + '/decision')
    : realDecisionUrl()

// ── Log full P1AZ request BEFORE calling the endpoint ────────────────────────
logger.info('[P1AZ] REQUEST → ' + (simulated ? 'MOCK' : 'REAL') + ' | url=' + decisionUrl + ' | body=' + requestBody)

// ── Call the decision endpoint (worker bearer only for REAL backend) ──────────
def callDecision = { String bearer ->
    def hdrs = ['Content-Type': 'application/json']
    if (bearer) hdrs['Authorization'] = 'Bearer ' + bearer
    return httpPost(decisionUrl, requestBody, hdrs)
}

def rawResponseBody = ''
def outcome = 'DENY'
def authorizeFullResponse = [:]
def failoverUsed = false
try {
    def bearer = simulated ? null : getWorkerToken()
    def r = callDecision(bearer)
    // REAL backend: on 401, refresh the worker token once and retry.
    if (!simulated && r.code == 401) {
        globals._p1azTokenCache = [token: null, expiresAt: 0L]
        bearer = fetchWorkerToken()
        r = callDecision(bearer)
    }
    // REAL backend connectivity failure (httpPost returns code 0) or 5xx.
    // Failing over to the always-PERMIT mock is a demo convenience that DISABLES
    // the policy while it looks healthy — so it is gated: disabled when STRICT_AUTH=true
    // or P1AZ_ALLOW_MOCK_FAILOVER=false. When disabled we fail CLOSED (r stays
    // non-200/empty → outcome parses to DENY below). STRICT_AUTH (not NODE_ENV) is the
    // opt-in signal, matching the BFF/MCP hardening — the demo runs without it and
    // keeps failover. A 200 + DENY is a valid decision and is NOT a failure.
    def allowMockFailover = (System.getenv('STRICT_AUTH') != 'true') &&
        ((System.getenv('P1AZ_ALLOW_MOCK_FAILOVER') ?: 'true').toLowerCase() != 'false')
    if (!simulated && (r.code == 0 || r.code >= 500)) {
        if (allowMockFailover && mockBase && mockBase != realBase) {
            logger.warn('[P1AZ] REAL backend unreachable (HTTP ' + r.code + ') — failing over to MOCK (dev only)')
            def mockUrl = mockBase.replaceAll('/$', '') + '/governance/pap/alpha/policy/' + workerId + '/decision'
            def fb = httpPost(mockUrl, requestBody, ['Content-Type': 'application/json'])
            if (fb.code == 200) {
                failoverUsed = true
                r = fb
            }
        } else {
            logger.warn('[P1AZ] REAL backend unreachable (HTTP ' + r.code + ') — mock failover disabled, failing CLOSED (DENY)')
        }
    }
    rawResponseBody = r.body ?: ''
    logger.info('[P1AZ] RESPONSE HTTP ' + r.code + ' ← ' + (failoverUsed ? 'MOCK-FAILOVER' : (simulated ? 'MOCK' : 'REAL')) + ' | body=' + rawResponseBody)
    def parsed = rawResponseBody ? new JsonSlurper().parseText(rawResponseBody) : [:]
    authorizeFullResponse = parsed ?: [:]
    outcome = parsed?.decision ?: 'DENY'
} catch (Exception e) {
    logger.warn('[P1AZ] Decision call failed — failing closed: ' + e.message)
    outcome = 'DENY'
    authorizeFullResponse = [error: e.message]
}

def backendLabel = failoverUsed ? 'mock-failover' : (simulated ? 'mock' : 'real')

logger.info('[P1AZ] DECISION: ' + outcome + ' | backend=' + backendLabel + ' | sub=' + sub + ' | tool=' + toolName + ' | method=' + mcpMethod + ' | vertical=' + vertical)

// ── Build audit trail ─────────────────────────────────────────────────────────
def auditTrail = [
    introspection: introspectionData,
    authorize: [
        decision   : outcome,
        backend    : backendLabel,
        url        : decisionUrl,
        tool       : toolName,
        method     : mcpMethod,
        vertical   : vertical,
        parameters : parameters,
        rawResponse: authorizeFullResponse,
        reason     : authorizeFullResponse?.reason ?: null,
        statements : authorizeFullResponse?.statements ?: null,
    ],
]
def auditTrailJson = JsonOutput.toJson(auditTrail)

if (outcome == 'PERMIT') {
    // thenOnResult takes ResultHandler (void side-effect) — returns the same Promise<Response,E>.
    // then() in IG 2026.x takes org.forgerock.util.Function (synchronous), not AsyncFunction;
    // the old as-AsyncFunction coercion threw MissingMethodException at runtime.
    def p = next.handle(context, request)
    p.thenOnResult({ chainResp ->
        chainResp.headers.put('X-Gw-Audit-Trail', [auditTrailJson])
    } as ResultHandler)
    return p
}

// DENY / INDETERMINATE / error — fail closed (HITL is not handled at this layer).
try {
    def denied = new Response(Status.FORBIDDEN)
    denied.headers.put('Content-Type', 'application/json')
    denied.headers.put('X-Gw-Audit-Trail', [auditTrailJson])
    denied.entity.setString(JsonOutput.toJson([
        error      : 'access_denied',
        decision   : outcome,
        backend    : backendLabel,
        tool       : toolName,
        mcp_method : mcpMethod,
    ]))
    return Promises.newResultPromise(denied)
} catch (Exception denyEx) {
    logger.error('[P1AZ] DENY path exception: ' + denyEx.getClass().name + ': ' + denyEx.message)
    throw denyEx
}
