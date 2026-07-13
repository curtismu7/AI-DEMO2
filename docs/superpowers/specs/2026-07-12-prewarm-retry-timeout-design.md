# Pre-warm & Retry on local-model timeout

## Problem

When the banking chat is in `llamacpp` mode and a question routes to the big
`gpt-oss-20b` tier (`demo_llm_proxy`, swap mode) while that tier isn't loaded,
the cold model load can exceed the UI's 60s client-side request timeout
(`AbortSignal.timeout(60000)` in `handleNaturalLanguageInner`,
[AIAgent.js:5883](../../../demo_api_ui/src/components/AIAgent.js#L5883)). The
user sees "That took too long to answer — the local model timed out..."
([AIAgent.js:5586](../../../demo_api_ui/src/components/AIAgent.js#L5586)) and
has to manually retype the question after switching mode or waiting.

A pre-warm endpoint already exists
(`POST /api/langchain/llamacpp/prewarm { model }`,
[langchainConfig.js:414](../../../demo_api_server/routes/langchainConfig.js#L414))
and is already used by `LlmConfigPanel.jsx` to force-load a tier ahead of a
demo. It just isn't reachable from the chat panel itself, and there's no way
to recover from a timeout in place.

## Goal

When a timeout happens on the free-text chat flow while in `llamacpp` mode,
offer a "Pre-warm the model & retry" action directly on the error message.
Clicking it force-loads the `gpt-oss-20b` tier, then automatically resubmits
the original question once the tier is ready.

## Scope

**In scope:** the free-text NL flow only —
`handleNaturalLanguageInner(text)` ([AIAgent.js:5663](../../../demo_api_ui/src/components/AIAgent.js#L5663)),
which is the path a typed question like "Biggest spending categories" takes,
and the single `reportNlFailure` call site inside it
([AIAgent.js:5910](../../../demo_api_ui/src/components/AIAgent.js#L5910)).

**Out of scope:** the other 12 `reportNlFailure` call sites (admin agent, A2A
orchestrator, guest chips, discovery chips, clarification replies). They keep
today's plain-text timeout message with no retry action. Wiring retry into
those would mean wrapping distinct, protected async flows in reusable
closures — a much larger and riskier diff for scenarios that rarely hit this
particular timeout. Not doing that now; can be revisited later as a separate,
independently-scoped change if it turns out to matter.

**Also out of scope:** a proactive "pre-warm before asking" control elsewhere
in the chat UI (e.g. near the mode selector). `LlmConfigPanel.jsx` already
covers that use case.

## Design

### Trigger condition

`reportNlFailure`'s existing timeout branch
([AIAgent.js:5577-5589](../../../demo_api_ui/src/components/AIAgent.js#L5577-L5589))
gains one more condition: the new retry action only renders when
`activeLlmProvider === "llamacpp"`. A Helix/Anthropic timeout has nothing to
pre-warm locally, so those keep the current plain-text message unchanged.

### Call site change

`handleNaturalLanguageInner`'s catch block
([AIAgent.js:5908-5910](../../../demo_api_ui/src/components/AIAgent.js#L5908-L5910))
passes a retry callback:

```js
} catch (err) {
  if (isAbortError(err)) return;
  reportNlFailure(err, () => handleNaturalLanguageInner(text));
}
```

`text` is already the function's own parameter, so the closure needs no
extra state. `handleNaturalLanguageInner` manages its own `setNlLoading`
true/false internally, so calling it again from the retry button behaves
exactly like a fresh submission.

### `reportNlFailure` change

Add an optional second parameter `retry`. When `isTimeout &&
activeLlmProvider === "llamacpp" && retry` is true, the added message carries
`{ showPrewarmRetryAction: true, retryFn: retry }` instead of being a plain
string message. All other 12 call sites keep calling `reportNlFailure(err)`
with no second argument and are unaffected.

### Rendering

Add a new branch alongside the existing `showCustomerLoginActions` /
`showSessionFixActions` message-action branches
([AIAgent.js:8818](../../../demo_api_ui/src/components/AIAgent.js#L8818)),
reusing the same `ba-session-fix-actions` / `ba-session-fix-btn` CSS classes
(no new styling):

```jsx
if (msg.role === "assistant" && msg.showPrewarmRetryAction) {
  const isWarming = prewarming === msg.id;
  return (
    <div key={msg.id} className="banking-agent-msg assistant">
      <div className="banking-agent-msg-bubble banking-agent-msg-bubble--session-fix">
        <MessageContent text={msg.content} terminology={terminology} />
        <div className="ba-session-fix-actions">
          <button
            type="button"
            className="ba-session-fix-btn"
            disabled={isWarming}
            onClick={() => handlePrewarmRetry(msg.id, msg.retryFn)}
          >
            {isWarming ? "Warming up… (up to ~1 min)" : "Pre-warm the model & retry"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Pre-warm + retry handler

New component-level state, mirroring `LlmConfigPanel.jsx`'s existing
`prewarming` state:

```js
const [prewarming, setPrewarming] = useState(null); // message id currently warming

async function handlePrewarmRetry(msgId, retryFn) {
  setPrewarming(msgId);
  try {
    const res = await fetch('/api/langchain/llamacpp/prewarm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-oss-20b' }),
    });
    if (!res.ok) throw new Error('Pre-warm failed');
    await retryFn();
  } catch (err) {
    notifyError('Could not pre-warm the model — try switching mode instead.', {
      autoClose: agentToastMs.errShort,
    });
  } finally {
    setPrewarming(null);
  }
}
```

The tier is always `gpt-oss-20b` regardless of which prompt triggered the
timeout — `phi-4-mini-instruct` (3.8B) loads fast enough that it doesn't
produce this timeout in practice, so there's no need to detect which tier a
given request needed.

### Error handling

- Pre-warm request fails (network error, non-2xx, tier-manager unreachable)
  → toast error, button re-enables, original error message stays in place.
  User can click again or fall back to switching modes (existing guidance
  text already covers that).
- Pre-warm succeeds but the retried request itself fails again (e.g. a
  different error) → falls through to the normal `reportNlFailure` path for
  that new error, same as any other retry.

## Testing

Add one test case to `demo_api_ui/src/__tests__/BankingAgent.chipRouting.test.js`
(already exercises `AIAgent.js`'s NL flow) or a new sibling test file:

- Given `activeLlmProvider === "llamacpp"` and a mocked `fetch` that rejects
  the NL request with a timeout-shaped error, assert the rendered message has
  the "Pre-warm the model & retry" button.
- Clicking it calls `POST /api/langchain/llamacpp/prewarm` with
  `{ model: "gpt-oss-20b" }`, then (once that resolves) re-invokes the NL
  request with the original text.
- A timeout while `activeLlmProvider` is `helix` or `anthropic-lmstudio`
  renders the existing plain-text message with no button.
