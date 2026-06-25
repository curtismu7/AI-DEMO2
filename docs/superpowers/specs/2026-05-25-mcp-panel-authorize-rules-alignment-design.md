# Design: MCP Panel Visual Alignment + Authorize Rules Form Improvements

**Date:** 2026-05-25  
**Status:** Approved

---

## Overview

Two related UI improvements to the dashboard:

1. **MCP Tool Inspector visual alignment** — make the inner panel of `WebMcpPanel.js` look identical to the `AuthorizeRulesPanel.jsx` design (list items, detail pane, colors, button style).
2. **Authorize Rules form improvements** — replace the ACR plain text input with a `<select>` dropdown, and replace the MCP "Tool name" plain text input with a `<select>` populated from a live fetch.

The PageNav header and toolbar buttons at the top of `WebMcpPanel` are unchanged.

---

## Approach: Shared CSS Class Alignment (Option A)

Extract the AuthorizeRules visual tokens into a new shared CSS file (`rule-panel.css`). Both `WebMcpPanel.css` and `AuthorizeRulesPanel.jsx` inline styles are migrated to use these shared classes. This keeps one source of truth for the panel pattern and prevents future visual drift.

---

## Architecture

### New file: `demo_api_ui/src/styles/rule-panel.css`

Shared CSS classes for the list+detail panel pattern used by both components:

| Class | Purpose |
|---|---|
| `.rp-container` | Outer panel: `border: 1px solid #e5e5e5`, `borderRadius: 8px`, `overflow: hidden`, `background: #fff` |
| `.rp-header` | Panel header: `padding: 12px 16px`, `background: #fafafa`, `border-bottom: 1px solid #e5e5e5` |
| `.rp-body` | Flex row: `display: flex`, `minHeight: 400px` |
| `.rp-list` | Left column: `width: 240px`, `min-width: 240px`, `border-right: 1px solid #e5e5e5`, `overflow-y: auto`, `background: #fff` |
| `.rp-list-group-header` | Section label in list: `padding: 8px 12px 5px`, `font-size: 10px`, `font-weight: 700`, `color: #999`, `text-transform: uppercase`, `letter-spacing: .06em`, `background: #fafafa`, `border-bottom: 1px solid #f0f0f0` |
| `.rp-list-hint` | Hint text below header: `font-size: 11px`, `color: #777`, `font-style: italic`, `padding: 5px 10px 4px` |
| `.rp-list-item` | Row: `padding: 10px 12px`, `cursor: pointer`, `border-bottom: 1px solid #f3f3f3`, `border-left: 3px solid transparent`, `background: #fff`, `transition: background .1s` |
| `.rp-list-item--active` | Selected state: `border-left-color: #4f46e5`, `background: #eef2ff` |
| `.rp-list-item__name` | Item title: `font-size: 12px`, `font-weight: 600`, `color: #111`, `margin-bottom: 3px` |
| `.rp-list-item__sub` | Item subtitle: `font-size: 11px`, `color: #777`, `line-height: 1.4`, `margin-bottom: 5px` |
| `.rp-detail` | Right column: `flex: 1`, `padding: 18px 20px`, `overflow-y: auto`, `background: #fff` |
| `.rp-detail__title` | Detail heading: `font-size: 15px`, `font-weight: 700`, `color: #111`, `margin-bottom: 6px` |
| `.rp-detail__desc` | Detail description: `font-size: 13px`, `color: #444`, `line-height: 1.6`, `margin-bottom: 14px` |
| `.rp-test-form` | Test/params box: `background: #f8f9fc`, `border: 1px solid #e5e5e5`, `border-radius: 8px`, `padding: 14px 16px`, `margin-bottom: 12px` |
| `.rp-test-form__label` | Form label text: `display: block`, `font-size: 11px`, `color: #666`, `margin-bottom: 4px` |
| `.rp-test-form__input` | Form input/select: `width: 100%`, `border: 1px solid #d1d5db`, `border-radius: 5px`, `padding: 6px 10px`, `font-size: 12px`, `color: #111`, `background: #fff`, `box-sizing: border-box` |
| `.rp-btn-primary` | Primary action button: `background: #4f46e5`, `color: #fff`, `border: none`, `border-radius: 6px`, `padding: 7px 18px`, `font-size: 12px`, `font-weight: 600`, `cursor: pointer` |
| `.rp-btn-primary:hover` | Hover: `background: #2563eb` |
| `.rp-btn-primary:disabled` | Disabled: `opacity: 0.7`, `cursor: default` |

---

## Component Changes

### 1. `WebMcpPanel.js` + `WebMcpPanel.css`

**List items (`webmcp-tool-item` → `rp-list-item`):**
- Replace bordered card buttons (`border: 1px solid #d0d9e8`, `background: #f4f7fb`) with flat rows using `.rp-list-item` / `.rp-list-item--active`
- Remove `display: flex; flex-direction: column` button layout; use `<div>` rows like AuthorizeRules `RuleCard`
- Retain HITL/step-up badge chips (colors unchanged — they are semantic, not structural)
- The "Available Tools (N)" heading becomes `.rp-list-group-header` style
- Hint text "Select a tool to inspect and call it" becomes `.rp-list-hint` style

**Detail pane (`webmcp-tool-detail`):**
- Title `h4` → `.rp-detail__title` (15px bold `#111`, not 20px navy `#0f2044`)
- Description `.webmcp-tool-detail-desc` → `.rp-detail__desc` (13px `#444`, not 15px `#4a6080`)
- Parameters block (`.webmcp-params`) → wrapped in `.rp-test-form` box
  - `h5` "PARAMETERS" label → `.rp-test-form` section header style (11px uppercase `#888`)
  - Labels → `.rp-test-form__label`
  - Inputs (`.webmcp-param-input`) → `.rp-test-form__input`
