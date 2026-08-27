# Agentic Control Plane — surface design

**Date:** 2026-08-27
**Status:** approved, not yet implemented
**Scope:** Phase 1 only. Phase 2 (wiring P1AZ, AI Gateway, Privilege) is deliberately deferred; see [Phase 2](#phase-2--deferred).

## Why

The diagram's **Agentic Control Plane** box — Catalog, Registry, Discovery, Governance,
Observability — is four-fifths real in this app and entirely unassembled. The substance is
scattered across eight pages, and the page holding the control-plane *name*
(`/ai-control-plane`) is a 366-line kill-switch demo, not a control plane.

This spec builds the missing surface: one page that answers "what does this environment run,
and what is wrong with it" from data that already exists.

### What each box maps to today

| Box | Reality | Lives at |
|---|---|---|
| Agent / MCP Catalog | Agent Builder creates real PingOne apps; 22 services inventoried, 5 MCP | `/agent-builder`, `/pingone-mcp-inspector` |
| Agent Registry | Built 2026-08-27 — 33 identities, 4 sources, scope drift, lifecycle | `/agent-registry` |
| Agent Discovery | Nothing, and nothing planned — CASB/EDR category | — |
| Agent Governance | Kill switch, lifecycle ledger, scope drift | `/ai-control-plane` (roster) |
| Agent Observability | Grafana / Jaeger / Prometheus, transaction trace, token chain | `/grafana`, `/agent-flow-inspector` |

Measured 2026-08-27 against the live stack: 33 identities (`pingone` 13, `a2a` 12, `runtime` 8,
`demoRegistry` 0), 28 agent / 5 external, 31 active / 2 revoked, 0 drift, 7 lifecycle events,
22 services of which 5 are MCP.

## Decisions

1. **New route `/control-plane`.** `/ai-control-plane` keeps its route and is relabelled in nav
   to what it is (a kill-switch roster), reachable from the Governance zone. Moving it would mean
   touching a path that sits in three sources of truth and carries `introGate` + `highlight`, for
   no gain.
2. **One aggregating endpoint**, `GET /api/control-plane/overview`, composing services that
   already exist rather than re-reading their stores.
3. **Findings are computed server-side and ship in the same response as the zones**, so the
   "Needs attention" count and the triage queue cannot disagree — they are one array.
4. **Two views, one page**: Landscape (board) and Triage (queue). Triage is reachable from the
   view tabs *and* by clicking the "Needs attention" count itself.
5. **Enforcement services are observed, not owned** — they render in their own band, not as a
   sixth zone. See [§4](#4-enforcement-band--stubs).
6. **A stub shows no numbers.** Not-wired cards state what they will show and link to where that
   data lives today. No representative data, no plausible figures.

## 1. Server modules

```
services/controlPlaneOverview.js    assembles zones + calls the rules
services/controlPlaneFindings.js    the rules — pure functions, no I/O
routes/controlPlane.js              + GET /overview (existing routes untouched)
```

`controlPlaneOverview` composes `agentRegistryService.buildRegistry(req)`, `data/serverInventory`,
and `agentLifecycleEvents`. It reads nothing directly and caches nothing, so the page cannot show
a stale control plane — the same property that makes the registry trustworthy.

The rules live in their own module because they are the part that will change most often and the
part most worth testing in isolation. Every rule is `(context) => finding | null` with no I/O, so
each gets a fixture-driven test with no mocks.

### Response shape

```jsonc
{
  "generatedAt": "2026-08-27T12:00:00.000Z",
  "sources":  { "<name>": { "state": "live|down|not-wired|structural", "error": "…" } },
  "zones":    { "catalog": {…}, "registry": {…}, "discovery": {…},
                "governance": {…}, "observability": {…} },
  "enforcement": [ { "id": "p1az", "state": "not-wired", "willShow": "…", "today": "/pingone-authorize" } ],
  "findings": [ { "id": "repeat-revocation:default-agent", "rule": "repeat-revocation",
                  "severity": "critical", "domain": "governance",
                  "title": "…", "detail": "…", "evidence": {…} } ]
}
```

Always 200 when the response can be assembled at all. A source that throws contributes
`state: "down"` with its reason and zero rows, never an exception that costs the caller every
other zone. Copied from `data/serverInventory` + `GET /api/health/inventory`, the one existing
unify pattern in this repo.

## 2. Four source states

The registry today has `up: true | false`, where `false` means *we asked and it broke*. A stub is
neither, and collapsing the two would make every stub look like an outage and fire `source-down`
forever.

| State | Meaning | Renders as | Fires findings |
|---|---|---|---|
| `live` | asked, answered | numbers, links | yes |
| `down` | asked, failed | grey, error named | `source-down` |
| `not-wired` | never connected | stub card, no numbers | no |
| `structural` | will not be connected | gap state | declared only |

## 3. Findings

### 3.1 Computed rules — fire and clear on real data

| Rule | Severity | Fires when | Clears when |
|---|---|---|---|
| `repeat-revocation` | critical | an identity has ≥2 `leaver` events inside the window (default 30d) | the window moves past them |
| `unverified-scopes` | advisory | rows whose expected-scope set is empty, so drift was never evaluated | the identity is declared in `scope-topology.json` |
| `stale-ledger` | advisory | newest lifecycle event older than N days (default 7) | anything is recorded |
| `source-down` | critical | any source reports `state: "down"` | the source recovers |

`source-down` was not in the mockup. It is the only rule that fires on an outage, and it is the
most obviously correct of the set, so it ships in v1.

Thresholds (30d window, 7d staleness) are constants in `controlPlaneFindings.js`, not feature
flags — there is no case yet for changing them at runtime, and a flag would be a third place for
the value to disagree with itself.

**The live counts will not match the mockup, and that is correct.** The mockup showed
1 critical / 3 advisory / 1 structural because it treated alert-routing as advisory. Under the
rules above a healthy stack today yields **1 critical** (`repeat-revocation` on `default-agent`),
**2 advisory** (`unverified-scopes`, `stale-ledger`), and **2 structural**. `source-down` is
silent while all sources answer — which is the point of it.

**Why `repeat-revocation` is windowed.** History is immutable, so an all-time rule could never
clear — it would sit in the queue forever and train the reader to ignore the queue. A window makes
the finding *"revoked repeatedly, recently"*, which is the actual signal. `default-agent`
(4 revocations 10 Aug, re-enabled 12 Aug) still fires today.

### 3.2 Declared structural facts

`discovery-has-no-source` and `no-alert-receiver` are facts about how the deployment is
configured, not live signals — a rule evaluating them would return the same answer forever.
They are declared, rendered with the `structural` pill, and **counted separately from "needs
attention"**, because nothing the reader does today can action them.

### 3.3 Consequence — the registry scope defect

`unverified-scopes` cannot be honest while `agentRegistryService` reports `scopeDrift: false` for
both "granted matches expected" and "there was no expectation to compare against". All 12 A2A rows
are the second case and currently read as the first.

`scopeDrift: boolean` becomes `scopeStatus: 'match' | 'drift' | 'unverified'`. This also fixes
what `/agent-registry` shows today, so it lands in this work rather than separately.

**It is a breaking change to an existing response**, so it is not a one-line edit. Verified
2026-08-27:

- `agentRegistryService.js` — one real producer (`scopeDriftFor`, PingOne only) and **four
  hardcoded `scopeDrift: false`**, at lines 109, 142, 180 and 200. Every non-PingOne source
  asserts "no drift" without owning an expectation. That hardcoded `false` *is* the conflation,
  in four places.
- `AgentRegistryPage.jsx` — three read sites: the topbar drift count (76), the row badge (107),
  the Scopes tab branch (161).
- `agentRegistryService.test.js` — two assertions (198, 207).

All move together in one commit. `scopeDrift` is removed rather than kept alongside
`scopeStatus` — two fields meaning almost the same thing is how they drift apart.

## 4. Enforcement band — stubs

In the source diagram, P1AZ, AI Gateway and Privilege sit in the **middle row** — outside the
Agentic Control Plane box. The control plane's stated job is "visibility across the agent
landscape", so enforcement services are things it **observes, not owns**. Rendering them as a
sixth zone would misstate the architecture on the page whose purpose is to teach it.

They render in a band below the five zones — *Enforcement services — observed, not owned* —
each `not-wired`:

| Card | Will show | Links to today |
|---|---|---|
| Fine-Grained Authorization | P1AZ decisions per agent, deny reasons, policy version | `/pingone-authorize` |
| AI Gateway | which agents route through which gate, tool-level allow/deny | `/agent-gateway-inspector` |
| Privilege | LLM / MCP / A2A / AI Guard sub-gateway state, injected credentials | `/privilege-mcp-client` |

Each carries one line on what it will show, a link to where that data lives now, and a `not wired`
pill. Phase 2 becomes a fill-in rather than a redesign, and meanwhile the page tells the truth
about its own coverage — the same argument that makes the Discovery zone worth keeping.

## 5. UI

`demo_api_ui/src/pages/ControlPlanePage.jsx`, two views per the approved mockup
(artifact `f80ee191-ee9a-44f0-aa76-cee856758c03`).

- **Landscape** — four KPI tiles, then five zone cards, then the enforcement band. Each zone
  carries live counts and an outbound destination to the page where you actually work.
- **Triage** — findings worst-first, each with severity stripe, domain, evidence, and an action
  routing to the relevant page. Structural facts counted separately in the header.
- Not built on `InspectorShell`: that is a three-column working tool and this is a board.
  `/agent-registry` remains the inspector.
- The mockup's Auto/Light/Dark control does **not** ship — the app owns theming through its
  `--th-*` tokens. The page consumes those and is verified in both modes.
- Emoji allowlist applies: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only. Severity is carried by CSS
  stripes and pills, not by icons.

## 6. Nav — three sources of truth, one commit

| File | Entry |
|---|---|
| `demo_api_ui/src/components/AdminSideNav.jsx` | under **AI Agents**, above Agent Registry |
| `demo_api_ui/src/config/navStructureCatalog.js` | label-keyed mirror; drift-tested |
| `demo_api_server/config/auth-requirements.json` | `"/control-plane": "user"` |

`npm run authz:verify` fails on an unlisted route; the catalog drift test fails on a missing
label. Both gates are real and both must pass in the same commit. `/ai-control-plane` keeps its
route and changes label only.

## 7. Verification

- **Each rule, fixture pair** — fires when it should, silent when it shouldn't. A rule that has
  never been watched to fail is a guess.
- **`not-wired` does not fire `source-down`** — the regression this spec's four-state model exists
  to prevent.
- **Per-source degradation** — PingOne unreachable returns 200 with `state: "down"` and every
  other zone intact.
- **Registry split** — a row with an empty expected-scope set reports `unverified`, never `match`.
- `cd demo_api_server && CI=true npx jest <touched paths> --forceExit`
- `cd demo_api_ui && npm run test:unit && npm run build`
- `npm run authz:verify`
- **Manual, both themes** — a green suite is not a substitute for opening the page once. Confirm
  the counts on screen equal the counts the endpoint returns.

## Out of scope

- **Agent Discovery.** Not built, not planned, stays visibly empty.
- **Certification / access review.** Not in the diagram; `/platform-gaps` is right that Ping does
  not ship it.
- **Retiring `IgaForAiPage`.** Once this lands, pointing `/iga-for-ai` at real data is a
  reasonable follow-up, not part of this.
- **Alertmanager.** Declared as a structural gap; wiring it is a separate decision.

## Phase 2 — deferred

Wiring P1AZ, AI Gateway and Privilege is a **second project with its own design pass**, and the
reason is worth stating: this spec builds a view over **identity** — who exists, what they hold,
what happened to them. Enforcement is a different axis — what was *decided*, at which gate, on
which call. It cuts across all five zones rather than sitting in one, and the data lives in
gateway logs, P1AZ decision responses and Privilege state rather than in an identity store.

The enforcement band's three `not-wired` cards are the seam it will fill.
