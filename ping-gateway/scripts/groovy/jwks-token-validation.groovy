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
def mockSecret         = System.getenv('AUTHZ_JWT_SECRET') ?: ''
def mockIssuer         = System.getenv('AUTHZ_ISSUER_URI') ?: ''
def gatewayResourceUri = System.getenv('PG_GATEWAY_RESOURCE_URI') ?: ''
def gatewayResourceId  = System.getenv('PG_GATEWAY_RESOURCE_ID') ?: ''
def requiredScope      = System.getenv('PG_INBOUND_SCOPE') ?: 'mcp:invoke'

def deny = { String reason ->
    logger.info('[JWKS] validation FAILED: ' + reason)
    def resp = new Response(Status.UNAUTHORIZED)
    resp.headers.put('Content-Type', 'application/json')
    resp.headers.put('WWW-Authenticate',
        'Bearer realm="mcp", error="invalid_token", error_description="' + reason + '"')
    resp.entity.setString('{"error":"invalid_token","validation":"jwks","reason":"' + reason + '"}')
    return Promises.newResultPromise(resp)
}

def b64url = { String s -> java.util.Base64.getUrlDecoder().decode(s) }

// ── 1. Extract and split the bearer JWT ───────────────────────────────────────
def authz = request.headers.getFirst('Authorization') ?: ''
if (!authz.toLowerCase().startsWith('bearer ')) return deny('missing_bearer')
def token = authz.substring(7).trim()
def parts = token.split('\\.')
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

// ── 2. Signature verification, branched on alg ────────────────────────────────
// JWKS fetch with ~5-minute cache in script globals (survives across requests).
def fetchJwks = { boolean forceRefresh ->
    long nowMs = System.currentTimeMillis()
    def cache = globals._jwksCache
    if (!forceRefresh && cache?.keys && nowMs < (cache.expiresAt as long)) {
        return cache.keys
    }
    def conn = new URL(jwksUri).openConnection() as java.net.HttpURLConnection
    conn.connectTimeout = 5000
    conn.readTimeout    = 5000
    def keys = new JsonSlurper().parse(conn.inputStream)['keys'] ?: []
    globals._jwksCache = [keys: keys, expiresAt: nowMs + 300_000L]
    logger.info('[JWKS] fetched ' + keys.size() + ' key(s) from ' + jwksUri)
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
    if (!jwksUri) return deny('jwks_uri_not_configured')
    def kid = jwtHeader['kid'] as String
    def jwk
    try {
        jwk = findJwk(fetchJwks(false), kid)
        if (jwk == null) {
            // Key rotation: refetch once on kid miss before rejecting.
            jwk = findJwk(fetchJwks(true), kid)
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
    if (!issuerUri || iss != issuerUri) return deny('issuer_mismatch')
} else if (mockIssuer) {
    if (iss != mockIssuer) return deny('issuer_mismatch')
}

def rawAud = claims['aud']
def audList = rawAud instanceof List ? rawAud.collect { it as String } : (rawAud ? [rawAud as String] : [])
def audOk = audList.any { it == gatewayResourceUri || it == gatewayResourceId }
if (!audOk) return deny('audience_mismatch')

def scopes = ((claims['scope'] ?: '') as String).tokenize(' ')
if (!scopes.contains(requiredScope)) return deny('insufficient_scope')

// ── 4. Success: expose claims to downstream filters, stamp the demo header ────
attributes['oauth2AccessToken'] = claims
logger.info('[JWKS] validation ok: alg=' + alg + ' sub=' + (claims['sub'] ?: '') +
    ' aud=' + audList.join(',') + ' (local validation — no introspection call)')

return next.handle(context, request).thenOnResult { rsp ->
    rsp.headers.add('X-Token-Validation-Mode', 'jwks')
}
