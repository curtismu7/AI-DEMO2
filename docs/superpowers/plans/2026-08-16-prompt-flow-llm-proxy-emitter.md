# Prompt Flow Inspector — LLM Proxy Emitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `demo_llm_proxy` a fire-and-forget `llm.call` transaction hop — carrying the same routing/usage metadata already sent to PostHog plus newly-captured, redacted prompt/completion content — so the shared BFF transaction ledger can show the LLM layer of a prompt flow trace.

**Architecture:** Two new small CommonJS modules (`promptRedact.js` for text redaction, `promptFlowHop.js` for the POST-based hop transport + a pure `details`-payload builder) are wired into `router.js`'s existing `proxyRes` handler, alongside the existing `captureGeneration()` PostHog call. `router.js` is a side-effecting script (starts an HTTP server, health-check intervals, etc. on require) and cannot safely be `require()`'d from a test file, so all new logic is factored into the two new modules — which have no side effects and are fully unit-testable — and `router.js`'s own edits are reduced to plain glue (read values off `req`/`proxyRes`, call the tested functions). Wiring correctness is verified with source-inspection tests against `router.js`.

**Tech Stack:** Node >= 22 (native `fetch`, `AbortSignal.timeout`), CommonJS, Node's built-in `node:test` + `node:assert/strict` test runner (this service's only test file, `posthogAi.test.js`, already uses this — no jest, no ts-jest).

**Spec:** docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md

## Global Constraints

Copied verbatim from the spec, scoped to `demo_llm_proxy`:

- **Context (spec Goal):** "LLM prompt/completion content never captured locally at all (metadata only, sent to PostHog cloud)" — today. This plan is the first thing to capture that content locally (redacted, ledger-bound), so there is no prior redaction behavior to preserve compatibility with.
- **§2 LLM proxy:** "new hop emitter (Node, ported from `demo_mcp_gateway/src/transactionHop.ts` — same shape), called from `router.js`'s existing `proxyRes` handler alongside `captureGeneration()` (`posthogAi.js:142-182`). Forwards everything already computed there for PostHog: `model`, `tier`, `durationMs`, `time_to_first_token`, `http_status`, `stream` flag, routing reason (`via`), input/output token counts — plus new: `promptRedacted`, `completionRedacted` (see redaction below). Phase: `llm.call`."
- **§1 Correlation ID propagation:** "Agent → LLM proxy: agent's HTTP call to :8090 carries `x-correlation-id`. Proxy keeps its own `_aiTraceId` for PostHog's `$ai_trace_id`, but sets the ledger hop's `correlationId` = inbound header (falls back to `_aiTraceId` if the header is absent — e.g. a direct/manual proxy call with no upstream agent)."
- **§3 Redaction:** "Port the pattern already in `demo_api_server/utils/logRedact.js` (SSN/card/email/token patterns) to the two new emitters (LLM proxy: Node, direct reuse; langchain_agent: Python port of the same rule set) — one rule set to audit, not two independently maintained ones. Content capped at ~4000 chars per field. Redaction failure → store `"[redaction-error, content omitted]"`, never raw content on error."
- **§6 Error handling:** "All hop emissions (new and existing) follow the established fire-and-forget pattern — POST with timeout, swallow errors. Agent/LLM proxy never block or fail a user-facing request if the BFF ledger endpoint is unreachable." / "Redaction failure → placeholder text (see §3), never raw content."
- **§7 Testing:** "LLM proxy: unit tests for the redaction function (SSN/card/email/token patterns) and the new hop payload shape."

