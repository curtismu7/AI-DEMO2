# Reusable Theme Manifest — Design

**Date:** 2026-05-18
**Status:** Approved (design); pending implementation plan
**Scope:** Phase 1 only. Phase 2 (real retail MCP tools) is a separate spec, started after Phase 1 is tested.

---

## Problem

"Make the retail theme work" surfaced a deeper issue. There is no single retail
theme — there are **three overlapping, partially-conflicting mechanisms**, and
the default **banking** experience is **hardcoded into components**, bypassing
all of them:

1. **Vertical configs** (`banking_api_server/config/verticals/*.json`) +
   `VerticalContext` + `VerticalSwitcher` — has terminology/greeting, but
   `VerticalContext` is **loaded and then ignored** by the UI.
2. **Industry presets** (`banking_api_ui/src/config/industryPresets.js`) +
   `IndustryBrandingContext` — applies CSS color vars only; the only mechanism
   actually wired through the app.
3. **Phase 225 `ff_retail_mode`** — a feature flag + `RetailModeBanner` +
   `isRetail` branches + hardcoded `retailMockData.js`. The "Best Buy" identity
   currently exists only in `RetailModeBanner.css`, nowhere config-addressable.

Audit verdict: banking is **~60% hardcoded** — `DashboardHeader` renders the
literal string "Super Banking", `BankingChips` hardcodes chip labels,
`index.html` hardcodes the document title, `BankingAgent` picks its greeting
via an `isRetail` ternary. Server-side `banking.json`/`retail.json` terminology
exists but **no UI component reads it**.

Consequence: retail only "works" because it is special-cased. Adding a future
theme would repeat the special-casing. The reusability goal is unmet.

## Goal

One **Theme Manifest** per vertical as the single source of truth for all
theme-varying presentation. **Banking is manifest consumer #1** — banking and
retail flow through the identical code path. A future theme is **one new JSON
file + assets, zero component/CSS edits**.

Best Buy-style retail is the first *non-default* consumer. The AI pipeline
(OAuth, RFC 8693, PingOne Authorize, FIDO2, MCP gateway, chip→routing→MCP,
token chain, HITL) is **never touched by theming** — themes change
presentation only.

### Phasing (explicit)

- **Phase 1 (this spec):** reusable manifest architecture + banking as
  consumer #1 + Best Buy retail with *flavored* AI (persona/greeting only).
  Test end-to-end.
- **Phase 2 (next spec):** real retail MCP tools (catalog/cart/orders) through
  the same gateway + token exchange + Authorize. Started only after Phase 1 is
  tested. The Phase 1 schema is forward-compatible so Phase 2 needs no
  re-architecture.

## Non-goals

- No changes to OAuth / RFC 8693 / Authorize / FIDO2 / MCP gateway / token
  chain / HITL. The manifest carries **no secrets, scopes-as-policy, or auth
  config**. Existing `scopes`/`demoUsers` blocks in the vertical JSON stay
  banking-fixed and are **not** part of the reusable theme contract.
- No real retail MCP tools (Phase 2).
- No unrelated refactoring of dashboard/agent beyond what manifest-driving
  requires.

---

## Section 1 — Theme Manifest schema (single source of truth)

One JSON file per theme at `banking_api_server/config/verticals/<id>.json`,
promoted to `schemaVersion: 2`. Every theme-varying thing lives here and
nowhere else — **including the strings currently hardcoded in components** so
banking can be data-driven.

