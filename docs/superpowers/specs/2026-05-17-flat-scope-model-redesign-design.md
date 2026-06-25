# Scope Model Redesign (SoT + Hybrid + Per-Server, Phased) — Design

**Date:** 2026-05-17 (rev 2 — post tri-expert review)
**Status:** Revised after AI-security + OAuth + staff-eng review; pending re-review
**Author:** Curtis Muir (with Claude)

**Supersedes:** `docs/superpowers/specs/2026-05-16-scope-chain-diagram-design.md`.

## Rev 2 — Critical fixes from tri-expert review (2026-05-17)

Three independent reviews (AI-security, OAuth/RFC, staff-eng) against live
code returned **No / With-major-fixes**. Disqualifying findings, now fixed in
this revision:

- **SEC-C1 / OAuth-I2 — agent identity must NOT fold into a scope.**
  *(NEW-C1 correction, re-review #2: the rev-1 note mis-cited
  `pingoneProvisionService.js:1402` as granting the customer `banking:mcp:
  invoke` — it actually grants
  `['banking:ai:agent:read','banking:read','banking:write','banking:mortgage:read']`.
  The conclusion stands; the evidence is now corrected.)* The customer app is
  granted **`banking:ai:agent:read`** (`pingoneProvisionService.js:1402`; also
  in `config/scopes.js` `customer` USER_TYPE_SCOPES), and **two** identity
  paths key off a scope: `determineClientType` (`auth.js:56-60`,
  `scopes.includes(AI_AGENT_SCOPE)` where `AI_AGENT_SCOPE='ai_agent'`
  `auth.js:31`) **and** `determineUserTypeFromToken` (`auth.js:94-96`,
  `scopes.includes(BANKING_SCOPES.AI_AGENT)`). Folding agent identity into any
  scope the customer also carries mis-types every customer as the agent →
  exposes the IDOR-class PII route `GET /api/users/query/by-email/:email`
  (`routes/users.js:27`, `requireAIAgent` `auth.js:957`). **Fix:** agent
  identity derives from the **RFC 8693 `act`/`may_act` claim** (`auth.js:658`
  already computes `isDelegated: !!decoded.act`; `requireDelegation`
  `auth.js:975-989` already uses it), never a scope. P4 repoints **both**
  `determineClientType` AND `determineUserTypeFromToken:94-96`, AND removes the
  `banking:admin` god-bypass (`auth.js:217-222,879`) or `admin:delete`
  enforcement is dead-swallowed.
