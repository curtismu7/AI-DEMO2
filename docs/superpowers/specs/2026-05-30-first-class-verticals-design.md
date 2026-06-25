# First-Class Verticals — Design

**Date:** 2026-05-30
**Status:** Approved design, pending implementation plan
**Branch context:** follows `fix/heuristics-vertical-aware`

---

## Problem

Today "banking" is the substrate, and every other vertical (retail, healthcare,
sporting-goods, workforce) is a **translation layer** that maps its own vocabulary onto
banking actions and banking data:

- `THEME_VOCAB[vertical]` regexes map themed phrases → banking actions (`accounts`,
  `balance`, `transactions`, `transfer`).
- `HELIX_AGENT_DIRECTIVES.themes[vertical]` instructs the LLM to emit banking action
  shapes with themed interpretation.
- `_buildVerticalToolDescription` relabels the four banking tools per vertical.
- `reseedAllCustomersForVertical()` wipes and **relabels** the same banking objects
  (accounts/transactions) whenever the active vertical changes.

The unreliability is intrinsic to this model: when the active-vertical context is wrong,
a phrase doesn't match `THEME_VOCAB`, or the LLM/heuristic guesses, the system **falls
back to banking responses**. A "patient record" is really a relabeled bank account; an
"appointment" is really a relabeled transaction. The wrong response is a translation
failure.

## Goal

Make each vertical a **first-class, self-contained slice** — its own prompts, chips,
authorization rules, MCP tools, data schema, and result rendering — so that **nothing
translates anymore**. Banking becomes one peer vertical among equals. The wrong response
becomes impossible by construction, because there is no banking substrate to fall back to.

Scope decisions (confirmed with user):
- **Full independence including data** — each vertical owns its own data schema, not a
  relabeled banking store.
