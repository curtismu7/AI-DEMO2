/*
 * uc18-rate-limit.groovy — PingGateway-native UC18 per-agent/per-tool rate limiting.
 *
 * Runs AFTER token validation + MCP body parse (McpValidationFilter / mcp-request-validation)
 * and BEFORE p1az-decision.groovy so throttled requests never reach PingOne Authorize.
 *
 * Parity with demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts UC18 block.
 *
 * Activation (either):
 *   PG_RATE_LIMIT_ENABLED=true
 *   OR trusted BFF caller (x-internal-gateway-secret) with X-UC18-Rate-Limit: true
 *      (mirrors ff_mcp_rate_limit from the BFF — no IG restart required for demos)
 *
 * Env:
 *   PG_RATE_LIMIT_ENABLED       — 'true' to always arm (default off)
 *   PG_RATE_LIMIT_MAX_REQUESTS  — default 3
 *   PG_RATE_LIMIT_WINDOW_MS     — default 10000
 *   BFF_INTERNAL_SECRET         — timing-safe gate for the live header toggle
 */

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def envEnabled = System.getenv('PG_RATE_LIMIT_ENABLED') == 'true'

def internalSecret   = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def presentedSecret  = request.headers.getFirst('x-internal-gateway-secret') ?: ''
def trustedCaller    = false
if (internalSecret && presentedSecret) {
    trustedCaller = java.security.MessageDigest.isEqual(
        internalSecret.getBytes('UTF-8'), presentedSecret.getBytes('UTF-8'))
}

def headerEnabled = trustedCaller &&
    (request.headers.getFirst('X-UC18-Rate-Limit') ?: '').trim() == 'true'

if (!envEnabled && !headerEnabled) {
    return next.handle(context, request)
}

def maxRequests = (System.getenv('PG_RATE_LIMIT_MAX_REQUESTS') ?: '3') as int
def windowMs    = (System.getenv('PG_RATE_LIMIT_WINDOW_MS') ?: '10000') as long
if (maxRequests <= 0) maxRequests = 3
if (windowMs <= 0) windowMs = 10000L

def rawBody = request.entity.string ?: ''
if (rawBody) {
    request.entity.setString(rawBody)
}

def body
try {
    body = new JsonSlurper().parseText(rawBody ?: '{}')
} catch (Exception e) {
    return next.handle(context, request)
}
if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def sub = 'unknown'
try {
    def oauth2Ctx = contexts['oauth2']
    if (oauth2Ctx != null && oauth2Ctx.accessToken != null) {
        def info = oauth2Ctx.accessToken.getInfo()
        if (info instanceof Map && info.sub) {
            sub = info.sub.toString()
        }
    }
} catch (Exception e) {
    logger.warn('[UC18] sub extraction failed: ' + e.message)
}

def toolName = (body.params instanceof Map && body.params.name) ? body.params.name.toString() : 'unknown_tool'
def rlKey    = "${sub}:${toolName}"

if (globals._uc18Windows == null) {
    globals._uc18Windows = [:]
}

def now         = System.currentTimeMillis()
def windowStart = now - windowMs
def timestamps  = (globals._uc18Windows[rlKey] ?: []).findAll { (it as long) > windowStart }

if (timestamps.size() >= maxRequests) {
    def oldest       = timestamps[0] as long
    def retryAfterMs = Math.max(1L, oldest + windowMs - now)
    def resp         = new Response(Status.TOO_MANY_REQUESTS)
    resp.headers.put('Content-Type', 'application/json')
    resp.headers.put('Retry-After', String.valueOf((long) Math.ceil(retryAfterMs / 1000.0d)))
    resp.entity.setString(JsonOutput.toJson([
        error       : 'rate_limited',
        code        : 'rate_limited',
        message     : 'Tool call rate limit exceeded. Retry after the indicated interval.',
        retryAfterMs: retryAfterMs,
        rateLimitLayer: 'ig',
    ]))
    logger.warn("[UC18] rate_limited key=${rlKey} retryAfterMs=${retryAfterMs}")
    return Promises.newResultPromise(resp)
}

timestamps.add(now)
globals._uc18Windows[rlKey] = timestamps

return next.handle(context, request)
