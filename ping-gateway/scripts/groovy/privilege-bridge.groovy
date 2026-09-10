/*
 * privilege-bridge.groovy — Task 8b: the PingGateway equivalent of
 * demo_mcp_gateway/src/auth/privilegeBridge.ts.
 *
 * WHY THIS EXISTS. When the PingOne Privilege AI Gateway fronts this gateway,
 * the Authorization header on its backend hop is PRIVILEGE'S, not the caller's:
 * Privilege stamps the Static Token configured on the Agentic App. PingGateway
 * has no idea what that value is, so McpProtectionFilter introspects it, fails,
 * and answers 401 — which surfaces in the Privilege console as:
 *
 *   Error discovering MCP server: calling "initialize": Unauthorized
 *
 * (observed live 2026-09-10 on the `agent-gateway` Agentic App). Until this
 * filter existed, the ONLY gateway that could sit behind Privilege was the Node
 * one, because Task 8 shipped there and Task 8b was deferred.
 *
 * WHAT IT DOES. Exactly what the Node bridge does, translated to IG: when the
 * bearer IS the configured shared secret, the caller's real token — forwarded by
 * Privilege in X-Subject-Token, which survives the hop with its value unmodified
 * (measured, privilege/CURRENT-CONFIGURATION.md "Backend hop") — is swapped into
 * the Authorization header. Every downstream filter then runs unmodified on the
 * REAL delegated user: introspection, P1AZ, and the RFC 8693 exchange all see the
 * user rather than a machine identity.
 *
 * SECURITY, and the two rules that matter most:
 *
 *  1. X-Subject-Token is honoured ONLY when the bearer equals the secret. From
 *     any other caller the header is STRIPPED, not merely ignored — otherwise a
 *     forged value would still be sitting there for a downstream filter or the
 *     backend to read. (Same remove-before-use reasoning as
 *     delegation-validate.groovy.)
 *  2. An unset secret disables the bridge entirely and can never match, INCLUDING
 *     against an empty bearer — the failure mode that would turn missing config
 *     into an open door.
 *
 * A bridge call with no subject token is REFUSED, not given a synthetic machine
 * subject. This mirrors GatewayServer.ts:716-723 deliberately: the gateway's
 * contract is a delegated identity, and inventing one would let a scope-gated
 * tool run with nobody attached to it. (Note this is a considered deviation from
 * the written plan, which proposed a `sub: 'privilege-bridge'` machine subject;
 * #3058 chose refusal on the Node side and this matches it.)
 *
 * MOUNTED at index 1 on the MCP route — after TransactionHop so the ledger still
 * observes a bridge refusal (TransactionHop is outermost by design so it sees
 * denies), and BEFORE McpAudit and McpProtectionFilter so the static secret is
 * gone from the request before anything logs or introspects it.
 */

import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

import java.security.MessageDigest

def SUBJECT_HEADER = 'X-Subject-Token'
// A bearer slot is not a payload channel; refuse anything implausible for a JWT.
def MAX_SUBJECT_TOKEN_BYTES = 8192
def BRIDGE_MARKER = 'X-Privilege-Bridge'

def secret = System.getenv('MCP_GW_PRIVILEGE_BRIDGE_SECRET') ?: ''

def authorization = request.headers.getFirst('Authorization') ?: ''
def bearer = authorization.regionMatches(true, 0, 'Bearer ', 0, 7)
    ? authorization.substring(7).trim()
    : ''

/** Constant-time equality. Length is compared first (it is not the secret; the value is). */
def bridgeBearer = {
    if (!secret || !bearer) return false
    byte[] a = bearer.getBytes('UTF-8')
    byte[] b = secret.getBytes('UTF-8')
    if (a.length != b.length) return false
    return MessageDigest.isEqual(a, b)
}()

// The marker is ours to set, never the caller's to assert.
request.headers.remove(BRIDGE_MARKER)

if (!bridgeBearer) {
    // Not the bridge. Strip the subject header so a forged identity cannot reach
    // any downstream filter or the backend, then carry on exactly as before —
    // this filter is invisible to every ordinary caller.
    request.headers.remove(SUBJECT_HEADER)
    return next.handle(context, request)
}

// ── From here down, the caller has proven it is the Privilege bridge ──────────

def reject = { String error, String detail ->
    logger.warn('[PrivilegeBridge] ' + detail)
    def r = new Response(Status.UNAUTHORIZED)
    r.headers.put('Content-Type', ['application/json'])
    r.headers.put('WWW-Authenticate', ['Bearer error="' + error + '", error_description="' + detail + '"'])
    r.entity.setString(JsonOutput.toJson([error: error, detail: detail]))
    return Promises.newResultPromise(r)
}

// A repeated header would let a caller smuggle two identities into one slot, so
// refuse rather than guess which was meant (Node: subjectTokenFromHeaders).
def subjectValues = request.headers.get(SUBJECT_HEADER)?.values ?: []
if (subjectValues.size() > 1) {
    request.headers.remove(SUBJECT_HEADER)
    return reject('invalid_token', 'Privilege bridge presented more than one X-Subject-Token')
}

def subjectToken = (subjectValues.isEmpty() ? '' : (subjectValues[0] ?: '')).toString().trim()
request.headers.remove(SUBJECT_HEADER)

if (!subjectToken) {
    return reject('invalid_token', 'Privilege bridge presented no X-Subject-Token')
}
if (subjectToken.getBytes('UTF-8').length > MAX_SUBJECT_TOKEN_BYTES) {
    return reject('invalid_token', 'Privilege bridge X-Subject-Token exceeds ' + MAX_SUBJECT_TOKEN_BYTES + ' bytes')
}

// Swap the bridge credential out for the user's own token. Remove before add:
// `.add` alone would leave Privilege's static token ahead of ours and a
// downstream getFirst() would read THAT (delegation-validate.groovy's lesson).
request.headers.remove('Authorization')
request.headers.add('Authorization', 'Bearer ' + subjectToken)

// So the audit trail and p1az-decision can record Privilege as an actor hop —
// the Node side extends `act`; here the hop is published as a header because IG
// derives its claims from introspection of the token we just swapped in.
request.headers.add(BRIDGE_MARKER, 'true')

logger.info('[PrivilegeBridge] ✅ bridge bearer accepted — running the pipeline on the subject token')

return next.handle(context, request)