**Documented discrepancy (surfacing, not silently resolving):** the actual `demo_api_server/utils/logRedact.js` (read in full before writing this plan) does **not** contain SSN/card/email regexes — it only redacts JWTs (`JWT_RE`) and values whose **object key name** matches a secret-key list (`SECRET_KEY_RE`: `authorization`, `access_token`, `client_secret`, `password`, etc.), because it was built for structured log *objects*. That key-based approach doesn't apply to free-text chat prompts/completions, which have no keys at all. This plan ports what's real and portable from `logRedact.js` — the JWT regex and the `[REDACTED_*]` placeholder convention — and adds the SSN/card/email/bearer-token regexes the spec calls for, since those are exactly the categories of PII that show up in free-text chat content. This is the concrete rule set the `langchain_agent` Python plan should mirror (see Task 1's `Produces`).

**Known cross-plan gaps (out of this plan's scope — `demo_llm_proxy` only):**
- `demo_api_server/routes/transactionHopIngest.js`'s `VALID_PHASES` set does not yet include `'llm.call'` — until the backend plan adds it, this proxy's hops will be silently rejected (400, swallowed by the fire-and-forget `.catch()`) by the ingest endpoint. This is expected and non-blocking per the fire-and-forget contract; it just means the LLM layer won't show up in the ledger until the backend plan lands.
- `docker-compose.yml`'s `llm-proxy` service block does not yet set `BFF_TRANSACTION_HOP_URL` / `BFF_INTERNAL_SECRET` (unlike `demo_mcp_gateway`, `demo_authz_server`, `demo_hitl_service`, `demo_agent_service`, all of which already have these env vars wired in that file). Without them, `emitHop()` no-ops by design (see Task 3). Wiring `docker-compose.yml` is shared infra outside `demo_llm_proxy/` and is not touched by this plan.

---

### Task 1: Redaction module — `promptRedact.js`

**Files:**
- Create: `demo_llm_proxy/promptRedact.js`
- Test: `demo_llm_proxy/promptRedact.test.js`
- Modify: `demo_llm_proxy/package.json` (broaden the `test` script to run every `*.test.js` file, not just `posthogAi.test.js`)

**Interfaces:**
- Consumes: nothing.
- Produces (this is the canonical redaction contract — the `langchain_agent` Python plan should port these same five patterns and the same cap/placeholder behavior under an equivalent `redact_text(raw_text)`):
  - `redactText(rawText: unknown) => string` — never throws. Non-string/`null`/`undefined` input coerces via `String()`; if that coercion itself throws, returns the literal string `"[redaction-error, content omitted]"`. Otherwise applies, in this order: JWT (`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b` → `[REDACTED_JWT]`), Bearer token (`\bBearer\s+[A-Za-z0-9._-]+\b` case-insensitive → `Bearer [REDACTED_TOKEN]`), SSN (`\b\d{3}-\d{2}-\d{4}\b` → `[REDACTED_SSN]`), card number (`\b(?:\d[ -]?){13,19}\b` → `[REDACTED_CARD]`), email (`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` → `[REDACTED_EMAIL]`), then truncates to `MAX_REDACTED_CHARS` (4000) with a `…[truncated]` suffix if longer.
  - `MAX_REDACTED_CHARS = 4000`.

- [ ] **Step 1: Write the failing test**

Create `demo_llm_proxy/promptRedact.test.js`:

```js
// demo_llm_proxy/promptRedact.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { redactText, MAX_REDACTED_CHARS } = require('./promptRedact');

describe('redactText', () => {
  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'; // gitleaks:allow — synthetic fixture, not a real credential
    const result = redactText(`here is my token: ${jwt} — use it`);
    assert.ok(result.includes('[REDACTED_JWT]'));
    assert.ok(!result.includes(jwt));
  });

  it('redacts a bearer token', () => {
    const result = redactText('Authorization: Bearer abc123.def456-ghi');
    assert.equal(result, 'Authorization: Bearer [REDACTED_TOKEN]');
  });

  it('redacts an SSN', () => {
    const result = redactText('my SSN is 123-45-6789, please confirm');
    assert.ok(result.includes('[REDACTED_SSN]'));
    assert.ok(!result.includes('123-45-6789'));
  });

  it('redacts a card number', () => {
    const result = redactText('card on file: 4111 1111 1111 1111 exp 12/29');
    assert.ok(result.includes('[REDACTED_CARD]'));
    assert.ok(!result.includes('4111 1111 1111 1111'));
  });

  it('redacts an email address', () => {
    const result = redactText('contact me at jane.doe@example.com about this');
    assert.equal(result, 'contact me at [REDACTED_EMAIL] about this');
  });

  it('leaves ordinary text untouched', () => {
    assert.equal(redactText('What is the transfer limit for Super Sports?'), 'What is the transfer limit for Super Sports?');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(redactText(null), '');
    assert.equal(redactText(undefined), '');
  });

  it('caps redacted content at MAX_REDACTED_CHARS with a truncation suffix', () => {
    const huge = 'a'.repeat(MAX_REDACTED_CHARS + 500);
    const result = redactText(huge);
    const suffix = '…[truncated]';
    assert.ok(result.endsWith(suffix));
    assert.equal(result.length, MAX_REDACTED_CHARS + suffix.length);
  });

  it('returns the redaction-error placeholder instead of raw content when coercion fails', () => {
    const poison = { toString() { throw new Error('boom'); } };
    assert.equal(redactText(poison), '[redaction-error, content omitted]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_llm_proxy && node --test promptRedact.test.js`
Expected: FAIL — `Error: Cannot find module './promptRedact'`

- [ ] **Step 3: Write minimal implementation**

Create `demo_llm_proxy/promptRedact.js`:

```js
// demo_llm_proxy/promptRedact.js
'use strict';
/**
 * Redact PII/secrets from LLM prompt/completion text before it is written to
 * the shared transaction ledger (see promptFlowHop.js's `llm.call` hop).
 *
 * Ported from demo_api_server/utils/logRedact.js's JWT regex and
 * `[REDACTED_*]`-placeholder convention. logRedact.js otherwise redacts by
 * OBJECT KEY NAME (its SECRET_KEY_RE), which only applies to structured log
 * objects — free-text chat prompts/completions have no keys, so SSN/card/
 * email/bearer-token regexes are added here, matching the categories the
 * prompt-flow-inspector design spec (§3) calls for. This is the canonical
 * rule set the langchain_agent Python port should mirror.
 */

const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const MAX_REDACTED_CHARS = 4000;
const TRUNCATION_SUFFIX = '…[truncated]';

/**
 * @param {unknown} rawText
 * @returns {string} redacted text, capped at MAX_REDACTED_CHARS. Never
 *   throws — on any failure returns "[redaction-error, content omitted]",
 *   never raw content.
 */
function redactText(rawText) {
  try {
    const text = typeof rawText === 'string' ? rawText : (rawText == null ? '' : String(rawText));
    if (!text) return '';
    let out = text
      .replace(JWT_RE, '[REDACTED_JWT]')
      .replace(BEARER_TOKEN_RE, 'Bearer [REDACTED_TOKEN]')
      .replace(SSN_RE, '[REDACTED_SSN]')
      .replace(CARD_RE, '[REDACTED_CARD]')
      .replace(EMAIL_RE, '[REDACTED_EMAIL]');
    if (out.length > MAX_REDACTED_CHARS) {
      out = `${out.slice(0, MAX_REDACTED_CHARS)}${TRUNCATION_SUFFIX}`;
    }
    return out;
  } catch {
    return '[redaction-error, content omitted]';
  }
}

module.exports = { redactText, MAX_REDACTED_CHARS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_llm_proxy && node --test promptRedact.test.js`
Expected: PASS — all 9 tests green (`# pass 9`, `# fail 0`)

- [ ] **Step 5: Widen the test script and commit**

Edit `demo_llm_proxy/package.json` — change:

```json
    "test": "node --test posthogAi.test.js"
```

to:

```json
    "test": "node --test *.test.js"
```

Run: `cd demo_llm_proxy && npm test`
Expected: PASS — both `posthogAi.test.js` (existing) and `promptRedact.test.js` (new) run and pass.

```bash
git add demo_llm_proxy/promptRedact.js demo_llm_proxy/promptRedact.test.js demo_llm_proxy/package.json
git commit -m "Add prompt/completion redaction module for LLM proxy hop"
```

---

### Task 2: Completion text extraction — `posthogAi.js`

**Files:**
- Modify: `demo_llm_proxy/posthogAi.js:79-121` (add `extractCompletionText` after `parseUsageFromBody`), `:184-190` (add to `module.exports`)
- Test: `demo_llm_proxy/posthogAi.test.js` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractCompletionText(body: Buffer|string) => string` — extracts the assistant-visible completion text from an OpenAI-compatible JSON response body (`choices[0].message.content`, falling back to `choices[0].text`) or an SSE stream body (concatenates `choices[0].delta.content` across all `data:` chunks). Returns `''` on empty/unparseable input. This is metadata-adjacent but distinct from `captureGeneration()` (posthogAi.js:142-182), which sends PostHog *usage metadata only* — this function is used solely by the new `llm.call` ledger hop (Task 4), never by the PostHog call path.

- [ ] **Step 1: Write the failing test**

Read the current end of `demo_llm_proxy/posthogAi.test.js` (already read in full above) and append this block right before the final closing of the file (after the existing `describe('modelFromRequest', ...)` block, i.e. at the very end):

```js

describe('extractCompletionText', () => {
  it('extracts message content from a non-stream JSON response', () => {
    const body = JSON.stringify({
      model: 'phi-4-mini-instruct',
      choices: [{ message: { role: 'assistant', content: 'The transfer limit is $5,000.' } }],
    });
    assert.equal(extractCompletionText(body), 'The transfer limit is $5,000.');
  });

  it('falls back to choices[0].text for completion-style JSON', () => {
    const body = JSON.stringify({ choices: [{ text: 'legacy completion text' }] });
    assert.equal(extractCompletionText(body), 'legacy completion text');
  });

  it('concatenates delta.content across SSE chunks', () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"The "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"limit is "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"$5,000."}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    assert.equal(extractCompletionText(body), 'The limit is $5,000.');
  });

  it('returns empty string for empty or unparseable input', () => {
    assert.equal(extractCompletionText(''), '');
    assert.equal(extractCompletionText('not json and not sse'), '');
  });
});
```

Also update the top `require` line of `demo_llm_proxy/posthogAi.test.js` from:

```js
const { parseUsageFromBody, modelFromRequest } = require('./posthogAi');
```

to:

```js
const { parseUsageFromBody, modelFromRequest, extractCompletionText } = require('./posthogAi');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_llm_proxy && node --test posthogAi.test.js`
Expected: FAIL — `TypeError: extractCompletionText is not a function`

- [ ] **Step 3: Write minimal implementation**

In `demo_llm_proxy/posthogAi.js`, insert this function immediately after `parseUsageFromBody` (after line 121, before the `modelFromRequest` doc comment at line 123):

```js

