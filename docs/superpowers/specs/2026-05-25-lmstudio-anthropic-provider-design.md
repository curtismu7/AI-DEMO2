# LM Studio Anthropic Provider + Gemma Auto-Load — Design Spec
**Date:** 2026-05-25  
**Status:** Approved

---

## Goal

Add "LM Studio" as a selectable LLM provider in the demo. When selected, the agent uses `ChatAnthropic` (langchain-anthropic SDK) pointed at LM Studio's Anthropic-compatible local endpoint (`http://localhost:1234`). The UI button says "LM Studio". This lets the demo present a locally-running model as if Anthropic's API is in use, without needing a real Anthropic API key.

Additionally: when the LM Studio panel is shown, it auto-downloads and loads **Gemma 3 12B IT** (Google's latest instruction-tuned model) via LM Studio's CLI (`lms get`) and REST API (`POST /api/v0/models/load`), so the demo is correctly configured on first selection with no manual steps.

---

## Architecture

### Provider key

Internal provider identifier: `anthropic-lmstudio`

This key flows through the full stack:

```
UI "LM Studio" button selected
  → POST /api/langchain/config { provider: "anthropic-lmstudio" }
  → llmProviderResolver.js — passes through unchanged (like openai/anthropic)
  → BFF forwards provider in langchain_config to langchain_agent (:8888)
  → get_config() reads LANGCHAIN_LLM_PROVIDER="anthropic-lmstudio"
  → llm_factory.get_llm(provider="anthropic-lmstudio", ...)
  → ChatAnthropic(base_url="http://localhost:1234", api_key="lm-studio")
```

### Why `anthropic-lmstudio` not `lmstudio`

The existing `lmstudio` provider key uses `ChatOpenAI` (OpenAI wire format). The new Anthropic-compat path needs a distinct key so the factory can route to the right SDK. Existing `lmstudio` users are not affected.

---

## Components

### 1. Python — `langchain_agent/requirements.txt`
`langchain-anthropic>=0.3.0,<0.4.0` — already added.

### 2. Python — `langchain_agent/src/config/settings.py`
Add field to `LangChainConfig`:
```python
anthropic_lmstudio_base_url: str = "http://localhost:1234"
```
Wire from env var `ANTHROPIC_LMSTUDIO_BASE_URL` in `ConfigManager._build_config()`.

### 3. Python — `langchain_agent/src/agent/llm_factory.py`
Add branch for `anthropic-lmstudio`:
```python
if resolved == "anthropic-lmstudio":
    resolved_model = model or "claude-3-5-sonnet-20241022"
    logger.info("Initializing LLM: provider=anthropic-lmstudio model=%s url=%s", resolved_model, lmstudio_base_url)
    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(
        model=resolved_model,
        anthropic_api_url=lmstudio_base_url,   # LM Studio's Anthropic-compat URL
        api_key="lm-studio",                    # LM Studio ignores the key
        temperature=temperature,
        max_tokens=max_tokens,
    )
```
Note: `lmstudio_base_url` is already a parameter (default `http://localhost:1234/v1`). For Anthropic wire format the base URL LM Studio exposes is typically `http://localhost:1234` (no `/v1`). We'll use the same `lmstudio_base_url` param but default it correctly — or add a separate `anthropic_lmstudio_base_url` param. Decision: reuse `lmstudio_base_url` and document that for Anthropic mode the user should set `http://localhost:1234` (no `/v1` suffix). The default for this param is already `http://localhost:1234/v1`; we'll add a dedicated param `anthropic_lmstudio_base_url` (default `http://localhost:1234`) to avoid the `/v1` confusion.

### 4. Python — `langchain_agent/src/agent/langchain_mcp_agent.py`
Pass `anthropic_lmstudio_base_url` to `get_llm()`:
```python
anthropic_lmstudio_base_url=getattr(lc, "anthropic_lmstudio_base_url", "http://localhost:1234"),
```

### 5. BFF — `demo_api_server/services/llmProviderResolver.js`
Add pass-through for `anthropic-lmstudio` (same pattern as `openai`/`anthropic`):
```js
if (requested === 'anthropic-lmstudio') {
  return { provider: 'anthropic-lmstudio', model };
}
```

### 6. BFF — `demo_api_server/routes/langchainConfig.js`
Add `anthropic-lmstudio` to `PROVIDER_MODELS` and `DEFAULT_MODELS`:
```js
PROVIDER_MODELS['anthropic-lmstudio'] = ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'];
DEFAULT_MODELS['anthropic-lmstudio'] = 'claude-3-5-sonnet-20241022';
```

Also add `anthropic_lmstudio` to `key_set` in the GET response (always `true`, like Ollama — no API key required):
```js
anthropic_lmstudio: true,
```

### 7. BFF — `demo_api_server/services/llmProviderStatus.js`
Handle status check for `anthropic-lmstudio`: ping `http://localhost:1234` (or the configured base URL). Return `available` if HTTP 200, `unreachable` otherwise.

### 8. UI — `demo_api_ui/src/components/ProviderSelector.jsx`
Add "LM Studio" as a third button. New prop: `lmstudioStatus`.

```jsx
<button style={btnStyle('anthropic-lmstudio')} onClick={() => onSelect('anthropic-lmstudio')}>
  <span>LM Studio</span>
  {lmstudioStatus && (
    <span style={pillStyle(lmstudioStatus)}>{statusLabel(lmstudioStatus)}</span>
  )}
</button>
```

### 9. UI — `demo_api_ui/src/components/LlmConfigPage.jsx`
- Fetch `anthropic-lmstudio` status alongside helix/ollama.
- Map provider value `anthropic-lmstudio` → valid button state.
- When `anthropic-lmstudio` is active: show a simple `LmStudioPanel` (or inline message) explaining LM Studio is active and showing the base URL.
- `handleSelect` accepts `'anthropic-lmstudio'` and posts it to BFF.

### 10. UI — New `LmStudioPanel.jsx` component

The panel handles the full Gemma auto-setup lifecycle:

**States:**
1. **Idle / server not started** — "LM Studio server is not running. Start it from the LM Studio app (Local Server tab), then click Refresh."
2. **Server running, checking model** — spinner, "Checking for Gemma 3 12B..."
3. **Model not downloaded** — "Gemma 3 12B IT is not downloaded. [Download & Load Gemma] button"
4. **Downloading** — progress indicator (polling `/api/langchain/lmstudio/download-status`), shows percentage or animated spinner with "Downloading gemma-3-12b-it… (this may take several minutes)"
5. **Downloaded, not loaded** — "[Load Gemma] button" — calls load endpoint
6. **Loading** — "Loading model into memory…" spinner
7. **Ready** — "✅ Gemma 3 12B IT is active. LM Studio is ready." 

**Interaction flow:**
```
Panel mounts
  → GET /api/langchain/lmstudio/model-status
      → BFF hits GET http://localhost:{lmstudio_port}/api/v0/models/downloaded
      → returns { server_running, downloaded, loaded, model_id }
  → If not downloaded: show [Download & Load Gemma] button
      → POST /api/langchain/lmstudio/download → BFF spawns `lms get <model>` subprocess
      → UI polls GET /api/langchain/lmstudio/download-status every 3s
      → On complete: automatically trigger load
  → If downloaded but not loaded: show [Load Gemma] button
      → POST /api/langchain/lmstudio/load → BFF calls POST http://localhost:{port}/api/v0/models/load
  → If loaded: show ready state
```

**Port handling:** LM Studio's server port is configurable (currently 41343 on this machine, not 1234). The panel should let the user see/override the port. Default remains 1234 (standard). BFF reads from `configStore` key `lmstudio_server_port`.

### 11. BFF — New routes under `/api/langchain/lmstudio/`

| Route | Method | Purpose |
|---|---|---|
| `/api/langchain/lmstudio/model-status` | GET | Check if server running, model downloaded, model loaded |
| `/api/langchain/lmstudio/download` | POST | Spawn `lms get google/gemma-3-12b-it-qat-q4_k_m` subprocess |
| `/api/langchain/lmstudio/download-status` | GET | Return download progress from subprocess stdout |
| `/api/langchain/lmstudio/load` | POST | Call `POST /api/v0/models/load` on LM Studio server |

**Download subprocess management:**
- BFF keeps one global download subprocess reference (one download at a time)
- `lms get` streams progress to stdout — BFF captures and caches last N lines
- `/download-status` returns `{ running, progress_lines, done, error }`
- On completion, `done: true` triggers the UI to call `/load`

**Target model identifier:** `google/gemma-3-12b-it-qat-q4_k_m` (GGUF quantised, ~7GB)  
The model ID for loading may differ from the download path — use `lms ls` output or `GET /api/v0/models/downloaded` to find the exact loaded model identifier after download.

---

## Data flow — config persistence

| What | Where |
|---|---|
| Provider selection | Session `langchain_config.provider = "anthropic-lmstudio"` |
| Base URL (if configurable) | Session + configStore `anthropic_lmstudio_base_url` |
| No API key | LM Studio ignores it; we send `"lm-studio"` as dummy |

---

## Status checking

`GET /api/langchain/provider/anthropic-lmstudio/status`

- Pings LM Studio at the configured base URL + port (`http://localhost:{lmstudio_server_port}`)
- Tries `GET /api/v0/models` — returns `available` if responds, `unreachable` if connection refused
- Returns: `{ status: 'available' | 'unreachable', reason, configured: true }`
- Always `configured: true` (no API key to check)

The provider selector pill reflects this: ✅ Active (server + model ready) / ❌ Unreachable (server not started).

---

## Error handling

| Scenario | Handling |
|---|---|
| LM Studio app not open | Status pill shows "❌ Unreachable"; panel shows "Open LM Studio app first" |
| LM Studio server not started | Same as above — the local server must be started in LM Studio's UI |
| `lms` CLI not installed | `/download` route returns `{ error: "lms CLI not found. Install it from LM Studio → ☰ → Install CLI" }` |
| Download fails mid-way | `/download-status` returns `{ error: <stderr> }`; UI shows error message |
| Model load fails | BFF surfaces LM Studio error response to UI |
| `langchain-anthropic` not installed | Python startup fails with `ImportError`; `requirements.txt` prevents this |
| Wrong port | Panel shows port field; user can adjust; BFF uses `lmstudio_server_port` from configStore |

---

## Out of scope (v1)

- Real Anthropic cloud API key support (use real `anthropic` provider for that)
- Multiple concurrent downloads
- Download progress percentage (LM Studio CLI may not emit parseable %; show spinner instead)
- Auto-selection of other Gemma sizes (12B is the only target)

---

## Success criteria

1. "LM Studio" button appears in the provider selector alongside Helix and Ollama
2. Selecting it saves `provider: "anthropic-lmstudio"` to session and BFF
3. The langchain agent initializes `ChatAnthropic` pointing at `http://localhost:{port}`
4. `LmStudioPanel` shows the correct state (not downloaded / downloading / loading / ready)
5. Clicking "Download & Load Gemma" triggers `lms get google/gemma-3-12b-it-qat-q4_k_m`, UI shows spinner
6. After download completes, model auto-loads via `POST /api/v0/models/load`; panel shows ✅ ready
7. Status pill shows ✅ Active when LM Studio server is reachable, ❌ Unreachable when not
8. `npm run build` in `demo_api_ui/` exits 0 after UI changes
9. No regression to existing Helix or Ollama provider paths

---

## Files changed (summary)

| File | Change type |
|---|---|
| `langchain_agent/requirements.txt` | Already updated — `langchain-anthropic` added |
| `langchain_agent/src/config/settings.py` | Add `anthropic_lmstudio_base_url` field |
| `langchain_agent/src/agent/llm_factory.py` | Add `anthropic-lmstudio` branch using `ChatAnthropic` |
| `langchain_agent/src/agent/langchain_mcp_agent.py` | Pass `anthropic_lmstudio_base_url` to factory |
| `demo_api_server/services/llmProviderResolver.js` | Add pass-through for `anthropic-lmstudio` |
| `demo_api_server/routes/langchainConfig.js` | Add to `PROVIDER_MODELS`, `DEFAULT_MODELS`, `key_set` |
| `demo_api_server/routes/lmstudio.js` | New: model-status, download, download-status, load routes |
| `demo_api_server/server.js` (or app.js) | Register new lmstudio router |
| `demo_api_server/services/llmProviderStatus.js` | Handle `anthropic-lmstudio` status ping |
| `demo_api_ui/src/components/ProviderSelector.jsx` | Add "LM Studio" third button |
| `demo_api_ui/src/components/LlmConfigPage.jsx` | Handle `anthropic-lmstudio` provider state + fetch lmstudio status |
| `demo_api_ui/src/components/LmStudioPanel.jsx` | New: full panel with download/load lifecycle UI |
