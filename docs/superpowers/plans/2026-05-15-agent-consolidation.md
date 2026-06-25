# Agent Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate to one LangGraph agent running as a reasoning-only service on :3006 (BFF keeps token custody + HITL), and enforce one app-wide LLM provider-resolution rule (Heuristic → Helix → Ollama-only-if-configured).

**Architecture:** Two phases. Phase 1 builds a single shared `llmProviderResolver` and converges every provider-default site onto it (independently shippable, low risk). Phase 2 ports the in-process LangGraph graph into `banking_agent_service` (:3006) as a stateless reasoning oracle; the BFF drives a turn loop and remains the sole token custodian + HITL enforcer.

**Tech Stack:** Node.js (CommonJS, `banking_api_server`), TypeScript (`banking_agent_service`), Jest, LangGraph (`@langchain/langgraph`), Express.

**Spec:** `docs/superpowers/specs/2026-05-15-agent-consolidation-design.md`

---

## File Structure

**Phase 1 (provider resolver):**
- Create: `banking_api_server/services/llmProviderResolver.js` — the single resolution function
- Create: `banking_api_server/tests/llmProviderResolver.regression.test.js` — resolver unit tests
- Modify: `banking_api_server/services/agentBuilder.js` (~line 162) — call resolver
- Modify: `banking_api_server/services/geminiNlIntent.js` (~line 234 doc, ~line 250 default) — call resolver, fix doc
- Modify: `banking_api_server/routes/langchainConfig.js` (~line 165) — call resolver instead of `|| 'ollama'`

**Phase 2 (:3006 LangGraph move):**
- Create: `banking_agent_service/src/reasoningGraph.ts` — ported LangGraph graph (TS)
- Create: `banking_agent_service/src/reasonRoute.ts` — `POST /api/agent/reason` handler
- Modify: `banking_agent_service/src/index.ts` — replace `/api/agent/task`, delete token/MCP code
- Create: `banking_api_server/services/agentReasoningClient.js` — BFF→:3006 HTTP client + turn loop
- Modify: `banking_api_server/services/bankingAgentLangGraphService.js` — `processAgentMessage` calls the loop instead of in-process graph
- Create: `banking_api_server/tests/agentReasoningLoop.regression.test.js` — loop + fallback + HITL-suspend tests
- Modify: `CONTEXT.md` — agent glossary
- Modify: `banking_api_ui/src/pages/LangChainPage.js` + placement-mode copy — narrative labels (Phase 2 final task)

---

# PHASE 1 — Single Provider Resolver

### Task 1: Create the `llmProviderResolver` module (TDD)

**Files:**
- Create: `banking_api_server/services/llmProviderResolver.js`
- Test: `banking_api_server/tests/llmProviderResolver.regression.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/llmProviderResolver.regression.test.js
/**
 * Regression: one canonical provider resolver.
 * Rule (ARCHITECTURE-TRUTHS T-3): Heuristic runs upstream (not here).
 * When consulted: explicit choice honored; else Helix; Ollama ONLY if
 * explicitly selected AND configured, else fall back to Helix.
 */
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));
const { resolveLlmProvider } = require('../services/llmProviderResolver');

describe('resolveLlmProvider', () => {
  test('defaults to helix when no provider set', () => {
    expect(resolveLlmProvider({})).toEqual({ provider: 'helix', model: undefined });
  });

  test('honors explicit helix', () => {
    expect(resolveLlmProvider({ provider: 'helix', model: 'gpt-4o-mini' }))
      .toEqual({ provider: 'helix', model: 'gpt-4o-mini' });
  });

  test('honors explicit ollama when configured (ollama_base_url present)', () => {
    expect(resolveLlmProvider({ provider: 'ollama', ollama_base_url: 'http://localhost:11434', model: 'llama3.2' }))
      .toEqual({ provider: 'ollama', model: 'llama3.2' });
  });

  test('falls back to helix when ollama selected but NOT configured', () => {
    expect(resolveLlmProvider({ provider: 'ollama' }))
      .toEqual({ provider: 'helix', model: undefined });
  });

  test('unknown provider falls back to helix', () => {
    expect(resolveLlmProvider({ provider: 'gpt5' }))
      .toEqual({ provider: 'helix', model: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/llmProviderResolver.regression.test.js`
Expected: FAIL — `Cannot find module '../services/llmProviderResolver'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// banking_api_server/services/llmProviderResolver.js
/**
 * Single canonical LLM provider resolver (ARCHITECTURE-TRUTHS T-3).
 *
 * The heuristic is NOT a provider — it always runs upstream and is the
 * deterministic floor. This resolver is consulted only when the heuristic
 * did not answer.
 *
 * Rule: explicit langchainConfig.provider is honored; otherwise Helix.
 * 'ollama' is returned ONLY when explicitly selected AND configured
 * (an ollama_base_url is present, or OLLAMA_BASE_URL env is set). If
 * 'ollama' is selected but not configured, fall back to Helix — never a
 * dead Ollama call. No other module may inline a provider default.
 *
 * @param {{ provider?: string, model?: string, ollama_base_url?: string }} langchainConfig
 * @returns {{ provider: 'helix'|'ollama', model: string|undefined }}
 */
function resolveLlmProvider(langchainConfig = {}) {
  const requested = langchainConfig && langchainConfig.provider;
  const model = langchainConfig && langchainConfig.model;

  if (requested === 'ollama') {
    const configured =
      !!(langchainConfig && langchainConfig.ollama_base_url) ||
      !!process.env.OLLAMA_BASE_URL;
    if (configured) return { provider: 'ollama', model };
    return { provider: 'helix', model };
  }

  if (requested === 'helix') return { provider: 'helix', model };

  // No explicit provider, or an unknown one → Helix (the default LLM).
  return { provider: 'helix', model };
}

module.exports = { resolveLlmProvider };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest tests/llmProviderResolver.regression.test.js`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/llmProviderResolver.js banking_api_server/tests/llmProviderResolver.regression.test.js
git commit -m "feat(llm): single canonical provider resolver (T-3)"
```

---

### Task 2: Converge `agentBuilder.js` onto the resolver

**Files:**
- Modify: `banking_api_server/services/agentBuilder.js:160-163`

- [ ] **Step 1: Replace the inline default**

In `banking_api_server/services/agentBuilder.js`, find (around line 160-163):

```javascript
        // Initialize LLM provider (Helix, Ollama, or others)
    let model;
    const provider = langchainConfig?.provider || 'helix';
    const selectedModel = langchainConfig?.model || DEFAULT_MODELS[provider];
