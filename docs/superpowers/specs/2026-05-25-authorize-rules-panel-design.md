# Authorize Rules Panel — Design Spec

**Date:** 2026-05-25  
**Status:** Approved  
**Author:** Curtis Muir

---

## Overview

Add an `AuthorizeRulesPanel` component that lets users browse the active authorization rules and test them against the running policy engine. The panel mirrors the existing MCP tools panel pattern (`WebMcpPanel.js`) — a two-column layout with a rule list on the left and rule detail + test form on the right.

---

## Goals

- Give users a way to see what authorization rules are in effect without navigating to admin config pages
- Let users (and admins) test a transaction against the active engine inline and see the decision
- Be educational: explain what each rule does in plain English, not just raw thresholds
- Reuse existing BFF endpoints — no new backend routes

---

## Non-goals

- Editing rules (that stays in `AuthorizeConfigPage`)
- Showing raw PingOne policy JSON or decision endpoint configuration
- Replacing `AuthzTestPage` (that page remains for dedicated testing)

---

## Component: `AuthorizeRulesPanel.jsx`

### Layout

Two-column panel:

```
┌─────────────────────┬──────────────────────────────────────────┐
│  Rule list          │  Rule detail                             │
│  ─────────────────  │  ─────────────────────────────────────── │
│  Transaction Rules  │  [Title]                                 │
│  • Confirm threshold│  [Plain-English description]             │
│  • Step-up threshold│                                          │
│  • Deny threshold   │  [Engine] [Outcome] [Threshold] [Scope]  │
│  • Transfer type    │                                          │
│  ─────────────────  │  ┌─ Test this rule ──────────────────┐   │
│  MCP Tool Rules     │  │ Amount  Type  ACR                 │   │
│  • MCP First Tool   │  │ [___]   [___] [___]               │   │
│  • Denied tools     │  │ [Run evaluation]  ✅ CONSENT      │   │
│  • HITL tools       │  └───────────────────────────────────┘   │
│                     │                                          │
│                     │  [Engine status note]                    │
└─────────────────────┴──────────────────────────────────────────┘
```

### Rule List (left column)

Rules are grouped into two sections:

**Transaction Rules**
| Rule | Description | Badge |
|---|---|---|
| Confirm threshold | Transactions ≥ `confirm_threshold_usd` require consent | CONSENT |
| Step-up threshold | Transactions ≥ `stepup_threshold_usd` require MFA | STEP-UP |
| Deny threshold | Transactions > `deny_threshold_usd` are hard-denied | DENY |
| Transfer type rule | Transfers always require consent (from `SIMULATED_AUTHORIZE_CONSENT_TYPES`) | CONSENT |
| Step-up type rule | Listed types always require MFA (from `SIMULATED_AUTHORIZE_STEPUP_TYPES`); hidden if empty | STEP-UP |

**MCP Tool Rules**
| Rule | Description | Badge |
|---|---|---|
| MCP First Tool Gate | Policy evaluated on first MCP tool call per session; shown only when `ff_authorize_mcp_first_tool` is enabled | GATE |
| Denied tools | Tools in `SIMULATED_MCP_DENY_TOOLS`; shows count + list | DENY |
| HITL tools | Tools in `SIMULATED_MCP_HITL_TOOLS`; shows count + list | HITL |

Selecting a rule highlights it with an indigo left-border and populates the right column. Default selection: first rule in the list.

**Auth-aware data fetching:** `GET /api/admin/authorize/config` is admin-only. On the user dashboard, if this call returns 401/403, the component falls back to showing engine status only (from `GET /api/authorize/evaluation-status`, which requires only a valid session). In this fallback state: the rule list is hidden, a note reads "Sign in as an admin to see rule details", and the test form is still shown using defaults.

### Badge colours

| Badge | Background | Text |
|---|---|---|
| CONSENT | green-100 | green-800 |
| STEP-UP | yellow-100 | yellow-800 |
| DENY | red-100 | red-800 |
| GATE | blue-100 | blue-800 |
| HITL | purple-100 | purple-800 |
| PERMIT | green-100 | green-800 |

### Rule Detail (right column)

**Stat chips** — 4 chips shown for the selected rule:

| Chip | Content |
|---|---|
| Engine | "Simulated" (green) or "PingOne" (blue) |
| Outcome | The badge outcome for this rule (coloured) |
| Threshold / Value | Dollar amount or type list (or "—" for MCP rules) |
| Scope | "All types", specific type name, or tool count |

**Test form** — always shown, fields:
- Amount (USD) — number input, default empty
- Transaction type — text input: `deposit`, `withdrawal`, `transfer`
- ACR — text input, optional (for step-up testing)

