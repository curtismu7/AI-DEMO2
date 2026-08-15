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

// Defaults match the Node gateway's UC18 limiter (20 requests per 60s) — the contract
// requires the same limits on both paths, and 3-per-10s made the IG path reject bursts
// the Node path allowed for the same token.
def maxRequests = (System.getenv('PG_RATE_LIMIT_MAX_REQUESTS') ?: '20') as int
def windowMs    = (System.getenv('PG_RATE_LIMIT_WINDOW_MS') ?: '60000') as long
if (maxRequests <= 0) maxRequests = 20
if (windowMs <= 0) windowMs = 60000L

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

// Read the subject from BOTH claim locations. contexts['oauth2'] is populated only by
// the introspection routes (OAuth2ResourceServerFilter); on the JWKS routes
// jwks-token-validation.groovy:184 stores the claims in attributes['oauth2AccessToken']
// instead, so this used to fall through to 'unknown' and EVERY JWKS caller shared one
// rate-limit bucket (one user could exhaust the limit for all of them).
def sub = 'unknown'
try {
    def oauth2Ctx = contexts['oauth2']
    if (oauth2Ctx != null && oauth2Ctx.accessToken != null) {
        def info = oauth2Ctx.accessToken.getInfo()
        if (info instanceof Map && info.sub) {
            sub = info.sub.toString()
        }
    }
    if (sub == 'unknown') {
        def rawAttr = attributes['oauth2AccessToken']
        def attrInfo = (rawAttr instanceof Map)
            ? rawAttr
            : (rawAttr != null && rawAttr.respondsTo('getInfo') ? rawAttr.getInfo() : null)
        if (attrInfo instanceof Map && attrInfo.sub) {
            sub = attrInfo.sub.toString()
        }
    }
} catch (Exception e) {
    logger.warn('[UC18] sub extraction failed: ' + e.message)
}
if (sub == 'unknown') {
    logger.warn('[UC18] no sub in contexts[oauth2] or attributes[oauth2AccessToken] — ' +
        'callers will share a single rate-limit bucket')
}

def toolName = (body.params instanceof Map && body.params.name) ? body.params.name.toString() : 'unknown_tool'
def rlKey    = "${sub}:${toolName}"

if (globals._uc18Windows == null) {
    globals._uc18Windows = [:]
}

// PingGateway/IG is multi-threaded (unlike the Node counterpart's single-threaded
// event loop), so the read-check-append-write below must be atomic per rlKey or two
// concurrent requests for the same key can both read the same stale window and both
// pass. Synchronize on `globals` — the same per-script-context shared object already
// used as the cross-request store above — to serialize the compound update.
def now
def windowStart
def limited = false
def retryAfterMs = 0L
synchronized (globals) {
    now         = System.currentTimeMillis()
    windowStart = now - windowMs
    def timestamps = (globals._uc18Windows[rlKey] ?: []).findAll { (it as long) > windowStart }

    if (timestamps.size() >= maxRequests) {
        limited = true
        def oldest = timestamps[0] as long
        retryAfterMs = Math.max(1L, oldest + windowMs - now)
    } else {
        timestamps.add(now)
        globals._uc18Windows[rlKey] = timestamps
    }
}

if (limited) {
    def resp = new Response(Status.TOO_MANY_REQUESTS)
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

return next.handle(context, request)
