/*
 * Local (no-introspection) inbound token validation for the JWKS demo route
 * (00-mcp-olb-jwks.json). Selected per request when the BFF stamps
 * X-Token-Validation: jwks (effective ff_mcp_gateway_jwks). Replaces the
 * TokenIntrospectionAccessTokenResolver/OAuth2ResourceServerFilter stage of
 * route 01-mcp-olb.json.
 *
 * Branches on the JWT alg header:
 *   RS256 -> verify against the PingOne JWKS (PINGONE_JWKS_URI, cached ~5 min)
 *   HS256 -> verify against the mock demo_authz_server shared secret
 *            (AUTHZ_JWT_SECRET); fail closed when unset
 *   anything else (incl. none) -> 401
 *
 * Claim checks: exp/nbf (30s skew), aud must contain PG_GATEWAY_RESOURCE_URI or
 * PG_GATEWAY_RESOURCE_ID, scope must contain PG_INBOUND_SCOPE. iss: RS256
 * requires PINGONE_ISSUER_URI; HS256 checks AUTHZ_ISSUER_URI only when set
 * (secret possession is the mock trust anchor).
 *
 * On success the claims Map is stored in attributes['oauth2AccessToken'] — the
 * documented fallback p1az-decision.groovy reads when no OAuth2Context exists —
 * so the downstream authorize + token-exchange filters run unmodified.
 *
 * On 401, WWW-Authenticate includes RFC 9728 `resource_metadata` pointing at
 * the protected-resource metadata URL derived from PG_GATEWAY_RESOURCE_ID
 * (cosmetic parity with McpProtectionFilter; this script is NOT wrapped by that
 * filter — see docs/superpowers/plans/2026-07-22-mcp-protection-filter-gap.md).
 *
 * EDUCATIONAL TRADEOFF (by design): no round-trip to the authorization server,
 * so revocation is NOT detected until the token expires.
 */

import groovy.json.JsonSlurper
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.RSAPublicKeySpec

def issuerUri          = System.getenv('PINGONE_ISSUER_URI') ?: ''
def jwksUri            = System.getenv('PINGONE_JWKS_URI') ?: (issuerUri ? issuerUri + '/jwks' : '')
// Secondary issuer (PingFederate, 2026-09-22 A2A-under-PF): PF-minted tokens
// carry iss=https://...:9031 and are signed by the PF JWKS. When PF_ISSUER_URI
// is configured, tokens whose iss matches are verified against PF_JWKS_URI
// instead of the PingOne JWKS.
def pfIssuerUri        = System.getenv('PF_ISSUER_URI') ?: ''
def pfJwksUri          = System.getenv('PF_JWKS_URI') ?: (pfIssuerUri ? pfIssuerUri + '/JWKS' : '')
def mockSecret         = System.getenv('AUTHZ_JWT_SECRET') ?: ''
def mockIssuer         = System.getenv('AUTHZ_ISSUER_URI') ?: ''
def gatewayResourceUri = System.getenv('PG_GATEWAY_RESOURCE_URI') ?: ''
def gatewayResourceId  = System.getenv('PG_GATEWAY_RESOURCE_ID') ?: ''
// Fallback must match the BFF Exchange #2 default (agentMcpTokenService.js
// gateway_mcp_invoke_scope) or an unset PG_INBOUND_SCOPE denies every request.
def requiredScope      = System.getenv('PG_INBOUND_SCOPE') ?: 'gateway:mcp:invoke'

/**
 * Build the RFC 9728 protected-resource metadata URL for a resource identifier.
 * Path resources use /.well-known/oauth-protected-resource{path} after the authority.
 */
def resourceMetadataUrl = {
    if (!gatewayResourceId) return ''
    try {
        def u = new java.net.URI(gatewayResourceId)
        if (u.scheme && u.host) {
            def path = (u.path ?: '')
            if (path == '/') path = ''
            def metaPath = '/.well-known/oauth-protected-resource' + path
            return new java.net.URI(u.scheme, u.userInfo, u.host, u.port, metaPath, null, null).toString()
        }
    } catch (Exception ignored) {
        // fall through
    }
    return gatewayResourceId.replaceAll(/\/$/, '') + '/.well-known/oauth-protected-resource'
}()

