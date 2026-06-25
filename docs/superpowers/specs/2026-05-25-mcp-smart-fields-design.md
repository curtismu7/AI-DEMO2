# MCP Smart Fields — Design Spec
**Date:** 2026-05-25  
**Scope:** `WebMcpPanel` + `McpGatewayConfig` wizard  
**Approach:** Shared `useMcpFieldState` hook (React context)

---

## Problem

1. **No auto-fill across wizard steps.** Values entered in Step 2 (e.g. `PingOne Resource ID`) must be re-entered manually in Step 3.
2. **No carry-forward between tool calls.** An `account_id` returned by `get_my_accounts` must be copy-pasted manually into `get_account_balance`, `create_transfer`, etc.
3. **No copyable values.** UUIDs, URLs, and other long strings have no copy button — users must triple-click and copy manually.
4. **Blocky typography.** `font-size: 15px` inputs with no `line-height` or `letter-spacing` tuning feel heavy.
5. **All params render as plain text inputs** regardless of type — no dropdowns for enums, no toggles for booleans, no suggestions for description fields.

---

## Goals

- Required fields that can be derived from config or a previous result are **pre-filled automatically** with a "From Step N" or "auto-filled" source chip.
- All filled values (auto or manual) have a **fused copy button** — one click copies to clipboard.
- Tool params render as the **right control for their type**: dropdown for known-enum fields, toggle for booleans, suggestion chips for description/query text.
- Result extraction from tool calls **writes account/user IDs into shared context** so downstream tool params populate automatically.
- Typography is **lighter and more readable** without adding a new font dependency.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `demo_api_ui/src/context/McpFieldContext.js` | React context + `McpFieldProvider` |
| `demo_api_ui/src/hooks/useMcpFieldState.js` | Hook: read/write shared field values |
| `demo_api_ui/src/constants/mcpFieldKeys.js` | Enum of all shared field key strings |
| `demo_api_ui/src/components/CopyableValue.jsx` | Shared display: filled value + fused copy button |
| `demo_api_ui/src/components/CopyableValue.css` | Styles for `CopyableValue` |
| `demo_api_ui/src/components/McpParamSelect.jsx` | Dropdown param control |
| `demo_api_ui/src/components/McpParamToggle.jsx` | Boolean toggle/checkbox param control |
| `demo_api_ui/src/components/McpParamSuggest.jsx` | Free-text input with suggestion chips |

### Modified files

| File | Change |
|------|--------|
| `demo_api_ui/src/App.js` | Wrap tree with `<McpFieldProvider>` |
| `demo_api_ui/src/components/McpGatewayConfig.jsx` | Use `useMcpFieldState` + `CopyableValue` in all wizard steps |
| `demo_api_ui/src/components/WebMcpPanel.js` | Smart param controls; result extraction writes to context |
| `demo_api_ui/src/components/McpGatewayConfig.css` | Typography fixes |
| `demo_api_ui/src/components/WebMcpPanel.css` | Typography fixes |

---

## Section 1: `McpFieldContext` + `useMcpFieldState`

### Context shape

```js
// State: Map of fieldKey → { value: string, source: string|null }
// Actions: SET_FIELD(key, value, source), CLEAR_FIELD(key)
```

`McpFieldProvider` uses `useReducer`. It wraps the app at the same level as `AgentUiModeContext` and `EducationUIContext` in `App.js`.

### Hook API

```js
const { value, setValue, source, clear } = useMcpFieldState(fieldKey, {
  source: 'Step 2',      // chip label shown in downstream CopyableValue
  defaultValue: '',      // seeds value on mount (e.g. from data.config.*)
});
```

- `setValue(v)` — writes into context; all consumers re-render reactively.
- `source` — string shown as a chip: `"Step 2"`, `"auto-filled"`, `"get_my_accounts result"`, etc.
- `defaultValue` — used to seed derived/auto-filled fields from API data on mount.
- `clear()` — resets field to empty.

### Field key registry (`mcpFieldKeys.js`)

```js
export const MCP_FIELD_KEYS = {
  // Wizard fields
  PINGONE_ENV_URL:      'pingOneEnvUrl',
  PINGONE_RESOURCE_ID:  'pingOneResourceId',
  GATEWAY_URL:          'gatewayUrl',
  UPSTREAM_MCP_URL:     'upstreamMcpUrl',
  INTROSPECT_ENDPOINT:  'introspectEndpoint',
  MCP_SCOPE:            'mcpScope',
  // Tool param fields
  ACCOUNT_ID:           'account_id',
  FROM_ACCOUNT_ID:      'from_account_id',
  TO_ACCOUNT_ID:        'to_account_id',
  USER_ID:              'userId',
  ACCOUNT_ID_ADMIN:     'accountId',
  LIMIT:                'limit',
};
```

