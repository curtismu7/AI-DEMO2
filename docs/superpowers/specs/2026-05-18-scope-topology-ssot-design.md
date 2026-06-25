# Scope Topology Single Source of Truth + Regression Guard

**Date:** 2026-05-18
**Status:** Approved (design)
**Owner:** Curtis Muir
**Touches:** REGRESSION_PLAN §1 (OAuth/scope path: provisioning, RFC 8693 exchange map, gateway enforcement)

---

## 1. Problem

`create_transfer` fails at the MCP gateway with:

```
status=403 {"error":"insufficient_scope","message":"insufficient_scope: missing banking:transfer",
 "decision":"DENY","required_scopes":["banking:write","banking:transfer"]}
```

`get_my_accounts` / `get_my_transactions` succeed (need only `banking:read`).
`create_transfer` fails because the gateway correctly enforces `banking:transfer`
(canonical scope-mapping doc + Phase 261-01 plan), but **nothing else mints,
provisions, or requests that scope**:

- The user's PingOne token carries `[banking:write, banking:read, openid, ...]`
  — **no `banking:transfer`** (BFF log line 1283).
- `pingoneProvisionService.js` never defines `banking:transfer` as a resource
  scope and never grants it to any app.
- The BFF tool→scope map (`mcpWebSocketClient.js` `MCP_TOOL_SCOPES`) maps
  `create_transfer: ['banking:write']`, so even a correctly-scoped user would
  not get `banking:transfer` requested in the RFC 8693 exchange.

### Root cause

There is **no authoritative scope topology**. Scope definitions are duplicated
across ~6 locations, written in different phases, never reconciled:

| Source | Owns | Drift state |
|---|---|---|
| `banking_mcp_gateway/src/auth/toolScopes.ts` `TOOL_SCOPES` | tool → enforced scopes | **Only one with `banking:transfer`** |
| `banking_api_server/services/mcpWebSocketClient.js` `MCP_TOOL_SCOPES` | tool → RFC 8693 exchange scopes | `create_transfer` missing `banking:transfer` |
| `banking_api_server/services/pingoneProvisionService.js` | scopes provisioned + app grants | `banking:transfer` absent entirely |
| `banking_api_server/services/scopeAuditService.js` `SCOPE_REFERENCE_TABLE` | app → scopes (audit) | Stale: no `banking:transfer`, no `banking:mcp:invoke`, no `banking:mortgage:read` |
| `banking_api_server/services/scopePolicyEngine.js` `SCOPE_TAXONOMY` | scope → risk/ops | Different scope set again |
| `banking_api_server/scripts/verify-scope-configuration.js` | hardcoded `requiredScopes` | Yet another list |
| `.planning/quick/2026-04-07-*scope*.md` (×4) + `pingone-update-scopes-manual.md` | human reference | Hand-maintained, drifted |

The `banking:transfer` 403 is a **symptom**. The fix is a single source of
truth plus an automated guard so this class of regression cannot ship again.

---

## 2. Goals / Non-goals

### Goals

1. One authoritative scope-topology manifest: scopes → resources → apps → tool
   dependencies.
2. All correctness-critical consumers **derive** from the manifest (no
   duplicated tables remain in code).
3. The `banking:transfer` bug is fixed **through** the manifest, not as a
   side patch.
4. A CI-blocking static regression test that fails on any code drift —
   including a revert of the transfer fix.
5. A live PingOne audit script that diffs the running environment against the
   manifest (catches env drift the static test cannot see).
6. Generated, never-hand-edited documentation derived from the manifest.

### Non-goals

- Re-architecting the RFC 8693 exchange path itself (only its scope *inputs*).
- Changing gateway enforcement semantics — the gateway is already correct.
- Adding new scopes beyond `banking:transfer` (the manifest encodes the
  existing topology faithfully; it is not a redesign of the scope model).
- Migrating non-scope concerns out of `scopePolicyEngine`/`scopeAuditService`.

---

## 3. Architecture

### 3.1 The manifest — `scope-topology.json` (repo root)

Single authoritative file, read **natively** by both runtimes (BFF JS
`require`, gateway TS `import` with `resolveJsonModule`). No codegen, no second
copy — consumers that derive from it cannot drift.