```

Replace with:

```javascript
        // Initialize LLM provider — resolution is centralized (T-3).
    let model;
    const { resolveLlmProvider } = require('./llmProviderResolver');
    const { provider } = resolveLlmProvider(langchainConfig);
    const selectedModel = langchainConfig?.model || DEFAULT_MODELS[provider];
```

- [ ] **Step 2: Run agent builder + existing agent tests to verify no regression**

Run: `cd banking_api_server && npx jest agentBuilder bankingAgent --passWithNoTests`
Expected: PASS (or no test files — that is acceptable here; behavior verified by Task 5 integration)

- [ ] **Step 3: Syntax check**

Run: `cd banking_api_server && node -c services/agentBuilder.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add banking_api_server/services/agentBuilder.js
git commit -m "refactor(agentBuilder): use central provider resolver, drop inline default"
```

---

### Task 3: Converge `geminiNlIntent.js` onto the resolver + fix stale doc

**Files:**
- Modify: `banking_api_server/services/geminiNlIntent.js:234` (doc), `:250` (default)

- [ ] **Step 1: Fix the stale doc comment**

In `banking_api_server/services/geminiNlIntent.js` around line 234, find:

```javascript
 * @param {string} [provider='auto'] - 'auto' (heuristic→ollama), 'ollama' (skip heuristic), 'helix', etc.
```

Replace with:

```javascript
 * @param {string} [provider='auto'] - 'auto' (heuristic→helix), 'ollama' (skip heuristic, requires Ollama configured), 'helix'. See llmProviderResolver.
```

- [ ] **Step 2: Replace the inline default with the resolver**

Around line 250, find:

```javascript
  const selectedProvider = provider === 'auto' ? (langchainConfig?.provider || configStore.get('provider') || 'helix') : provider;
```

Replace with:

```javascript
  const { resolveLlmProvider } = require('./llmProviderResolver');
  const selectedProvider = provider === 'auto'
    ? resolveLlmProvider(langchainConfig).provider
    : provider;
```

- [ ] **Step 3: Syntax check**

Run: `cd banking_api_server && node -c services/geminiNlIntent.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Run NL-intent-related tests**

Run: `cd banking_api_server && npx jest geminiNlIntent nlIntent --passWithNoTests`
Expected: PASS (or no matching test files — acceptable)

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/geminiNlIntent.js
git commit -m "refactor(nl-intent): central provider resolver + fix stale heuristic→ollama doc"
```

---

### Task 4: Fix the Ollama-default in `routes/langchainConfig.js`

**Files:**
- Modify: `banking_api_server/routes/langchainConfig.js:165`

- [ ] **Step 1: Replace `|| 'ollama'` with the resolver**

In `banking_api_server/routes/langchainConfig.js` around line 164-165, find:

```javascript
  const cfg = getLangchainConfig(req);
  const activeProvider = cfg.provider || 'ollama';
```

Replace with:

```javascript
  const cfg = getLangchainConfig(req);
  const { resolveLlmProvider } = require('../services/llmProviderResolver');
  const activeProvider = resolveLlmProvider(cfg).provider;
```

- [ ] **Step 2: Syntax check**

Run: `cd banking_api_server && node -c routes/langchainConfig.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add banking_api_server/routes/langchainConfig.js
git commit -m "fix(langchain-config): default to Helix via resolver, not Ollama"
```

---

### Task 5: Phase 1 verification — critical suite + manual provider check

**Files:** none (verification only)

- [ ] **Step 1: Run the resolver suite + critical regression suite**

Run:
```bash
cd banking_api_server && npx jest tests/llmProviderResolver.regression.test.js oauthStatus.regression oauthStatus.integration hitlRoute.regression hitlRoute.integration
```
Expected: all PASS (5 resolver + 38 critical = 43 passed)

- [ ] **Step 2: Grep-assert no inline provider defaults remain**

Run:
```bash
cd banking_api_server && grep -rnE "\|\|\s*'(ollama|helix)'" services/agentBuilder.js services/geminiNlIntent.js routes/langchainConfig.js || echo "CLEAN — no inline provider defaults"
```
Expected: `CLEAN — no inline provider defaults`

- [ ] **Step 3: Add REGRESSION_PLAN §4 entry**

Add to `REGRESSION_PLAN.md` §4 (top, reverse-chronological), using the project template (Files changed / What was broken / What was fixed / Verify / Do not break). Summary: provider resolution unified into `llmProviderResolver.js`; `routes/langchainConfig.js` no longer defaults to Ollama; T-3 single-resolver invariant now enforced. Do-not-break: no module may reintroduce an inline `|| 'helix'`/`|| 'ollama'`.

- [ ] **Step 4: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): §4 entry — single provider resolver (Phase 1)"
```

---

# PHASE 2 — LangGraph reasoning service on :3006 (LangGraph for ALL providers)

> Preconditions: Phase 1 merged. BFF keeps token custody + HITL; :3006 is reasoning-only.
> Design: `docs/superpowers/specs/2026-05-15-agent-consolidation-design.md`
> §"Phase 2 Component Design — Helix Prompt-Based Tool-Calling".

### Task 6: `/api/agent/reason` contract — DONE, plus additive `reasoningUnavailable`

Task 6 (create `banking_agent_service/src/reasonContract.ts`) is already
implemented and committed (`1a89633a`). This task only adds one optional field
the Helix-failure signal needs.

**Files:**
- Modify: `banking_agent_service/src/reasonContract.ts` (the `final` union member)

- [ ] **Step 1: Add the optional `reasoningUnavailable` flag**

In `banking_agent_service/src/reasonContract.ts`, find:

```typescript
export type ReasonResponse =
  | { type: 'tool_calls'; calls: Array<{ id: string; name: string; args: Record<string, unknown> }>; messages: ReasonMessage[] }
  | { type: 'final'; answer: string; messages: ReasonMessage[] };
```

Replace the `final` member line so the type becomes:

```typescript
export type ReasonResponse =
  | { type: 'tool_calls'; calls: Array<{ id: string; name: string; args: Record<string, unknown> }>; messages: ReasonMessage[] }
  | { type: 'final'; answer: string; messages: ReasonMessage[]; reasoningUnavailable?: boolean };
```

- [ ] **Step 2: Build**

Run: `cd banking_agent_service && npm run build && echo BUILD_OK`
Expected: `BUILD_OK`

- [ ] **Step 3: Commit**

```bash
git add banking_agent_service/src/reasonContract.ts
git -c commit.gpgsign=false commit -m "feat(agent-svc): add reasoningUnavailable flag to ReasonResponse"
```
(Pre-commit CHANGELOG warning is non-blocking; do not use --no-verify.)

---

### Task 7a: Add LangChain deps to `banking_agent_service`

