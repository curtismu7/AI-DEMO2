# Demo Hardening Phase 2 — Fallback Ladder, Circuit Breaker, Warmup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM provider calls always answer inside the UI's time budget or fail fast into the deterministic ladder; a failing provider stops being retried live (circuit breaker, silent); every heuristic-eligible demo chip is test-guaranteed a deterministic answer; and the local model is warm before showtime.

**Architecture:** Extract helixLlmService's proven fetch ladder (AbortController timeout → one transport retry → one 429/5xx retry) into a shared `llmFetch` helper and wire it into the four bare provider clients (llamacpp/lmStudio/mlx/gemini — verified today: no timeout or retry except gemini's 60s timeout + model rotation). Add a tiny per-provider circuit breaker consulted at the six NL-intent provider branches — breaker-open behaves exactly like the existing provider-error path (heuristic result returned, mode picker untouched, audience sees nothing). A manifest-driven jest test locks heuristic coverage for every `mode:'both'` chip across all 13 vertical manifests. A warmup script loads the big model tier after `run.sh` starts the llm-proxy (background, non-blocking).

**Tech Stack:** Node.js CommonJS + jest (demo_api_server), bash (scripts/, run.sh).

**Spec:** `docs/superpowers/specs/2026-07-11-demo-hardening-design.md` (Phase 2 section).

