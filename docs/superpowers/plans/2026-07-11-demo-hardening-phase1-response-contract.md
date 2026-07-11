# Demo Hardening Phase 1 — Response Contract Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No LLM or tool output reaches a renderer unvalidated — malformed JSON is repaired locally, invalid intent shapes are rejected into the existing retry/fallback ladder, unparseable tool results surface as errors instead of false successes, and llama.cpp intent calls use grammar-constrained decoding.

**Architecture:** One new CommonJS module `demo_api_server/services/llmResponseContract.js` holds four pure functions (`repairAndParseJson`, `validateIntent`, `parseToolResult`, `snippet`) plus `logMendEvent` telemetry. Existing call sites are rewired to it with minimal diffs. The existing resilience ladder (JSON_RETRY_NUDGE re-ask per provider, heuristic chip floor, conversational fallback, blank-answer floors at `demoAgentLangGraphService.js:1361` and `agentRunHandler.ts:391`) is kept as-is — this plan feeds it better input; it does NOT add another retry loop.

**Tech Stack:** Node.js CommonJS, Jest (`npx jest --forceExit` from `demo_api_server/`). No new npm dependencies — JSON repair is hand-rolled and conservative.

**Spec:** `docs/superpowers/specs/2026-07-11-demo-hardening-design.md` (Phase 1). Two spec items are intentionally satisfied by existing code and need no new code: the "one re-ask" (JSON_RETRY_NUDGE already exists in all six provider branches) and the demo_agent_service blank-answer mirror (floors already exist at `agentRunHandler.ts:391` and `demoAgentLangGraphService.js:1361`); Task 6's full-suite run is their regression gate.

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️` `✅` `❌` `🔐` `✕` `✓` in code/UI text.
- Minimal diff: name the element, change only that. No adjacent cleanup.
- Work in the worktree; stage explicitly with `git add <files>`, never `git add -A`; verify `git branch --show-current` before each commit.
- No OAuth/permission scope changes.
- All jest commands run from `demo_api_server/` (`cd demo_api_server` first).
- `tryParseIntentJson` must keep rejecting `kind:"none"` and keep its exported `__test` surface.
- Do not modify `classifyMcpToolResult` (`services/mcpToolOutcome.js`) — the contract feeds it error-shaped objects instead.

---

### Task 1: Contract core — `repairAndParseJson`, `snippet`, `logMendEvent`

**Files:**
- Create: `demo_api_server/services/llmResponseContract.js`
- Test: `demo_api_server/src/__tests__/llmResponseContract.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `repairAndParseJson(text: string) => any|null` (parsed JSON value or null; strips fences/`<think>`, extracts first `{...}`, repairs trailing commas, smart quotes, truncated closers). `snippet(raw, max=200) => string` (control-chars collapsed, trimmed, capped). `logMendEvent(event: string, detail?: object) => void` (one `console.warn('[llmContract]', JSON.stringify({event, ...detail}))` line; never throws).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/llmResponseContract.test.js
'use strict';

const { repairAndParseJson, snippet, logMendEvent } = require('../../services/llmResponseContract');