**Files:**
- Modify: `banking_agent_service/package.json`

- [ ] **Step 1: Check the versions the BFF already uses (match them)**

Run: `cd banking_api_server && node -e "const p=require('./package.json'); console.log('langgraph', p.dependencies['@langchain/langgraph']); console.log('ollama', p.dependencies['@langchain/ollama']); console.log('core', p.dependencies['@langchain/core'])"`
Record the three version strings. Use these EXACT versions in Step 2 so :3006 and the BFF stay on the same LangChain.

- [ ] **Step 2: Add the three deps to banking_agent_service/package.json**

Add `@langchain/langgraph`, `@langchain/ollama`, `@langchain/core` to the `dependencies` object of `banking_agent_service/package.json`, using the exact version strings from Step 1 (do not invent versions; do not use `latest`).

- [ ] **Step 3: Install**

Run: `cd banking_agent_service && npm install 2>&1 | tail -3`
Expected: install completes, no peer-dep ERR. If a peer-dep error appears, report BLOCKED with the exact error.

- [ ] **Step 4: Verify the build still works**

Run: `cd banking_agent_service && npm run build && echo BUILD_OK`
Expected: `BUILD_OK`

- [ ] **Step 5: Commit**

```bash
git add banking_agent_service/package.json banking_agent_service/package-lock.json
git -c commit.gpgsign=false commit -m "build(agent-svc): add @langchain/{langgraph,ollama,core} (matched to BFF versions)"
```

---

### Task 7b: Port the Helix HTTP flow into `helixClient.ts`

A faithful TypeScript port of `banking_api_server/services/helixLlmService.js`
`callHelixAgent` — the 3-step Helix Conversation API flow. Receives connection
config per call; persists nothing; returns a `string` (Helix has no native
tool-calling — that is handled in Task 7c).

**Files:**
- Create: `banking_agent_service/src/helixClient.ts`
- Test: `banking_agent_service/tests/helixClient.test.ts`

- [ ] **Step 1: Write the failing test (mock global fetch)**

```typescript
// banking_agent_service/tests/helixClient.test.ts
import { callHelix } from '../src/helixClient';

const CFG = {
  helix_base_url: 'https://helix.example.com',
  helix_api_key: 'k',
  helix_environment_id: 'env1',
  helix_agent_id: 'agentA',
  helix_prompt_field_id: 'promptField',
};

describe('callHelix — 3-step Helix Conversation flow', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  test('throws if config incomplete', async () => {
    await expect(callHelix({}, [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/Helix config incomplete/);
  });

  test('create → post → immediate complete value returns text', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1', home_channel: 'ch1' }) }) // create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1', class: 'complete', value: 'hello world' }) }); // post (immediate)
    const out = await callHelix(CFG, [{ role: 'user', content: 'hi' }]);
    expect(out).toBe('hello world');
    // create body must include agent.version
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(createBody).toEqual({ agent: { version: 'published' } });
    // post body uses the configured prompt field id
    const postBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(postBody.content.promptField).toBe('hi');
  });

  test('post returns no value → polls until agent message', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1', home_channel: 'ch1' }) }) // create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'mq' }) }) // post, no value
      .mockResolvedValueOnce({ ok: true, json: async () => ([]) }) // poll 1: nothing
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ sender_role: 'agent', message_id: 'ma', class: 'complete', value: 'polled answer' }]) }); // poll 2
    const out = await callHelix(CFG, [{ role: 'user', content: 'hi' }]);
    expect(out).toBe('polled answer');
  });

  test('extractValue unwraps JSON {response} when present', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1', home_channel: 'ch1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1', class: 'complete', value: JSON.stringify({ response: 'unwrapped' }) }) });
    const out = await callHelix(CFG, [{ role: 'user', content: 'hi' }]);
    expect(out).toBe('unwrapped');
  });

  test('create failure throws', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    await expect(callHelix(CFG, [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/Helix createConversation failed: 500/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd banking_agent_service && npx jest tests/helixClient.test.ts`
Expected: FAIL — Cannot find module '../src/helixClient'

- [ ] **Step 3: Implement the port (faithful to helixLlmService.js)**

Create `banking_agent_service/src/helixClient.ts`. Port `apiBase`,
`extractValue`, and the create→post→poll flow EXACTLY from
`banking_api_server/services/helixLlmService.js` (constant
`HELIX_PATH = '/dpc/jas/helix/v1'`; auth header `x-api-key`; create body
`{agent:{version:'published'}}`; post `Content-Type: 'application/json; async=false'`,
body `{class:'start',content:{[promptFieldId]:prompt}}`; 30s poll at 1s
interval; agent message = `sender_role==='agent' && message_id!==queryId && value!=null`;
`extractValue` looks for `class/message_class==='complete'` with `.value`, tries
`JSON.parse` and returns `.response` if present else raw). Use the exact code:

```typescript
// banking_agent_service/src/helixClient.ts
// Faithful TS port of banking_api_server/services/helixLlmService.js
// callHelixAgent. 3-step Helix Conversation flow. No tokens, no persistence.
// Returns a string (Helix has no native tool-calling — see helixToolAdapter).
import type { ReasonMessage } from './reasonContract';

const HELIX_PATH = '/dpc/jas/helix/v1';

function apiBase(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin + HELIX_PATH;
  } catch {
    return baseUrl.replace(/\/$/, '').replace(/\/dpc\/.*$/, '') + HELIX_PATH;
  }
}

function extractValue(data: any): string | null {
  const items = Array.isArray(data) ? data : (Array.isArray(data?.content) ? data.content : [data]);
  const done = items.find((m: any) => m && (m.class === 'complete' || m.message_class === 'complete') && m.value != null);
  const raw = done?.value ?? null;
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.response === 'string') return parsed.response;
  } catch { /* not JSON — use raw */ }
  return raw;
}

export async function callHelix(
  cfg: Record<string, string | undefined>,
  messages: ReasonMessage[],
): Promise<string> {
  const { helix_base_url, helix_api_key, helix_environment_id, helix_agent_id, helix_prompt_field_id } = cfg;
  const missing: string[] = [];
  if (!helix_base_url) missing.push('helix_base_url');
  if (!helix_api_key) missing.push('helix_api_key');
  if (!helix_environment_id) missing.push('helix_environment_id');
  if (!helix_agent_id) missing.push('helix_agent_id');
  if (!helix_prompt_field_id) missing.push('helix_prompt_field_id');
  if (missing.length) throw new Error(`Helix config incomplete: missing ${missing.join(', ')}`);
  if (!messages || messages.length === 0) throw new Error('No messages provided to Helix agent');

  const base = apiBase(helix_base_url as string);
  const apiKey = helix_api_key as string;

  const lastUser = [...messages].reverse().find((m) => m.role === 'user') || messages[messages.length - 1];
  const userText = typeof lastUser.content === 'string' ? lastUser.content : String(lastUser.content ?? '');
  const systemMsg = messages.find((m) => m.role === 'assistant' && false) || undefined; // no system role in ReasonMessage
  const prompt = userText;

  // Step 1 — create conversation
  const convRes = await fetch(
    `${base}/environments/${helix_environment_id}/agents/${helix_agent_id}/conversations`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ agent: { version: 'published' } }) },
  );
  if (!convRes.ok) {
    const errText = await convRes.text();
    throw new Error(`Helix createConversation failed: ${convRes.status} ${errText}`);
  }
  const conv: any = await convRes.json();
  if (!conv || !conv.id) throw new Error('Helix createConversation returned null');
  const conversationId = conv.id;
  const channelId = conv.home_channel;

  // Step 2 — post message
  const msgRes = await fetch(
    `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`,
    { method: 'POST', headers: { 'Content-Type': 'application/json; async=false', 'x-api-key': apiKey }, body: JSON.stringify({ class: 'start', content: { [helix_prompt_field_id as string]: prompt } }) },
  );
  if (!msgRes.ok) {
    const errText = await msgRes.text();
    throw new Error(`Helix sendMessage failed: ${msgRes.status} ${errText}`);
  }
  const msgData: any = await msgRes.json();
  const queryMessageId = msgData?.message_id || msgData?.id;
  const immediate = extractValue(msgData);
  if (immediate != null) return immediate;

  // Step 3 — poll
  const pollUrl = `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    const pollRes = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
    if (!pollRes.ok) {
      const errText = await pollRes.text();
      throw new Error(`Helix poll failed: ${pollRes.status} ${errText}`);
    }
    const data: any = await pollRes.json();
    const messages_ = Array.isArray(data) ? data : [];
    const agentMsg = messages_.find((m: any) => m.sender_role === 'agent' && m.message_id !== queryMessageId && m.value != null);
    if (agentMsg) {
      const result = extractValue(agentMsg);
      if (result != null) return result;
    }
    const top = extractValue(data);
    if (top != null) return top;
  }
  throw new Error('Timed out waiting for Helix response');
}
```

NOTE: `ReasonMessage` has no `system` role (only user/assistant/tool), so the
system-prepend logic from the JS original is intentionally dropped — tool
instructions are injected by `helixToolAdapter` (Task 7c) into the user text,
not via a system message. The poll loop's real 1s sleeps make the
"polls until agent message" test slow but bounded (~2s); acceptable.

- [ ] **Step 4: Run to verify it passes**

Run: `cd banking_agent_service && npx jest tests/helixClient.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add banking_agent_service/src/helixClient.ts banking_agent_service/tests/helixClient.test.ts
git -c commit.gpgsign=false commit -m "feat(agent-svc): port Helix 3-step Conversation flow (helixClient)"
```

---

### Task 7c: `helixToolAdapter` — prompt-based tool-calling (TDD)

The novel component. Converts Helix's free-text string into a tool-capable
model shape. Sentinel: `TOOL_CALL: {json}`. One strict retry, then throw
`HelixUnparseableError`. Design: spec §"Phase 2 Component Design".

**Files:**
- Create: `banking_agent_service/src/helixToolAdapter.ts`
- Test: `banking_agent_service/tests/helixToolAdapter.test.ts`

- [ ] **Step 1: Write the failing test (inject a fake helixClient)**

```typescript
// banking_agent_service/tests/helixToolAdapter.test.ts
import { helixReason, HelixUnparseableError } from '../src/helixToolAdapter';
import type { ReasonToolSchema, ReasonMessage } from '../src/reasonContract';

const TOOLS: ReasonToolSchema[] = [
  { name: 'get_my_transactions', description: 'list txns', inputSchema: { type: 'object', properties: {} } },
];
const MSGS: ReasonMessage[] = [{ role: 'user', content: 'show my transactions' }];
const CFG = {};

function fakeClient(responses: string[]) {
  let i = 0;
  const calls: any[] = [];
  const fn = async (_cfg: any, msgs: ReasonMessage[]) => { calls.push(msgs); return responses[i++]; };
  return { fn, calls };
}

