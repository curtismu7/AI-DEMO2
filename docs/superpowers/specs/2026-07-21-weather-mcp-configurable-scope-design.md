# Weather MCP — configurable Agent Gateway scope (Texas / Michigan / Any)

## Purpose

The weather-mcp showcase (`docs/superpowers/specs/2026-07-21-weather-mcp-agent-gateway-design.md`)
proves the Agent Gateway can front a third-party MCP server and enforce a geographic scoping
policy on it — but the policy (Texas-only) is hardcoded in `tx-weather-scope.groovy`. To make
the gateway's role visible and provable *live*, during a demo, the scope needs to be a value the
presenter can change on the spot — and the same "Miami" query needs to flip from denied to
allowed with no code change and no gateway restart.

This spec adds ONE new admin-configurable value — which named state (or "no restriction") the
gateway currently allows — surfaced as an inline dropdown right on the weather capability card,
so it's fast to find mid-demo.

## Non-goals

- No change to `ff_weather_mcp_showcase` (the existing master on/off flag) — this is additive,
  a second, independent control.
- No AI-agent/chat changes beyond what `2026-07-21-weather-mcp-chat-integration` already
  shipped (`get_weather` LangChain tool, `/mcp/weather` gateway routing, heuristic
  `action:'weather'` dispatch). This spec only changes what the gateway's scope check allows.
- No arbitrary/editable city list — exactly three states: `texas` (current default),
  `michigan` (new), `any` (no restriction). Not a general-purpose config system.
- No change to the lat/lon bounding-box mechanism's *shape* — Michigan gets the same
  bbox + city-set shape Texas already has, just different data.

## Architecture

```
Admin (Capability Tour card, inline <select>)
  → PATCH /api/admin/feature-flags {updates:{ff_weather_mcp_allowed_state: 'michigan'}}
  → configStore (persisted, survives restart)

Every /mcp/weather request:
  tx-weather-scope.groovy
    → GET /internal/feature-flags/weather-mcp-showcase   (existing call, extended response)
      response: { enabled: true, allowedState: 'michigan' }
    → STATES[allowedState]  (texas | michigan | any)
    → same scoping logic as today, against the SELECTED state's city-set/bbox
      (or: no check at all, when allowedState === 'any')
```

No new HTTP round-trip on the gateway's hot path — `allowedState` rides in the same response
`weatherShowcaseEnabled()` already fetches per request.

## Components

### 1. `demo_api_server/routes/featureFlags.js` — new flag registration

Add to `FLAG_REGISTRY`, next to the existing `ff_weather_mcp_showcase` entry:

```js
{
  id:           'ff_weather_mcp_allowed_state',
  name:         'Weather MCP — Allowed State',
  category:     'MCP / Agent',
  description:
    'Which US state the Agent Gateway (PingGateway/IG) currently allows through the ' +
    'weather-mcp showcase route (`/mcp/weather`). `tx-weather-scope.groovy` reads this ' +
    'live on every request via `GET /internal/feature-flags/weather-mcp-showcase`, so ' +
    'changing it here takes effect immediately, with no gateway restart — the SAME query ' +
    '("what\'s the weather in Miami") can flip from denied to allowed live, during a demo.',
  impact:
    'texas (default) = only the 20 largest Texas cities / TX bounding box pass. ' +
    'michigan = only the 20 largest Michigan cities / MI bounding box pass. ' +
    'any = no geographic restriction — every city passes (subject to ff_weather_mcp_showcase ' +
    'still being ON).',
  type:         'enum',
  options:      ['texas', 'michigan', 'any'],
  defaultValue: 'texas',
},
```

This alone makes the value editable on the existing `/feature-flags` admin page (enum flags
already render as a `<select>` there — no new code needed for that surface).

### 2. `demo_api_server/routes/weatherMcpFlag.js` — extend the existing response

`GET /internal/feature-flags/weather-mcp-showcase` currently returns `{ enabled }`. Add the
new field, same auth gate (`x-internal-gateway-secret`), same handler:

```js
router.get('/feature-flags/weather-mcp-showcase', (req, res) => {
  // ...existing secret check, unchanged...
  const raw = configStore.getEffective('ff_weather_mcp_showcase');
  const isUnset = raw === null || raw === undefined || raw === '';
  const enabled = isUnset ? true : (raw === true || raw === 'true');

  const rawState = configStore.getEffective('ff_weather_mcp_allowed_state');
  const allowedState = ['texas', 'michigan', 'any'].includes(rawState) ? rawState : 'texas';

  return res.json({ enabled, allowedState });
});
```

### 3. `ping-gateway/scripts/groovy/tx-weather-scope.groovy` — read + branch on state

Rename the concept from "TX-only" to "selected-state" without changing the overall filter
shape (still one Groovy `ScriptableFilter`, same fail-open-on-flag-check-error /
fail-closed-on-scope-decision behavior).

- `weatherShowcaseEnabled()`'s HTTP call now also captures `allowedState` from the same JSON
  body, defaulting to `'texas'` in two cases: (a) any parse/fetch failure, matching the
  existing fail-open-but-not-on-the-scope-decision posture — an unreachable flag-check still
  fails OPEN on `enabled`, but defaults to the *narrowest* state rather than `any`, so an
  outage never accidentally widens the policy; and (b) a value that doesn't match a `STATES`
  key (`STATES[allowedState] ?: STATES.texas`) — a defensive default against a BFF/gateway
  version skew introducing a state name the deployed Groovy script doesn't recognize yet.
