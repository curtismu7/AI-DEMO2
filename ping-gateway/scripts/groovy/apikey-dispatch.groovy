/*
 * apikey-dispatch.groovy — Phase 3: PingGateway/IG credential mediation.
 *
 * Terminal handler for the ^/mcp/apikey route. For an api-key-disposition MCP
 * tool call (show_mortgage / show_investment / …), IG:
 *   1. reads the tool name from the JSON-RPC body,
 *   2. pulls the fake service API key from the vault via the BFF bridge
 *      (TLS-verified — the mkcert CA is in IG's JVM truststore, Phase 1),
 *   3. drops the user's OAuth bearer and calls demo_data_service /<route>
 *      with X-API-Key (service-to-service trust),
 *   4. wraps the REST record into an MCP JSON-RPC result whose _meta carries the
 *      masked key + apiCall + tokenEvents, mirroring the Node gateway's
 *      apiKeyDispatch.ts shape so the UI/Trace Rail are unchanged.
 *
 * Inbound token validation + scope enforcement run in earlier filters on this
 * route (rsFilter / McpValidation), so by the time we run the caller is already
 * authorized. We deliberately do NOT forward the bearer to the backend.
 *
 * Idioms mirror olb-token-exchange.groovy (self-forward via HttpURLConnection —
 * http.send().get() deadlocks the Vert.x event loop) and p1az-decision.groovy.
 */
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

// tool name -> demo_data_service route segment (mirrors demo_mcp_gateway APIKEY_BACKEND_ROUTES)
def ROUTE_FOR_TOOL = [
    show_mortgage      : 'mortgage',
    show_investment    : 'invest',
    show_large_purchase: 'retail',
    show_health_record : 'healthcare',
    show_gear_order    : 'gear',
    show_expense_report: 'expense',
    show_permit        : 'permit',
    show_enrollment    : 'enrollment',
    show_work_order    : 'workOrder',
]
// tool -> vault key name the BFF bridge will return. Every api_key-disposition
// tool hits the SAME backend (demo_mortgage_service / demo_data_service), which
// validates every vertical against a single shared secret (MORTGAGE_SERVICE_API_KEY).
// So every tool presents DEMO_MORTGAGE_SERVICE_KEY — the only demo backend key
// seeded (setupFresh.js) and the value the backend accepts. Tools omitted here
// would fail with "no vault key configured" even after P1AZ PERMIT.
def KEY_FOR_TOOL = [
    show_mortgage      : 'DEMO_MORTGAGE_SERVICE_KEY',
    show_investment    : 'DEMO_MORTGAGE_SERVICE_KEY',
    show_large_purchase: 'DEMO_MORTGAGE_SERVICE_KEY',
    show_health_record : 'DEMO_MORTGAGE_SERVICE_KEY',
    show_gear_order    : 'DEMO_MORTGAGE_SERVICE_KEY',
    show_expense_report: 'DEMO_MORTGAGE_SERVICE_KEY',
    show_permit        : 'DEMO_MORTGAGE_SERVICE_KEY',
    show_enrollment    : 'DEMO_MORTGAGE_SERVICE_KEY',
    show_work_order    : 'DEMO_MORTGAGE_SERVICE_KEY',
]

def bffVaultUrl   = System.getenv('BFF_VAULT_KEY_URL') ?: ''
def bffSecret     = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def backendBase   = System.getenv('PG_MORTGAGE_BACKEND_URL') ?: 'http://mortgage-service:8082'

// ── helpers ──────────────────────────────────────────────────────────────────
def rpcError = { id, code, message ->
    def body = JsonOutput.toJson([jsonrpc: '2.0', id: id, error: [code: code, message: message]])
    def r = new Response(Status.OK)          // JSON-RPC errors ride a 200 envelope
    r.headers.put('Content-Type', ['application/json'])
    r.entity.setString(body)
    return Promises.newResultPromise(r)
}

// Blocking GET (URLConnection, not http.send — event-loop safe). Returns [code, body].
//
// HostnameVerifier: the BFF mkcert cert SANs are api.ping.demo/localhost only, but
// in-cluster the vault URL uses demo-api-server ClusterIP DNS, whose name is not on the
// cert. Overriding the verifier silently disables hostname checking for that name, so
// it is now OPT-IN via PG_ALLOW_INSECURE_VAULT_HOSTNAME=true and can never be active in
// a deployed environment that does not set it. Default: the JVM's standard verifier.
// Trust always comes from the JVM truststore (mkcert root imported at container start);
// this only ever relaxed the NAME check, never certificate validation.
//
// The durable fix is to add `demo-api-server` to the BFF cert SANs (or address the
// vault bridge as api.ping.demo) and drop this flag entirely.
def allowInsecureVaultHostname = System.getenv('PG_ALLOW_INSECURE_VAULT_HOSTNAME') == 'true'
def httpGet = { String url, Map hdrs ->
    try {
        def conn = new URL(url).openConnection() as java.net.HttpURLConnection
        if (allowInsecureVaultHostname && conn instanceof javax.net.ssl.HttpsURLConnection) {
            logger.warn('[apikey-dispatch] PG_ALLOW_INSECURE_VAULT_HOSTNAME=true — ' +
                'TLS hostname verification relaxed for the vault bridge (dev only)')
            conn.setHostnameVerifier({ String hostname, javax.net.ssl.SSLSession session ->
                hostname == 'demo-api-server' || hostname == 'api.ping.demo' || hostname == 'localhost'
            } as javax.net.ssl.HostnameVerifier)
        }
        conn.requestMethod = 'GET'
        conn.connectTimeout = 5000
        conn.readTimeout = 10000
        hdrs.each { k, v -> conn.setRequestProperty(k as String, v as String) }
        def code = conn.responseCode
        def text = ''
        try { text = (code < 400 ? conn.inputStream : (conn.errorStream ?: conn.inputStream))?.text ?: '' } catch (Exception ignored) {}
        return [code: code, body: text]
    } catch (Exception e) {
        logger.warn('[apikey-dispatch] GET failed ' + url + ' : ' + e.message)
        return [code: 0, body: '']
    }
}