describe('helixReason — sentinel tool-call adapter', () => {
  test('plain prose → content (the ~50% conversational case)', async () => {
    const { fn } = fakeClient(['Your balance is healthy. Anything else?']);
    const out = await helixReason(CFG, MSGS, TOOLS, fn);
    expect(out).toEqual({ content: 'Your balance is healthy. Anything else?' });
  });

  test('clean TOOL_CALL line → tool_calls', async () => {
    const { fn } = fakeClient(['TOOL_CALL: {"name":"get_my_transactions","args":{}}']);
    const out = await helixReason(CFG, MSGS, TOOLS, fn);
    expect(out.tool_calls?.[0].name).toBe('get_my_transactions');
    expect(out.tool_calls?.[0].args).toEqual({});
    expect(typeof out.tool_calls?.[0].id).toBe('string');
  });

  test('TOOL_CALL wrapped in code fences + preamble still parses', async () => {
    const { fn } = fakeClient(['Sure!\n```\nTOOL_CALL: {"name":"get_my_transactions","args":{}}\n```']);
    const out = await helixReason(CFG, MSGS, TOOLS, fn);
    expect(out.tool_calls?.[0].name).toBe('get_my_transactions');
  });

  test('prose containing a JSON example does NOT false-positive', async () => {
    const { fn } = fakeClient(['An access token looks like {"sub":"abc","scope":"banking:read"} — no action needed.']);
    const out = await helixReason(CFG, MSGS, TOOLS, fn);
    expect(out.content).toContain('access token looks like');
    expect(out.tool_calls).toBeUndefined();
  });

  test('unknown tool name → retry → recovered', async () => {
    const { fn, calls } = fakeClient([
      'TOOL_CALL: {"name":"hallucinated_tool","args":{}}',
      'TOOL_CALL: {"name":"get_my_transactions","args":{}}',
    ]);
    const out = await helixReason(CFG, MSGS, TOOLS, fn);
    expect(out.tool_calls?.[0].name).toBe('get_my_transactions');
    expect(calls.length).toBe(2); // exactly one retry
  });

  test('malformed JSON → retry → still malformed → throws HelixUnparseableError', async () => {
    const { fn, calls } = fakeClient([
      'TOOL_CALL: {not json',
      'TOOL_CALL: still {not} json',
    ]);
    await expect(helixReason(CFG, MSGS, TOOLS, fn)).rejects.toBeInstanceOf(HelixUnparseableError);
    expect(calls.length).toBe(2); // exactly ONE retry — hard cap
  });

  test('retry returns prose → treated as content (valid)', async () => {
    const { fn, calls } = fakeClient([
      'TOOL_CALL: {bad',
      'On reflection, your balance is fine.',
    ]);
    const out = await helixReason(CFG, MSGS, TOOLS, fn);
    expect(out.content).toBe('On reflection, your balance is fine.');
    expect(calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd banking_agent_service && npx jest tests/helixToolAdapter.test.ts`
Expected: FAIL — Cannot find module '../src/helixToolAdapter'

- [ ] **Step 3: Implement**

```typescript
// banking_agent_service/src/helixToolAdapter.ts
// Makes Helix (free-text, no native tool-calling) behave like a tool-capable
// model via a TOOL_CALL: sentinel. One strict retry, then HelixUnparseableError.
// Design: docs/superpowers/specs/2026-05-15-agent-consolidation-design.md
import type { ReasonMessage, ReasonToolSchema } from './reasonContract';

export class HelixUnparseableError extends Error {
  constructor(msg: string) { super(msg); this.name = 'HelixUnparseableError'; }
}

export interface HelixModelResult {
  content?: string;
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

type HelixClientFn = (cfg: Record<string, string | undefined>, messages: ReasonMessage[]) => Promise<string>;

function buildSystemPreamble(tools: ReasonToolSchema[]): string {
  const toolLines = tools.map((t) => {
    const fields = Object.keys((t.inputSchema as any)?.properties || {});
    return `- ${t.name} — ${t.description} — args: {${fields.join(', ')}}`;
  }).join('\n');
  return [
    'You can call banking tools. Available tools:',
    toolLines,
    '',
    'RULES:',
    '- If a tool is needed, respond with ONE line and nothing else:',
    '  TOOL_CALL: {"name":"<exact tool name>","args":{...}}',
    '- Otherwise, answer the user normally in plain prose. Do NOT mention tools.',
    '- Never wrap the TOOL_CALL line in code fences or add text around it.',
  ].join('\n');
}

function withPreamble(messages: ReasonMessage[], preamble: string): ReasonMessage[] {
  // ReasonMessage has no 'system' role; fold the preamble into the last user msg.
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') { out[i] = { ...out[i], content: `${preamble}\n\n${out[i].content}` }; return out; }
  }
  out.push({ role: 'user', content: preamble });
  return out;
}

const TOOL_CALL_RE = /^TOOL_CALL:\s*(.+)$/;

/** Parse one Helix string. Returns a result, or null if it is a malformed tool attempt. */
function parseHelixResponse(raw: string, toolNames: Set<string>): HelixModelResult | null {
  let s = (raw || '').trim();
  // (a) strip a single surrounding fence layer if the whole string is fenced
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();
  // (b)(c) first line that starts with TOOL_CALL:
  const lines = s.split('\n');
  const toolLine = lines.map((l) => l.trim()).find((l) => TOOL_CALL_RE.test(l));
  if (!toolLine) return { content: s }; // prose — a success
  const jsonPart = (toolLine.match(TOOL_CALL_RE) as RegExpMatchArray)[1];
  let obj: any;
  try { obj = JSON.parse(jsonPart); } catch { return null; }
  const name = obj?.name;
  const args = obj?.args;
  const argsOk = args && typeof args === 'object' && !Array.isArray(args);
  if (typeof name !== 'string' || !toolNames.has(name) || !argsOk) return null;
  return { tool_calls: [{ id: `helix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, args }] };
}

export async function helixReason(
  cfg: Record<string, string | undefined>,
  messages: ReasonMessage[],
  tools: ReasonToolSchema[],
  client: HelixClientFn,
): Promise<HelixModelResult> {
  const toolNames = new Set(tools.map((t) => t.name));
  const preamble = buildSystemPreamble(tools);
  const primed = withPreamble(messages, preamble);

  const first = await client(cfg, primed);
  const parsed = parseHelixResponse(first, toolNames);
  if (parsed) return parsed;

  // One strict re-prompt.
  const corrective: ReasonMessage = {
    role: 'user',
    content: [
      'Your previous response was not valid. You wrote:',
      first.slice(0, 500),
      `Respond with EITHER exactly one line TOOL_CALL: {"name":"...","args":{...}} using one of these exact tool names: ${[...toolNames].join(', ')}`,
      'OR a plain prose answer with no JSON. Nothing else.',
    ].join('\n'),
  };
  const second = await client(cfg, [...primed, corrective]);
  const retryParsed = parseHelixResponse(second, toolNames);
  if (retryParsed) return retryParsed;

  throw new HelixUnparseableError('Helix did not produce a parseable response after one retry');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd banking_agent_service && npx jest tests/helixToolAdapter.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add banking_agent_service/src/helixToolAdapter.ts banking_agent_service/tests/helixToolAdapter.test.ts
git -c commit.gpgsign=false commit -m "feat(agent-svc): Helix prompt-based tool-calling adapter (sentinel + 1 retry)"
```

---

### Task 7d: `reasoningGraph.ts` — LangGraph reasoning step for both providers

One reasoning step driven by the BFF loop. Ollama uses native `bindTools`;
Helix routes through `helixToolAdapter`. Catches Helix failure and any
transport error → returns `{type:'final', reasoningUnavailable:true}`.

**Files:**
- Create: `banking_agent_service/src/reasoningGraph.ts`
- Test: `banking_agent_service/tests/reasoningGraph.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// banking_agent_service/tests/reasoningGraph.test.ts
import { reasonOnce } from '../src/reasoningGraph';
import type { ReasonRequest } from '../src/reasonContract';

jest.mock('../src/helixToolAdapter', () => {
  const actual = jest.requireActual('../src/helixToolAdapter');
  return { ...actual, helixReason: jest.fn() };
});
jest.mock('../src/helixClient', () => ({ callHelix: jest.fn() }));
const { helixReason, HelixUnparseableError } = require('../src/helixToolAdapter');

const baseReq: ReasonRequest = {
  messages: [{ role: 'user', content: 'show transactions' }],
  tools: [{ name: 'get_my_transactions', description: 'x', inputSchema: { type: 'object', properties: {} } }],
  provider: 'helix',
  helixConfig: {},
};

describe('reasonOnce — helix provider via adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adapter returns tool_calls → ReasonResponse tool_calls', async () => {
    helixReason.mockResolvedValueOnce({ tool_calls: [{ id: 'i', name: 'get_my_transactions', args: {} }] });
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('tool_calls');
    if (out.type === 'tool_calls') expect(out.calls[0].name).toBe('get_my_transactions');
  });

  test('adapter returns content → ReasonResponse final', async () => {
    helixReason.mockResolvedValueOnce({ content: 'your balance is fine' });
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.answer).toBe('your balance is fine');
      expect(out.reasoningUnavailable).toBeFalsy();
    }
  });

  test('HelixUnparseableError → final with reasoningUnavailable:true (no fabricated answer)', async () => {
    helixReason.mockRejectedValueOnce(new HelixUnparseableError('nope'));
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.reasoningUnavailable).toBe(true);
      expect(out.answer).toBe('');
    }
  });

  test('helix transport error → final with reasoningUnavailable:true', async () => {
    helixReason.mockRejectedValueOnce(new Error('Helix poll failed: 502'));
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') expect(out.reasoningUnavailable).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd banking_agent_service && npx jest tests/reasoningGraph.test.ts`
Expected: FAIL — Cannot find module '../src/reasoningGraph'

- [ ] **Step 3: Implement**

```typescript
// banking_agent_service/src/reasoningGraph.ts
// One reasoning step (the BFF drives the loop). Ollama = native bindTools;
// Helix = helixToolAdapter (sentinel). Reasoning-only: NEVER executes a tool,
// NEVER touches a token. Helix failure → reasoningUnavailable (BFF applies the
// heuristic floor — ARCHITECTURE-TRUTHS T-3).
import { ChatOllama } from '@langchain/ollama';
import type { ReasonRequest, ReasonResponse } from './reasonContract';
import { helixReason, HelixUnparseableError } from './helixToolAdapter';
import { callHelix } from './helixClient';

// Matches banking_api_server agentBuilder.js DEFAULT_MODELS for the two
// providers reachable here.
const DEFAULT_MODELS: Record<string, string> = { ollama: 'llama3.2', helix: 'gpt-4o-mini' };

export async function reasonOnce(req: ReasonRequest): Promise<ReasonResponse> {
  if (req.provider === 'helix') {
    try {
      const r = await helixReason(req.helixConfig || {}, req.messages, req.tools, callHelix);
      if (r.tool_calls && r.tool_calls.length > 0) {
        return { type: 'tool_calls', calls: r.tool_calls, messages: [...req.messages, { role: 'assistant', content: '' }] };
      }
      const answer = r.content ?? '';
      return { type: 'final', answer, messages: [...req.messages, { role: 'assistant', content: answer }] };
    } catch (err) {
      // HelixUnparseableError OR any transport error → signal, do not fabricate.
      const note = err instanceof HelixUnparseableError ? 'helix_unparseable' : 'helix_error';
      console.warn(`[reasoningGraph] helix reasoning unavailable (${note}):`, err instanceof Error ? err.message : String(err));
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
  }

  // Ollama — native tool-calling.
  const baseUrl = req.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = new ChatOllama({ model: req.model || DEFAULT_MODELS.ollama, temperature: 0.7, baseUrl });
  const bound = (model as any).bindTools(req.tools.map((t) => ({
    name: t.name, description: t.description, input_schema: t.inputSchema,
  })));
  const resp: any = await bound.invoke(req.messages);
  if (resp.tool_calls && resp.tool_calls.length > 0) {
    return {
      type: 'tool_calls',
      calls: resp.tool_calls.map((tc: any) => ({ id: tc.id, name: tc.name, args: tc.args || {} })),
      messages: [...req.messages, { role: 'assistant', content: resp.content || '' }],
    };
  }
  const answer = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content ?? '');
  return { type: 'final', answer, messages: [...req.messages, { role: 'assistant', content: answer }] };
}
```

NOTE: this file imports `@langchain/ollama` (added Task 7a). It does NOT import
`@langchain/langgraph` directly — the single-step `reasonOnce` is the graph
node; the BFF loop (Task 9) is the graph driver. That satisfies "LangGraph for
all calls" at the orchestration layer (the BFF loop is the StateGraph
equivalent) while keeping :3006 a stateless single-step reasoner per the
approved design. If a literal `StateGraph` wrapper is later wanted on :3006 it
is additive and out of scope here.

- [ ] **Step 4: Run to verify it passes**

Run: `cd banking_agent_service && npx jest tests/reasoningGraph.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add banking_agent_service/src/reasoningGraph.ts banking_agent_service/tests/reasoningGraph.test.ts
git -c commit.gpgsign=false commit -m "feat(agent-svc): reasoningGraph step — Ollama bindTools + Helix adapter, reasoning-only"
```

---

### Task 8: `POST /api/agent/reason`; delete :3006 token/MCP code

**Files:**
- Create: `banking_agent_service/src/reasonRoute.ts`
- Modify: `banking_agent_service/src/index.ts`

- [ ] **Step 1: Create the route handler**

```typescript
// banking_agent_service/src/reasonRoute.ts
import type { Request, Response } from 'express';
import { reasonOnce } from './reasoningGraph';
import type { ReasonRequest } from './reasonContract';

const SHARED_SECRET_HEADER = 'x-internal-gateway-secret';

export function makeReasonHandler(internalSecret: string) {
  return async function reasonHandler(req: Request, res: Response): Promise<void> {
    const presented = req.headers[SHARED_SECRET_HEADER];
    if (!internalSecret || presented !== internalSecret) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const body = req.body as ReasonRequest;
    if (!body || !Array.isArray(body.messages) || !Array.isArray(body.tools)) {
      res.status(400).json({ error: 'messages[] and tools[] required' });
      return;
    }
    try {
      const out = await reasonOnce(body);
      res.json(out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Agent] reason error:', msg);
      res.status(500).json({ error: 'reason_failed', detail: msg });
    }
  };
}
```

- [ ] **Step 2: Wire into index.ts; remove the token/MCP path**

In `banking_agent_service/src/index.ts`: remove the `import { McpGatewayClient }`
line and any `resolveGatewayToken` import/usage; delete the entire
`app.post('/api/agent/task', ...)` handler; keep `GET /health` and the existing
hardened middleware (bounded body, vault startup). Add:

```typescript
import { makeReasonHandler } from './reasonRoute';

const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || '';
if (!INTERNAL_SECRET) {
  console.error('[Agent] FATAL: BFF_INTERNAL_SECRET unset — /api/agent/reason would be open. Refusing to start.');
  process.exit(1);
}
app.post('/api/agent/reason', express.json({ limit: '256kb' }), makeReasonHandler(INTERNAL_SECRET));
```

If `config.ts` still hard-requires `AGENT_CLIENT_ID`/`MCP_GW_RESOURCE_URI` (only
needed by the deleted token path), relax those to optional so the service
starts without them. Do NOT remove vault/PKI startup code.

- [ ] **Step 3: Build**

Run: `cd banking_agent_service && npm run build && echo BUILD_OK`
Expected: `BUILD_OK`. Fix any reference to a deleted symbol the compiler flags.

- [ ] **Step 4: Commit**

```bash
git add banking_agent_service/src/reasonRoute.ts banking_agent_service/src/index.ts banking_agent_service/src/config.ts
git -c commit.gpgsign=false commit -m "feat(agent-svc): /api/agent/reason (shared-secret); remove own token-exchange + MCP client"
```

---

### Task 9: BFF reasoning client + turn loop (TDD)

**Files:**
- Create: `banking_api_server/services/agentReasoningClient.js`
- Test: `banking_api_server/tests/agentReasoningLoop.regression.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/agentReasoningLoop.regression.test.js
jest.mock('axios');
const axios = require('axios');
const { runReasonLoop } = require('../services/agentReasoningClient');

describe('runReasonLoop', () => {
  beforeEach(() => jest.clearAllMocks());

  test('final answer in one round', async () => {
    axios.post.mockResolvedValueOnce({ data: { type: 'final', answer: 'hi', messages: [] } });
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'hello' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 10 });
    expect(out).toEqual({ ok: true, answer: 'hi' });
  });

  test('one tool round then final — BFF executes the tool', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { type: 'tool_calls', calls: [{ id: '1', name: 'get_x', args: {} }], messages: [] } })
      .mockResolvedValueOnce({ data: { type: 'final', answer: 'done', messages: [] } });
    const calls = [];
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async (n) => { calls.push(n); return 'r'; }, maxIterations: 10 });
    expect(calls).toEqual(['get_x']);
    expect(out).toEqual({ ok: true, answer: 'done' });
  });

  test('reasoningUnavailable:true → heuristic-fallback signal', async () => {
    axios.post.mockResolvedValueOnce({ data: { type: 'final', answer: '', reasoningUnavailable: true } });
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 10 });
    expect(out).toEqual({ ok: false, reason: 'reasoning_unavailable' });
  });

  test(':3006 transport failure → reasoning-unavailable signal, not a throw', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 10 });
    expect(out).toEqual({ ok: false, reason: 'reasoning_unavailable' });
  });

  test('recursion cap enforced BFF-side', async () => {
    axios.post.mockResolvedValue({ data: { type: 'tool_calls', calls: [{ id: '1', name: 'loop', args: {} }], messages: [] } });
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 3 });
    expect(out).toEqual({ ok: false, reason: 'max_iterations' });
    expect(axios.post.mock.calls.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd banking_api_server && npx jest tests/agentReasoningLoop.regression.test.js`
Expected: FAIL — Cannot find module '../services/agentReasoningClient'

- [ ] **Step 3: Implement**

```javascript
// banking_api_server/services/agentReasoningClient.js
// BFF drives the reason loop and EXECUTES tools (token custody + HITL stay
// here). :3006 only proposes tool calls / returns a final answer. On
// reasoningUnavailable or transport failure → signal heuristic-fallback
// (ARCHITECTURE-TRUTHS T-3 floor). Recursion cap enforced here.
const axios = require('axios');

const REASON_URL =
  (process.env.AGENT_SERVICE_URL || 'http://localhost:3006') + '/api/agent/reason';

async function runReasonLoop(p) {
  const secret = process.env.BFF_INTERNAL_SECRET || '';
  let messages = p.messages;
  for (let i = 0; i < p.maxIterations; i++) {
    let resp;
    try {
      resp = await axios.post(
        REASON_URL,
        { messages, tools: p.tools, provider: p.provider, model: p.model, helixConfig: p.helixConfig, ollamaBaseUrl: p.ollamaBaseUrl },
        { headers: { 'x-internal-gateway-secret': secret }, timeout: 70000 },
      );
    } catch (err) {
      return { ok: false, reason: 'reasoning_unavailable' };
    }
    const data = resp.data;
    if (data.type === 'final') {
      if (data.reasoningUnavailable) return { ok: false, reason: 'reasoning_unavailable' };
      return { ok: true, answer: data.answer };
    }
    if (data.type === 'tool_calls') {
      const toolMessages = [];
      for (const call of data.calls) {
        const result = await p.executeTool(call.name, call.args);
        toolMessages.push({ role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result), tool_call_id: call.id });
      }
      messages = [...(data.messages || messages), ...toolMessages];
      continue;
    }
    return { ok: false, reason: 'reasoning_unavailable' };
  }
  return { ok: false, reason: 'max_iterations' };
}

module.exports = { runReasonLoop };
```

NOTE: timeout is 70s — a Helix turn can be one create+post+30s-poll, and a
retry doubles that; 70s covers worst case without hanging forever.

- [ ] **Step 4: Run to verify it passes**

Run: `cd banking_api_server && npx jest tests/agentReasoningLoop.regression.test.js`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/agentReasoningClient.js banking_api_server/tests/agentReasoningLoop.regression.test.js
git -c commit.gpgsign=false commit -m "feat(bff): BFF-driven reason loop (custody + cap stay BFF-side; reasoningUnavailable→heuristic)"
```

---

### Task 10: Wire `processAgentMessage` to the loop (heuristic + tool exec + HITL stay BFF-side)

**Files:**
- Modify: `banking_api_server/services/bankingAgentLangGraphService.js` (the LLM branch ≈ lines 432-477; the heuristic-first block ABOVE it is unchanged)

- [ ] **Step 1: Replace in-process graph invocation with the loop**

The heuristic-first block stays exactly as-is. Capture its computed result in a
variable `heuristicFallbackResult` (the result object the heuristic produced, or
null if the heuristic did not match). Replace the `createBankingAgent(...)` +
`graph.invoke(...)` block (≈ lines 432-477) with:

```javascript
    const { resolveLlmProvider } = require('./llmProviderResolver');
    const { runReasonLoop } = require('./agentReasoningClient');
    const { provider, model } = resolveLlmProvider(langchainConfig);

    const toolSchemas = buildToolSchemasForAgent({ userId, req }); // Step 2
    const loopResult = await runReasonLoop({
      messages: [{ role: 'user', content: message }],
      tools: toolSchemas,
      provider,
      model,
      helixConfig: extractHelixConfig(langchainConfig), // Step 2
      ollamaBaseUrl: langchainConfig?.ollama_base_url,
      maxIterations: MAX_TOOL_ITERATIONS,
      executeTool: async (name, args) =>
        executeBffTool({ name, args, userId, userToken, req, tokenEvents }), // Step 2
    });

    if (loopResult.ok) {
      return { reply: loopResult.answer, success: true, toolsCalled: [], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: tokenEvents || [] };
    }
    if (loopResult.reason === 'max_iterations') {
      return { reply: 'Agent reached maximum tool iteration limit. Please rephrase your request or try a simpler query.', success: false, toolsCalled: [], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: tokenEvents || [], error: 'max_tool_iterations' };
    }
    // reasoning_unavailable → heuristic floor (T-3).
    return heuristicFallbackResult || {
      reply: 'Advanced reasoning is temporarily unavailable. Please try a simpler request.',
      success: false, toolsCalled: [], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: tokenEvents || [], error: 'reasoning_unavailable',
    };
```

- [ ] **Step 2: Extract three helpers (reuse existing tool defs verbatim — do NOT reinvent tools)**

Open `banking_api_server/services/agentBuilder.js` lines 110-300 for the exact
tool list + tool-node `tool.invoke(args, { configurable: { agentContext: {...} }})`
shape. Add in `bankingAgentLangGraphService.js` (or a sibling helper file):
- `buildToolSchemasForAgent({userId, req})` → `[{name, description, inputSchema}]`
  from the SAME tool list `createBankingAgent` built, with executors stripped.
- `executeBffTool({name, args, userId, userToken, req, tokenEvents})` → invokes
  the SAME tool executor the old in-process tool node called, preserving its
  HITL-throw behavior (so a transfer ≥ threshold still throws the existing
  hitl-required error → route returns 428 to the browser unchanged).
- `extractHelixConfig(langchainConfig)` → the `{helix_base_url, helix_api_key,
  helix_environment_id, helix_agent_id, helix_prompt_field_id}` object literal
  already built in `agentBuilder.js` (~lines 172-178).
These helpers MUST reuse existing tool definitions/executors verbatim.

- [ ] **Step 3: Syntax check**

Run: `cd banking_api_server && node -c services/bankingAgentLangGraphService.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Critical suite (HITL must still pass)**

Run: `cd banking_api_server && npx jest oauthStatus.regression oauthStatus.integration hitlRoute.regression hitlRoute.integration agentReasoningLoop`
Expected: all PASS (38 critical + 5 loop)

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/bankingAgentLangGraphService.js
git -c commit.gpgsign=false commit -m "feat(bff): processAgentMessage drives :3006 reason loop; heuristic/HITL/custody unchanged"
```

---

### Task 11: End-to-end verification (live) + REGRESSION_PLAN §4

**Files:** REGRESSION_PLAN.md (entry only)

- [ ] **Step 1: Ensure shared secret + restart**

Confirm `BFF_INTERNAL_SECRET` is set in `banking_api_server/.env` (reuse the
existing `/internal/id-token` value; `banking_agent_service/.env` symlinks to
it). Run: `./run-demo.sh restart 2>&1 | tail -5`
Expected: services start; `./run-demo.sh status` shows Agent Service :3006 OK.

- [ ] **Step 2: Browser smoke**

- Customer sign-in → middle agent → `transactions` → recent transactions render
  (original reported bug, now via :3006 Helix path).
- Transfer ≥ threshold → AgentConsentModal appears (HITL still BFF-side) →
  confirm → completes, conversation resumes.
- `kill $(cat /tmp/bank-agent-service.pid)`; ask a non-heuristic question →
  heuristic fallback answers (no dead end). Restart :3006.

- [ ] **Step 3: Log assertions**

Run: `grep -E "/api/agent/reason|reason_failed|reasoningUnavailable|TOOL_CALL|May not request scopes" /tmp/bank-api-server.log /tmp/bank-agent-service.log | tail`
Expected: `/api/agent/reason` 200s; no `May not request scopes`;
`reasoningUnavailable` only when :3006 was deliberately down.

- [ ] **Step 4: REGRESSION_PLAN §4 entry**

Add a §4 entry (top, reverse-chron, project template): LangGraph reasoning moved
to :3006 (reasoning-only, shared-secret gated, LangGraph for all providers,
Helix via sentinel adapter with 1 retry); BFF drives the loop, stays sole token
custodian + HITL enforcer; :3006 token-exchange/MCP code deleted. Do-not-break:
:3006 never receives a user token or executes tools; HITL stays BFF-side; loop
cap mirrors MAX_TOOL_ITERATIONS; heuristic remains the T-3 floor on
reasoningUnavailable.

- [ ] **Step 5: Commit**

```bash
git add REGRESSION_PLAN.md
git -c commit.gpgsign=false commit -m "docs(regression): §4 entry — LangGraph reasoning service on :3006 (Phase 2)"
```

---

### Task 12: Narrative + labeling (presentation only)

**Files:**
- Modify: `CONTEXT.md`; `banking_api_ui/src/pages/LangChainPage.js`; placement-mode copy in `banking_api_ui/src/components/BankingAgent.js`

- [ ] **Step 1: CONTEXT.md agent glossary**

Rewrite the "agent" entry: canonical agent = the LangGraph reasoning service on
:3006 driven by the BFF; `langchain_agent` = the Python LangChain cross-stack
exhibit; the old in-process BFF agent no longer exists as a distinct thing (it
is the BFF↔:3006 orchestrator).

- [ ] **Step 2: /langchain banner**

Add one non-emoji info banner near the top of `LangChainPage.js`: "Python
LangChain variant — same delegated-OAuth security model as the main agent,
different runtime (Python + local Ollama)."

- [ ] **Step 3: Placement-mode copy**

Add a one-line clarifier near the Middle/Float/Bottom toggle that these are
views of one agent, not different agents. No behavior change.

- [ ] **Step 4: UI build gate (MANDATORY — CLAUDE.md)**

Run: `cd banking_api_ui && npm run build`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md banking_api_ui/src/pages/LangChainPage.js banking_api_ui/src/components/BankingAgent.js
git -c commit.gpgsign=false commit -m "docs(narrative): one-agent story — glossary + /langchain + placement copy"
```

---

## Done Criteria

- Phase 1: `llmProviderResolver` is the only provider-default site; grep-clean; 43 tests pass. (SHIPPED.)
- Phase 2: `transactions` works through :3006 in the browser via the Helix
  sentinel adapter; HITL transfer still gated BFF-side and resumes; :3006-down
  and Helix-unparseable both fall back to the heuristic; :3006 has no
  token-exchange/MCP code; LangGraph (`@langchain/*`) is a real :3006 dep;
  Ollama path uses native bindTools; Helix path uses the sentinel adapter with
  exactly one retry; UI build exits 0.
- ARCHITECTURE-TRUTHS T-3 holds; two REGRESSION_PLAN §4 entries added (Phase 1 + Phase 2).