```jsonc
{
  "id": "retail",
  "schemaVersion": 2,
  "identity": {
    "displayName": "Best Buy",
    "headerTitle": "Best Buy",        // replaces DashboardHeader literal "Super Banking"
    "documentTitle": "Best Buy · PingOne AI IAM Core", // replaces index.html static <title>
    "logoAlt": "Best Buy logo",       // replaces hardcoded alt text
    "tagline": "AI-Powered Retail Demo",
    "logoPath": "/themes/retail/logo.png"
  },
  "theme": {
    // The ONLY place colors are defined. Absorbs BOTH var families that are
    // split today: industryPresets --app-primary-red-* AND vertical theme.primary.
    "cssVars": {
      "--app-primary-red": "#0046BE",          // Best Buy blue
      "--app-primary-red-hover": "#003a9e",
      "--app-primary-red-mid": "#1a5fd0",
      "--app-primary-red-border": "#002d7a",
      "--brand-dashboard-header-start": "#0046BE",
      "--brand-dashboard-header-end": "#0046BE",
      "--brand-app-shell-hero-start": "#0046BE",
      "--brand-app-shell-hero-end": "#0046BE",
      "--theme-accent": "#FFE000"              // Best Buy yellow
    }
  },
  "terminology": {
    "transaction": "Activity",
    "transactions": "Activity",
    "agent": "Shopping Assistant"
    // ...full map as today
  },
  "agent": {
    "persona": "Shopping Assistant",
    "greeting": "Ask me about products, prices, and your cart...",
    "systemPromptFlavor": "You help a Best Buy customer..."  // schema-present, NOT consumed in Phase 1
  },
  "dashboard": {
    "kind": "retail",                 // dashboard renderer: "banking" | "retail"
    "chips": [                        // chip LABELS only; routing keys stay banking-fixed
      { "key": "accounts",     "label": "My Orders" },
      { "key": "balance",      "label": "Rewards Points" },
      { "key": "transfer",     "label": "Checkout" },
      { "key": "transactions", "label": "Purchase History" }
    ],
    "mockData": { "products": [ /* ... */ ], "orders": [ /* ... */ ] }
  }
}
```

Decisions baked in:

- **`theme.cssVars` is the single color authority.** Today colors are split
  between `industryPresets.js` (`--app-primary-red-*`) and
  `verticals/*.json` (`theme.primary`). The manifest absorbs both families.
- **Component-hardcoded strings move into the manifest:**
  `identity.documentTitle`, `identity.headerTitle`, `identity.logoAlt`,
  `agent.greeting`, `dashboard.chips[].label`. This is what makes banking a
  real consumer rather than a hardcoded default.
- **Chip label vs routing key split (load-bearing).**
  `dashboard.chips[].label` is themeable; `dashboard.chips[].key` is fixed and
  maps to the existing banking chip→routing→MCP pipeline. **Only labels are
  themed.** The skip-proof chip pipeline invariant is preserved — routing keys,
  heuristics, and MCP dispatch are unchanged.
- **`agent.systemPromptFlavor`** is in the schema for forward-compatibility but
  is **not consumed in Phase 1**. The agent's actual instructions stay banking.
- **`dashboard.kind`** selects a dashboard renderer without any feature flag.
  `mockData` lives in the manifest (replaces `retailMockData.js`).
- **`banking.json` is migrated to v2 and fully populated** (incl. UI strings)
  so it is the default/fallback *and* a real consumer. If the active manifest
  is invalid, the loader falls back to `banking.json`.

---

## Section 2 — Server: manifest loader & API

`verticalConfigService.js` is **extended, not rewritten** (it already loads
`config/verticals/*.json`, caches, and couples `active_vertical` +
`ui_industry_preset`).

- **`getActiveManifest()`** — new. Returns the full v2 manifest for the active
  theme. Falls back to `banking.json` if the active id is missing/invalid
  (existing fallback posture preserved).
- **`mapTerm()`** — unchanged signature; reads `manifest.terminology`.
- **Schema validation on load** — `loadVerticals()` gains a lightweight
  validator: each file must have `id`, `schemaVersion: 2`,
  `identity.displayName`, `theme.cssVars`. A malformed manifest is **skipped
  with a logged error** (matches existing try/catch posture) — one bad theme
  file cannot crash the app. If the *active* theme is invalid, fall back to
  `banking`.
- **API** — routes in `routes/verticalConfig.js` stay.
  `GET /api/config/vertical` returns the full v2 manifest **additively**
  (old fields still present, so anything reading the old shape keeps working
  during migration). `PUT /api/config/vertical` flips `active_vertical` +
  `ui_industry_preset` via `setActiveVertical`.
