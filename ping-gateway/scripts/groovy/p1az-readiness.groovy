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
    P1AZ_WORKER_ID            : System.getenv('P1AZ_WORKER_ID'),
    PINGONE_TOKEN_ENDPOINT    : System.getenv('PINGONE_TOKEN_ENDPOINT'),
    P1AZ_WORKER_CLIENT_ID     : System.getenv('P1AZ_WORKER_CLIENT_ID'),
    P1AZ_WORKER_CLIENT_SECRET : System.getenv('P1AZ_WORKER_CLIENT_SECRET'),
]
def missing = required.findAll { k, v -> !v }.keySet() as List

def resp = new Response(missing.isEmpty() ? Status.OK : Status.SERVICE_UNAVAILABLE)
resp.headers.put('Content-Type', 'application/json')
resp.entity.setString(JsonOutput.toJson([
    ready  : missing.isEmpty(),
    backend: 'real',
    missing: missing,
]))
return Promises.newResultPromise(resp)