/**
 * Extract the assistant-visible completion text from an OpenAI-compatible
 * JSON or SSE response body — used by the `llm.call` transaction-ledger hop
 * (promptFlowHop.js), NOT by captureGeneration()'s PostHog call, which sends
 * usage metadata only.
 * @param {Buffer|string} body
 * @returns {string}
 */
function extractCompletionText(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!text) return '';

  if (text.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(text);
      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      if (choice && choice.message && typeof choice.message.content === 'string') {
        return choice.message.content;
      }
      if (choice && typeof choice.text === 'string') return choice.text;
      return '';
    } catch {
      /* fall through to SSE */
    }
  }

  let out = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const delta = Array.isArray(json.choices) ? json.choices[0]?.delta : null;
      if (delta && typeof delta.content === 'string') out += delta.content;
    } catch {
      /* ignore bad chunk */
    }
  }
  return out;
}
```

Then update `module.exports` (lines 184-190) from:

```js
module.exports = {
  getClient,
  parseUsageFromBody,
  modelFromRequest,
  captureGeneration,
  softLoadPosthogEnv,
};
```

to:

```js
module.exports = {
  getClient,
  parseUsageFromBody,
  modelFromRequest,
  extractCompletionText,
  captureGeneration,
  softLoadPosthogEnv,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_llm_proxy && node --test posthogAi.test.js`
Expected: PASS — all tests green, including the 4 new `extractCompletionText` tests.

- [ ] **Step 5: Commit**

```bash
git add demo_llm_proxy/posthogAi.js demo_llm_proxy/posthogAi.test.js
git commit -m "Add completion-text extraction for the LLM proxy transaction hop"
```

---

### Task 3: Hop emitter + payload builder — `promptFlowHop.js`

**Files:**
- Create: `demo_llm_proxy/promptFlowHop.js`
- Test: `demo_llm_proxy/promptFlowHop.test.js`

**Interfaces:**
- Consumes: `redactText` from `./promptRedact` (Task 1).
- Produces:
  - `emitHop(hop: { phase: string, correlationId: string, durationMs?: number, status?: 'ok'|'error', details?: object }) => void` — fire-and-forget POST to `process.env.BFF_TRANSACTION_HOP_URL` with header `x-internal-gateway-secret: process.env.BFF_INTERNAL_SECRET`, 2000ms `AbortSignal.timeout`, body `{ ...hop, service: 'llm-proxy' }`. No-ops (returns immediately, no throw) when the URL/secret env vars are unset, when `hop.correlationId` is falsy, or when no fetch implementation is available. Never throws, never awaited by callers.
  - `__setFetchForTests(fn: Function|undefined) => void` — test seam.
  - `extractRequestText(parsedBody: object) => string` — pulls the same user-visible text shape router.js's own (unexported, classification-only) `extractPromptText` does: `messages[].content` joined by `\n` (non-string content JSON-stringified), else `prompt` string, else `''`.
  - `extractRequestTextFromBuffer(bodyBuffer: Buffer) => string` — `JSON.parse` + `extractRequestText`, returns `''` on any parse failure.
  - `buildLlmCallDetails(opts: { model, tier, httpStatus, stream, via, inputTokens, outputTokens, timeToFirstTokenSec, promptText, completionText }) => object` — pure function; returns `{ model, tier, httpStatus, stream: Boolean(stream), via, inputTokens, outputTokens, timeToFirstTokenSec, promptRedacted: redactText(promptText), completionRedacted: redactText(completionText) }`.
  - `SERVICE = 'llm-proxy'`.

- [ ] **Step 1: Write the failing test**

Create `demo_llm_proxy/promptFlowHop.test.js`:

```js
// demo_llm_proxy/promptFlowHop.test.js
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  emitHop,
  __setFetchForTests,
  extractRequestText,
  extractRequestTextFromBuffer,
  buildLlmCallDetails,
  SERVICE,
} = require('./promptFlowHop');