- **Route auth relaxed (deliberate, documented):** `PUT /api/config/vertical`
  is changed from admin-only to **any authenticated session**. This is what
  lets the user-facing dashboard ThemePicker (Section 3a) work for a
  customer-persona demo. Bounded and safe because the manifest is
  presentation-only (the load-bearing constraint below — no scopes/auth/
  secrets), the action is fully reversible, and it does not touch the AI
  pipeline. This loosening is recorded in the REGRESSION_PLAN §1 theme-contract
  note so it is not mistaken for an accidental authz regression. The change
  remains **server-wide**: whoever switches changes the live theme for all
  sessions (single source of truth — no per-user/per-browser override path).
- **Constraint (load-bearing):** the manifest never carries secrets,
  scopes-as-policy, or auth config. `scopes`/`demoUsers` stay banking-fixed and
  are explicitly **out** of the reusable theme contract. This is the line that
  keeps "the AI architecture works" true.

---

## Section 3 — Client: one `useTheme()` hook; retire competing mechanisms

Today there are three consumers: `VerticalContext` (fetches
`/api/config/vertical`, then ignored), `IndustryBrandingContext` (applies
`industryPresets.js` cssVars), Phase 225 `ff_retail_mode` (flag + banner +
`isRetail` branches). Collapse to one.

- **`ThemeProvider` / `useTheme()`** — single context. Fetches the v2 manifest
  once; exposes `{ identity, cssVars, terminology, agent, dashboard, mapTerm }`.
  Applies `cssVars` to `document.documentElement` (same proven mechanism
  `IndustryBrandingContext` uses today). Collapses **both**
  `VerticalContext` + `IndustryBrandingContext` into one provider.
- **`IndustryBrandingContext`** — becomes a thin shim re-exporting from
  `useTheme()` so existing imports keep working during incremental migration;
  call sites migrate, then the shim is removed.
- **`ff_retail_mode`** — **retired.** Flag, `RetailModeBanner`, banner toggle,
  and the client-side flag read in `UserDashboard` are deleted. Theme is
  server-authoritative; admins switch it via the Config UI, not a per-session
  banner.
- **`retailMockData.js`** — **deleted.** Dashboard reads
  `manifest.dashboard.mockData`.
- **Hardcoded-string components migrated to `useTheme()`:**
  - `DashboardHeader.js` — title/logo alt from `identity`.
  - `index.html` document title — set at runtime by a small effect from
    `identity.documentTitle`. The static `<title>` in `index.html` is changed
    to a neutral pre-hydration placeholder (`PingOne AI IAM Core`) so no theme
    name is hardcoded in HTML.
  - `BankingAgent.js` — greeting from `manifest.agent.greeting`; the
    `isRetail` ternary and 4-arg `welcomeMessage(... industryPresetId)` hack
    are removed (both themes use one code path).
  - `BankingChips.jsx` — chip **labels** from `manifest.dashboard.chips`;
    chip **keys** and the routing/MCP wiring unchanged.
- **Dashboard** — `UserDashboard` branches on `manifest.dashboard.kind`
  (`"banking" | "retail"`) instead of the flag. Phase 225's retail
  product/cart/orders UI is kept but extracted into
  `<RetailDashboard data={manifest.dashboard.mockData} />`.
- **Config UI** — the "Industry & branding" picker in `Config.js` is repointed
  to list themes from `/api/config/verticals/list` and `PUT
  /api/config/vertical`, so admins pick the active theme from **one** control.

Net deletions: `ff_retail_mode` flag + `RetailModeBanner`, `retailMockData.js`,
`isRetail` branches, duplicate retail color defs / dead `industryPresets`
entries. Net additions: `ThemeProvider`, `<RetailDashboard>`, `<ThemePicker>`.

---

## Section 3a — Dashboard theme picker (user-facing)

The approved model is server-authoritative and admin-switchable via the Config
UI. This adds a **second entry point to the same model** so a presenter driving
the customer persona can switch themes without going to the admin Config page.

- **`<ThemePicker variant="toolbar" />`** rendered in the existing
  `dashboard-toolbar` row in `UserDashboard.js` (currently holds
  `AgentUiModeToggle`, `ThresholdControls`, "Token Info", "Reset Demo"),
  near the top of the dashboard as requested.
