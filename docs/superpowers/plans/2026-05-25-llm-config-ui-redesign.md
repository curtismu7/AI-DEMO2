# LLM Config UI Redesign + Agent Header Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "LLM only" checkbox from the agent header and redesign all three LLM provider config panels (Helix, Anthropic, LM Studio) with a consistent polished card design system.

**Architecture:** A new shared `LlmConfig.css` provides the `cfg-*` design token classes used by all three panels. `ProviderSelector.jsx` is rewritten as a segmented pill control. Each panel is restyled in place — no logic changes, only markup and CSS. `BankingAgent.js` loses one JSX block; `BankingAgent.css` loses four rules.

**Tech Stack:** React (JSX), plain CSS, CRA build (`npm run build` in `demo_api_ui/`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_ui/src/components/LlmConfig.css` | **Create** | Shared `cfg-*` design system — card shell, inputs, labels, buttons, badges |
| `demo_api_ui/src/components/ProviderSelector.jsx` | **Rewrite** | Segmented pill control replacing plain buttons |
| `demo_api_ui/src/components/LlmConfigPage.jsx` | **Modify** | Add page heading; import LlmConfig.css |
| `demo_api_ui/src/components/HelixPanel.jsx` | **Restyle** | Card shell + cfg-* classes; remove console.logs |
| `demo_api_ui/src/components/AnthropicPanel.jsx` | **Restyle** | Card shell + cfg-* classes |
| `demo_api_ui/src/components/LmStudioPanel.jsx` | **Restyle** | Card shell + cfg-* classes |
| `demo_api_ui/src/components/BankingAgent.js` | **Modify** | Remove ~13 lines of "LLM only" checkbox JSX |
| `demo_api_ui/src/components/BankingAgent.css` | **Modify** | Remove 4 `.ba-llm-mode-*` CSS rules |

---

## Task 1: Create shared `LlmConfig.css` design system

**Files:**
- Create: `demo_api_ui/src/components/LlmConfig.css`

- [ ] **Step 1: Create the CSS file**

```css
/* demo_api_ui/src/components/LlmConfig.css */
/* Shared design system for LLM provider config panels */

/* ── Page heading ───────────────────────────────────────────── */
.cfg-page-heading {
  margin-bottom: 1.75rem;
}
.cfg-page-heading h2 {
  margin: 0 0 0.35rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.cfg-page-heading p {
  margin: 0;
  font-size: 0.875rem;
  color: #64748b;
}

/* ── Provider selector label ────────────────────────────────── */
.cfg-provider-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
}

/* ── Segmented provider selector ────────────────────────────── */
.cfg-segment-wrap {
  display: inline-flex;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  overflow: hidden;
  background: #f1f5f9;
  padding: 3px;
  gap: 2px;
  margin-bottom: 1.75rem;
}
.cfg-segment-btn {
  padding: 9px 22px;
  background: transparent;
  color: #475569;
  border: none;
  border-radius: 9px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transition: background 0.1s, box-shadow 0.1s;
  font-family: inherit;
}
.cfg-segment-btn--active {
  background: #fff;
  color: #1e40af;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
}
.cfg-segment-status {
  font-size: 0.68rem;
  font-weight: 600;
}
.cfg-segment-status--active   { color: #16a34a; }
.cfg-segment-status--warn     { color: #d97706; }
.cfg-segment-status--error    { color: #dc2626; }
.cfg-segment-status--unknown  { color: #94a3b8; }

/* ── Card shell ─────────────────────────────────────────────── */
.cfg-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  max-width: 640px;
}
.cfg-card-header {
  padding: 1.1rem 1.5rem;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.cfg-card-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 2px;
}
.cfg-card-sub {
  font-size: 0.78rem;
  color: #64748b;
  margin: 0;
}
.cfg-card-sub a {
  color: #2563eb;
  text-decoration: none;
}
.cfg-card-sub a:hover {
  text-decoration: underline;
}
.cfg-card-body {
  padding: 1.5rem;
}

/* ── Status badge ───────────────────────────────────────────── */
.cfg-badge {
  padding: 3px 12px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
  flex-shrink: 0;
}
.cfg-badge--active        { background: #dcfce7; color: #15803d; }
.cfg-badge--unconfigured  { background: #fef9c3; color: #854d0e; }
.cfg-badge--unreachable   { background: #fee2e2; color: #991b1b; }
.cfg-badge--loading       { background: #f1f5f9; color: #64748b; }

/* ── Field grid ─────────────────────────────────────────────── */
.cfg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}
.cfg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cfg-field--full {
  grid-column: 1 / -1;
}

/* ── Labels & hints ─────────────────────────────────────────── */
.cfg-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.cfg-label-opt {
  font-weight: 400;
  text-transform: none;
  font-size: 0.72rem;
  color: #94a3b8;
  margin-left: 4px;
}
.cfg-hint {
  font-size: 0.72rem;
  color: #94a3b8;
  margin: 0;
}

/* ── Inputs & selects ───────────────────────────────────────── */
.cfg-input,
.cfg-select {
  padding: 9px 12px;
  border: 1.5px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.875rem;
  color: #111827;
  background: #fff;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}
.cfg-input:focus,
.cfg-select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}

/* ── Divider ────────────────────────────────────────────────── */
.cfg-divider {
  border: none;
  border-top: 1px solid #f1f5f9;
  margin: 0 0 1.25rem;
}

/* ── Action row ─────────────────────────────────────────────── */
.cfg-actions {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
}
.cfg-btn {
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.01em;
  white-space: nowrap;
  font-family: inherit;
  line-height: 1.2;
}
.cfg-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.cfg-btn--primary {
  background: #2563eb;
  color: #fff;
  border: none;
}
.cfg-btn--primary:hover:not(:disabled) { background: #1d4ed8; }
.cfg-btn--green {
  background: #059669;
  color: #fff;
  border: none;
}
.cfg-btn--green:hover:not(:disabled) { background: #047857; }
.cfg-btn--purple {
  background: #7c3aed;
  color: #fff;
  border: none;
}
.cfg-btn--purple:hover:not(:disabled) { background: #6d28d9; }
.cfg-btn--secondary {
  background: #f8fafc;
  color: #374151;
  border: 1.5px solid #e2e8f0;
  font-weight: 500;
}
.cfg-btn--secondary:hover:not(:disabled) { background: #f1f5f9; }
.cfg-btn--danger {
  background: #fff;
  color: #dc2626;
  border: 1.5px solid #fecaca;
  font-weight: 500;
  margin-left: auto;
}
.cfg-btn--danger:hover:not(:disabled) { background: #fef2f2; }

/* ── Info / setup boxes ─────────────────────────────────────── */
.cfg-info-box {
  padding: 0.875rem 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.82rem;
  color: #374151;
}
.cfg-info-box strong {
  display: block;
  margin-bottom: 0.35rem;
  color: #0f172a;
  font-size: 0.82rem;
}
.cfg-info-box ul {
  margin: 0;
  padding-left: 1.1rem;
  line-height: 1.7;
}
.cfg-setup-box {
  margin-bottom: 1.5rem;
  padding: 1rem 1.25rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.cfg-setup-box p {
  margin: 0 0 0.6rem;
  font-weight: 700;
  font-size: 0.85rem;
  color: #0f172a;
}
.cfg-setup-box ol {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
  color: #374151;
  line-height: 1.8;
}

/* ── Status row (LM Studio) ─────────────────────────────────── */
.cfg-status-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

/* ── Loaded model box ───────────────────────────────────────── */
.cfg-loaded-box {
  padding: 0.75rem 1rem;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
  margin-bottom: 1.25rem;
  font-size: 0.85rem;
  color: #166534;
  font-weight: 600;
}

/* ── Download progress box ──────────────────────────────────── */
.cfg-progress-box {
  padding: 0.875rem 1rem;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  border-radius: 10px;
  margin-top: 1rem;
}
.cfg-progress-box p {
  margin: 0 0 0.4rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: #5b21b6;
}
.cfg-progress-track {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 0.4rem;
}
.cfg-progress-fill {
  height: 100%;
  background: #7c3aed;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.cfg-progress-label {
  font-size: 0.78rem;
  color: #6b7280;
  margin: 0;
}

/* ── Code block ─────────────────────────────────────────────── */
.cfg-code {
  display: block;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: monospace;
  font-size: 0.82rem;
  color: #1f2937;
  user-select: all;
  margin: 0;
}
```

- [ ] **Step 2: Verify file created with no syntax errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: Build succeeds (CSS not imported yet — that's fine, just confirms no pre-existing breakage).

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/LlmConfig.css
git commit -m "feat(ui): add cfg-* shared design system for LLM config panels"
```

---

## Task 2: Remove "LLM only" checkbox from agent header

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js:6598-6611`
- Modify: `demo_api_ui/src/components/BankingAgent.css:4554-4571`

- [ ] **Step 1: Remove the JSX block from `BankingAgent.js`**

Find and remove this exact block (lines 6598–6611):

```jsx
                {/* LLM-only mode toggle — when checked, skips heuristic fast-path */}
                <label
                  className={`ba-rfc-toggle-label ba-llm-mode-label${!heuristicEnabled ? " ba-llm-mode-label--active" : ""}`}
                  title="LLM only: when on, all queries go through the LLM. When off, fast heuristic matching runs first with LLM as fallback."
                >
                  <input
                    type="checkbox"
                    checked={!heuristicEnabled}
                    disabled={llmFlagSaving}
                    onChange={(e) => toggleHeuristicMode(!e.target.checked)}
                    className="ba-rfc-toggle-cb ba-llm-mode-cb"
                  />
                  LLM only
                </label>
```

The result should be that the RFC info `<label>` is immediately followed by `{/* Five-mode agent provider selector — shared SSOT with /config */}`.

- [ ] **Step 2: Remove the 4 CSS rules from `BankingAgent.css`**

Find and remove these exact rules (lines 4554–4571):

```css
.ba-llm-mode-label {
  border-color: #d97706;
  color: #92400e;
}
.ba-llm-mode-label:hover {
  background: #fffbeb;
  border-color: #b45309;
  color: #78350f;
}
.ba-llm-mode-label--active {
  background: #fef3c7;
  border-color: #d97706;
  color: #92400e;
  font-weight: 700;
}
.ba-llm-mode-cb {
  accent-color: #d97706;
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.` — no warnings about undefined CSS classes.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/BankingAgent.css
git commit -m "feat(ui): remove LLM-only checkbox from agent header toolbar"
```

---

## Task 3: Rewrite `ProviderSelector.jsx` as segmented pill control

**Files:**
- Modify: `demo_api_ui/src/components/ProviderSelector.jsx`

- [ ] **Step 1: Replace the entire file content**

```jsx
// demo_api_ui/src/components/ProviderSelector.jsx
import './LlmConfig.css';

/**
 * ProviderSelector — segmented pill control: Helix | LM Studio | Anthropic
 *
 * Props:
 *   provider: 'helix' | 'anthropic-lmstudio' | 'anthropic'
 *   onSelect: (provider: string) => void
 *   helixStatus:     'available' | 'unconfigured' | 'unreachable' | null
 *   lmstudioStatus:  'available' | 'unreachable' | null
 *   anthropicStatus: 'available' | 'unconfigured' | null
 */
export default function ProviderSelector({ provider, onSelect, helixStatus, lmstudioStatus, anthropicStatus }) {
  const statusLabel = (s) => {
    if (s === 'available')    return '✅ Active';
    if (s === 'unconfigured') return '⚠️ Unconfigured';
    if (s === 'unreachable')  return '❌ Unreachable';
    return '';
  };

  const statusMod = (s) => {
    if (s === 'available')    return 'cfg-segment-status--active';
    if (s === 'unconfigured') return 'cfg-segment-status--warn';
    if (s === 'unreachable')  return 'cfg-segment-status--error';
    return 'cfg-segment-status--unknown';
  };

  const PROVIDERS = [
    { id: 'helix',            label: 'Helix',     sub: null,           status: helixStatus },
    { id: 'anthropic-lmstudio', label: 'LM Studio', sub: null,         status: lmstudioStatus },
    { id: 'anthropic',        label: 'Anthropic',  sub: null,           status: anthropicStatus },
  ];

  return (
    <div>
      <div className="cfg-segment-wrap">
        {PROVIDERS.map(({ id, label, status }) => (
          <button
            key={id}
            type="button"
            className={`cfg-segment-btn${provider === id ? ' cfg-segment-btn--active' : ''}`}
            onClick={() => onSelect(id)}
          >
            <span>{label}</span>
            {status && (
              <span className={`cfg-segment-status ${statusMod(status)}`}>
                {statusLabel(status)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/ProviderSelector.jsx
git commit -m "feat(ui): rewrite ProviderSelector as segmented pill control"
```

---

## Task 4: Update `LlmConfigPage.jsx` — add page heading

**Files:**
- Modify: `demo_api_ui/src/components/LlmConfigPage.jsx`

- [ ] **Step 1: Add heading and CSS import**

Replace the `return (` block's inner content. The full updated `return`:

```jsx
  return (
    <div className="page-container">
      <div className="cfg-page-heading">
        <h2>LLM Provider</h2>
        <p>Select and configure the language model used by the banking agent.</p>
      </div>
      <ProviderSelector
        provider={provider}
        onSelect={handleSelect}
        helixStatus={helixStatus}
        lmstudioStatus={lmstudioStatus}
        anthropicStatus={anthropicStatus}
      />
      {panel}
    </div>
  );
```

Also add the CSS import at the top of the file (after the existing imports):

```js
import './LlmConfig.css';
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/LlmConfigPage.jsx
git commit -m "feat(ui): add page heading to LlmConfigPage"
```

---

## Task 5: Restyle `HelixPanel.jsx`

**Files:**
- Modify: `demo_api_ui/src/components/HelixPanel.jsx`

- [ ] **Step 1: Replace the entire JSX return and add CSS import**

Add `import './LlmConfig.css';` at the top (after the existing imports).

Replace the entire `return (...)` with:

```jsx
  return (
    <div className="cfg-card">
      {/* Card header */}
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">Helix Configuration</p>
          <p className="cfg-card-sub">
            PingOne AI agent LLM ·{' '}
            <a href="https://openam-helix.forgeblocks.com" target="_blank" rel="noopener noreferrer">
              Open Helix Console ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${
          helixStatus === 'available'    ? ' cfg-badge--active' :
          helixStatus === 'unconfigured' ? ' cfg-badge--unconfigured' :
          helixStatus === 'unreachable'  ? ' cfg-badge--unreachable' :
          ' cfg-badge--loading'
        }`}>
          {helixStatus === 'available'    && 'Active'}
          {helixStatus === 'unconfigured' && 'Unconfigured'}
          {helixStatus === 'unreachable'  && 'Unreachable'}
          {helixStatus === null           && '…'}
        </span>
      </div>

      {/* Card body */}
      <div className="cfg-card-body">
        <div className="cfg-grid">
          <div className="cfg-field">
            <label className="cfg-label">Base URL</label>
            <input
              type="text"
              className="cfg-input"
              placeholder="https://openam-helix.forgeblocks.com"
              value={helixConfig.base_url}
              onChange={(e) => setHelixConfig({ ...helixConfig, base_url: e.target.value })}
            />
            <p className="cfg-hint">Your Helix tenant origin</p>
          </div>
          <div className="cfg-field">
            <label className="cfg-label">API Key</label>
            <input
              type="password"
              className="cfg-input"
              placeholder="Helix API Key"
              value={helixConfig.api_key}
              onChange={(e) => setHelixConfig({ ...helixConfig, api_key: e.target.value })}
            />
          </div>
          <div className="cfg-field">
            <label className="cfg-label">Environment ID</label>
            <input
              type="text"
              className="cfg-input"
              placeholder="Environment / Tenant ID"
              value={helixConfig.environment_id}
              onChange={(e) => setHelixConfig({ ...helixConfig, environment_id: e.target.value })}
            />
          </div>
          <div className="cfg-field">
            <label className="cfg-label">Agent Name</label>
            <input
              type="text"
              className="cfg-input"
              placeholder="my-banking-agent"
              value={helixConfig.agent_id}
              onChange={(e) => setHelixConfig({ ...helixConfig, agent_id: e.target.value })}
            />
          </div>
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label">Prompt Field ID</label>
            <input
              type="text"
              className="cfg-input"
              placeholder="e.g. textInputa7c39a0e8292"
              value={helixConfig.prompt_field_id}
              onChange={(e) => setHelixConfig({ ...helixConfig, prompt_field_id: e.target.value })}
            />
          </div>
        </div>

        <hr className="cfg-divider" />

        <div className="cfg-actions">
          <button
            type="button"
            className="cfg-btn cfg-btn--primary"
            onClick={handleHelixSave}
            disabled={
              helixSaving ||
              !helixConfig.base_url ||
              !helixConfig.api_key ||
              !helixConfig.environment_id ||
              !helixConfig.agent_id ||
              !helixConfig.prompt_field_id
            }
          >
            {helixSaving ? 'Saving…' : 'Save & Activate'}
          </button>
          <button
            type="button"
            className="cfg-btn cfg-btn--secondary"
            onClick={fetchHelixStatus}
            disabled={helixChecking}
          >
            {helixChecking ? 'Loading…' : 'Load from Database'}
          </button>
          <label className="cfg-btn cfg-btn--secondary">
            Import JSON
            <input type="file" accept=".json" onChange={handleImportJson} style={{ display: 'none' }} />
          </label>
          <button
            type="button"
            className="cfg-btn cfg-btn--danger"
            onClick={handleHelixClear}
            disabled={helixSaving}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Clear confirmation modal — unchanged */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ backgroundColor: '#fff', borderRadius: 8, padding: '2rem', maxWidth: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Clear Helix Configuration?</h3>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>This will delete your Helix configuration and cannot be undone.</p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                onClick={() => setShowClearConfirm(false)}
                disabled={helixSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cfg-btn cfg-btn--primary"
                style={{ background: '#dc2626' }}
                onClick={confirmHelixClear}
                disabled={helixSaving}
              >
                {helixSaving ? 'Clearing…' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
```

Also remove all `console.log` and `console.error` calls from the component (there are ~7 in the current file — delete each one).

- [ ] **Step 2: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/HelixPanel.jsx
git commit -m "feat(ui): restyle HelixPanel with cfg-* card design system"
```

---

## Task 6: Restyle `AnthropicPanel.jsx`

**Files:**
- Modify: `demo_api_ui/src/components/AnthropicPanel.jsx`

- [ ] **Step 1: Add CSS import and replace return block**

Add `import './LlmConfig.css';` at the top (after existing imports).

Replace the entire `return (...)` with:

```jsx
  return (
    <div className="cfg-card">
      {/* Card header */}
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">Anthropic Configuration</p>
          <p className="cfg-card-sub">
            Cloud API ·{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
              console.anthropic.com ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${keySet ? ' cfg-badge--active' : ' cfg-badge--unconfigured'}`}>
          {keySet ? 'Configured' : 'Unconfigured'}
        </span>
      </div>

      {/* Card body */}
      <div className="cfg-card-body">
        <div className="cfg-grid">
          {/* API Key */}
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label">API Key</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="password"
                className="cfg-input"
                placeholder={keySet ? 'Key saved — enter new key to rotate' : 'sk-ant-…'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="cfg-btn cfg-btn--primary"
                style={{ flexShrink: 0 }}
                disabled={saving || !apiKey.trim()}
                onClick={handleSaveKey}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="cfg-hint">
              {keySet ? '✅ API key is configured' : '⚠️ No API key — get one at console.anthropic.com'}
            </p>
            <p className="cfg-hint">Key is stored server-side only — never sent to the browser.</p>
          </div>

          {/* Model */}
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label">Model</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                className="cfg-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                style={{ flexShrink: 0 }}
                disabled={saving}
                onClick={handleSaveModel}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="cfg-hint">Claude 4 models require Claude 4 API access.</p>
          </div>

          {/* Base URL override */}
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label">
              Base URL Override
              <span className="cfg-label-opt">(optional)</span>
            </label>
            <input
              type="text"
              className="cfg-input"
              placeholder="Leave blank to use api.anthropic.com (default)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="cfg-hint">
              Set to <code style={{ fontFamily: 'monospace' }}>http://localhost:1234</code> to route through LM Studio locally.
            </p>
          </div>
        </div>

        {/* Info box */}
        <div className="cfg-info-box">
          <strong>Two modes</strong>
          <ul>
            <li><strong>Cloud</strong> — real API key, blank Base URL → calls api.anthropic.com</li>
            <li><strong>Local proxy</strong> — any key value, Base URL = <code style={{ fontFamily: 'monospace' }}>http://localhost:1234</code> → routes through LM Studio</li>
          </ul>
        </div>

        <hr className="cfg-divider" style={{ marginTop: '1.25rem' }} />

        <div className="cfg-actions">
          {keySet && (
            <button
              type="button"
              className="cfg-btn cfg-btn--danger"
              disabled={clearing}
              onClick={handleClearKey}
            >
              {clearing ? '…' : 'Clear Key'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/AnthropicPanel.jsx
git commit -m "feat(ui): restyle AnthropicPanel with cfg-* card design system"
```

---

## Task 7: Restyle `LmStudioPanel.jsx`

**Files:**
- Modify: `demo_api_ui/src/components/LmStudioPanel.jsx`

- [ ] **Step 1: Add CSS import**

Add `import './LlmConfig.css';` at the top of the file (after existing imports).

- [ ] **Step 2: Replace the entire return block**

```jsx
  return (
    <div className="cfg-card">
      {/* Card header */}
      <div className="cfg-card-header">
        <div>
          <p className="cfg-card-title">LM Studio Configuration</p>
          <p className="cfg-card-sub">
            Local inference via Anthropic API format ·{' '}
            <a href="https://lmstudio.ai/download" target="_blank" rel="noopener noreferrer">
              lmstudio.ai ↗
            </a>
          </p>
        </div>
        <span className={`cfg-badge${
          serverStatus === 'running'     ? ' cfg-badge--active' :
          serverStatus === 'unreachable' ? ' cfg-badge--unreachable' :
          ' cfg-badge--loading'
        }`}>
          {serverStatus === 'running'     && 'Running'}
          {serverStatus === 'unreachable' && 'Unreachable'}
          {(!serverStatus || checking)   && '…'}
        </span>
      </div>

      {/* Card body */}
      <div className="cfg-card-body">

        {/* Setup instructions — shown when server is not running */}
        {serverStatus !== 'running' && (
          <div className="cfg-setup-box">
            <p>Getting started with LM Studio</p>
            <ol>
              <li>
                Download and install from{' '}
                <a href="https://lmstudio.ai/download" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                  lmstudio.ai/download
                </a>
              </li>
              <li>
                Open LM Studio → <strong>Developer</strong> tab → start local server
                <code className="cfg-code" style={{ marginTop: '0.4rem' }}>Default port: 1234</code>
              </li>
              <li>Click <strong>Check Status</strong> below, then <strong>Download &amp; Load</strong> to set up Gemma.</li>
            </ol>
          </div>
        )}

        {/* Status row */}
        <div className="cfg-status-row">
          <span className={`cfg-badge${
            serverStatus === 'running'     ? ' cfg-badge--active' :
            serverStatus === 'unreachable' ? ' cfg-badge--unreachable' :
            ' cfg-badge--loading'
          }`} style={{ borderRadius: '8px' }}>
            {statusLabel}
          </span>
          <button
            type="button"
            className="cfg-btn cfg-btn--secondary"
            onClick={checkStatus}
            disabled={checking}
          >
            {checking ? '…' : 'Check Status'}
          </button>
        </div>

        {/* Server URL */}
        <div className="cfg-grid" style={{ marginBottom: '1.25rem' }}>
          <div className="cfg-field cfg-field--full">
            <label className="cfg-label">LM Studio Server URL</label>
            <input
              type="text"
              className="cfg-input"
              value={baseUrl}
              placeholder={DEFAULT_BASE_URL}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="cfg-hint">
              Default: {DEFAULT_BASE_URL} · Anthropic endpoint: <code style={{ fontFamily: 'monospace' }}>/v1/messages</code>
            </p>
          </div>
        </div>

        {/* Model section — only when server is running */}
        {serverStatus === 'running' && (
          <>
            {loadedModels.length > 0 && (
              <div className="cfg-loaded-box">
                ✅ Loaded in memory:{' '}
                {loadedModels.map((m) => m.display_name || m.key).join(', ')}
              </div>
            )}

            <div className="cfg-grid" style={{ marginBottom: '1rem' }}>
              <div className="cfg-field cfg-field--full">
                <label className="cfg-label">Model</label>
                <select
                  className="cfg-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {models.length > 0
                    ? models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.display_name || m.key}
                        {m.loaded ? ' (loaded)' : ' (not loaded)'}
                        {m.size_bytes ? ` — ${formatBytes(m.size_bytes)}` : ''}
                      </option>
                    ))
                    : <option value={DEFAULT_MODEL}>{DEFAULT_MODEL}</option>
                  }
                </select>
              </div>
            </div>
          </>
        )}

        {/* Download progress */}
        {downloadStatus && downloading && (
          <div className="cfg-progress-box">
            <p>Downloading {selectedModel}…</p>
            {downloadStatus.progress_pct != null && (
              <div className="cfg-progress-track">
                <div
                  className="cfg-progress-fill"
                  style={{ width: `${downloadStatus.progress_pct}%` }}
                />
              </div>
            )}
            <p className="cfg-progress-label">
              {downloadStatus.downloaded_bytes && downloadStatus.total_size_bytes
                ? `${formatBytes(downloadStatus.downloaded_bytes)} / ${formatBytes(downloadStatus.total_size_bytes)}`
                : 'Calculating…'}
              {downloadStatus.progress_pct != null ? ` (${downloadStatus.progress_pct}%)` : ''}
            </p>
          </div>
        )}

        <hr className="cfg-divider" style={{ marginTop: '1.25rem' }} />

        <div className="cfg-actions">
          {serverStatus === 'running' && (selectedDownloaded || models.length === 0) && !selectedLoaded && (
            <button
              type="button"
              className="cfg-btn cfg-btn--green"
              onClick={() => handleLoad(selectedModel)}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load Model'}
            </button>
          )}
          <button
            type="button"
            className="cfg-btn cfg-btn--purple"
            onClick={handleDownload}
            disabled={downloading || loading}
          >
            {downloading ? 'Downloading…' : 'Download & Load'}
          </button>
          {serverStatus === 'running' && (
            <button
              type="button"
              className="cfg-btn cfg-btn--secondary"
              onClick={handleSaveModel}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Model'}
            </button>
          )}
        </div>

        {/* Endpoint info */}
        {serverStatus === 'running' && (
          <div className="cfg-info-box" style={{ marginTop: '1.25rem' }}>
            <strong>Anthropic API endpoint</strong>
            <code className="cfg-code">{baseUrl}/v1/messages</code>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              x-api-key: any value accepted — LM Studio does not validate API keys.
              Model field must match the key shown above (e.g.{' '}
              <code style={{ fontFamily: 'monospace' }}>google/gemma-4-e2b</code>).
            </p>
          </div>
        )}

      </div>
    </div>
  );
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/LmStudioPanel.jsx
git commit -m "feat(ui): restyle LmStudioPanel with cfg-* card design system"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full build check**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```
Expected: `Compiled successfully.` with exit code 0.

- [ ] **Step 2: Run UI tests**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm run test:ui 2>&1 | tail -20
```
Expected: All tests pass. No regressions in `AgentModeSelector.test.jsx` or any banking agent tests.

- [ ] **Step 3: Spot-check no forbidden emoji**

```bash
grep -r "[^\x00-\x7F]" demo_api_ui/src/components/LlmConfig.css demo_api_ui/src/components/ProviderSelector.jsx demo_api_ui/src/components/LlmConfigPage.jsx demo_api_ui/src/components/HelixPanel.jsx demo_api_ui/src/components/AnthropicPanel.jsx demo_api_ui/src/components/LmStudioPanel.jsx 2>/dev/null | grep -v "✅\|⚠️\|❌" | head -5
```
Expected: No output (only the three permitted emoji are present).

- [ ] **Step 4: Final commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add -A
git commit -m "feat(ui): LLM config page redesign + agent header cleanup complete"
```