def deny = { String reason ->
    logger.info('[JWKS] validation FAILED: ' + reason)
    def resp = new Response(Status.UNAUTHORIZED)
    resp.headers.put('Content-Type', 'application/json')
    // Match McpProtectionFilter challenge shape: Bearer + error + resource_metadata (RFC 9728).
    def wwwAuth = 'Bearer realm="mcp", error="invalid_token", error_description="' + reason + '"'
    if (resourceMetadataUrl) {
        wwwAuth += ', resource_metadata="' + resourceMetadataUrl + '"'
    }
    resp.headers.put('WWW-Authenticate', wwwAuth)
    resp.entity.setString('{"error":"invalid_token","validation":"jwks","reason":"' + reason + '"}')
    return Promises.newResultPromise(resp)
}

def b64url = { String s -> java.util.Base64.getUrlDecoder().decode(s) }

// ── 1. Extract and split the bearer JWT ───────────────────────────────────────
def authz = request.headers.getFirst('Authorization') ?: ''
if (!authz.toLowerCase().startsWith('bearer ')) return deny('missing_bearer')
def token = authz.substring(7).trim()
// limit=-1 preserves trailing empty strings (e.g. the empty "none"-alg signature
// segment "header.payload." would otherwise be silently collapsed to 2 parts by
// Java's default String.split() and misreported as malformed_jwt instead of the
// intended unsupported_alg check below).
def parts = token.split('\\.', -1)
if (parts.length != 3) return deny('malformed_jwt')

def slurper = new JsonSlurper()
def jwtHeader, claims
try {
    jwtHeader = slurper.parse(b64url(parts[0]))
    claims    = slurper.parse(b64url(parts[1]))
} catch (Exception e) {
    return deny('undecodable_jwt')
}
def signedBytes = (parts[0] + '.' + parts[1]).getBytes('US-ASCII')
byte[] sigBytes
try {
    sigBytes = b64url(parts[2])
} catch (Exception e) {
    return deny('undecodable_signature')
}
def alg = (jwtHeader['alg'] ?: '') as String
def iss0 = (claims['iss'] ?: '') as String

// ── 2. Signature verification, branched on alg ────────────────────────────────
// Per-issuer JWKS fetch with ~5-minute cache in script globals (survives across
// requests). Each issuer gets its own cache slot so adding PF doesn't thrash the
// PingOne cache.
def fetchJwksFor = { String uri, boolean forceRefresh ->
    long nowMs = System.currentTimeMillis()
    def cache = globals["_jwksCache_${uri}"]
    if (!forceRefresh && cache?.keys && nowMs < (cache.expiresAt as long)) {
        return cache.keys
    }
    def conn = new URL(uri).openConnection() as java.net.HttpURLConnection
    conn.connectTimeout = 5000
    conn.readTimeout    = 5000
    def keys = new JsonSlurper().parse(conn.inputStream)['keys'] ?: []
    globals["_jwksCache_${uri}"] = [keys: keys, expiresAt: nowMs + 300_000L]
    logger.info('[JWKS] fetched ' + keys.size() + ' key(s) from ' + uri)
    return keys
}
def rsaKeyFor = { Map jwk ->
    def n = new BigInteger(1, b64url(jwk['n'] as String))
    def e = new BigInteger(1, b64url(jwk['e'] as String))
    KeyFactory.getInstance('RSA').generatePublic(new RSAPublicKeySpec(n, e))
}
def findJwk = { List keys, String kid ->
    def rsaKeys = keys.findAll { it['kty'] == 'RSA' && (it['use'] == 'sig' || !it['use']) }
    kid ? rsaKeys.find { it['kid'] == kid } : (rsaKeys.size() == 1 ? rsaKeys[0] : null)
}

