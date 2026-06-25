# Mock Authz Server: Round-Trip Rules Editor — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — pending spec review
**Topic:** Pull, modify, and push back the policy rules enforced by the mock PingOne
Authorization server (`demo_authz_server`), with edits driving live decisions.

---

## 1. Problem

The PingOne Authorize panel at `/n` (frontend, `https://api.ping.demo:4000`) is a
read-only viewer. The mock authz server (`demo_authz_server`, sidecar on `127.0.0.1:9001`)
exposes `GET /rules`, but that response is **computed** from `scope-topology.json` + env
vars and shares no state with the decision engine (`routes/decision.js`), which reads all
its knobs **once at module load**. There is no write path. We want an admin to pull the
live rules, modify them in the panel, and push them back — with edits **immediately
changing enforcement**, not just the displayed description.

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Target rule set | Mock authz server rules (`demo_authz_server`) |
| Editable scope | Parametric knobs **and** per-tool scope mappings, **live** |
| Persistence | File overlay (`rules-overlay.json`) + **reset-to-SoT** |
| UI surface | **Inline** in the existing `/n` PingOne Authorize panel, admin-gated |
| Write auth | Admin-gated through the BFF |
| PDP write guard | **Yes** — env-gated shared secret (`X-Authz-Admin-Token`, active only when `AUTHZ_ADMIN_TOKEN` set) |
| Scope-mapping editor | **Included in first build** |
| Implementation approach | **A** — dedicated `ruleStore` module read at request time |

## 3. Architecture & data flow

```
Admin in /n panel
  → GET  /api/authorize/mock-authz-rules              (BFF, public read)   ─┐
  → PUT  /api/authorize/mock-authz-rules    (BFF, admin) ──proxy──┐         │
  → POST /api/authorize/mock-authz-rules/reset (BFF, admin)──┐    │         │
                                                             ▼    ▼         ▼
                          demo_authz_server:  POST /rules/reset · PUT /rules · GET /rules
                                                             │    │         │
                                                             ▼    ▼         ▼
                                          ┌──────────  ruleStore.js  ──────────┐
                                          │  defaults: scope-topology.json      │
                                          │            + env constants          │
                                          │  overlay:  rules-overlay.json        │  ← persisted, sparse
                                          └──────────────┬──────────────────────┘
                                                         │ request-time getters
                                                         ▼
                                       decision.js  (live enforcement)
```

`ruleStore` is the single mutable owner of the editable policy state. `decision.js` and
`routes/rules.js` both read it **at request time**. `scope-topology.json` stays the
canonical default and the reset target; the overlay never mutates it.

### PDP-local boundary (intentional)

The overlay lives **only inside `demo_authz_server`**. It does **not** modify the global
`scope-topology.json`, which the BFF, gateway, and MCP server also read for their own local
scope checks. Overriding a tool→scope mapping therefore makes the mock PDP's decision
intentionally diverge from the other services' local checks — which is exactly the demo
narrative: "change policy centrally at the PDP without redeploying every service."

## 4. What is editable (and what is deliberately not)

Editable fields map 1:1 to the four policy rules `GET /rules` already surfaces:

| Rule (`/rules` id) | Editable fields |
|---|---|
| `tool-discovery` | `toolDiscoveryDecision`: `PERMIT` \| `DENY` (applies to `DecisionContext=McpToolsList`) |
| `actor-identity` | `enforceMayAct` (bool); `authorizedActorClientId` (string, used in legacy static mode when `enforceMayAct=false`) |
| `scope-enforcement` | per-tool `requiredScopes` overrides (subset of `read`/`write`/`admin`) |
| `hitl-gate` | `hitlThresholdUsd` (number); per-tool `isWrite` classification |

**Deliberately NOT editable** — token-validity guards stay SoT/env-driven and cannot be
disabled from the UI (security posture): `aud`, `exp`, `iat`, `nbf`, `iss`, sub-present,
PingOne user-active lookup (`Rule 0a`–`0f`), and intent-token mismatch (`Rule 4b`). Also
not editable and unchanged: `isStepUpTool` and `gatewayAudience` (sourced from
`scope-topology.json`).