Shape (illustrative; full content produced during implementation by reading
the live topology, not invented):

```jsonc
{
  "$schema": "./scope-topology.schema.json",
  "version": 1,
  "scopes": {
    "banking:read":     { "description": "Read accounts, balances, transactions", "riskLevel": "low",  "resource": "Main Banking Resource Server" },
    "banking:write":    { "description": "Write banking operations (deposit/withdrawal)", "riskLevel": "medium", "resource": "Main Banking Resource Server" },
    "banking:transfer": { "description": "Execute fund transfers", "riskLevel": "high", "resource": "Main Banking Resource Server" },
    "banking:mcp:invoke":    { "description": "Invoke MCP tools via RFC 8693 exchange", "riskLevel": "medium", "resource": "MCP Server Resource" },
    "banking:mortgage:read": { "description": "Read mortgage data (Phase 267 Path A)", "riskLevel": "low", "resource": "Main Banking Resource Server" }
    // ... full set enumerated during implementation
  },
  "resources": {
    "Main Banking Resource Server": {
      "uri": "https://...",
      "scopes": ["banking:read", "banking:write", "banking:transfer", "banking:mortgage:read", "..."]
    },
    "MCP Server Resource": { "uri": "https://mcp-server.pingdemo.com", "scopes": ["banking:mcp:invoke", "..."] }
    // ...
  },
  "apps": {
    "Super Banking User App":  { "grantedScopes": ["banking:read", "banking:write", "banking:transfer", "openid", "profile", "email", "offline_access"] },
    "Super Banking Admin App": { "grantedScopes": ["banking:read", "banking:write", "banking:transfer", "banking:admin", "..."] }
    // ... all 7 apps
  },
  "tools": {
    "create_transfer":   { "requiredScopes": ["banking:write", "banking:transfer"], "challengeType": "step_up" },
    "create_deposit":    { "requiredScopes": ["banking:write"], "challengeType": "step_up" },
    "create_withdrawal": { "requiredScopes": ["banking:write"], "challengeType": "step_up" },
    "get_my_accounts":   { "requiredScopes": ["banking:read"] }
    // ... every tool in toolScopes.ts + MCP_TOOL_SCOPES, reconciled
  }
}
```

A companion `scope-topology.schema.json` (JSON Schema) constrains the shape so
malformed edits fail the regression test with a clear message.

**Canonical naming authority:** the manifest's `apps` keys and `scopes` keys
are *the* canonical names. Every other surface (provision display names, audit
table app names) maps **to** these keys; the manifest never adapts to them.

### 3.2 The `banking:transfer` fix — applied through the manifest

- Manifest declares `banking:transfer` on `Main Banking Resource Server`,
  grants it to `Super Banking User App` **and** `Super Banking Admin App`
  (per the canonical scope-mapping doc — both apps get it), and lists it in
  `create_transfer.requiredScopes`.
- `create_deposit` / `create_withdrawal` encoded as `['banking:write']` only —
  verified correct against gateway `toolScopes.ts` (no sibling bug; transfer is
  the deliberate elevated scope).
- Provisioning, BFF exchange map, and gateway map then derive from the manifest
  (§3.3), so the fix propagates everywhere by construction.
- **Apply path:** re-run `npm run pingone:bootstrap` (idempotent) to push the
  new scope + grants to the live environment. The user must **log out and log
  back in** to mint a fresh token carrying `banking:transfer` — existing
  tokens will not have it.

### 3.3 Consumer migration (no stale tables remain)

