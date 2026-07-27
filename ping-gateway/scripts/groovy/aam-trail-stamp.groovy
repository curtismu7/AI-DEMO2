// ping-gateway/scripts/groovy/aam-trail-stamp.groovy
//
// Runs on the outer route, wrapping PingAuthorizeFilter. Reads what
// aam-sideband-capture.groovy stored on the exchange and emits it as the `aam`
// section of X-Gw-Audit-Trail — the same header p1az-decision.groovy stamps, so
// the BFF parser and the token chain need no second mechanism.
//
// Stamps on BOTH outcomes: the 403 deny as well as the allowed 200. Wrapping
// the filter (rather than running after it) is what makes that possible — on a
// deny, PingAuthorizeFilter returns its own response without calling downstream
// filters, so a filter mounted after it would never run.
//
// FAIL-SAFE: never throw. Losing this header costs the chain its gw-aam event,
// which must never escalate into a failed request.
import groovy.json.JsonOutput

// Decide mock-vs-real HERE, not in the capture filter. Inside sidebandHandler the
// `request` is the Sideband request PingAuthorizeFilter constructed — it carries
// CLIENT-TOKEN and Content-Type, NOT the client's headers, so the capture filter
// cannot see X-Authz-Simulated at all. This filter runs on the outer route where
// the real client request is still in hand, and hands the answer down through the
// AttributesContext both filters share.
//
// Trusted exactly like p1az-decision.groovy: the simulated flag counts only from
// the BFF, so a gateway-audience token cannot force the mock backend.
def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def trustedCaller = internalSecret &&
    request.headers.getFirst('X-BFF-Internal') == internalSecret
attributes['aamSimulated'] = (trustedCaller &&
    request.headers.getFirst('X-Authz-Simulated') == 'true')

return next.handle(context, request).thenOnResult({ response ->
    try {
        def trail = attributes['aamTrail']
        if (trail != null) {
            response.headers.put('X-Gw-Audit-Trail', [JsonOutput.toJson([aam: trail])])
        }
    } catch (Exception e) {
        logger.warn('[AamTrailStamp] could not stamp the audit trail (' + e.message + ')')
    }
})
