# MCP Panel + Authorize Rules Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `WebMcpPanel` inner panel visuals to match `AuthorizeRulesPanel` design, and upgrade two Authorize Rules form fields to dropdowns (ACR select, MCP tool live-fetched select).

**Architecture:** Create a new shared `rule-panel.css` with `rp-*` CSS classes capturing the AuthorizeRules visual pattern (flat list with indigo left-border selection, detail pane, test form box, primary button). Migrate `AuthorizeRulesPanel.jsx` inline styles to these classes, and refactor `WebMcpPanel.js`/`WebMcpPanel.css` to use the same classes for its list and detail pane. Authorize Rules gains two improved form controls: ACR becomes a `<select>` (none/MFA/Single) and the MCP tool name becomes a live-fetched `<select>` with text-input fallback.

**Tech Stack:** React (CRA, `.js`/`.jsx` ES modules), plain CSS, existing `listMcpTools` service (`demo_api_ui/src/services/webMcpClient.js`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_ui/src/styles/rule-panel.css` | **Create** | Shared CSS classes for `rp-container`, `rp-header`, `rp-body`, `rp-list`, `rp-list-group-header`, `rp-list-hint`, `rp-list-item`, `rp-list-item--active`, `rp-list-item__name`, `rp-list-item__sub`, `rp-detail`, `rp-detail__title`, `rp-detail__desc`, `rp-test-form`, `rp-test-form__label`, `rp-test-form__input`, `rp-btn-primary` |
| `demo_api_ui/src/components/AuthorizeRulesPanel.jsx` | **Edit** | Swap inline styles → `rp-*` classes; ACR text → `<select>`; tool text → live-fetched `<select>` with fallback |
| `demo_api_ui/src/components/WebMcpPanel.js` | **Edit** | Import `rule-panel.css`; adopt `rp-*` classes for list, heading, hint, items, detail, params box, button |
| `demo_api_ui/src/components/WebMcpPanel.css` | **Edit** | Remove rules now covered by `rule-panel.css`; keep MCP-only rules (gate notices, stream log, result banners, spinners, error, placeholder, calling-status) |

---

## Task 1: Create `rule-panel.css`

**Files:**
- Create: `demo_api_ui/src/styles/rule-panel.css`

- [ ] **Step 1: Create the shared CSS file**

```css
/* demo_api_ui/src/styles/rule-panel.css
   Shared list+detail panel pattern used by AuthorizeRulesPanel and WebMcpPanel. */

/* ── Container ──────────────────────────────────────────────────────────── */

.rp-container {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  margin-bottom: 24px;
}

/* ── Header bar ─────────────────────────────────────────────────────────── */

.rp-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e5e5;
  background: #fafafa;
}

.rp-header__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #111;
}

.rp-header__sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: #666;
}

/* ── Body: flex row ─────────────────────────────────────────────────────── */

.rp-body {
  display: flex;
  min-height: 400px;
}

/* ── Left list column ───────────────────────────────────────────────────── */

.rp-list {
  width: 240px;
  min-width: 240px;
  border-right: 1px solid #e5e5e5;
  overflow-y: auto;
  background: #fff;
}

.rp-list-group-header {
  padding: 8px 12px 5px;
  font-size: 10px;
  font-weight: 700;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}

.rp-list-hint {
  font-size: 11px;
  color: #777;
  font-style: italic;
  padding: 5px 10px 4px;
  border-bottom: 1px solid #f3f3f3;
}

/* ── List items ─────────────────────────────────────────────────────────── */

.rp-list-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f3f3f3;
  border-left: 3px solid transparent;
  background: #fff;
  transition: background 0.1s;
  width: 100%;
  text-align: left;
  box-sizing: border-box;
}

.rp-list-item:hover {
  background: #f5f5f5;
}

.rp-list-item--active {
  border-left-color: #4f46e5;
  background: #eef2ff;
}

.rp-list-item__name {
  font-size: 12px;
  font-weight: 600;
  color: #111;
  margin-bottom: 3px;
}

.rp-list-item__sub {
  font-size: 11px;
  color: #777;
  line-height: 1.4;
  margin-bottom: 5px;
}