describe('repairAndParseJson', () => {
  it('parses clean JSON', () => {
    expect(repairAndParseJson('{"kind":"banking"}')).toEqual({ kind: 'banking' });
  });

  it('strips markdown fences', () => {
    expect(repairAndParseJson('```json\n{"kind":"banking"}\n```')).toEqual({ kind: 'banking' });
  });

  it('strips <think> chain-of-thought wrappers', () => {
    expect(repairAndParseJson('<think>hmm reasoning</think>{"kind":"banking"}')).toEqual({ kind: 'banking' });
  });

  it('extracts the first {...} object from surrounding prose', () => {
    expect(repairAndParseJson('Sure!\n{"kind":"banking","banking":{"action":"accounts"}}\nHope that helps'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
  });

  it('repairs trailing commas', () => {
    expect(repairAndParseJson('{"kind":"banking","banking":{"action":"accounts",},}'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
  });

  it('repairs smart double quotes', () => {
    expect(repairAndParseJson('{“kind”:“banking”}')).toEqual({ kind: 'banking' });
  });

  it('completes truncated output missing closers', () => {
    expect(repairAndParseJson('{"kind":"banking","banking":{"action":"accounts"'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
  });

  it('does not append closers inside string values', () => {
    expect(repairAndParseJson('{"kind":"none","message":"use { braces } wisely"}'))
      .toEqual({ kind: 'none', message: 'use { braces } wisely' });
  });

  it('returns null for empty and hopeless input', () => {
    expect(repairAndParseJson('')).toBeNull();
    expect(repairAndParseJson(null)).toBeNull();
    expect(repairAndParseJson('no json here at all')).toBeNull();
  });
});

describe('snippet', () => {
  it('collapses control chars, trims, and caps length', () => {
    expect(snippet('  a\u0000b\nc  ')).toBe('a b c');
    expect(snippet('x'.repeat(500)).length).toBe(200);
    expect(snippet(null)).toBe('');
  });
});

describe('logMendEvent', () => {
  it('emits one [llmContract] warn line and never throws', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logMendEvent('test_event', { site: 'here' });
    expect(spy).toHaveBeenCalledWith('[llmContract]', JSON.stringify({ event: 'test_event', site: 'here' }));
    const circular = {}; circular.self = circular;
    expect(() => logMendEvent('bad', circular)).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmResponseContract`
Expected: FAIL with "Cannot find module '../../services/llmResponseContract'"

- [ ] **Step 3: Write the implementation**

```js
// demo_api_server/services/llmResponseContract.js
/**
 * LLM response contract — shared repair/validation for every place the BFF
 * consumes LLM or tool output. Demo-hardening Phase 1
 * (docs/superpowers/specs/2026-07-11-demo-hardening-design.md).
 *
 * Invariant: callers never render raw unparseable text; they get a parsed
 * value, a validation verdict, or an error-shaped object the existing
 * classifier (mcpToolOutcome.js) already understands.
 */
'use strict';

/** Collapse control chars and cap length so raw output is loggable/renderable. */
function snippet(raw, max = 200) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** One structured warn line per mend action — greppable as [llmContract]. */
function logMendEvent(event, detail = {}) {
  try {
    console.warn('[llmContract]', JSON.stringify({ event, ...detail }));
  } catch (_) {
    console.warn('[llmContract]', JSON.stringify({ event }));
  }
}

/**
 * Append missing closing braces/brackets to truncated model output.
 * Tracks string state so braces inside string values are not counted.
 */
function completeTruncated(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!stack.length) return text;
  return text + stack.reverse().join('');
}

/** Conservative textual repairs for the failure shapes small local models emit. */
function repairJsonText(text) {
  let t = text
    .replace(/[“”]/g, '"')      // smart double quotes
    .replace(/,\s*([}\]])/g, '$1');       // trailing commas
  t = completeTruncated(t);
  return t;
}

/**
 * Parse JSON out of LLM text: direct parse, fence/think-strip, first-{...}
 * extraction, then repaired variants of each candidate. Returns the parsed
 * value or null. Generic — callers apply their own shape checks.
 */
function repairAndParseJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/m, '')
    .trim();
  if (!cleaned) return null;
  const candidates = [cleaned];
  const brace = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (brace >= 0 && end > brace) candidates.push(cleaned.slice(brace, end + 1));
  if (brace >= 0 && end < brace) candidates.push(cleaned.slice(brace)); // truncated: `{` but no `}`
  for (const candidate of [...candidates, ...candidates.map(repairJsonText)]) {
    try {
      return JSON.parse(candidate);
    } catch (_) { /* try next */ }
  }
  return null;
}

module.exports = { repairAndParseJson, snippet, logMendEvent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmResponseContract`
Expected: PASS (all 11 cases in the new file)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/llmResponseContract.js demo_api_server/src/__tests__/llmResponseContract.test.js
git commit -m "feat(llm-contract): repairAndParseJson core with mend telemetry"
```

---

### Task 2: `validateIntent` — schema check for router output

**Files:**
- Modify: `demo_api_server/services/llmResponseContract.js` (add function + export)
- Test: `demo_api_server/src/__tests__/llmResponseContract.intent.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `validateIntent(obj: any) => boolean`. True only for the three renderable kinds with their required fields: `education` (needs object `.education` or `.ciba === true`), `banking` (needs `.banking.action` non-empty string), `vertical` (needs top-level `.vertical` and `.action` non-empty strings). `kind:"none"` and unknown kinds return false.

- [ ] **Step 1: Write the failing test**

The data-driven block extracts every example `{"kind":...}` line from `docs/HELIX_AGENT_DIRECTIVES.json` (base + all 10 themes) and asserts each parseable non-none example validates — locking the validator against every shape the prompts teach the LLM to emit.

```js
// demo_api_server/src/__tests__/llmResponseContract.intent.test.js
'use strict';

const path = require('node:path');
const { validateIntent } = require('../../services/llmResponseContract');

describe('validateIntent', () => {
  it('accepts the three renderable kinds with required fields', () => {
    expect(validateIntent({ kind: 'banking', banking: { action: 'accounts', params: {} } })).toBe(true);
    expect(validateIntent({ kind: 'education', education: { panel: 'token-exchange', tab: 'what' } })).toBe(true);
    expect(validateIntent({ kind: 'education', ciba: true, tab: 'what' })).toBe(true);
    expect(validateIntent({ kind: 'vertical', vertical: 'healthcare', action: 'view_records', params: {} })).toBe(true);
  });

  it('rejects structurally broken variants of valid kinds', () => {
    expect(validateIntent({ kind: 'banking' })).toBe(false);                       // no banking object
    expect(validateIntent({ kind: 'banking', banking: { action: '' } })).toBe(false);
    expect(validateIntent({ kind: 'banking', banking: { params: {} } })).toBe(false); // no action
    expect(validateIntent({ kind: 'vertical', action: 'view_records' })).toBe(false); // no vertical
    expect(validateIntent({ kind: 'vertical', vertical: 'retail' })).toBe(false);     // no action
    expect(validateIntent({ kind: 'education' })).toBe(false);                        // no education/ciba
  });

  it('rejects none, unknown kinds, and non-objects', () => {
    expect(validateIntent({ kind: 'none', message: 'hint' })).toBe(false);
    expect(validateIntent({ kind: 'hallucinated_kind', data: {} })).toBe(false);
    expect(validateIntent(null)).toBe(false);
    expect(validateIntent(['kind'])).toBe(false);
    expect(validateIntent('{"kind":"banking"}')).toBe(false);
  });

  it('accepts every non-none example shape taught in HELIX_AGENT_DIRECTIVES.json', () => {
    const directives = require(path.join(__dirname, '../../../docs/HELIX_AGENT_DIRECTIVES.json'));
    const corpus = [directives.base, ...Object.values(directives.themes)].join('\n');
    const examples = corpus.match(/\{"kind":[^\n]*\}/g) || [];
    expect(examples.length).toBeGreaterThan(10); // the directives teach many shapes
    let checked = 0;
    for (const line of examples) {
      let obj;
      try { obj = JSON.parse(line); } catch (_) { continue; } // skip non-JSON template lines
      if (obj.kind === 'none') continue;
      expect({ line, valid: validateIntent(obj) }).toEqual({ line, valid: true });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmResponseContract.intent`
Expected: FAIL with "validateIntent is not a function"

- [ ] **Step 3: Write the implementation**

Add to `llmResponseContract.js` above `module.exports`, and add `validateIntent` to the exports:

```js
/**
 * Shape check for parsed intent-router output. The three renderable kinds are
 * validated for the fields their dispatchers require; kind:"none" and unknown
 * kinds are invalid (callers fall through to the existing retry/floor ladder).
 */
function validateIntent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj.kind === 'education') {
    return (!!obj.education && typeof obj.education === 'object') || obj.ciba === true;
  }
  if (obj.kind === 'banking') {
    return !!obj.banking && typeof obj.banking === 'object'
      && typeof obj.banking.action === 'string' && obj.banking.action.trim() !== '';
  }
  if (obj.kind === 'vertical') {
    return typeof obj.vertical === 'string' && obj.vertical.trim() !== ''
      && typeof obj.action === 'string' && obj.action.trim() !== '';
  }
  return false;
}
```

```js
module.exports = { repairAndParseJson, validateIntent, snippet, logMendEvent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llmResponseContract`
Expected: PASS (both contract test files)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/llmResponseContract.js demo_api_server/src/__tests__/llmResponseContract.intent.test.js
git commit -m "feat(llm-contract): validateIntent locked to HELIX directive shapes"
```

---

### Task 3: Wire `tryParseIntentJson` to the contract

**Files:**
- Modify: `demo_api_server/services/geminiNlIntent.js:112-131` (the `tryParseIntentJson` function only)
- Test: `demo_api_server/src/__tests__/tryParseIntentJson.test.js` (extend, keep existing cases)

**Interfaces:**
- Consumes: `repairAndParseJson`, `validateIntent`, `snippet`, `logMendEvent` from Task 1/2.
- Produces: same signature `tryParseIntentJson(text) => object|null`, still exported via `__test`. New behavior: repairs malformed JSON (so the existing per-provider `JSON_RETRY_NUDGE` re-ask fires less often) and rejects invalid shapes with an `intent_shape_rejected` mend event (so garbage never reaches dispatch — it falls to the existing nudge → chip floor → conversational ladder).

- [ ] **Step 1: Extend the test with failing cases**

Append inside the existing `describe('tryParseIntentJson', ...)` block in `demo_api_server/src/__tests__/tryParseIntentJson.test.js`:

```js
  it('repairs trailing commas and truncated JSON from small models', () => {
    expect(tryParseIntentJson('{"kind":"banking","banking":{"action":"accounts",}}'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
    expect(tryParseIntentJson('{"kind":"vertical","vertical":"retail","action":"checkout","params":{}'))
      .toEqual({ kind: 'vertical', vertical: 'retail', action: 'checkout', params: {} });
  });

  it('rejects structurally invalid shapes instead of passing them to dispatch', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tryParseIntentJson('{"kind":"banking"}')).toBeNull();
    expect(tryParseIntentJson('{"kind":"made_up_kind","data":{}}')).toBeNull();
    expect(spy).toHaveBeenCalledWith('[llmContract]', expect.stringContaining('intent_shape_rejected'));
    spy.mockRestore();
  });
```

- [ ] **Step 2: Run test to verify the new cases fail**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=tryParseIntentJson`
Expected: FAIL — the truncated/trailing-comma cases return null today, and `{"kind":"banking"}` (no action) wrongly returns an object.

- [ ] **Step 3: Replace the function body**

In `demo_api_server/services/geminiNlIntent.js`, add the require near the top (after line 14, with the other service requires):

```js
const { repairAndParseJson, validateIntent, snippet: contractSnippet, logMendEvent } = require('./llmResponseContract');
```

Replace the whole `tryParseIntentJson` function (current lines 112-131) with:

```js
/** Parse a non-none intent JSON object from an LLM reply (repairs + validates via llmResponseContract). */
function tryParseIntentJson(text) {
  if (!text) return null;
  const parsed = repairAndParseJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!parsed.kind || parsed.kind === 'none') return null;
  if (!validateIntent(parsed)) {
    logMendEvent('intent_shape_rejected', { kind: String(parsed.kind), snippet: contractSnippet(text) });
    return null;
  }
  return parsed;
}
```

- [ ] **Step 4: Run the intent suites**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern='tryParseIntentJson|geminiNlIntent|nlIntentParser'`
Expected: PASS — all pre-existing cases (clean parse, prose extraction, kind:none rejection) plus the new ones. If any `geminiNlIntent.*` test fails, the validator is rejecting a shape that suite considers valid: fix `validateIntent` to accept that shape (the suites are the authority), not the test.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/geminiNlIntent.js demo_api_server/src/__tests__/tryParseIntentJson.test.js
git commit -m "feat(nl-intent): tryParseIntentJson repairs malformed JSON and validates shape"
```

---

### Task 4: `parseToolResult` — unparseable tool output surfaces as error, never false success

**Files:**
- Modify: `demo_api_server/services/llmResponseContract.js` (add function + export)
- Modify: `demo_api_server/services/verticalMcpExecution.js:16-22` (`parseMcpToolPayload` parse block)
- Modify: `demo_api_server/services/demoAgentLangGraphService.js` lines 163-165, 173, 273-275, 320-322, 367-369, 407-408, 542
- Test: `demo_api_server/src/__tests__/llmResponseContract.toolResult.test.js`
- Test: `demo_api_server/src/__tests__/toolResultFalseSuccess.regression.test.js`

**Interfaces:**
- Consumes: `repairAndParseJson`, `snippet`, `logMendEvent`.
- Produces: `parseToolResult(raw: any, opts?: {site?: string}) => { result: any, parseFailed: boolean }`. `result` is the parsed value on success; on unparseable/empty input it is `{ error: 'tool_result_unparseable'|'tool_result_empty', error_description: string }` — a shape `classifyMcpToolResult` already routes to `kind:'error'`. Never returns a raw unparsed string.

**Why:** today `JSON.parse`-failure at the transfer/deposit/withdraw sites yields `null` → `classifyMcpToolResult(null)` → `{kind:'ok'}` → the agent replies "Transferred $X" **as a success without a readable result**. In `parseMcpToolPayload`, the same failure yields `result: {}` with `render:'text'` — the documented `{}`/garble render.

- [ ] **Step 1: Write the failing unit test**

```js
// demo_api_server/src/__tests__/llmResponseContract.toolResult.test.js
'use strict';

const { parseToolResult } = require('../../services/llmResponseContract');

describe('parseToolResult', () => {
  it('passes objects through untouched', () => {
    const obj = { accounts: [{ id: 'a1' }] };
    expect(parseToolResult(obj)).toEqual({ result: obj, parseFailed: false });
  });

  it('parses JSON strings', () => {
    expect(parseToolResult('{"balance":42}')).toEqual({ result: { balance: 42 }, parseFailed: false });
  });

  it('repairs mildly malformed JSON strings', () => {
    expect(parseToolResult('{"balance":42,}')).toEqual({ result: { balance: 42 }, parseFailed: false });
  });

  it('returns an error-shaped result for unparseable strings (never the raw string)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, parseFailed } = parseToolResult('Internal Server Error <html>...', { site: 'test' });
    expect(parseFailed).toBe(true);
    expect(result.error).toBe('tool_result_unparseable');
    expect(result.error_description).toContain('Internal Server Error');
    expect(spy).toHaveBeenCalledWith('[llmContract]', expect.stringContaining('tool_result_unparseable'));
    spy.mockRestore();
  });

  it('returns an error-shaped result for empty input', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const raw of [null, undefined, '', '   ']) {
      const { result, parseFailed } = parseToolResult(raw, { site: 'test' });
      expect(parseFailed).toBe(true);
      expect(result.error).toBe('tool_result_empty');
    }
    spy.mockRestore();
  });

  it('feeds classifyMcpToolResult an error it recognises', () => {
    const { classifyMcpToolResult } = require('../../services/mcpToolOutcome');
    const { result } = parseToolResult('not json', { site: 'test' });
    const c = classifyMcpToolResult(result);
    expect(c.kind).toBe('error');
    expect(c.message).toContain('not json');
  });
});
```

- [ ] **Step 2: Write the failing regression test (false-success bug)**

```js
// demo_api_server/src/__tests__/toolResultFalseSuccess.regression.test.js
'use strict';

/**
 * Regression: an unparseable executeBffTool result at the write sites
 * (transfer/deposit/withdraw) used to classify as kind:'ok' —
 * classifyMcpToolResult(null) returns {kind:'ok'} — so the agent reported
 * "Transferred $X" success with no readable result. parseToolResult must
 * convert it to an error the classifier surfaces.
 */
const { classifyMcpToolResult } = require('../../services/mcpToolOutcome');
const { parseToolResult } = require('../../services/llmResponseContract');

describe('unparseable write-tool result is an error, not success', () => {
  it('documents the pre-fix hazard: classify(null) is ok', () => {
    expect(classifyMcpToolResult(null).kind).toBe('ok'); // why the old parse-to-null pattern lied
  });

  it('parseToolResult + classifier yields kind:error for garbage', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = parseToolResult('<html>502 Bad Gateway</html>', { site: 'create_transfer' });
    expect(classifyMcpToolResult(result).kind).toBe('error');
    spy.mockRestore();
  });
});

describe('parseMcpToolPayload never renders the {} garble', () => {
  it('unparseable raw becomes an error render, not result:{} render:text', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { parseMcpToolPayload } = require('../../services/verticalMcpExecution');
    const out = parseMcpToolPayload('Bad upstream response, not JSON');
    expect(out.kind).toBe('out');
    expect(out.out.render).toBe('text');
    expect(out.out.result.error).toBeTruthy();          // error message, not {}
    expect(out.out.result).not.toEqual({});
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern='llmResponseContract.toolResult|toolResultFalseSuccess'`
Expected: FAIL — `parseToolResult` is not a function; the parseMcpToolPayload case gets `result:{}`.

- [ ] **Step 4: Implement `parseToolResult`**

Add to `llmResponseContract.js` and export it:

```js
/**
 * Normalize a tool result (executeBffTool output: object or JSON string) into
 * an object. Unparseable/empty input becomes an error-shaped object that
 * classifyMcpToolResult routes to kind:'error' — never a raw string, never
 * null (classify(null) is 'ok', which turned parse failures into false
 * successes on the write paths).
 */
function parseToolResult(raw, opts = {}) {
  const site = opts.site || 'tool';
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return { result: raw, parseFailed: false };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = repairAndParseJson(raw);
    if (parsed !== null) return { result: parsed, parseFailed: false };
    logMendEvent('tool_result_unparseable', { site, snippet: snippet(raw) });
    return {
      result: {
        error: 'tool_result_unparseable',
        error_description: `The tool returned data the agent could not read: ${snippet(raw)}`,
      },
      parseFailed: true,
    };
  }
  logMendEvent('tool_result_empty', { site });
  return {
    result: { error: 'tool_result_empty', error_description: 'The tool returned no data.' },
    parseFailed: true,
  };
}
```

```js
module.exports = { repairAndParseJson, validateIntent, parseToolResult, snippet, logMendEvent };
```

Note: `repairAndParseJson('null')` returns `null` (valid JSON null) which is indistinguishable from failure here — acceptable: a literal `null` tool result carries no renderable data, and the error path is the safer render for it.

- [ ] **Step 5: Wire `parseMcpToolPayload`**

In `demo_api_server/services/verticalMcpExecution.js`, add the require (after line 11):

```js
const { parseToolResult } = require('./llmResponseContract');
```

Replace the parse block (current lines 17-22):

```js
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    parsed = null;
  }
```

with:

```js
  const { result: parsed } = parseToolResult(raw, { site: 'parseMcpToolPayload' });
```

The existing `classifyMcpToolResult(parsed)` on the next line now sees `{error, error_description}` for garbage and returns the error render (`c.kind === 'error'` → `{ result: { error: c.message }, render: 'text' }`).

- [ ] **Step 6: Wire the six demoAgentLangGraphService sites**

In `demo_api_server/services/demoAgentLangGraphService.js`, add the require next to the other service requires at the top of the file:

```js
const { parseToolResult } = require('./llmResponseContract');
```

Site A (read path, current lines 163-165):

```js
      let parsed2;
      try { parsed2 = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult; }
      catch (_) { parsed2 = null; }
```

becomes:

```js
      const { result: parsed2 } = parseToolResult(rawResult, { site: `banking_read:${toolName}` });
```

And in the error branch just below (current line 173), add `error_description` so the contract's message renders instead of the bare code:

```js
        const errMsg = parsed2?.content?.[0]?.text || parsed2?.error_description || parsed2?.message || parsed2?.error || 'Tool call failed.';
```

Sites B/C/D (transfer line 273-275, deposit line 320-322, withdraw line 367-369) — each block:

```js
        let result;
        try { result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult; }
        catch (_) { result = null; }
```

becomes (adjust the site tag per block: `create_transfer` / `create_deposit` / `create_withdrawal`):

```js
        const { result } = parseToolResult(rawResult, { site: 'create_transfer' });
```

The `classifyMcpToolResult(result)` call that follows each block is unchanged — garbage now hits its `kind:'error'` branch ("Transfer failed: The tool returned data the agent could not read: …") instead of falling through to the success reply.

Site E (sensitive details, current lines 407-408):

```js
      let parsed;
      try { parsed = JSON.parse(rawResult?.content?.[0]?.text || '{}'); } catch (_) { parsed = rawResult; }
```

becomes:

```js
      const { result: parsed, parseFailed } = parseToolResult(rawResult?.content?.[0]?.text ?? rawResult, { site: 'get_sensitive_account_details' });
      if (parseFailed) {
        return { reply: `❌ ${parsed.error_description}`, success: false, toolsCalled: ['get_sensitive_account_details'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }
```

Site F (A2A delegation, current line 542):

```js
    try { toolResult = JSON.parse(raw); } catch (_e) { toolResult = raw; }
```

becomes:

```js
    ({ result: toolResult } = parseToolResult(raw, { site: `a2a:${result.tool}` }));
```

(Lines 711 and 830 already wrap parse failures in `{delegated:false, error}` envelopes — leave them.)

- [ ] **Step 7: Run the new tests and every suite touching these paths**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern='llmResponseContract|toolResultFalseSuccess|bffMcpEnvelopeUnwrap|verticalIntentDispatch|dispatchVerticalIntent|mcpToolPipeline|agentReasoningLoop'`
Expected: PASS. The characterization suites (`mcpToolPipeline.characterization`, `bffMcpEnvelopeUnwrap.regression`) are the guard that envelope handling didn't drift — if one fails, the wiring changed behavior for parseable input, which is a bug in the wiring, not the test.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/services/llmResponseContract.js demo_api_server/services/verticalMcpExecution.js demo_api_server/services/demoAgentLangGraphService.js demo_api_server/src/__tests__/llmResponseContract.toolResult.test.js demo_api_server/src/__tests__/toolResultFalseSuccess.regression.test.js
git commit -m "fix(agent): unparseable tool results surface as errors, never false success or {} renders"
```

---

### Task 5: Grammar-constrained intent decoding on llama.cpp

**Files:**
- Modify: `demo_api_server/services/llamacppLlmService.js:58-90` (`callLlamaCpp` signature + body)
- Modify: `demo_api_server/services/geminiNlIntent.js:616-644` (the LLAMACPP intent branch only — NOT the conversational `answerWithLlamaCpp`)
- Test: `demo_api_server/src/__tests__/llamacppLlmService.jsonSchema.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of the contract module).
- Produces: `callLlamaCpp(messages, opts?: { jsonSchema?: object })` — when `opts.jsonSchema` is set, the request body gains `response_format: { type: 'json_object', schema: opts.jsonSchema }` (llama.cpp's OpenAI-compat grammar constraint). On HTTP 400 with a schema present, retries once without it so older llama-server builds and non-llama backends behind `LLAMACPP_BASE_URL` keep working.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/llamacppLlmService.jsonSchema.test.js
'use strict';

describe('callLlamaCpp json schema constraint', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    process.env.LLAMACPP_MODEL = 'test-model'; // skip the /v1/models discovery fetch
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LLAMACPP_MODEL;
  });

  const okResponse = (content) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it('sends response_format with the schema when opts.jsonSchema is set', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => { calls.push(JSON.parse(init.body)); return okResponse('{"kind":"none"}'); });
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    const schema = { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } };
    await callLlamaCpp([{ role: 'user', content: 'hi' }], { jsonSchema: schema });
    expect(calls[0].response_format).toEqual({ type: 'json_object', schema });
  });

  it('omits response_format without opts (conversational path unchanged)', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => { calls.push(JSON.parse(init.body)); return okResponse('hello'); });
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    await callLlamaCpp([{ role: 'user', content: 'hi' }]);
    expect(calls[0].response_format).toBeUndefined();
  });

  it('retries once without response_format on HTTP 400 (older llama-server compat)', async () => {
    const calls = [];
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn(async (url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) return { ok: false, status: 400, text: async () => 'unknown field response_format' };
      return okResponse('{"kind":"none"}');
    });
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    const out = await callLlamaCpp([{ role: 'user', content: 'hi' }], { jsonSchema: { type: 'object' } });
    expect(calls).toHaveLength(2);
    expect(calls[1].response_format).toBeUndefined();
    expect(out).toBe('{"kind":"none"}');
    spy.mockRestore();
  });

  it('still throws on non-400 HTTP errors', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'loading model' }));
    const { callLlamaCpp } = require('../../services/llamacppLlmService');
    await expect(callLlamaCpp([{ role: 'user', content: 'hi' }], { jsonSchema: { type: 'object' } }))
      .rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=llamacppLlmService.jsonSchema`
Expected: FAIL — `response_format` is undefined on the first case (current signature ignores opts).

- [ ] **Step 3: Implement in `llamacppLlmService.js`**

Replace `callLlamaCpp` (current lines 58-90) with:

```js
/**
 * Call llama-server's OpenAI-compatible chat endpoint and return the assistant reply text.
 * @param {Array} messages [{ role:'system'|'user'|'assistant'|'human', content }]
 * @param {{ jsonSchema?: object }} [opts] jsonSchema constrains decoding to that
 *   JSON shape (llama.cpp grammar). On HTTP 400 the call retries once without it
 *   so older llama-server builds keep working.
 * @returns {Promise<string>}
 */