---

## Section 2: `CopyableValue` component

Replaces plain `<input readOnly>` wherever a value needs to be displayed and copied.

### Props

```jsx
<CopyableValue
  label="PingOne Resource ID"
  fieldKey="pingOneResourceId"   // drives useMcpFieldState
  required={true}
  readOnly={false}               // true for derived/auto-filled fields
  source="Step 2"                // shown as source chip when set
  placeholder="Paste UUID here"
  hint="Used as username in OAuth2ResourceServerFilter"
  monospace={true}               // UUIDs/URLs use mono font
  onChange={fn}                  // optional — for editable fields
/>
```

### Visual states

**Empty + required:**
- Amber border (`#f59e0b`), amber tint background (`#fffbeb`)
- `"required"` amber pill badge next to label
- No copy button

**Filled (user-entered):**
- Blue border (`#6366f1`), blue tint (`#eef2ff`)
- Copy button fused to right edge
- No source chip

**Auto-filled / read-only:**
- Green border (`#a7f3d0`), green tint (`#f0fdf4`)
- `"auto-filled"` green chip OR `"From Step N"` blue chip next to label
- Copy button fused to right edge; field is `readOnly`

**Copy button behaviour:**
- Label: `"⎘ Copy"` → `"✅ Copied"` for 1.5s → reverts
- Uses `navigator.clipboard.writeText(value)`
- Only rendered when `value` is non-empty

---

## Section 3: Smart param controls in `WebMcpPanel`

The `schemaProps` render loop in `WebMcpPanel.js` is extended to pick the right control per field.

### Control selection logic

```js
function pickControl(key, schema, context) {
  if (key === 'freeze')                        return McpParamToggle (radio: Freeze/Unfreeze)
  if (key === 'confirm')                       return McpParamToggle (checkbox + confirmation label)
  if (schema.type === 'boolean')               return McpParamToggle
  if (DROPDOWN_FIELDS.has(key))                return McpParamSelect (options from context)
  if (schema.enum)                             return McpParamSelect (options from schema)
  if (SUGGEST_FIELDS.has(key))                 return McpParamSuggest (chips below input)
  if (context.value)                           return CopyableValue   (pre-filled, copyable)
  return plain input                           (default)
}
```

### Dropdown fields (`McpParamSelect`)

| Field key | Options source |
|-----------|---------------|
| `account_id`, `from_account_id`, `to_account_id` | Fetches `/api/accounts/my` on first use; cached in context. Label: `"Checking — $2,500"` |
| `account_type` | Hardcoded: `checking / savings / loan / credit / investment` |
| `userId` | Populated from `lookup_customer` result in context |
| `accountId` | Populated from `get_customer_accounts` result in context |
| `limit` | Hardcoded presets: `5 / 10 / 20 / 50` |

`from_account_id` and `to_account_id` when both present in the same tool (e.g. `create_transfer`): `to_account_id` excludes the currently-selected `from_account_id` option.

### Toggle fields (`McpParamToggle`)

| Field key | Render |
|-----------|--------|
| `freeze` | Radio pair: "Freeze" / "Unfreeze" |
| `confirm` (delete_customer) | Checkbox: "I confirm permanent deletion of this customer and all their data" |
| Any `schema.type === 'boolean'` | Checkbox |

### Suggestion fields (`McpParamSuggest`)

| Field key | Chips |
|-----------|-------|
| `description` (deposit) | "Cash Deposit", "Mobile Check Deposit", "Transfer from External" |
| `description` (withdrawal) | "ATM Withdrawal", "Cash Withdrawal", "Check Withdrawal" |
| `description` (transfer) | "Transfer to Savings", "Transfer to Checking" |
| `description` (adjust_balance) | "Admin adjustment", "Correction", "Fee reversal" |
| `query` (sequential_think) | "Should I transfer $500 to savings?", "What's my spending this month?" |

Clicking a chip sets the input value. User can still type freely.

### Result extraction

`interpretResult()` is extended. After a successful call, structured data is extracted from `result.text` (JSON string) and written to `McpFieldContext`:

| Tool result | Writes to context |
|-------------|-------------------|
| `get_my_accounts` | `accountOptions` list; populates `account_id` / `from_account_id` / `to_account_id` dropdowns |
| `lookup_customer` | `userOptions` list; populates `userId` dropdowns with source `"lookup_customer result"` |
| `get_customer_accounts` | `adminAccountOptions` list; populates `accountId` dropdowns |

Extraction is best-effort (try/catch JSON.parse) — if it fails, plain text display is unchanged.

---

## Section 4: `McpGatewayConfig` wizard changes

Wizard steps seed derived fields on mount using `defaultValue` from `data.config.*`:

| Field | `defaultValue` source | `readOnly` | Source chip |
|-------|-----------------------|-----------|-------------|
| `pingOneEnvUrl` | `data.config.pingOneEnvUrl` | true | `"auto-filled"` |
| `introspectEndpoint` | `data.config.introspectEndpoint` | true | `"auto-filled"` |
| `upstreamMcpUrl` | `data.config.upstreamMcpUrl` | true | `"auto-filled"` |
| `pingOneResourceId` | empty | false | — (user enters in Step 2) |
| `gatewayUrl` | empty | false | — (user enters in Step 2) |
| `mcpScope` | `"mcp:invoke"` | false | — |

Step 3 reads `pingOneResourceId` and `gatewayUrl` from context (set in Step 2) and renders them via `CopyableValue` with `source="Step 2"` chips. Step 3 never asks the user to re-enter them.

---

## Section 5: Typography fixes

No new font dependency. System font stack tuned for both panels.

### `WebMcpPanel.css`

```css
.webmcp-param-label  { line-height: 1.5; letter-spacing: 0.01em; }
.webmcp-param-input  { line-height: 1.5; letter-spacing: 0.01em; font-size: 14px; }
.webmcp-params h5    { letter-spacing: 0.04em; }
.webmcp-param-input--mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  letter-spacing: 0.03em;
}
```

### `McpGatewayConfig.css`

```css
.mgc-field-label  { line-height: 1.5; letter-spacing: 0.01em; font-size: 12px; }
.mgc-field-hint   { line-height: 1.6; }
.mgc-input        { line-height: 1.5; letter-spacing: 0.01em; }
.mgc-pre--code    { font-size: 12.5px; line-height: 1.6; }
```

Readonly inputs displaying UUIDs/URLs get `font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace`.

### `CopyableValue.css` (new)

```css
/* Field row */
.copyable-value         { display: flex; align-items: stretch; border-radius: 6px; overflow: hidden; }
/* Value area */
.copyable-value__input  { flex: 1; padding: 9px 12px; line-height: 1.5; font-size: 13px; border: none; }
.copyable-value--mono .copyable-value__input { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; letter-spacing: 0.03em; }
/* Copy button */
.copyable-value__copy   { padding: 0 14px; border: none; cursor: pointer; font-size: 11px; font-weight: 600; white-space: nowrap; }
/* States */
.copyable-value--filled   { border: 1.5px solid #6366f1; }
.copyable-value--autofill { border: 1px solid #a7f3d0; }
.copyable-value--required { border: 1.5px solid #f59e0b; }
/* Chips */
.copyable-value__chip--autofill  { background: #d1fae5; color: #065f46; }
.copyable-value__chip--source    { background: #e0f2fe; color: #0369a1; }
.copyable-value__chip--required  { background: #fef3c7; color: #92400e; border: 1px solid #fbbf24; }
```

---

## Out of scope

- No changes to `MCPToolsEducation`, `MCPToolsListModal`, or `AgentDemoGuide`
- No new BFF routes — all data fetched via existing `/api/accounts/my`, `/api/admin/agent/lookup`, etc.
- No persistence beyond the browser session (`sessionStorage` / `localStorage` not used)
- No emoji added (per CLAUDE.md emoji rule — only ⚠️ ✅ ❌ permitted)

---

## Success criteria

1. Filling `pingOneResourceId` in Step 2 of the wizard causes Step 3 to show it pre-filled with a "From Step 2" chip and copy button — without re-entry.
2. After calling `get_my_accounts`, the `account_id` param in `get_account_balance` shows a dropdown of the user's accounts.
3. `account_type` always renders as a dropdown (not a text input).
4. `freeze` always renders as a Freeze/Unfreeze radio pair.
5. All filled values (auto or manual) have a working copy button.
6. `cd demo_api_ui && npm run build` exits 0.
7. No pre-existing regression tests broken.
