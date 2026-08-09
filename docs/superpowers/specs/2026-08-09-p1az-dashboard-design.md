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

**Available but not captured.** An earlier draft of this spec claimed `latencyMs`,
`ruleName` and `decisionId` were unavailable upstream. That was wrong. The raw
PingOne decision response — logged by `pingOneAuthorizeService.js` and captured
from live PERMIT and DENY calls on 2026-08-09 — carries all three:

```json
{
  "correlationId": "48c67322-351e-45b4-8614-ce5208b2651f",
  "timestamp": "2026-08-09T13:06:03.967328809Z",
  "elapsedMicroseconds": 2885,
  "status": { "code": "OKAY" },
  "decision": "PERMIT",
  "statements": [ { "name": "Transaction Approved",
                    "code": "transaction-approved",
                    "payload": "{\"approved\": true, …}",
                    "obligatory": false, "fulfilled": false } ]
}
```

| Wanted | Actually available as | Why it was missed |
|---|---|---|
| `decisionId` | `raw.correlationId` | the extractor checks `raw.id \|\| raw.decisionId`, neither of which PingOne sends |
| policy-eval latency | `raw.elapsedMicroseconds` | never read |
| `ruleName` | `raw.statements[0].name` / `.code` | never read |

Confirmed identical in shape on both outcomes: DENY yields
`Transaction Denied` / `transaction-denied`, PERMIT yields
`Transaction Approved` / `transaction-approved`.

This materially improves the dashboard: it can name **which rule fired**, which
is the PingOne Authorize story rather than a bare PERMIT/DENY count.

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
GET /api/newrelic/view/:view?window=30m|1h|24h|7d   view ∈ { pipeline, authorize }
```

`7d` is added to the window map (the New Relic page ships 30m/1h/24h today).
History is wanted, not avoided: a week is the working retention target for both
dashboards, so a demo can show more than the last few minutes of traffic.

Timeseries bucket per window — a fixed 7-day bucket of 5 minutes would return
2016 points and swamp the sparkline:

| Window | Bucket |
|---|---|
| `30m` | 2 minutes |
| `1h` | 5 minutes |
| `24h` | 1 hour |
| `7d` | 6 hours |

**Retention reality, measured 2026-08-09:** the account holds 1066 `Log`
records and the counts are identical `SINCE 7 days ago`, `14 days ago` and
`30 days ago` — nothing is aging out. The oldest record is
`2026-08-06T22:53 UTC`, because forwarding only began when #1432 shipped. The
`7d` window is therefore correct to build but will look partial until a week of
traffic accumulates.

`VIEWS` is a fixed map of view name → named NRQL set. The security property is
preserved exactly: the client sends a **key**, never a query. An unknown view is
a 400, matching the existing `invalid_window` behavior. `/api/newrelic/pipeline`
remains as an alias so nothing that exists today breaks.

The `authorize` view issues five queries:

| Purpose | Query shape |
|---|---|
| Decision split | `FACET decision` |
| Posture | `FACET tag` — surfaces gate-skipped / fail-open / failover / policy-not-found |
| Top rules | `FACET ruleName` — which policy fired |
| Volume | `TIMESERIES` |
| Stream | `SELECT timestamp, tag, decision, ruleName, amount, stepUpRequired, type, engine, latencyMs, policyEvalMs … LIMIT 50` |

`ruleName` only exists on events emitted after this change ships; older records
return `null` for that facet, which the page renders as "unattributed" rather
than hiding.

### UI

New `P1AzDashboard.jsx` at `/monitoring/p1az`, public, nav entry under
Monitoring alongside New Relic and PingOne Events.

Window selector offers `30m / 1h / 24h / 7d`, **defaulting to `24h`** — not the
New Relic page's `1h`. Authorize decisions are far sparser than pipeline events,
and a `1h` default would show an empty page most of the time.

Layout, in reading order:

1. **Decision strip** — PERMIT / DENY / step-up-required counts.
2. **Posture row** — gate-skipped / fail-open / failover / policy-not-found.
   A non-zero fail-open or failover count is the thing an operator must notice,
   so it renders in the warning color rather than as a neutral stat.
3. **Top rules** — `FACET ruleName`, so the page names *which policy fired*
   (`Transaction Denied`, `Transaction Approved`) rather than only counting
   outcomes. This is the PingOne Authorize story and the strongest thing on the
   page for a demo.
4. **Volume** — inline SVG timeseries, same treatment as the New Relic page.
5. **Decision stream** — time, decision, rule, amount, type, step-up, engine,
   latency (wall-clock) and policy-eval ms.

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

All four read fields PingOne already returns and the code simply never captured.

In `pingOneAuthorizeService.js`, widen the extraction:

| Emitted field | Source |
|---|---|
| `decisionId` | `raw.correlationId \|\| raw.id \|\| raw.decisionId \|\| null` |
| `policyEvalMs` | `raw.elapsedMicroseconds / 1000` — PingOne's own evaluation time |
| `ruleName` | `raw.statements?.[0]?.name \|\| null` |
| `ruleCode` | `raw.statements?.[0]?.code \|\| null` |

Plus one measured in the BFF:

- `latencyMs` — wall-clock around `evaluatePingOneTransaction`.

`latencyMs` and `policyEvalMs` answer different questions and both are cheap:
PingOne reports ~3ms of policy evaluation, while the wall-clock figure includes
the network round trip, which is what a user actually waits for. Reporting only
one would misrepresent the other.

---

## Non-goals

- Multi-statement rule attribution. A decision can carry several `statements`;
  only the first is captured. Rendering all of them is deferred until a policy
  in this environment actually returns more than one.
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

**The page will look sparse at short windows.** Only three real decisions exist
so far, all generated on 2026-08-09. At `30m` or `1h` the page will usually be
empty unless someone has just driven traffic. The empty state must read as "no
decisions in this window", never as an error — and the default window is `24h`
rather than `1h` for that reason.

**Fixture records remain in history, and that is accepted.** The ~50
`test-user-id` / `user-a-id` records from before #1493 stay in the account and
will appear in `24h` and `7d` views. Keeping history is the explicit preference,
so they are not filtered: a userId-based exclusion would be brittle and would
silently drop real records that happen to lack a userId. New pollution has
stopped; the old records simply age out of relevance as real traffic accrues.

**`7d` is aspirational until traffic accumulates.** Forwarding began 2026-08-06,
so the deepest window currently returns about three days.

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
