// ping-gateway/scripts/groovy/aam-sideband-capture.groovy
//
// Sits inside PingAuthorizeFilter's sidebandHandler, directly on the wire
// between the filter and the PingOne Authorize Sideband API. It does two jobs
// that have to happen in the same place:
//
//   1. Retarget — X-Authz-Simulated (set by the BFF, value = effective
//      ff_authorize_simulated) selects the mock instead of real PingOne.
//      gatewayServiceUri cannot do this: it is typed as a configuration
//      expression in the reference docs, but IG hands the raw string to
//      java.net.URI and resolves it once at config load.
//   2. Capture — record the Sideband request and response JSON so
//      aam-trail-stamp.groovy can put them in X-Gw-Audit-Trail. The built-in
//      PingAuthorizeFilter consumes this exchange internally and exposes only
//      200/403, so this is the only place the JSON can be observed.
//
// Wire contract (recorded from the live service 2026-07-27, not documented
// publicly): POST {serviceUrl}/sideband/request with the gateway credential in
// a CLIENT-TOKEN header. The response ECHOES the request fields and adds a
// `response` object ONLY when AAM wants the gateway to answer immediately.
// Absence of `response` is the allow signal.
//
// SECURITY: the Sideband request body contains the caller's Authorization
// header, because that is exactly what AAM evaluates. Redact at capture, not at
// render — this travels to a browser via the audit-trail header, and a field we
// forget to redact downstream leaks, while a field never captured cannot.
import groovy.json.JsonSlurper

def SENSITIVE = ['authorization', 'cookie', 'set-cookie', 'client-token']

// headers arrive as an array of single-key objects: [{"Accept":"*/*"}, ...]
def redactHeaders
redactHeaders = { list ->
    if (!(list instanceof List)) return list
    list.collect { entry ->
        if (!(entry instanceof Map)) return entry
        entry.collectEntries { k, v ->
            [(k), (SENSITIVE.contains(String.valueOf(k).toLowerCase()) ? '<redacted>' : v)]
        }
    }
}

def redactBody
redactBody = { obj ->
    if (!(obj instanceof Map)) return obj
    def copy = new LinkedHashMap(obj)
    if (copy.containsKey('headers')) copy.headers = redactHeaders(copy.headers)
    if (copy.response instanceof Map && copy.response.headers != null) {
        def inner = new LinkedHashMap(copy.response)
        inner.headers = redactHeaders(inner.headers)
        copy.response = inner
    }
    return copy
}

// Trust X-Authz-Simulated only from the BFF, matching p1az-decision.groovy.
// A gateway-audience token must not be able to force the mock backend.
def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def trustedCaller = internalSecret &&
    request.headers.getFirst('X-BFF-Internal') == internalSecret
def simulated = trustedCaller &&
    request.headers.getFirst('X-Authz-Simulated') == 'true'

def mockBase = System.getenv('AAM_MOCK_BASE') ?: ''
if (simulated && mockBase) {
    // Keep the /sideband/... path the filter already built; swap the origin.
    def originalUri = request.uri.toString()
    def idx = originalUri.indexOf('/sideband')
    if (idx >= 0) {
        request.uri = new java.net.URI(mockBase + originalUri.substring(idx))
    }
}

def started = System.currentTimeMillis()
def reqJson = null
try {
    // Reading .string CONSUMES the entity. Put it back or the Sideband API
    // receives an empty body and the exchange hangs until the client times out
    // (curl exit 28) — it does not fail fast, so the symptom looks like a
    // network problem rather than a consumed stream.
    def reqBody = request.entity.string ?: ''
    request.entity.setString(reqBody)
    reqJson = new JsonSlurper().parseText(reqBody ?: '{}')
} catch (Exception e) {
    logger.warn('[AamCapture] could not parse sideband request (' + e.message + ')')
}

def targetUri = request.uri.toString()

// FAIL-SAFE: capture must never break the decision. Any error here costs the
// token chain its gw-aam event, which is strictly better than a failed request.
return next.handle(context, request).thenOnResult({ resp ->
    try {
        def respJson = null
        try {
            // Same consumption rule as the request: PingAuthorizeFilter parses
            // this response after we return, so it must be put back.
            def respBody = resp.entity.string ?: ''
            resp.entity.setString(respBody)
            respJson = new JsonSlurper().parseText(respBody ?: '{}')
        } catch (Exception e) {
            logger.warn('[AamCapture] could not parse sideband response (' + e.message + ')')
        }
        // The discriminator: a `response` object means AAM answered for us.
        def decision = (respJson instanceof Map && respJson.response != null) ? 'DENY' : 'PERMIT'
        attributes['aamTrail'] = [
            decision  : decision,
            backend   : simulated ? 'mock' : 'real',
            serviceUri: targetUri,
            elapsedMs : System.currentTimeMillis() - started,
            request   : redactBody(reqJson),
            response  : redactBody(respJson),
        ]
    } catch (Exception e) {
        logger.warn('[AamCapture] could not record the sideband exchange (' + e.message + ')')
    }
})