- Lists themes from `GET /api/config/verticals/list`; on selection calls
  `PUT /api/config/vertical` — **the exact same server-authoritative path the
  admin Config UI uses**. There is no local override and no second resolution
  path: single source of truth preserved.
- The switch is **server-wide**: whoever picks changes the live theme for all
  sessions. This matches the approved model (Section 2).
- After the PUT succeeds, `useTheme()` re-fetches the manifest and the app
  reskins (identical flow to the admin path). Control is a compact
  `<select>`-style element styled to match the existing toolbar buttons; the
  current active theme is the selected value.
- Auth: relies on the Section 2 route-auth relaxation (`PUT
  /api/config/vertical` → any authenticated session). The picker renders for
  any logged-in user (customer or admin).
- A second `<ThemePicker variant="config" />` is what the admin Config UI
  renders (Section 3, Config UI repoint) — same component, same endpoint,
  different chrome. One component, no duplicated switch logic.

---

## Section 4 — AI architecture: what stays, what's phased

**Unchanged by theming — ever:** RFC 8693 token exchange
(`agentMcpTokenService`), PingOne Authorize, FIDO2/step-up, MCP gateway
routing, chip→routing→MCP pipeline, token chain UI, HITL/consent. The manifest
carries no scopes/auth/policy (Section 2 constraint).

**Phase 1 — retail-flavored responses (this spec):**
- The agent keeps calling the **real banking MCP tools** through the
  **unchanged** pipeline.
- Only `manifest.agent.{persona, greeting}` change what the user *sees*.
  `BankingAgent.js` reads these from `useTheme()`.
- `systemPromptFlavor` is in the schema but **not wired**; the agent's actual
  instructions stay banking.
- Result: looks/talks like a Best Buy shopping assistant, banking plumbing
  underneath. Demo-safe, zero pipeline risk.

**Tool-returned data is NOT themed in Phase 1 (decided 2026-05-18):**
LMDB-backed accounts/transactions (`data/store.js`:
`Checking`/`Savings`/`Deposit`) and the hardcoded mortgage / api_key
`show_mortgage` payload (`banking_mortgage_service`, `$425,000 / 6.125%`)
keep returning banking data under any theme. The retail experience is
carried by `<RetailDashboard>` manifest mock data + chip labels + greeting.
This is the deliberate presentation-vs-data line; relabeling returned data
is Phase 2.

**Phase 2 — real retail MCP tools + retail data (OUT of this spec; next spec):**
- New retail tools (catalog/cart/orders) registered through the **same**
  gateway + token exchange + Authorize, with their own scopes; real
  retail-shaped data replacing the banking store / mortgage payload for
  retail themes. `systemPromptFlavor` is consumed then. Started only after
  Phase 1 is tested.

---

## Section 5 — Sequencing, regression safety, success criteria

### Incremental sequence (each step independently shippable)

1. **Schema v2 + server** — define schema; migrate `banking.json` +
   `retail.json` to v2 (Best Buy identity/colors/strings land here); add
   `getActiveManifest()` + validation; `GET /api/config/vertical` returns v2
   additively. No client change yet.
2. **`ThemeProvider`/`useTheme()`** — new context; collapse
   `VerticalContext` + `IndustryBrandingContext`; `IndustryBrandingContext`
   becomes a shim. App still renders identically (banking active).
3. **Migrate banking's hardcoded strings** — `DashboardHeader`, document
   title, `BankingAgent` greeting read `useTheme()`. **Regression checkpoint:
   banking renders byte-identically to today, now data-driven.** This is the
   proof the manifest works.
4. **Chips** — labels from `manifest.dashboard.chips`; routing keys unchanged.
   Verified against the skip-proof chip pipeline suite.
5. **Dashboard manifest-driven** — extract `<RetailDashboard>`, branch on
   `dashboard.kind`, read `mockData` from manifest. Delete `retailMockData.js`.
6. **Retire `ff_retail_mode`** — delete flag, `RetailModeBanner`,
   `isRetail` branches; repoint Config UI picker to `/api/config/vertical`.
