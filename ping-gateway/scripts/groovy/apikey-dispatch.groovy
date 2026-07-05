/**
 * apikey-dispatch.groovy — Phase 2 Bearer Token Generation
 *
 * PingGateway dispatch filter for API-key-authenticated MCP access (/mcp/apikey).
 *
 * Flow:
 *   1. Extract X-API-Key header from the request
 *   2. Exchange the API key for a bearer token via BFF /api/mcp/apikey/exchange
 *   3. Replace X-API-Key with Authorization: Bearer <token> for introspection
 *   4. Forward to the MCP server; PingGateway introspection + P1AZ will enforce per-tool authorization
 *   5. Per-tool scopes are enforced by the mcp-olb route via the RsFilterTokenResolver
 *
 * Security:
 *   - API keys are validated server-side (BFF service) — not cached locally
 *   - Bearer tokens are signed JWTs, validated by PingGateway introspection
 *   - The endpoint requires HTTPS in production (enforced by PingGateway config)
 *   - P1AZ resource server (MCP Gateway) is the authoritative access-control point
 */

import org.forgerock.json.JsonValue
import org.forgerock.openig.heap.HeapException
import javax.net.ssl.HttpsURLConnection
import java.net.URL

def apiKeyHeader = 'X-API-Key'
def apiKey = request.headers.get(apiKeyHeader)?.getValues()?.get(0)
def logger = org.slf4j.LoggerFactory.getLogger('apikey-dispatch')

// 1. Validate API key presence
if (!apiKey || apiKey.isEmpty()) {
  logger.warn('[apikey-dispatch] Missing X-API-Key header')
  context.attributes['statusCode'] = 401
  return Response.status(401).entity(JsonValue.json(
    ['code': 'invalid_apikey', 'message': 'X-API-Key header is required']
  ).asMap()).build()
}

// 2. Exchange API key for bearer token via BFF
def bffExchangeUrl = System.getenv('BFF_APIKEY_EXCHANGE_URL') ?: 'https://api.ping.demo:3001/api/mcp/apikey/exchange'
try {
  def url = new URL(bffExchangeUrl)
  def conn = url.openConnection() as HttpsURLConnection

  // Disable cert validation in dev (set BFF_APIKEY_EXCHANGE_SKIP_CERT_CHECK=true)
  if (System.getenv('BFF_APIKEY_EXCHANGE_SKIP_CERT_CHECK') == 'true') {
    def sslContext = javax.net.ssl.SSLContext.getInstance('TLSv1.2')
    sslContext.init(null, [new org.forgerock.util.trustmanager.TrustAllX509CertificateManager()] as javax.net.ssl.TrustManager[], null)
    conn.setSSLSocketFactory(sslContext.getSocketFactory())
    conn.setHostnameVerifier({ hostname, session -> true } as javax.net.ssl.HostnameVerifier)
  }

  conn.setRequestMethod('POST')
  conn.setRequestProperty('Content-Type', 'application/json')
  conn.setRequestProperty('X-API-Key', apiKey)
  conn.setConnectTimeout(5000)
  conn.setReadTimeout(5000)

  int statusCode = conn.getResponseCode()

  if (statusCode == 200) {
    def responseText = conn.getInputStream().getText()
    def responseJson = JsonValue.json(responseText).asMap()
    def bearerToken = responseJson.token

    if (!bearerToken) {
      logger.error('[apikey-dispatch] BFF returned no token')
      return Response.status(500).entity(JsonValue.json(
        ['code': 'token_generation_failed', 'message': 'No token in exchange response']
      ).asMap()).build()
    }

    logger.info('[apikey-dispatch] Token exchanged successfully', ['userId': responseJson.userId])

    // 3. Replace API key with bearer token
    request.headers.remove(apiKeyHeader)
    request.headers.put('Authorization', "Bearer ${bearerToken}")

    // 4. Continue to next handler (introspection + MCP server forwarding)
    return next.handle(context, request)
  } else {
    def errorText = conn.getErrorStream()?.getText() ?: ''
    logger.warn('[apikey-dispatch] BFF exchange failed', ['status': statusCode, 'error': errorText])
    return Response.status(statusCode).entity(JsonValue.json(
      ['code': 'exchange_failed', 'message': "BFF returned ${statusCode}"]
    ).asMap()).build()
  }
} catch (Exception e) {
  logger.error('[apikey-dispatch] Exchange call failed', ['error': e.getMessage()])
  return Response.status(503).entity(JsonValue.json(
    ['code': 'service_unavailable', 'message': 'Bearer token exchange service unavailable']
  ).asMap()).build()
}