describe('emitHop', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    process.env.BFF_TRANSACTION_HOP_URL = 'http://bff.test/internal/transaction-hop';
    process.env.BFF_INTERNAL_SECRET = 'sekrit';
    __setFetchForTests(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
      return { ok: true };
    });
  });

  afterEach(() => {
    __setFetchForTests(undefined);
    delete process.env.BFF_TRANSACTION_HOP_URL;
    delete process.env.BFF_INTERNAL_SECRET;
  });

  it('posts an llm.call hop stamped with the given correlationId and service name', async () => {
    emitHop({ phase: 'llm.call', correlationId: 'c1', durationMs: 42, status: 'ok', details: { model: 'gpt-oss-20b' } });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://bff.test/internal/transaction-hop');
    assert.deepEqual(calls[0].body, {
      phase: 'llm.call',
      correlationId: 'c1',
      durationMs: 42,
      status: 'ok',
      details: { model: 'gpt-oss-20b' },
      service: SERVICE,
    });
    assert.equal(calls[0].headers['x-internal-gateway-secret'], 'sekrit');
    assert.ok(calls[0].signal);
  });

  it('no-ops when correlationId is missing', async () => {
    emitHop({ phase: 'llm.call' });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });

  it('no-ops when BFF_TRANSACTION_HOP_URL is unset', async () => {
    delete process.env.BFF_TRANSACTION_HOP_URL;
    emitHop({ phase: 'llm.call', correlationId: 'c1' });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });

  it('never throws when the transport rejects', async () => {
    __setFetchForTests(async () => { throw new Error('network down'); });
    assert.doesNotThrow(() => emitHop({ phase: 'llm.call', correlationId: 'c1' }));
    await new Promise((r) => setImmediate(r));
  });
});