async function callLlamaCpp(messages, opts = {}) {
  if (!messages || messages.length === 0) throw new Error('No messages provided to llama.cpp');
  const base = baseUrl();
  const mdl = await model();

  const body = {
    model: mdl,
    messages: toOpenAiMessages(messages),
    stream: false,
    temperature: 0,
    // Intent JSON is short; cap tokens so small models finish under SPA timeouts.
    max_tokens: 256,
  };
  if (opts.jsonSchema) {
    body.response_format = { type: 'json_object', schema: opts.jsonSchema };
  }

  const post = () => fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer llama-cpp',
    },
    body: JSON.stringify(body),
  });

  let res = await post();
  if (!res.ok && res.status === 400 && body.response_format) {
    console.warn('[llamacpp] response_format rejected (400) — retrying without schema constraint');
    delete body.response_format;
    res = await post();
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`llama.cpp chat/completions failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('llama.cpp returned an empty completion');
  }
  // Strip any <think>…</think> chain-of-thought wrapper some models emit.
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
```

- [ ] **Step 4: Pass the schema from the intent branch**

In `demo_api_server/services/geminiNlIntent.js`, add near `JSON_RETRY_NUDGE` (module scope):

```js
/**
 * Grammar constraint for llama.cpp intent routing: forces a JSON object with a
 * "kind" field. Deliberately permissive — themes add per-vertical shapes and
 * kind:"none" is a legal model answer; validateIntent does the strict check.
 */
const INTENT_JSON_SCHEMA = {
  type: 'object',
  required: ['kind'],
  properties: { kind: { type: 'string' } },
};
```

In the LLAMACPP intent branch (current lines 616-644), pass it on both calls:

```js
      const raw = await callLlamaCpp([
        { role: 'system', content: systemWithCtx },
        { role: 'user', content: message },
      ], { jsonSchema: INTENT_JSON_SCHEMA });
```

and in the retry:

```js
          const retry = await callLlamaCpp([
            { role: 'system', content: systemWithCtx + JSON_RETRY_NUDGE },
            { role: 'user', content: message },
          ], { jsonSchema: INTENT_JSON_SCHEMA });
```

Do NOT touch `answerWithLlamaCpp` (conversational — free text stays unconstrained).

- [ ] **Step 5: Run the suites**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern='llamacpp|geminiNlIntent|resolveLlmBackend'`
Expected: PASS.

- [ ] **Step 6: Live smoke test against the local model router (if running)**

Run: `curl -s http://localhost:8090/health >/dev/null 2>&1 && echo up || echo down`

If `up`, verify constrained decoding end-to-end:

```bash
curl -s http://localhost:8090/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer llama-cpp' \
  -d '{"model":"phi-4-mini-instruct","messages":[{"role":"user","content":"Say hi"}],"max_tokens":64,"response_format":{"type":"json_object","schema":{"type":"object","required":["kind"],"properties":{"kind":{"type":"string"}}}}}' \
  | head -c 400
```

Expected: a completion whose `content` is a JSON object containing `"kind"` (or, on an old build, an HTTP 400 — which the compat retry in Step 3 covers). If `down`, note it in the task report; the mocked tests carry the gate.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/llamacppLlmService.js demo_api_server/services/geminiNlIntent.js demo_api_server/src/__tests__/llamacppLlmService.jsonSchema.test.js
git commit -m "feat(llm): grammar-constrained intent decoding on llama.cpp with 400 compat fallback"
```

---

### Task 6: Full-suite verification gate

**Files:** none (verification only).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: green evidence for the phase's success criterion 1 (fault-injection: malformed/blank/garbage never renders raw).

- [ ] **Step 1: Run the complete api-server unit suite**

Run: `cd demo_api_server && npx jest --forceExit`
Expected: PASS with zero failures (same pass count as a pre-change baseline run plus the new tests; if the baseline itself has pre-existing failures, record them before starting Task 1 and require no NEW failures).

- [ ] **Step 2: Run the repo's fast regression entry point**

Run: `./run-tests.sh unit`
Expected: PASS (step-up-gate / authorize-gate / runtime-settings / transaction-flows unaffected).

- [ ] **Step 3: Commit any test-baseline notes and update REGRESSION_LOG.md**

Append a REGRESSION_LOG.md entry (follow the file's existing format: Symptom / Root cause / Fix / Tests) for the false-success bug fixed in Task 4:

- **Symptom:** agent replied "Transferred $X" success when the tool result was unparseable; vertical chips rendered `{}`.
- **Root cause:** parse-to-null + `classifyMcpToolResult(null)` → `{kind:'ok'}`; `parseMcpToolPayload` fell back to `result:{}`.
- **Fix:** `llmResponseContract.parseToolResult` returns error-shaped objects for unparseable/empty tool output at all consumer sites.
- **Tests:** `toolResultFalseSuccess.regression.test.js`.

```bash
git add REGRESSION_LOG.md
git commit -m "docs: regression log entry for unparseable-tool-result false success"
```