/* ── Right detail column ────────────────────────────────────────────────── */

.rp-detail {
  flex: 1;
  padding: 18px 20px;
  overflow-y: auto;
  background: #fff;
}

.rp-detail__title {
  font-size: 15px;
  font-weight: 700;
  color: #111;
  margin: 0 0 6px;
}

.rp-detail__desc {
  font-size: 13px;
  color: #444;
  line-height: 1.6;
  margin: 0 0 14px;
}

/* ── Test / params box ──────────────────────────────────────────────────── */

.rp-test-form {
  background: #f8f9fc;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 12px;
}

.rp-test-form__heading {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
}

.rp-test-form__row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.rp-test-form__field {
  flex: 1;
}

.rp-test-form__label {
  display: block;
  font-size: 11px;
  color: #666;
  margin-bottom: 4px;
}

.rp-test-form__input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  padding: 6px 10px;
  font-size: 12px;
  color: #111;
  background: #fff;
  box-sizing: border-box;
  font-family: inherit;
}

.rp-test-form__input:focus {
  outline: none;
  border-color: #4f46e5;
}

.rp-test-form__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* ── Primary button ─────────────────────────────────────────────────────── */

.rp-btn-primary {
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 7px 18px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.rp-btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.rp-btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Verify file exists**

```bash
ls demo_api_ui/src/styles/rule-panel.css
```

Expected: file listed with no error.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/styles/rule-panel.css
git commit -m "feat(ui): add shared rule-panel.css for list+detail panel pattern"
```

---

## Task 2: Migrate `AuthorizeRulesPanel.jsx` to `rp-*` classes

**Files:**
- Modify: `demo_api_ui/src/components/AuthorizeRulesPanel.jsx`

This task replaces all inline structural styles with `rp-*` classes. Data-driven inline styles (badge colors, chip colors, engine color) stay inline.

- [ ] **Step 1: Add the import at the top of `AuthorizeRulesPanel.jsx`**

After the existing `import bffAxios from '../services/bffAxios';` line, add:

```jsx
import '../styles/rule-panel.css';
```

- [ ] **Step 2: Replace the outer container and header in the `AuthorizeRulesPanel` return**

Find:
```jsx
  return (
    <div style={{ border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden', background: '#fff', marginBottom: '24px' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#111' }}>Authorize Rules</h3>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#666' }}>
          Browse the active authorization policy rules and test transactions against the engine.
        </p>
      </div>

      <div style={{ display: 'flex', minHeight: '400px' }}>
```

Replace with:
```jsx
  return (
    <div className="rp-container">
      <div className="rp-header">
        <h3 className="rp-header__title">Authorize Rules</h3>
        <p className="rp-header__sub">
          Browse the active authorization policy rules and test transactions against the engine.
        </p>
      </div>

      <div className="rp-body">
```

- [ ] **Step 3: Replace `RuleList` container and group headers**

Find the `RuleList` function body. Replace the `listStyle` object and its usage:

```jsx
function RuleList({ loading, error, txRules, mcpRules, selectedRuleId, onSelect }) {
  const listStyle = {
    width: '240px',
    minWidth: '240px',
    borderRight: '1px solid #e5e5e5',
    overflowY: 'auto',
    background: '#fff',
  };

  const groupHeaderStyle = {
    padding: '8px 12px 5px',
    fontSize: '10px',
    fontWeight: 700,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    borderBottom: '1px solid #f0f0f0',
    background: '#fafafa',
  };
```

Replace with:
```jsx
function RuleList({ loading, error, txRules, mcpRules, selectedRuleId, onSelect }) {
```

Then in the loading skeleton, replace `style={listStyle}` with `className="rp-list"`:
```jsx
  if (loading) {
    return (
      <div className="rp-list">
```

In the error state, replace `style={{ ...listStyle, padding: '16px 12px' }}` with `className="rp-list"` and add a `style={{ padding: '16px 12px' }}` on the inner content:
```jsx
  if (error) {
    return (
      <div className="rp-list" style={{ padding: '16px 12px' }}>
        <p style={{ fontSize: '12px', color: '#dc2626' }}>❌ {error}</p>
      </div>
    );
  }
```

In the main return, replace `<div style={listStyle}>` with `<div className="rp-list">`, and replace both instances of `<div style={groupHeaderStyle}>` with `<div className="rp-list-group-header">`:
```jsx
  return (
    <div className="rp-list">
      <div className="rp-list-group-header">Transaction Rules</div>
      {txRules.map(rule => (
        <RuleCard key={rule.id} rule={rule} selected={rule.id === selectedRuleId} onSelect={onSelect} />
      ))}
      <div className="rp-list-group-header" style={{ marginTop: '4px' }}>MCP Tool Rules</div>
      {mcpRules.map(rule => (
        <RuleCard key={rule.id} rule={rule} selected={rule.id === selectedRuleId} onSelect={onSelect} />
      ))}
    </div>
  );
```

- [ ] **Step 4: Replace `RuleCard` inline styles**

Find:
```jsx
function RuleCard({ rule, selected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(rule.id)}
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #f3f3f3',
        borderLeft: selected ? '3px solid #4f46e5' : '3px solid transparent',
        background: selected ? '#eef2ff' : '#fff',
        transition: 'background .1s',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '3px' }}>{rule.name}</div>
      <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.4, marginBottom: '5px' }}>{rule.chips.value !== NO_VALUE ? rule.chips.value : rule.chips.scope}</div>
      <Badge type={rule.badge} />
    </div>
  );
}
```

Replace with:
```jsx
function RuleCard({ rule, selected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(rule.id)}
      className={`rp-list-item${selected ? ' rp-list-item--active' : ''}`}
    >
      <div className="rp-list-item__name">{rule.name}</div>
      <div className="rp-list-item__sub">{rule.chips.value !== NO_VALUE ? rule.chips.value : rule.chips.scope}</div>
      <Badge type={rule.badge} />
    </div>
  );
}
```

- [ ] **Step 5: Replace `RuleDetail` outer container, title, and desc**

Find the `RuleDetail` function's outer `div` and inner title/desc:
```jsx
  return (
    <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto', background: '#fff' }}>
      {!rule && (
        <p style={{ color: '#999', fontSize: '13px' }}>Select a rule from the list.</p>
      )}

      {rule && (
        <>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '6px' }}>{rule.name}</div>
          <div style={{ fontSize: '13px', color: '#444', lineHeight: 1.6, marginBottom: '14px' }}>{rule.desc}</div>
```

Replace with:
```jsx
  return (
    <div className="rp-detail">
      {!rule && (
        <p style={{ color: '#999', fontSize: '13px' }}>Select a rule from the list.</p>
      )}

      {rule && (
        <>
          <div className="rp-detail__title">{rule.name}</div>
          <div className="rp-detail__desc">{rule.desc}</div>
```

- [ ] **Step 6: Replace `TestForm` box, labels, inputs, and button**

Find the `TestForm` function:
```jsx
function TestForm({ isMcp, testAmount, setTestAmount, testType, setTestType, testAcr, setTestAcr, testTool, setTestTool, testRunning, onRunTest, resultDisplay }) {
  const inputStyle = { width: '100%', border: '1px solid #d1d5db', borderRadius: '5px', padding: '6px 10px', fontSize: '12px', color: '#111', background: '#fff', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontSize: '11px', color: '#666', marginBottom: '4px' };

  return (
    <div style={{ background: '#f8f9fc', border: '1px solid #e5e5e5', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
        Test this rule
      </div>

      {isMcp ? (
        <div style={{ marginBottom: '10px' }}>
          <label style={labelStyle}>Tool name</label>
          <input style={inputStyle} value={testTool} onChange={e => setTestTool(e.target.value)} placeholder="e.g. get_account_balance" />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Amount (USD)</label>
            <input style={inputStyle} type="number" value={testAmount} onChange={e => setTestAmount(e.target.value)} placeholder="e.g. 300" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Transaction type</label>
            <select style={inputStyle} value={testType} onChange={e => setTestType(e.target.value)}>
              <option value="deposit">deposit</option>
              <option value="withdrawal">withdrawal</option>
              <option value="transfer">transfer</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>ACR (optional)</label>
            <input style={inputStyle} value={testAcr} onChange={e => setTestAcr(e.target.value)} placeholder="e.g. MFA" />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={onRunTest}
          disabled={testRunning}
          style={{ background: testRunning ? '#6366f1' : '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '12px', fontWeight: 600, cursor: testRunning ? 'default' : 'pointer', opacity: testRunning ? 0.8 : 1 }}
        >
          {testRunning ? 'Evaluating…' : 'Run evaluation'}
        </button>
        {resultDisplay}
      </div>
    </div>
  );
}
```

Replace the entire `TestForm` function with:
```jsx
function TestForm({ isMcp, mcpTools, testAmount, setTestAmount, testType, setTestType, testAcr, setTestAcr, testTool, setTestTool, testRunning, onRunTest, resultDisplay }) {
  return (
    <div className="rp-test-form">
      <div className="rp-test-form__heading">Test this rule</div>

      {isMcp ? (
        <div style={{ marginBottom: '10px' }}>
          <label className="rp-test-form__label">Tool name</label>
          {mcpTools.length > 0 ? (
            <select className="rp-test-form__input" value={testTool} onChange={e => setTestTool(e.target.value)}>
              <option value="">— select a tool —</option>
              {mcpTools.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input className="rp-test-form__input" value={testTool} onChange={e => setTestTool(e.target.value)} placeholder="e.g. get_account_balance" />
          )}
        </div>
      ) : (
        <div className="rp-test-form__row">
          <div className="rp-test-form__field">
            <label className="rp-test-form__label">Amount (USD)</label>
            <input className="rp-test-form__input" type="number" value={testAmount} onChange={e => setTestAmount(e.target.value)} placeholder="e.g. 300" />
          </div>
          <div className="rp-test-form__field">
            <label className="rp-test-form__label">Transaction type</label>
            <select className="rp-test-form__input" value={testType} onChange={e => setTestType(e.target.value)}>
              <option value="deposit">deposit</option>
              <option value="withdrawal">withdrawal</option>
              <option value="transfer">transfer</option>
            </select>
          </div>
          <div className="rp-test-form__field">
            <label className="rp-test-form__label">ACR</label>
            <select className="rp-test-form__input" value={testAcr} onChange={e => setTestAcr(e.target.value)}>
              <option value="">(none)</option>
              <option value="MFA">MFA</option>
              <option value="Single">Single</option>
            </select>
          </div>
        </div>
      )}

      <div className="rp-test-form__actions">
        <button
          className="rp-btn-primary"
          onClick={onRunTest}
          disabled={testRunning}
        >
          {testRunning ? 'Evaluating…' : 'Run evaluation'}
        </button>
        {resultDisplay}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add `mcpTools` state + fetch to `AuthorizeRulesPanel`**

At the top of `AuthorizeRulesPanel.jsx`, add the `listMcpTools` import alongside the existing `bffAxios` import:

```jsx
import { listMcpTools } from '../services/webMcpClient';
```

Inside the `AuthorizeRulesPanel` component function, after the existing state declarations, add:

```jsx
const [mcpTools, setMcpTools] = useState([]);

useEffect(() => {
  listMcpTools()
    .then(data => setMcpTools((data.tools || []).map(t => t.name)))
    .catch(() => {}); // silent — fallback shows text input
}, []);
```

- [ ] **Step 8: Pass `mcpTools` down to `TestForm` via `RuleDetail`**

In the `RuleDetail` function signature, add `mcpTools` to the destructured props:

```jsx
function RuleDetail({
  rule, activeEngine,
  mcpTools,
  testAmount, setTestAmount, testType, setTestType,
  testAcr, setTestAcr, testTool, setTestTool,
  testRunning, testResult, testError, onRunTest,
}) {
```

In `RuleDetail`'s JSX, pass `mcpTools` to `TestForm`:
```jsx
              <TestForm
                isMcp={isMcp}
                mcpTools={mcpTools}
                testAmount={testAmount} setTestAmount={setTestAmount}
                testType={testType} setTestType={setTestType}
                testAcr={testAcr} setTestAcr={setTestAcr}
                testTool={testTool} setTestTool={setTestTool}
                testRunning={testRunning}
                onRunTest={onRunTest}
                resultDisplay={resultNode}
              />
```

In `AuthorizeRulesPanel`'s return, pass `mcpTools` to `RuleDetail`:
```jsx
        <RuleDetail
          rule={selectedRule}
          activeEngine={activeEngine}
          mcpTools={mcpTools}
          testAmount={testAmount}
          setTestAmount={setTestAmount}
          testType={testType}
          setTestType={setTestType}
          testAcr={testAcr}
          setTestAcr={setTestAcr}
          testTool={testTool}
          setTestTool={setTestTool}
          testRunning={testRunning}
          testResult={testResult}
          testError={testError}
          onRunTest={() => selectedRule && handleRunTest(selectedRule)}
        />
```

- [ ] **Step 9: Build and verify**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: output ends with `Compiled successfully.` and exit code 0.

- [ ] **Step 10: Commit**

```bash
git add demo_api_ui/src/components/AuthorizeRulesPanel.jsx
git commit -m "feat(ui): migrate AuthorizeRulesPanel to rp-* classes; ACR + MCP tool dropdowns"
```

---

## Task 3: Refactor `WebMcpPanel.js` to use `rp-*` classes

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.js`

- [ ] **Step 1: Add import for `rule-panel.css`**

In `WebMcpPanel.js`, the imports section currently ends with:
```jsx
import "../styles/appShellPages.css";
import "./WebMcpPanel.css";
```

Add the new import between them:
```jsx
import "../styles/appShellPages.css";
import "../styles/rule-panel.css";
import "./WebMcpPanel.css";
```

- [ ] **Step 2: Replace the outer panel and body**

Find:
```jsx
        <div className="webmcp-panel">
          {loading && !selectedTool && (
            <div className="webmcp-loading">Loading tools…</div>
          )}

          {error && !selectedTool && (
            <div className="webmcp-error">
              <p>{error.message}</p>
              <details>
                <summary>Technical details</summary>
                <pre>{error.details}</pre>
              </details>
            </div>
          )}

          <div className="webmcp-body">
```

Replace with:
```jsx
        <div className="rp-container" style={{ margin: '16px 0' }}>
          {loading && !selectedTool && (
            <div className="webmcp-loading">Loading tools…</div>
          )}

          {error && !selectedTool && (
            <div className="webmcp-error">
              <p>{error.message}</p>
              <details>
                <summary>Technical details</summary>
                <pre>{error.details}</pre>
              </details>
            </div>
          )}

          <div className="rp-body">
```

Close tag: find `</div>` that closes `webmcp-body`, then `</div>` that closes `webmcp-panel` — these stay as-is (just class names changed).

- [ ] **Step 3: Replace the tool list column**

Find:
```jsx
            <div className="webmcp-tool-list">
              <h4>Available Tools ({tools.length})</h4>
              {tools.length > 0 && (
                <p className="webmcp-tool-hint">Select a tool to inspect and call it</p>
              )}
```

Replace with:
```jsx
            <div className="rp-list">
              <div className="rp-list-group-header">Available Tools ({tools.length})</div>
              {tools.length > 0 && (
                <div className="rp-list-hint">Select a tool to inspect and call it</div>
              )}
```

- [ ] **Step 4: Replace tool item buttons with flat `rp-list-item` rows**

Find the entire tool map block:
```jsx
              {tools.map((tool) => {
                const isHitl = HITL_TOOLS.has(tool.name);
                const isStepUp = STEPUP_TOOLS.has(tool.name);
                return (
                  <button
                    key={tool.name}
                    type="button"
                    className={`webmcp-tool-item${selectedTool?.name === tool.name ? " active" : ""}`}
                    onClick={() => selectTool(tool)}
                  >
                    <span className="webmcp-tool-name">{tool.name}</span>
                    <span className="webmcp-tool-desc">{tool.description}</span>
                    {isHitl && (
                      <span className="webmcp-tool-badge webmcp-tool-badge--hitl">
                        Requires consent
                      </span>
                    )}
                    {isStepUp && (
                      <span className="webmcp-tool-badge webmcp-tool-badge--stepup">
                        Requires step-up
                      </span>
                    )}
                  </button>
                );
              })}
```

Replace with:
```jsx
              {tools.map((tool) => {
                const isHitl = HITL_TOOLS.has(tool.name);
                const isStepUp = STEPUP_TOOLS.has(tool.name);
                return (
                  <div
                    key={tool.name}
                    className={`rp-list-item${selectedTool?.name === tool.name ? " rp-list-item--active" : ""}`}
                    onClick={() => selectTool(tool)}
                  >
                    <div className="rp-list-item__name">{tool.name}</div>
                    <div className="rp-list-item__sub">{tool.description}</div>
                    {isHitl && (
                      <span className="webmcp-tool-badge webmcp-tool-badge--hitl">
                        Requires consent
                      </span>
                    )}
                    {isStepUp && (
                      <span className="webmcp-tool-badge webmcp-tool-badge--stepup">
                        Requires step-up
                      </span>
                    )}
                  </div>
                );
              })}
```

- [ ] **Step 5: Replace the tool detail column header and description**

Find:
```jsx
            {selectedTool && (
              <div className="webmcp-tool-detail">
                <h4>{selectedTool.name}</h4>
                <p className="webmcp-tool-detail-desc">
                  {selectedTool.description}
                </p>
```

Replace with:
```jsx
            {selectedTool && (
              <div className="rp-detail">
                <div className="rp-detail__title">{selectedTool.name}</div>
                <div className="rp-detail__desc">
                  {selectedTool.description}
                </div>
```

- [ ] **Step 6: Replace parameters box and label/input/button**

Find:
```jsx
                {Object.keys(schemaProps).length > 0 && (
                  <div className="webmcp-params">
                    <h5>Parameters</h5>
                    {Object.entries(schemaProps).map(([key, schema]) => (
                      <label key={key} className="webmcp-param-label">
                        <span>
                          {key}
                          {requiredFields.includes(key) && (
                            <span className="webmcp-required">*</span>
                          )}
                          {schema.description && (
                            <span className="webmcp-param-hint">
                              {" "}— {schema.description}
                            </span>
                          )}
                        </span>
                        <input
                          type="text"
                          className="webmcp-param-input"
                          value={params[key] || ""}
                          onChange={(e) =>
                            handleParamChange(key, e.target.value)
                          }
                          placeholder={schema.type || ""}
                        />
                      </label>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className={`webmcp-call-btn${loading ? " webmcp-call-btn--loading" : ""}`}
                  onClick={callSelectedTool}
                  disabled={loading}
                >
                  {loading && <span className="webmcp-btn-spinner" aria-hidden="true" />}
                  {loading ? "Calling…" : "Call Tool"}
                </button>
```

Replace with:
```jsx
                {Object.keys(schemaProps).length > 0 && (
                  <div className="rp-test-form">
                    <div className="rp-test-form__heading">Parameters</div>
                    {Object.entries(schemaProps).map(([key, schema]) => (
                      <div key={key} style={{ marginBottom: '10px' }}>
                        <label className="rp-test-form__label">
                          {key}
                          {requiredFields.includes(key) && (
                            <span className="webmcp-required">*</span>
                          )}
                          {schema.description && (
                            <span style={{ color: '#999', fontStyle: 'italic' }}>
                              {" "}— {schema.description}
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          className="rp-test-form__input"
                          value={params[key] || ""}
                          onChange={(e) =>
                            handleParamChange(key, e.target.value)
                          }
                          placeholder={schema.type || ""}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="rp-btn-primary"
                  onClick={callSelectedTool}
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}
                >
                  {loading && <span className="webmcp-btn-spinner" aria-hidden="true" />}
                  {loading ? "Calling…" : "Call Tool"}
                </button>
```

- [ ] **Step 7: Build and verify**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.` with exit 0.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/WebMcpPanel.js
git commit -m "feat(ui): refactor WebMcpPanel list+detail to rp-* shared classes"
```

---

## Task 4: Clean up `WebMcpPanel.css`

**Files:**
- Modify: `demo_api_ui/src/components/WebMcpPanel.css`

Remove the CSS rules that are now covered by `rule-panel.css`. Keep everything that is MCP-specific.

- [ ] **Step 1: Remove rules now covered by `rule-panel.css`**

Delete the following blocks entirely from `WebMcpPanel.css` (these are now replaced by `rp-*` classes):

- `.webmcp-panel { ... }` — replaced by `.rp-container`
- `.webmcp-body { ... }` — replaced by `.rp-body`
- `.webmcp-tool-list { ... }` — replaced by `.rp-list`
- `.webmcp-tool-list h4 { ... }` — replaced by `.rp-list-group-header`
- `.webmcp-tool-hint { ... }` — replaced by `.rp-list-hint`
- `.webmcp-tool-item { ... }` — replaced by `.rp-list-item`
- `.webmcp-tool-item:hover { ... }` — replaced by `.rp-list-item:hover`
- `.webmcp-tool-item.active { ... }` — replaced by `.rp-list-item--active`
- `.webmcp-tool-name { ... }` — replaced by `.rp-list-item__name`
- `.webmcp-tool-desc { ... }` — replaced by `.rp-list-item__sub`
- `.webmcp-tool-detail { ... }` — replaced by `.rp-detail`
- `.webmcp-tool-detail h4 { ... }` — replaced by `.rp-detail__title`
- `.webmcp-tool-detail-desc { ... }` — replaced by `.rp-detail__desc`
- `.webmcp-params { ... }` — replaced by `.rp-test-form`
- `.webmcp-params h5 { ... }` — replaced by `.rp-test-form__heading`
- `.webmcp-param-label { ... }` — replaced by `.rp-test-form__label` (with minor restructure)
- `.webmcp-param-input { ... }` and `.webmcp-param-input:focus { ... }` — replaced by `.rp-test-form__input`
- `.webmcp-call-btn { ... }`, `.webmcp-call-btn:hover:not(:disabled) { ... }`, `.webmcp-call-btn:disabled { ... }` — replaced by `.rp-btn-primary`

**Keep these MCP-specific rules** (do not remove):
- `.webmcp-loading`
- `.webmcp-tool-placeholder`
- `.webmcp-tool-badge`, `.webmcp-tool-badge--hitl`, `.webmcp-tool-badge--stepup`
- `.webmcp-gate-notice` and all variants/children
- `@keyframes webmcp-spin`
- `.webmcp-btn-spinner`
- `.webmcp-calling-status` and `.webmcp-calling-spinner`
- `.webmcp-stream-log`, `.webmcp-stream-log h5`, `.webmcp-stream-event`
- `.webmcp-result`, `.webmcp-result h5`, `.webmcp-result pre`
- `.webmcp-result-context` and all variants/children
- `.webmcp-error` and all children
- `.webmcp-required` and `.webmcp-param-hint` (still referenced for the required asterisk and hint span)

The file after cleanup should be roughly half its current size.

- [ ] **Step 2: Build and verify**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.` with exit 0.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/WebMcpPanel.css
git commit -m "chore(ui): remove WebMcpPanel.css rules now covered by rule-panel.css"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full UI build one final time from repo root**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 2: Verify no UI test regressions**

```bash
cd /Users/curtismuir/Development/AI-Demo && npm run test:ui -- --watchAll=false 2>&1 | tail -20
```

Expected: all tests pass (no failures introduced).

- [ ] **Step 3: Manual smoke check (if services are running)**

If `./run.sh status` shows services up:
1. Navigate to the dashboard (`https://api.ping.demo:4000/dashboard`)
2. Check the Authorize Rules panel — list items should have indigo left-border selection, ACR field should be a `<select>` showing `(none)` / `MFA` / `Single`, MCP rule tool field should be a `<select>` populated with real tool names
3. Navigate to the WebMCP page — tool list items should be flat rows with indigo left-border selection (no card borders), detail pane title/desc should be `#111`/`#444`, params box should have light `#f8f9fc` background, "Call Tool" button should be indigo

- [ ] **Step 4: Final commit**

```bash
git add -A
git status
# Confirm only expected files changed — nothing else
git commit -m "chore(ui): verify alignment — no stray changes" --allow-empty
```

(Use `--allow-empty` only if everything was already committed in earlier tasks. If there are remaining changes, commit them with an appropriate message.)