if (alg == 'RS256') {
    // Pick the issuer/JWKS pair for this token: PF when PF_ISSUER_URI matches
    // the token's iss, PingOne otherwise.
    def isPfToken = pfIssuerUri && iss0 == pfIssuerUri
    def activeJwksUri = isPfToken ? pfJwksUri : jwksUri
    if (!activeJwksUri) return deny('jwks_uri_not_configured')
    def kid = jwtHeader['kid'] as String
    // PF id-jag / ATM tokens carry x5t (no kid) — match by thumbprint first,
    // then fall back to kid / single-RSA-key behavior.
    def x5t = jwtHeader['x5t'] as String
    def findJwkWithFallback = { List keys ->
        def rsaKeys = keys.findAll { it['kty'] == 'RSA' && (it['use'] == 'sig' || !it['use']) }
        if (kid) return rsaKeys.find { it['kid'] == kid }
        if (x5t) return rsaKeys.find { it['x5t'] == x5t || (it['x5c'] && ((List) it['x5c'])[0] == x5t) }
        return rsaKeys.size() == 1 ? rsaKeys[0] : null
    }
    def jwk
    try {
        jwk = findJwkWithFallback(fetchJwksFor(activeJwksUri, false))
        if (jwk == null) {
            // Key rotation: refetch on kid miss before rejecting — but at most
            // once per 60s (globals-throttled), so unauthenticated bogus-kid
            // tokens can't bypass the cache and drive a fetch per request.
            // IG is multi-threaded, so the read-check-write on
            // globals._jwksForcedFetchAt must be atomic or a concurrent burst
            // can all pass the throttle check at once (see uc18-rate-limit.groovy
            // for the same synchronized(globals) pattern). Only the check-and-set
            // is synchronized — the fetch itself runs outside the lock so
            // concurrent requests aren't serialized on the HTTPS round trip.
            long nowMs = System.currentTimeMillis()
            boolean forceFetchWon = false
            synchronized (globals) {
                def lastForced = (globals._jwksForcedFetchAt ?: 0L) as long
                if (nowMs - lastForced > 60_000L) {
                    globals._jwksForcedFetchAt = nowMs
                    forceFetchWon = true
                }
            }
            if (forceFetchWon) {
                jwk = findJwkWithFallback(fetchJwksFor(activeJwksUri, true))
            }
        }
    } catch (Exception e) {
        logger.warn('[JWKS] JWKS fetch failed: ' + e.message)
        return deny('jwks_fetch_failed')
    }
    if (jwk == null) return deny('no_matching_jwk')
    try {
        def sig = Signature.getInstance('SHA256withRSA')
        sig.initVerify(rsaKeyFor(jwk))
        sig.update(signedBytes)
        if (!sig.verify(sigBytes)) return deny('bad_signature')
    } catch (Exception e) {
        return deny('bad_signature')
    }
} else if (alg == 'HS256') {
    if (!mockSecret) return deny('hs256_secret_not_configured')
    def mac = Mac.getInstance('HmacSHA256')
    mac.init(new SecretKeySpec(mockSecret.getBytes('UTF-8'), 'HmacSHA256'))
    def expected = mac.doFinal(signedBytes)
    if (!MessageDigest.isEqual(expected, sigBytes)) return deny('bad_signature')
} else {
    return deny('unsupported_alg')
}

// ── 3. Claim checks ────────────────────────────────────────────────────────────
long now = System.currentTimeMillis().intdiv(1000L)  // NOT `/` — Groovy `/` on longs yields BigDecimal
long skew = 30L
def expClaim = claims['exp']
if (!(expClaim instanceof Number)) return deny('missing_exp')
if (now > (expClaim as long) + skew) return deny('token_expired')
def nbfClaim = claims['nbf']
if (nbfClaim instanceof Number && now < (nbfClaim as long) - skew) return deny('token_not_yet_valid')

def iss = (claims['iss'] ?: '') as String
if (alg == 'RS256') {
    def pfOk = pfIssuerUri && iss == pfIssuerUri
    if (!pfOk && (!issuerUri || iss != issuerUri)) return deny('issuer_mismatch')
} else if (mockIssuer) {
    if (iss != mockIssuer) return deny('issuer_mismatch')
}

// Fail closed if the gateway has no configured audience identity at all —
// otherwise a signed token carrying an empty-string aud entry would match the
// two empty env fallbacks below.
if (!gatewayResourceUri && !gatewayResourceId) return deny('aud_config_missing')
def rawAud = claims['aud']
def audList = rawAud instanceof List ? rawAud.collect { it as String } : (rawAud ? [rawAud as String] : [])
def audOk = audList.any { it && (it == gatewayResourceUri || it == gatewayResourceId) }
if (!audOk) return deny('audience_mismatch')

// scope may be a space-delimited string (PingOne) or a JSON array (PingFederate
// ATM emits the list form when multiple requested scopes are granted).
def rawScope = claims['scope']
def scopes = (rawScope instanceof List
    ? rawScope.collect { it as String }
    : ((rawScope ?: '') as String).tokenize(' '))
if (!scopes.contains(requiredScope)) return deny('insufficient_scope')

// ── 4. Success: expose claims to downstream filters, stamp the demo header ────
attributes['oauth2AccessToken'] = claims
logger.info('[JWKS] validation ok: alg=' + alg + ' sub=' + (claims['sub'] ?: '') +
    ' aud=' + audList.join(',') + ' (local validation — no introspection call)')

return next.handle(context, request).thenOnResult { rsp ->
    rsp.headers.add('X-Token-Validation-Mode', 'jwks')
}
