# Helix / Ollama Provider Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unused `LlmConfigPanel` on the LLM config page with a simple two-option provider selector (Helix | Ollama) above the existing `HelixPanel`, and show an `OllamaPanel` when Ollama is selected.

**Architecture:** `LlmConfigPage` is restructured to own provider state, render a `ProviderSelector` strip at the top, and conditionally show either the existing `HelixPanel` or a new `OllamaPanel` beneath it. `LlmConfigPanel` is removed from the render tree (file kept). No BFF changes required — `POST /api/langchain/config { provider }` and `GET /api/langchain/config/status` already handle everything needed.

**Tech Stack:** React (CRA, `.jsx`), existing `apiClient` (bffAxios wrapper), existing `notifySuccess`/`notifyError` toast helpers, existing `/api/langchain/config` and `/api/langchain/provider/:name/status` BFF routes.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_ui/src/components/LlmConfigPage.jsx` | **Modify** | Own `provider` state, fetch initial provider, render `ProviderSelector` + conditional panel |
| `demo_api_ui/src/components/ProviderSelector.jsx` | **Create** | Two-button Helix/Ollama strip with status pills |
| `demo_api_ui/src/components/OllamaPanel.jsx` | **Create** | Ollama Base URL field + status pill + Save button |
| `demo_api_ui/src/components/HelixPanel.jsx` | **No change** | Left entirely as-is |
| `demo_api_ui/src/components/LlmConfigPanel.jsx` | **No change** | Not rendered, not deleted |

---

## Task 1: Create `OllamaPanel`

**Files:**
- Create: `demo_api_ui/src/components/OllamaPanel.jsx`

- [ ] **Step 1: Create the file**

```jsx
// demo_api_ui/src/components/OllamaPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';

