/*
 * olb-token-exchange.groovy
 *
 * Exchange #3: exchanges the inbound gateway-scoped token (gateway:mcp:invoke)
 * for a backend OLB token (mcpserver.ping.demo / read). PingOne credentials use
 * client_secret_post; PF follows its configured standard-exchange auth method.
 *
 * MCP HTTP session lifecycle (per MCP spec):
 *   1. POST /mcp {"method":"initialize"} → receive Mcp-Session-Id
 *   2. Forward actual request with Mcp-Session-Id header
 *
 * On exchange failure: returns a stable error category and HTTP status only.
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
// PingFederate secondary issuer (2026-09-22 A2A-under-PF): when the inbound
// subject token was issued by PF (iss == PF_ISSUER_URI), PingOne cannot parse
// it ("Cannot parse token claims for subject_token"). Route Exchange #3 to the
// PF token endpoint with the PF exchanger client instead.
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
def olbAudience     = System.getenv('PG_OLB_RESOURCE_URI') ?: ''
def olbScope        = System.getenv('PG_OLB_SCOPE') ?: ''
def pfOlbScope      = System.getenv('PG_OLB_SCOPE_PF') ?: ''
def pfMcpActorClientId = System.getenv('PF_MCP_ACTOR_CLIENT_ID') ?: ''
def pfMcpActorClientSecret = System.getenv('PF_MCP_ACTOR_CLIENT_SECRET') ?: ''
def pfMcpActorAuthMethod = (System.getenv('PF_MCP_ACTOR_AUTH_METHOD') ?: 'basic').toLowerCase()
def pfMcpActorScope = System.getenv('PF_MCP_ACTOR_SCOPE') ?: ''
def mcpBaseUrl      = System.getenv('PG_OLB_BACKEND_URL') ?: 'http://mcp-server:8080'
def mcpUrl          = mcpBaseUrl.replaceAll('/+$', '') + '/mcp'
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
        return [body: JsonOutput.toJson([error: 'mcp_tool_call_failed']), isError: true, scopeDenied: false]
    }
}

// ── Blocking HTTP helper (form-encoded) ──────────────────────────────────────
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
        def body = ''
        try { body = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: '' } catch (Exception ignored) {}
        return [code: code, body: body]
    } catch (Exception e) {
        logger.warn('[OlbExchange] token endpoint transport error')
        return [code: 0, body: '']
    }
}

// ── Blocking HTTP helper (JSON, returns response headers too) ─────────────────
// ── mTLS to the MCP server ────────────────────────────────────────────────────
// demo_mcp_server implements the server half already: with MCP_MTLS_ENABLED=true
// it serves HTTPS and pins THIS gateway's client cert by SHA-256 fingerprint
// (src/auth/mtlsMiddleware.ts). The client half was missing — IG presented no
// cert, so the hop ran as plain http://mcp-server:8080 and mTLS could never be
// switched on without every call failing "no client certificate presented".
//
// Built once per script evaluation and reused. Two deliberate choices:
//  * Client auth comes from a PKCS#12 keystore (scripts/ensure-gateway-mtls-certs.sh).
//  * The SERVER side is trust-all. demo_mcp_server generates a fresh self-signed
//    server cert on every start (DemoMCPServer ~L127), so pinning it is
//    impossible. The property being demonstrated is CLIENT authentication; the
//    channel is container-to-container on a private Docker network.
def mtlsKeystore = System.getenv('PG_MTLS_KEYSTORE_PATH') ?: ''
def mtlsPassword = System.getenv('PG_MTLS_KEYSTORE_PASSWORD') ?: 'changeit'
def mtlsFactory = null
if (mtlsKeystore && new File(mtlsKeystore).exists()) {
    try {
        def ks = java.security.KeyStore.getInstance('PKCS12')
        new File(mtlsKeystore).withInputStream { ks.load(it, mtlsPassword.toCharArray()) }
        def kmf = javax.net.ssl.KeyManagerFactory.getInstance(
            javax.net.ssl.KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, mtlsPassword.toCharArray())
        def trustAll = [ new javax.net.ssl.X509TrustManager() {
            void checkClientTrusted(java.security.cert.X509Certificate[] c, String a) {}
            void checkServerTrusted(java.security.cert.X509Certificate[] c, String a) {}
            java.security.cert.X509Certificate[] getAcceptedIssuers() { return new java.security.cert.X509Certificate[0] }
        } ] as javax.net.ssl.TrustManager[]
        def ctx = javax.net.ssl.SSLContext.getInstance('TLS')
        ctx.init(kmf.getKeyManagers(), trustAll, new java.security.SecureRandom())
        mtlsFactory = ctx.getSocketFactory()
        // Subject of the cert we will actually present — read from the keystore
        // rather than hardcoded, so a rotated cert shows its real subject.
        def mtlsSubject = null
        try {
            def alias = ks.aliases().find { ks.isKeyEntry(it) }
            mtlsSubject = alias ? ks.getCertificate(alias)?.getSubjectX500Principal()?.getName() : null
        } catch (Exception ignored) { }
        attributes['mtlsResult'] = [enabled: true, subject: mtlsSubject, keystore: mtlsKeystore]
        logger.info('[OlbExchange] mTLS client keystore loaded from ' + mtlsKeystore +
            (mtlsSubject ? ' subject=' + mtlsSubject : ''))
    } catch (Exception e) {
        // Do NOT fall back to plaintext silently: if mTLS was configured and the
        // keystore is broken, the operator needs to see it rather than discover
        // the hop quietly downgraded.
        logger.error('[OlbExchange] mTLS keystore load failed; MCP calls requiring client certificates will fail')
    }
} else if (mtlsKeystore) {
    logger.error('[OlbExchange] PG_MTLS_KEYSTORE_PATH set to ' + mtlsKeystore +
        ' but no such file — run scripts/ensure-gateway-mtls-certs.sh')
}
if (attributes['mtlsResult'] == null) {
    // Not configured (or the keystore failed to load). Reported explicitly so the
    // token chain can distinguish "mTLS off" from "no information", rather than
    // silently omitting the hop.
    attributes['mtlsResult'] = [enabled: false, subject: null, keystore: mtlsKeystore ?: null]
}

def httpPostJson = { String url, String jsonBody, Map hdrs ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        // Attach client cert + trust-all on https. CN is banking-mcp-server while
        // the host is mcp-server, so the default hostname verifier would reject.
        if (conn instanceof javax.net.ssl.HttpsURLConnection && mtlsFactory != null) {
            conn.setSSLSocketFactory(mtlsFactory)
            conn.setHostnameVerifier({ String h, javax.net.ssl.SSLSession sess -> true })
        }
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
        logger.warn('[OlbExchange] MCP transport error')
        return [code: 0, body: '', headers: [:]]
    }
}

// ── Extract the effective transaction token from Authorization ────────────────
// privilege-bridge.groovy has already replaced Privilege's static bearer with
// the trusted tx-token before this exchange filter runs. Ordinary callers still
// arrive here with their normal Authorization bearer.
def authHeader = request.headers.getFirst('Authorization') ?: ''
def subjectToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''

if (!subjectToken) {
    logger.warn('[OlbExchange] No bearer token in Authorization header')
    def r = new Response(Status.UNAUTHORIZED)
    r.entity.setString('{"error":"no_subject_token"}')
    return Promises.newResultPromise(r)
}

// Exchange #3 is unconditional. It used to be skippable via an X-BFF-Exchanged
// request header (ff_gateway_brokered_exchange=false), letting the BFF own the
// final RFC 8693 hop. That flag was removed: its OFF path made the BFF's
// Exchange #2 request tool scopes spanning multiple PingOne resources, which
// PingOne rejects with
//   invalid_scope: "May not request scopes for multiple resources"
// so bff-brokered mode could never actually work. Dropping the header also
// removes an attack surface: it suppressed Exchange #3, so an ungated version
// let any caller reaching :3036 forward its inbound gateway-audience token
// straight to the MCP server instead of a properly re-scoped one.
// See docs/dual-exchange-broker.md.
def issuedToken

// ── Exchange #3: get OLB token from PingOne (or PF for PF-issued subjects) ────
// RFC 8707: PingOne requires `resource=` to narrow to ONE resource server when
// the TE client has grants on several — `audience=` alone is silently ignored
// ("May not request scopes for multiple resources"), so the issued token keeps
// the subject aud (mcpgateway.ping.demo) and mcp-server rejects it. Mirror the
// Node gateway's McpTokenExchangeClient (resource=, not audience=).
//
// Scope: only send when PG_OLB_SCOPE is non-empty AND single-resource. The
// inbound subject carries gateway:mcp:invoke (PingGateway resource only).
// Forcing scope=mcp:invoke is WRONG — that name is also on mcpgateway.ping.demo,
// so PingOne may return 200 with the WRONG aud (gateway) even with resource=
// set. Node omits scope when subject∩mcpserver is empty; do the same here.
// PF access tokens and native ID-JAGs have different subject-token types. Read
// the signed-token header only to identify the exact ID-JAG typ; the original
// subject token is sent unchanged to the selected authorization server.
def tokenIss = ''
def tokenTyp = ''
try {
    def h = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''
    def p = h.split('\\.', -1)
    if (p.length == 3) {
        def slurper = new JsonSlurper()
        tokenIss = slurper.parseText(new String(java.util.Base64.getUrlDecoder().decode(p[1]), 'UTF-8'))['iss'] ?: ''
        tokenTyp = slurper.parseText(new String(java.util.Base64.getUrlDecoder().decode(p[0]), 'UTF-8'))['typ'] ?: ''
    }
} catch (Exception ignored) {}
def isPfSubject = pfIssuer && tokenIss == pfIssuer
if (isPfSubject && (!pfExchangeConfigValid()
        || !pfMcpActorClientId || !pfMcpActorClientSecret || !pfMcpActorScope
        || !(pfMcpActorAuthMethod in ['basic', 'post']))) {
    logger.warn('[OlbExchange] PF Exchange #3 or MCP actor configuration is incomplete or unsupported')
    def errResp = new Response(Status.SERVICE_UNAVAILABLE)
    errResp.headers.put('Content-Type', ['application/json'])
    errResp.entity.setString('{"error":"pf_exchange_not_configured"}')
    return Promises.newResultPromise(errResp)
}
def exEndpoint  = isPfSubject ? pfTokenEndpoint : tokenEndpoint
def exClientId  = isPfSubject ? pfTeClientId : teClientId
def exClientSecret = isPfSubject ? pfTeClientSecret : teClientSecret
// The local PF scope registry differs from PingOne: read/write are registered,
// but code:search is not. Keep the PingOne scope contract intact and use PF's
// narrower provider-specific scope list only for PF-issued subjects. The
// PG_OLB_SCOPE setting is PingOne-specific; PG_OLB_SCOPE_PF configures PF.
def requestedOlbScope = isPfSubject ? pfOlbScope : olbScope
// PF's standard exchange policy requires an MCP-service actor. Mint it with
// the same dedicated client-credentials profile used by the BFF PF exchange
// service; never substitute the user subject or the exchanger client itself.
def pfActorToken = null
if (isPfSubject) {
    def actorParams = [
        'grant_type': 'client_credentials',
        'scope': pfMcpActorScope.trim(),
    ]
    def actorHeaders = [:]
    if (pfMcpActorAuthMethod == 'post') {
        actorParams['client_id'] = pfMcpActorClientId
        actorParams['client_secret'] = pfMcpActorClientSecret
    } else {
        def actorCredentials = pfMcpActorClientId + ':' + pfMcpActorClientSecret
        def encodedActorCredentials = java.util.Base64.getEncoder().encodeToString(actorCredentials.getBytes('UTF-8'))
        actorHeaders['Authorization'] = 'Basic ' + encodedActorCredentials
    }
    def actorFormBody = actorParams.collect { k, v ->
        java.net.URLEncoder.encode(k, 'UTF-8') + '=' + java.net.URLEncoder.encode(v as String, 'UTF-8')
    }.join('&')
    logger.info('[OlbExchange] PF MCP actor-token request scope=' + pfMcpActorScope.trim())
    def actorResp = httpPostForm(pfTokenEndpoint, actorFormBody, actorHeaders)
    if (actorResp.code != 200) {
        logger.warn('[OlbExchange] PF MCP actor-token request failed HTTP ' + actorResp.code)
        def errResp = new Response(Status.BAD_GATEWAY)
        errResp.headers.put('Content-Type', ['application/json'])
        errResp.entity.setString('{"error":"pf_actor_token_failed"}')
        return Promises.newResultPromise(errResp)
    }
    try {
        pfActorToken = new JsonSlurper().parseText(actorResp.body ?: '{}')?.access_token as String
    } catch (Exception ignored) {}
    if (!pfActorToken) {
        logger.warn('[OlbExchange] PF MCP actor-token response omitted access_token')
        def errResp = new Response(Status.BAD_GATEWAY)
        errResp.headers.put('Content-Type', ['application/json'])
        errResp.entity.setString('{"error":"pf_actor_token_failed"}')
        return Promises.newResultPromise(errResp)
    }
    // Match the BFF's PF actor checks before forwarding this token: require a
    // JWT access token for the configured actor client with every requested scope.
    def actorTokenValid = false
    try {
        def actorJwtParts = pfActorToken.split('\\.', -1)
        if (actorJwtParts.length != 3) throw new IllegalArgumentException('malformed actor JWT')
        def actorHeader = new JsonSlurper().parseText(
            new String(java.util.Base64.getUrlDecoder().decode(actorJwtParts[0]), 'UTF-8'))
        def actorClaims = new JsonSlurper().parseText(
            new String(java.util.Base64.getUrlDecoder().decode(actorJwtParts[1]), 'UTF-8'))
        if ((actorHeader?.typ ?: '').toString().toLowerCase().contains('id-jag')) {
            throw new IllegalArgumentException('actor token is an ID-JAG')
        }
        def actorIdentity = actorClaims.client_id ?: actorClaims.sub
        if (actorIdentity?.toString() != pfMcpActorClientId) {
            throw new IllegalArgumentException('actor identity mismatch')
        }
        def actorScopes = [] as Set
        if (actorClaims.scope instanceof Collection) {
            actorScopes.addAll(actorClaims.scope.collect { it?.toString() })
        } else {
            actorScopes.addAll((actorClaims.scope ?: '').toString().split(/\s+/).findAll { it })
        }
        def expectedActorScopes = pfMcpActorScope.trim().split(/\s+/).findAll { it }
        actorTokenValid = expectedActorScopes && expectedActorScopes.every { actorScopes.contains(it) }
    } catch (Exception ignored) {}
    if (!actorTokenValid) {
        logger.warn('[OlbExchange] PF MCP actor token failed identity/scope/format validation')
        def errResp = new Response(Status.BAD_GATEWAY)
        errResp.headers.put('Content-Type', ['application/json'])
        errResp.entity.setString('{"error":"pf_actor_token_failed"}')
        return Promises.newResultPromise(errResp)
    }
}
// PF access-token subjects use access_token typing; only an actual PF ID-JAG
// (typ=oauth-id-jag+jwt) uses id-jag typing. PingOne behavior stays access_token.
def subjectTokenType = (isPfSubject && tokenTyp == 'oauth-id-jag+jwt')
    ? 'urn:ietf:params:oauth:token-type:id-jag'
    : 'urn:ietf:params:oauth:token-type:access_token'
def params = [
    'grant_type'           : 'urn:ietf:params:oauth:grant-type:token-exchange',
    'subject_token'        : subjectToken,
    'subject_token_type'   : subjectTokenType,
    'requested_token_type' : 'urn:ietf:params:oauth:token-type:access_token',
    'client_id'            : exClientId,
    'client_secret'        : exClientSecret,
]
// The PF MCP exchanger is restricted to its dedicated MCP-gateway ATM, which
// emits the backend-accepted audience. PF requires an absolute URI when
// `resource` is set, so omit PingOne's opaque resource alias on that branch.
if (!isPfSubject) {
    // PingOne needs this RFC 8707 target to select the single backend resource.
    params['resource'] = olbAudience
}
if (isPfSubject) {
    params['actor_token'] = pfActorToken
    params['actor_token_type'] = 'urn:ietf:params:oauth:token-type:access_token'
}
if (requestedOlbScope?.trim()) {
    params['scope'] = requestedOlbScope.trim()
}
def exchangeHeaders = [:]
if (isPfSubject && pfTeAuthMethod in ['basic', 'client_secret_basic']) {
    params.remove('client_id')
    params.remove('client_secret')
    def basic = java.util.Base64.getEncoder().encodeToString((exClientId + ':' + exClientSecret).getBytes('UTF-8'))
    exchangeHeaders['Authorization'] = 'Basic ' + basic
}
def formBody = params.collect { k, v ->
    java.net.URLEncoder.encode(k, 'UTF-8') + '=' + java.net.URLEncoder.encode(v as String, 'UTF-8')
}.join('&')

logger.info('[OlbExchange] Exchange #3 request provider=' + (isPfSubject ? 'pingfederate' : 'pingone'))
def exchangeResp = httpPostForm(exEndpoint, formBody, exchangeHeaders)
logger.info('[OlbExchange] RESPONSE HTTP ' + exchangeResp.code)

if (exchangeResp.code != 200) {
    logger.warn('[OlbExchange] Exchange failed HTTP ' + exchangeResp.code + ' provider=' + (isPfSubject ? 'pingfederate' : 'pingone'))
    def errResp = new Response(Status.UNAUTHORIZED)
    errResp.headers.put('Content-Type', ['application/json'])
    errResp.entity.setString(JsonOutput.toJson([
        error       : 'token_exchange_failed',
        http_status : exchangeResp.code,
    ]))
    return Promises.newResultPromise(errResp)
}

def exchangeParsed = [:]
try { exchangeParsed = new JsonSlurper().parseText(exchangeResp.body ?: '{}') } catch (Exception ignored) {
    logger.warn('[OlbExchange] Exchange returned an invalid response HTTP ' + exchangeResp.code)
    def errResp = new Response(Status.BAD_GATEWAY)
    errResp.headers.put('Content-Type', ['application/json'])
    errResp.entity.setString(JsonOutput.toJson([error: 'invalid_token_exchange_response', http_status: exchangeResp.code]))
    return Promises.newResultPromise(errResp)
}
issuedToken = exchangeParsed?.access_token as String

if (!issuedToken) {
    logger.warn('[OlbExchange] No access_token in exchange response')
    def errResp = new Response(Status.BAD_GATEWAY)
    errResp.entity.setString('{"error":"no_access_token_in_exchange"}')
    return Promises.newResultPromise(errResp)
}
logger.info('[OlbExchange] Exchange #3 succeeded — token_type=' + (exchangeParsed?.token_type ?: '?'))

// Report what this exchange actually issued — audience and scope read from the
// token itself, never the token — so p1az-decision.groovy can put it on
// X-Gw-Audit-Trail as `backend`, the key the BFF already turns into the
// gw-backend-exchange event for the Node gateway. Without it this hop is
// invisible: nothing downstream of the gateway can check the audience the MCP
// server is sent. FAIL-SAFE: reporting must never break the tool call.
try {
    def issuedParts = issuedToken.split('\\.', -1)
    def issuedClaims = issuedParts.length == 3
        ? new JsonSlurper().parseText(new String(java.util.Base64.getUrlDecoder().decode(issuedParts[1]), 'UTF-8'))
        : [:]
    def issuedAud = issuedClaims.aud instanceof Collection ? issuedClaims.aud.collect { it?.toString() } : [issuedClaims.aud?.toString()].findAll { it }
    def issuedScope = issuedClaims.scope instanceof Collection ? issuedClaims.scope.collect { it?.toString() }.join(' ') : (issuedClaims.scope ?: '').toString()
    attributes['backendExchange'] = [
        target   : 'olb',
        audience : issuedAud.join(' '),
        scope    : issuedScope,
        exchanged: true,
        cached   : false,
    ]
} catch (Exception e) {
    logger.warn('[OlbExchange] could not describe the issued token for the audit trail (' + e.message + ')')
}


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
logger.info('[OlbExchange] Sending MCP initialize')
def initResp = httpPostJson(mcpUrl, initBody, initHdrs)
logger.info('[OlbExchange] MCP initialize response HTTP ' + initResp.code)

if (initResp.code != 200) {
    logger.warn('[OlbExchange] MCP initialize failed HTTP ' + initResp.code)
    def errResp = new Response(Status.BAD_GATEWAY)
    errResp.headers.put('Content-Type', ['application/json'])
    errResp.entity.setString(JsonOutput.toJson([error: 'mcp_initialize_failed', http_status: initResp.code]))
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

// ── Forward tool call directly via httpPostJson (bypasses ReverseProxyHandler) ─
// reason: request.entity can be consumed by upstream filters (McpValidation,
// P1AZDecision both read the body); the ReverseProxyHandler then forwards an
// empty body, causing the MCP server to return a parse error wrapped as 403.
def rawBody = ''
try { rawBody = request.entity.string ?: '' } catch (Exception ignored) {}
logger.info('[OlbExchange] Forwarding MCP tool request body_len=' + rawBody.length())

def toolHdrs = [
    'Content-Type'        : 'application/json',
    'Accept'              : 'application/json, text/event-stream',
    'Authorization'       : 'Bearer ' + issuedToken,
    'MCP-Protocol-Version': '2025-11-25',
    'mcp-session-id'      : sessionId,
]
def toolResp = httpPostJson(mcpUrl, rawBody, toolHdrs)
logger.info('[OlbExchange] MCP direct response HTTP ' + toolResp.code)

// Build IG response from MCP server result. Forward the MCP server's own status so
// 4xx semantics (e.g. a 403 auth/HITL challenge) reach the BFF intact rather than
// being flattened to 502 — collapsing every non-200 to BAD_GATEWAY hid those signals.
// Only a transport failure (code 0) maps to 502.
def igStatus = (toolResp.code > 0) ? Status.valueOf(toolResp.code) : Status.BAD_GATEWAY
def finalResp = new Response(igStatus)
finalResp.headers.put('Content-Type', ['application/json'])
if (toolResp.code == 200 && toolResp.body) {
    finalResp.entity.setString(sanitizeMcpResponse(toolResp.body).body)
} else if (toolResp.code != 200) {
    def safeResult = sanitizeMcpResponse(toolResp.body ?: '')
    if (safeResult.scopeDenied) {
        finalResp.entity.setString(safeResult.body)
    } else {
        finalResp.entity.setString(JsonOutput.toJson([error: 'mcp_tool_call_failed', http_status: toolResp.code]))
    }
}
return Promises.newResultPromise(finalResp)
