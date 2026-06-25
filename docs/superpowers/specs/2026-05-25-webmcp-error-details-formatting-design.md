# WebMCP Error Details Formatting — Design Spec

**Date:** 2026-05-25  
**Status:** Approved  
**Scope:** `WebMcpPanel.js`, `WebMcpPanel.css`

---

## Problem

When a BFF call returns an HTTP error (e.g. 428 HITL-required), the error body is a JSON object containing rich debugging fields (`error`, `error_description`, `tokenEvents`, etc.). The current implementation concatenates the HTTP status message and the raw JSON string into a single `error.details` string and renders it in a `<pre>` — producing an unreadable wall of compact JSON text.

---

## Goal

Replace the unformatted raw-text dump with a structured two-level display:

1. **Summary table** — the meaningful top-level fields (`error`, `error_description`, `authorize_engine`, `decisionContext`, `decisionId`)
2. **Collapsible full response** — the complete JSON body, pretty-printed, nested inside a second `<details>` element

Non-JSON error bodies (plain text errors, network failures) fall back to the current `<pre>` rendering unchanged.

---

## Data Shape Change

### Before

```js
setError({
  message: "Tool call failed — check connection or permissions.",
  details: `${err.message}${err.body ? "\n" + err.body : ""}`,
});
```

`error.details` is a single concatenated string — HTTP status line + raw body.

### After

```js
let parsedBody = null;
if (err.body) {
  try { parsedBody = JSON.parse(err.body); } catch (_) {}
}
setError({
  message: "Tool call failed — check connection or permissions.",
  statusLine: err.message,           // e.g. "callMcpTool failed: 428"
  summary: parsedBody ? {
    error:            parsedBody.error,
    error_description: parsedBody.error_description,
    authorize_engine: parsedBody.authorize_engine,
    decisionContext:  parsedBody.decisionContext,
    decisionId:       parsedBody.decisionId,
  } : null,
  parsedBody: parsedBody || null,    // parsed object (null if body wasn't JSON)
  rawBody:    parsedBody ? null : (err.body || null),  // raw string fallback for non-JSON bodies
});
```

**Why parse at catch time (not render time):** `err.body` is the raw string; by the time it's rendered the HTTP status message has been prepended in previous code. Parsing at catch time gives clean access to both pieces without fragile string-splitting.

---

## Render Structure

Both error render sites in `WebMcpPanel.js` (one for no-tool-selected state, one inside the tool detail panel) use the same structure:

```jsx
{error && (
  <div className="webmcp-error">
    <p>{error.message}</p>
    <details>
      <summary>Technical details</summary>
      <p className="webmcp-error__status">{error.statusLine}</p>

      {/* Summary table — shown when body was valid JSON */}
      {error.summary && (
        <table className="webmcp-error__summary">
          <tbody>
            {Object.entries(error.summary)
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {/* Full response — nested collapsible, pretty-printed JSON */}
      {error.parsedBody && error.summary && (
        <details className="webmcp-error__full">
          <summary>Full response</summary>
          <pre>{JSON.stringify(error.parsedBody, null, 2)}</pre>
        </details>
      )}

      {/* Fallback — plain text body when JSON parse failed */}
      {error.rawBody && (
        <pre>{error.rawBody}</pre>
      )}
    </details>
  </div>
)}
```

**Notes:**
- `JSON.parse(error.rawBody)` in render is safe because `error.summary` being non-null guarantees the parse already succeeded in the catch block
- `Object.entries(error.summary).filter(([, v]) => v != null)` hides fields absent from this particular error response — not all errors include all five fields
- The outer `<details>` (Technical details) remains collapsed by default, matching current UX

---

## CSS Additions

Three new rule blocks appended to `WebMcpPanel.css`:

### `.webmcp-error__status`
Small, muted monospace line showing the HTTP status string (e.g. "callMcpTool failed: 428"). Visually de-emphasised — it's secondary context.

```css
.webmcp-error__status {
  margin: 6px 0 8px;
  font-family: monospace;
  font-size: 12px;
  color: #94a3b8;
}
```

### `.webmcp-error__summary`
Compact key-value table. Keys right-aligned in muted color; values left-aligned in monospace. No borders — uses row spacing only.

```css
.webmcp-error__summary {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-bottom: 10px;
}
.webmcp-error__summary th {
  text-align: right;
  padding: 2px 8px 2px 0;
  color: #94a3b8;
  font-weight: 500;
  white-space: nowrap;
  vertical-align: top;
  width: 1%;
}
.webmcp-error__summary td {
  text-align: left;
  padding: 2px 0;
  font-family: monospace;
  color: #1e293b;
  word-break: break-word;
}
```

### `.webmcp-error__full`
Nested `<details>` element with slight left indent to visually separate it from the summary table. Font size stepped down a level — this is diagnostic detail, not primary information.

```css
.webmcp-error__full {
  margin-top: 8px;
  padding-left: 8px;
  border-left: 2px solid #e2e8f0;
}
.webmcp-error__full > summary {
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
}
.webmcp-error__full pre {
  margin: 6px 0 0;
  font-size: 11px;
  max-height: 300px;
  overflow-y: auto;
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `demo_api_ui/src/components/WebMcpPanel.js` | Catch block: parse body, restructure `setError()`; two render sites: replace `<pre>` with structured output |
| `demo_api_ui/src/components/WebMcpPanel.css` | Three new rule blocks: `__status`, `__summary`, `__full` |

## Files Unchanged

- `demo_api_ui/src/services/webMcpClient.js` — error throw shape stays the same
- `demo_api_ui/src/components/TokenChainDisplay.js` — not in scope
- All other components

---

## Success Criteria

1. A 428 HITL-required error shows: red banner message → "Technical details" collapsible → HTTP status line + summary table (error, error_description, authorize_engine, decisionContext, decisionId) + nested "Full response" collapsible with pretty-printed JSON
2. A plain-text error (e.g. network failure where `err.body` is not JSON) falls back to the existing `<pre>` rendering unchanged
3. `cd demo_api_ui && npm run build` exits 0
4. No other panels or components are changed