describe('extractRequestText', () => {
  it('joins string message content with newlines', () => {
    const parsed = { messages: [{ role: 'user', content: 'What is the transfer limit?' }, { role: 'user', content: 'For Super Sports.' }] };
    assert.equal(extractRequestText(parsed), 'What is the transfer limit?\nFor Super Sports.');
  });

  it('JSON-stringifies non-string message content', () => {
    const parsed = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] };
    assert.equal(extractRequestText(parsed), JSON.stringify([{ type: 'text', text: 'hi' }]));
  });

  it('falls back to a bare prompt string', () => {
    assert.equal(extractRequestText({ prompt: 'complete this' }), 'complete this');
  });

  it('returns empty string when neither shape is present', () => {
    assert.equal(extractRequestText({}), '');
    assert.equal(extractRequestText(null), '');
  });
});

describe('extractRequestTextFromBuffer', () => {
  it('parses a JSON buffer and extracts prompt text', () => {
    const buf = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }));
    assert.equal(extractRequestTextFromBuffer(buf), 'hello');
  });

  it('returns empty string for unparseable buffers', () => {
    assert.equal(extractRequestTextFromBuffer(Buffer.from('not json')), '');
  });
});

describe('buildLlmCallDetails', () => {
  it('shapes the details payload and redacts prompt/completion content', () => {
    const details = buildLlmCallDetails({
      model: 'gpt-oss-20b',
      tier: 'gpt-oss-20b',
      httpStatus: 200,
      stream: true,
      via: 'model=gpt-oss-20b',
      inputTokens: 12,
      outputTokens: 34,
      timeToFirstTokenSec: 0.21,
      promptText: 'my SSN is 123-45-6789',
      completionText: 'got it, thanks',
    });
    assert.equal(details.model, 'gpt-oss-20b');
    assert.equal(details.tier, 'gpt-oss-20b');
    assert.equal(details.httpStatus, 200);
    assert.equal(details.stream, true);
    assert.equal(details.via, 'model=gpt-oss-20b');
    assert.equal(details.inputTokens, 12);
    assert.equal(details.outputTokens, 34);
    assert.equal(details.timeToFirstTokenSec, 0.21);
    assert.ok(details.promptRedacted.includes('[REDACTED_SSN]'));
    assert.ok(!details.promptRedacted.includes('123-45-6789'));
    assert.equal(details.completionRedacted, 'got it, thanks');
  });

  it('defaults missing fields to null/false rather than throwing', () => {
    const details = buildLlmCallDetails({});
    assert.equal(details.model, null);
    assert.equal(details.stream, false);
    assert.equal(details.promptRedacted, '');
    assert.equal(details.completionRedacted, '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_llm_proxy && node --test promptFlowHop.test.js`
Expected: FAIL — `Error: Cannot find module './promptFlowHop'`

- [ ] **Step 3: Write minimal implementation**

Create `demo_llm_proxy/promptFlowHop.js`:

```js
// demo_llm_proxy/promptFlowHop.js
'use strict';
/**
 * Prompt Flow Inspector — `llm.call` transaction hop for the LLM proxy.
 *
 * emitHop() ships one hop to the shared BFF transaction ledger, fire-and-
 * forget; never awaited, never throws. Ported from
 * demo_mcp_gateway/src/transactionHop.ts (same POST target/payload shape:
 * BFF_TRANSACTION_HOP_URL + BFF_INTERNAL_SECRET, x-internal-gateway-secret
 * header, 2s abort timeout). llm-proxy has no AsyncLocalStorage correlation
 * context (unlike the gateway's correlationContext.ts), so the caller
 * (router.js's proxyRes handler) passes correlationId explicitly — the
 * inbound x-correlation-id header, falling back to this proxy's own
 * _aiTraceId.
 *
 * extractRequestText()/extractRequestTextFromBuffer() duplicate router.js's
 * own (unexported) extractPromptText() — used there for keyword-based tier
 * classification. They are NOT imported from router.js because router.js
 * starts the proxy server as a side effect of being required (server.listen,
 * health-check intervals) and is not safe to load from a test file.
 *
 * buildLlmCallDetails() is a pure helper that shapes the hop's `details`
 * payload, including redacted prompt/completion text (promptRedact.js).
 */

const { redactText } = require('./promptRedact');

const SERVICE = 'llm-proxy';

let _fetch;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
function __setFetchForTests(fn) {
  _fetch = fn;
}

/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 * Never awaited and never throws — auditing must never delay or fail an
 * LLM response.
 * @param {{ phase: string, correlationId: string, durationMs?: number, status?: 'ok'|'error', details?: object }} hop
 */
function emitHop(hop) {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    if (!hop || !hop.correlationId) return;

    const doFetch = _fetch || globalThis.fetch;
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}

/**
 * Extract the user-visible prompt text from a parsed OpenAI-style request
 * body. See module comment above for why this duplicates router.js's
 * classification-only extractPromptText() instead of importing it.
 * @param {object} parsedBody
 * @returns {string}
 */
function extractRequestText(parsedBody) {
  if (!parsedBody || typeof parsedBody !== 'object') return '';
  if (Array.isArray(parsedBody.messages)) {
    return parsedBody.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
      .join('\n');
  }
  if (typeof parsedBody.prompt === 'string') return parsedBody.prompt;
  return '';
}

/**
 * @param {Buffer} bodyBuffer
 * @returns {string} '' for non-JSON or unparseable bodies, never throws.
 */
function extractRequestTextFromBuffer(bodyBuffer) {
  try {
    return extractRequestText(JSON.parse(bodyBuffer.toString('utf8')));
  } catch {
    return '';
  }
}

/**
 * Build the `llm.call` hop's `details` payload: routing/usage metadata plus
 * redacted prompt/completion content. Pure function — no I/O.
 * @param {object} opts
 * @param {string|null} [opts.model]
 * @param {string|null} [opts.tier]
 * @param {number|null} [opts.httpStatus]
 * @param {boolean} [opts.stream]
 * @param {string|null} [opts.via]
 * @param {number|null} [opts.inputTokens]
 * @param {number|null} [opts.outputTokens]
 * @param {number|null} [opts.timeToFirstTokenSec]
 * @param {string} [opts.promptText] - raw (unredacted) prompt text
 * @param {string} [opts.completionText] - raw (unredacted) completion text
 * @returns {object}
 */
function buildLlmCallDetails(opts) {
  const {
    model = null,
    tier = null,
    httpStatus = null,
    stream = false,
    via = null,
    inputTokens = null,
    outputTokens = null,
    timeToFirstTokenSec = null,
    promptText = '',
    completionText = '',
  } = opts || {};

  return {
    model,
    tier,
    httpStatus,
    stream: Boolean(stream),
    via,
    inputTokens,
    outputTokens,
    timeToFirstTokenSec,
    promptRedacted: redactText(promptText),
    completionRedacted: redactText(completionText),
  };
}

module.exports = {
  emitHop,
  __setFetchForTests,
  extractRequestText,
  extractRequestTextFromBuffer,
  buildLlmCallDetails,
  SERVICE,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_llm_proxy && node --test promptFlowHop.test.js`
Expected: PASS — all tests green (4 `emitHop` + 4 `extractRequestText` + 2 `extractRequestTextFromBuffer` + 2 `buildLlmCallDetails` = 12 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_llm_proxy/promptFlowHop.js demo_llm_proxy/promptFlowHop.test.js
git commit -m "Add llm.call transaction hop emitter and payload builder"
```

---

### Task 4: Wire the hop into `router.js`

**Files:**
- Modify: `demo_llm_proxy/router.js:6-9` (imports), `:347-381` (proxyRes handler / `onEnd`), `:508-512` (main request handler)
- Test: `demo_llm_proxy/router.wiring.test.js`

**Interfaces:**
- Consumes: `parseUsageFromBody`, `extractCompletionText` from `./posthogAi` (Task 2); `emitHop`, `extractRequestTextFromBuffer`, `buildLlmCallDetails` from `./promptFlowHop` (Task 3).
- Produces: no new exported functions — this task is glue only. `router.js` stays a non-`require`-safe script (starts an HTTP server and health-check intervals on load), so its wiring is verified by source-inspection tests rather than by requiring the module (see Step 1 rationale).

- [ ] **Step 1: Write the failing test**

`router.js` cannot be safely `require()`'d in a test (it calls `server.listen()` and starts `setInterval` health checks as side effects of module load — this is pre-existing behavior, not something this plan changes). All of the new *logic* already lives in fully-tested, side-effect-free modules (Tasks 1-3); this task adds no new branching logic to `router.js` itself, only call-sites. So this test verifies the wiring is actually present by inspecting `router.js`'s source text — a real red (missing) → green (present) check for each load-bearing wiring point named in the spec.

Create `demo_llm_proxy/router.wiring.test.js`:

```js
// demo_llm_proxy/router.wiring.test.js
'use strict';
/**
 * router.js starts an HTTP server and background intervals as a side effect
 * of being require()'d, so it cannot be safely loaded in a test process (see
 * promptFlowHop.js's module comment). These tests instead verify the new
 * Prompt Flow Inspector wiring is present in router.js's source — the
 * behavior of each piece being wired together is already covered by
 * promptRedact.test.js, posthogAi.test.js, and promptFlowHop.test.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routerSrc = fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8');

describe('router.js prompt-flow hop wiring', () => {
  it('requires the prompt-flow hop and redaction modules', () => {
    assert.match(routerSrc, /require\(['"]\.\/promptFlowHop['"]\)/);
    assert.match(routerSrc, /extractRequestTextFromBuffer/);
    assert.match(routerSrc, /buildLlmCallDetails/);
  });

  it('emits an llm.call hop from the proxyRes handler', () => {
    assert.match(routerSrc, /phase:\s*['"]llm\.call['"]/);
    assert.match(routerSrc, /emitHop\(/);
  });

  it('uses parseUsageFromBody and extractCompletionText for the hop details', () => {
    assert.match(routerSrc, /parseUsageFromBody\(/);
    assert.match(routerSrc, /extractCompletionText\(/);
  });

  it('sets correlation id from the inbound header, falling back to _aiTraceId', () => {
    assert.match(routerSrc, /req\.headers\[['"]x-correlation-id['"]\]\s*\|\|\s*req\._aiTraceId/);
  });

  it('captures request-time via and prompt text on req before proxying', () => {
    assert.match(routerSrc, /req\._aiVia\s*=\s*via/);
    assert.match(routerSrc, /req\._aiPromptText\s*=\s*extractRequestTextFromBuffer\(bodyBuffer\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_llm_proxy && node --test router.wiring.test.js`
Expected: FAIL — all 5 assertions fail (none of these strings exist in `router.js` yet).

- [ ] **Step 3: Write minimal implementation**

Edit `demo_llm_proxy/router.js`. First, the imports at the top (lines 6-9) — change:

```js
const {
  captureGeneration,
  modelFromRequest,
} = require('./posthogAi');
```

to:

```js
const {
  captureGeneration,
  modelFromRequest,
  parseUsageFromBody,
  extractCompletionText,
} = require('./posthogAi');
const {
  emitHop,
  extractRequestTextFromBuffer,
  buildLlmCallDetails,
} = require('./promptFlowHop');
```

Next, the `proxyRes` handler's `onEnd` (lines 360-375) — change:

```js
  const onEnd = () => {
    proxyRes.off('data', onData);
    const latencySec = (Date.now() - req._aiStartedAt) / 1000;
    const ttft = firstByteAt != null ? (firstByteAt - req._aiStartedAt) / 1000 : null;
    captureGeneration({
      distinctId: req.headers['x-posthog-distinct-id'] || 'llm-proxy',
      traceId: req._aiTraceId,
      requestModel: req._aiRequestModel,
      responseBody: Buffer.concat(chunks),
      latencySec,
      timeToFirstTokenSec: ttft,
      httpStatus: proxyRes.statusCode,
      tierName: req.proxyTarget?.name || null,
      streamHint: /text\/event-stream/i.test(String(proxyRes.headers['content-type'] || '')),
    });
  };
```

to:

```js
  const onEnd = () => {
    proxyRes.off('data', onData);
    const latencySec = (Date.now() - req._aiStartedAt) / 1000;
    const ttft = firstByteAt != null ? (firstByteAt - req._aiStartedAt) / 1000 : null;
    const responseBody = Buffer.concat(chunks);
    captureGeneration({
      distinctId: req.headers['x-posthog-distinct-id'] || 'llm-proxy',
      traceId: req._aiTraceId,
      requestModel: req._aiRequestModel,
      responseBody,
      latencySec,
      timeToFirstTokenSec: ttft,
      httpStatus: proxyRes.statusCode,
      tierName: req.proxyTarget?.name || null,
      streamHint: /text\/event-stream/i.test(String(proxyRes.headers['content-type'] || '')),
    });

    // Prompt Flow Inspector: forward the same call metadata to the shared
    // transaction ledger as an `llm.call` hop, plus redacted prompt/completion
    // content — captureGeneration() above sends usage metadata only, never
    // content.
    const usage = parseUsageFromBody(responseBody);
    emitHop({
      phase: 'llm.call',
      correlationId: req._aiCorrelationId,
      durationMs: Date.now() - req._aiStartedAt,
      status: proxyRes.statusCode < 400 ? 'ok' : 'error',
      details: buildLlmCallDetails({
        model: usage.model || req._aiRequestModel || req.proxyTarget?.name || null,
        tier: req.proxyTarget?.name || null,
        httpStatus: proxyRes.statusCode,
        stream: usage.stream,
        via: req._aiVia || null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        timeToFirstTokenSec: ttft,
        promptText: req._aiPromptText || '',
        completionText: extractCompletionText(responseBody),
      }),
    });
  };
```

Finally, the main request handler (lines 508-512) — change:

```js
    req.proxyTarget = selectedTier; // for load tracking
    req.bodyBuffer = bodyBuffer;    // re-streamed in proxyReq (body was drained above)
    req._aiStartedAt = Date.now();
    req._aiTraceId = crypto.randomUUID();
    req._aiRequestModel = modelFromRequest(bodyBuffer);
```

to:

```js
    req.proxyTarget = selectedTier; // for load tracking
    req.bodyBuffer = bodyBuffer;    // re-streamed in proxyReq (body was drained above)
    req._aiStartedAt = Date.now();
    req._aiTraceId = crypto.randomUUID();
    req._aiRequestModel = modelFromRequest(bodyBuffer);
    req._aiVia = via;
    // Prompt Flow Inspector correlation: inbound header wins (agent-
    // originated call), else fall back to this proxy's own trace id
    // (direct/manual call with no upstream agent).
    req._aiCorrelationId = req.headers['x-correlation-id'] || req._aiTraceId;
    req._aiPromptText = extractRequestTextFromBuffer(bodyBuffer);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_llm_proxy && node --test router.wiring.test.js`
Expected: PASS — all 5 tests green.

Then run the full suite to confirm nothing regressed:

Run: `cd demo_llm_proxy && npm test`
Expected: PASS — `posthogAi.test.js`, `promptRedact.test.js`, `promptFlowHop.test.js`, `router.wiring.test.js` all green.

Also sanity-check `router.js` still parses as valid JS (catches typos the string-match tests wouldn't):

Run: `cd demo_llm_proxy && node --check router.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add demo_llm_proxy/router.js demo_llm_proxy/router.wiring.test.js
git commit -m "Wire llm.call transaction hop into the LLM proxy's proxyRes handler"
```

---

## Self-Review

**Spec coverage:**
- §2 LLM proxy hop emitter, same shape as gateway's `transactionHop.ts`, called from `proxyRes` alongside `captureGeneration()`, forwarding model/tier/durationMs/time_to_first_token/http_status/stream/via/input+output tokens plus `promptRedacted`/`completionRedacted`, phase `llm.call` → Task 4 (`buildLlmCallDetails` in Task 3 shapes every one of these fields; Task 4 wires it into the exact `proxyRes` call site).
- §1 correlation ID: inbound `x-correlation-id` header wins, falls back to `_aiTraceId` → Task 4, `req._aiCorrelationId = req.headers['x-correlation-id'] || req._aiTraceId;`, tested by `router.wiring.test.js`.
- §3 Redaction: ported pattern, ~4000 char cap per field, `"[redaction-error, content omitted]"` on failure, never raw content → Task 1 (`promptRedact.js`), fully unit tested including the truncation and error-placeholder paths.
- §6 Error handling: fire-and-forget POST with timeout, swallow errors; redaction failure → placeholder, never raw → `emitHop()` (Task 3) mirrors the exact try/catch + `.catch(() => {})` + `AbortSignal.timeout(2000)` shape of `transactionHop.ts`/`transactionHop.js`; `redactText()` (Task 1) never returns raw content on error, verified by the poison-object test.
- §7 Testing: "unit tests for the redaction function ... and the new hop payload shape" → Task 1's `promptRedact.test.js` (redaction function) and Task 3's `promptFlowHop.test.js` (`buildLlmCallDetails` shape + `emitHop` payload shape).

**Placeholder scan:** no "TBD"/"TODO"/"add appropriate error handling"/"similar to Task N" anywhere above; every step has complete, runnable code; every test asserts concrete values, not just "does not throw" (except the one test whose entire point *is* "does not throw" — `emitHop`'s transport-rejection case, which also matches the established `demo_hitl_service`/`demo_mcp_gateway` test pattern for that exact scenario).

**Type/naming consistency across tasks:**
- `redactText` (Task 1) is imported by name in `promptFlowHop.js` (Task 3) and called inside `buildLlmCallDetails` — same name throughout.
- `extractCompletionText` (Task 2, added to `posthogAi.js`) is imported and called by that exact name in Task 4's `router.js` edit.
- `emitHop`, `extractRequestTextFromBuffer`, `buildLlmCallDetails` (Task 3, `promptFlowHop.js`) are imported and called by those exact names in Task 4's `router.js` edit, and referenced by those exact names in `router.wiring.test.js`'s source-match assertions.
- `MAX_REDACTED_CHARS` (Task 1) is the same constant referenced in Task 1's own truncation test — no second definition anywhere.
- Field names in the hop's `details` object (`model`, `tier`, `httpStatus`, `stream`, `via`, `inputTokens`, `outputTokens`, `timeToFirstTokenSec`, `promptRedacted`, `completionRedacted`) are defined once in `buildLlmCallDetails` (Task 3) and referenced identically in Task 4's call site and in `promptFlowHop.test.js`'s assertions — no task introduces a differently-spelled field.

**Cross-plan surface documented, not silently assumed:** the `logRedact.js` pattern discrepancy (JWT/key-based, not SSN/card/email) and the two out-of-scope infra gaps (`VALID_PHASES` missing `llm.call`; `docker-compose.yml` missing the two env vars for the `llm-proxy` service) are called out explicitly in Global Constraints rather than silently worked around or silently left for someone else to discover.
