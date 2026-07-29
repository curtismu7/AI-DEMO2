# Agent Gateway Tester — cross-execution value chaining

Date: 2026-07-27
Component: `demo_api_ui/src/components/AgentGatewayTester.jsx` (route `/agent-gateway-inspector?subtab=tester`)

## Problem

The tester's tool tree lets a user pick and execute any MCP tool exposed by the active gateway session — banking core tools, admin/customer tools, and (per-vertical) ~90 auto-generated vertical action tools. Many tools require an id produced by an earlier tool's response (e.g. `get_account_balance` needs an `account_id` that only `get_my_accounts` returns). Today only one such pair is wired up: `capturedValues` state captures `accounts[].id` from any response and autofills keys matching `/_?account_id$/i`. Every other id-shaped relationship (transaction ids, admin `userId`, and the full set of vertical-tool entity ids like `orderId`, `ticketId`, `permitId`, ...) has no autofill — the user must copy values out of a previous JSON response by hand, which for admin/vertical tools they usually cannot even see without another lookup call.

Goal: generalize the existing single-purpose mechanism into a family-tagged capture/autofill system that works for every tool the session exposes, banking and vertical alike, without hand-cataloguing every vertical's response shape (that catalogue doesn't fully exist yet and isn't stable — vertical tools are generated from `demo_api_server/config/verticals/*/tools.js`).

## Non-goals

- ~~Fixing the `cancel_appointment` schema/handler mismatch~~ — **Update:** this was originally scoped out here as a separate follow-up (and misnamed the files as `demo_mcp_server`/`scripts/`), but it actually shipped on this same branch, commit `f1dfa45c`, as a two-line handler fix in `demo_api_server/config/verticals/healthcare/tools.js` and `demo_api_server/config/verticals/government/tools.js`: each vertical's `cancel_appointment` handler now accepts either `id` or `appointmentId`/`recordId`, so the fix holds regardless of which vertical's schema `dedupeByName` in `scripts/gen-vertical-tools.js` picks for the merged tool. It was bundled in because it's a tiny, independent, low-risk fix riding along on the same branch — not because it depends on the value-chaining work below.
- Reorganizing the tool tree by vertical. All tools (banking-grouped or not) already appear and are clickable under the existing `TOOL_GROUPS` buckets plus the catch-all `Other` bucket — that already satisfies "user can execute all commands." Tree grouping is a separate UX nicety, not requested.
- Persisting captured values beyond the component's lifetime (no localStorage/sessionStorage). Existing behavior — component state, cleared on unmount/navigation — is unchanged. This is acceptable because the tester itself has no vertical switcher; the active vertical is chosen elsewhere and a vertical change navigates away from (unmounts) this component.

## Design

### 1. Captured value shape

`capturedValues` entries gain a `family` field:

```js
{ family: 'account' | 'transaction' | 'user' | 'order' | 'ticket' | ..., label: string, value: string }
```

`family` is a lowercase, singular noun derived at runtime (see §2) — not a fixed enum. `mergeCapturedValues` (dedup-by-value, cap at `CAPTURED_VALUES_LIMIT`) is unchanged.

### 2. Capture: `extractCapturedValues(result)` generalization

Replace the `accounts[]`-only scan with a generic walk of the response payload:

1. For every **array-valued property** found (at the top level of `result`, and one level inside `result.data` — vertical responses nest under `data`), whose elements are objects with a truthy `.id`: derive `family` from the property key by singularizing the **whole compound key** (strip a trailing plural `s`/`ies`, keep any prefix) and lowercasing it — e.g. `accounts` → `account`, `transactions` → `transaction`, `users` → `user`, `orders` → `order`, `maintenanceTickets` → `maintenanceticket` (the whole key is singularized and lowercased, **not** just its last capitalized word — the `maintenance` prefix stays). A wanted family like `ticket` (from a `ticketId` param) still matches the captured `maintenanceticket` family, but only because `familiesMatch` (§3) does a substring match, not because family derivation trims to the last word. Build a label from the first plausible descriptor field on the item (`accountType`/`name`/`product`/`provider`/`course`/`description`/`status`, in that preference order — first one present) plus a trailing id fragment (last 4 chars if the id looks long/opaque, else the raw id) for disambiguation, matching today's `"account …1234"` style.
2. For a handful of tools whose response is a single new record under a generic key (not a named array) — `checkout`→`data` (family `order`), `book_appointment`→`data` (family `appointment`), `register_course`→`data` (family `enrollment`), `submit_expense`→`data` (family `expense`), plus the existing banking special cases `create_transfer`'s `withdrawalTransaction`/`depositTransaction`, `create_deposit`/`create_withdrawal`'s `transaction` — a small static table (`SINGLE_RECORD_PRODUCERS: { toolName: { path, family } }`, ~10 entries) supplies the family, since a bare `data.id` carries no naming hint on its own. This table is additive to, and much smaller than, a full response-shape catalogue — it only covers the cases where generic array-scanning structurally cannot infer a family.
3. Depth is capped (arrays at top level and one level under `data`) to keep the scan cheap and avoid false positives from deeply nested unrelated ids.