export default function OllamaPanel() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [status, setStatus] = useState(null); // 'available' | 'unreachable' | null
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiClient.get('/api/langchain/provider/ollama/status');
      setStatus(res.data?.status ?? null);
    } catch {
      setStatus('unreachable');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.post('/api/langchain/config', { ollama_base_url: baseUrl });
      notifySuccess('Ollama URL saved');
      await checkStatus();
    } catch (err) {
      notifyError(`Failed to save Ollama URL: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const statusColor =
    status === 'available' ? '#166534' :
    status === 'unreachable' ? '#991b1b' :
    '#92400e';

  const statusBg =
    status === 'available' ? '#dcfce7' :
    status === 'unreachable' ? '#fecaca' :
    '#fef3c7';

  const statusLabel =
    status === 'available' ? '✅ Reachable' :
    status === 'unreachable' ? '❌ Unreachable' :
    checking ? '…' : '⚠️ Unknown';

  return (
    <div style={{ padding: '1.5rem' }}>
      <h3>Ollama Configuration</h3>
      <p style={{ marginBottom: '1rem', color: '#666', fontSize: '0.9rem' }}>
        Ollama runs models locally. Make sure the Ollama desktop app is running before saving.
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <span style={{
          display: 'inline-block',
          padding: '0.25rem 0.75rem',
          borderRadius: 6,
          fontSize: '0.85rem',
          fontWeight: 500,
          backgroundColor: statusBg,
          color: statusColor,
        }}>
          {statusLabel}
        </span>
      </div>

      <div style={{ marginBottom: '1rem', maxWidth: 480 }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
          Ollama Base URL
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434"
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: '0.9rem',
            }}
          />
          <button
            onClick={handleSave}
            disabled={saving || !baseUrl}
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving || !baseUrl ? 0.6 : 1,
              fontSize: '0.9rem',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={checkStatus}
            disabled={checking}
            style={{
              padding: '0.5rem 1rem',
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: checking ? 'not-allowed' : 'pointer',
              opacity: checking ? 0.6 : 1,
              fontSize: '0.9rem',
            }}
          >
            {checking ? '…' : 'Test'}
          </button>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.35rem' }}>
          Default: http://localhost:11434
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file exists**

```bash
ls demo_api_ui/src/components/OllamaPanel.jsx
```

Expected: file listed with no error.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/OllamaPanel.jsx
git commit -m "feat: add OllamaPanel component"
```

---

## Task 2: Create `ProviderSelector`

**Files:**
- Create: `demo_api_ui/src/components/ProviderSelector.jsx`

- [ ] **Step 1: Create the file**

```jsx
// demo_api_ui/src/components/ProviderSelector.jsx
import React from 'react';

/**
 * ProviderSelector — two-button strip: Helix (default) | Ollama
 *
 * Props:
 *   provider: 'helix' | 'ollama'       — currently active provider
 *   onSelect: (provider: string) => void — called when user clicks a button
 *   helixStatus: string | null          — 'available' | 'unconfigured' | null
 *   ollamaStatus: string | null         — 'available' | 'unreachable' | null
 */
export default function ProviderSelector({ provider, onSelect, helixStatus, ollamaStatus }) {
  const statusLabel = (s) => {
    if (s === 'available') return '✅ Active';
    if (s === 'unconfigured') return '⚠️ Unconfigured';
    if (s === 'unreachable') return '❌ Unreachable';
    return '';
  };

  const btnStyle = (name) => ({
    padding: '0.5rem 1.25rem',
    border: provider === name ? '2px solid #3b82f6' : '1px solid #d1d5db',
    borderRadius: 6,
    background: provider === name ? '#eff6ff' : '#fff',
    color: provider === name ? '#1d4ed8' : '#374151',
    fontWeight: provider === name ? 600 : 400,
    cursor: 'pointer',
    fontSize: '0.9rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    minWidth: 140,
  });

  const pillStyle = (s) => ({
    fontSize: '0.75rem',
    color:
      s === 'available' ? '#166534' :
      s === 'unconfigured' ? '#92400e' :
      s === 'unreachable' ? '#991b1b' :
      '#6b7280',
  });

  return (
    <div style={{ padding: '1.5rem 1.5rem 0' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>LLM Provider</h3>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button style={btnStyle('helix')} onClick={() => onSelect('helix')}>
          <span>Helix</span>
          {helixStatus && (
            <span style={pillStyle(helixStatus)}>{statusLabel(helixStatus)}</span>
          )}
        </button>
        <button style={btnStyle('ollama')} onClick={() => onSelect('ollama')}>
          <span>Ollama</span>
          {ollamaStatus && (
            <span style={pillStyle(ollamaStatus)}>{statusLabel(ollamaStatus)}</span>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file exists**

```bash
ls demo_api_ui/src/components/ProviderSelector.jsx
```

Expected: file listed with no error.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/ProviderSelector.jsx
git commit -m "feat: add ProviderSelector component"
```

---

## Task 3: Rewire `LlmConfigPage`

**Files:**
- Modify: `demo_api_ui/src/components/LlmConfigPage.jsx`

- [ ] **Step 1: Replace the file content**

```jsx
// demo_api_ui/src/components/LlmConfigPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import ProviderSelector from './ProviderSelector';
import HelixPanel from './HelixPanel';
import OllamaPanel from './OllamaPanel';

/**
 * LlmConfigPage — LLM provider configuration
 *
 * Shows a two-option provider selector (Helix | Ollama) at the top,
 * then the appropriate config panel below.
 */
export default function LlmConfigPage({ user, onLogout }) {
  const [provider, setProvider] = useState('helix');
  const [helixStatus, setHelixStatus] = useState(null);
  const [ollamaStatus, setOllamaStatus] = useState(null);

  const fetchStatuses = useCallback(async () => {
    try {
      const [helixRes, ollamaRes] = await Promise.all([
        apiClient.get('/api/langchain/provider/helix/status'),
        apiClient.get('/api/langchain/provider/ollama/status'),
      ]);
      setHelixStatus(helixRes.data?.status ?? null);
      setOllamaStatus(ollamaRes.data?.status ?? null);
    } catch (err) {
      console.warn('[LlmConfigPage] Status fetch failed:', err.message);
    }
  }, []);

  useEffect(() => {
    // Load current provider from BFF, then fetch statuses
    apiClient.get('/api/langchain/config/status')
      .then(res => {
        const p = res.data?.provider;
        if (p === 'helix' || p === 'ollama') setProvider(p);
      })
      .catch(err => console.warn('[LlmConfigPage] Config load failed:', err.message));

    fetchStatuses();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = async (selected) => {
    if (selected === provider) return;
    setProvider(selected);
    try {
      await apiClient.post('/api/langchain/config', { provider: selected });
      notifySuccess(`Switched to ${selected === 'helix' ? 'Helix' : 'Ollama'}`);
      await fetchStatuses();
    } catch (err) {
      notifyError(`Failed to switch provider: ${err.message}`);
      setProvider(provider); // revert on failure
    }
  };

  return (
    <div className="page-container">
      <ProviderSelector
        provider={provider}
        onSelect={handleSelect}
        helixStatus={helixStatus}
        ollamaStatus={ollamaStatus}
      />
      {provider === 'helix' ? <HelixPanel /> : <OllamaPanel />}
    </div>
  );
}
```

- [ ] **Step 2: Build the UI to verify no compile errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exit code 0, `Compiled successfully` or `webpack compiled` with no errors.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/LlmConfigPage.jsx
git commit -m "feat: replace LlmConfigPanel with Helix/Ollama provider selector"
```

---

## Task 4: Remove LM Studio additions (clean up prior work)

> The LM Studio provider was added in a prior session but is not needed. This task reverts those changes.

**Files:**
- Modify: `langchain_agent/src/agent/llm_factory.py`
- Modify: `langchain_agent/src/config/settings.py`
- Modify: `langchain_agent/src/agent/langchain_mcp_agent.py`
- Modify: `langchain_agent/requirements.txt`

- [ ] **Step 1: Remove `lmstudio` branch from `llm_factory.py`**

In `langchain_agent/src/agent/llm_factory.py`:

1. Update the module docstring — replace the first block:

```python
"""
LLM factory — Helix (default) and Ollama (explicit fallback).

Provider resolution rules (mirrors demo_api_server/services/llmProviderResolver.js):
  - "helix"  → ChatHelix; requires HELIX_* config
  - "ollama" → ChatOllama; requires ollama_base_url / OLLAMA_BASE_URL
  - no provider / unknown → "helix" (Helix is the project-wide default LLM)

No other module may inline a provider default.
"""
```

2. Remove `lmstudio_base_url: str = "http://localhost:1234/v1"` from the `get_llm()` signature.

3. Remove the entire `if resolved == "lmstudio":` block (the 10-line block that imports `ChatOpenAI`).

4. Remove `lmstudio_base_url` from the Args docstring.

The final `get_llm` signature should be:

```python
def get_llm(
    provider: str = "helix",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 1000,
    streaming: bool = True,
    ollama_base_url: str = "http://localhost:11434",
    # Helix-specific kwargs (passed through from LangChainConfig)
    helix_base_url: str = "",
    helix_api_key: str = "",
    helix_environment_id: str = "",
    helix_agent_id: str = "",
    helix_prompt_field_id: str = "",
    **kwargs: Any,
) -> BaseChatModel:
```

- [ ] **Step 2: Remove `lmstudio_base_url` from `settings.py`**

In `langchain_agent/src/config/settings.py`, remove:
- The `lmstudio_base_url: str = "http://localhost:1234/v1"` field from `LangChainConfig`
- The `lmstudio_base_url=get_env_value("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),` line in `ConfigManager._build_config()`

Also update the comment on the `provider` field to:
```python
    # LLM provider — "helix" (default, project-wide) or "ollama" (explicit fallback)
```

- [ ] **Step 3: Remove `lmstudio_base_url` from `langchain_mcp_agent.py`**

In `langchain_agent/src/agent/langchain_mcp_agent.py`, remove the line:
```python
            lmstudio_base_url=getattr(lc, "lmstudio_base_url", "http://localhost:1234/v1"),
```

- [ ] **Step 4: Revert `requirements.txt`**

In `langchain_agent/requirements.txt`, revert the header comment and remove the `langchain-openai` line:

```
# Core dependencies
# LLM providers: Helix (default, via helix_llm.py using httpx) and Ollama (explicit fallback).
# langchain-{openai,groq,anthropic,google-genai} and the openai SDK are not used — ~80MB of dead deps.
langchain>=0.3.0,<0.4.0
langchain-core>=0.3.0,<0.4.0
# LangGraph — stateful agent runtime with MemorySaver checkpointer
langgraph>=0.2.0,<1.0.0
langchain-ollama>=0.2.0,<0.3.0  # Ollama explicit fallback (provider="ollama")
```

- [ ] **Step 5: Verify Python files parse cleanly**

```bash
python3 -c "
import ast, sys
for f in [
    'langchain_agent/src/agent/llm_factory.py',
    'langchain_agent/src/config/settings.py',
    'langchain_agent/src/agent/langchain_mcp_agent.py',
]:
    try:
        ast.parse(open(f).read())
        print(f'OK: {f}')
    except SyntaxError as e:
        print(f'FAIL: {f}: {e}')
        sys.exit(1)
"
```

Expected: three `OK:` lines.

- [ ] **Step 6: Commit**

```bash
git add langchain_agent/src/agent/llm_factory.py \
        langchain_agent/src/config/settings.py \
        langchain_agent/src/agent/langchain_mcp_agent.py \
        langchain_agent/requirements.txt
git commit -m "revert: remove LM Studio provider (not needed)"
```

---

## Task 5: Verify end-to-end

- [ ] **Step 1: Build the UI one final time**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exit code 0, no errors.

- [ ] **Step 2: Manual smoke check (if services are running)**

Navigate to the admin LLM Config page (`/admin` → LLM Config or equivalent route).

Verify:
1. Page shows "LLM Provider" heading with two buttons: **Helix** and **Ollama**
2. **Helix** button is highlighted/selected by default
3. The Helix configuration form (Base URL, API Key, Environment ID, Agent Name, Prompt Field ID) is visible below
4. Clicking **Ollama** switches the highlighted button and shows the Ollama Base URL field + Test button
5. Clicking **Helix** switches back and shows the Helix form again
6. The old multi-provider panel (Groq / OpenAI / Anthropic / Google buttons + fallback chain) is gone

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -p  # stage only relevant changes
git commit -m "chore: final cleanup after provider selector"
```
