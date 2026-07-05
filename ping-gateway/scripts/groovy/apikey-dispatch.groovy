/**
 * apikey-dispatch.groovy
 *
 * PingGateway dispatch filter for API-key-authenticated MCP access (/mcp/apikey).
 *
 * Flow:
 *   1. Extract X-API-Key header from the request
 *   2. Validate the key against the configured API key store (env VALID_API_KEYS)
 *   3. If valid, attach a synthetic bearer token or user context for downstream P1AZ gating
 *   4. Forward to the MCP server; PingGateway introspection + P1AZ will enforce per-tool authorization
 *   5. Per-tool scopes are enforced by the mcp-olb route via the RsFilterTokenResolver
 *
 * Security:
 *   - API keys are NOT cached — every request validates against VALID_API_KEYS
 *   - The endpoint requires HTTPS in production (enforced by PingGateway config)
 *   - No session or user context — each request is independent
 *   - P1AZ resource server (MCP Gateway) is the authoritative access-control point
 */

import org.forgerock.json.JsonValue
import org.forgerock.openig.heap.HeapException

// Configuration — read from environment or PingGateway secrets
def validApiKeys = (System.getenv('VALID_API_KEYS') ?: '')
  .split(',')
  .collect { it?.trim() }
  .findAll { it }

def apiKeyHeader = 'X-API-Key'
def apiKey = request.headers.get(apiKeyHeader)?.getValues()?.get(0)

// 1. Validate API key presence and format
if (!apiKey || apiKey.isEmpty()) {
  context.attributes['statusCode'] = 401
  context.attributes['errorMessage'] = 'Missing or invalid X-API-Key header'
  return Response.status(401).entity(JsonValue.json(
    ['code': 'invalid_apikey', 'message': 'X-API-Key header is required']
  ).asMap()).build()
}

// 2. Validate API key against allowed list
if (!validApiKeys || !validApiKeys.contains(apiKey)) {
  context.attributes['statusCode'] = 403
  context.attributes['errorMessage'] = "Invalid API key (${apiKey?.substring(0, 5)}...)"
  return Response.status(403).entity(JsonValue.json(
    ['code': 'forbidden', 'message': 'Invalid API key']
  ).asMap()).build()
}

// 3. Log successful API key validation
def logger = org.slf4j.LoggerFactory.getLogger('apikey-dispatch')
logger.info("[apikey-dispatch] Valid API key accepted; forwarding to MCP server")

// 4. Attach synthetic user context for P1AZ decision logging
// (In production, you would map the API key to a user/service identity and
// set the Authorization header to a signed JWT or bearer token that PingGateway
// can introspect. For now, we pass through with the API key as-is and rely on
// downstream MCP gateway + PingGateway introspection to handle authorization.)
request.headers.put('X-API-Key-Source', 'apikey-dispatch')

// 5. Continue to the next handler (MCP server forwarding)
return next.handle(context, request)
