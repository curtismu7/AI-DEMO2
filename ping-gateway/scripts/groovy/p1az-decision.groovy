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
// mirroring the Node gateway (decoded.aud). It is the only audience signal that carries
// information — McpResourceUri below is the gateway's own EXPECTED identity.
//
// C1 preamble: absent values are OMITTED, never fabricated. This previously fell back to
// gatewayResourceUri when introspection surfaced no aud, which defeated TWO rules at once:
// mock Rule 0b reads TokenAudActual FIRST (demo_authz_server/routes/decision.js:265), so a
// no-aud token PASSED the audience check on the fabricated value; and because TokenAudience
// is correctly omitted below, Rule 0c — guarded on BOTH keys — was skipped too. Net effect:
// a token carrying no aud at all cleared every audience rule on the default path. Omitting
// makes Rule 0b fall through to TokenAudience (also absent) and DENY.
def rawTokenAud = tokenInfo['aud']
def joinedAud = (rawTokenAud instanceof List
    ? rawTokenAud.collect { it as String }.join(' ')
    : (rawTokenAud ?: '')) as String
// Space-joined FULL aud list, not just the first entry: mock Rule 0b-2's D-05 anti-bypass
// splits this on whitespace, so a multi-aud confused-deputy token [gateway, upstream] is
// still caught. Blank when introspection surfaced no aud — the key is then omitted.
def tokenAudActual = joinedAud
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
// BFF/Node gateway also use.
def decisionContext = (mcpMethod == 'tools/call') ? 'McpToolCall'
    : (mcpMethod == 'tools/list') ? 'McpToolsList'
    : 'McpRequest'
// Vertical: the BFF stamps X-Active-Vertical (mcpGatewayClient.js); the original
// X-Vertical spelling is honored as a fallback for any older caller. Reading only
// X-Vertical made Vertical always '' on the live path (confirmed in the IG decision
// log), so the PDP's per-vertical tools/list advice could never be computed.
def vertical = request.headers.getFirst('X-Active-Vertical')
    ?: (request.headers.getFirst('X-Vertical') ?: '')

// CandidateTools (tools/list only): the per-tool list the PDP needs to return
// DeniedTools advice — this is what drives chip greying. IG decides BEFORE proxying,
// so it cannot know the backend's tool list itself; it forwards a list supplied by the
// trusted BFF caller. Untrusted callers cannot inject one (same gate as the delegation
// headers above). Omitted when absent — an empty list is not "no tools permitted".
def candidateTools = ''
if (trustedCaller && decisionContext == 'McpToolsList') {
    def rawCandidates = request.headers.getFirst('X-Candidate-Tools') ?: ''
    if (rawCandidates) {
        try {
            def parsedCandidates = new JsonSlurper().parseText(rawCandidates)
            if (parsedCandidates instanceof List) candidateTools = JsonOutput.toJson(parsedCandidates)
        } catch (Exception e) {
            logger.warn('[P1AZ] X-Candidate-Tools is not a JSON array — ignored: ' + e.message)
        }
    }
}