On submit: calls `POST /api/authorize/test-evaluate` with `{ amount, type, acr }`. Displays result badge inline: PERMIT / CONSENT / STEP-UP / DENY with a one-line explanation of which rule fired.

For MCP tool rules (Denied tools, HITL tools): the test form is replaced with a tool name input and the result shows whether that tool would be denied/HITL/permitted.

**Engine note** — always shown at the bottom:
- Simulated active: "Active engine: Simulated. Configure a PingOne Authorize decision endpoint in the Authorize tab to switch to live policy evaluation."
- PingOne active: "Active engine: PingOne Authorize. Test evaluations call the live decision endpoint."
- PingOne misconfigured: "PingOne Authorize is enabled but not fully configured — falling back to simulated engine."

---

## Data Sources

All data comes from **existing BFF endpoints** — no new routes required.

| Data | Endpoint | Used for |
|---|---|---|
| Rule configuration | `GET /api/admin/authorize/config` | Building rule cards (thresholds, tool lists, flags) |
| Engine status | `GET /api/authorize/evaluation-status` | Engine chip + engine note |
| Test evaluation | `POST /api/authorize/test-evaluate` | Run button result |

The component fetches config + engine status on mount. Test evaluation is triggered on demand.

---

## Loading & Error States

| State | Behaviour |
|---|---|
| Config loading | Left column shows 5 skeleton rule cards; right column blank |
| Config fetch fails | Left column shows inline error message; test form disabled with explanation |
| Test in-flight | Run button shows spinner; result area shows "Evaluating…" |
| Test eval fails (network / 500) | Result area shows ❌ with error message |
| PingOne not configured | Engine note explains simulated mode; test form still works |
| Empty MCP deny list | "Denied tools" card shows "0 tools — none configured" in muted style; still selectable |
| Empty MCP HITL list | Same pattern as deny list |
| `ff_authorize_mcp_first_tool` disabled | MCP First Tool Gate card hidden from list |

---

## Placement

### `/dashboard` (user dashboard)

- Rendered below the main banking content in `UserDashboard.js`
- Gated by feature flag `ff_authorize_rules_panel` (default: `false`)
- Visible to all authenticated users when flag is on
- Both read and test functionality available (test endpoint has no auth requirement beyond session cookie)

### `/configure → Authorize tab` (admin)

- Rendered in `UnifiedConfigurationPage.tsx` inside the `authorize` tab, **above** the existing `AuthorizeConfigPage`
- Always visible to admins (not flag-gated in this placement)
- Gives admins the browse+test view immediately before the configuration controls

---

## Files Changed

### New
| File | Description |
|---|---|
| `demo_api_ui/src/components/AuthorizeRulesPanel.jsx` | The new panel component |

### Modified
| File | Change |
|---|---|
| `demo_api_ui/src/components/UserDashboard.js` | Import `AuthorizeRulesPanel`; render below banking content, gated by `ff_authorize_rules_panel` flag fetched from config |
| `demo_api_ui/src/components/Configuration/UnifiedConfigurationPage.tsx` | Import `AuthorizeRulesPanel`; render above `AuthorizeConfigPage` in the `authorize` tab section |
| `demo_api_server/services/configStore.js` | Add `ff_authorize_rules_panel` to `FIELD_DEFS` with `default: 'false'`, `type: 'boolean'`, appropriate label/description |

---

## Feature Flag

**Key:** `ff_authorize_rules_panel`  
**Default:** `false`  
**Type:** boolean  
**Description:** "Show the Authorize Rules Panel on the user dashboard"  
**Controlled by:** `/configure → Feature Flags` tab (via existing feature flags UI)

---

## Regression Considerations

- No new BFF routes — existing endpoints are called with existing auth patterns
- `POST /api/authorize/test-evaluate` is already auth-free (session cookie only), consistent with `AuthzTestPage` usage
- `GET /api/admin/authorize/config` is admin-only — on the dashboard, if the user lacks admin role, the panel should gracefully fall back: fetch fails → show engine status only (from `GET /api/authorize/evaluation-status` which is also auth-free), hide the config-derived rule details
- Dashboard placement is behind a feature flag — no impact to existing users until flag is enabled
- The `UnifiedConfigurationPage` Authorize tab is unchanged in structure; the panel is prepended above existing content

---

## Mockups

Stored in `.superpowers/brainstorm/` (see session files):
- `approaches.html` — 3 structural approaches considered
- `layout.html` — initial dark-theme layout sketch
- `layout-v2.html` — approved white-background layout
