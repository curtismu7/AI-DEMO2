# JSON Form View — Design

**Date:** 2026-07-21
**Status:** Approved
**Author:** Curtis Muir

---

## Overview

Three tool-inspector surfaces in `demo_api_ui` show raw JSON as their primary output:
`AgentGatewayConfigEditor.jsx` (PingGateway Inspector → JSON Config tab, Monaco editor),
`McpInspectorPage.jsx` (PingOne MCP Inspector, Response/Request/History tabs), and
`AgentGatewayTester.jsx` (Gateway Tester, Response Body/Request tabs). Each needs one
more output tab that renders the same JSON as a readable form instead of a raw blob.

The JSON shapes are heterogeneous and open-ended — MCP tool responses vary per tool
(16+ tools, each a different result shape), gateway config files vary per file type
(`ig-config` / `ig-admin` / `scope-topology`), and tester results vary per scenario.
Building a bespoke field-mapped form per shape doesn't scale and creates an ongoing
maintenance tax every time a tool or file type is added.

## Goals

- One shared, generic component that turns **any** JSON value into a labeled form —
  no per-tool, per-file-type, or per-scenario schema to hand-maintain.
- Read-only. The raw JSON view (Monaco editor, `JsonHighlight` panes) remains the way
  to actually edit or copy verbatim JSON; the form is a friendlier *display* alongside it.
- Surface a "Key Values" section up top for fields that look important by name
  (id, status, amount, url, scope, ...), with everything else available below in a
  full "All Fields" section — so the form reads as curated, not just reformatted.
- Wire a "Form" tab into all three surfaces above.

## Non-goals

- Editable form fields that save back to the gateway/config APIs — deferred; raw
  JSON editing stays the only write path (`AgentGatewayConfigEditor`'s existing
  Monaco + validate/save flow is untouched).
- `PingOneAuthorizePage.jsx` — also on the shared `InspectorShell`/`InspectorTabs`
  pattern, but not requested; not touched in this pass.
- Per-shape "important fields" tuning (e.g. a hardcoded field list for
  `get_my_accounts` specifically) — the heuristic is name-pattern based and generic,
  intentionally not shape-aware.
- No backend/API changes — this is a UI-only rendering feature over JSON the app
  already has in hand.

---

## Architecture

### `JsonFormView` — new shared component

New files in `demo_api_ui/src/components/shared/`:

- `JsonFormView.jsx` — takes a single `value` prop (any JSON-serializable value) and
  an optional `emptyMessage`. Recursively walks `value`:
  - **Objects** → each key becomes a labeled row (label = key, humanized: `camelCase`/
    `snake_case` → "Camel Case"). Nested objects render as an indented sub-group headed
    by the key.
  - **Arrays of primitives** → rendered as a bulleted list under the key.
  - **Arrays of objects** → each entry renders as its own indexed sub-group ("Item 1",
    "Item 2", ...), each recursing the same way.
  - **Primitives** (string/number/boolean) → `label: value` row. Long strings
    (> ~120 chars, e.g. tokens/JWTs) truncate with a click-to-expand toggle. Values look
    like `CopyableValue`'s existing display style (monospace for id/url/token-shaped
    values) for visual consistency with the rest of the app, but `JsonFormView` owns its
    own minimal internal copy-button — it does not depend on `McpFieldContext`.
  - **null/undefined** → renders as a muted "—", not omitted (so the reader can tell a
    field exists but is empty vs. doesn't exist).
  - Empty/absent `value` → `emptyMessage` (default: "No data.").
- **Key Values heuristic**: while walking, any leaf whose key matches a name pattern
  (case-insensitive substring/suffix match against: `id`, `name`, `status`, `amount`,
  `balance`, `url`, `scope`, `audience`, `type`, `label`, `email`, `role`, `code`,
  `message`, `state`) is *also* collected into a flat "Key Values" list at the top,
  labeled with its dotted path if nested (e.g. `account.accountId`). This is additive —
  the full nested tree still renders below under "All Fields"; nothing is removed from
  the full view to populate the summary.
- `JsonFormView.css` — own stylesheet (label/value row layout, sub-group indentation,
  the two-section split), not reusing `mgc-*`/`agc-*`/`inspector-shell-*` classes to
  avoid coupling a shared component to one page's naming.

### Integration points

**1. `AgentGatewayConfigEditor.jsx` (PingGateway Inspector → JSON Config tab)**
No existing tab bar here — it's a file-picker + single Monaco pane. Add a small local
view toggle in the existing toolbar (next to Revert/Save): "Editor" / "Form" buttons,
state `viewMode`. When `viewMode === 'form'`, attempt `JSON.parse(editorValue)` and
render `<JsonFormView value={parsed} />` in place of the Monaco pane; on parse failure
(mid-edit invalid JSON), show a small inline notice ("Fix JSON in Editor view first")
instead of the form. Editor stays the default view and the only place Save/Revert/
Restart live — Form is purely a read-only alternate display of the same
`editorValue`.

**2. `McpInspectorPage.jsx` (PingOne MCP Inspector)**
This page has multiple near-duplicate source hooks (`usePingOneSource`,
`useBankingMcpSource`, `useApiCallsSource`, ...), each with its own `outputTab` state,
`InspectorTabs` array (`response` / `request` / `history`), and an `outputContent`
resolver that switches on `outputTab`. For each hook: add `{ key: 'form', label:
'Form' }` to its tabs array, add a `form` branch to the `outputContent` resolver that
returns the same object as `response` (the last invoke result — the richest, most
useful JSON for a form view), and render `<JsonFormView value={outputContent} />`
instead of `<pre><JsonHighlight/></pre>` when `outputTab === 'form'`. `history`'s shape
(a list of past calls, not one JSON object) is unaffected — Form always shows the
current response, not history.

**3. `AgentGatewayTester.jsx` (Gateway Tester)**
Same pattern as #2: its `InspectorTabs` (`response` / `request`) gets a third `form`
entry, rendering `<JsonFormView value={selectedCall?.response?.body} />` (the same
value the "Response Body" tab already shows).

---

## Testing

- Unit test for `JsonFormView` covering: nested object, array of primitives, array of
  objects, null/undefined leaf, long-string truncation, and the Key Values heuristic
  picking up a nested `id`/`status`-named field into the summary section.
- Per `inspector-template` skill's shared verification: `regression-guard` stated
  invariant before editing (these are all `demo_api_ui` protected-area files),
  isolated worktree, emoji allowlist, `npm run build` exit 0, and a manual
  click-through of all three surfaces (select tool/file/scenario → Form tab → values
  render, Key Values section populated, raw JSON view still works unchanged).