7. **Theme picker surfaces** — relax `PUT /api/config/vertical` to any
   authenticated session; build `<ThemePicker>` (one component, `toolbar` +
   `config` variants); mount `variant="toolbar"` in the `UserDashboard`
   toolbar row and `variant="config"` in the Config UI (replacing the
   step-6 repoint's bespoke control).
8. **Cleanup** — delete dead `industryPresets` retail/duplicate color defs once
   unreferenced; remove the `IndustryBrandingContext` shim.

### Regression safety (REGRESSION_PLAN discipline)

- §1 pre-read required before touching `configStore.js`, `UserDashboard.js`,
  `Config.js`, `BankingAgent.js`, `BankingChips.jsx`,
  `routes/verticalConfig.js`. `oauth*.js` is **not touched** — the manifest
  carries no auth.
- The `PUT /api/config/vertical` auth relaxation (admin → any authenticated
  session) is a **deliberate, demo-scoped** change, not a regression: it is
  bounded by the presentation-only manifest constraint and recorded in the
  REGRESSION_PLAN §1 theme-contract note with that rationale.
- State-what-I-won't-break per protected file; minimal diff; no emoji except
  the three permitted (`⚠️ ✅ ❌`); `cd banking_api_ui && npm run build` exit 0
  after every UI step; targeted `npm test` for `verticalConfigService` +
  configStore; run the skip-proof chip pipeline suite after step 4.
- New reusable theme contract → REGRESSION_PLAN §1 table note. Any defect
  fixed en route → §4 Bug Fix Log entry.

### Success criteria (Phase 1 "done")

- Admin switches active theme in Config UI → whole app reskins to Best Buy
  (blue/yellow), dashboard shows product/cart/orders from manifest, agent
  greets as "Shopping Assistant", document/header title update — on one page
  reload, server-authoritative.
- A customer-persona (non-admin) logged-in user can switch theme from the
  `<ThemePicker>` in the dashboard toolbar near the top, and the whole app
  reskins server-wide on reload — without visiting the admin Config page.
- Switching back to banking fully restores banking UI.
- **Regression proof:** banking with no manifest changes renders
  byte-identically to today (visual + DOM string check on
  `DashboardHeader`, title, greeting, chips).
- **Reusability proof:** a throwaway 3rd test manifest (one JSON + placeholder
  assets, **zero component/CSS edits**) reskins the app — validated as an
  acceptance check, then removed.
- OAuth login, MCP tool call, RFC 8693 token chain, Authorize, HITL behave
  **identically** in both themes (verified via token chain UI +
  `/tmp/bank-api-server.log`).
- Chip→routing→MCP pipeline unchanged (only labels themed) — skip-proof chip
  pipeline suite green.
- `ff_retail_mode`, `RetailModeBanner`, `retailMockData.js`, `isRetail`
  branches, duplicate retail color defs no longer exist.
- UI build exits 0; vertical/config test suites green.

---

## Risks

- **Largest surface in step 3 + 6** (banking string migration; flag retirement)
  touch REGRESSION_PLAN §1 files. Mitigation: incremental steps, byte-identical
  banking checkpoint at step 3, build+test gate per step.
- **Chip label/key split** must not leak into routing. Mitigation: skip-proof
  chip pipeline suite is a hard gate after step 4.
- **CSS var reconciliation** (two var families merged) could shift banking
  colors subtly. Mitigation: banking.json v2 cssVars are transcribed from the
  current effective `:root` + `bx_finance` preset values; step 3 visual diff.
- **Two contexts collapsing** may have hidden consumers. Mitigation: shim
  keeps old imports working until call sites migrate; shim removed last.
- **Relaxed `PUT /api/config/vertical` auth** — any authenticated user can
  change the live theme for everyone. Accepted: demo-scoped, presentation-only
  (no auth/data/pipeline impact per Section 2 constraint), fully reversible,
  and explicitly documented in REGRESSION_PLAN §1 so a future reviewer does
  not "fix" it as an authz regression. Not mitigated further — it is the
  intended behavior for the customer-persona demo flow.
