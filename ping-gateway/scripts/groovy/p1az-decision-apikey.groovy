/**
 * p1az-decision-apikey.groovy — Phase 3 P1AZ Per-Tool Authorization
 *
 * PingGateway filter for invoking PingOne Authorize (P1AZ) on consent/step-up tools
 * called via the /mcp/apikey endpoint.
 *
 * Flow:
 *   1. Extract X-MCP-Tool header (the tool name)
 *   2. Look up the tool's challengeType in scope-topology.json
 *   3. If challengeType='consent' or 'step_up', invoke P1AZ decision endpoint
 *   4. On DENY: return 403 Forbidden
 *   5. On PERMIT with obligation (e.g., HITL_CONSENT): return 428 Precondition Required
 *   6. On PERMIT without obligation: continue to next handler
 *
 * Integration:
 *   - Mounted in 00-mcp-apikey.json BEFORE the MCP server handler
 *   - Reads tool metadata from a local scope-topology.json replica or cache
 *   - Calls PingOne Authorize decision endpoint (PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID)
 *
 * Security:
 *   - Requires valid bearer token (already introspected by prior stage)
 *   - P1AZ decision endpoint requires worker credentials (PINGONE_AUTHORIZE_WORKER_CLIENT_ID)
 *   - Timeouts prevent indefinite hangs (5 second timeout)
 */

import org.forgerock.json.JsonValue
import org.forgerock.openig.heap.HeapException
import javax.net.ssl.HttpsURLConnection
import java.net.URL
import java.util.Base64

def logger = org.slf4j.LoggerFactory.getLogger('p1az-decision-apikey')

// 1. Extract tool name and authorization context
def toolName = request.headers.get('X-MCP-Tool')?.getValues()?.get(0)
def authzHeader = request.headers.get('Authorization')?.getValues()?.get(0)

if (!toolName || !authzHeader) {
  logger.debug('[p1az-decision-apikey] Tool or auth header missing; skipping P1AZ check')
  return next.handle(context, request)
}

// 2. Load scope-topology to check tool's challengeType
def scopeTopologyUrl = System.getenv('SCOPE_TOPOLOGY_URL') ?: 'https://api.ping.demo:3001/scope-topology.json'
def toolChallengeType = null

try {
  def stUrl = new URL(scopeTopologyUrl)
  def stConn = stUrl.openConnection()
  stConn.setConnectTimeout(2000)
  stConn.setReadTimeout(2000)

  if (stConn.getResponseCode() == 200) {
    def stJson = JsonValue.json(stConn.getInputStream().getText()).asMap()
    def tools = stJson.tools as Map
    def toolDef = tools[toolName] as Map
    toolChallengeType = toolDef?.challengeType as String
  } else {
    logger.warn('[p1az-decision-apikey] Failed to fetch scope-topology')
  }
} catch (Exception e) {
  logger.warn('[p1az-decision-apikey] Failed to load scope-topology', ['error': e.getMessage()])
}

// 3. Skip P1AZ check if tool doesn't declare a challengeType
if (!toolChallengeType || !['consent', 'step_up'].contains(toolChallengeType)) {
  logger.debug('[p1az-decision-apikey] Tool has no challenge type; allowing', ['tool': toolName])
  return next.handle(context, request)
}

// 4. Prepare P1AZ decision request
def p1azEndpointId = System.getenv('PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID')
def p1azEnvId = System.getenv('PINGONE_ENVIRONMENT_ID')
def p1azRegion = System.getenv('PINGONE_REGION') ?: 'com'

if (!p1azEndpointId || !p1azEnvId) {
  logger.warn('[p1az-decision-apikey] P1AZ not configured; allowing tool access')
  return next.handle(context, request)
}

// 5. Get worker token for P1AZ authorization
def workerId = System.getenv('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')
def workerSecret = System.getenv('PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET')

if (!workerId || !workerSecret) {
  logger.warn('[p1az-decision-apikey] P1AZ worker creds not configured; allowing')
  return next.handle(context, request)
}

try {
  // Get access token for P1AZ
  def tokenUrl = new URL("https://auth.pingone.${p1azRegion}/${p1azEnvId}/as/token")
  def tokenConn = tokenUrl.openConnection() as HttpsURLConnection
  def auth = Base64.getEncoder().encodeToString("${workerId}:${workerSecret}".getBytes())

  tokenConn.setRequestMethod('POST')
  tokenConn.setRequestProperty('Authorization', "Basic ${auth}")
  tokenConn.setRequestProperty('Content-Type', 'application/x-www-form-urlencoded')
  tokenConn.setConnectTimeout(5000)
  tokenConn.setReadTimeout(5000)

  def tokenBody = 'grant_type=client_credentials'
  tokenConn.setDoOutput(true)
  tokenConn.getOutputStream().write(tokenBody.getBytes())

  if (tokenConn.getResponseCode() != 200) {
    logger.warn('[p1az-decision-apikey] Failed to get P1AZ worker token')
    return next.handle(context, request) // fail open on token error
  }

  def tokenJson = JsonValue.json(tokenConn.getInputStream().getText()).asMap()
  def workerToken = tokenJson.access_token

  // 6. Invoke P1AZ decision endpoint
  def decisionUrl = new URL("https://api.pingone.${p1azRegion}/v1/environments/${p1azEnvId}/decisionEndpoints/${p1azEndpointId}")
  def decisionConn = decisionUrl.openConnection() as HttpsURLConnection

  decisionConn.setRequestMethod('POST')
  decisionConn.setRequestProperty('Authorization', "Bearer ${workerToken}")
  decisionConn.setRequestProperty('Content-Type', 'application/json')
  decisionConn.setConnectTimeout(5000)
  decisionConn.setReadTimeout(5000)

  def decisionBody = JsonValue.json([
    parameters: [
      ToolName: toolName,
      ChallengeType: toolChallengeType,
      // Additional params can be added: Amount, TransactionType, etc.
    ]
  ]).getObject().toString()

  decisionConn.setDoOutput(true)
  decisionConn.getOutputStream().write(decisionBody.getBytes())

  int decisionStatus = decisionConn.getResponseCode()

  if (decisionStatus != 200) {
    logger.warn('[p1az-decision-apikey] P1AZ returned non-200', ['status': decisionStatus])
    return next.handle(context, request) // fail open on P1AZ error
  }

  def decisionJson = JsonValue.json(decisionConn.getInputStream().getText()).asMap()
  def decision = decisionJson.result?.decision as String ?: 'INDETERMINATE'
  def obligations = decisionJson.result?.obligations as List ?: []

  logger.info('[p1az-decision-apikey] P1AZ decision', ['tool': toolName, 'decision': decision])

  // 7. Handle P1AZ decision
  if (decision == 'DENY') {
    return Response.status(403).entity(JsonValue.json(
      ['code': 'p1az_denied', 'message': 'Tool access denied by authorization policy']
    ).asMap()).build()
  }

  // Check for HITL obligation (consent required)
  def hasHitlObligation = obligations.any { it.type == 'HITL_CONSENT' || it.type == 'HITL_STEP_UP' }
  if (hasHitlObligation) {
    return Response.status(428).entity(JsonValue.json(
      ['code': 'hitl_required', 'message': 'Human approval required for this tool', 'obligations': obligations]
    ).asMap()).build()
  }

  // PERMIT: continue to next handler
  return next.handle(context, request)

} catch (Exception e) {
  logger.error('[p1az-decision-apikey] P1AZ invocation failed', ['error': e.getMessage()])
  return next.handle(context, request) // fail open on exception
}