**Verified current-state facts this plan is built on:**
- UI budget on the chip/NL path (`/api/demo-agent/nl`, `demo_api_ui/src/components/AIAgent.js:4909`): **60000 ms for local providers** (`anthropic-lmstudio` | `llamacpp` | `mlx` | `helix`), **15000 ms otherwise** (google/claude). Server-side timeouts must stay under the matching client budget.
- helix pattern donor: `helixFetch`/`helixFetchWithRetry` (`demo_api_server/services/helixLlmService.js:97-147`, `FETCH_TIMEOUT_MS = 15000` at `:31`).
- Chips source of truth: `demo_api_server/config/verticals/<id>/manifest.json` → `dashboard.chips10`, entries `{id,label,message,mode,tool}` across 12 manifests; mode distribution today: `both`=85, `llm`=7, `direct`=9. `parseHeuristic(message, vertical, verticalCtx = null, options = {})` (`services/nlIntentParser.js:839`); `mode:'llm'` chip texts are DELIBERATELY forced to `kind:'none'` (`nlIntentParser.js:916-924`) — they target the reasoning path.
- Existing coverage: `tests/nlIntentParser.catalog.test.js:183-221` ALREADY implements the "every `both` chip resolves to a heuristic" contract — but only for 5 verticals (`VERTICALS = ['banking','healthcare','retail','sporting-goods','workforce']` at `:186`). Task 5 EXTENDS that list; it does not add a duplicate test file. (Other chip families — `securityShowcase.tabs[].chips`, `llmChipGroups` — are separate surfaces, out of Phase 2 scope.)
- llm-proxy (`demo_llm_proxy/router.js`): endpoints are `/health` (GET; `models:[{name,port,size,healthy,load}]`, 200/503), `/refresh` (POST), `/status` (GET) — there is NO admin/load endpoint. `LLM_PROXY_PIN_TIER` is a **port number** (`:25`); a pinned tier is `swapTo`-loaded at proxy boot (`:403-407`) and idle decay is disabled (`:236`). A `/v1/chat/completions` POST naming a bigger tier's model triggers the swap machinery (`:223`); a cold swap can take `SWAP_TIMEOUT_MS = 180000` (`:21`) — more than any client budget, which is exactly why warmup matters. run.sh starts the proxy in `_start_llm_proxy_stack()` (`run.sh:406-423`) and never issues a warm completion; the BFF has an existing UI-triggered prewarm route (`demo_api_server/routes/langchainConfig.js:417-436`) that is not wired into any launcher.

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️` `✅` `❌` `🔐` `✕` `✓`.
- Minimal diff; no new npm dependencies; no OAuth/permission scope changes.
- Jest from `demo_api_server/`; in this `.claude/worktrees/` checkout EVERY jest run must append `--testPathIgnorePatterns='/node_modules/'` (0 matches is NOT a pass). Test files go in `demo_api_server/src/__tests__/` or `demo_api_server/tests/` — jest testMatch collects ONLY those two roots.
- Preserve provider behavior contracts: error message formats (`"llama.cpp chat/completions failed: <status> <text>"`, `"LM Studio chat/completions failed: ..."`, `"mlx-lm chat/completions failed: ..."`, `"Gemini API <status>: <msg>"`), llamacpp's Phase-1 `jsonSchema`/400-compat-retry behavior (locked by `src/__tests__/llamacppLlmService.jsonSchema.test.js`), gemini's 429 model rotation, and `<think>` stripping.
- Breaker is SILENT and per-request: on open it must produce exactly the same return shape as the existing provider-error catch path in `geminiNlIntent.js`; it must never touch agent mode, the mode picker, or configStore.
- Stage explicitly (`git add <files>`, never `-A`); verify `git branch --show-current` = plan/demo-hardening-phase2 before each commit; leave `demo_api_server/data/persistent/*` test artifacts unstaged.
- `bash -n run.sh` must pass after any run.sh edit.

---

### Task 1: `llmFetch` — shared timeout + retry ladder

**Files:**
- Create: `demo_api_server/services/llmFetch.js`
- Test: `demo_api_server/src/__tests__/llmFetch.test.js`

**Interfaces:**
- Consumes: nothing (global `fetch`).
- Produces: `llmFetch(url, options?, opts?) => Promise<Response>` where `opts = { label = 'llm', timeoutMs = DEFAULT_LLM_TIMEOUT_MS, retryOn429 = true }`. Behavior: hard AbortController timeout per attempt (AbortError → `Error("<label> timed out after <timeoutMs>ms")`); one transport-retry (250ms wait, `Connection: close` header) on thrown fetch errors; then one retry on HTTP 429/5xx (waits `Retry-After` seconds if present, else 2000ms) when `retryOn429` is true — a 429/5xx on the second attempt is returned to the caller. Non-retryable HTTP statuses are returned, never thrown. Also exports `DEFAULT_LLM_TIMEOUT_MS` (env `LLM_FETCH_TIMEOUT_MS`, default `55000` — a hang guard that stays under the UI's 60s local-provider budget WITHOUT cutting off slow-but-successful big-model replies; today these providers have NO timeout at all and hang forever. Remote providers with a 15s client budget pass a tighter per-call `timeoutMs`).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/llmFetch.test.js
'use strict';

const { llmFetch, DEFAULT_LLM_TIMEOUT_MS } = require('../../services/llmFetch');

describe('llmFetch', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('returns a successful response untouched', async () => {
    const resp = { ok: true, status: 200 };
    global.fetch = jest.fn(async () => resp);
    await expect(llmFetch('http://x/health', {}, { label: 't' })).resolves.toBe(resp);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on transport error with Connection: close', async () => {
    const resp = { ok: true, status: 200 };
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(resp);
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(llmFetch('http://x/chat', { headers: { A: 'b' } }, { label: 't' })).resolves.toBe(resp);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondInit = global.fetch.mock.calls[1][1];
    expect(secondInit.headers.Connection).toBe('close');
    expect(secondInit.headers.A).toBe('b');
    spy.mockRestore();
  });

  it('retries once on 429 honoring Retry-After, then returns the retry response', async () => {
    const retryResp = { ok: true, status: 200 };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: (h) => (h === 'Retry-After' ? '0' : null) } })
      .mockResolvedValueOnce(retryResp);
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(llmFetch('http://x/chat', {}, { label: 't' })).resolves.toBe(retryResp);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('does not retry 429 when retryOn429 is false (gemini rotates models instead)', async () => {
    const resp429 = { ok: false, status: 429, headers: { get: () => null } };
    global.fetch = jest.fn(async () => resp429);
    await expect(llmFetch('http://x/chat', {}, { label: 't', retryOn429: false })).resolves.toBe(resp429);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns non-retryable HTTP errors without retrying', async () => {
    const resp400 = { ok: false, status: 400, headers: { get: () => null } };
    global.fetch = jest.fn(async () => resp400);
    await expect(llmFetch('http://x/chat', {}, { label: 't' })).resolves.toBe(resp400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('times out with a labeled error', async () => {
    global.fetch = jest.fn((url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    }));
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(llmFetch('http://x/slow', {}, { label: 'slowsvc', timeoutMs: 50 }))
      .rejects.toThrow(/slowsvc timed out after 50ms/);
    spy.mockRestore();
  });

  it('exports a default timeout under the 60s local-provider client budget', () => {
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeLessThan(60000);
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmFetch --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL with "Cannot find module '../../services/llmFetch'"

- [ ] **Step 3: Write the implementation**

```js
// demo_api_server/services/llmFetch.js
/**
 * Shared LLM fetch ladder (demo hardening Phase 2) — the helixLlmService
 * pattern (helixFetch/helixFetchWithRetry) extracted for every provider:
 *   1. hard AbortController timeout per attempt,
 *   2. one transport retry with a fresh connection (Connection: close),
 *   3. one retry on 429/5xx honoring Retry-After (opt-out via retryOn429:false
 *      for providers with their own quota strategy, e.g. gemini model rotation).
 * HTTP error statuses are RETURNED, never thrown — callers keep their own
 * status handling and error message formats.
 */
'use strict';

const envTimeout = parseInt(process.env.LLM_FETCH_TIMEOUT_MS || '', 10);
// Hang guard, not a latency target: stays under the UI's 60s local-provider
// budget on /api/demo-agent/nl (AIAgent.js) without cutting off slow big-model
// replies. Remote providers with a 15s client budget pass a tighter timeoutMs.
const DEFAULT_LLM_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 55000;

