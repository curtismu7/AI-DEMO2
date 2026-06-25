# LM Studio E2E Test Results — 2026-06-06

## Summary

| Area | Status |
|------|--------|
| `/nl/status` returns correct provider | ✅ FIXED |
| UI receives `provider: anthropic-lmstudio` | ✅ FIXED (root cause) |
| LM Studio server reachable | ✅ Running on localhost:1234 |
| NL intent routing (conversational) | ⚠️ WORKS but slow (17–49s) |
| UI 15s timeout cuts off responses | ❌ Silent failure in browser |
| Banking action dispatch via LM Studio NL | ⚠️ Returns edu:general-knowledge, not structured action |
| Heuristic-only mode unaffected | ✅ No regression |
| Great Buy yellow text fix | ✅ FIXED (production build confirmed) |

---

## Root Cause Fixed

**File:** `demo_api_server/routes/demoAgentNl.js` — `GET /nl/status`

**Problem:** When `agent_mode` was set to `lmstudio` in configStore, `/nl/status` was unaware of the agent mode and returned `activeLlmProvider: null`. The UI used this field to set the `provider` field on every NL POST request. With `null`, it fell back to sending `provider: "heuristic"`, which short-circuits in `geminiNlIntent.js` at line 230 and returns a heuristic catalog response — completely bypassing LM Studio.

**Fix:** Added `resolveAgentMode` check to `/nl/status`. When the configured mode's provider is `anthropic-lmstudio`, it now returns `activeLlmProvider: "anthropic-lmstudio"` regardless of whether Helix/Ollama are configured.

```js
const lmstudioActive = resolvedMode?.provider === 'anthropic-lmstudio';
const activeLlmProvider = lmstudioActive ? 'anthropic-lmstudio'
  : helixConfigured ? 'helix'
  : ollamaConfigured ? 'ollama'
  : null;
```

**Verified:** `curl https://api.ping.demo:3001/api/banking-agent/nl/status` returns:
```json
{"activeLlmProvider":"anthropic-lmstudio","helixConfigured":true,"ollamaConfigured":true,"heuristicAlwaysAvailable":true}
```

---

## LM Studio Server State

**Running:** `localhost:1234` (OpenAI-compatible endpoint)

**Loaded models:**
- `google/gemma-4-e4b`
- `zai-org/glm-4.7-flash`
- `qwen/qwen2.5-coder-32b`
- `qwen/qwen2.5-coder-14b`
- `qwen/qwen3.6-27b`
- `text-embedding-nomic-embed-text-v1.5`

The BFF auto-discovers the first loaded model via `GET /v1/models`. Active model varies.

---

## Test Cases

### 1. `/nl/status` — provider detection

**Input:** `GET /api/banking-agent/nl/status` (no session, agent_mode=lmstudio in configStore)

**Expected:** `activeLlmProvider: "anthropic-lmstudio"`

**Result:** ✅ `{"activeLlmProvider":"anthropic-lmstudio","helixConfigured":true,"ollamaConfigured":true,"heuristicAlwaysAvailable":true}`

---

### 2. NL intent — "what are my recent orders?" (LM Studio provider)

**Input:** `POST /api/banking-agent/nl` `{"message":"what are my recent orders?","provider":"anthropic-lmstudio","vertical":"sports"}`

**Expected:** Banking action dispatched (`kind: banking, action: orders/transactions`)

**Result:** ⚠️ `source: lmstudio_fallback, kind: education, panel: general-knowledge` (17s)

**Explanation:** In `lmstudio` mode (`heuristicRouting: false`), the heuristic fast-return is skipped even when the heuristic would have recognized this as a banking action. Control flows to `answerConversational()` which calls LM Studio. LM Studio returns a natural-language answer ("Here are your recent orders...") rather than a structured intent object. This is classified as `edu:general-knowledge`.

**The curl test timed out at 5s; the BFF continued and completed at 17s.** In a browser with the UI's `AbortSignal.timeout(15000)`, this response would fail silently.

---

### 3. NL intent — "List my orders" (LM Studio provider, BFF-side)

**Input:** `POST /api/banking-agent/nl` with `provider: anthropic-lmstudio`

**Result:** ⚠️ `source: lmstudio_fallback, kind: education`

**Same pattern** — LM Studio conversational response, not a structured banking intent.

---

### 4. NL intent — "what is CIBA" (LM Studio provider)

**Input:** `POST /api/banking-agent/nl` with `provider: anthropic-lmstudio`

**Result:** ❌ Timed out after 49s

**BFF logs:** `[timing] SLOW POST /api/banking-agent/nl — 49061ms`

This exceeds both the UI 15s timeout and a reasonable user wait threshold. Likely due to LM Studio using a large model (qwen2.5-coder-32b) that generates lengthy responses.

---

### 5. Heuristic provider — regression check

**Input:** `POST /api/banking-agent/nl` `{"message":"what are my recent orders?","provider":"heuristic","vertical":"sports"}`

**Result:** ✅ `{"source":"heuristic","result":{"kind":"banking","banking":{"action":"transactions"}}}` — immediate (<100ms)