// ── Intent Token verification (F4) ────────────────────────────────────────────
// The BFF mints an HMAC-SHA256 Intent Token at prompt-receipt time (server.js:1930)
// and sends it as X-Intent-Token (mcpGatewayClient.js:136). Nothing on this path
// verified it, so the intent binding was decorative. Mirrors the Node gateway's
// validateIntentToken (demo_mcp_gateway/src/intentTokenValidator.ts:51-103): HMAC
// over "<header>.<body>", exp, then permitted_tools membership.
//
// C1 rule 3: a caller that CANNOT verify a binding claim must OMIT it, never send
// false — omission means "unknown", false means "verified absent". So when no shared
// secret is configured both keys stay out of the parameter set.
def intentSecret   = System.getenv('INTENT_TOKEN_SECRET') ?: (System.getenv('SESSION_SECRET') ?: '')
def intentTokenRaw = request.headers.getFirst('X-Intent-Token') ?: ''
def intentValid    = null   // null => not evaluated => omitted from parameters
def intentMatches  = null
def intentError    = ''
if (!intentSecret) {
    logger.info('[P1AZ] INTENT_TOKEN_SECRET not configured — intent binding NOT verified ' +
        '(IntentTokenValid/IntentMatchesTool omitted per C1 rule 3)')
} else if (!intentTokenRaw) {
    intentValid = false; intentMatches = false; intentError = 'no_intent_token'
} else {
    def parts = intentTokenRaw.split('\\.')
    if (parts.length != 3) {
        intentValid = false; intentMatches = false; intentError = 'malformed'
    } else {
        try {
            def mac = javax.crypto.Mac.getInstance('HmacSHA256')
            mac.init(new javax.crypto.spec.SecretKeySpec(intentSecret.getBytes('UTF-8'), 'HmacSHA256'))
            // Node signs with digest('base64url') — unpadded base64url. Match exactly.
            def expectedSig = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal((parts[0] + '.' + parts[1]).getBytes('UTF-8')))
            if (!java.security.MessageDigest.isEqual(
                    expectedSig.getBytes('UTF-8'), parts[2].getBytes('UTF-8'))) {
                intentValid = false; intentMatches = false; intentError = 'invalid_signature'
            } else {
                def intentClaims = new JsonSlurper().parseText(
                    new String(Base64.getUrlDecoder().decode(parts[1]), 'UTF-8'))
                def nowSec = (long) (System.currentTimeMillis() / 1000L)
                if (((intentClaims?.exp ?: 0L) as long) < nowSec) {
                    intentValid = false; intentMatches = false; intentError = 'expired'
                } else {
                    intentValid = true
                    def permitted = intentClaims?.permitted_tools
                    intentMatches = (permitted instanceof List) && permitted.contains(toolName)
                }
            }
        } catch (Exception e) {
            intentValid = false; intentMatches = false; intentError = 'malformed_payload'
            logger.warn('[P1AZ] Intent token verification failed: ' + e.message)
        }
    }
}
// Hard deny ONLY when explicitly required — parity with the Node gateway, whose
// INTENT_TOKEN_REQUIRED defaults false (intentTokenValidator is advisory otherwise).
// Default off keeps the running demo unchanged; the PDP still receives the evidence.
if (System.getenv('INTENT_TOKEN_REQUIRED') == 'true'
        && (intentValid != true || (toolName && intentMatches != true))) {
    logger.warn('[P1AZ] INTENT_TOKEN_REQUIRED — denying: valid=' + intentValid +
        ' matchesTool=' + intentMatches + ' error=' + intentError + ' tool=' + toolName)
    def intentDenied = new Response(Status.FORBIDDEN)
    intentDenied.headers.put('Content-Type', 'application/json')
    intentDenied.entity.setString(JsonOutput.toJson([
        error      : 'access_denied',
        decision   : 'DENY',
        reason     : 'intent_token_required: ' + (intentError ?: 'tool not in permitted_tools'),
        tool       : toolName,
        mcp_method : mcpMethod,
    ]))
    return Promises.newResultPromise(intentDenied)
}

