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

def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_WEATHER_FLAG_URL') ?: ''

// Live on/off check against the BFF's ff_weather_mcp_showcase flag. Fails OPEN
// (enabled) on any error — this is a demo toggle, not a security control; the
// Texas-scope check below remains fail-closed regardless of this result.
def weatherShowcaseEnabled = {
    if (!flagUrl) return true
    try {
        def conn = new URL(flagUrl).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'GET'
        conn.connectTimeout = 2000
        conn.readTimeout = 3000
        if (internalSecret) conn.setRequestProperty('x-internal-gateway-secret', internalSecret)
        def code = conn.responseCode
        if (code != 200) {
            logger.warn('[TxWeatherScope] flag check HTTP ' + code + ' — failing open (enabled)')
            return true
        }
        def respBody = conn.inputStream?.text ?: '{}'
        def parsed = new JsonSlurper().parseText(respBody)
        return parsed.enabled != false
    } catch (Exception e) {
        logger.warn('[TxWeatherScope] flag check failed: ' + e.message + ' — failing open (enabled)')
        return true
    }
}

// Texas bounding box (approximate, generous — covers the whole state).
def TX_LAT_MIN = 25.8
def TX_LAT_MAX = 36.5
def TX_LON_MIN = -106.6
def TX_LON_MAX = -93.5

// 20 largest Texas cities by population — matched exactly (case-insensitive,
// trimmed) against a bare city_name with no state qualifier (so "austin"
// matches but "Plano, IL" does not, since it carries an explicit non-TX state).
def TX_CITIES = [
    'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
    'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
    'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
    'brownsville', 'killeen', 'mcallen',
] as Set

def toNum = { v ->
    if (v instanceof Number) return v.doubleValue()
    if (v instanceof String) {
        try { return Double.parseDouble(v.trim()) } catch (Exception ignored) { return null }
    }
    return null
}

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

def id = (body instanceof Map && body.containsKey('id')) ? body.id : null

if (!weatherShowcaseEnabled()) {
    return denied(id, 'Agent Gateway: weather capability disabled (ff_weather_mcp_showcase is off)')
}

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def params = body.params
def args = (params instanceof Map) ? params.arguments : null
if (!(args instanceof Map)) {
    return next.handle(context, request)
}

if (args.containsKey('latitude') || args.containsKey('longitude')) {
    def latVal = toNum(args.latitude)
    def lonVal = toNum(args.longitude)
    if (latVal == null || lonVal == null || !Double.isFinite(latVal) || !Double.isFinite(lonVal)) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — invalid or incomplete coordinates')
    }
    if (latVal < TX_LAT_MIN || latVal > TX_LAT_MAX || lonVal < TX_LON_MIN || lonVal > TX_LON_MAX) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — coordinates outside Texas')
    }
    return next.handle(context, request)
}

def city = args.city_name
if (city instanceof String) {
    // Split on the FIRST comma: "Corpus Christi, TX" -> cityPart="corpus christi",
    // statePart="tx". Exact match on both parts — no substring containment — so
    // "Plano, IL" (statePart="il") or "Houston Street, New York, NY" (statePart=
    // "new york, ny") are correctly denied instead of matching on a contained
    // city name. A bare name with NO qualifier ("Austin") falls back to an exact
    // allowlist match on the whole trimmed string.
    def normalized = city.toLowerCase().trim()
    def commaIdx = normalized.indexOf(',')
    def isTx
    if (commaIdx >= 0) {
        def statePart = normalized.substring(commaIdx + 1).trim()
        isTx = (statePart == 'tx' || statePart == 'texas')
    } else {
        isTx = TX_CITIES.contains(normalized)
    }
    if (!isTx) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas')
    }
    return next.handle(context, request)
}

if (args.containsKey('location_name')) {
    return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — saved locations cannot be verified')
}

// No location argument at all (e.g. check_service_status) — nothing to scope.
return next.handle(context, request)
