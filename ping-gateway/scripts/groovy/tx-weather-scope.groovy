// ping-gateway/scripts/groovy/tx-weather-scope.groovy
//
// Agent Gateway (IG) demo policy: the weather-mcp passthrough is scoped to
// Texas only. Runs after McpValidationFilter has buffered the body. A
// tools/call whose location argument cannot be verified as Texas is denied
// here, not by the upstream weather-mcp server.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

// Texas bounding box (approximate, generous — covers the whole state).
def TX_LAT_MIN = 25.8
def TX_LAT_MAX = 36.5
def TX_LON_MIN = -106.6
def TX_LON_MAX = -93.5

// 20 largest Texas cities by population — matched as a case-insensitive
// substring of city_name (so "Austin, TX" and "austin" both match).
def TX_CITIES = [
    'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
    'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
    'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
    'brownsville', 'killeen', 'mcallen',
] as Set

def denied = { Object id, String message ->
    def resp = new Response(Status.FORBIDDEN)
    resp.headers.put('Content-Type', 'application/json')
    resp.entity.setString(JsonOutput.toJson([
        jsonrpc: '2.0',
        id: id,
        error: [code: -32000, message: message],
    ]))
    return Promises.newResultPromise(resp)
}

def body
try {
    body = new JsonSlurper().parseText(request.entity.string ?: '')
} catch (Exception e) {
    body = null
}

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def id = body.containsKey('id') ? body.id : null
def params = body.params
def args = (params instanceof Map) ? params.arguments : null
if (!(args instanceof Map)) {
    return next.handle(context, request)
}

def lat = args.latitude
def lon = args.longitude
if (lat instanceof Number && lon instanceof Number) {
    double latVal = lat.doubleValue()
    double lonVal = lon.doubleValue()
    if (latVal < TX_LAT_MIN || latVal > TX_LAT_MAX || lonVal < TX_LON_MIN || lonVal > TX_LON_MAX) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — coordinates outside Texas')
    }
    return next.handle(context, request)
}

def city = args.city_name
if (city instanceof String) {
    def normalized = city.toLowerCase()
    def isTx = normalized.endsWith(', tx') || normalized.endsWith(', texas') ||
        TX_CITIES.any { normalized.contains(it) }
    if (!isTx) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas')
    }
    return next.handle(context, request)
}

if (args.location_name instanceof String) {
    return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — saved locations cannot be verified')
}

// No location argument at all (e.g. check_service_status) — nothing to scope.
return next.handle(context, request)
