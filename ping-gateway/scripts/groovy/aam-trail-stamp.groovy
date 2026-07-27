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
