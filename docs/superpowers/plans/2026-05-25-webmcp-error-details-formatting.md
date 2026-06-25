# WebMCP Error Details Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreadable raw-JSON wall of text in the WebMCP error panel with a structured display: HTTP status line + summary key-value table + collapsible full pretty-printed JSON.

**Architecture:** Restructure the `error` state object in `WebMcpPanel.js` at catch time (parse `err.body` into `parsedBody` + `summary`), then update both render sites to use the new shape. Add three CSS rule blocks for the new sub-elements.

**Tech Stack:** React (CRA), plain CSS, no new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `demo_api_ui/src/components/WebMcpPanel.js` | Catch block + 2 render sites |
| `demo_api_ui/src/components/WebMcpPanel.css` | 3 new rule blocks |

---

### Task 1: Restructure error state in the catch block

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.js` (the `catch` block around line 251)

The existing catch block:
```js
} catch (err) {
  setError({
    message: "Tool call failed — check connection or permissions.",
    details: `${err.message}${err.body ? "\n" + err.body : ""}`,
  });
}
```

- [ ] **Step 1: Replace the catch block with the structured version**

Open `demo_api_ui/src/components/WebMcpPanel.js`. Find the catch block (around line 251). Replace it with:

```js
} catch (err) {
  let parsedBody = null;
  if (err.body) {
    try { parsedBody = JSON.parse(err.body); } catch (_) {}
  }
  setError({
    message: "Tool call failed — check connection or permissions.",
    statusLine: err.message,
    summary: parsedBody ? {
      error:             parsedBody.error,
      error_description: parsedBody.error_description,
      authorize_engine:  parsedBody.authorize_engine,
      decisionContext:   parsedBody.decisionContext,
      decisionId:        parsedBody.decisionId,
    } : null,
    parsedBody: parsedBody || null,
    rawBody:    parsedBody ? null : (err.body || null),
  });
}
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0, no errors about `details` or `statusLine`.

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/WebMcpPanel.js
git commit -m "refactor(webmcp): restructure error state to parse body JSON at catch time"
```

---

### Task 2: Update the no-tool-selected error render site

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.js` (lines ~340–348 — the first error render, shown when no tool is selected)

The existing render:
```jsx
{error && !selectedTool && (
  <div className="webmcp-error">
    <p>{error.message}</p>
    <details>
      <summary>Technical details</summary>
      <pre>{error.details}</pre>
    </details>
  </div>
)}
```

- [ ] **Step 1: Replace the first error render block**

Find the block starting with `{error && !selectedTool && (` (around line 340). Replace it with:

```jsx
{error && !selectedTool && (
  <div className="webmcp-error">
    <p>{error.message}</p>
    <details>
      <summary>Technical details</summary>
      <p className="webmcp-error__status">{error.statusLine}</p>
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
      {error.parsedBody && error.summary && (
        <details className="webmcp-error__full">
          <summary>Full response</summary>
          <pre>{JSON.stringify(error.parsedBody, null, 2)}</pre>
        </details>
      )}
      {error.rawBody && (
        <pre>{error.rawBody}</pre>
      )}
    </details>
  </div>
)}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/WebMcpPanel.js
git commit -m "feat(webmcp): structured error display — no-tool-selected render site"
```

---

### Task 3: Update the tool-detail-panel error render site

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.js` (lines ~557–565 — the second error render, shown inside the tool detail panel)

The existing render:
```jsx
{error && (
  <div className="webmcp-error">
    <p>{error.message}</p>
    <details>
      <summary>Technical details</summary>
      <pre>{error.details}</pre>
    </details>
  </div>
)}
```

Note: this block is inside the `{selectedTool && ( ... )}` block, so there is no `!selectedTool` guard.

- [ ] **Step 1: Replace the second error render block**

Find the block starting with `{error && (` inside the `selectedTool` section (around line 557). Replace it with:

```jsx
{error && (
  <div className="webmcp-error">
    <p>{error.message}</p>
    <details>
      <summary>Technical details</summary>
      <p className="webmcp-error__status">{error.statusLine}</p>
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
      {error.parsedBody && error.summary && (
        <details className="webmcp-error__full">
          <summary>Full response</summary>
          <pre>{JSON.stringify(error.parsedBody, null, 2)}</pre>
        </details>
      )}
      {error.rawBody && (
        <pre>{error.rawBody}</pre>
      )}
    </details>
  </div>
)}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/WebMcpPanel.js
git commit -m "feat(webmcp): structured error display — tool-detail render site"
```

---

### Task 4: Add CSS rules for the new error sub-elements

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.css` (append at end of file)

- [ ] **Step 1: Append the three new rule blocks to WebMcpPanel.css**

Open `demo_api_ui/src/components/WebMcpPanel.css` and append at the very end:

```css
/* ── Error detail sub-elements ──────────────────────────────────────────── */

.webmcp-error__status {
  margin: 6px 0 8px;
  font-family: monospace;
  font-size: 12px;
  color: #94a3b8;
}

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

- [ ] **Step 2: Verify build**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/WebMcpPanel.css
git commit -m "feat(webmcp): CSS for structured error detail sub-elements"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start the app**

```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh
```

Wait until UI is available at `https://api.ping.demo:4000`.

- [ ] **Step 2: Trigger a 428 HITL error**

1. Log in as a demo user
2. Navigate to WebMCP (the tool inspector panel)
3. Select a tool that requires HITL consent (e.g. `transfer_funds` — marked "Requires consent")
4. Click the call button without completing consent
5. Observe the error panel

**Expected output:**
- Red banner: "Tool call failed — check connection or permissions."
- "Technical details" collapsible (collapsed by default)
- When expanded: muted monospace HTTP status line (e.g. "callMcpTool failed: 428")
- Key-value summary table with rows for `error`, `error_description`, `authorize_engine`, `decisionContext`, `decisionId`
- Nested "Full response" collapsible with indented JSON (scrollable, max 300px height)

- [ ] **Step 3: Verify plain-text error fallback**

Temporarily stop the MCP server (`./run.sh stop` then restart without the MCP service), trigger a tool call, and verify the error panel falls back to showing `<pre>{rawBody}</pre>` with the plain text response — no broken table or blank summary.

Restart all services afterward: `./run.sh`

- [ ] **Step 4: Run the full test suite**

```bash
cd /Users/curtismuir/Development/AI-Demo && npm test 2>&1 | tail -30
```

Expected: all suites pass (no regressions introduced — no test files were changed).