// ── X-TraT-Context (F4) ───────────────────────────────────────────────────────
// Built by the BFF (agentMcpTokenService) and sent via mcpGatewayClient.
// Practical rule: PingGateway is the PEP — extract RAR grant attrs and forward
// them to PingOne Authorize (PDP). Do NOT locally DENY on RAR subset here;
// cloud policy RarAmountExceeded (RarMaxAmount) owns the decision.
//
// Trust: honor the envelope when the BFF is a trustedCaller (internal secret)
// OR when ALLOW_UNSIGNED_TRAT_CONTEXT=true (demo TraT sim). Untrusted + flag
// off → omit (unsigned forgery must not reach the PDP).
def allowUnsignedTrat = System.getenv('ALLOW_UNSIGNED_TRAT_CONTEXT') == 'true'
def tratContextRaw    = request.headers.getFirst('X-TraT-Context') ?: ''
def tratPurp          = ''
def rarAuthzDetails   = ''
def rarMaxAmount      = ''
def rarPermittedPayees = ''
// cnf.jkt from the introspected token is VERIFIED evidence and is always usable;
// the envelope copy is only a fallback for the simulated-TraT demo mode.
def cnfJkt = (tokenInfo['cnf'] instanceof Map ? (tokenInfo['cnf'].jkt ?: '') : '') as String
def honorTrat = tratContextRaw && (trustedCaller || allowUnsignedTrat)
if (tratContextRaw && !honorTrat) {
    logger.info('[P1AZ] X-TraT-Context present but caller untrusted and ' +
        'ALLOW_UNSIGNED_TRAT_CONTEXT!=true — ignored (unsigned envelope is not verified evidence)')
} else if (honorTrat) {
    try {
        def tratEnvelope = new JsonSlurper().parseText(tratContextRaw)
        if (tratEnvelope instanceof Map) {
            tratPurp = (tratEnvelope.purp ?: '') as String
            if (!cnfJkt && tratEnvelope.cnf instanceof Map && tratEnvelope.cnf.jkt) {
                cnfJkt = tratEnvelope.cnf.jkt as String
            }
            def azd = tratEnvelope.azd
            if (azd instanceof Map && azd.authorization_details instanceof List
                    && !((List) azd.authorization_details).isEmpty()) {
                def details = (List) azd.authorization_details
                rarAuthzDetails = JsonOutput.toJson(details)
                // Scalar attrs for cloud Trust Framework (RarMaxAmount NUMBER + Amount).
                def grant0 = details[0]
                if (grant0 instanceof Map && grant0.amount != null) {
                    rarMaxAmount = String.valueOf(grant0.amount)
                }
                if (grant0 instanceof Map && grant0.payee != null) {
                    rarPermittedPayees = (grant0.payee instanceof List)
                        ? grant0.payee.collect { String.valueOf(it) }.join(' ')
                        : String.valueOf(grant0.payee)
                }
            }
        }
    } catch (Exception e) {
        logger.warn('[P1AZ] X-TraT-Context parse failed — ignored: ' + e.message)
    }
}

// ── Build the parameters payload (contract C1) ────────────────────────────────
// UserId + McpResourceUri are required by the cloud P1AZ MCP Delegation policy
// (HasValidUserId checks UserId; HasValidMcpAudience checks TokenAudience == McpResourceUri).
// The BFF's McpFirstTool call sends them; the gateway's McpToolCall must too.
//
// C1 rule 1: TokenAudience is the token's REAL aud and must never be hardcoded to the
// expected URI. Setting BOTH keys to gatewayResourceUri made HasValidMcpAudience (cloud)
// and Rule 0c (mock) equal by construction — a tautology that could never deny a
// confused-deputy token. Verified live: the real aud is PG_GATEWAY_RESOURCE_ID
// (https://api.ping.demo:3036/mcp) while PG_GATEWAY_RESOURCE_URI is the short name
// (mcpgateway.ping.demo), so comparing the real aud against the short name alone would
// have DENIED every request.
//
// The gateway answers to BOTH identities — jwks-token-validation.groovy:173-177 accepts
// either — so McpResourceUri is the STATIC set of both, mirroring the Node gateway, which
// sends its comma-separated MCP_GW_RESOURCE_URI verbatim (PingOneAuthorizeClient.ts:148).
//
// It must NOT be derived from the token under test. Resolving it to "whichever accepted
// identity the token happened to target" made the PEP pre-compute the PDP's answer: the
// EXPECTED value became a function of the OBSERVED value, which is the same tautology C1
// rule 1 exists to prevent, just one level of indirection deeper. The PDP compares the two
// as SETS (demo_authz_server/routes/decision.js:313-318), so a legitimate token whose aud
// is either identity still intersects and PERMITs, while a foreign aud intersects nothing
// and DENIES — the discrimination is the PDP's to make, not the gateway's.
def gatewayResourceId = System.getenv('PG_GATEWAY_RESOURCE_ID') ?: ''
def audEntries = (rawTokenAud instanceof List
    ? rawTokenAud.collect { it as String }
    : (rawTokenAud ? [rawTokenAud as String] : [])).findAll { it }