The simulated engine's deny/HITL **tool-lists** (`SIMULATED_MCP_DENY_TOOLS` etc.) are *not*
imported here — they are not rules in this mock, and adding them would be scope creep and
muddy parity. Out of scope.

## 5. Overlay data model

File: `demo_authz_server/rules-overlay.json` (sparse — only fields that differ from SoT).

```json
{
  "version": 1,
  "updatedAt": "2026-06-09T12:00:00.000Z",
  "global": {
    "hitlThresholdUsd": 100,
    "enforceMayAct": true,
    "authorizedActorClientId": "",
    "toolDiscoveryDecision": "PERMIT"
  },
  "tools": {
    "create_transfer": { "requiredScopes": ["read", "write"], "isWrite": true }
  }
}
```

`ruleStore` computes `effective = defaults ⊕ overlay`. Reset = delete the overlay file and
reload defaults. The file is git-ignored (runtime state, like other `demo_authz_server`
runtime artifacts) — confirm during planning whether an ignore entry is needed.

## 6. `ruleStore.js` (new module in `demo_authz_server`)

Seeds defaults at startup from `scope-topology.json` (via the existing `scopeTopology`
module) + the env constants currently read at the top of `decision.js`
(`CONFIRM_THRESHOLD_USD`/`confirm_threshold_usd`, `ENFORCE_MAY_ACT`,
`PINGONE_MCP_EXCHANGER_CLIENT_ID`/`AGENT_OAUTH_CLIENT_ID`). Loads the overlay file if
present.

Request-time getters:

- `getHitlThreshold()` — overlay `global.hitlThresholdUsd` ?? env default
- `getEnforceMayAct()` — overlay ?? env default
- `getAuthorizedActorClientId()` — overlay ?? env default
- `getToolDiscoveryDecision()` — overlay ?? `'PERMIT'`
- `requiredScopesForTool(tool)` — overlay `tools[tool].requiredScopes` ?? `scopeTopology.requiredScopesForTool(tool)`
- `isWriteTool(tool)` — overlay `tools[tool].isWrite` ?? `scopeTopology.isWriteTool(tool)`
- `getEffectiveRules()` — builds the `routes/rules.js` response body from effective state, plus an `editable` block (see §7)

Mutators:

- `applyPatch(patch)` — validate (§8) → merge into overlay → persist to file → return new effective state
- `reset()` — delete overlay file → reload defaults → return defaults

Non-editable passthroughs remain direct `scopeTopology` calls in `decision.js`
(`isStepUpTool`, `gatewayAudience`).

## 7. API surface

### demo_authz_server (`index.js` + `routes/`)

- `GET /rules` — returns the effective rules (existing shape) **plus** an `editable` block:
  current values, per-field `default`, and `overridden: true|false` so the UI can render an
  editor with "modified" badges.
- `PUT /rules` — body is a sparse patch; validate → merge → persist → return new effective
  rules. Guarded by §9.
- `POST /rules/reset` — clear overlay → return defaults. Guarded by §9.

### demo_api_server BFF (`routes/authorize.js`)

- `GET /api/authorize/mock-authz-rules` — unchanged proxy; now also relays the `editable`
  block.
- `PUT /api/authorize/mock-authz-rules` — `authenticateToken` + `req.user.role === 'admin'`
  → proxy `PUT` to authz `/rules`, forwarding `X-Authz-Admin-Token` when configured.
- `POST /api/authorize/mock-authz-rules/reset` — admin → proxy to authz `/rules/reset`.

Non-admin write/reset → `403`. Authz server unreachable → relay the existing
"mock authz server not running" error shape used by the current GET proxy.

## 8. Validation (server-side, `ruleStore.applyPatch`)

- Reject unknown top-level keys and unknown keys within `global`.
- `hitlThresholdUsd`: finite number ≥ 0.
- `enforceMayAct`: boolean.
- `authorizedActorClientId`: string (trimmed); empty allowed.
- `toolDiscoveryDecision`: one of `PERMIT`, `DENY`.
- `tools.<name>`: tool name **must exist** in the SoT tools manifest (reject typos to
  prevent silent drift); `requiredScopes` ⊆ {`read`,`write`,`admin`}; `isWrite` boolean.
