// ping-gateway/scripts/groovy/transaction-hop.groovy
//
// Emits one `gateway.authorize` hop per MCP request into the BFF transaction
// ledger (/internal/transaction-hop), so /transaction-trace can show the
// gateway leg of the chain.
//
// WHY THIS EXISTS: the ledger's gateway instrumentation lived only in
// demo_mcp_gateway (the Node gateway, gatewayAudit.ts). When traffic routes
// through PingGateway instead — the default for the MCP path — that code is
// bypassed entirely, so NO gateway hop was ever recorded and the trace page
// could only ever show BFF-side hops. Verified against the live ledger: 300
// consecutive transactions, zero gateway hops.
//
// Mounted as the OUTERMOST filter on the MCP routes so it observes the final
// response, including denies produced by P1AZDecision (which returns its own
// response without calling downstream filters — a filter mounted after it
// would never run).
//
// FAIL-OPEN, ALWAYS: the ledger is an observability surface. Losing a hop is
// acceptable; disturbing a tool call is not. Every failure path here is
// swallowed, and the POST happens on a daemon thread so a slow/dead BFF can
// never add latency to the response.
import groovy.json.JsonOutput
import groovy.json.JsonSlurper

def hopUrl = System.getenv('BFF_TRANSACTION_HOP_URL') ?: ''
def secret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def allowInsecureHostname = System.getenv('PG_ALLOW_INSECURE_VAULT_HOSTNAME') == 'true'

// Correlation: the BFF stamps X-Correlation-ID on every gateway call
// (mcpGatewayClient.js). Without an inbound id there is nothing to correlate
// TO, and inventing one here would write an orphan single-hop record that
// looks like an incomplete transaction in the UI — so skip instead.
def correlationId = request.headers.getFirst('X-Correlation-ID') ?:
                    request.headers.getFirst('X-Request-ID') ?: ''

// Deliberately does NOT read request.entity: the tool name and method are
// already published on the response's X-Gw-Audit-Trail by p1az-decision.groovy,
// so there is no reason for an observability filter to touch the request body
// at all. Reading it would put this filter on the critical path for a
// stream-consumption bug it gains nothing from.
def startedAt = System.currentTimeMillis()

return next.handle(context, request).thenOnResult({ response ->
    try {
        if (!hopUrl || !secret || !correlationId) return

        def durationMs = System.currentTimeMillis() - startedAt
        def statusCode = -1
        try { statusCode = response.status.code } catch (Exception ignored) {}

        // Prefer the authoritative decision P1AZDecision already stamped on the
        // audit trail over guessing from the HTTP status: a JSON-RPC error rides
        // a 200 envelope, so status alone cannot distinguish a policy DENY from
        // a successful call.
        def outcome = null
        // Provenance of `outcome`: 'trail' once it is read from the PDP's stamped
        // X-Gw-Audit-Trail (the authoritative verdict), 'inferred' when the trail is
        // absent/unparseable and it falls through to the status-code guess below.
        // The two are recorded in the SAME decision.outcome field, so without this
        // marker /transaction-trace could not tell a real policy DENY/PERMIT from a
        // guess — and a JSON-RPC error rides a 200 envelope, so status alone cannot
        // distinguish a policy DENY from a successful call. Default 'inferred': any
        // path that does not explicitly read the decision from the trail is a guess.
        def outcomeSource = 'inferred'
        def reason = null
        def op = null
        // The PingGateway MCP filters that actually handled this request.
        // p1az-decision.groovy already publishes them on the trail; forwarding
        // them onto the hop is what puts them in the movie reel. Until now only
        // /transaction-trace (buildTraceSteps.js) could see the chain, so the
        // reel showed PingGateway's VERDICT while the product features that
        // produced it — McpValidationFilter, McpAuditFilter, McpProtectionFilter
        // — were invisible in the surface built to demonstrate them.
        def filterChain = null
        def denyingFilter = null
        try {
            def trailRaw = response.headers.getFirst('X-Gw-Audit-Trail')
            if (trailRaw) {
                def trail = new JsonSlurper().parseText(trailRaw)
                def az = trail?.authorize
                if (az) {
                    if (az.decision) {
                        outcome = az.decision as String
                        outcomeSource = 'trail'
                    }
                    reason = az.reason as String
                    op = (az.tool ?: az.method) as String
                }
                if (trail?.filterChain instanceof List) filterChain = trail.filterChain
                denyingFilter = trail?.denyingFilter as String
            }
        } catch (Exception ignored) { /* trail absent or unparseable — fall through */ }
        // FAIL-OPEN (see file header): the ledger is an observability surface, so a
        // missing/unparseable trail must still record a hop. Infer the outcome from
        // the HTTP status, leaving outcomeSource='inferred' so the trace UI reads it
        // as a guess rather than a confirmed PDP verdict.
        if (!outcome) outcome = (statusCode >= 400) ? 'DENY' : 'PERMIT'

        def payload = JsonOutput.toJson([
            phase        : 'gateway.authorize',
            op           : op,
            correlationId: correlationId,
            durationMs   : durationMs,
            service      : 'ping-gateway',
            status       : (statusCode >= 400) ? 'error' : 'ok',
            decision     : [outcome: outcome, by: 'ping-gateway', reason: reason, source: outcomeSource],
            // Omitted entirely when the trail was absent or unparseable, rather
            // than sent as an empty list: the reel must be able to tell "no
            // filter data" from "no filters ran", and this file fails open by
            // design (see header) so a missing trail is a normal case.
            filterChain  : filterChain,
            denyingFilter: denyingFilter,
        ])

        // Daemon thread: URLConnection blocks in native I/O, and IG runs this
        // callback on the Vert.x event loop. Blocking there would stall the
        // response we just produced (and IG's own http.send deadlocks the loop
        // outright — see p1az-decision.groovy's helper for the same reasoning).
        def t = new Thread({
            try {
                def conn = new URL(hopUrl).openConnection() as java.net.HttpURLConnection
                // Same opt-in hostname relaxation the vault bridge uses, and for
                // the same reason: in-cluster the BFF is addressed as
                // demo-api-server (ClusterIP DNS), which is not a SAN on the
                // mkcert cert (SAN=api.ping.demo). Trust still comes from the
                // JVM truststore — only the NAME check is relaxed, and only when
                // PG_ALLOW_INSECURE_VAULT_HOSTNAME is explicitly set.
                if (allowInsecureHostname && conn instanceof javax.net.ssl.HttpsURLConnection) {
                    conn.setHostnameVerifier({ String hostname, javax.net.ssl.SSLSession session ->
                        hostname == 'demo-api-server' || hostname == 'api.ping.demo' || hostname == 'localhost'
                    } as javax.net.ssl.HostnameVerifier)
                }
                conn.requestMethod = 'POST'
                conn.doOutput = true
                conn.connectTimeout = 2000
                conn.readTimeout = 2000
                conn.setRequestProperty('Content-Type', 'application/json')
                conn.setRequestProperty('x-internal-gateway-secret', secret)
                conn.outputStream.withWriter('UTF-8') { it.write(payload) }
                conn.responseCode
                try { conn.inputStream?.close() } catch (Exception ignored2) {}
            } catch (Exception e) {
                logger.warn('[TransactionHop] emit failed: ' + e.message)
            }
        } as Runnable)
        t.daemon = true
        t.start()
    } catch (Exception e) {
        logger.warn('[TransactionHop] hop skipped: ' + e.message)
    }
})
