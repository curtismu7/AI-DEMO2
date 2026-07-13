# Pre-warm & Retry on local-model timeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a free-text chat question times out while in `llamacpp` mode, let the user click a button on the error message to force-load the `gpt-oss-20b` tier and automatically resubmit the original question.

**Architecture:** Two pure helpers (`isLocalModelTimeout`, `prewarmTierAndRetry`) go in `demo_api_ui/src/components/demoAgentSafety.js`, unit-tested directly. `AIAgent.js` wires them into `reportNlFailure` / `handleNaturalLanguageInner` and renders a new action button on the timeout message, reusing the existing `ba-session-fix-actions` message-action pattern.

**Tech Stack:** React (Vite), Vitest + `@testing-library/jest-dom`, existing `demo_api_server` route `POST /api/langchain/llamacpp/prewarm`.

## Global Constraints

- Emoji rule: only `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` are allowed in UI text/code — the new button label must not use any other emoji.
- Minimal diff: touch only the exact functions/lines named in each task. No unrelated cleanup in `AIAgent.js`.
- Scope: only the free-text NL flow (`handleNaturalLanguageInner`) gets the retry action. The other 12 `reportNlFailure` call sites are unchanged.
- Spec of record: `docs/superpowers/specs/2026-07-12-prewarm-retry-timeout-design.md`.

---

### Task 1: Pure helpers — `isLocalModelTimeout` and `prewarmTierAndRetry`

**Files:**
- Modify: `demo_api_ui/src/components/demoAgentSafety.js`
- Test: `demo_api_ui/src/__tests__/BankingAgent.safety.test.js`

**Interfaces:**
- Produces: `isLocalModelTimeout(err, provider) -> boolean` — true only when `err` is timeout-shaped AND `provider === "llamacpp"`.
- Produces: `prewarmTierAndRetry(model, retry) -> Promise<void>` — POSTs `{ model }` to `/api/langchain/llamacpp/prewarm`; awaits and calls `retry()` only if the response is `ok`; throws `Error("Pre-warm failed")` otherwise (and does not call `retry`).

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/__tests__/BankingAgent.safety.test.js` (add this import to the existing `import { ... } from "../components/demoAgentSafety";` block at the top of the file, and add these two `describe` blocks at the end of the file):

```js
// Add to the existing import at the top of the file:
//   isLocalModelTimeout,
//   prewarmTierAndRetry,

describe("isLocalModelTimeout — gates the pre-warm retry action to llama.cpp timeouts", () => {
  test("true for a TimeoutError name while on llamacpp", () => {
    expect(isLocalModelTimeout({ name: "TimeoutError" }, "llamacpp")).toBe(true);
  });

  test("true for a message containing 'timed out' while on llamacpp", () => {
    expect(isLocalModelTimeout({ message: "signal timed out" }, "llamacpp")).toBe(true);
  });

  test("false when the provider is not llamacpp, even if it timed out", () => {
    expect(isLocalModelTimeout({ name: "TimeoutError" }, "helix")).toBe(false);
    expect(isLocalModelTimeout({ name: "TimeoutError" }, "anthropic-lmstudio")).toBe(false);
  });

  test("false for a non-timeout error on llamacpp", () => {
    expect(isLocalModelTimeout({ message: "network error" }, "llamacpp")).toBe(false);
  });

  test("false for a null/undefined error", () => {
    expect(isLocalModelTimeout(null, "llamacpp")).toBe(false);
    expect(isLocalModelTimeout(undefined, "llamacpp")).toBe(false);
  });
});

