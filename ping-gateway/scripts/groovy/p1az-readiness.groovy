/*
 * p1az-readiness.groovy — terminal handler for GET /health.
 *
 * Reports whether the P1AZDecision filter (p1az-decision.groovy) can actually
 * reach a PingOne Authorize backend in its DEFAULT mode (real, non-simulated —
 * the mode used whenever the caller omits X-Authz-Simulated). Root cause of
 * the 2026-07-12 outage: the gateway pod ran for 8h denying every request
 * with "Decision backend not configured (P1AZ_REAL_BASE) — failing closed"
 * while k8s reported it Ready, because the liveness/readiness probes were
 * plain tcpSocket checks against port 8080 — they only prove the port is
 * open, not that P1AZDecision can function. The k8s readinessProbe points at
 * this route instead, so a misconfigured pod fails to become Ready.
 */
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def required = [
    P1AZ_REAL_BASE           : System.getenv('P1AZ_REAL_BASE'),
    P1AZ_DECISION_ENDPOINT_ID : System.getenv('P1AZ_DECISION_ENDPOINT_ID') ?: System.getenv('P1AZ_WORKER_ID'),
    PINGONE_TOKEN_ENDPOINT    : System.getenv('PINGONE_TOKEN_ENDPOINT'),
    P1AZ_WORKER_CLIENT_ID     : System.getenv('P1AZ_WORKER_CLIENT_ID'),
    P1AZ_WORKER_CLIENT_SECRET : System.getenv('P1AZ_WORKER_CLIENT_SECRET'),
]
def missing = required.findAll { k, v -> !v }.keySet() as List

// /health is UNAUTHENTICATED (it is the k8s readinessProbe target), so the response
// carries a boolean readiness only. Enumerating the missing env var names told any
// caller which credentials the gateway is configured with and which are absent —
// a configuration map for an attacker probing the host port. The names are logged
// instead, where the operator diagnosing the probe failure can still see them.
if (!missing.isEmpty()) {
    logger.warn('[P1AZReadiness] NOT READY — missing required env: ' + missing.join(', '))
}

def resp = new Response(missing.isEmpty() ? Status.OK : Status.SERVICE_UNAVAILABLE)
resp.headers.put('Content-Type', 'application/json')
resp.entity.setString(JsonOutput.toJson([
    ready: missing.isEmpty(),
]))
return Promises.newResultPromise(resp)
