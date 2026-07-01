# Vertical Ops Redesign — Design Spec

**Date:** 2026-06-29
**Status:** Approved for planning
**Scope:** Redesign the 5 Vertical Ops pages (`/admin/banking`, `/admin/healthcare`, `/admin/retail`, `/admin/sporting-goods`, `/admin/workforce`) into themed, purpose-built operator consoles, and add a new read-only **Ops Assistant** agent.

---

## 1. Problem

All five Vertical Ops pages render from one shared 3-column template (token-chain panel | embedded customer agent | ops tools), so they look identical to each other and visually blur into the `/admin` system dashboard. The embedded customer agent ("Super Banking Assistant") is also miswired for this context — clicking "Check balance" returns the LLM's terse "Missing Input" because the `get_account_balance` tool requires an `account_id` that isn't supplied.

Goal: make each vertical **visually distinct** and **genuinely useful** as an operator tool, and give the operator a focused assistant for asking about the customer in front of them.

## 2. Goals / Non-Goals

**Goals**
- One reusable console framework, configured per vertical (distinct theme + record types + actions).
- Direction B (branded Customer-360) layout with Direction C's per-record activity timeline in a slide-over drawer.
- Demote the existing customer agent + token-chain to a single "Ask the assistant" affordance.
- Add a new **read-only Ops Assistant** scoped to the currently looked-up customer.
- Reuse existing backend endpoints for lookup + actions; reuse the existing LLM provider abstraction.

**Non-Goals**
- No changes to the `/admin` system dashboard.
- Ops Assistant does NOT take actions or write data (read-only Q&A only).
- Ops Assistant is NOT cross-customer / cross-vertical (current customer only).
- No change to the customer-facing agent on the `/agent` page.
- Not fixing the customer agent's "Missing Input" behavior here (separate follow-up; noted in §8).

## 3. Users & Use Cases

**User:** an operator (now any authenticated user — admin gate already removed) working one customer's records in one vertical.

**Primary flows**
1. Look up a customer/account → see a themed Customer-360 of their records grouped by category.
2. Click a record → slide-over drawer with detail, actions, and an activity timeline.
3. Take an action (cancel/pay/refill/approve/seed-charge…) from a card row or the drawer.
4. Ask the Ops Assistant about the current customer ("summarize open items", "why is this flagged?").

## 4. UX Design

### 4.1 Layout (Direction B — Customer 360)
- **Branded hero:** vertical accent gradient, vertical icon + name, and a prominent lookup input (customer/account by name, email, or id).
- **Customer summary card:** floats over the hero — avatar/initials, name, sub-line, and 3 key stats (vertical-specific, e.g. Banking: total balance / open accounts / risk flags).
- **Category card grid:** responsive 2-col grid; one card per record category (Accounts, Transactions… / Appointments, Medications, Billing… etc.). Each card header shows icon + label + count. Each row shows title, sub-detail, a status badge (ok/warn/muted tone), and inline action buttons.

### 4.2 Record drawer (Direction C — activity timeline)
- Clicking a record row opens a right slide-over (scrim + drawer).
- Contents: branded header (category + title), key-value detail rows, action buttons (primary + ghost), an "Ask the assistant about this record" bar, and an **activity timeline** of events for that record.
- Inline action buttons on a card row act directly (with confirm); clicking elsewhere on the row opens the drawer.

### 4.3 Theming
- Per-vertical theme tokens: `--accent`, `--accent2` (gradient), `--tint` (subtle background), plus icon and display name.
- Source theme from the existing per-vertical branding/manifest system where available; otherwise a small static theme map in the vertical config.
- Result: Banking (blue), Healthcare (teal), Retail (orange), Sporting Goods (green), Workforce (purple) read as clearly different surfaces.

### 4.4 Reference mockups
Throwaway HTML mockups produced during brainstorming (scratchpad `ops-mockups/`): `index.html` (chooser), `a-command-console.html`, `b-customer360.html` (the chosen direction, with the merged activity drawer), `c-workbench.html`. The chosen target is **`b-customer360.html`**.

## 5. Architecture

### 5.1 Frontend
- **New reusable component:** `VerticalOpsConsole` — owns layout, lookup, summary card, category grid, record drawer, theming, and the Ops Assistant chat. Renders entirely from a per-vertical **config object**.
- **Per-vertical config** (`{ id, name, icon, theme, lookup endpoint, categories[], statMappers, actionMappers }`) where each category maps a lookup-response slice to a card and each action maps a button to an existing write endpoint.
- The five page components (`BankingAdminOps.js`, `HealthcareAdminOps.js`, `RetailAdminOps.js`, `SportingGoodsAdminOps.js`, `WorkforceAdminOps.js`) become thin wrappers that pass their config to `VerticalOpsConsole`. The old shared 3-column template + token-chain panel are removed.
- Each unit is independently testable: the console renders from config (no network), config objects are pure data, the Ops Assistant chat is a self-contained child.