- "Call Tool" button → `.rp-btn-primary` (indigo `#4f46e5`, not blue `#3b82f6`)
- Gate notices (HITL/step-up banners): keep existing semantic colors (`#fffbeb`/`#f0f9ff`), just ensure consistent border-radius/padding with the rest of the panel
- Result context banners: keep existing semantic colors (success green, hitl amber, stepup blue, error red) — structural padding/border-radius aligned
- Pipeline Events log and pre block: keep existing styling (monospace, `#f4f7fb` background) — these are functional, not decorative

**`WebMcpPanel.css`:** Remove or replace rules that are now covered by `rule-panel.css`. Keep only MCP-specific rules (gate notices, stream log, result banners, spinner, placeholder empty state).

**Import:** Add `import '../styles/rule-panel.css';` to `WebMcpPanel.js`.

---

### 2. `AuthorizeRulesPanel.jsx`

**Migrate inline styles to `rule-panel.css` classes:**
- Outer `div` → `className="rp-container"`
- Header `div` → `className="rp-header"`
- Body `div` → `className="rp-body"`
- `RuleList` container → `className="rp-list"`
- Group headers → `className="rp-list-group-header"`
- `RuleCard` `div` → `className="rp-list-item"` + `rp-list-item--active` when selected
- Card name/sub text → `rp-list-item__name` / `rp-list-item__sub`
- `RuleDetail` outer div → `className="rp-detail"`
- Rule name/desc → `rp-detail__title` / `rp-detail__desc`
- `TestForm` box → `className="rp-test-form"`
- Labels/inputs → `rp-test-form__label` / `rp-test-form__input`
- "Run evaluation" button → `className="rp-btn-primary"`

Inline styles that are data-driven (chip colors, badge colors, engine color) remain inline — these are value-dependent and don't belong in a shared class.

**ACR field — replace text input with `<select>`:**

```jsx
// Before
<input style={inputStyle} value={testAcr} onChange={e => setTestAcr(e.target.value)} placeholder="e.g. MFA" />

// After
<select className="rp-test-form__input" value={testAcr} onChange={e => setTestAcr(e.target.value)}>
  <option value="">(none)</option>
  <option value="MFA">MFA</option>
  <option value="Single">Single</option>
</select>
```

Label changes from "ACR (optional)" to "ACR".

**MCP tool name field — replace text input with live-fetched `<select>`:**

- Add `mcpTools` state (array of tool name strings) to `AuthorizeRulesPanel`
- On mount, fetch `/api/mcp/tools` (same endpoint used by `WebMcpPanel` via `listMcpTools()`) — import and reuse `listMcpTools` from `../services/webMcpClient`
- If fetch fails or returns empty, fall back to the existing text input (graceful degradation)
- Default selected value: first tool in the list (or empty if loading)

```jsx
// State addition
const [mcpTools, setMcpTools] = useState([]);

// Effect addition
useEffect(() => {
  listMcpTools()
    .then(data => setMcpTools((data.tools || []).map(t => t.name)))
    .catch(() => {}); // silent — fallback to text input
}, []);
```

```jsx
// In TestForm, isMcp branch:
// Before
<input style={inputStyle} value={testTool} onChange={e => setTestTool(e.target.value)} placeholder="e.g. get_account_balance" />

// After (when mcpTools.length > 0)
<select className="rp-test-form__input" value={testTool} onChange={e => setTestTool(e.target.value)}>
  <option value="">— select a tool —</option>
  {mcpTools.map(name => <option key={name} value={name}>{name}</option>)}
</select>

// Fallback (when mcpTools.length === 0 — MCP server not running)
<input className="rp-test-form__input" value={testTool} onChange={e => setTestTool(e.target.value)} placeholder="e.g. get_account_balance" />
```

Pass `mcpTools` as a prop from `AuthorizeRulesPanel` down to `TestForm`.

---

## Files Touched

| File | Change type |
|---|---|
| `demo_api_ui/src/styles/rule-panel.css` | **New** — shared panel CSS classes |
| `demo_api_ui/src/components/WebMcpPanel.js` | **Edit** — adopt `rp-*` classes, update list/detail/button |
| `demo_api_ui/src/components/WebMcpPanel.css` | **Edit** — remove rules replaced by `rule-panel.css` |
| `demo_api_ui/src/components/AuthorizeRulesPanel.jsx` | **Edit** — adopt `rp-*` classes, ACR dropdown, MCP tool dropdown |

---

## Not Changing

- `WebMcpPanel` PageNav title ("WebMCP — Tool Inspector")
- `WebMcpPanel` toolbar education buttons
- HITL/step-up gate notice semantic colors
- Result banner semantic colors (success green, hitl amber, stepup blue, error red)
- Pipeline Events log / pre block styling
- Badge colors in `AuthorizeRulesPanel` (data-driven inline styles)
- Info chip colors in `RuleDetail` (data-driven inline styles)
- Any route handlers, API endpoints, or backend logic

---

## Success Criteria

1. `WebMcpPanel` inner panel list items use flat rows with indigo `#4f46e5` left-border selection — no bordered card buttons
2. `WebMcpPanel` detail pane title/desc/params/button visually match `AuthorizeRulesPanel` RuleDetail
3. `AuthorizeRulesPanel` ACR field is a `<select>` with options: (none), MFA, Single
4. `AuthorizeRulesPanel` MCP tool field is a `<select>` populated from live fetch; falls back to text input if MCP server is unavailable
5. `cd demo_api_ui && npm run build` exits 0
6. No regressions to existing AuthorizeRules test evaluation logic or MCP tool call logic