async function llmFetch(url, options = {}, { label = 'llm', timeoutMs = DEFAULT_LLM_TIMEOUT_MS, retryOn429 = true } = {}) {
  async function attempt(extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), ...extraHeaders },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`${label} timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await attempt();
  } catch (err) {
    // Timeouts are not transport blips — surface them without a retry.
    if (/timed out after/.test(err.message)) throw err;
    console.warn(`[llmFetch] ${label} transport error — retrying once with a fresh connection:`, err.message);
    await new Promise((r) => setTimeout(r, 250));
    res = await attempt({ Connection: 'close' });
  }

  if (retryOn429 && (res.status === 429 || res.status >= 500)) {
    const retryAfter = res.headers?.get?.('Retry-After');
    const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
    console.warn(`[llmFetch] ${label} got ${res.status} — retrying in ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
    return attempt();
  }

  return res;
}

module.exports = { llmFetch, DEFAULT_LLM_TIMEOUT_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmFetch --testPathIgnorePatterns='/node_modules/'`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/llmFetch.js demo_api_server/src/__tests__/llmFetch.test.js
git commit -m "feat(llm): shared llmFetch ladder — timeout, transport retry, 429/5xx retry"
```

---

### Task 2: Wire the four bare providers to `llmFetch`

**Files:**
- Modify: `demo_api_server/services/llamacppLlmService.js` (the `post()` closure inside `callLlamaCpp`)
- Modify: `demo_api_server/services/lmStudioLlmService.js:51-60` (the chat/completions fetch)
- Modify: `demo_api_server/services/mlxLlmService.js:49-61` (the chat/completions fetch)
- Modify: `demo_api_server/services/googleGeminiLlmService.js:51-61` (`generateOnce`)
- Test: `demo_api_server/src/__tests__/providerLlmFetch.test.js`

**Interfaces:**
- Consumes: `llmFetch(url, options, { label, timeoutMs?, retryOn429? })` from Task 1.
- Produces: no signature changes — `callLlamaCpp(messages, opts)`, `callLmStudio(messages)`, `callMlx(messages)`, `callGemini(messages, config)` keep their exact contracts, error message formats, jsonSchema/400-compat behavior (llamacpp), and 429 model rotation (gemini).

**Wiring rules (exact edits):**

1. **llamacpp** — add `const { llmFetch } = require('./llmFetch');` at the top; inside `callLlamaCpp`, replace the `post()` closure body's bare `fetch(...)` with:

```js
  const post = () => llmFetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer llama-cpp',
    },
    body: JSON.stringify(body),
  }, { label: 'llama.cpp' });
```

Everything else in the function (the 400/response_format compat retry, error text, empty-completion check, `<think>` strip) stays byte-identical. The model-discovery `fetch` in `model()` keeps its own try/catch and is NOT changed (it already falls back safely).

2. **lmStudio** — add the same require; replace the chat fetch (lines 51-60):

```js
  const res = await llmFetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // LM Studio ignores the key but the OpenAI client shape expects one.
      Authorization: 'Bearer lm-studio',
    },
    body: JSON.stringify({ model, messages: toOpenAiMessages(messages), stream: false }),
  }, { label: 'LM Studio' });
```

`resolveModel`'s `/models` fetch is unchanged (it throws already; a hang there is bounded by the caller's overall behavior — do not change it in this task).

3. **mlx** — same require; replace the chat fetch (lines 49-61) keeping the body identical, with `{ label: 'mlx-lm' }`.

4. **gemini** — same require; replace `generateOnce`'s fetch (lines 53-58):

```js
  const res = await llmFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { label: 'gemini', timeoutMs: 12000, retryOn429: false });
```

`retryOn429: false` because `callGemini` already rotates models on 429 — an internal retry would double the quota-storm latency. 12s timeout: gemini rides the UI's 15s remote-provider budget (`AIAgent.js:4909` — 60s applies only to local providers/helix), and the previous per-attempt 60s meant a 4-model rotation could take 240s against a 15s client. Delete the now-redundant `signal: AbortSignal.timeout(60000)` line. The `.json().catch(() => ({}))` and rotation logic stay byte-identical.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/providerLlmFetch.test.js
'use strict';

/**
 * Phase 2: the four bare provider clients route their completion calls
 * through the shared llmFetch ladder. We assert the observable behaviors the
 * ladder adds (timeout label, transport retry) without duplicating
 * llmFetch's own unit tests.
 */

