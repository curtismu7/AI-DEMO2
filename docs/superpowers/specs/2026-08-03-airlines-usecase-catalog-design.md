# Airlines vertical — use-case catalog wiring

**Date:** 2026-08-03
**Status:** approved, ready for implementation plan
**Branch:** `worktree-airlines-usecase-catalog`

## Problem

The United Airlines vertical's Demo Steps dropdown renders "No demo steps for this
vertical."

Chain:

1. `airlines` exists as a vertical plugin (`demo_api_server/config/verticals/airlines/`)
   with five tools, heuristics, and a system prompt.
2. `VERTICALS` in `demo_api_server/config/useCases.js` lists nine verticals.
   `airlines` is not among them.
3. `GET /api/use-cases?vertical=airlines` therefore returns `400 unknown_vertical`.
4. `DemoStepsDropdown.jsx` deliberately swallows `unknown_vertical` as an expected
   empty state and renders the empty-state string.

This is not a regression. Airlines shipped as Phase 1 (read-only SQLite resource
server, PR #1252); catalog wiring was never done.

## Goal

The United Airlines vertical serves the full 20-step presenter ladder
(`DEMO_PRIMARY_USE_CASE_IDS`), every step live-verified against a running stack.

## Scope

### In scope

Of the 20 steps, seven bind per-vertical and need new wiring:

| Step | Binding |
|---|---|
| UC1  | read tool |
| UC2  | A2A specialist + sensitive tool |
| UC6  | amount tool, $2500 DENY |
| UC7  | amount tool, $600 step-up |
| UC8  | amount tool, $300 HITL |
| UC20 | read tool |
| UC22 | amount tool, $150 CIBA |

UC24 (`get_branch_hours`) is also wired. It is not in the 20-step stepper but is in
`SECURITY_DEMO_USE_CASE_IDS`, and the entry is one line.

The remaining thirteen (UC2.5, UC5, UC10, UC11, UC12, UC13, UC14, UC14b, UC18,
UC29, UC30, UC31, UC32) are attack sims or weather-MCP steps with no per-vertical
binding. They resolve the moment `airlines` enters `VERTICALS`.

### Out of scope

- Golden captures for airlines. `check-goldens.js` treats MISSING as warn-only.
- Any change to another vertical's tools, scopes, or catalog entries.
- Secret rotation. New secrets are pasted into `.env` by the user; existing
  secrets are not touched.

## Design

### 1. Change surface

Seven files carry logic. The rest is generated.

A tool name is registered in seven places. The authoritative list was derived by
grepping for the existing `cancel_airline_reservation`; missing any one of them
produces a tool that half-exists.

| Layer | File | Change |
|---|---|---|
| Resource server | `demo_mcp_resource_server/src/db/airlinesDb.ts` | `fee_payments` table + `recordFeePayment` / `listFeePayments` |
| Resource server | `demo_mcp_resource_server/src/tools/airlinesTools.ts` | `pay_airline_fee` definition |
| Resource server | `demo_mcp_resource_server/src/tools/airlinesToolHandler.ts` | handler + `AIRLINES_TOOL_NAMES` |
| Gateway | `demo_mcp_gateway/src/router.ts` | `pay_airline_fee` in the `AIRLINES_TOOLS` routing set |
| Vertical plugin | `demo_api_server/config/verticals/airlines/index.js` | tool declaration + heuristic with `extractsAmount: true` |
| Vertical manifest | `demo_api_server/config/verticals/airlines/manifest.json` | a `chips10` entry — `airlinesVertical.test.js` asserts chip tools equal the tool list exactly |
| Scope topology | `scope-topology.json` | `pay_airline_fee`; A2A flags on `sensitive_airline_bookings`; specialist app/resource/scope |
| Amount policy | `demo_api_server/services/mcpToolAuthorizationService.js` | `pay_airline_fee: 'transfer'` in `WRITE_TOOL_TYPE_MAP` |
| A2A | `demo_api_server/config/a2aSpecialists.js` | `airlines` block |
| Catalog | `demo_api_server/config/useCases.js` | `'airlines'` in `VERTICALS` + five per-vertical maps |

`demo_mcp_server/src/tools/handlers/verticalTools.generated.ts` and
`docs/scope-topology.md` also carry the name but are generated — regenerate, never
hand-edit.

The `WRITE_TOOL_TYPE_MAP` entry is the highest-risk omission. Its own comment
records the identical failure for `large_trade`: without it "the chip routes but
the amount policy never fires: no DENY, no step-up, no consent, and the demo looks
correct while authorizing everything."

### 2. `pay_airline_fee`

Modeled on `pay_bill`, not on `large_trade`.

```
name:   pay_airline_fee
input:  { amount: number, fee_type?: 'change'|'bag'|'upgrade', confirmation_number?: string }
requiredScopes: ['airlines:read', 'airlines:write']   — identical everywhere
challengeType:  none
```

`challengeType` is deliberately unset. `large_trade` pins `step_up`
unconditionally, which would render UC6's $2500 DENY and UC8's $300 HITL both as
step-up. `pay_bill` leaves it unset and lets the Transaction policy decide. That
is what seven of eight verticals demo and what the ladder requires.

**Correction to the approved design.** An earlier draft gave this tool
`requiredScopes: ['write', 'airlines:write']`, reasoning that the generic `write`
scope was what put it on the amount-policy path. It is not.
`_applyTransactionPolicy` gates on `transactionType` — the value from
`WRITE_TOOL_TYPE_MAP`, keyed by tool *name* — and on a finite positive `amount`:

```js
if (!forceStepUp && (!transactionType || !Number.isFinite(amount) || amount <= 0 || !userId)) return r;
```

Scope plays no part. Adding `write` would therefore buy nothing and reintroduce
exactly the scope-name collision risk that caused #1046 and the UC18 502. The
tool instead carries `['airlines:read', 'airlines:write']` — byte-identical to
`cancel_airline_reservation` — in the plugin, in `airlinesTools.ts`, and in
`scope-topology.json`. The corresponding risk row is dropped.

The amount itself reaches the policy from the chip text. The heuristic entry
carries `extractsAmount: true`, the same mechanism healthcare's `pay_bill` rule
uses. `resolveAmountForPolicy` special-cases only `pay_bill`, so for
`pay_airline_fee` the stated amount stands.

### 3. Persistence

```sql
CREATE TABLE IF NOT EXISTS fee_payments (
  id                  INTEGER PRIMARY KEY,
  confirmation_number TEXT,
  fee_type            TEXT,
  amount_cents        INTEGER NOT NULL,
  paid_at             TEXT NOT NULL
);
```

Money as integer cents. Connection opened per call and closed, following the
existing rule in `airlinesDb.ts`. No WAL — the database sits on a bind mount.

No seed and no reset path. `airlinesDb.ts` states its contract as "the seed is
applied ONLY when a table is empty; a restart must never clobber" — an
append-only ledger fits that model. Nothing reads `fee_payments` back except the
UC20 audit view, so accumulation across repeat demos is harmless. A reset would be
speculative work.

### 4. Catalog wiring

Five maps in `useCases.js` gain an `airlines` key:

```js
VERTICALS                        += 'airlines'
READ_TRIGGER_BY_VERTICAL         airlines: 'show my reservations'
READ_PRIMARY_TOOL_BY_VERTICAL    airlines: 'get_airline_bookings'
amountTriggerByVertical          airlines: `pay a $${n} change fee`
AMOUNT_PRIMARY_TOOL_BY_VERTICAL  airlines: 'pay_airline_fee'
A2A_TRIGGER_BY_VERTICAL          airlines: 'show my sensitive reservations'
A2A_PRIMARY_TOOL_BY_VERTICAL     airlines: 'sensitive_airline_bookings'
UC24 chipOverrides               airlines: 'What airports are near me?' / 'get_branch_hours'
```

Heuristic order in the plugin becomes: fee, cancel, sensitive, seat, status,
bookings. The fee rule goes first because `refund fee` would otherwise match the
existing `cancel|refund` rule.

`useCases.primaryTool.test.js` is a drift gate that checks each declared
`primaryTool` against what the chip actually routes to. It fails by name on any
mismatch — the safety net for this section.

### 5. A2A specialist

The specialist is a PingOne app with its own resource, scope, and secret. Nine
coordinated changes.

Code and config:

1. `a2aSpecialists.js` gains:
   ```js
   airlines: {
     appKey: 'reservations',
     appName: 'Super Banking Reservations Specialist Agent',
     specialistName: 'Reservations Specialist',
     tools: ['sensitive_airline_bookings'],
     subtaskHint: 'retrieve the sensitive reservation details',
   }
   ```
2. `scope-topology.json` `scopes` gains `agent:invoke:reservations`.
3. `scope-topology.json` `resources` gains
   `Super Banking A2A Intermediate - Reservations Specialist`.
4. `scope-topology.json` `apps` gains the specialist agent app with its
   `grantedScopes`.
5. `provisioning.resourceNames` and `provisioning.appNames` gain the matching
   display-name entries.
6. `sensitive_airline_bookings` gains `a2aDelegated: true`, `a2aDelegatedScope`,
   and `requiresAgentMediation: true`.

Live:

7. `pingone:bootstrap` creates the app in environment `01d89b06`.
8. The user pastes `PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_ID` and
   `PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_SECRET` into root `.env`. No secret is
   created or rotated by the implementation.
9. The BFF is restarted so it reads them.

#### Open question — resolved at implementation, not now

`sensitive_holdings` is configured `requiredScopes: ["read"]` plus
`a2aDelegatedScope: "holdings:read"` — the generic scope, narrowed only on the A2A
hop. `sensitive_airline_bookings` today is `["airlines:read", "sensitive:read"]`.

Copying the investment shape changes the tool's existing consent-path behavior.
Keeping the current shape leaves Exchange #2 narrowing from a scope set never
exercised on this tool. The A2A scope chain has broken on exactly this before —
Rule 3 was blind to `a2aDelegatedScope`, and collapsing to `read` was the wrong
fix.

Resolution is a live token-chain read on the first UC2 airlines run. The plan
carries this as an explicit checkpoint with a rollback: leave UC2 unwired for
airlines and ship the other nineteen steps.

## Verification

Work happens in worktree `airlines-usecase-catalog` on branch
`worktree-airlines-usecase-catalog`. Files are staged explicitly. Never
`git add -A` — a BFF jest run regenerates roughly 443 data files.

### Automated gates

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
cd demo_api_ui    && npm run test:unit && npm run build
npm run topology:verify
cd demo_api_server && npm run use-cases:gen && npm run use-cases:check
npm run hygiene:check
```

`--maxWorkers=4` is required. BFF jest has a known worker-contention flake where
different disjoint suites fail on each run; without the cap a red run proves
nothing.

### Live run

1. `scripts/sync-main-checkout.sh` from repo root.
2. Rebuild `mcp-resource-server`. It bakes code into the image — a restart does
   not pick up the change.
3. Drive all 20 steps in a browser at `https://local.ping-devops.com:4000`, United
   Airlines vertical selected.

Pass for a step is the ProofStrip verdict matching the catalog's
`expectedOutcome`. Not the chat reply: chips dispatched client-side are not
API-scorable, and asserting on reply text produces false passes.

| Step | Expected |
|---|---|
| UC1  | PERMIT, real reservation rows from SQLite |
| UC6  | DENY at $2500 |
| UC7  | step-up at $600 |
| UC8  | HITL consent at $300 |
| UC22 | CIBA at $150 |
| UC2  | nested-act chain, two exchanges |
| UC20 | audit shows the `fee_payments` write |

A `pay_airline_fee` chip returning PERMIT at $2500 means `WRITE_TOOL_TYPE_MAP` was
missed. This is the single highest-probability failure and it presents as success.

## Success criteria

- `GET /api/use-cases?vertical=airlines` returns 200 with the resolved catalog.
- The Demo Steps dropdown lists 20 steps for United Airlines.
- All seven per-vertical steps produce their expected ProofStrip verdict in a live
  browser run.
- All automated gates green, with pasted output as evidence.
- Every changed line traces to this spec.

## Risks

| Risk | Mitigation |
|---|---|
| `WRITE_TOOL_TYPE_MAP` omitted — amount ladder inert, demo looks correct | Live UC6 check at $2500 is a required gate |
| Tool registered in some of the seven places but not all | Grep for `pay_airline_fee` and match the count against `cancel_airline_reservation` |
| A2A scope shape wrong — Exchange #2 fails | Live token-chain read; rollback is leaving UC2 unwired |
| Bootstrap mutates live environment `01d89b06` | Read the script before running; only the new specialist app is created |
| Stale Docker image serves old resource-server code | Rebuild, do not restart; verify with `docker exec` grep |
