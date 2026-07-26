# Gateway Inspector: sequential chaining + value carry-forward

Date: 2026-07-24
Status: Approved (design)
Route: `/pinggateway-inspector` → `AgentGatewayTester.jsx`

## Problem

The Gateway Tester lets a user pick one MCP tool, hand-type JSON args, and
execute it. There is no way to run tools in a sensible order and carry a
value produced by one call (e.g. an account `id` from `get_my_accounts`)
into the args of the next call (e.g. `account_id` on `get_account_balance`
or `get_sensitive_account_details`). Every argument box has to be filled by
hand from scratch each time, even when the value is sitting in the previous
response.

## Goals

- Capture `id`-bearing values from tool responses as the user works.
- Auto-fill matching required args (`account_id`, `from_account_id`,
  `to_account_id`) on the next tool from the most recent captured value,
  while leaving the JSON textarea fully editable so the user can override
  before executing.
- Offer a one-click "Run chain" for the natural read-only sequence
  (`get_my_accounts → get_account_balance → get_sensitive_account_details`),
  passing captured values forward automatically between steps.
- Make `get_sensitive_account_details` accept an optional `account_id` so it
  can actually participate in that chain (today it takes no args and always
  returns every account).

## Non-goals

- `create_transfer` is not part of the auto-run chain (it moves money / can
  trigger HITL) — it stays manual-only, though its `from_account_id` /
  `to_account_id` fields still benefit from autofill and the captured-values
  picker.
- No new backend endpoints. The chain button makes the same sequential
  `/api/mcp-gateway/test` calls the UI already makes for a single tool.
- No changes to `sensitiveBanking.js` or `BankingAPIClient.ts` — the
  sensitive-details response already contains every account; filtering to
  one `account_id` happens in the MCP tool handler, on data it already has.

## Design

### Backend — `demo_mcp_server`

- `src/tools/BankingToolRegistry.ts`: `get_sensitive_account_details`
  gains an optional `account_id` property (`string`, same description style
  as `get_account_balance`'s: *"Account ID (UUID format) — use the `id`
  field from get_my_accounts response"*). `required` stays `[]`.
  `additionalProperties` stays `false` (already true — this is why the
  property must be declared, not just read off `params` unchecked; an
  undeclared arg is rejected before the handler ever runs).
- `src/tools/handlers/accountHandlers.ts` →
  `executeGetSensitiveAccountDetails`: now reads `params.account_id`. When
  present, filters the `accounts` array from
  `apiClient.getSensitiveAccountDetails(token)` down to the matching `id`
  (no match → `accounts: []`, still `success: true` — same "no accounts"
  shape the route already produces for a user with zero accounts). When
  omitted, behavior is unchanged (all accounts, as today).
- No change to the HTTP route or `BankingAPIClient.ts` — they already
  return every account's sensitive fields; the new filter is a pure
  narrowing step on data already in hand.

### Frontend — `demo_api_ui/src/components/AgentGatewayTester.jsx`

All state below is component-local (no context/store change).

1. **`capturedValues`** — array of `{ label, value }`, newest first, capped
   at 20, deduped by `value`. After every successful `send()` /
   `runChain()` step, scan the response's `result` for:
   - an array of objects each containing an `id` → one entry per item
   - a single object containing an `id` → one entry
   Label: `` `${tool}: ${accountType || name || 'item'} …last4}` `` when the
   source object has enough fields to build one, else `` `${tool} result` ``.
2. **Autofill** — `buildArgsTemplate(tool)` fills any required property
   whose name matches `/_?account_id$/i` with the most recent
   `capturedValues[0].value` if one exists, else `''` (today's behavior).
   The textarea (`argsText`) is unchanged: still a plain controlled
   `<textarea>`, no `readOnly`/`disabled`, fully user-editable after
   autofill.
3. **Captured-values picker** — a `<select>` rendered next to the Arguments
   label when `capturedValues.length > 0`, listing each label. Choosing one
   parses the current `argsText`, sets the first key matching
   `/_?account_id$/i` to the picked value, and re-stringifies — a manual
   override path distinct from the automatic "most recent" default.
4. **`runChain()`** — new handler. Fixed order:
   `['get_my_accounts', 'get_account_balance', 'get_sensitive_account_details']`.
   For each tool (looked up from the live `tools` list by name — the step is
   skipped with a note in the chain log if a tool by that name isn't
   present): build args the same way `buildArgsTemplate` + autofill would,
   `POST /api/mcp-gateway/test`, push `{ tool, ok, data, durationMs }` onto a
   new `chainResults` array, extract captured values from the response
   before moving to the next step. Stops early (with the failure visible in
   the chain log) if a step errors.
5. **"Chain" output tab** — added to the existing `InspectorTabs` list.
   Renders `chainResults` as a simple ordered list (tool name, status
   badge, duration, decision if present). Clicking a row sets `resp` to
   that step's `data` and flips `outputTab` to `'result'`, so the existing
   Result / Audit Trail / Authorize Decision / McpAudit tabs work unchanged
   for whichever step the user is inspecting — no duplicated rendering
   logic.
6. **Order badges** — small `1` / `2` / `3` badges on the
   `get_my_accounts` / `get_account_balance` / `get_sensitive_account_details`
   tree rows (existing `inspector-shell-tree-item__badge` pattern, same as
   the current `W`/`S` badges) so the chain order is visible without
   reading this spec.

### Error handling

- Autofill only ever changes the *initial* template on tool selection —
  it never overwrites text the user is actively editing.
- `runChain()` stops at the first failed step (network error, non-2xx,
  `clientError`) rather than continuing with stale/missing values; the
  partial `chainResults` stays visible in the Chain tab.
- Filtering in `executeGetSensitiveAccountDetails` never throws on an
  unknown `account_id` — it returns an empty `accounts` array, matching the
  existing "no accounts" success shape rather than inventing a new error
  case.

### Testing

- `demo_mcp_server/tests/tools/BankingToolRegistry.test.ts`: existing
  generic schema assertions (`properties`/`required`/`additionalProperties`)
  keep passing since `account_id` is optional; no changes expected, but
  re-run to confirm.
- New/updated test in `demo_mcp_server` covering
  `executeGetSensitiveAccountDetails` filtering by `account_id` (match,
  no-match, omitted) — no existing unit test in the repo exercises this
  handler directly, so this adds the first one.
- `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:
  extend with cases for capture-on-response, autofill-on-select, the
  captured-values picker, and `runChain()` (including the stop-on-failure
  path).
- Manual/live verification: exercise the "Run chain" button against the
  running stack and confirm the third step's account matches the id
  produced by the first step.

## Files touched

- `demo_mcp_server/src/tools/BankingToolRegistry.ts`
- `demo_mcp_server/src/tools/handlers/accountHandlers.ts`
- `demo_mcp_server/tests/tools/*` (new/updated test for the handler)
- `demo_api_ui/src/components/AgentGatewayTester.jsx`
- `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`
