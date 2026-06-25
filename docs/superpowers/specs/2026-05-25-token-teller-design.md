# Token Teller — Design Spec

**Date:** 2026-05-25  
**Status:** Approved  

---

## Overview

Two UI improvements to the banking agent panel:

1. **Panel height** — remove the `max-height: 820px` cap so the panel fills the full viewport height. *(Already implemented.)*
2. **Token Teller** — a slim footer bar inside the agent panel showing live input/output token counts for the current session and a persistent all-time lifetime total.

---

## Token Teller

### What it shows

A 28px strip pinned below the input box inside `.banking-agent-panel`:

```
⬆ 1,240 in   ⬇ 842 out   ∑ 48,302
```

| Field | Description |
|---|---|
| ⬆ N in | Input tokens consumed this page session |
| ⬇ N out | Output tokens generated this page session |
| ∑ N | All-time lifetime total (input + output), persisted in `localStorage` |

Numbers are formatted with `toLocaleString()` (comma separators). Session counters reset on page close/refresh. The all-time total accumulates forever — no reset button.

---

## Data Flow

### Layer 1 — Python agent (`langchain_agent/`)

**File:** `langchain_agent/src/agent/langchain_mcp_agent.py`

After each LLM call, extract real token counts from `AIMessage.usage_metadata`:

```python
usage = getattr(msg, "usage_metadata", None)
if usage:
    input_tokens  += usage.get("input_tokens", 0)
    output_tokens += usage.get("output_tokens", 0)
```

Accumulate across all steps in the graph run. Return alongside the reply:

```python
return {
    "reply": response_text,
    "input_tokens": input_tokens,
    "output_tokens": output_tokens,
    ...
}
```

### Layer 2 — BFF (`demo_api_server/`)

**Files:** `demo_api_server/services/bankingAgentLangGraphService.js`, `demo_api_server/routes/bankingAgentRoutes.js`

Replace hardcoded `tokensUsed: 0` with structured token fields passed through from the Python response:

```javascript
// bankingAgentLangGraphService.js
return {
  reply: result.reply,
  success: true,
  inputTokens: result.input_tokens ?? 0,
  outputTokens: result.output_tokens ?? 0,
  // ...
};

// bankingAgentRoutes.js response body
{
  reply: response.reply,
  inputTokens: response.inputTokens,
  outputTokens: response.outputTokens,
  // ...
}
```

### Layer 3 — React UI (`demo_api_ui/`)

**Files:** `demo_api_ui/src/components/BankingAgent.js`, `demo_api_ui/src/components/BankingAgent.css`

**State:**
```javascript
const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0 });
```

**localStorage key:** `ba_tokens_lifetime` — stores `{ input: number, output: number }`

**On mount:** read `localStorage` to initialise lifetime display.

**After each agent response:**
```javascript
if (response.inputTokens || response.outputTokens) {
  const inc = { input: response.inputTokens ?? 0, output: response.outputTokens ?? 0 };
  setSessionTokens(prev => ({ input: prev.input + inc.input, output: prev.output + inc.output }));
  const stored = JSON.parse(localStorage.getItem('ba_tokens_lifetime') || '{"input":0,"output":0}');
  localStorage.setItem('ba_tokens_lifetime', JSON.stringify({
    input: stored.input + inc.input,
    output: stored.output + inc.output,
  }));
}
```

**JSX** — new element after `.ba-bottom` inside `.banking-agent-panel`:
```jsx
<div className="ba-token-footer">
  <span>⬆ {sessionTokens.input.toLocaleString()} in</span>
  <span>⬇ {sessionTokens.output.toLocaleString()} out</span>
  <span>∑ {lifetimeTotal.toLocaleString()}</span>
</div>
```

**CSS:**
```css
.ba-token-footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 4px 12px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: #64748b;
  border-radius: 0 0 14px 14px;
  gap: 8px;
}
```

---

## Files Changed

| File | Change |
|---|---|
| `demo_api_ui/src/components/BankingAgent.css` | ✅ Remove `max-height: 820px` *(done)*; add `.ba-token-footer` styles |
| `demo_api_ui/src/components/BankingAgent.js` | Add `sessionTokens` state, `lifetimeTotal` from localStorage, footer JSX, update handler |
| `demo_api_server/routes/bankingAgentRoutes.js` | Pass `inputTokens`/`outputTokens` through response body |
| `demo_api_server/services/bankingAgentLangGraphService.js` | Replace `tokensUsed: 0` with real token fields |
| `langchain_agent/src/agent/langchain_mcp_agent.py` | Extract `usage_metadata` from LLM responses, return token counts |

---

## Success Criteria

- Panel fills viewport height with no 820px cap ✅ *(already done)*
- After an agent response, ⬆ in and ⬇ out increment by the correct amounts
- Refreshing the page resets session counters to 0 but ∑ all-time retains the cumulative total
- Footer is visible at the bottom of the panel without affecting message scroll area
- UI build passes (`npm run build` exits 0)
- No token counts appear when `inputTokens`/`outputTokens` are absent (graceful zero)