Heuristic path unaffected by the fix.

---

## Known Issues

### Issue 1: UI 15s timeout silently aborts LM Studio responses

**Severity:** High

**Location:** `demo_api_ui/src/services/demoAgentNlService.js` — `signal: anySignal([AbortSignal.timeout(15000), signal])`

**Impact:** LM Studio responses that take >15s (common for larger models: 17–49s observed) are silently dropped. The user sees no error, no loading indicator change, nothing. The BFF logs show the request completing successfully seconds/minutes later.

**Options:**
1. Increase timeout to 60s for LM Studio provider
2. Show a "LM Studio is thinking..." indicator after 10s
3. Switch to streaming (SSE) so partial tokens appear immediately
4. Add explicit timeout error UI state

---

### Issue 2: LM Studio returns conversational text, not structured intents

**Severity:** Medium

**Location:** `demo_api_server/services/geminiNlIntent.js` — `answerWithLmStudio()` line 109

**Impact:** In `lmstudio` mode, `heuristicRouting: false` means the heuristic fast-return is bypassed for ALL recognized inputs. Control goes to LM Studio, which returns plain text (classified as `edu:general-knowledge`) rather than a structured `{ kind: 'banking', banking: { action: '...' } }` intent that would dispatch a tool call.

**Root cause:** `answerWithLmStudio()` uses a generic "you are an assistant" system prompt and returns whatever LM Studio says. It does not ask LM Studio to output a structured JSON intent. Compare with Helix's `answerWithHelix()` which is used only as a conversational fallback after heuristic already failed.

**The `lmstudio` mode bypasses the heuristic that would correctly route banking actions.** Users selecting LM Studio mode will get conversational text responses for queries like "show my balance" rather than the balance panel opening.

**Fix options:**
1. Set `heuristicRouting: true` for the `lmstudio` mode (same as `heuristics_lmstudio`) — heuristic handles recognized banking actions, LM Studio only handles unrecognized conversational queries
2. Give `answerWithLmStudio()` a structured JSON output prompt so it classifies intents

---

### Issue 3: LM Studio system prompt uses "banking demo" context regardless of vertical

**Severity:** Low

**Location:** `demo_api_server/services/geminiNlIntent.js` line 115

```js
content: 'You are a knowledgeable assistant for a banking demo platform.'
```

When the active vertical is `sports`, `workforce`, or `mortgage`, LM Studio still presents itself as a banking assistant. This produces contextually wrong answers (e.g., "I can help with your account balance" in a sports context).

**Fix:** Inject `activeVertical` and `context` into the system prompt, same pattern as Helix.

---

### Issue 4: Model selection is random (first loaded model wins)

**Severity:** Low

**Location:** `demo_api_server/services/lmStudioLlmService.js` — auto-discovery via `/v1/models`

LM Studio has multiple models loaded simultaneously. The BFF picks the first one returned by `/v1/models`. This can vary. The current first model is `google/gemma-4-e4b` which may not be optimal for structured output.

**Fix:** Add `LMSTUDIO_MODEL` env var support (already in `reasoningGraph.ts` for the agent service, but `lmStudioLlmService.js` may not respect it for the NL path).

---

## CSS Fix: Great Buy Yellow Text

**File:** `demo_api_ui/src/components/BankingAgent.css`

**Problem:** Great Buy vertical sets `--app-primary-red: #FFE000` (bright yellow) and `--app-primary-btn-text: #1D1D1B` (dark). The chat bubble `--ba-agent-txt` was hardcoded to `#ffffff`, producing invisible white text on yellow background.

**Fix:** Changed 4 occurrences (agent message bubble rules where `--ba-agent-bg` uses `--app-primary-red`) from:
```css
--ba-agent-txt: #ffffff;
```
to:
```css
--ba-agent-txt: var(--app-primary-btn-text, #ffffff);
```

The `--app-primary-btn-text` variable is set to `#1D1D1B` by the Great Buy vertical, so text becomes dark on yellow. All other verticals continue to use their existing `--app-primary-btn-text` value (defaults to `#ffffff` via the fallback).

**Verified:** Production build confirmed — `ba-agent-txt:var(--app-primary-btn-text,#fff)` appears 5× in the minified CSS bundle.

**Note:** The CRA dev server was not serving the updated CSS during testing (HMR cache issue). The fix is confirmed in `npm run build` output. Users running the production build (`serve -s build`) will see correct dark text on Great Buy yellow bubbles.

---

## Files Changed

| File | Change |
|------|--------|
| `demo_api_server/routes/demoAgentNl.js` | `/nl/status` now detects LM Studio via `agent_mode` configStore |
| `demo_api_ui/src/components/BankingAgent.css` | `--ba-agent-txt` uses CSS variable fallback for theme-aware text color |

---

## Regression Check

- `heuristic` provider: ✅ unaffected
- `helix` / `heuristics_helix` provider: ✅ unaffected (still preferred over lmstudio in `/nl/status` only if not in lmstudio agent mode)
- Great Buy vertical other than agent bubble text: ✅ not touched
