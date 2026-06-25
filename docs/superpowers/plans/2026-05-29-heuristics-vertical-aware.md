# Plan: Make ALL agent paths vertical-aware (heuristics gap closure)

**Absolute requirement (user):** Every agent path — heuristics, Helix, and every LLM (Claude/ChatGPT/Ollama) — MUST work with ALL verticals and never emit banking-specific content when a non-banking vertical is active.

**Root cause (evidence-backed):** The verticals redesign landed for two of three layers:
- ✅ UI render layer (`vertical-native-responses` plan) — `formatResult`/`AccountsTable`/`MessageContent`/`buildResultsPanelTitle` theme via `terminology`.
- ✅ LLM layer (`vertical-agent-tools-and-prompts` plan) — `systemPromptFlavor` + per-vertical tool descriptions forwarded to the reason loop / LangChain.
- ❌ **Heuristic NL layer (`nlIntentParser.js`) was never in scope of either plan.** It still:
  1. `buildCatalogMessage()` — hardcoded banking list, no vertical param (every no-match/greeting in heuristics mode shows "checking/savings/mortgage…").
  2. `parseTheme`/`THEME_VOCAB` — thin hand-maintained shim; missing vocab for many vertical phrases; always returns `kind:'banking'`; not derived from the manifest.
  3. The heuristic reply builder in `demoAgentLangGraphService.js` (lines ~111–181) hardcodes headings ("Here are your accounts", "Your balances", "Recent transactions") with no terminology.

The active vertical resolves correctly (`parseHeuristic(msg, resolver.activeId())` at demoAgentLangGraphService.js:653 receives `sporting-goods`). Stored account data is correct (Pro Member/Elite Member). The leak is purely in heuristic-layer text generation.

## Step 0 — Live instrumentation (confirm exact break before editing)
- Add a temporary debug log in the heuristic accounts branch (demoAgentLangGraphService.js ~140) logging the active vertical, the raw tool result, and the final `reply` string.
- Hit "show my accounts" / "My Gear" once in the live app (sporting-goods), capture via banking-dev logs_grep.
- Confirm whether the leak is (a) reply heading text, (b) account row content from the tool, or (c) the no-match catalog. Remove the debug log after. **Do not edit logic until this confirms the exact site.**

## Step 1 — `buildCatalogMessage(vertical)` reads the active manifest
- Change signature to accept the active vertical id (or manifest).
- Derive the capability list from the manifest's `terminology` + `chips` (e.g. "My Gear", "Reward Points", "Purchase History", "Place Order") instead of the hardcoded banking list.
- Banking (no terminology) keeps the current list exactly (regression-safe default).
- Update the two call sites in `parseHeuristic` (no-match return) to pass the vertical.

## Step 2 — Make `parseTheme` manifest-driven (not a hand-maintained shim)
- Keep regex routing, but source the vocabulary from the active manifest's terminology/chips so new verticals work without editing `THEME_VOCAB`.
- Ensure every vertical's chip phrases ("my gear", "reward points", "purchase history", "place order", and healthcare "prescriptions/claims/appointments", etc.) route to the right action.
- Output stays `{kind:'banking', banking:{action}}` (the action enum is shared infra) — that's fine; the *text* is what must theme, handled in Step 3.

## Step 3 — Theme the heuristic reply text
- In `demoAgentLangGraphService.js` heuristic branch (~111–181), load the active manifest's `terminology` and replace hardcoded headings/labels:
  - "Here are your accounts" → `terminology?.accounts || "accounts"` phrasing
  - "Your balances" → `terminology?.balance`
  - "Recent transactions" → `terminology?.transactions`
- Ensure the structured `accounts`/`transactions` payload returned to the UI already carries themed types (it does — from the seed), and pass `terminology` so the UI table themes (render layer already supports this).

## Step 4 — Verify ALL paths × ALL verticals
- Unit: extend a parser test — `parseHeuristic('hello','sporting-goods')` catalog contains "Reward Points"/"My Gear", NOT "mortgage/checking"; same for healthcare/retail/workforce.
- Unit: heuristic reply headings themed per vertical.
- Confirm Helix + Claude paths already themed (spot-check via systemPromptFlavor forwarding — should be untouched).
- `cd demo_api_ui && npm run build` → 0.
- Targeted server tests for nlIntentParser/agent service.
- Manual smoke: switch each vertical, heuristics mode, "hello" + first chip — no banking words leak.
- REGRESSION_PLAN §4 entry (parser is §1 protected).

## Files
- `demo_api_server/services/nlIntentParser.js` (§1 protected — buildCatalogMessage, parseTheme, parseHeuristic)
- `demo_api_server/services/demoAgentLangGraphService.js` (heuristic reply text + terminology load)
- `demo_api_server/services/nlIntentSanitize.js` (only if allowlist needs a new action — likely none)
- Tests + REGRESSION_PLAN.md §4

## Non-goals / do-not-break
- Banking vertical heuristics output must be byte-identical (terminology=null default path).
- No changes to LLM provider resolution, token/MCP pipeline, or the already-landed UI render/LLM theming.