describe('providers use llmFetch', () => {
  const realFetch = global.fetch;
  beforeEach(() => { jest.resetModules(); });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LLAMACPP_MODEL;
    delete process.env.MLX_LM_MODEL;
  });

  const okCompletion = (content) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it('llama.cpp: transport error is retried once and succeeds', async () => {
    process.env.LLAMACPP_MODEL = 'test-model';
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError('socket reset'))
      .mockResolvedValueOnce(okCompletion('hi'));
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    await expect(callLlamaCpp([{ role: 'user', content: 'x' }])).resolves.toBe('hi');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('LM Studio: hung socket times out with a labeled error instead of hanging', async () => {
    global.fetch = jest.fn((url, init) => {
      if (String(url).endsWith('/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'm1' }] }) });
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    });
    process.env.LLM_FETCH_TIMEOUT_MS_TEST_HOOK = '1'; // documents intent; timeout comes from opts below
    const { callLmStudio } = require('../../services/lmStudioLlmService');
    // DEFAULT_LLM_TIMEOUT_MS is 12s — too slow for a unit test, so this test
    // relies on jest fake timers to fast-forward the abort timer.
    jest.useFakeTimers();
    const p = callLmStudio([{ role: 'user', content: 'x' }]);
    const assertion = expect(p).rejects.toThrow(/LM Studio timed out after/);
    await jest.advanceTimersByTimeAsync(56000); // default timeout is 55s
    await assertion;
    jest.useRealTimers();
  });

  it('mlx: 400 response is returned to caller unchanged (error format preserved)', async () => {
    process.env.MLX_LM_MODEL = 'test-model';
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request' }));
    const { callMlx } = require('../../services/mlxLlmService');
    await expect(callMlx([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/mlx-lm chat\/completions failed: 400 bad request/);
    expect(global.fetch).toHaveBeenCalledTimes(1); // 400 is not retryable
  });

  it('gemini: 429 rotates to the next model without an internal 429 retry', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: 'quota' } }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }) };
    });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { callGemini } = require('../../services/googleGeminiLlmService');
    await expect(callGemini([{ role: 'user', content: 'x' }], { google_api_key: 'k', google_model: 'gemini-2.0-flash' }))
      .resolves.toBe('answer');
    expect(calls).toHaveLength(2);            // one call per model — no internal 429 retry
    expect(calls[0]).toContain('gemini-2.0-flash');
    expect(calls[1]).not.toContain('gemini-2.0-flash:'); // rotated to a different model
    spy.mockRestore();
  });
});
```

Implementer note: if the fake-timer LM Studio case fights jest's timer semantics (llmFetch's `setTimeout` for the abort), an equally valid variant is to make the timeout injectable per-call ONLY for that service via `process.env.LLM_FETCH_TIMEOUT_MS` before `jest.resetModules()`/require (the module reads it at load): set it to `'50'`, use real timers, and assert the same rejection. Use whichever runs green deterministically; keep the assertion (`/LM Studio timed out after/`) identical. Remove the `LLM_FETCH_TIMEOUT_MS_TEST_HOOK` line if you use the env variant.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=providerLlmFetch --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — today a transport error on llama.cpp is NOT retried (1 call, rejection), LM Studio never times out, etc.

- [ ] **Step 3: Apply the four wiring edits** (shown above in Wiring rules)

- [ ] **Step 4: Run the provider + regression suites**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/' --testPathPattern='providerLlmFetch|llmFetch|llamacpp|geminiNlIntent|llmProviderResolver|resolveLlmBackend|healthServices'`
Expected: PASS — including the Phase-1 `llamacppLlmService.jsonSchema.test.js` (jsonSchema + 400-compat retry must still hold; note its mocked 400 case now passes through llmFetch, which does NOT retry 400s, so the existing two-call assertion is unaffected).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/llamacppLlmService.js demo_api_server/services/lmStudioLlmService.js demo_api_server/services/mlxLlmService.js demo_api_server/services/googleGeminiLlmService.js demo_api_server/src/__tests__/providerLlmFetch.test.js
git commit -m "feat(llm): llamacpp/lmstudio/mlx/gemini ride the shared llmFetch ladder"
```

---

### Task 3: `llmCircuitBreaker` — per-provider, silent, self-resetting

**Files:**
- Create: `demo_api_server/services/llmCircuitBreaker.js`
- Test: `demo_api_server/src/__tests__/llmCircuitBreaker.test.js`

**Interfaces:**
- Consumes: `logMendEvent` from `./llmResponseContract` (Phase 1 telemetry).
- Produces: `isOpen(provider: string) => boolean`; `recordFailure(provider) => void` (3rd consecutive failure opens the breaker for 60s and logs a `breaker_open` mend event); `recordSuccess(provider) => void` (clears the provider's state); `_resetAll()` (tests only). Half-open semantics: after the cooldown expires `isOpen` returns false (one probe request flows); a failure while the count is still ≥ threshold re-opens immediately; a success closes fully. Constants exported: `BREAKER_THRESHOLD = 3`, `BREAKER_COOLDOWN_MS = 60000`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/llmCircuitBreaker.test.js
'use strict';

const breaker = require('../../services/llmCircuitBreaker');

describe('llmCircuitBreaker', () => {
  let nowSpy;
  let now;
  beforeEach(() => {
    breaker._resetAll();
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('stays closed below the threshold', () => {
    breaker.recordFailure('llamacpp');
    breaker.recordFailure('llamacpp');
    expect(breaker.isOpen('llamacpp')).toBe(false);
  });

  it('opens on the 3rd consecutive failure and logs a mend event', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < breaker.BREAKER_THRESHOLD; i += 1) breaker.recordFailure('llamacpp');
    expect(breaker.isOpen('llamacpp')).toBe(true);
    expect(spy).toHaveBeenCalledWith('[llmContract]', expect.stringContaining('breaker_open'));
    spy.mockRestore();
  });

  it('is per-provider', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('helix');
    expect(breaker.isOpen('helix')).toBe(true);
    expect(breaker.isOpen('llamacpp')).toBe(false);
    spy.mockRestore();
  });

  it('half-opens after the cooldown; a failure re-opens immediately; success closes', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('mlx');
    expect(breaker.isOpen('mlx')).toBe(true);

    now += breaker.BREAKER_COOLDOWN_MS + 1;
    expect(breaker.isOpen('mlx')).toBe(false);       // half-open probe allowed

    breaker.recordFailure('mlx');                     // probe failed
    expect(breaker.isOpen('mlx')).toBe(true);         // re-opened without needing 3 more

    now += breaker.BREAKER_COOLDOWN_MS + 1;
    breaker.recordSuccess('mlx');                     // probe succeeded
    expect(breaker.isOpen('mlx')).toBe(false);
    breaker.recordFailure('mlx');                     // fresh count after success
    breaker.recordFailure('mlx');
    expect(breaker.isOpen('mlx')).toBe(false);        // 2 < threshold again
    spy.mockRestore();
  });

  it('recordSuccess on an unknown provider is a no-op', () => {
    expect(() => breaker.recordSuccess('never-seen')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmCircuitBreaker --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL with "Cannot find module '../../services/llmCircuitBreaker'"

- [ ] **Step 3: Write the implementation**

```js
// demo_api_server/services/llmCircuitBreaker.js
/**
 * Per-provider circuit breaker for NL-intent LLM calls (demo hardening
 * Phase 2). After BREAKER_THRESHOLD consecutive failures the provider is
 * skipped for BREAKER_COOLDOWN_MS — requests fall straight to the existing
 * deterministic ladder (heuristic floor / conversational fallback), exactly
 * like a provider error. SILENT by design: never touches agent mode, the
 * mode picker, or configStore; visible only in [llmContract] telemetry.
 * Half-open: after the cooldown one probe flows; failure re-opens
 * immediately, success closes fully.
 */