### 3. Consume: matching a schema property to a captured family

Replace `ACCOUNT_ID_PATTERN` with a function `idFamilyForProperty(toolName, propertyKey)`:

- If `propertyKey` matches `/^(.*?)_?[Ii]d$/` and the captured prefix is non-empty (`account_id` → `account`, `from_account_id` → `from_account` → strip a `from_`/`to_` direction prefix too → `account`, `accountId` → `account`, `orderId` → `order`, `ticketId` → `ticket`), that's the wanted family.
- If `propertyKey` is bare `id` (the government-vertical outlier tools), derive the family from the **tool name** instead: strip one leading verb token from a fixed small list (`cancel`, `close`, `approve`, `reject`, `renew`, `dispute`, `submit`, `schedule`, `void`, `reopen`, `flag`, `complete`, `release`, `put`, `escalate`, `expedite`) and use the remainder — `cancel_permit` → `permit`, `dispute_violation` → `violation`, `submit_filing` → `filing`.
- Matching a wanted family against a captured entry's family is case-insensitive substring match in both directions (handles `ticket` matching a captured `maintenanceTicket`-ish family and vice versa), preferring an exact match first, then most-recent captured entry among substring matches.

`buildArgsTemplate` and the `runChain` optional-property backfill both switch from `ACCOUNT_ID_PATTERN.test(key)` + "use `capturedValues[0]`" to "use `idFamilyForProperty` + best family match" — same call shape, generalized predicate. `buildArgsTemplate` still only pre-populates **required** properties (unchanged scope) plus any **optional** property that already has a matching captured value available (mirrors the existing special-case handling `runChain` does today for `get_sensitive_account_details`'s optional `account_id`, now generalized instead of hardcoded to that one tool).

### 4. "Insert captured value" dropdown

Unchanged UI position/behavior, generalized matching: on selecting a captured entry, find the first key in the current parsed args (or the tool's schema properties) whose `idFamilyForProperty` result matches that entry's `family`, instead of the fixed `ACCOUNT_ID_PATTERN` scan. Options remain flat (not grouped by family) — dropdown already grows unbounded at `CAPTURED_VALUES_LIMIT = 20`; grouping is cosmetic and out of scope.

### 5. What does NOT change

- `CHAIN_STEPS` / `runChain`'s fixed 3-step banking demo sequence — untouched, still banking-only.
- `TOOL_GROUPS` / tree layout — untouched.
- Endpoint contracts (`/api/mcp/inspector/tools`, `/api/mcp-gateway/test`) — untouched, UI-only change.
- `FALLBACK_TOOLS` — untouched (still the 6-tool static fallback for when the BFF is unreachable).

## Error handling

- A response with no arrays/known single-record shape simply captures nothing (today's behavior for e.g. `get_my_transactions` if it lacked a `transactions[]` key — not a new failure mode).
- If `idFamilyForProperty` finds no matching captured entry for a property, that property is left at its existing type-based placeholder (`ARG_PLACEHOLDER_BY_TYPE`) or omitted (optional, no match) — same fallback as today's account-id-less case.
- Malformed/non-object response payloads (`clientError`, network failure) already short-circuit before `extractCapturedValues` is called — unchanged.

## Testing

- Extend `demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx`:
  - existing `get_my_accounts` → `get_account_balance` account_id case still passes unchanged (regression guard for current behavior).
  - new case: a response with `transactions: [{id, ...}]` autofills a subsequently-selected tool's `transaction_id`/`id`(via tool-name-derived family) property.
  - new case: a bare `data.id` producer (e.g. simulated `checkout` response) captures family `order`, and a consumer tool with `orderId` autofills from it.
  - new case: a bare-`id` consumer tool (e.g. simulated `cancel_permit`) derives family `permit` from its own tool name and matches a captured `permit` family entry, not an unrelated `order`/`ticket` one.
  - new case: no matching family present → property falls back to placeholder/omitted, no throw.
- `npm run test:unit && npm run build` per project verification gate.
