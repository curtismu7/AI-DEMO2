// ping-gateway/scripts/groovy/tx-weather-scope.groovy
//
// Agent Gateway (IG) demo policy: the weather-mcp passthrough is scoped to
// ONE configurable US state at a time (default: Texas), or left wide open
// ("any"). Runs after McpValidationFilter has buffered the body. A
// tools/call whose location argument cannot be verified against the
// currently-selected state is denied here, not by the upstream weather-mcp
// server. The selected state is admin-configurable live, via
// ff_weather_mcp_allowed_state — see demo_api_server/routes/featureFlags.js.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_WEATHER_FLAG_URL') ?: ''

// Named-state scope data. Each state: an approximate, generous bounding box
// and its ~20 largest cities (case-insensitive, trimmed, no substring
// containment — see the city_name branch below).
def STATES = [
    texas: [
        latMin: 25.8, latMax: 36.5, lonMin: -106.6, lonMax: -93.5,
        abbrevs: ['tx', 'texas'] as Set,
        cities: [
            'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
            'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
            'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
            'brownsville', 'killeen', 'mcallen',
        ] as Set,
    ],
    michigan: [
        latMin: 41.7, latMax: 48.3, lonMin: -90.5, lonMax: -82.1,
        abbrevs: ['mi', 'michigan'] as Set,
        cities: [
            'detroit', 'grand rapids', 'warren', 'sterling heights', 'ann arbor',
            'lansing', 'dearborn', 'livonia', 'westland', 'troy',
            'farmington hills', 'kalamazoo', 'wyoming', 'southfield', 'rochester hills',
            'taylor', 'pontiac', 'novi', 'st. clair shores', 'royal oak',
        ] as Set,
    ],
]
def STATE_LABELS = [texas: 'Texas', michigan: 'Michigan']

// Live flag check against the BFF: ff_weather_mcp_showcase (on/off) and
// ff_weather_mcp_allowed_state (texas | michigan | any). Fails OPEN on
// `enabled` (a demo toggle, not a security control) but defaults
// `allowedState` to the NARROWEST state ('texas') on any error or
// unrecognized value — an outage or a version-skewed value must never
// accidentally widen the policy. The city/bbox scope check below remains
// fail-closed regardless of this call's outcome.
def weatherFlags = {
    def result = [enabled: true, allowedState: 'texas']
    if (!flagUrl) return result
    try {
        def conn = new URL(flagUrl).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'GET'
        conn.connectTimeout = 2000
        conn.readTimeout = 3000
        if (internalSecret) conn.setRequestProperty('x-internal-gateway-secret', internalSecret)
        def code = conn.responseCode
        if (code != 200) {
            logger.warn('[TxWeatherScope] flag check HTTP ' + code + ' — failing open (enabled), defaulting to texas')
            return result
        }
        def respBody = conn.inputStream?.text ?: '{}'
        def parsed = new JsonSlurper().parseText(respBody)
        result.enabled = parsed.enabled != false
        // 'any' is a valid allowedState but deliberately has no STATES entry
        // (no bbox/cities — it means "skip the scope check entirely").
        if (parsed.allowedState == 'any' || STATES.containsKey(parsed.allowedState)) {
            result.allowedState = parsed.allowedState
        }
        return result
    } catch (Exception e) {
        logger.warn('[TxWeatherScope] flag check failed: ' + e.message + ' — failing open (enabled), defaulting to texas')
        return result
    }
}

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

def flags = weatherFlags()
if (!flags.enabled) {
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

// Wide open — no restriction at all, every location argument shape passes.
if (flags.allowedState == 'any') {
    return next.handle(context, request)
}

def state = STATES[flags.allowedState]
def stateLabel = STATE_LABELS[flags.allowedState]

if (args.containsKey('latitude') || args.containsKey('longitude')) {
    def latVal = toNum(args.latitude)
    def lonVal = toNum(args.longitude)
    if (latVal == null || lonVal == null || !Double.isFinite(latVal) || !Double.isFinite(lonVal)) {
        return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — invalid or incomplete coordinates")
    }
    if (latVal < state.latMin || latVal > state.latMax || lonVal < state.lonMin || lonVal > state.lonMax) {
        return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — coordinates outside ${stateLabel}")
    }
    return next.handle(context, request)
}

def city = args.city_name
logger.warn('[TxWeatherScope] DEBUG argsKeys=' + args.keySet() + ' city=' + String.valueOf(city) + ' cityClass=' + (city == null ? 'null' : city.getClass().getName()) + ' allowedState=' + flags.allowedState)
if (city instanceof String) {
    // Split on the FIRST comma: "Corpus Christi, TX" -> cityPart="corpus christi",
    // statePart="tx". Exact match on both parts — no substring containment — so
    // "Plano, IL" (statePart="il") or "Houston Street, New York, NY" (statePart=
    // "new york, ny") are correctly denied instead of matching on a contained
    // city name. A bare name with NO qualifier ("Austin") falls back to an exact
    // allowlist match on the whole trimmed string.
    def normalized = city.toLowerCase().trim()
    def commaIdx = normalized.indexOf(',')
    def isInState
    if (commaIdx >= 0) {
        def statePart = normalized.substring(commaIdx + 1).trim()
        isInState = state.abbrevs.contains(statePart)
    } else {
        // Also accept "austin tx" — nlIntentParser norm() historically replaced
        // commas with spaces before the city was captured for the tool call.
        def sp = normalized.lastIndexOf(' ')
        if (sp > 0 && state.abbrevs.contains(normalized.substring(sp + 1).trim())) {
            isInState = true
        } else {
            isInState = state.cities.contains(normalized)
        }
    }
    if (!isInState) {
        return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — city not recognized as ${stateLabel}")
    }
    return next.handle(context, request)
}

if (args.containsKey('location_name')) {
    return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — saved locations cannot be verified")
}

// No location argument at all (e.g. check_service_status) — nothing to scope.
return next.handle(context, request)