- **OAuth-C1 — P6 ledger reworked to per-(sub, resource).** Basis verified
  against the PingOne doc *and* our §4 history (the reviewer cited only code +
  RFC; user challenged this — confirmed below):
  - PingOne doc (https://docs.pingidentity.com/pingone/applications/p1_resource_scopes.html):
    multi-custom-resource requests are **configurable** via the app setting
    *"Request scopes to access multiple resources"* — the rule is **not
    absolute**. The doc is **silent on RFC 8693 token exchange**.
  - REGRESSION_PLAN §4 T-10 (3 documented instances, lines 525-551): our
    **token-exchange** requests spanning resources fail
    `400 invalid_scope: "May not request scopes for multiple resources"`
    *repeatedly*, in our actual environment, regardless of that app setting.
    Empirically the multi-resource setting does **not** rescue the exchange
    path.
  - **Therefore:** the ledger is keyed by `(sub, resource/audience)`; up-scoping
    emits **one RFC 8693 exchange per resource** with a non-empty delta. This
    is justified by the §4 empirical evidence (not an overstated absolute
    rule), and the spec explicitly records that PingOne's multi-resource app
    option does not lift the constraint for token exchange. If a future test
    proves the setting *does* apply to exchange, the per-resource split can be
    revisited — but the demo must not depend on undocumented behavior.
- **STAFF-C1 — P1 split; behavioral gates, not string-diff.** `config/scopes
  .js` does not hold 23 scopes; the real consumers are
  `buildAllowedScopesByAudience` (6 per-audience allowlists) and ~12 mirrored
  provisioner grant lists. A string-diff gate cannot catch a resource silently
  losing a mirrored scope. **Fix:** P1 → P1a–P1d, each with a *behavioral*
  gate (fresh-bootstrap resource/scope/grant graph identical against a recorded
  PingOne fixture). SoT schema gains `audiences[]` + `mirroredOnResources[]`
  (OAuth-I1).
- **STAFF-C2 — cross-package generator made concrete.** No `scopes.json`,
  generator, or cross-package drift test exists today. **Fix:** checked-in
  `scopes.json`, `npm run gen:scopes` wired as `prebuild`/`pretest` in **both**
  `banking_api_server` and `banking_mcp_server`; TS artifacts import a generated
  `.ts`; `mcp-olb.openapi.json` generated; drift test is a **root-level**
  CI script across all 8 services + UI + docs + Python.
- **STAFF-C3 — honest dependency graph.** True graph:
  `P1 → {P2,P3,P4} → P5 → {P7,P8,P9}`; only P6 is standalone (still imports
  SoT). "Ships green alone" column corrected to "ships green given stated deps."
- **SEC-I3 / OAuth-I3 — `validateScopeAudience` fail-open closed.** Unknown
  audience currently returns all scopes unfiltered (`configStore.js:1199-1209`)
  — an RFC 8707 bypass if the P5 owner→audience map misses a key. **Fix:** P5
  changes that branch to **fail-closed** and asserts every exchange audience is
  a present key.
- **SEC-I4 — admin honesty.** `admin:write` post-merge is a destructive-capable
  catch-all (covers delete/user-manage); the "least-privilege for destructive
  ops" claim was false. **Fix:** either keep `admin:delete` separately enforced
  *or* drop the least-privilege claim. (Decision needed — flagged in §Part A.)
- **SEC-I5 / OAuth-I5 — ledger invalidation set.** Logout/expiry is
  insufficient; HITL consent denial, step-up re-mint, exchange-mode change, and
  scope-dropping re-login must each invalidate. (§P6.)

Confirmed accurate by reviewers (kept): the P2-dormant→P3-prune sequencing;
C2/C3 verified facts; the api_key invariant (OAuth bearer **is** dropped at the
gateway — `banking_mcp_gateway/src/index.ts:581-588`); SoT-not-vault; no
runtime sync service.

## Problem

The codebase carries **23 distinct OAuth scope strings** (full inventory in
the research appendix below) with inconsistent depth (1–4 "parts"), several
dead/never-granted scopes (`ai_agent`, `banking:two-exchange:intermediate`,
`banking:two-exchange:final`), and overlapping meanings
(`banking:accounts:read` vs `banking:read`; `banking:ai:agent` vs
`banking:ai:agent:read` vs `ai_agent`). This is hard to teach, violates the
"only two levels of hierarchy" OAuth norm, and the synthetic intermediate
marker scopes only exist to work around our own resource sprawl.

## Goal

A **minimal, least-privilege** scope set with a **single committed source of
truth** (no drift), **per-server scope ownership**, **incremental up-scoping**,
and **agent-side scope memory**, aligned with OAuth best practice and PingOne's
resource/scope rules.

## Part 0 — Single Source of Truth (SoT)

**Decision: NOT the vault.** The vault (`vaultLoader.js`) is an encrypted
secrets store: argon2 KEK/DEK, `VAULT_PASSWORD` required at boot, zeroed after
load, **bypassed entirely on Vercel** (the demo's primary deploy target).
Scopes are *public configuration*, not secrets (configStore marks them
`public: true`). Putting scopes in the vault would mean the app can't enumerate
its own scopes without a boot password, scopes vanish on Vercel, and they stop
being git-diffable/reviewable — the opposite of "no drift, documented." The
vault is the wrong, too-heavy tool here (user-confirmed 2026-05-17).

**SoT = `banking_api_server/config/scopes.js` (extended).** This one committed
module is the *only* place a scope string, its description, and its owning
server are written. Everything else **reads from it**, never duplicates it:

```
config/scopes.js   ← THE source of truth (strings + descriptions + owner)
   ├──► configStore  — defaults reference it (no copied strings)
   ├──► pingoneProvisionService — created-scopes + grants read from it
   ├──► middleware/auth, BankingToolRegistry, mcpWebSocketClient — import it
   └──► build step  — generates docs/SCOPES.md FROM it (human reference)
```

A drift test asserts no scope literal exists outside `config/scopes.js`
(grep-based, in CI) so the SoT property is enforced, not merely intended.

## Goal (scope shape)

**Hybrid depth** (user decision 2026-05-17, supersedes the earlier "flat 2-part
only"): 2-part for cross-cutting capabilities; **3-part only where a server or
resource needs its own isolated scope**. Max 3 parts — **never 4**. This gives
each server its own scope where isolation matters (the new requirement) while
keeping the common capabilities flat.

## OAuth / PingOne grounding

- `resource:action`, **two levels max** — "only two levels of hierarchy are
  seen in scopes in the wild" (FusionAuth, WorkOS, Google, Auth0).
- `read`/`write` action suffixes; minimal set; least privilege; **incremental
  authorization** (request scopes when the feature needs them; remember what's
  already granted).
- Avoid catch-all `admin` scopes (→ we keep `admin:read` / `admin:write`
  split, not a single `banking:admin`).
- PingOne: cannot mix PingOne-API + custom-resource scopes in one request;
  multiple custom resources in one request require explicit app config or
  PingOne errors *"May not request scopes for multiple custom resources"*
  (this is the real constraint the T-10 marker scopes were working around).
  Reference: https://docs.pingidentity.com/pingone/applications/p1_resource_scopes.html

## Part A — The scope set (10 active + 1 reserved) + per-server ownership

Model (user decisions 2026-05-17): money-movement operations are *separate
scopes* (a deposit-only token must not transfer money out), but **`banking:write`
SURVIVES** as the scope for **non-money mutations** (profile edits, account /
transaction record changes) so no route is orphaned (NEW-H1 resolution).
`read` covers all reads; `sensitive` is an orthogonal data-tier; MCP is a
*capability* scope (not CRUD); `admin` keeps read/write/delete split.
`p1:read:user` / `p1:update:user` are PingOne-API (Worker only) — out of scope.

| Scope | Parts | Owning resource | Replaces / scope of | Meaning |
|---|---|---|---|---|
| `banking:read` | 2 | Banking API | `banking:accounts:read`, `banking:transactions:read`, `banking:accounts` | all banking reads |
| `banking:write` | 2 | Banking API | `banking:transactions:write` (kept — **non-money mutations only**) | profile edits, account/transaction record `PUT`/`DELETE`, non-money writes — explicitly **NOT** money movement |
| `banking:transfer` | 2 | Banking API | carved from `banking:write` | `create_transfer` only (money out) |
| `banking:deposit` | 2 | Banking API | carved from `banking:write` | `create_deposit` only (money in) |
| `banking:withdraw` | 2 | Banking API | carved from `banking:write` | `create_withdrawal` only (money out) |
| `banking:sensitive` | 2 | Banking API | `banking:sensitive:read` | full PAN / routing (data-sensitivity tier, orthogonal to verbs) |
| `banking:mortgage:read` | 3 | Mortgage server (:8082, not in PingOne) | (kept) | read mortgage data (Path A api-key swap) |
| `banking:mcp:invoke` | 3 | MCP gateway + MCP server | `banking:ai:agent`, `banking:ai:agent:read`, `ai_agent`, `banking:agent:invoke` | **capability** — may invoke MCP tools (NOT a CRUD verb) |
| `admin:read` | 2 | Admin app | `users:read` | admin list/view/audit/status |
| `admin:write` | 2 | Admin app | `users:manage`, `banking:admin` (non-destructive) | admin modify/manage (NOT delete) |
| `admin:delete` | 2 | Admin app | (kept, now enforced) | destructive admin (delete user/resource) |
| `banking:delete` | 2 | Banking API | — | **RESERVED — SoT-only.** `status:'reserved'`: NOT created/granted/enforced, excluded from the drift denylist as intentionally-unprovisioned; `SCOPES.md` lists it "reserved (not yet implemented)". CI asserts it is never provisioned/granted until promoted. |

**10 active scopes + 1 reserved.** Key model decisions (user, 2026-05-17):
- **`banking:write` survives for non-money mutations** (NEW-H1): money ops get
  narrower scopes carved *out*; everything else that was `banking:write`
  (profile/account/transaction record mutation, the ~43 non-test `banking:write`
  enforcement sites) **stays `banking:write`**. No orphaned routes; backward-
  compatible. The 3 money MCP tools (`create_transfer`/`_deposit`/`_withdrawal`
  in `BankingToolRegistry.ts` — true line/tool mapping verified at edit time,
  rev-2 cites were transposed) move to `banking:transfer`/`:deposit`/`:withdraw`;
  `toolScopeMap.ts` `TOOL_SCOPES` co-edited in lockstep (else T-10).
- **`admin:delete` distinct & enforced** (SEC-I4 → option a): P4 wires
  `requireAdmin`/`ROUTE_SCOPE_MAP` for `DELETE /api/admin/*`, removes the
  `banking:admin` god-bypass (`auth.js:217-222,879`), grants admin app
  `admin:delete` in SoT `grantedToApps[]`.
- **`banking:mcp:invoke` is a capability, not CRUD.**
- **`banking:sensitive` is a sensitivity tier**, orthogonal to verbs (folding
  into `banking:read` would expose PAN to all readers — a downgrade).

**Deleted entirely:** `banking:two-exchange:intermediate`,
`banking:two-exchange:final`, `ai_agent`, `banking:ai:agent`,
`banking:ai:agent:read`, `banking:agent:invoke`. **Agent identity is NOT
folded into any scope** (see rationale) — it moves to the `act` claim.

**Per-server ownership** (documented in `config/scopes.js` + generated
`SCOPES.md`; PingAuthorize owns none — it is a policy decision point that
*evaluates* the scopes already on the token, user decision 2026-05-17):

| Server / resource | In PingOne? | Owns |
|---|---|---|
| Banking API (BFF data) | yes (banking resource) | `banking:read`, `banking:write` (non-money), `banking:transfer`, `banking:deposit`, `banking:withdraw`, `banking:sensitive` (+ `banking:delete` reserved, not provisioned) |
| Mortgage server (:8082) | no | `banking:mortgage:read` |
| MCP gateway + MCP server | yes (mcp resources) | `banking:mcp:invoke` |
| Admin (PingOne admin app) | yes | `admin:read`, `admin:write`, `admin:delete` |
| PingAuthorize | no | none — consumes/evaluates the above |

> **SoT schema (STAFF-C1 / OAuth-I1).** `owner` alone is insufficient — the
> provisioner mirrors scopes onto multiple resources for exchange
> compatibility (`banking:mcp:invoke` on MCP-server AND Intermediate AND Final
> AND Gateway), and `buildAllowedScopesByAudience` needs per-audience
> membership. Each SoT record is therefore:
> `{ name, parts, description, owner, audiences:[...], mirroredOnResources:[...], grantedToApps:[...] }`.
> P2/P5 reconcile preserves `mirroredOnResources` (must NOT prune a mirror —
> doing so reproduces the §4 T-10 follow-up #2 `"At least one scope must be
> granted"` failure).

Rationale for the debated calls (user decisions, 2026-05-17):
- **Hybrid depth — naming convenience, NOT the isolation mechanism
  (OAuth-I4).** `banking:mortgage:read` / `banking:mcp:invoke` keep 3 parts as
  a *readability* aid only. Server isolation is enforced by **RFC 8707 resource
  indicators / `aud` + the Authorize gate** (`agentMcpTokenService.js:1830-1832`
  comment states verbatim that `banking:mcp:invoke` is enforced by the Authorize
  gate, not scope breadth), exactly as the mortgage api_key path is isolated by
  the gateway's disposition + audience, not scope depth. The spec must NOT
  present 3-part depth as conveying routing/isolation — that teaches the wrong
  OAuth model. Max 3, never 4.
- **Admin honesty (SEC-I4 — RESOLVED option a).** `admin:delete` stays a
  **distinct, enforced** scope; P4 wires `requireAdmin`/`ROUTE_SCOPE_MAP` so
  `DELETE /api/admin/*` + user-delete require `admin:delete` (which
  `admin:read`/`admin:write` do NOT grant) — a deliberate **tightening** vs
  today's `banking:admin` catch-all (`auth.js:218,879`), verified in P4.
- **Agent identity moves to the `act` claim, NOT a scope (SEC-C1 / OAuth-I2).**
  The delegated agent is identified by the **RFC 8693 `act` / `may_act`
  claim**, which `auth.js:658` already computes as `isDelegated: !!decoded.act`
  and `requireDelegation` (`auth.js:975-989`) already uses. A scope is **only**
  authorization (a *what*), never identity (a *who*) — conflating them is the
  SEC-C1 priv-esc bug, because the customer carries the delegation marker
  scope today (`banking:ai:agent:read`, `pingoneProvisionService.js:1402`).
  **P4** repoints **`determineClientType` (`auth.js:56-60`) AND
  `determineUserTypeFromToken` (`auth.js:94-96`)** / `requireAIAgent` /
  `requireEndUser` and `DELEGATION_ONLY_SCOPES`/Path A/B to derive agent-ness
  from `act`/`may_act` presence (and/or app `client_id`/type), **never** from a
  shared scope, on *current* scope names; **AND removes the `banking:admin`
  god-bypass** (`auth.js:217-222,879`) so `admin:delete` enforcement is not
  swallowed — with an explicit test that a normal customer session does **not**
  satisfy `requireAIAgent` on `GET /api/users/query/by-email/:email`, and that
  a non-`admin:delete` admin token is refused on `DELETE /api/admin/*`. Only
  after P4 proves zero decision flips does P5 do the mechanical rename.

## Delivery model — independently-shippable phases (no big-bang)

A code review (superpowers, 2026-05-17) found the original single-cutover plan
mis-stated the starting point on its highest-risk surfaces. Verified facts:

- **C2 (verified):** `pingoneProvisionService.createScopes` (`:396-424`) only
  GET→reuse→POST. **No scope DELETE path exists.** Re-running bootstrap *adds*
  new scopes alongside old — "PingOne holds only new scopes" is false without
  new reconcile code.
- **C3 (verified):** `banking:ai:agent:read` is the **delegation trigger** for
  1-exchange Path B (`agentMcpTokenService.js:937-999`,
  `DELEGATION_ONLY_SCOPES` `:946`); granted to the user app (`:1402`) and MCP
  server app (`:1625`) so real tokens carry it. Folding/deleting it is a
  load-bearing logic redesign, not a string swap.
- **C1 (verified):** `configStore.js` and `pingoneProvisionService.js` hardcode
  scope literals today; neither imports `config/scopes.js`. The SoT is a
  rewrite + wiring project, not an "extend". Current `config/scopes.js` also
  defines scopes the target deletes (`banking:admin`, `ai_agent`) and is
  consumed by `auth.js`/`transactions.js`/CIBA via `ROUTE_SCOPE_MAP` etc.

Resolution: **phase the work so each phase ships green on its own**, the one
unavoidable cutover is mechanical-only and isolated, and the load-bearing logic
change is verified *before* the cutover.

## Anti-drift: build-time generation, NOT a sync service

Scopes are used across the whole app (configStore, provisioner, setup script,
enforcement, token-chain labels, docs, diagrams, monitoring). The instinct is
"a central service that keeps them in sync." **Rejected as too heavy and
self-defeating:** a runtime sync service is itself a moving part that can
drift, fail, or desync — "a service that keeps things in sync" is deferred
drift with extra steps, plus new infra in a demo.

**The correct weight is build-time generation from the SoT** (industry norm:
codegen from a schema, not a daemon). Nothing "stays in sync" because nothing
is duplicated to begin with:

```
config/scopes.js  ← THE fact (the only place a scope string is written)
   │  generator (build step, CI-enforced by the drift test)
   ├─► configStore defaults + buildAllowedScopesByAudience
   ├─► pingoneProvisionService created-scopes + 12 grant lists
   ├─► setup script (npm run setup:fresh / pingone:bootstrap path)
   ├─► generated scopes.json  → consumed by the 3 TS/JSON artifacts
   ├─► docs/SCOPES.md   (human reference)
   ├─► token-chain scope labels (BFF tokenEvents)
   └─► architecture diagrams + monitoring views (P7/P8/P9)
```

The **CI drift test fails the build** if any of these contains a scope literal
not sourced from the SoT. Drift becomes *structurally impossible*, not
*monitored*. This generator is part of P1 and every consumer is wired to it in
the phase that touches that consumer.

**Definition of done, every phase:** UI/TS builds exit 0; the relevant scope
test suites pass — and the spec **budgets test rewrites explicitly** (I-1):
~62 `src/__tests__` files contain target scope literals; the drift denylist
excludes a **named, enumerated** migration-fixture allowlist (NOT the whole
`__tests__` tree), and P3/P4/P5 each carry a "rewrite N scope test files" line
item; `REGRESSION_PLAN.md` §4 entry; `REGRESSION_PLAN.md` §0–1 read and "what I
will not break" stated before editing any §1 file.

### Dependency graph (honest — STAFF-C3)

`P1a → P1b → P1c → P1d → {P2, P3, P4} → P5 → {P6*, P7, P8(+P7), P9}`

Only **P6** is *logically* standalone but still imports the SoT (so wants P1).
P3/P4 edit the SoT (need P1). P7/P8/P9 are **post-cutover** (before P5 the live
system legitimately uses old names — a diagram showing them is *correct* until
P5). The "ships green" column means "given its stated deps merged."

| Phase | Goal | Ships green (given deps) |
|---|---|---|
| **P1a — SoT data + generator + drift test** | Rewrite `config/scopes.js` as authoritative data: each scope `{ name, parts, description, owner, audiences:[], mirroredOnResources:[], grantedToApps:[], status }` for **all current scopes**, preserve `PINGONE_OIDC_DEFAULT_SCOPES_SPACE` (M1) + migrate `ROUTE_SCOPE_MAP`/`USER_TYPE_SCOPES`. Build `gen:scopes` → checked-in `scopes.json` + a generated `scopes.ts` emitted **into each package's `rootDir`** (`banking_api_server/` and `banking_mcp_server/src/` — the MCP `tsconfig` has `rootDir:./src` + `include:[src/**/*]`, so an out-of-`src` artifact will NOT compile; STAFF-C2). `mcp-olb.openapi.json` is a **second codegen target** (per-tool→scope template, distinct from `toolScopeMap`). Wiring: **`pretest` in `banking_api_server`** (its `build` is a no-op echo — a `prebuild` hook is meaningless there) and **`prebuild`+`pretest` in `banking_mcp_server`** (real `tsc`). Generated TS may instead be imported as JSON (`resolveJsonModule:true` is set). **Root-level** drift test across all 8 services + UI + docs + **Python** (named-fixture denylist). Wire only the **mechanical** importers: `auth.js`, `transactions.js`, CIBA. | ✅ data+tooling only |
| **P1b — wire configStore defaults** | Point `configStore.js` scope-default keys at the SoT. Gate: every default string byte-identical pre/post (recorded snapshot test). | ✅ given P1a |
| **P1c — wire `buildAllowedScopesByAudience`** | Re-derive the 6 per-audience allowlists from the SoT `audiences[]` field (the I3 owner→audience-env-var map is pulled **forward to here**, not deferred to P5). Gate: `buildAllowedScopesByAudience` output **byte-identical** for every live audience (snapshot test), AND every audience the exchange paths pass is a present key. | ✅ given P1a |
| **P1d — wire provisioner create+grant (highest-risk P1 sub-phase — NOT "just tooling")** | Provisioner's 7 `createScopes` lists + ~13 `grantScopesToApplication` lists read from SoT `mirroredOnResources[]`/`grantedToApps[]`. **Behavioral gate (not string-diff):** a stateful PingOne mock (extending the existing `pingoneProvisionService.regression.test.js` harness) replays `provisionEnvironment()` and asserts a **byte-identical *effective* resource/scope/grant graph** pre/post. The fixture **MUST model**: (i) WORKER apps skip grants entirely (`grantScopesToApplication:772-779` — Agent + MCP-Gateway WORKER grants no-op; recording *requested* scopes would diverge from reality), (ii) the stateful cross-resource "one scope name per app" filter (`:798-823`, order-dependent, live GETs), (iii) **effective post-filter grants, not requested** (the T-10 follow-up #2 hazard: defined ≠ granted). Building this mock is real test engineering, the single highest-risk P1 deliverable — sized accordingly, not "data+tooling." **Token-chain label wiring is split OUT into its own micro-step** (P1d-tc): zero behavioral coupling to provisioner work, §1-protected `agentMcpTokenService.js`, §1 pre-read + Token-Chain smoke gate (I-2). Setup-script wiring also here. | ⚠️ given P1a — heavy |
| **P2 — provisioner reconcile (dormant)** | Per resource: PUT app grants to the SoT set **first**, then DELETE resource scopes not in the SoT — but **preserve `mirroredOnResources`** (OAuth-I1: pruning a mirror reproduces §4 T-10 follow-up #2). Ships with reconcile = current set → deletes nothing (unit test proves inert + a fixture test proves it *would* prune an orphan and re-PUTs grants first). | ✅ given P1d, no-op until P5 |
| **P3 — delete verified-dead scopes** | Remove never-granted scopes: `ai_agent`, `banking:two-exchange:intermediate`, `banking:two-exchange:final`. Update SoT; reconcile prunes them. Move the `oauthAuthorizeResource.js` `s === 'ai_agent'` removal **here** (not P5 — SEC-M6: no phase should ship a filter naming a deleted scope). Rewrite the N test files asserting these strings. | ✅ given P1+P2 |
| **P4 — delegation/identity off the `act` claim** | Repoint `DELEGATION_ONLY_SCOPES` + Path A/B (`agentMcpTokenService.js:~930-1000`) **and BOTH scope-based identity paths** — `determineClientType` (`auth.js:56-60`, `AI_AGENT_SCOPE`/`configStore ai_agent_scope`) **and `determineUserTypeFromToken` (`auth.js:94-96`, `BANKING_SCOPES.AI_AGENT`)** — plus `requireAIAgent`/`requireEndUser` to derive agent-ness from the **`act`/`may_act` claim** (`auth.js:658` `isDelegated`; `requireDelegation` `auth.js:975-989`), **never a scope** (SEC-C1/OAuth-I2). **Remove the `banking:admin` god-bypass** (`auth.js:217-222` `hasRequiredScopes`, `:879` `requireAdmin`) — else `admin:delete` enforcement is dead-swallowed. On **current** scope names. Spec/plan must contain the *enumerated* full consumer list (`clientType`/`userType`/`requireAIAgent`/`requireEndUser`/`USER_TYPE_SCOPES`) + tests: a normal customer session does NOT pass `requireAIAgent` on `GET /api/users/query/by-email/:email`; a delegated token DOES; a non-`admin:delete` admin token IS refused on `DELETE /api/admin/*` (SEC-I4 tightening — requires admin app granted `admin:delete` in SoT `grantedToApps[]`); `DELEGATION_ONLY_SCOPES` still excludes delegation markers from exchangeable scopes (SEC-M7); `:1015` force-append interaction (OAuth-I2). | ✅ logic, on current names |
| **P5 — mechanical rename + cutover** | Flatten to the **10 active scopes** (Part A; `banking:delete` reserved, NOT provisioned) in the SoT + the TS/JSON artifacts via the P1a `scopes.json`/`scopes.ts`. **Money-op carve-out (NEW-H1 — `banking:write` SURVIVES for non-money; only the 3 money tools move):** (a) `BankingToolRegistry.ts` `requiredScopes` for the 3 money tools → `banking:transfer`/`:deposit`/`:withdraw` — verify true line/tool mapping at edit time by re-grepping `create_transfer`/`create_deposit`/`create_withdrawal` (rev-2 cites were transposed; do NOT trust line labels); (b) **`banking_mcp_server/src/tools/toolScopeMap.ts` `TOOL_SCOPES`** co-edited in lockstep for those 3 (the BFF RFC 8693 *request*-scope map — mismatch = T-10 `invalid_scope` failure; single most exchange-critical file) + a per-money-op Path-A intersection test (`agentMcpTokenService.js:957`); (c) `config/scopes.js` `ROUTE_SCOPE_MAP` money routes only; (d) **the ~43 non-test `banking:write` sites stay `banking:write`** — non-money mutations keep the surviving scope (no orphaned routes, NEW-H1 resolved). `banking:sensitive:read`→`banking:sensitive` **with a grantee-set-equality diff** (SEC-C2) + customer-unreachable test for `get_sensitive_account_details`. `validateScopeAudience` unknown-audience → **fail-closed** (SEC-I3/OAuth-I3). **Offline window**: deploy in dependency order → `pingone:bootstrap` (P2 reconcile) → PingOne API check **exactly the 10 active scopes, zero legacy, zero `banking:delete`, mirrors intact** → invalidate session store → smoke. | ❌ the one accepted cutover |
| **P6 — per-(sub, resource) up-scope ledger** | BFF-side ledger keyed by **`(sub, resource/audience)`** (OAuth-C1 — NOT a single union). Up-scoping emits **one RFC 8693 exchange per resource** with a non-empty delta; never assembles a cross-resource set (would reproduce T-10). Cold ledger = full request (correctness independent — enforcement re-reads real token claims at the Authorize gate). **Invalidate on: logout, token expiry, HITL consent denial, step-up re-mint, exchange-mode change, scope-dropping re-login** (SEC-I5/OAuth-I5 — logout/expiry alone is insufficient). Test: HITL-narrowed session must re-exchange, not serve from ledger. | ✅ given P1 (post-P5 for new names) |
| **P7+P8 — diagrams (merged, post-cutover)** | (Merged per STAFF-I4 — same prereq/tooling/verification.) New zoomable `/architecture/scopes` from `scope-chain.mmd` (teaches token contents + that **delegation lives in the `act` claim, not a scope** — OAuth-M3) **and** regenerate every scope-naming diagram. Grep all `.mmd` + rendered assets → zero legacy scope strings. | ✅ docs only, post-P5 |
| **P9 — monitoring refresh (post-cutover)** | Every app under **Monitoring** in the side-nav reflects new scopes; audit each sub-view for hardcoded legacy strings; route through the generated artifact or fix inline. Python services included in the denylist tooling (STAFF-M3). | ✅ UI/docs, post-P5 |

### The cutover sequence (P5 only — answers "without breaking everything")

A zero-break cutover is impossible (name-based enforcement + old tokens carry
deleted names → every session re-logs in; accepted for a demo). P1–P4 and
P6 carry **no** cutover. P5's window is minimized to:

1. Land P5 code (rename in SoT + 3 TS/JSON artifacts) on a branch; both TS
   packages build 0; full scope corpus green on new names.
2. Confirm P2 reconcile is active (not dormant) for the new SoT set.
3. Brief offline window (no rolling option without the compat alias the user
   rejected).
4. Deploy in dependency order: `banking_api_server` → `banking_mcp_server` +
   `banking_mcp_gateway` (rebuild `dist/`) → `banking_agent_service` →
   `langchain_agent`. Mortgage service has no scope logic (gateway enforces
   `banking:mortgage:read` upstream) — order-independent.
5. `npm run pingone:bootstrap` with P2 reconcile → verify via PingOne API that
   exactly the target set exists per resource, no legacy scope remains (this is
   what makes `SCOPES.md` + P7 diagram truthful).
6. Invalidate the session store (LMDB/Redis/Upstash) — don't wait for natural
   expiry.
7. Smoke: admin→`/admin`; customer→`/dashboard`; one chip → Token Chain shows
   new names + real `aud`; transfer (HITL); `show_mortgage` (api_key path);
   2-exchange path; logs show no "multiple resources" / no
   `missing_exchange_scopes` (the C3 regression signature).
8. Drift test + `SCOPES.md` regen in CI: zero legacy literals outside allowlist.

## Per-phase verification / success criteria

- **P1:** drift test passes; `SCOPES.md` generated & matches `config/scopes.js`;
  full scope corpus green; **a diff proves zero scope-string changes** (P1 is a
  refactor); `buildAllowedScopesByAudience` output byte-identical pre/post.
- **P2:** unit test proves reconcile with list=current deletes nothing; a
  fixture test proves it *would* delete an orphan and re-PUTs grants first.
- **P3:** very-thorough search → zero `ai_agent` / `two-exchange:*`; re-provision
  prunes them; full corpus green.
- **P4:** every `clientType`/`requireAIAgent`/`requireEndUser` consumer
  enumerated with a test asserting no authorization decision flips; 1-exchange
  Path A and Path B both still resolve on current scope names; `MIN_USER_SCOPES_
  FOR_MCP` guard still satisfied (I1).
- **P5:** fresh `npm run pingone:bootstrap` → exactly the target scopes per
  resource, **no legacy scope remains** (PingOne API check); full agent flow
  (1+2 exchange) end-to-end; Token Chain shows new names + real `aud`; both TS
  builds 0; UI build 0.
- **P6:** second call for an already-held scope → **no** redundant exchange
  (`[McpExchangerToken]` logs); cold ledger still works; HITL-narrowed session
  does not over-grant; delta never spans two resources.
- **P7:** `/architecture/scopes` loads; every scope string matches the SoT.
- **P8:** very-thorough grep of every `.mmd` source + rendered diagram asset →
  **zero** legacy scope strings; all diagrams regenerated.
- **P9:** every Monitoring side-nav sub-view audited → zero hardcoded legacy
  scope strings; UI build 0.

### Hard gate — NO legacy scopes (post-P5)

This is a blocking gate, not advisory. After P5 (and re-verified at P8/P9), a
single very-thorough search across the **entire repo** (all 8 services, UI,
docs, diagrams, tests-except-the-named-migration-fixtures) must return **zero**
legacy scope literals: `ai_agent`, `banking:accounts`, `banking:accounts:read`,
`banking:transactions:read`, `banking:transactions:write`,
`banking:ai:agent`, `banking:ai:agent:read`, `banking:agent:invoke`,
`banking:two-exchange:intermediate`, `banking:two-exchange:final`,
`banking:admin`, `users:read`, `users:manage`, `banking:sensitive:read`. Any
hit fails the phase. The CI drift test encodes this list as the denylist.

**Note — NOT legacy (kept active scopes; must NOT be in the denylist):**
`banking:read`, **`banking:write`** (survives — non-money mutations, NEW-H1),
`banking:transfer`, `banking:deposit`, `banking:withdraw`, `banking:sensitive`,
`banking:mortgage:read`, `banking:mcp:invoke`, `admin:read`, `admin:write`,
`admin:delete`. **`banking:delete`** is reserved (SoT-only,
`status:'reserved'`) — also NOT in the denylist, but a CI check asserts it is
never *provisioned/granted/enforced* until promoted.

### ARCHITECTURE-TRUTHS deliverables

`ARCHITECTURE-TRUTHS.md` gains two entries (added in P1 for the api_key
invariant — it is true today and independent of the scope work; and updated in
P5 with the scopes pointer once the model is final):

1. **api_key disposition (P1):** "Credential disposition
   (api_key/dual_token/oauth_bearer) lives in the **MCP Gateway**
   (`credentialSwap.ts`, `router.ts`). The **MCP server never originates
   backend credentials**. On the api_key path the user OAuth bearer is
   **dropped at the gateway**; the mortgage backend authenticates via
   `X-API-Key` + `X-User-Sub` (Phase 266/267). Moving api_key into the MCP
   server is a security regression (separation of duties; single egress audit
   point)."
2. **Scopes pointer (P5):** a TRUTH line pointing at `config/scopes.js` (SoT)
   + `docs/SCOPES.md` (generated reference) as the authoritative scope source;
   "no scope literal exists outside the SoT + generated artifacts (CI drift
   test enforced)."

## Out of scope

- `p1:read:user` / `p1:update:user` (PingOne-API, Worker-only; cannot mix with
  custom scopes anyway).
- Any change to RFC 8693 exchange **topology** (still 1- and 2-exchange).
- Marketing pages.
- A compat/alias layer (user explicitly rejected; this is why P5 has an offline
  window rather than zero-downtime).

## Research appendix — current 23-scope inventory (pre-redesign)

1-part: `ai_agent`.
2-part (11): `banking:read`, `banking:write`, `banking:admin`,
`banking:sensitive`, `banking:accounts`, `admin:read`, `admin:write`,
`admin:delete`, `users:read`, `users:manage`, `banking:ai:agent`.
3-part (8 + 2 P1): `banking:accounts:read`, `banking:transactions:read`,
`banking:transactions:write`, `banking:mortgage:read`,
`banking:ai:agent:read`, `banking:mcp:invoke`, `banking:agent:invoke`,
(`p1:read:user`, `p1:update:user`).
4-part define-only (2): `banking:two-exchange:intermediate`,
`banking:two-exchange:final`.

Agent scope memory: none today beyond per-login introspection cache — the
Part C ledger is net-new.