- Replace the top-level `TX_LAT_MIN/MAX`, `TX_LON_MIN/MAX`, `TX_CITIES` constants with a
  `STATES` map:

```groovy
def STATES = [
    texas: [
        latMin: 25.8, latMax: 36.5, lonMin: -106.6, lonMax: -93.5,
        cities: [
            'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
            'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
            'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
            'brownsville', 'killeen', 'mcallen',
        ] as Set,
    ],
    michigan: [
        latMin: 41.7, latMax: 48.3, lonMin: -90.5, lonMax: -82.1,
        cities: [
            'detroit', 'grand rapids', 'warren', 'sterling heights', 'ann arbor',
            'lansing', 'dearborn', 'livonia', 'westland', 'troy',
            'farmington hills', 'kalamazoo', 'wyoming', 'southfield', 'rochester hills',
            'taylor', 'pontiac', 'novi', 'st. clair shores', 'royal oak',
        ] as Set,
    ],
]
```

- The lat/lon branch, the `city_name` comma-split branch, and the `location_name` branch all
  key off `STATES[allowedState]` instead of the old top-level constants — same comparisons,
  same denial messages (now naming the selected state, e.g. "restricted to Michigan (demo
  policy)" instead of a hardcoded "restricted to Texas").
- `allowedState == 'any'`: short-circuit before any of the three checks — `return
  next.handle(context, request)` unconditionally (after the existing tool-call/method
  gating), for every argument shape including `location_name` (today's one *always-denied*
  branch, since "any" means no restriction at all, full stop).

### 4. `demo_api_ui/src/components/CapabilityShowcasePage.jsx` — one optional prop

Shared, generic component (also used by PingOne Authorize's tour) — stays generic:

```diff
- export default function CapabilityShowcasePage({ title, intro, ledger, groups }) {
+ export default function CapabilityShowcasePage({ title, intro, ledger, groups, renderCardExtra }) {
    ...
                <article key={cap.id} className="cap-card" data-testid={`cap-card-${cap.id}`}>
                  <h3 className="cap-card__title">{cap.title}</h3>
                  <p className="cap-card__one-liner">{cap.oneLiner}</p>
                  <code className="cap-card__evidence">{cap.evidence.code}</code>
+                 {renderCardExtra?.(cap)}
                </article>
```

`renderCardExtra` defaults to `undefined` (optional-chained call, no-op) — the PingOne
Authorize capability page passes nothing and is byte-for-byte unaffected.

### 5. `demo_api_ui/src/components/WeatherStateControl.jsx` (new, small)

Modeled on `FeatureFlagsPage.js`'s existing GET/PATCH pattern (`fetch('/api/admin/feature-
flags', {credentials:'include'})` → PATCH `{updates:{[id]: value}}`). Self-contained:
fetches its own current value on mount, renders a `<select>` (texas / michigan / any),
PATCHes on change, shows a brief saved/error indicator inline. No shared state with the rest
of the page — this control owns its own fetch, matching `ThresholdControls.js`'s pattern of
each demo-control widget being independent.

### 6. `demo_api_ui/src/pages/AgentGatewayCapabilitiesPage.jsx` — wire it in

```diff
+ import WeatherStateControl from '../components/WeatherStateControl';
  ...
    <CapabilityShowcasePage
      title="Agent Gateway"
      intro={INTRO}
      ledger={AGENT_GATEWAY_CAPABILITIES}
      groups={AGENT_GATEWAY_GROUPS}
+     renderCardExtra={(cap) => cap.id === 'weather-tx-scope' ? <WeatherStateControl /> : null}
    />
```

### 7. Documentation touch-ups (small, same-file-family)

- `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js` — the
  `weather-tx-scope` entry's `oneLiner`/`evidence.code` currently say "Texas-only" / cite only
  `tx-weather-scope.groovy`'s line range; update to describe the state as configurable and
  cite `featureFlags.js` + `weatherMcpFlag.js` alongside the existing refs.
- `demo_api_server/config/useCases.js` — UC30/UC31's `buyerStory`/`pingOneSolution`/`whatLong`
  text currently assert Texas as a fixed policy; reword to "the gateway's currently-configured
  state (Texas by default)" so the copy doesn't contradict a presenter who has switched the
  dropdown to Michigan or Any before running the chip.
- `REGRESSION_PLAN.md` — new `§4` entry: what changed, why (make the gateway's enforcement
  provable live), files touched, and the do-not-break note that `ff_weather_mcp_showcase`'s
  own behavior (master on/off) must stay independent of this new flag.

## Testing

- Unit: extend existing weather-related test coverage (or add
  `demo_api_server/tests/weatherMcpFlag.test.js` if none exists) to cover the new
  `allowedState` field in the flag-check response, including the fail-open-to-`'texas'`
  default on a malformed/missing stored value.
- Live/manual (mirrors how the original showcase and the chat-integration work were both
  verified in this repo — no headless test framework reaches into `ping-gateway`'s Groovy):
  1. Default (`texas`): Austin → 200 reaches backend, Detroit → 403, Miami → 403.
  2. Switch dropdown to `michigan`: Detroit → 200 reaches backend, Austin → 403, Miami → 403.
  3. Switch to `any`: Austin, Detroit, and Miami all → 200 reaches backend.
  4. Confirm the dropdown's current value round-trips correctly (reload the Capability Tour
     page after a change, value persists — proves `configStore` persistence, not just local
     component state).
  5. Confirm `ff_weather_mcp_showcase` OFF still 403s regardless of `allowedState` (the two
     flags are independent, master flag wins).