def acceptedAuds   = [gatewayResourceUri, gatewayResourceId].findAll { it }
// C1: array => first entry.
def tokenAudience  = audEntries ? audEntries[0] : ''
// Static — a function of configuration only, never of the token being judged.
def mcpResourceUri = acceptedAuds.join(',')

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
    McpResourceUri   : mcpResourceUri,
    TokenExp         : tokenExp,
    TokenIat         : tokenIat,
    TokenNbf         : tokenNbf,
    TokenIss         : tokenIss,
    // C1 rule 2: Amount and TransactionAmount always move together. The cloud Trust
    // Framework only defines `Amount`, so sending TransactionAmount alone meant the
    // gateway's amount was silently dropped and the MCP branch had no amount ceiling.
    Amount           : transactionAmount,
    TransactionAmount: transactionAmount,
    TransactionType  : transactionType,
    ToAccountId      : toAccountId,
    Vertical         : vertical,
    // Timestamp is a cloud Trust Framework attribute neither gateway was sending.
    // ISO-8601, matching the BFF (pingOneAuthorizeService.js:434 new Date().toISOString()).
    Timestamp        : java.time.Instant.now().toString(),
]
// Absent values are omitted, never fabricated (C1 preamble). Both audience keys are
// omitted together when introspection surfaced no aud — mock Rule 0b reads TokenAudActual
// first and TokenAudience second, so leaving EITHER populated with a fabricated value
// silently satisfies the audience check for a token that has no audience at all.
if (tokenAudActual)  parameters.TokenAudActual = tokenAudActual
if (tokenAudience)   parameters.TokenAudience = tokenAudience
// Acr: without it, RequiresMcpStepUp reduces to a pure tool-name test — NOT
// (Acr == Multi_Factor) is always true when Acr defaults to 'none', so a completed
// MFA could never discharge step-up on a gateway-originated call.
def acr = (tokenInfo['acr'] ?: '') as String
if (acr)             parameters.Acr = acr
if (candidateTools)  parameters.CandidateTools = candidateTools
// Binding evidence — omitted when the transport did not verify it (C1).
if (intentValid != null) {
    parameters.IntentTokenValid  = String.valueOf(intentValid)
    parameters.IntentMatchesTool = String.valueOf(intentMatches)
    if (intentError) parameters.IntentTokenError = intentError
}
if (rarAuthzDetails) parameters.RarAuthorizationDetails = rarAuthzDetails
if (rarMaxAmount)    parameters.RarMaxAmount = rarMaxAmount
if (rarPermittedPayees) parameters.RarPermittedPayees = rarPermittedPayees
if (tratPurp)        parameters.TratPurp = tratPurp
if (cnfJkt)          parameters.Cnf = cnfJkt
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
    // REAL backend: PingOne Authorize rate-limits (HTTP 429 REQUEST_LIMITED).
    // Treating 429 as DENY (via missing `decision`) falsely blocks demos under
    // burst traffic. Retry once after a short backoff before failing closed.
    if (!simulated && r.code == 429) {
        logger.warn('[P1AZ] REAL backend rate-limited (HTTP 429) — retrying once after 1500ms')
        try { Thread.sleep(1500L) } catch (InterruptedException ignored) {}
        r = callDecision(bearer)
        if (r.code == 429) {
            logger.warn('[P1AZ] REAL backend still rate-limited after retry — failing CLOSED (DENY)')
        }
    }
    // REAL backend connectivity failure (httpPost returns code 0) or 5xx.
    // Failing over to the always-PERMIT mock is a demo convenience that DISABLES
    // the policy while it looks healthy — so it is gated: disabled when STRICT_AUTH=true
    // or P1AZ_ALLOW_MOCK_FAILOVER=false. When disabled we fail CLOSED (r stays
    // non-200/empty → outcome parses to DENY below). STRICT_AUTH (not NODE_ENV) is the
    // opt-in signal, matching the BFF/MCP hardening — the demo runs without it and
    // keeps failover. A 200 + DENY is a valid decision and is NOT a failure.
    // Default OFF: real-backend outages must fail CLOSED (DENY), not silently
    // switch to the more permissive mock. Opt in with P1AZ_ALLOW_MOCK_FAILOVER=true
    // for local demo convenience; STRICT_AUTH=true always disables failover.
    def allowMockFailover = (System.getenv('STRICT_AUTH') != 'true') &&
        ((System.getenv('P1AZ_ALLOW_MOCK_FAILOVER') ?: 'false').toLowerCase() == 'true')
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
    // Rate-limit / error bodies have no `decision` — keep DENY but stamp reason so
    // the audit trail does not look like a policy DENY.
    if (r.code == 429 && !parsed?.decision) {
        authorizeFullResponse = [error: 'REQUEST_LIMITED', code: 'REQUEST_LIMITED', http_status: 429, message: (parsed?.message ?: 'rate limited')]
        outcome = 'DENY'
    } else {
        outcome = parsed?.decision ?: 'DENY'
    }
} catch (Exception e) {
    logger.warn('[P1AZ] Decision call failed — failing closed: ' + e.message)
    outcome = 'DENY'
    authorizeFullResponse = [error: e.message]
}