### 5.2 Backend — data & actions (reuse existing)
- **Lookup:** existing `GET /api/admin/<vertical>/lookup` (+ `/users`). Banking uses `/api/admin/banking/lookup` in `routes/admin.js`; the other four use `routes/adminVerticals.js`. (All already open to any authenticated user.)
- **Actions:** existing write endpoints (e.g. `POST /api/admin/healthcare/appointments/:id/cancel`, `/bills/:id/pay`, `/medications/:id/refill`; retail/sporting/workforce equivalents; banking seed-charges). No new action endpoints.

### 5.3 Backend — Ops Assistant (new, read-only)

**Framework decision: reuse the existing in-house agent pattern — no new agent framework / dependency.** The project already has a consistent, framework-free way to build agents (used by `adminAgentService` and `demoAgentLangGraphService`):

- An agent is a **service** that returns a standard response envelope: `{ reply, success, toolsCalled, inputTokens, outputTokens, tokenEvents, agentConfigured, error? }`.
- It is assembled from **per-agent config** — tool schemas, system prompt, and canned responses (cf. `config/admin/{tools,systemPrompt,responses}`).
- It runs a custom reason/tool loop via `agentReasoningClient.runReasonLoop` over a provider resolved by `llmProviderResolver` (Helix / Anthropic / LM Studio / Ollama).

This template is also the basis for future agents the team plans to build, so the Ops Assistant follows it rather than introducing Vercel AI SDK / Mastra / LangGraph add-ons. (Researched alternatives — Vercel AI SDK, PocketFlow.js, Mastra — were rejected in favor of in-repo consistency.)

**Ops Assistant implementation:**

- **New service:** `opsAssistantService.processOpsMessage({ vertical, customerId | customerQuery, message, history?, req })`.
- **New endpoint:** `POST /api/admin/<vertical>/ops-assistant` (mounted under `authenticateToken`), thin wrapper calling the service — mirrors `adminAgentRoutes.js` `POST /message`.
- **Per-vertical config:** `config/ops/<vertical>/systemPrompt.js` (or one shared prompt parameterized by vertical). **No tool schemas** (read-only) — so the reason loop performs a single grounded completion with no tool-call path.
- **Server-side grounding:** the service resolves the customer and fetches their vertical records by reusing the same lookup logic that backs `/lookup` — the assistant only ever receives the **current customer's** data. The client never supplies the record payload.
- **Prompt:** frames it as the `{Vertical}` Ops Assistant for an operator; injects the fetched records as context; instructs answer/summarize only, never invent, never imply actions were taken.
- **LLM call:** `llmProviderResolver.resolveLlmProvider` → configured provider. With no tools passed it is structurally read-only. When the provider is Anthropic, default to the latest Claude model per project convention.
- **Output:** the standard envelope (`reply` + token/usage metadata). Streaming optional; start non-streaming.
- **Guardrails:** read-only by construction (no tool schemas, no write calls). Cap injected record size; cap message length; scope strictly to the resolved customer.

### 5.4 Data flow
```
Operator → lookup input → GET /api/admin/<v>/lookup → category grid + summary
Operator → record row → drawer (detail + timeline) → action button → existing POST write endpoint
Operator → Ops Assistant question → POST /api/admin/<v>/ops-assistant
        → server re-fetches current customer records → llmProviderResolver → answer
```

## 6. Activity Timeline — open question (RESOLVED DEFAULT)
The timeline is the one genuinely new data need. **Default decision:** derive it from the existing activity log filtered to the current customer/record where such events exist, and fall back to a lightweight derived history (created / last-status-change / viewed) when no log entries exist. Confirm during planning whether a richer per-record event store is warranted; default is the log-backed + derived approach (no new persistence).

## 7. Error Handling
- Lookup miss → friendly "no customer found" empty state in the hero/summary area.
- Action failure (non-2xx) → toast with the server error; row state unchanged.
- Ops Assistant: provider unavailable → inline notice ("assistant offline") instead of a broken bubble; over-long input → client-side guard; never surface a raw "Missing Input"-style model artifact (read-only Q&A has no required tool args).

## 8. Follow-ups (out of scope here)
- Fix the customer-facing "Super Banking Assistant" balance flow (auto-list accounts or ask a clarifying question instead of "Missing Input").
- Optional: Ops Assistant action-taking mode (tools + confirm) — deferred.

## 9. Success Criteria
- Each vertical ops page is visibly distinct (theme + record types) and clearly different from `/admin`.
- Lookup → category grid → record drawer → action all work against existing endpoints.
- Ops Assistant answers questions about the current customer using only their fetched data, takes no actions, and never returns a "Missing Input"-style artifact.
- Five page components share one `VerticalOpsConsole`; adding/altering a vertical is a config change, not a new layout.
