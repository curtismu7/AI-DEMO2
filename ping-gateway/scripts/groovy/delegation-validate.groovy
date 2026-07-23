/*
 * delegation-validate.groovy
 *
 * Validates that an inbound token on the /mcp/delegation route carries
 * a genuine RFC 8693 `act` claim, proving the user delegated to this
 * specific agent via token exchange (the "may_act → act" delegation chain).
 *
 * Must run AFTER OAuth2ResourceServerFilter (OlbResourceServerFilter / DelegationFilter)
 * so that contexts.oauth2.accessToken is populated.
 *
 * Passes:  next filter / handler
 * Rejects: 403 {"error":"delegation_required","detail":"..."}
 */

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def reject = { int code, String err, String detail ->
    def r = new Response(Status.valueOf(code))
    r.headers.put('Content-Type', ['application/json'])
    r.entity.setString(JsonOutput.toJson([error: err, detail: detail]))
    return Promises.newResultPromise(r)
}

// ── Extract claims from introspection context ──────────────────────────────────
// OAuth2ResourceServerFilter populates contexts.oauth2.accessToken after
// successful introspection. The full introspection response is in .info map.
def tokenInfo = contexts?.oauth2?.accessToken?.info

if (!tokenInfo) {
    logger.warn('[DelegationValidate] No OAuth2 token context — ResourceServerFilter must run first')
    return reject(401, 'unauthorized', 'Token not validated')
}

logger.info('[DelegationValidate] token active=' + tokenInfo?.get('active') +
            ' aud=' + tokenInfo?.get('aud') +
            ' act=' + tokenInfo?.get('act'))

// ── Verify token is active ─────────────────────────────────────────────────────
if (!tokenInfo?.get('active')) {
    return reject(401, 'token_inactive', 'Token is not active')
}

// ── Verify audience is test resource ──────────────────────────────────────────
def aud = tokenInfo?.get('aud')
def expectedAud = System.getenv('DELEGATION_RESOURCE_AUDIENCE') ?: 'test'
def audMatch = (aud instanceof List) ? aud.contains(expectedAud) : (aud == expectedAud)
if (!audMatch) {
    logger.warn('[DelegationValidate] Audience mismatch — got=' + aud + ' expected=' + expectedAud)
    return reject(403, 'invalid_audience', 'Token audience does not match delegation resource')
}

// ── Verify act claim exists (delegation proof) ─────────────────────────────────
// The `act` claim is populated by PingOne token exchange only when:
//   1. User token had may_act.sub == agent client_id
//   2. Agent performed RFC 8693 exchange with its own actor_token
// Absent act = direct client_credentials call (not delegated) — reject.
def actClaim = tokenInfo?.get('act')
if (!actClaim) {
    logger.warn('[DelegationValidate] Missing act claim — token was not issued via delegation')
    return reject(403, 'delegation_required',
        'This endpoint requires a delegated token. ' +
        'Obtain a token via RFC 8693 token exchange (grant_type=urn:ietf:params:oauth:grant-type:token-exchange) ' +
        'with a user subject_token that contains may_act.sub matching your client_id.')
}

// ── Log delegation chain for audit ────────────────────────────────────────────
def actSub = (actClaim instanceof Map) ? actClaim?.get('sub') : actClaim?.toString()
def tokenSub = tokenInfo?.get('sub')
logger.info('[DelegationValidate] ✅ Delegation verified — user=' + tokenSub + ' agent(act.sub)=' + actSub)

// ── Attach delegation metadata to request for downstream use ──────────────────
request.headers.add('X-Delegation-User',  tokenSub?.toString() ?: '')
request.headers.add('X-Delegation-Agent', actSub?.toString() ?: '')
request.headers.add('X-Delegation-Verified', 'true')

return next.handle(context, request)