def backendLabel = failoverUsed ? 'mock-failover' : (simulated ? 'mock' : 'real')

logger.info('[P1AZ] DECISION: ' + outcome + ' | backend=' + backendLabel + ' | sub=' + sub + ' | tool=' + toolName + ' | method=' + mcpMethod + ' | vertical=' + vertical)

// ── Build audit trail ─────────────────────────────────────────────────────────
// mcpAudit mirrors what McpAuditFilter records to audit/mcp.audit.json
// (who called which tool, where, with what result) so Token Chain can show
// the 5W1H story without reading the IG audit volume.
def resourceWhere = System.getenv('PG_GATEWAY_RESOURCE_ID') ?: (request.uri?.toString() ?: '/mcp')
def mcpAudit = [
    eventName       : 'PING-GATEWAY-MCP',
    who             : [
        userSub    : sub,
        agentSub   : actSub ?: null,
        mayActSub  : mayActSub ?: null,
        clientId   : introspectionData.client_id,
        actDepth   : actDepth,
    ],
    what            : [
        mcpMethod  : mcpMethod,
        tool       : toolName ?: null,
        transactionType   : transactionType ?: null,
        transactionAmount : transactionAmount ?: null,
    ],
    when            : System.currentTimeMillis(),
    where           : [
        resourceId : resourceWhere,
        vertical   : vertical ?: null,
        routePath  : request.uri?.path ?: null,
    ],
    how             : [
        decision   : outcome,
        backend    : backendLabel,
        result     : outcome == 'PERMIT' ? 'forwarded' : 'blocked',
        reason     : authorizeFullResponse?.reason ?: null,
    ],
]
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
    mcpAudit: mcpAudit,
    filterChain: [
        [filter: 'McpValidationFilter', result: 'passed'],
        [filter: 'McpAuditFilter', result: 'passed'],
        [filter: 'McpProtectionFilter', result: 'passed'],
        [filter: 'TokenIntrospection', result: (introspectionData?.active == true ? 'passed' : (introspectionData != null ? 'blocked' : 'skipped'))],
        [filter: 'P1AZDecision', result: (outcome == 'PERMIT' ? 'forwarded' : 'blocked'), decision: outcome],
    ],
    denyingFilter: (outcome == 'PERMIT' ? null : 'P1AZDecision'),
    lastFilter: (outcome == 'PERMIT' ? 'P1AZDecision' : null),
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