- Any invalid field → `400`, overlay left **unchanged** (validate fully before persisting).

## 9. PDP write guard (env-gated defense-in-depth)

When `AUTHZ_ADMIN_TOKEN` is set, `PUT /rules` and `POST /rules/reset` require a matching
`X-Authz-Admin-Token` header (constant-time compare); mismatch/absent → `401`. When the env
var is unset, the guard is inactive (the server already binds `127.0.0.1` as an in-pod
sidecar; the BFF admin gate is then the sole control). The BFF forwards the header from its
own env when present. `GET /rules` is never guarded (read-only, drives the teaching view).

## 10. Enforcement wiring (`decision.js` refactor)

Replace module-load constants / direct `scopeTopology.*` calls **for the editable subset**
with `ruleStore` getters invoked inside the handler:

- Rule 1 (`McpToolsList`) → `ruleStore.getToolDiscoveryDecision()` (permit or deny)
- Rule 2 (act/may_act) → `ruleStore.getEnforceMayAct()` / `getAuthorizedActorClientId()`
- Rule 3 + `ChipAuthorization` → `ruleStore.requiredScopesForTool()`
- Rule 4 (HITL) → `ruleStore.getHitlThreshold()` / `ruleStore.isWriteTool()`

Untouched: Rules `0a`–`0f`, `4b`, `isStepUpTool`, `gatewayAudience`. `routes/rules.js` is
rebuilt from `ruleStore.getEffectiveRules()`.

`decision.js` is a load-bearing auth file → follow the `regression-guard` discipline: no
existing check weakened or reordered, and add the required Bug Fix Log / regression note.

## 11. UI (inline in `/n`, admin only)

In `demo_api_ui/src/components/education/PingOneAuthorizePanel.js`: when
`user?.role === "admin"`, show an **Edit Rules** toggle (reuse the app-wide
`user?.role === "admin"` pattern). Edit mode controls:

- `hitlThresholdUsd` — number input
- `enforceMayAct` — switch
- `authorizedActorClientId` — text input
- `toolDiscoveryDecision` — PERMIT/DENY toggle
- per-tool table — scope chips (add/remove from {read,write,admin}) + write checkbox

**Save** → `PUT`; **Reset to defaults** → `POST .../reset`; "modified" badges driven by the
`overridden` flags from the `editable` block. Non-admins see today's read-only view,
unchanged. Constraints: `cd demo_api_ui && npm run build` must pass; no emojis in code.

## 12. Parity & safety

- Decision **wire contract is unchanged** (same request params in, same
  `{decision, reason, decision_id, policy_version}` out) → `authz-server-parity` preserved.
- Token-validity guards remain non-editable → UI cannot disable `exp`/`aud`/`iss`/etc.
- Overlay is PDP-local; `scope-topology.json` is never mutated; reset reverts to SoT.

## 13. Testing / success criteria

**Done means:**

- `ruleStore`: unit tests for default seeding, sparse merge, validation rejects, persistence
  round-trip, and reset.
- `decision.js` under overlay: lowering `hitlThresholdUsd` flips a write call
  PERMIT→INDETERMINATE; overriding `requiredScopes` flips PERMIT→DENY; `toolDiscoveryDecision=DENY`
  denies `McpToolsList`; `enforceMayAct=false` + actor ≠ `authorizedActorClientId` denies.
- **Regression:** with no overlay file, `decision.js` and `/rules` behave identically to today.
- BFF routes: non-admin `PUT`/reset → 403; admin happy-path proxies; authz-down → existing
  error shape.
- PDP guard: with `AUTHZ_ADMIN_TOKEN` set, missing/wrong header → 401; correct header → 200.
- UI: admin sees edit mode and a Save round-trips through the BFF; non-admin sees read-only.
  `npm run build` passes.

## 14. Out of scope

- Editing real PingOne Authorize Trust Framework policies.
- Editing the simulated engine thresholds (already writable via `/api/admin/authorize/config`).
- Importing simulated-engine deny/HITL tool-lists into the mock.
- Making token-validity guards (`aud`/`exp`/`iss`/user-lookup/intent) editable.