| Consumer | Before | After |
|---|---|---|
| `pingoneProvisionService.js` | hardcoded scope/grant lists | derives provisioned scopes from `manifest.resources`, app grants from `manifest.apps`, MCP exchange scope list from manifest |
| `mcpWebSocketClient.js` `MCP_TOOL_SCOPES` | hardcoded tool→scope | built from `manifest.tools[*].requiredScopes` |
| gateway `toolScopes.ts` `TOOL_SCOPES` | hardcoded (only correct one) | built from `manifest.tools[*].requiredScopes`; `STEP_UP_TOOLS` / `getChallengeTypeForTool` derive from `manifest.tools[*].challengeType` |
| `scopePolicyEngine.js` `SCOPE_TAXONOMY` | own scope set (drifted) | scope id + `riskLevel` sourced from `manifest.scopes`; engine-specific `operations` / `requires_user_context` kept as a **manifest-keyed overlay** (small map keyed by canonical scope names) |
| `scopeAuditService.js` `SCOPE_REFERENCE_TABLE` | own app→scope table (stale) | built from `manifest.apps[*].grantedScopes`; a pinned **app-name map** translates audit/PingOne display names → canonical manifest app keys |
| `verify-scope-configuration.js` | hardcoded `requiredScopes` | reads the manifest; extended with a live-PingOne diff (§3.5) |
| `.planning/quick/2026-04-07-*scope*.md` (×4) + `pingone-update-scopes-manual.md` | hand-maintained | replaced with pointer stubs → generated `docs/scope-topology.md` |

**Overlay decision (explicit, reviewable).** `scopePolicyEngine`'s
`operations` / `requires_user_context` and `scopeAuditService`'s display-name
keys are policy/audit-local concerns, **not** topology. They stay in their
files as manifest-*keyed* overlays: the scope/app *set* is single-sourced from
the manifest; only behavior-specific metadata stays local. Rejected
alternative: hoist `operations`/`requires_user_context` into the manifest —
rejected because it pollutes a topology SSOT with policy-engine semantics and
broadens the manifest's responsibility beyond "which scope / resource / app /
tool". The regression test asserts every overlay key exists in the manifest
(no orphan or extra entries), so the overlay cannot silently drift either.

### 3.4 Generated documentation — `docs/scope-topology.md`

A script (`npm run scopes:doc`) renders the manifest to a human-readable
Markdown reference (scope catalog, resource→scope table, app→scope grants,
tool→scope dependency table). Never hand-edited. The four
`.planning/quick/2026-04-07-*scope*.md` files and `pingone-update-scopes-manual.md`
are replaced with one-line stubs pointing here.

### 3.5 Regression guard — two layers

**Layer 1 — static jest test** (`scopeTopology.regression.test.js`, runs in
`npm test`, **CI-blocking**). Pure static, no PingOne calls. Asserts:

1. Manifest validates against `scope-topology.schema.json`.
2. For **every** tool: gateway `TOOL_SCOPES` == BFF `MCP_TOOL_SCOPES` ==
   `manifest.tools[*].requiredScopes` (set equality). *This assertion, run
   against today's code, fails — it catches exactly the `banking:transfer`
   bug.*
3. Every scope referenced by any tool / app / resource exists in
   `manifest.scopes`.
4. Every scope in `manifest.scopes` belongs to exactly one resource that
   lists it in `resources[*].scopes`.
5. `scopePolicyEngine` derived scope set == `manifest.scopes` keys; every
   overlay key exists in the manifest.
6. `scopeAuditService` derived `SCOPE_REFERENCE_TABLE` == manifest-derived
   app→scope projection (via the pinned app-name map); every mapped name
   resolves to a manifest app key.
7. `pingoneProvisionService` provisions every `manifest.scopes` entry and
   every `manifest.apps[*].grantedScopes` grant (asserted against the
   manifest-derived lists it now consumes).
8. `docs/scope-topology.md` is in sync — regenerating from the manifest
   produces byte-identical output (fails if manifest changed without
   `npm run scopes:doc`).

Because consumers in §3.3 are now *migrated* (not advisory), every one of
these is a hard failure, identical in severity to the transfer bug.

**Layer 2 — live PingOne audit** — extend
`verify-scope-configuration.js` to diff the live environment against the
manifest: every `manifest.scopes` entry exists on its resource server; every
`manifest.apps[*].grantedScopes` grant is attached in PingOne. On-demand
(needs management creds), run as a manual pre-deploy step. Catches environment
drift the static test cannot observe.

---

## 4. Data flow (transfer, after fix)

