// ping-gateway/scripts/groovy/mcp-request-validation.groovy
//
// Spec §3 — MCP request validation for the IG gateway. Mirrors the Node
// gateway's mcpRequestValidation.ts: method allow-list, tools/call shape,
// and a documented SUBSET of JSON Schema against the mounted artifact:
//   type:"object", required[], properties.<k>.type (string|number|integer|
//   boolean|object|array), additionalProperties:false.
// Failures return HTTP 400 with a JSON-RPC -32602/-32601 body.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def SCHEMAS_PATH = '/var/gateway/config/mcp-tool-schemas.json'
def ALLOWED_METHODS = ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'] as Set

def rpcError = { Object id, int code, String message, Object data ->
    def resp = new Response(Status.BAD_REQUEST)
    def err = [code: code, message: message]
    if (data != null) err.data = data
    resp.headers.put('Content-Type', 'application/json')
    resp.entity.setString(JsonOutput.toJson([jsonrpc: '2.0', id: id, error: err]))
    return Promises.newResultPromise(resp)
}

def typeOk = { Object v, String t ->
    switch (t) {
        case 'string':  return v instanceof String
        case 'number':  return v instanceof Number
        case 'integer': return v instanceof Integer || v instanceof Long || v instanceof java.math.BigInteger
        case 'boolean': return v instanceof Boolean
        case 'object':  return v instanceof Map
        case 'array':   return v instanceof List
        default:        return true // unknown type keyword — do not enforce
    }
}

def body
try {
    body = new JsonSlurper().parseText(request.entity.string ?: '')
} catch (Exception e) {
    return rpcError(null, -32700, 'Parse error', null)
}
if (!(body instanceof Map)) return rpcError(null, -32700, 'Parse error', null)

def method = body.method
def id = body.containsKey('id') ? body.id : null
if (!(method instanceof String) || !ALLOWED_METHODS.contains(method)) {
    return rpcError(id, -32601, "Method not found: ${method}", null)
}

if (method == 'tools/call') {
    def params = body.params
    if (!(params instanceof Map) || !(params.name instanceof String) || ((String) params.name).isEmpty()) {
        return rpcError(id, -32602, 'Invalid params: tools/call requires a non-empty string params.name', null)
    }
    def args = params.arguments != null ? params.arguments : [:]
    if (!(args instanceof Map)) {
        return rpcError(id, -32602, 'Invalid params: params.arguments must be an object', null)
    }
    args = new LinkedHashMap(args)
    // gateway-internal HITL retry marker
    def rawHitlMarker = args['_hitl_challenge_id']
    def hadHitlMarker = args.remove('_hitl_challenge_id') != null

    def artifact = new JsonSlurper().parse(new File(SCHEMAS_PATH))
    def entry = artifact.tools[params.name]
    if (entry == null) {
        return rpcError(id, -32602, "Unknown tool: ${params.name}", [unknownTool: true])
    }
    def schema = entry.inputSchema
    def errors = []
    (schema.required ?: []).each { req ->
        if (!args.containsKey(req)) errors << [path: "/${req}", message: 'required property missing']
    }
    def props = schema.properties ?: [:]
    args.each { k, v ->
        def prop = props[k]
        if (prop == null) {
            if (schema.additionalProperties == false) errors << [path: "/${k}", message: 'additional property not allowed']
        } else if (prop.type instanceof String && !typeOk(v, (String) prop.type)) {
            errors << [path: "/${k}", message: "expected type ${prop.type}"]
        }
    }
    if (!errors.isEmpty()) {
        return rpcError(id, -32602, "Invalid arguments for tool ${params.name}", [validationErrors: errors])
    }

    // Removing the marker above only cleaned THIS filter's copy — the original
    // entity still carried it downstream, and the MCP server validates tool
    // arguments against the same additionalProperties:false schema, so it
    // answered "Invalid parameters: Additional property not allowed:
    // _hitl_challenge_id" (surfaced as 502 backend_execution_failed). Forward
    // the cleaned arguments, matching the Node gateway (authorizeMcpRequest.ts
    // WR-03, index.ts).
    if (hadHitlMarker) {
        params.arguments = args
        request.entity.setString(JsonOutput.toJson(body))
        // This filter runs BEFORE P1AZDecision, and the rewrite above just
        // removed the receipt from the body — without a hand-over the receipt
        // verification in p1az-decision.groovy is unreachable and every
        // approved retry re-mints a fresh 428 challenge forever. Same
        // cross-filter channel the aam-* scripts use (AttributesContext).
        attributes['hitlChallengeId'] = String.valueOf(rawHitlMarker)
    }
}

return next.handle(context, request)