def maskLast4 = { String k -> (k && k.length() >= 4) ? k[-4..-1] : 'XXXX' }

// ── 1. parse the inbound JSON-RPC tool call ─────────────────────────────────
def bodyStr = ''
try { bodyStr = request.entity.string ?: '' } catch (Exception ignored) {}
def rpc
try { rpc = new JsonSlurper().parseText(bodyStr ?: '{}') } catch (Exception e) { rpc = [:] }
def rpcId    = rpc?.id
def toolName = (rpc?.method == 'tools/call') ? (rpc?.params?.name as String) : null

if (!toolName || !ROUTE_FOR_TOOL.containsKey(toolName)) {
    return rpcError(rpcId, -32601, 'apikey-dispatch: unknown or non-apikey tool: ' + toolName)
}
def routeSeg = ROUTE_FOR_TOOL[toolName]
def keyName  = KEY_FOR_TOOL[toolName]

// ── 2. pull the service key from the vault (via the BFF bridge, TLS-verified) ─
if (!keyName) {
    return rpcError(rpcId, -32500, 'apikey-dispatch: no vault key configured for ' + toolName)
}
def keyResp = httpGet(bffVaultUrl + '?name=' + keyName, ['x-internal-gateway-secret': bffSecret])
if (keyResp.code != 200) {
    logger.warn('[apikey-dispatch] vault bridge returned ' + keyResp.code + ' for ' + keyName)
    return rpcError(rpcId, -32500, 'apikey-dispatch: could not fetch service key (bridge ' + keyResp.code + ')')
}
def apiKey = new JsonSlurper().parseText(keyResp.body ?: '{}')?.value as String
if (!apiKey) {
    return rpcError(rpcId, -32500, 'apikey-dispatch: empty service key from bridge')
}
def last4 = maskLast4(apiKey)

// ── 3. call the backend with X-API-Key (no bearer) ──────────────────────────
def backendUrl = backendBase + '/' + routeSeg
def be = httpGet(backendUrl, ['X-API-Key': apiKey])
if (be.code == 401) {
    return rpcError(rpcId, -32401, 'apikey-dispatch: backend rejected the service API key')
}
if (be.code < 200 || be.code >= 400) {
    return rpcError(rpcId, -32500, 'apikey-dispatch: backend returned ' + be.code)
}

// ── 4. wrap the REST record into an MCP JSON-RPC result (apiKeyDispatch.ts shape) ─
def result = [
    jsonrpc: '2.0',
    id: rpcId,
    result: [
        content: [[type: 'text', text: be.body]],
        _meta: [
            credentialPath   : 'api_key',
            apiKeyMaskedLast4: last4,
            maskedApiKey     : 'xxxx' + last4,
            apiCall          : 'GET /' + routeSeg,
            backend          : 'demo_data_service',
            note             : 'PingGateway pulled the service key from the vault, dropped your OAuth bearer, and called demo_data_service /' + routeSeg + ' (X-API-Key).',
            tokenEvents      : [
                [id: 'evt-inbound', label: 'Inbound user bearer received', tokenType: 'access_token', credentialPath: 'api_key', status: 'ok'],
                [id: 'evt-swap',    label: 'PingGateway swap: OAuth bearer dropped, vault service API key attached', tokenType: 'api_key', maskedValue: '...' + last4, credentialPath: 'api_key', status: 'ok'],
                [id: 'vault-key-inject', label: 'Vault key injected by PingGateway → ' + routeSeg, tokenType: 'api_key', maskedValue: '...' + last4, credentialPath: 'api_key', status: 'ok'],
                [id: 'evt-backend', label: 'Outbound GET demo_data_service /' + routeSeg + ' (X-API-Key, no OAuth)', tokenType: 'api_key', credentialPath: 'api_key', status: 'ok'],
            ],
        ],
    ],
]

def resp = new Response(Status.OK)
resp.headers.put('Content-Type', ['application/json'])
resp.entity.setString(JsonOutput.toJson(result))
return Promises.newResultPromise(resp)