describe("prewarmTierAndRetry — force-load a tier then replay the original request", () => {
  afterEach(() => {
    delete global.fetch;
  });

  test("POSTs the model to the prewarm endpoint and calls retry on success", async () => {
    const calls = [];
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const retry = vi.fn().mockResolvedValue(undefined);

    await prewarmTierAndRetry("gpt-oss-20b", retry);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/langchain/llamacpp/prewarm",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-oss-20b" }),
      }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("throws and does not call retry when the prewarm response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const retry = vi.fn();

    await expect(prewarmTierAndRetry("gpt-oss-20b", retry)).rejects.toThrow("Pre-warm failed");
    expect(retry).not.toHaveBeenCalled();
  });

  test("propagates a fetch rejection and does not call retry", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const retry = vi.fn();

    await expect(prewarmTierAndRetry("gpt-oss-20b", retry)).rejects.toThrow("network down");
    expect(retry).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/__tests__/BankingAgent.safety.test.js`
Expected: FAIL — `isLocalModelTimeout is not defined` / `prewarmTierAndRetry is not defined` (they aren't exported yet).

- [ ] **Step 3: Implement the helpers**

Append to `demo_api_ui/src/components/demoAgentSafety.js` (after the existing `anySignal` function, end of file):

```js

/**
 * True when a caught error should offer the in-place "pre-warm & retry"
 * action. Only meaningful for the local llama.cpp backend — Helix/Anthropic
 * timeouts have no local tier to pre-warm.
 */
export function isLocalModelTimeout(err, provider) {
  const isTimeout =
    err?.name === "TimeoutError" ||
    (typeof err?.message === "string" && err.message.includes("timed out"));
  return isTimeout && provider === "llamacpp";
}

/**
 * Force-load the given llama.cpp tier (swap mode — see demo_llm_proxy),
 * then re-run the request that timed out. Throws without calling `retry`
 * if the pre-warm call itself fails; the caller surfaces that to the user.
 */
export async function prewarmTierAndRetry(model, retry) {
  const res = await fetch("/api/langchain/llamacpp/prewarm", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error("Pre-warm failed");
  await retry();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/__tests__/BankingAgent.safety.test.js`
Expected: PASS — all tests in the file green, including the 8 new ones.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/demoAgentSafety.js demo_api_ui/src/__tests__/BankingAgent.safety.test.js
git commit -m "feat: add isLocalModelTimeout and prewarmTierAndRetry helpers"
```

---

### Task 2: Wire the pre-warm retry action into AIAgent.js

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js:94` (import)
- Modify: `demo_api_ui/src/components/AIAgent.js:335` (new state)
- Modify: `demo_api_ui/src/components/AIAgent.js:5571-5589` (`reportNlFailure`)
- Modify: `demo_api_ui/src/components/AIAgent.js:5908-5910` (`handleNaturalLanguageInner` catch block)
- Modify: `demo_api_ui/src/components/AIAgent.js:8818` area (render branch)

**Interfaces:**
- Consumes: `isLocalModelTimeout(err, provider)` and `prewarmTierAndRetry(model, retry)` from Task 1.
- Consumes: `activeLlmProvider` (existing component variable, already in scope at both `reportNlFailure` and the render function).
- Produces: message objects with `{ showPrewarmRetryAction: true, retryFn }` that the new render branch consumes.

No automated test mounts `AIAgent.js` (see the header comment in `BankingAgent.chipRouting.test.js`: "Mounting it in Jest adds significant mock surface without adding signal"). This task's own verification is the full existing test suite (no regressions) plus a production build (catches syntax/type errors). Manual verification is out of scope for this task — do it during `superpowers:verification-before-completion` / `superpowers:requesting-code-review` at the end of the plan.

- [ ] **Step 1: Import the new helpers**

In `demo_api_ui/src/components/AIAgent.js`, line 94:

```js
// OLD:
import { claimPendingNl, clampPanelPosition, makeReentrancyGuard, isAbortError, anySignal } from "./demoAgentSafety";

// NEW:
import { claimPendingNl, clampPanelPosition, makeReentrancyGuard, isAbortError, anySignal, isLocalModelTimeout, prewarmTierAndRetry } from "./demoAgentSafety";
```

- [ ] **Step 2: Add `prewarming` state**

At line 335, right after the `helixDegraded` state declaration:

```js
// OLD:
  const [helixDegraded, setHelixDegraded] = useState(false);
  const [modelAdvisory, setModelAdvisory] = useState(null);

// NEW:
  const [helixDegraded, setHelixDegraded] = useState(false);
  // Message id currently running the pre-warm-and-retry action (Task: prewarm-retry-timeout).
  const [prewarming, setPrewarming] = useState(null);
  const [modelAdvisory, setModelAdvisory] = useState(null);
```

- [ ] **Step 3: Gate `reportNlFailure` on the local-model timeout and add the pre-warm handler**

At lines 5571-5589, the current code is:

```js
  /** NL API errors: 401 is session missing on server — not a parse failure. */
  function reportNlFailure(err) {
    // AbortSignal.timeout() rejects with a TimeoutError (message "signal timed
    // out") — distinct from a user/cancel AbortError, so isAbortError() does NOT
    // swallow it and we land here. A slow local model (e.g. an Ollama reasoning
    // model on cold start) is the usual cause. Show an actionable hint instead
    // of the raw "Could not parse: signal timed out" string.
    const isTimeout =
      err?.name === "TimeoutError" ||
      (typeof err?.message === "string" && err.message.includes("timed out"));
    if (isTimeout) {
      notifyError("⏱️ The model took too long to respond — request timed out.", {
        autoClose: agentToastMs.errShort,
      });
      addMessage(
        "assistant",
        "That took too long to answer — the local model timed out. Try again (the model is faster once warmed up), or switch to a quicker mode (Helix/Anthropic, or a smaller Ollama model).",
      );
      return;
    }
```

Replace with:

```js
  /** NL API errors: 401 is session missing on server — not a parse failure. */
  function reportNlFailure(err, retry) {
    // AbortSignal.timeout() rejects with a TimeoutError (message "signal timed
    // out") — distinct from a user/cancel AbortError, so isAbortError() does NOT
    // swallow it and we land here. A slow local model (e.g. an Ollama reasoning
    // model on cold start) is the usual cause. Show an actionable hint instead
    // of the raw "Could not parse: signal timed out" string.
    const isTimeout =
      err?.name === "TimeoutError" ||
      (typeof err?.message === "string" && err.message.includes("timed out"));
    if (isTimeout) {
      notifyError("⏱️ The model took too long to respond — request timed out.", {
        autoClose: agentToastMs.errShort,
      });
      // Only llama.cpp timeouts get the pre-warm retry action — there's no
      // local tier to pre-warm for Helix/Anthropic.
      const offerPrewarmRetry = retry && isLocalModelTimeout(err, activeLlmProvider);
      addMessage(
        "assistant",
        "That took too long to answer — the local model timed out. Try again (the model is faster once warmed up), or switch to a quicker mode (Helix/Anthropic, or a smaller Ollama model).",
        null,
        offerPrewarmRetry ? { showPrewarmRetryAction: true, retryFn: retry } : undefined,
      );
      return;
    }
```

Note: confirm `addMessage`'s 4th parameter is an "extra metadata" object merged onto the message (this is the same pattern already used at line 5565: `addMessage("error", ..., null, { showCustomerLoginActions: true, source })`), so `msg.showPrewarmRetryAction` and `msg.retryFn` land directly on the message object.

- [ ] **Step 4: Add the pre-warm-and-retry click handler**

Immediately after the `reportNlFailure` function closes (after its final `}`, before the `maybeHandleCustomerLogin` function that currently follows it), add:

```js
  /** Click handler for the "Pre-warm the model & retry" action (Task: prewarm-retry-timeout). */
  async function handlePrewarmRetry(msgId, retryFn) {
    setPrewarming(msgId);
    try {
      await prewarmTierAndRetry("gpt-oss-20b", retryFn);
    } catch (_err) {
      notifyError("Could not pre-warm the model — try switching mode instead.", {
        autoClose: agentToastMs.errShort,
      });
    } finally {
      setPrewarming(null);
    }
  }
```

- [ ] **Step 5: Pass the retry closure from `handleNaturalLanguageInner`**

At lines 5908-5910, the current code is:

```js
    } catch (err) {
      if (isAbortError(err)) return;
      reportNlFailure(err);
    } finally {
      setNlLoading(false);
    }
  }
```

(this is the catch block that immediately follows the `await dispatchNlResult(_nlResult, _nlSource || "heuristic", text);` line inside `handleNaturalLanguageInner`). Replace with:

```js
    } catch (err) {
      if (isAbortError(err)) return;
      reportNlFailure(err, () => handleNaturalLanguageInner(text));
    } finally {
      setNlLoading(false);
    }
  }