'use strict';

const { logMendEvent } = require('./llmResponseContract');

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60000;

/** provider -> { failures, openUntil } */
const state = new Map();

function isOpen(provider) {
  const s = state.get(provider);
  return !!s && Date.now() < s.openUntil;
}

function recordFailure(provider) {
  const s = state.get(provider) || { failures: 0, openUntil: 0 };
  s.failures += 1;
  if (s.failures >= BREAKER_THRESHOLD) {
    s.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logMendEvent('breaker_open', { provider, failures: s.failures, cooldownMs: BREAKER_COOLDOWN_MS });
  }
  state.set(provider, s);
}

function recordSuccess(provider) {
  state.delete(provider);
}

/** Tests only. */
function _resetAll() {
  state.clear();
}

module.exports = { isOpen, recordFailure, recordSuccess, _resetAll, BREAKER_THRESHOLD, BREAKER_COOLDOWN_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmCircuitBreaker --testPathIgnorePatterns='/node_modules/'`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/llmCircuitBreaker.js demo_api_server/src/__tests__/llmCircuitBreaker.test.js
git commit -m "feat(llm): per-provider circuit breaker with half-open probe"
```

---

### Task 4: Wire the breaker into the six NL-intent provider branches

**Files:**
- Modify: `demo_api_server/services/geminiNlIntent.js` (six provider branches inside `parseNaturalLanguage`: helix, CLAUDE_PROVIDERS, GOOGLE_PROVIDERS, LMSTUDIO_PROVIDERS, LLAMACPP_PROVIDERS, MLX_PROVIDERS)
- Test: `demo_api_server/src/__tests__/geminiNlIntent.breaker.test.js`

**Interfaces:**
- Consumes: `isOpen`, `recordFailure`, `recordSuccess` from Task 3.
- Produces: no API change. New behavior: when a provider's breaker is open, its branch returns the existing provider-error shape immediately — `{ source: 'heuristic', result: heuristicResult, llm_attempted: false, breaker_open: true }` — without calling the provider. Success paths record success; catch blocks record failure.

**Wiring pattern (identical for all six branches; provider keys: `'helix'`, `'claude'`, `'google'`, `'lmstudio'`, `'llamacpp'`, `'mlx'`):**

Add the require at the top of geminiNlIntent.js with the other service requires:

```js
const llmBreaker = require('./llmCircuitBreaker');
```

At the TOP of each branch body (immediately inside the `if (...)` for that provider, before any config checks), insert:

```js
    if (llmBreaker.isOpen('llamacpp')) {
      console.warn('[nlIntent] llamacpp breaker open — skipping provider, using deterministic ladder');
      return { source: 'heuristic', result: heuristicResult, llm_attempted: false, breaker_open: true };
    }
```

(adjust the provider key + log text per branch).

In each branch's `catch (err)` block (the one that returns `{ source: 'heuristic', ... llm_attempted: true }`), add as the FIRST line:

```js
      llmBreaker.recordFailure('llamacpp');
```

Immediately after each branch obtains a usable reply (the line where the raw/parsed response arrived without throwing — for helix: after `callHelixAgent` resolves; for claude: after `client.messages.create` resolves; for google/lmstudio/llamacpp/mlx: after the `callX` resolves on the FIRST call of the branch), add:

```js
      llmBreaker.recordSuccess('llamacpp');
```

Notes: a provider returning non-JSON that later falls to the nudge/floor is a SUCCESSFUL provider call (the LLM answered) — success is recorded on transport success, not on parse success. The retry-nudge call sites do not need their own record calls. The `llm_not_configured` early returns are NOT failures — do not record anything there.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/geminiNlIntent.breaker.test.js
'use strict';

/**
 * Phase 2: when a provider's circuit breaker is open, the NL-intent branch
 * skips the provider entirely and returns the same shape as a provider error
 * (heuristic result, silent) — the mode picker and agent mode are untouched.
 */

jest.mock('../../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));

const { callLlamaCpp } = require('../../services/llamacppLlmService');
const breaker = require('../../services/llmCircuitBreaker');
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

describe('geminiNlIntent circuit breaker', () => {
  beforeEach(() => {
    breaker._resetAll();
    callLlamaCpp.mockReset();
  });

  const ask = () => parseNaturalLanguage(
    'please do something no heuristic understands xyzzy',
    { role: 'user' },
    { provider: 'llamacpp' },
    'llamacpp',
  );

  it('three consecutive provider failures open the breaker; the 4th request never calls the provider', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    callLlamaCpp.mockRejectedValue(new Error('ECONNREFUSED'));
    await ask();
    await ask();
    await ask();
    expect(callLlamaCpp).toHaveBeenCalledTimes(3);

    const res = await ask();                          // breaker now open
    expect(callLlamaCpp).toHaveBeenCalledTimes(3);    // provider NOT called again
    expect(res.source).toBe('heuristic');
    expect(res.breaker_open).toBe(true);
    expect(res.llm_attempted).toBe(false);
    spy.mockRestore();
  });

  it('a successful call resets the failure count', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    callLlamaCpp.mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('{"kind":"banking","banking":{"action":"accounts"}}');
    await ask();
    await ask();
    const ok = await ask();                           // success — resets count
    expect(ok.source).toBe('llamacpp');
    callLlamaCpp.mockRejectedValue(new Error('boom'));
    await ask();
    await ask();
    const res = await ask();                          // only 2 consecutive failures + this 3rd one opens it
    expect(breaker.isOpen('llamacpp')).toBe(true);
    expect(res.source).toBe('heuristic');             // this 3rd failing call still went to the provider
    spy.mockRestore();
  });
});
```

Implementer note: `parseNaturalLanguage`'s exact parameter order is `(message, context, langchainConfig, provider, ...)` — read the function signature at the top of `parseNaturalLanguage` in geminiNlIntent.js and adjust the `ask()` call so the request reaches the LLAMACPP branch with heuristic routing missing the phrase (the xyzzy message guarantees `kind:'none'` from the heuristic). If reaching the branch needs a specific agent-mode/config shape (check how existing `geminiNlIntent.llmOnly.test.js` builds its calls and mirror that setup exactly), copy that test's arrangement. The assertions above are the contract; the arrangement mirrors existing tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=geminiNlIntent.breaker --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — today the 4th request still calls the provider (no breaker), and `breaker_open` is undefined.

- [ ] **Step 3: Apply the wiring** (pattern above, all six branches)

- [ ] **Step 4: Run the full NL-intent suites**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/' --testPathPattern='geminiNlIntent|nlIntentParser|tryParseIntentJson|llmCircuitBreaker'`
Expected: PASS — every pre-existing geminiNlIntent suite still green (the breaker starts closed and only trips on 3 consecutive failures, so existing single-failure tests are unaffected; if a pre-existing suite loops ≥3 failures for one provider, call `require('../../services/llmCircuitBreaker')._resetAll()` in that suite's `beforeEach` and note it in the report).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/geminiNlIntent.js demo_api_server/src/__tests__/geminiNlIntent.breaker.test.js
git commit -m "feat(nl-intent): circuit breaker skips failing providers, silent heuristic fallback"
```

---

### Task 5: Extend the chip-routing contract to ALL chips10 verticals — audit + gap fill

**Files:**
- Modify: `demo_api_server/tests/nlIntentParser.catalog.test.js:186` (the `VERTICALS` list inside the `'chip routing contract — every \`both\` chip resolves to a heuristic (all verticals)'` describe — this existing test already implements the full contract: manifest-driven, filters `mode==='both'`, sets the active vertical via `verticalManifest.resolver.setActive(v)`, asserts non-none; it just only lists 5 verticals)
- Modify (only if the audit finds gaps): the `HEURISTICS` array in the affected `demo_api_server/config/verticals/<id>/index.js` files

**Interfaces:**
- Consumes: the existing test scaffolding in `tests/nlIntentParser.catalog.test.js:183-221` (do NOT create a new test file — extending the list keeps one source of truth).
- Produces: a standing guarantee that every `mode:'both'` chip in every chips10-bearing manifest heuristic-parses to non-none. `mode:'llm'` and `mode:'direct'` chips remain exempt by the existing filter. The 12 chips10 verticals: `admin`, `banking`, `government`, `healthcare`, `investment`, `manufacturing`, `oauth-teaching`, `pingone-admin`, `retail`, `sporting-goods`, `university`, `workforce`.

- [ ] **Step 1: Extend the VERTICALS list**

In `demo_api_server/tests/nlIntentParser.catalog.test.js`, replace:

```js
  const VERTICALS = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce'];
```

with:

```js
  // Phase 2 demo hardening: ALL chips10-bearing verticals, so an LLM outage
  // can never leave a `both` chip dead in any vertical. mode:'llm' and
  // mode:'direct' chips stay exempt via the bothChips filter below.
  const VERTICALS = [
    'admin', 'banking', 'government', 'healthcare', 'investment',
    'manufacturing', 'oauth-teaching', 'pingone-admin', 'retail',
    'sporting-goods', 'university', 'workforce',
  ];
```

Nothing else in the describe changes — the per-chip `it` generation, `resolveActiveVerticalCtx`, and the `both` filter already handle the new entries.

- [ ] **Step 2: Run the test — this is the audit**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern='nlIntentParser.catalog' --testPathIgnorePatterns='/node_modules/'`
Expected: either PASS (no gaps — skip Step 3) or a NAMED list of failing chips (each failure names the vertical, chip label, and message). Record the full failing list in your report. Note: if a newly added vertical has zero `both` chips, its `'has at least one \`both\` chip'` guard fails — check that manifest's chips10 modes; if the vertical genuinely has only llm/direct chips, move it OUT of VERTICALS with a one-line comment naming why, and note it in the report.

- [ ] **Step 3: Fill each gap (only chips the audit named)**

For each failing chip, add ONE entry to the `HEURISTICS` array in that vertical's `config/verticals/<id>/index.js`, following the file's conventions exactly (see healthcare `index.js:11-30`): shape `{ re: /<pattern>/i, action: '<the chip's tool field from the manifest>' }`, placed with a comment noting ordering if the pattern could shadow or be shadowed by an existing entry (most specific first — read the file's header comment). Derive the regex from the chip's `message` phrase, generalized to word boundaries (e.g. message "check my coverage" → `/\bcheck\b.*\bcoverage\b|\bmy coverage\b/i`) — do NOT paste the raw sentence as an exact-match regex. The chip's `tool` field names the action to route to. If a failing chip's `tool` does not exist in that vertical's `tools.js`, STOP and report DONE_WITH_CONCERNS naming it — do not invent an action.

- [ ] **Step 4: Re-run coverage + the intent regression suites**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/' --testPathPattern='nlIntentParser|geminiNlIntent|chipSchemaContract'`
Expected: PASS all — including the pre-existing `nlIntentParser.*` suites (a new heuristic that shadows an existing route will break them; fix placement/specificity, not the old tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/tests/nlIntentParser.catalog.test.js demo_api_server/config/verticals/
git commit -m "test(chips): every mode:both chip guaranteed a heuristic answer (+ gap fills)"
```

---

### Task 6: Pre-demo LLM warmup script + run.sh hook

**Files:**
- Create: `scripts/llm-warmup.sh` (repo root scripts/)
- Modify: `run.sh` (immediately after the `_start_llm_proxy_stack` invocation completes its health gate — locate by content: the block that starts the llm proxy and its `wait_for_health` on port 8090; add the hook right after)

**Interfaces:**
- Consumes: llm-proxy `/health` (`{ status, mode, models:[{name,port,loaded,healthy}] }`) and `/v1/chat/completions` on `LLAMACPP_BASE_URL` (default `http://localhost:8090`). A completion naming a tier's model triggers the proxy's swap/load machinery; `LLM_PROXY_PIN_TIER=<port>` already boot-loads the pinned tier (router.js:403-405) — the script is a no-op fast-path when the target is already `loaded`.
- Produces: `scripts/llm-warmup.sh` — exit 0 once the target tier reports `loaded:true && healthy:true`, exit 1 on timeout. run.sh launches it in the background (non-blocking; a 180s cold load must not stall startup) unless `LLM_WARMUP=0`.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/llm-warmup.sh — load the demo LLM tier BEFORE showtime so the cold
# model swap (up to ~180s) never happens during a live demo.
#
#   PROXY URL:   LLAMACPP_BASE_URL   (default http://localhost:8090)
#   TARGET:      LLM_WARMUP_MODEL    (default: LAST model in /health list — the big tier)
#   TIMEOUT:     LLM_WARMUP_TIMEOUT_S (default 240)
#
# How it works: POST a 1-token completion naming the target model — the proxy's
# router treats an explicit model pin as a tier request and runs its swap/load
# machinery — then poll /health until that tier reports loaded && healthy.
# When LLM_PROXY_PIN_TIER is set the router already boot-loads the pinned tier;
# this script then just confirms and exits fast.
#
# SE k8s note: the cluster proxy pod sets LLM_PROXY_PIN_TIER (see the deploy
# scripts), so warmup there is automatic at pod start; this script is for
# native/local runs (run.sh calls it in the background) and manual pre-demo
# checks: ./scripts/llm-warmup.sh && echo ready.
set -u

PROXY="${LLAMACPP_BASE_URL:-http://localhost:8090}"
TIMEOUT_S="${LLM_WARMUP_TIMEOUT_S:-240}"

health() { curl -s --max-time 3 "${PROXY}/health" 2>/dev/null; }

resolve_target() {
  # Default to the LAST tier in /health (the biggest model).
  health | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    models=d.get("models") or []
    print(models[-1]["name"] if models else "")
except Exception:
    print("")'
}

TARGET="${LLM_WARMUP_MODEL:-$(resolve_target)}"
if [[ -z "$TARGET" ]]; then
  echo "[llm-warmup] proxy not reachable at ${PROXY} or no models listed — aborting" >&2
  exit 1
fi

is_loaded() {
  health | TARGET="$TARGET" python3 -c '
import json,os,sys
try:
    d=json.load(sys.stdin)
    for m in d.get("models") or []:
        if m.get("name")==os.environ["TARGET"] and m.get("loaded") and m.get("healthy"):
            print("yes"); break
except Exception:
    pass'
}

if [[ "$(is_loaded)" == "yes" ]]; then
  echo "[llm-warmup] ${TARGET} already loaded — nothing to do"
  exit 0
fi

echo "[llm-warmup] requesting load of ${TARGET} (timeout ${TIMEOUT_S}s)..."
# Fire the loading completion in the background; the proxy holds the request
# through the swap, so don't block the poll loop on it.
curl -s --max-time "$TIMEOUT_S" -X POST "${PROXY}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${TARGET}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":1}" \
  > /dev/null 2>&1 &

elapsed=0
while [[ $elapsed -lt $TIMEOUT_S ]]; do
  if [[ "$(is_loaded)" == "yes" ]]; then
    echo "[llm-warmup] ${TARGET} loaded and healthy after ${elapsed}s"
    exit 0
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

echo "[llm-warmup] TIMEOUT: ${TARGET} not loaded after ${TIMEOUT_S}s — check the proxy log" >&2
exit 1
```

Make it executable: `chmod +x scripts/llm-warmup.sh`.

- [ ] **Step 2: Hook into run.sh**

Locate the llm-proxy startup area (the `wait_for_health` gate on port 8090, or where `_start_llm_proxy_stack` is invoked — find by grepping `8090` in run.sh) and add immediately AFTER the proxy is confirmed up:

```bash
# Demo hardening Phase 2: pre-load the big LLM tier in the background so the
# cold model swap (~180s) never fires during a live demo. LLM_WARMUP=0 skips.
if [[ "${LLM_WARMUP:-1}" == "1" ]]; then
  nohup "$BASEDIR/scripts/llm-warmup.sh" > /tmp/demo-llm-warmup.log 2>&1 &
  echo "   LLM warmup started in background (log: /tmp/demo-llm-warmup.log)"
fi
```

Use the variable run.sh actually uses for the repo root at that point (`$BASEDIR` — verify by reading nearby lines; use `$ROOT` if that's what the surrounding code uses).

- [ ] **Step 3: Verify**

```bash
bash -n run.sh && bash -n scripts/llm-warmup.sh && echo syntax-ok
# Live check (only if the local proxy is running):
curl -s --max-time 2 http://localhost:8090/health >/dev/null && ./scripts/llm-warmup.sh; echo "exit=$?"
```

Expected: `syntax-ok`; if the proxy is up, the script exits 0 (fast if already loaded, after the load otherwise). If the proxy is down, note "proxy down — syntax check only" in the report.

- [ ] **Step 4: Commit**

```bash
git add scripts/llm-warmup.sh run.sh
git commit -m "feat(llm): pre-demo tier warmup script, backgrounded from run.sh"
```

---

### Task 7: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full BFF suite**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/|/tests/real/'`
Expected: no NEW failures vs baseline (known noise: envReconcile / pingoneTestRoutes PingOne-connectivity failures, occasional parallel-run flakes that pass in isolation — classify every failure by name and check it against `git diff --name-only $(git merge-base main HEAD)..HEAD`).

- [ ] **Step 2: Launcher syntax**

Run: `bash -n run.sh && bash -n scripts/llm-warmup.sh && echo ok`
Expected: `ok`.

- [ ] **Step 3: Record results**

Write pass/fail counts, every failure named + classified, and the chip-coverage audit outcome (how many gaps were found and filled in Task 5) to the report. No REGRESSION_LOG entry needed (hardening, not a user-visible bug fix) — unless Task 5's audit revealed a chip that was ALREADY dead on the heuristic path in live demos; if so, add a REGRESSION_LOG.md entry for that following the file's format.