- **Plugin module model** — each vertical is a self-contained folder the shared code
  discovers and mounts (matching the repo's existing "scan a directory" pattern).
- **All 5 verticals** migrate (banking, retail, healthcare, sporting-goods, workforce).
- **Per-vertical authorization** — each vertical declares its own step-up/HITL/consent
  rules; no global threshold.
- **Novel actions allowed** — a vertical can define actions banking doesn't have
  (e.g. healthcare `book_appointment`); the action vocabulary is owned by each vertical.
- **Tool handlers live in the BFF** (alongside per-vertical data).
- Scopes stay **generic** (`read`/`write`/`transfer`) — no per-vertical scope changes.

---

## Section 1 — Architecture & the Plugin Contract

### The inversion

The shared infrastructure (agent loop, gateway, token custody, sessions, scopes) is made
**vertical-agnostic**: it knows nothing about accounts/transfers/balances. It only knows
"the active vertical exposes these tool names; dispatch to its `executeTool`." Each
vertical owns its whole stack for its own slice.

### The vertical package

```
demo_api_server/verticals/<id>/
  manifest.json     // identity, theme, terminology, chips, hero, llmChipGroups,
                    //   + NEW: per-tool result render descriptors
  seed.json         // initial data objects in THIS vertical's own schema
  index.js          // the plugin contract (below)
```

### The contract (`index.js` exports — every vertical implements all of it)

```
getManifest()                   → manifest.json (identity/theme/terminology/chips/render descriptors)
getTools()                      → [{ name, description, inputSchema, scopes, authz }]
                                    names are THIS vertical's own (book_appointment, create_transfer, …)
getHeuristics()                 → [{ re, action }]   action = one of this vertical's tool names
getSystemPrompt(ctx)            → string             the LLM directive for this vertical (no translation)
getDataStore()                  → read/write methods over seed.json's schema
executeTool(name, params, ctx)  → { result, render } operates on getDataStore(); applies authz
getAuthz()                      → { <toolName>: { stepUp?, hitl?, threshold?, consent? } }
```

### What the shared layer becomes

- **Discovery:** scan `verticals/`, load each `index.js` — same pattern as today's
  manifest scan.
- **Agent loop:** resolve active vertical → load plugin → use `getTools()` /
  `getSystemPrompt()` / `getHeuristics()` → dispatch through `executeTool()`. Never
  enumerates action names.
- **Gateway:** routes by "active vertical + tool name → that vertical's handler",
  replacing the hardcoded `routeTool` / `APIKEY_BACKEND_ROUTES` maps.
- **Token custody / scopes / sessions:** unchanged, stay generic.

**Why this kills the bug:** a healthcare phrase routes to a healthcare tool that reads
healthcare data and returns a healthcare result. There is no "fall back to banking" path
because there is no banking underneath.

### Invariant — single source, no banking fallback (hard requirement)

**Everything the user sees or sends in the runtime path resolves from the active
vertical's plugin — never from banking, never from a default vertical, never from a
mapping table.** This applies to all of:

- **Agent display** — persona, greeting, chip labels, hero stats, result panels, tool
  names shown in the UI.
- **Requests** — heuristic routing, LLM system prompt, tool schemas sent to the model,
  tool dispatch.
- **Responses** — tool results, result render descriptors, reply phrasing/terminology.
- **Data** — every object read/written comes from the active vertical's `getDataStore()`.
- **Authorization** — gates come from the active vertical's `getAuthz()`.

There is **no** silent fallback to banking content anywhere in the runtime path. If the
active vertical's plugin cannot resolve a value, that is an error surfaced explicitly
(logged, and a clear UI/agent error) — **not** a quiet substitution of banking defaults.
The "no-translation assertion" test (Section 4) enforces this by proving the shared layer
contains no banking action names; a companion test asserts no code path substitutes a
default/banking manifest when the active vertical is set.

The **only** permitted fallback is the migration-period one below, and it resolves to the
vertical's **own** manifest-only behavior — never to banking content.

---

## Section 2 — Data Ownership & Migration

### The data inversion

Today one `DataStore` (users/accounts/transactions Maps) in `demo_api_server/data/store.js`
holds everything, and `reseedAllCustomersForVertical()` wipes/relabels the same banking
objects on vertical switch (the reseed-on-mismatch block in `accounts.js` lines 238–324 is
the data-layer symptom of the translation problem).

After this change:

```
SHARED (stays in demo_api_server/data/):
  users, sessions, identity   ← OAuth subjects, demo users (demoUser/demoAdmin)
                                 (shared because PingOne identities are shared across verticals)

PER-VERTICAL (moves into verticals/<id>/):
  seed.json                   ← that vertical's domain objects (keyed by userId)
  getDataStore()              ← read/write over those objects
```

A healthcare patient record has `provider`, `coverage`, `claims`, `appointments` — real
fields, not a relabeled account.

### Per-vertical tool/data shape (refine exact names during planning)

| Vertical | Tools (own action names) | Data schema |
|---|---|---|
| banking | `get_my_accounts`, `create_transfer`, `create_deposit`, `create_withdrawal`, `show_mortgage` | accounts, transactions |
| retail | `list_orders`, `order_status`, `checkout`, `rewards_balance`, `show_large_purchase` | orders, rewards, shipments |
| healthcare | `view_records`, `book_appointment`, `view_coverage`, `release_records`, `show_health_record` | patient records, appointments, claims |
| sporting-goods | `list_gear`, `gear_order_status`, `checkout`, `show_gear_order` | gear orders, inventory |
| workforce | `view_benefits`, `submit_expense`, `pto_balance`, `show_expense_report` | benefits, expenses, PTO |

### Migration order

**One vertical at a time, banking last:**

1. **healthcare first** as the reference implementation (most novel actions — proves the
   novel-action path end-to-end).
2. **retail, sporting-goods, workforce** next, applying the proven pattern.
3. **banking last** — riskiest; it's the current substrate and touches
   `REGRESSION_PLAN.md` §1 files.

During migration the shared layer supports **both** old-style (manifest-only) and new-style
(full plugin) verticals: a vertical without an `index.js` runs in its **own** manifest-only
mode (today's per-vertical behavior for *that* vertical), so the app never breaks
mid-migration. This is the only permitted fallback, and it never substitutes banking content
for a non-banking vertical — it just means that vertical hasn't gained its full plugin yet.
A vertical is "done" only when it no longer relies on this mode and every display/request/
response value for it comes from its `index.js`.

---

## Section 3 — Per-Vertical Authorization & Novel-Action UI Rendering

### Authorization is per-vertical

Each vertical's `getAuthz()` declares its own gates; `executeTool()` enforces them before
running the handler. The shared HITL/step-up machinery (428 enforcement, consent challenge)
stays generic — it *reads* each vertical's authz declaration instead of hardcoding banking
thresholds.

```jsonc
// healthcare authz
{ "release_records":  { "stepUp": true, "consent": true },
  "book_appointment": { },
  "view_coverage":    { } }

// banking authz
{ "create_transfer":  { "hitl": true, "threshold": 500 },
  "create_deposit":   { "hitl": true, "threshold": 500 } }
```

### Novel-action UI rendering — descriptor-driven, with text fallback

The UI's `ResultsPanel` is **already** a type-based renderer
(`accounts`/`transactions`/`balance`/`confirm`/`text` in `BankingAgent.js`). We extend it
with generic descriptor-driven types — **no per-vertical React, no dynamic imports.**

`executeTool` returns `{ result, render }`; `render` comes from the manifest's per-tool
descriptor:

```jsonc
// healthcare manifest — render descriptors per tool
"render": {
  "book_appointment": {
    "type": "card",
    "title": "Appointment Confirmed",
    "fields": [
      { "label": "Provider", "path": "provider" },
      { "label": "Date",     "path": "when",   "format": "date" },
      { "label": "Location", "path": "clinic" }
    ]
  },
  "view_records": { "type": "table", "columns": [ /* … */ ] }
}
```

One new UI component, `<VerticalResult descriptor data />`, switches on `type`:
- `card` / `fieldList` → reuses existing field-display primitives
- `table` → generalizes the existing `AccountsTable`/`TransactionsTable` table core to
  arbitrary columns
- **no descriptor present → falls back to formatted text in the agent reply** (author
  ships a working tool first, adds the pretty descriptor later)

Existing `accounts`/`transactions`/`balance`/`confirm` panel types stay as-is (banking's
migration is low-risk). `format` values reuse the existing `FormatEnum`
(`money`/`count`/`date`/`text`/`percent`).

---

## Section 4 — Open Impact Areas, Testing & Deletions

### Open Impact Areas (audit during planning — flagged, not solved here)

| Area | Why it may be impacted | Audit during planning |
|---|---|---|
| `pingone:bootstrap` | Provisions apps/resources/scopes. Scopes generic → likely no change. | Confirm no per-vertical featureScope (`largepurchase:read`, etc.) is assumed; fold into generic `read` if so. |
| `npm run setup:fresh` | Chains `data:import` → bootstrap. New per-vertical `seed.json` must land for fresh install demo data. | Ensure fresh install seeds each vertical's own store. |
| `data:import` / `data:export` | Today bundles one banking `runtimeData.json`. Per-vertical stores change what's bundled. | Decide: bundle per-vertical data, or regenerate from `seed.json` on import. |
| `run.sh` | Handlers move into BFF → no new processes/ports. | Decide fate of `demo_mortgage_service` (serves feature pages today). |
| `REGRESSION_PLAN.md` §1 | Banking files (`accounts.js`, store, OAuth) listed. Banking-last migration touches them. | State what won't break before editing; add §4 entries. |
| `demo_mcp_server` | Banking tools live there today. Handlers move to BFF → MCP server role narrows. | Confirm token-exchange path intact; decide MCP server's remaining role. |

### Testing strategy (repo's two-tier pattern)

- **Per-vertical contract test** — every `index.js` satisfies the plugin interface (all
  methods present, `getTools()` shapes valid, heuristic actions ∈ tool names, render
  descriptors reference real result paths). One test, runs against every vertical folder.
- **Regression + integration pairs** for shared dispatch (active vertical → correct plugin
  → correct tool), mirroring `hitlRoute.regression`/`.integration`.
- **No-translation assertion** — a test proving the shared layer contains no banking action
  names (guards against regression back into the substrate model).
- **No-fallback assertion** — with a non-banking vertical active, a test proving the agent
  display, request (heuristic + prompt + tool schemas), response, and data all resolve from
  that vertical's plugin and never from banking/default content; an unresolved value surfaces
  as an explicit error, not a silent substitution.
- Existing banking suites stay green through banking-last migration; `App.structure` after
  any `App.js` touch.

### Deletion list (the measure of success)

- `THEME_VOCAB` + `parseTheme` (`nlIntentParser.js`)
- `THEME_OVERRIDES` translation prompt + `buildSystem` theme-append (`geminiNlIntent.js`)
- `_buildVerticalToolDescription` switch + `buildToolSchemasForAgentForVertical`
  (`demoAgentLangGraphService.js`)
- `reseedAllCustomersForVertical` + vertical-mismatch reprovisioning block (`store.js`,
  `accounts.js`) + `SEED_PROFILES` relabeling
- `routeTool` / `APIKEY_TOOLS` / `APIKEY_BACKEND_ROUTES` and friends (`router.ts`) →
  replaced by active-vertical+tool lookup
- `HELIX_AGENT_DIRECTIVES.json` `themes` block (per-vertical prompts move into each folder)

### Success criteria

1. Each of the 5 verticals is a self-contained folder; adding a vertical = adding a folder,
   zero edits to shared files.
2. The shared layer contains no banking-specific action names (enforced by test).
3. A vertical's wrong response is impossible-by-construction — no translation path exists.
4. **Every runtime value — agent display, requests, responses, data, authz — for the active
   vertical resolves from its plugin. No path substitutes banking or default-vertical
   content; missing values surface as explicit errors, not silent fallbacks** (enforced by
   the no-fallback test).
5. All existing banking flows stay green; UI builds clean; novel actions (e.g.
   `book_appointment`) render via descriptor.
