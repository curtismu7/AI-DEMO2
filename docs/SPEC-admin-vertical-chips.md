# Authorize-Driven Dynamic Chips — Admin Vertical Extension

**Status:** 📋 Planned. Extends [SPEC-authorize-driven-dynamic-chips.md](./SPEC-authorize-driven-dynamic-chips.md). **Revised — see [Revision R2](#revision-r2--per-vertical-themed-admin-supersedes-d1) below; it supersedes the single-`admin`-vertical model in the "Locked decisions"/"Phased plan" sections.** Phase A (admin tool-set manifest+plugin) and Phase B (tools tagged `vertical:'admin'`) are done and kept; R2 changes how the admin face is *themed and presented*, not the tool-set.

**Base branch:** `worktree-fix-gateway-upstream-fallback` (this work is stacked on it; branch `worktree-admin-vertical-chips`). The base already advanced past the original SPEC doc — it now includes `refactor(ui): remove dead legacy chip arrays (G2)` (head `78c32c0b`), but `ADMIN_CHIPS` / `PINGONE_ADMIN_CHIPS` remain (they were never dead).

**Goal:** Make the **admin dashboard** and the agent that runs on it a first-class, Authorize-driven vertical — the same way healthcare/banking/retail already are after the base SPEC. The admin agent sees *only* admin tools (clean vertical isolation), admin chips grey out by scope tier, and the agent's heuristic vocabulary matches the admin actions instead of the underlying vertical's.

---

## Revision R2 — Per-vertical themed admin (supersedes D1)

**Why the change:** admin is not its own destination — it's the *operator* face of each vertical. Sporting-goods admin should look and talk like sporting-goods; healthcare admin like CareConnect. So there is **one admin tool-set, projected through each vertical's theme + terminology.** This supersedes D1's single standalone `admin` vertical.

### Customer vs Admin (the split, per vertical)
Every vertical has a **customer** (self-service, own data, `read`/`write` scopes) and an **admin** (operator over the whole customer base, `admin:read`/`admin:write`/`admin:delete`). The admin operations are identical generic CRUD over the shared user store; only the **noun** (customer → patient → member), **theme**, and **agent phrasing** change per vertical.

| Vertical | Customer agent | Admin agent |
|---|---|---|
| Banking | my accounts, transfer, my transactions | look up a **customer**, freeze **account**, reset password |
| Healthcare | my records, book appointment, coverage | look up a **patient**, suspend **patient** account, reset **patient** password |
| Sporting-goods | my gear, my rentals | look up a **member**, freeze a **member**, reset **member** password |

### Locked decisions (R2)
- **R2-1 — Themed overlay, one tool-set.** The admin chips/theme/persona/wording are projected from the **active business vertical**; the admin tool-set is shared (no per-vertical tool copies). *(Supersedes D1.)*
- **R2-2 — Same actions, vertical wording.** The same admin actions everywhere, labels + agent phrasing in each vertical's terminology.
- **R2-3 — Phase A repurposed, Phase B kept.** Phase A's standalone `admin` manifest becomes the **banking/default** admin face + the home of the admin tool-set; it is no longer a user-facing destination. Phase B's `vertical:'admin'` tagging stays — the admin **tool-fetch** still runs under the `admin` context (Authorize-greying flow unchanged); only **presentation** is per-vertical.
- **R2-4 — Admin follows the active vertical.** The admin surface themes to the session's currently-selected business vertical; switching the vertical re-themes the admin chips/persona/responses. No separate admin destination, no admin-only vertical picker.

### Revised phases (replace the A–G "Phased plan" below)
- **P1 — Per-vertical admin face in each manifest.** Add an optional `admin` block to the manifest schema and to each business vertical (`banking`, `healthcare`, `retail`, `sporting-goods`, `workforce`):
  ```jsonc
  "admin": {
    "noun": "patient",                                  // customer → patient → member
    "persona": "Records Administrator",
    "greeting": "Hi {name} — what patient can I help with?",
    "chips": [                                          // admin tool → vertical-themed label
      { "tool": "lookup_customer", "label": "Look Up Patient" },
      { "tool": "freeze_account",  "label": "Suspend Patient Account" },
      { "tool": "delete_customer", "label": "Delete Patient" }
    ]
  }
  ```
  Theme reuses the vertical's existing `theme.cssVars`. Banking's `admin` block = the labels from the Phase A manifest (the default).
- **P2 — Admin surface themes to the active vertical.** Admin chips render from the active vertical's `admin.chips`, themed with its cssVars; the **tool-fetch keeps the `admin` context** (Phase A/B) so Authorize filtering + scope-greying are unchanged. The UI joins the live admin tool list (permitted/denied) with the active vertical's `admin.chips` labels — present+permitted → active, present+denied → greyed, absent → hidden.
- **P3 — Requests & responses speak the vertical's language.** Admin system prompt = admin role + active vertical's `admin.noun`/terminology; admin heuristic vocabulary gets the vertical-noun synonyms so phrases route correctly.
- **P4 — Scope tiers (read/write/delete).** Apply to the admin tool-set regardless of theme. **Must build on the base branch's new SoT-`riskLevel` write-gating (commit `0cc26053`), not the old `isWriteIsh` name heuristic.**
- **P5 — Cleanup.** Retire the standalone admin *destination* + reconcile the `HIDDEN_IDS` / `PLUGIN_OVERLAY_IDS` straddle and the stale `loader.js`/`verticalDispatch.js` comments (the old Phase G).

> The sections below ("Locked decisions" D1–D3, "Architecture", "Phased plan" A–G) are the **pre-R2** design, kept for history. Where they conflict with R2, **R2 wins.**

---

## Why (the mismatch you can see today)

On `/admin` the chips and the agent disagree:

- The **Admin Actions** chips render (Look Up Customer, View Transactions, Freeze Account, …) purely on `user.role === 'admin'`.
- But the **heuristic agent's help text** lists the *underlying* vertical's actions (e.g. healthcare: Coverage, Patient Records, Appointments) — because the agent's vocabulary is keyed to the resolved vertical, not admin.

Three concrete root causes (all confirmed against the base branch):

1. **Admin chips bypass the Authorize flow entirely.** In [`BankingChips.jsx`](../demo_api_ui/src/components/BankingChips.jsx), `ADMIN_CHIPS` (L13–22) and `PINGONE_ADMIN_CHIPS` (L24–31) render under `user?.role === 'admin'` (L75–114) **without** calling `chipPermState()` — only the `chips10` manifest path (L127–131) is permission-aware. Admin chips carry **no `tool` field**, so even if routed through `chipPermState` they'd join nothing.
2. **The tool fetch uses the wrong vertical on `/admin`.** [`AIAgent.js`](../demo_api_ui/src/components/AIAgent.js) resolves `effectiveVerticalId = forceVertical || activeVerticalId` (L1966) and `BankingAdminOps` passes `forceVertical="admin"`, **but** the tools effect calls `fetchAgentTools({ vertical: activeVerticalId … })` (L2840, deps L2845) — it uses `activeVerticalId`, not `effectiveVerticalId`. So on the admin dashboard the agent fetches the *underlying* vertical's tools.
3. **Admin is half-vertical, half-overlay, with two competing configs.** `config/verticals/admin/index.js` is a banking **overlay** (id `admin-overlay`), and `config/verticals/admin-console/manifest.json` is an orphaned full vertical (id `admin-console`). No `admin` vertical *plugin* is registered, so `verticalManifest.plugins.get('admin')` returns nothing and `resolveAgentScopes('admin', …)` falls back to base `['read','mcp:invoke']`.

Additionally, admin MCP tools are **not tagged with a vertical**, so the gateway's vertical filter can't isolate them; and the scope picker is a **boolean** write toggle, but admin needs three tiers.

**Target:** admin is one coherent vertical — Authorize decides, the gateway enforces, the UI reflects it — identical to the base SPEC, plus a three-tier admin scope picker.

---

## Locked decisions

- **D1 — Standalone admin vertical.** Admin becomes a real vertical with clean isolation: the admin agent sees *only* admin tools. Retire the `admin-overlay` plugin and the duplicate `admin-console` manifest. *(Reverses the older "admin = cross-vertical overlay" note in memory `project_admin_overlay`; the admin tools still operate on the global user store, so cross-customer management is unaffected.)*
- **D2 — Three admin scope tiers.** Picker offers **Read only** (`admin:read`) / **Read + Write** (`admin:write`) / **Full — incl. Delete** (`admin:delete`). `Delete Customer` greys independently of other writes.
- **D3 — PingOne chips deferred.** `PINGONE_ADMIN_CHIPS` (separate `pingone-admin` MCP backend) stays role-gated as today. Routing them through Authorize requires extending discovery to a second MCP backend — out of scope, noted as a follow-up.

The three admin tiers already exist in the SoT — no `scope-topology.json` change needed:

```
lookup_customer / get_customer_profile / get_customer_accounts / get_customer_transactions  → ["admin:read","users:read"]
freeze_account / adjust_balance / reset_customer_password                                    → ["admin:write","users:manage"]
delete_customer                                                                              → ["admin:write","admin:delete","users:manage"]
```

---

## Architecture (delta from the base SPEC)

The flow is unchanged from the base SPEC — `POST /api/demo-agent/tools` → `resolveAvailableTools` → WS gateway → Authorize → permitted `tools[]` + `_meta.deniedTools`. The deltas:

1. **`vertical: 'admin'`** flows end-to-end (frontend sends `effectiveVerticalId`, gateway filters to `vertical:'admin'` tools, Authorize returns `AllowedVertical: 'admin'`).
2. **A third scope tier (`allowDelete`)** rides alongside `allowWrite` for admin; the BFF resolves `admin:delete` only when set. Token cache key (already scope-set-derived) gives the delete tier a distinct cache entry for free.

```
ScopePicker (admin: Read / Write / Full) ─► AIAgent fetchAgentTools({ vertical:'admin', allowWrite, allowDelete })
  │
BFF resolveAgentScopes('admin', { allowWrite, allowDelete })
  │   read  → admin:read, users:read           (always)
  │   write → admin:write, users:manage         (allowWrite)
  │   del   → admin:delete                       (allowDelete)
  ▼
Gateway guardToolsList(…, ActiveVertical='admin', CandidateTools) ─► Authorize
  │   AllowedVertical:'admin'; per-tool PermittedTools/DeniedTools by granted scopes
  ▼
delete_customer denied unless admin:delete granted → greyed chip + reason
```

---

## Phased plan (TDD, one commit per phase — mirrors base SPEC cadence)

### A — Admin vertical manifest (`demo_api_server/config/verticals/admin/`)
Build **one** canonical `admin` vertical (schemaVersion 3), folding in `admin-console`'s theme/persona/greeting. id `admin`.
- `chips10` entries each carry a `tool` ref to the registered MCP tool: `lookup_customer`, `get_customer_transactions`, `get_customer_profile`, `get_customer_accounts`, `freeze_account`, `adjust_balance`, `reset_customer_password`, `delete_customer`.
- Heuristics (migrated + expanded from `admin/index.js`, adding `adjust_balance` + `delete_customer`), system prompt, theme.
- **Register as a vertical plugin** so `verticalManifest.plugins.get('admin').getTools()` resolves — `resolveAgentScopes` depends on it.
- Follow the `add-vertical` skill checklist for every touchpoint.

### B — MCP server: tag admin tools `vertical: 'admin'`
- In `BankingToolRegistry.ts`, tag the 8 admin tools `vertical: 'admin'`. The gateway then drops them for non-admin sessions and drops banking/healthcare tools for admin sessions (clean D1 isolation). `tools/list` already returns the full set (base SPEC phase C1).

### C — Mock Authorize + gateway (mostly verification)
- The mock's `McpToolsList` branch already evaluates each tool's `requiredScopesForTool` vs `grantedScopes`, so `delete_customer` is auto-denied without `admin:delete` — the three-tier behavior falls out for free. Confirm `AllowedVertical: 'admin'` and add a mock-parity test (`feedback_authz_mock_parity`).
- Confirm `guardToolsList` keeps `vertical:'admin'` tools when `ActiveVertical='admin'`. Likely no gateway code change.

### D — BFF: split write vs delete tier
- **Fix `agentScopes.isWriteIsh`** — it currently treats *all* `admin*` as write-ish (`scope.startsWith('admin')`), so `admin:delete` would be granted by the write toggle. Split out a delete-ish predicate; `admin:delete` is gated by `allowDelete` only.
- `resolveAgentScopes(vertical, { allowWrite, allowDelete })` — grant write-ish on `allowWrite`, delete-ish only on `allowDelete`. Keep boolean back-compat for non-admin verticals.
- Thread `allowDelete` through `agentToolsResolver` → `agentCCTokenService` → `POST /api/demo-agent/tools` (admin only).

### E — Frontend: tiered picker + admin chips through `chipPermState`
- **Fix the vertical bug:** `fetchAgentTools` effect → use `effectiveVerticalId` (not `activeVerticalId`) in body + deps (`AIAgent.js` L2840/L2845).
- `BankingChips.jsx`: add a `tool` field to each `ADMIN_CHIPS` entry and route the Admin Actions group through `chipPermState()` (role still gates whether the group shows; permissions gate each chip — greying + `onDeniedChip`). `PINGONE_ADMIN_CHIPS` untouched (D3).
- `ScopePicker.jsx`: for the admin vertical render a 3-option select (Read only / Read + Write / Full — incl. Delete); other verticals keep the boolean. `AIAgent.js` maps tier → `{ allowWrite, allowDelete }`.

### F — Heuristic vocabulary scoped to admin (fixes the visible mismatch)
- Add admin vocabulary to `nlIntentParser` `THEME_VOCAB` so the heuristic help text + greeting on the admin dashboard list admin actions, not the underlying vertical.

### G — Cleanup / dedup (resolve the overlay↔vertical straddle)
Phase A repurposed `admin/index.js` into the standalone vertical plugin and added `admin/manifest.json`. That leaves admin straddling two models until this phase reconciles it (flagged by the Phase A `/simplify` altitude review):
- **`services/verticalDispatch.js`** — `PLUGIN_OVERLAY_IDS = ['admin']` and the `ctx.isAdmin` merge branches treat admin as an overlay; `isPluginToolName` now both overlay-matches admin *and* would vertical-match it (saved only by an explicit skip). Remove the special-casing so admin dispatches like any sibling vertical (needs its own dispatch tests).
- **`services/verticalManifest/index.js`** — `HIDDEN_IDS = new Set(['admin-console','admin'])` conflates two reasons (deprecated vs overlay). Keep `admin` hidden from the switcher (role-gated, not name-blocklisted if feasible) and update the rationale comment.
- **Stale comments now falsified by Phase A:** `loader.js:16` ("Skip directories without manifest.json (e.g., admin overlay)") and `verticalDispatch.js:5-6` ("index.js but no manifest.json") — admin now has a manifest. Fix both.
- Retire the duplicate `admin-console/manifest.json`. Confirm `BankingAdminOps` `forceVertical="admin"` matches the final id (it does).

---

## Verification

**Live (the demo moment):**
- **Read only:** write/delete admin chips grey with a reason; Look Up / View Profile/Accounts/Transactions active.
- **Read + Write:** Freeze/Adjust/Reset active; **Delete Customer stays greyed** (needs `admin:delete`).
- **Full:** all active.
- **Isolation:** on `/admin` only admin tools appear; switching to healthcare swaps cleanly. Gateway log shows `vertical='admin'` filtering.
- **Vocab:** the agent's help text lists admin actions, not healthcare.

**Automated (extend the base SPEC's set):**
- Mock `decision.toolsList` admin-tier case (read/write/delete).
- `agentScopes` delete-tier split (delete granted only with `allowDelete`).
- Gateway vertical filter keeps admin tools for `ActiveVertical='admin'`.
- `chips10`/manifest schema test covers admin chip `tool` refs.
- UI build gate (`cd demo_api_ui && npm run build` = 0; `regression-guard`).

---

## Risks / call-outs

- **Behavioral change (D1):** the admin agent no longer overlays the active vertical's tools — admin tools only. Customer management still works (tools hit the global user store). Reverses memory `project_admin_overlay`.
- **Stacked on an unmerged base.** Sequence so this lands after `worktree-fix-gateway-upstream-fallback`.
- **Follow-up:** route `PINGONE_ADMIN_CHIPS` through Authorize once discovery can span the `pingone-admin` MCP backend.
- Per project rules: worktree-isolated, explicit staging, no `git add -A`.