```text
Browser → (cookie) → BFF
  → MCP_TOOL_SCOPES[create_transfer]  ←─ derived from scope-topology.json
      = [banking:write, banking:transfer]
  → RFC 8693 exchange with PingOne
      user token now carries banking:transfer (provisioned + granted from manifest)
      → minted MCP token scope includes banking:transfer
  → gateway: TOOL_SCOPES[create_transfer]  ←─ derived from same manifest
      = [banking:write, banking:transfer]
      evaluateScopeDecisionLocally → PERMIT
  → tool executes → transfer succeeds
```

Every map in this path resolves from `scope-topology.json`; the regression
test asserts they are equal before any of this runs.

---

## 5. Error handling

- **Malformed manifest:** schema validation fails fast in the regression test
  and at service boot (a single `loadScopeTopology()` helper validates on first
  read and throws with the offending path). Services do not start with an
  invalid topology.
- **Unknown tool at runtime:** gateway and BFF preserve existing
  `?? ['banking:read']` fallback behavior — unchanged; the manifest does not
  remove the safety net.
- **Live audit, missing mgmt creds:** script exits non-zero with the existing
  `verify-scope-configuration.js` credential-error message; never silently
  passes.
- **Drift introduced in a PR:** Layer-1 test fails CI with a message naming the
  exact tool/scope/app and the two values that disagree.

---

## 6. Testing

- `scopeTopology.regression.test.js` — the 8 assertions in §3.5, CI-blocking.
- A focused negative test: programmatically simulate reverting
  `create_transfer` to `['banking:write']` in one consumer and assert the
  regression test would fail (proves the guard guards).
- Existing gateway suite (`npm run build` + gateway jest) must stay green —
  `toolScopes.ts` now derives but its public API (`getScopesForGatewayTool`,
  `getChallengeTypeForTool`, `evaluateScopeDecisionLocally`) is unchanged.
- Existing BFF critical suite green — `MCP_TOOL_SCOPES` shape unchanged
  (still `Record<string,string[]>`), only its source changes.
- Manual end-to-end: logout → login → agent "transfer $X" → Token Chain shows
  `banking:transfer` in the exchanged token scope → gateway PERMIT → transfer
  succeeds. Deposit and withdrawal still succeed (no regression).

---

## 7. Regression discipline (REGRESSION_PLAN)

Touches §1 OAuth/scope path: `pingoneProvisionService.js`,
`mcpWebSocketClient.js`, gateway `toolScopes.ts`. Before editing each §1 file
I will state what I will not break, stage by hunk, and verify the staged diff.
Per the standing rule, PingOne resource-scope creation and app-grant API
shapes will be verified against live PingOne documentation/discovery **before**
writing the provisioning changes — not guessed. A REGRESSION_PLAN §4 Bug Fix
Log entry will be added per the template, and the new manifest +
regression test will be added to the §1 protected table.

---

## 8. Success criteria

- `scope-topology.json` + `scope-topology.schema.json` exist at repo root.
- Gateway `toolScopes.ts`, BFF `MCP_TOOL_SCOPES`, `pingoneProvisionService`,
  `scopePolicyEngine`, `scopeAuditService` all derive from the manifest — no
  hardcoded scope/app/tool tables remain in those files.
- `scopeTopology.regression.test.js` passes with the corrected manifest and
  **fails if the transfer fix is reverted** (demonstrated by the negative
  test).
- `cd banking_mcp_gateway && npm run build` → exit 0; `npm test` green.
- `npm run scopes:doc` regenerates `docs/scope-topology.md` byte-identically;
  the 5 `.planning` scope docs are pointer stubs.
- `verify-scope-configuration.js` diffs live PingOne against the manifest.
- Manual: transfer works end-to-end after `pingone:bootstrap` re-run +
  user re-login; deposit/withdrawal unaffected.

---

## 9. Out-of-scope / follow-ups

- Folding `operations` / `requires_user_context` into the manifest (rejected
  this pass — see §3.3 overlay decision).
- Migrating `verify-token-exchange.js` / `dbg-pingone-grants.js` hardcoded
  scope lists (debug/dev scripts, not correctness-critical; the live audit
  script supersedes their purpose).
- Multi-vertical (retail / workforce) scope variants — the manifest is
  single-vertical; a `variants` key is a future extension, not now.