```

- [ ] **Step 6: Render the pre-warm retry button**

At line 8818, the current code is:

```js
                    if (msg.role === "error" && msg.showCustomerLoginActions) {
```

Immediately before this line, insert a new branch (same message-list `.map`/`.forEach` render function, same pattern as the existing `showCustomerLoginActions`/`showSessionFixActions` branches):

```js
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
                    if (msg.role === "error" && msg.showCustomerLoginActions) {
```

- [ ] **Step 7: Run the full UI test suite to confirm no regressions**

Run: `cd demo_api_ui && CI=true npm test`
Expected: PASS — same pass count as the pre-Task-1 baseline plus the 8 new tests from Task 1; no new failures.

- [ ] **Step 8: Run a production build to catch syntax/type errors**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat: offer pre-warm-and-retry on local-model chat timeout"
```

---

## Self-Review Notes

- **Spec coverage:** Trigger condition (llamacpp-only) → Task 2 Step 3. Call-site retry closure → Task 2 Step 5. Rendering reusing `ba-session-fix-actions` → Task 2 Step 6. Pre-warm handler always targeting `gpt-oss-20b` → Task 2 Step 4. Error handling (toast + re-enable on failure) → Task 2 Step 4 catch block. Testing → Task 1 (helpers unit-tested); Task 2 relies on full-suite regression + build since `AIAgent.js` is not mounted in tests, consistent with this repo's existing testing convention. Out-of-scope 12 call sites → untouched, only Step 5 in Task 2 changes `handleNaturalLanguageInner`.
- **Placeholder scan:** none found — every step has literal code.
- **Type consistency:** `isLocalModelTimeout(err, provider)` and `prewarmTierAndRetry(model, retry)` signatures match between Task 1 (definition) and Task 2 (call sites). `handlePrewarmRetry(msgId, retryFn)` signature matches its Step 4 definition and Step 6 call site (`onClick={() => handlePrewarmRetry(msg.id, msg.retryFn)}`).
