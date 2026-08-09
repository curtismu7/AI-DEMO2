# PingOne Authorize dashboard — design

**Date:** 2026-08-09
**Status:** approved, ready for implementation planning
**Sub-project 1 of 3** — see "Roadmap" below.

---

## Problem

PingOne Authorize decisions reach New Relic but are displayed nowhere. The
`/monitoring/new-relic` dashboard shipped in #1476 renders the identity pipeline
(`oauth → token_exchange → introspection → intent_auth → mcp`); `authorize` is
not one of its stages.

## What the data actually looks like

Established by querying the live account rather than assuming — this corrected
three wrong assumptions from the first design pass.

**Available today**, emitted by `routes/authorize.js` on the live-evaluate path:

| Attribute | Example |
|---|---|
| `tag` | `authorize/permit`, `authorize/deny`, `authorize/gate-skipped`, `authorize/fail-open`, `authorize/failover`, `authorize/policy-not-found` |
| `decision` | `PERMIT`, `DENY` |
| `amount` | `100`, `20000`, `60000` |
| `stepUpRequired` | `true` / `false` |
| `engine` | `pingone` |
| `type` | `transfer`, `withdrawal` |
| `userId`, `path`, `useCaseId` | present |

Verified live: amount 100 → PERMIT, 20000 → DENY, 60000 → DENY. The 20000 DENY
is correct — step-up is required above 10000 and the probe sent `acr: pwd`, so
the obligation could not be satisfied.

**Missing:** `latencyMs` (nowhere), `ruleName`/policy name (nowhere), and
`decisionId` is present as a field but arrives `null` on this path.

**Gate configuration is healthy.** `/api/authorize/test-status` on the running
stack reports `activeEngine: pingone`, `authorizeEnabled: true`,
`hasDecisionEndpointId: true`, endpoint `c9e87348-df8d-496a-a379-1392e92d77dc`,
thresholds step-up 10000 / deny 50000.

### Corrections to the first design pass

Three assumptions were wrong and are recorded so the plan does not repeat them:

1. **"Enrichment is needed before the page is useful."** False — `decision`,
   `amount`, `stepUpRequired`, `engine` already ship.
2. **"The authz gate is skipped 68% of the time."** False — that was fixture
   noise. All 50 historical `authorize` records came from the jest fixtures
   `test-user-id` and `user-a-id`, because the forwarder had no test guard
   (fixed in #1493).
3. **"Zero denies means the deny path is broken."** False — the deny path works;
   nothing had exercised it with real traffic.

---

## Design

### BFF — a view registry

`/api/newrelic/pipeline` hardcodes one query set. Three dashboards are planned,
so it generalizes to a server-side registry:

```
GET /api/newrelic/view/:view?window=30m|1h|24h      view ∈ { pipeline, authorize }
```

`VIEWS` is a fixed map of view name → named NRQL set. The security property is
preserved exactly: the client sends a **key**, never a query. An unknown view is
a 400, matching the existing `invalid_window` behavior. `/api/newrelic/pipeline`
remains as an alias so nothing that exists today breaks.

The `authorize` view issues four queries:

| Purpose | Query shape |
|---|---|
| Decision split | `FACET decision` |
| Posture | `FACET tag` — surfaces gate-skipped / fail-open / failover / policy-not-found |
| Volume | `TIMESERIES` |
| Stream | `SELECT timestamp, tag, decision, amount, stepUpRequired, type, engine … LIMIT 50` |

### UI

New `P1AzDashboard.jsx` at `/monitoring/p1az`, public, nav entry under
Monitoring alongside New Relic and PingOne Events.

Layout, in reading order:

1. **Decision strip** — PERMIT / DENY / step-up-required counts.
2. **Posture row** — gate-skipped / fail-open / failover / policy-not-found.
   A non-zero fail-open or failover count is the thing an operator must notice,
   so it renders in the warning color rather than as a neutral stat.
3. **Volume** — inline SVG timeseries, same treatment as the New Relic page.
4. **Decision stream** — time, decision, amount, type, step-up, engine.

### Shared components

`NewRelicDashboard.jsx` owns a window selector, theme toggle, stat strip and
event-stream table. With a second consumer arriving, those are extracted:

- `DashboardShell` — window selector, theme toggle, refresh, the five states
  (loading / ready / unconfigured / error / empty)
- `StatStrip` — labelled counts with a scaled bar
- `EventStream` — the table

Both pages compose them. **No config-driven dashboard framework** — two
consumers is not enough evidence for the right abstraction. Revisit when the
gateway pages land and the shape is known.

### Emit-site additions

Two, both justified by what the live data lacks:

- `latencyMs` measured around `evaluatePingOneTransaction` — answers whether the
  authz hop is slow, which nothing currently can.
- Populate `decisionId` where PingOne returns one, linking a dashboard row back
  to the PingOne decision record.

---

## Non-goals

- `ruleName` / policy-name attribution. PingOne would need to return it and the
  emit sites would need to thread it; out of scope here.
- Cleaning the ~50 fixture `authorize` records already in New Relic. #1493 stops
  new pollution; history stays and will appear in wide windows.
- A dashboard framework (see Shared components).
- The MCP gateway and PingGateway dashboards — separate sub-projects.

---

## Verification

| Layer | Command | Gate |
|---|---|---|
| BFF | `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4` | view registry: unknown view 400, each known view maps to its query set, 503 unconfigured |
| UI unit | `cd demo_api_ui && npm run test:unit` | dashboard states; extracted components still satisfy the New Relic page's existing tests |
| UI build | `cd demo_api_ui && npm run build` | exit 0 — REGRESSION_PLAN §0 |
| Cross-service | `npm run topology:verify` | no drift |

The dark-mode ground guard from #1484 applies to the new component: `.p1az`
must paint `var(--*-ground)` and define it in both themes.

Manual check on `local.ping-devops.com:4000/monitoring/p1az`: decision strip
shows the PERMIT/DENY counts, theme toggle flips the page, and removing
`NR_USER_API_KEY` yields the not-configured state rather than an error.

Generate traffic with:

```bash
curl -sk -X POST https://api.ping.demo:3001/api/authorize/test-evaluate \
  -H 'Content-Type: application/json' \
  -d '{"amount":100,"type":"transfer","acr":"pwd","userId":"probe"}'
```

Amounts 100 / 20000 / 60000 produce PERMIT / DENY / DENY.

---

## Risks

**The page will look sparse.** Only three real decisions exist in the account;
everything older is fixtures. Demos need traffic generated first, and the empty
state must read as "no decisions in this window", never as an error.

**Fixture records remain in wide windows.** A 24h view will mix the historical
`test-user-id` records with real ones. Filtering them out by userId would be
brittle; the honest mitigation is that new pollution has stopped.

---

## Roadmap

This is sub-project 1 of 3, ordered so each produces working software and the
riskiest work benefits from settled patterns:

1. **P1AZ dashboard** (this spec) — data already flows; establishes the view
   registry and shared components.
2. **MCP gateway → New Relic** — our own TypeScript service; add a forwarder
   mirroring `newRelicForwarder.js`. Validates a non-BFF service shipping to NR.
3. **PingGateway/IG → New Relic** — a Groovy `ScriptableFilter` POSTing to the
   Logs API. No native NR audit handler exists, and a slow call would sit in the
   enforcement path, so it goes last.
