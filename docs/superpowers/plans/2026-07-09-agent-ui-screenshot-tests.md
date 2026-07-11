# Agent UI Screenshot Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Google/Gemini agent provider, then produce real-UI (no-mock) side-by-side screenshot documentation of the Agent UI response across all four LLM modes (llama.cpp, Claude, Helix, Google) for the four core verticals (banking, retail, healthcare, investment).

**Architecture:** Phase 1 adds `google` as a first-class provider in `demo_agent_service` (mirroring the existing `llamacpp` branch via `@langchain/google-genai`) and threads it through config + UI/server mode tables. Phases 2–5 build a reusable Playwright harness that sets the agent mode via `POST /api/langchain/config`, drives a use-case chip in the live UI, screenshots the agent panel per mode, and asserts in-domain content. Phase 6 assembles the screenshots into a master markdown comparison doc.

**Tech Stack:** TypeScript (`demo_agent_service`, jest + ts-jest), Node/Express (`demo_api_server` BFF), React (`demo_api_ui`), Playwright (`@playwright/test`, `playwright.real.config.js`), `@langchain/google-genai`.

## Global Constraints

- **Work in the worktree only:** `.claude/worktrees/agent-ui-screenshot-tests` on branch `feat/agent-ui-screenshot-tests`. Never edit the main checkout (a hard-block hook denies it). Stage explicitly with `git add <files>`, never `git add -A`. Verify `git branch --show-current` before each commit.
- **Emoji rule:** the only emojis allowed anywhere are `⚠️` `✅` `❌` `🔐` `✕` `✓`. Everything else is plain text.
- **Minimal diff:** name the component, name the element, change only that. No "while I'm here" cleanup.
- **No mocks in the screenshot phases:** Phases 2–5 drive the real UI against a live BFF session. Only Phase 1 unit tests mock the LLM client.
- **Drift guard is authoritative:** `demo_api_ui/src/config/agentModes.js` and `demo_api_server/services/agentModeResolver.js` MUST stay in sync — `demo_api_ui/src/config/__tests__/agentModes.test.js` fails the build otherwise. Update both together.
- **Provider-down = skip loudly:** a mode whose provider is unconfigured/unreachable is recorded as a visible "skipped" cell in the doc, never silently omitted.
- **Gemini default model:** `gemini-2.0-flash`. Env key: `GOOGLE_API_KEY` (Google AI Studio `AIza…` key), optional override `GOOGLE_MODEL`.

---

## File Structure

**Phase 1 — Google provider (all in `demo_agent_service` + two mode tables):**
- Modify: `demo_agent_service/package.json` — add `@langchain/google-genai` dependency
- Modify: `demo_agent_service/src/reasonContract.ts` — add `google` to provider union + `googleApiKey?`
- Modify: `demo_agent_service/src/reasoningGraph.ts` — add `DEFAULT_MODELS.google` + `google` branch in `reasonOnce`
- Modify: `demo_agent_service/src/agentRunHandler.ts:347-353` — pass `googleApiKey`, widen provider cast
- Modify: `demo_agent_service/src/config.ts` — add `google` to `VALID_LLM_PROVIDERS` + `llmProvider` type
- Modify: `demo_api_ui/src/config/agentModes.js` — add Google mode row
- Modify: `demo_api_server/services/agentModeResolver.js` — add Google mode row
- Create: `demo_agent_service/tests/googleProvider.test.ts` — unit tests for the branch
- (No change needed: `demo_api_server/services/llmProviderStatus.js` already handles `google` — line 49)

**Phases 2–6 — Screenshot harness + docs (all under one folder):**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js` — reusable harness
- Create: `demo_api_ui/tests/e2e/agent-screenshots/banking-screenshots.real.spec.js`
- Create: `demo_api_ui/tests/e2e/agent-screenshots/retail-screenshots.real.spec.js`
- Create: `demo_api_ui/tests/e2e/agent-screenshots/healthcare-screenshots.real.spec.js`
- Create: `demo_api_ui/tests/e2e/agent-screenshots/investment-screenshots.real.spec.js`
- Create: `demo_api_ui/tests/e2e/agent-screenshots/build-doc.js` — assembles README.md from capture manifests
- Create (generated): `demo_api_ui/tests/e2e/agent-screenshots/__screenshots__/<vertical>/<chip>/<mode>.png`
- Create (generated): `demo_api_ui/tests/e2e/agent-screenshots/README.md` — master comparison doc

---

## PHASE 1 — Build Google/Gemini provider + validate all 4 modes

### Task 1: Add `@langchain/google-genai` dependency

**Files:**
- Modify: `demo_agent_service/package.json`

**Interfaces:**
- Produces: `ChatGoogleGenerativeAI` importable from `@langchain/google-genai` (same `.bindTools()` / `.invoke()` interface as `ChatOpenAI`).

- [ ] **Step 1: Install the dependency**

Run from the worktree:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_agent_service
npm install @langchain/google-genai
```
Expected: `package.json` gains `"@langchain/google-genai": "^<version>"` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Verify it imports**

Run:
```bash
node -e "const {ChatGoogleGenerativeAI}=require('@langchain/google-genai'); console.log(typeof ChatGoogleGenerativeAI)"
```
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add demo_agent_service/package.json demo_agent_service/package-lock.json
git commit -m "build(agent-service): add @langchain/google-genai for Gemini provider"
```

---

### Task 2: Extend the reason contract for `google`

**Files:**
- Modify: `demo_agent_service/src/reasonContract.ts`

**Interfaces:**
- Produces: `ReasonRequest.provider` now includes `'google'`; new optional `ReasonRequest.googleApiKey?: string`. Consumed by Task 3 (`reasonOnce`) and Task 4 (`agentRunHandler`).

- [ ] **Step 1: Add `google` to the provider union and add the key field**

In `demo_agent_service/src/reasonContract.ts`, change the `provider` line (currently line 20) and add a field after `anthropicApiKey` (line 27):

```typescript
  provider: 'helix' | 'anthropic' | 'anthropic-lmstudio' | 'lmstudio' | 'llamacpp' | 'google'; // already resolved by the BFF
```

and after the `anthropicApiKey?: string;` line, add:

```typescript
  // Google (Gemini) — API key passed from BFF/agent env; never a user token
  googleApiKey?: string;
```

- [ ] **Step 2: Verify it typechecks**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_agent_service
npx tsc --noEmit
```
Expected: no new errors from `reasonContract.ts` (there will be an error in `reasoningGraph.ts` only if you already started Task 3 — otherwise clean).

- [ ] **Step 3: Commit**

```bash
git add demo_agent_service/src/reasonContract.ts
git commit -m "feat(agent-service): add google to ReasonRequest provider union"
```

---

### Task 3: Implement the `google` branch in `reasonOnce`

**Files:**
- Modify: `demo_agent_service/src/reasoningGraph.ts`
- Test: `demo_agent_service/tests/googleProvider.test.ts`

**Interfaces:**
- Consumes: `ReasonRequest` (with `provider: 'google'`, `googleApiKey`, `model?`) from Task 2.
- Produces: a `reasonOnce` that, for `provider === 'google'`, returns a `ReasonResponse` of `type: 'tool_calls'` (when Gemini emits tool calls) or `type: 'final'` (prose). Same shape as the llamacpp branch.

- [ ] **Step 1: Write the failing test**

Create `demo_agent_service/tests/googleProvider.test.ts`:

```typescript
// banking_agent_service/tests/googleProvider.test.ts
// Unit tests for the Gemini (google) provider branch in reasonOnce.
// The @langchain/google-genai client is mocked so the test is deterministic
// and requires no network / API key.

const mockInvoke = jest.fn();
const mockBindTools = jest.fn(() => ({ invoke: mockInvoke }));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    bindTools: mockBindTools,
    invoke: mockInvoke,
  })),
}));

import { reasonOnce } from '../src/reasoningGraph';
import type { ReasonRequest } from '../src/reasonContract';

const TOOLS = [
  { name: 'get_my_accounts', description: 'List the customer bank accounts', inputSchema: { type: 'object', properties: {} } },
];

function baseReq(overrides: Partial<ReasonRequest> = {}): ReasonRequest {
  return {
    messages: [{ role: 'user', content: 'show my accounts' }],
    tools: TOOLS,
    provider: 'google',
    googleApiKey: 'AIza-test-key',
    ...overrides,
  };
}

describe('reasonOnce — google (Gemini) provider', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockBindTools.mockClear();
  });

  test('returns tool_calls when Gemini emits a tool call', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: '',
      tool_calls: [{ id: 'g1', name: 'get_my_accounts', args: {} }],
      usage_metadata: { input_tokens: 12, output_tokens: 3 },
    });
    const out = await reasonOnce(baseReq());
    expect(out.type).toBe('tool_calls');
    if (out.type === 'tool_calls') {
      expect(out.calls[0].name).toBe('get_my_accounts');
    }
  });

  test('returns final prose when Gemini emits no tool call', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: 'Here are your accounts.',
      tool_calls: [],
      usage_metadata: { input_tokens: 10, output_tokens: 5 },
    });
    const out = await reasonOnce(baseReq());
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.answer).toBe('Here are your accounts.');
    }
  });

  test('missing API key → reasoningUnavailable, never fabricates', async () => {
    const out = await reasonOnce(baseReq({ googleApiKey: '' }));
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.reasoningUnavailable).toBe(true);
      expect(out.answer).toBe('');
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_agent_service
npx jest tests/googleProvider.test.ts
```
Expected: FAIL — the `google` branch does not exist yet, so `reasonOnce` falls through to "unknown provider" and returns `reasoningUnavailable` for the tool_calls/final cases (first two tests fail; the third passes coincidentally).

- [ ] **Step 3: Add the `google` default model**

In `demo_agent_service/src/reasoningGraph.ts`, extend `DEFAULT_MODELS` (currently lines 55–61) by adding a `google` entry:

```typescript
const DEFAULT_MODELS: Record<string, string> = {
  helix: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  // llama-server serves whatever model it was launched with; this is only a
  // last-resort fallback when /v1/models can't be reached and no env override.
  llamacpp: 'local-model',
  google: 'gemini-2.0-flash',
};
```

- [ ] **Step 4: Add the import**

At the top of `demo_agent_service/src/reasoningGraph.ts`, after the `ChatOpenAI` import (line 9), add:

```typescript
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
```

- [ ] **Step 5: Add the `google` branch**

In `demo_agent_service/src/reasoningGraph.ts`, insert this block immediately **after** the closing brace of the `llamacpp` branch (after line 314, before the `// Unknown provider` comment on line 316). It mirrors the llamacpp branch, swapping the client and reading the key from `req.googleApiKey`/env:

```typescript
  if (req.provider === 'google') {
    // Google Gemini via @langchain/google-genai. Same bindTools/invoke shape as
    // the llama.cpp (ChatOpenAI) path. Key comes from the BFF/agent env, never a
    // user token. Missing key → reasoningUnavailable (BFF applies heuristic floor).
    const apiKey = req.googleApiKey || process.env.GOOGLE_API_KEY || '';
    if (!apiKey) {
      teachLog.error('Google API key missing', null, { operation: 'reasonOnce' });
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
    try {
      const model = req.model || process.env.GOOGLE_MODEL || DEFAULT_MODELS.google;
      const llm = new ChatGoogleGenerativeAI({ model, temperature: 0, apiKey });
      const withTools = req.tools.length > 0
        ? llm.bindTools(req.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })))
        : llm;
      const response = await withTools.invoke(toLangChainMessages(req.messages, req.systemPrompt));
      const text = stripThink(extractTextContent(response.content));
      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length > 0) {
        const calls = toolCalls.map((tc) => ({
          id: tc.id ?? `google-${crypto.randomUUID()}`,
          name: tc.name,
          args: (tc.args ?? {}) as Record<string, unknown>,
        }));
        const assistantMsg: ReasonMessage = {
          role: 'assistant',
          content: text,
          tool_calls: calls,
        };
        return { type: 'tool_calls', calls, messages: [...req.messages, assistantMsg] };
      }
      return {
        type: 'final',
        answer: text,
        messages: [...req.messages, { role: 'assistant', content: text }],
        inputTokens: response.usage_metadata?.input_tokens,
        outputTokens: response.usage_metadata?.output_tokens,
      };
    } catch (err) {
      teachLog.error('Google (Gemini) reasoning step failed', err, { operation: 'reasonOnce' });
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_agent_service
npx jest tests/googleProvider.test.ts
```
Expected: PASS (3/3).

- [ ] **Step 7: Verify no typecheck regressions**

Run:
```bash
npx tsc --noEmit
```
Expected: clean (no errors in `reasoningGraph.ts`).

- [ ] **Step 8: Commit**

```bash
git add demo_agent_service/src/reasoningGraph.ts demo_agent_service/tests/googleProvider.test.ts
git commit -m "feat(agent-service): implement Gemini (google) provider branch in reasonOnce"
```

---

### Task 4: Thread `googleApiKey` + `google` provider through `agentRunHandler`

**Files:**
- Modify: `demo_agent_service/src/agentRunHandler.ts:347-353`

**Interfaces:**
- Consumes: `reasonOnce` from Task 3.
- Produces: the AG-UI streaming path can drive Gemini when the resolved provider is `google`.

- [ ] **Step 1: Widen the provider cast and pass the Google key**

In `demo_agent_service/src/agentRunHandler.ts`, change the `reasonOnce({...})` call (lines 347–353) to include `'google'` in the cast union and pass `googleApiKey`:

```typescript
        reasonResult = await reasonOnce({
          messages: conversationMessages,
          tools,
          provider: (provider ?? process.env.AGENT_PROVIDER ?? 'anthropic') as 'anthropic' | 'helix' | 'anthropic-lmstudio' | 'lmstudio' | 'llamacpp' | 'google',
          model,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          googleApiKey: process.env.GOOGLE_API_KEY,
        });
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_agent_service
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Run the agent-service test suite**

Run:
```bash
npx jest
```
Expected: all pass (no regressions; new googleProvider tests green).

- [ ] **Step 4: Commit**

```bash
git add demo_agent_service/src/agentRunHandler.ts
git commit -m "feat(agent-service): pass GOOGLE_API_KEY + google provider through agentRunHandler"
```

---

### Task 5: Register `google` in config validation + both mode tables

**Files:**
- Modify: `demo_agent_service/src/config.ts`
- Modify: `demo_api_server/services/agentModeResolver.js`
- Modify: `demo_api_ui/src/config/agentModes.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `google` accepted as a valid `LLM_PROVIDER`; a `google` agent mode selectable in the UI and resolvable server-side. The drift-guard test (`agentModes.test.js`) passes with both tables in sync.

- [ ] **Step 1: Add `google` to the agent-service config validator**

In `demo_agent_service/src/config.ts`, add `'google'` to the `llmProvider` type (line 20) and to `VALID_LLM_PROVIDERS` (lines 52–58):

```typescript
  llmProvider: 'openai' | 'anthropic' | 'helix' | 'llamacpp' | 'google' | 'none';
```

```typescript
const VALID_LLM_PROVIDERS: ReadonlyArray<AgentConfig['llmProvider']> = [
  'openai',
  'anthropic',
  'helix',
  'llamacpp',
  'google',
  'none',
];
```

- [ ] **Step 2: Add the server-side mode row**

In `demo_api_server/services/agentModeResolver.js`, add a `google` row to `AGENT_MODES` (after the `helix_google` row, line 25). The drift-guard regex requires the `id`, `provider`, and `heuristicRouting` keys in this order:

```javascript
  { id: 'google',       label: 'Google (Gemini) only', provider: 'google',    heuristicRouting: false, external: true  },
```

- [ ] **Step 3: Add the client-side mode row**

In `demo_api_ui/src/config/agentModes.js`, add a matching row to `AGENT_MODES` (after the `helix_google` row, line 25):

```javascript
  { id: "google",       label: "Google API", provider: "google",    pure: true  },
```

- [ ] **Step 4: Run the drift-guard test**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
npx jest src/config/__tests__/agentModes.test.js
```
Expected: PASS — the client `MODE_PROVIDER` now equals the server-parsed map (both include `google: 'google'`).

- [ ] **Step 5: Run the agent-service config test**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_agent_service
npx jest tests/config.test.ts
```
Expected: PASS (google accepted as a valid provider).

- [ ] **Step 6: Commit**

```bash
git add demo_agent_service/src/config.ts demo_api_server/services/agentModeResolver.js demo_api_ui/src/config/agentModes.js
git commit -m "feat: register google (Gemini) as a selectable agent mode + valid provider"
```

---

### Task 6: Live validation of all 4 LLM modes

**Files:**
- Modify: `.env` (add `GOOGLE_API_KEY`, optional `GOOGLE_MODEL`) — do NOT commit the key.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: manual confirmation that all four LLM modes answer a live request. This is the Phase 1 exit gate.

- [ ] **Step 1: Add the Google key to `.env`**

Add to the repo `.env` (the running stack reads the main checkout's `.env` per the docker-serves-main-checkout note — confirm which `.env` the agent service loads; for local `./run-docker.sh` it is the root `.env`):

```
GOOGLE_API_KEY=AIza...            # your Google AI Studio key
GOOGLE_MODEL=gemini-2.0-flash     # optional; this is the default anyway
```

Confirm `.env` is gitignored (it is) — never stage it.

- [ ] **Step 2: Start (or restart) the stack**

Run:
```bash
./run-docker.sh restart demo_agent_service demo_api_server demo_api_ui
```
Or `./run-docker.sh` if not already up. Wait for the agent service to be healthy.

- [ ] **Step 3: Verify the Google provider status endpoint reports available**

With a logged-in browser session cookie (or via the UI Config page), confirm:
```bash
curl -sk https://api.ping.demo:3001/api/langchain/config/status --cookie "<session>" | python3 -m json.tool
```
Expected: `key_set` includes `"google": true` (llmProviderStatus already maps `GOOGLE_API_KEY`).

- [ ] **Step 4: Manually validate each mode in the UI**

Browse `https://api.ping.demo:4000` (or the worktree-verify port per the Worktree-UI-Live-Verify note), log in as a customer, open the agent, and for EACH mode (llama.cpp, Claude, Helix, Google API):
1. Select the mode in the agent mode picker.
2. Click "My accounts" (or type "show my accounts").
3. Confirm a real, in-domain response renders (not "reasoning unavailable" / not empty).

Record a one-line pass/fail per mode. If a mode's provider is genuinely unconfigured (e.g. Helix creds absent), note it — that mode will be a "skipped" cell later, which is expected.

- [ ] **Step 5: Commit the validation note**

Create `docs/superpowers/plans/phase1-validation.md` with the 4-mode pass/fail table, then:
```bash
git add docs/superpowers/plans/phase1-validation.md
git commit -m "docs: Phase 1 live-validation results for all 4 LLM modes"
```

**Phase 1 exit gate:** all configured modes answer live; Google is one of them.

---

## PHASE 2 — Screenshot harness + Banking

### Task 7: Build the reusable screenshot harness

**Files:**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js`

**Interfaces:**
- Consumes: the existing real-login helpers in `demo_api_ui/tests/e2e/helpers/realLogin.js` (`loginAsCustomer`, `requireRealLoginEnv`).
- Produces (exported functions used by every vertical spec):
  - `MODES` — `[{ id:'llamacpp', label:'llama.cpp' }, { id:'claude', label:'Claude' }, { id:'helix_google', label:'Helix' }, { id:'google', label:'Google API' }]`
  - `async setAgentMode(page, modeId)` — POST `/api/langchain/config` `{ agent_mode: modeId }`; returns the resolved mode.
  - `async modeAvailable(page, modeId)` — GET `/api/langchain/config/status`; returns `true` when that mode's provider key is set/reachable.
  - `async captureChip(page, { vertical, chipId, chipLabel, modeId })` — sets mode, clicks the chip, waits for the assistant bubble, screenshots the panel to `__screenshots__/<vertical>/<chipId>/<modeId>.png`, returns `{ modeId, file, text, skipped }`.
  - `assertInDomain(text, { present, absent })` — throws if any `present` regex is missing or any `absent` regex is found.
  - `writeManifest(vertical, rows)` — writes `__screenshots__/<vertical>/manifest.json` for Phase 6.

- [ ] **Step 1: Write the harness**

Create `demo_api_ui/tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js`:

```javascript
// demo_api_ui/tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js
//
// Reusable harness for capturing the Agent UI response across the four LLM
// modes, per use-case chip, in the real UI (no mocks). Selectors mirror the
// live agent panel used in banking-agent.real.spec.js:
//   panel:            .banking-agent-panel
//   chip button:      .banking-chips-dropdown__button (label text)
//   assistant bubble: .banking-agent-msg.assistant .banking-agent-msg-bubble
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const MODES = [
  { id: 'llamacpp',     label: 'llama.cpp'  },
  { id: 'claude',       label: 'Claude'     },
  { id: 'helix_google', label: 'Helix'      },
  { id: 'google',       label: 'Google API' },
];

const SHOT_ROOT = path.resolve(__dirname, '..', '__screenshots__');

async function setAgentMode(page, modeId) {
  const res = await page.request.post('/api/langchain/config', {
    data: { agent_mode: modeId },
  });
  if (!res.ok()) throw new Error(`setAgentMode ${modeId} failed: ${res.status()}`);
  const body = await res.json();
  return body.agent_mode || modeId;
}

async function modeAvailable(page, modeId) {
  const res = await page.request.get('/api/langchain/config/status');
  if (!res.ok()) return false;
  const body = await res.json();
  // Map mode id -> provider key used by key_set (helix_google -> helix).
  const providerByMode = { llamacpp: 'llamacpp', claude: 'anthropic', helix_google: 'helix', google: 'google' };
  const provider = providerByMode[modeId] || modeId;
  return !!(body.key_set && body.key_set[provider] === true);
}

async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
  if (await panel.isVisible().catch(() => false)) return panel;
  const fab = page.locator('.banking-agent-fab');
  await Promise.race([
    panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
    fab.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  ]);
  if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
    await fab.first().click();
  }
  await expect(panel).toBeVisible({ timeout: 20000 });
  return panel;
}

async function clickChip(page, chipLabel) {
  // Open the chips dropdown if the buttons aren't already visible.
  const chip = page.locator('.banking-chips-dropdown__button', { hasText: chipLabel });
  if (!(await chip.first().isVisible().catch(() => false))) {
    const trigger = page.locator('button', { hasText: /Actions|Chips|Quick/i }).first();
    if (await trigger.isVisible().catch(() => false)) await trigger.click();
  }
  await expect(chip.first()).toBeVisible({ timeout: 10000 });
  await chip.first().click();
}

async function captureChip(page, { vertical, chipId, chipLabel, modeId }) {
  const dir = path.join(SHOT_ROOT, vertical, chipId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${modeId}.png`);
  const rel = path.relative(SHOT_ROOT, file);

  if (!(await modeAvailable(page, modeId))) {
    return { modeId, file: rel, text: '', skipped: true };
  }

  await setAgentMode(page, modeId);
  const panel = await ensureAgentReady(page);
  const bubblesBefore = await page.locator('.banking-agent-msg.assistant .banking-agent-msg-bubble').count();

  await clickChip(page, chipLabel);

  // Wait for a NEW assistant bubble to settle.
  await expect
    .poll(async () => page.locator('.banking-agent-msg.assistant .banking-agent-msg-bubble').count(),
      { timeout: 45000 })
    .toBeGreaterThan(bubblesBefore);

  const lastBubble = page.locator('.banking-agent-msg.assistant .banking-agent-msg-bubble').last();
  await expect(lastBubble).toBeVisible();
  const text = (await lastBubble.innerText()).trim();

  await panel.screenshot({ path: file });
  return { modeId, file: rel, text, skipped: false };
}

function assertInDomain(text, { present = [], absent = [] }) {
  for (const re of present) {
    if (!re.test(text)) throw new Error(`in-domain check: expected /${re.source}/ in: ${text.slice(0, 200)}`);
  }
  for (const re of absent) {
    if (re.test(text)) throw new Error(`cross-domain leak: found /${re.source}/ in: ${text.slice(0, 200)}`);
  }
}

function writeManifest(vertical, rows) {
  const dir = path.join(SHOT_ROOT, vertical);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ vertical, rows }, null, 2));
}

module.exports = { MODES, SHOT_ROOT, setAgentMode, modeAvailable, ensureAgentReady, clickChip, captureChip, assertInDomain, writeManifest };
```

- [ ] **Step 2: Sanity-check the harness parses**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
node -e "const h=require('./tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js'); console.log(h.MODES.map(m=>m.id).join(','))"
```
Expected: prints `llamacpp,claude,helix_google,google`.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js
git commit -m "test(agent-screenshots): reusable 4-mode screenshot harness"
```

---

### Task 8: Banking screenshot spec

**Files:**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/banking-screenshots.real.spec.js`

**Interfaces:**
- Consumes: `captureChip`, `MODES`, `assertInDomain`, `writeManifest` from Task 7; `loginAsCustomer`, `requireRealLoginEnv` from `../helpers/realLogin`.
- Produces: `__screenshots__/banking/<chip>/<mode>.png` (up to 3 chips × 4 modes) + `__screenshots__/banking/manifest.json`.

- [ ] **Step 1: Write the banking spec**

Create `demo_api_ui/tests/e2e/agent-screenshots/banking-screenshots.real.spec.js`:

```javascript
// demo_api_ui/tests/e2e/agent-screenshots/banking-screenshots.real.spec.js
// Real-UI (no mock) screenshots of the banking agent response across 4 LLM modes.
// SKIPPED automatically when real-login credentials are not set.
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('../helpers/realLogin');
const { MODES, captureChip, assertInDomain, writeManifest } = require('./helpers/agentScreenshotHarness');

const VERTICAL = 'banking';
const CHIPS = [
  { chipId: 'my_accounts',   chipLabel: 'My accounts',       present: [/account|checking|savings|balance/i], absent: [/loyalty|order #|appointment|portfolio/i] },
  { chipId: 'check_balance', chipLabel: 'Check balance',     present: [/balance|\$/i],                        absent: [/loyalty|appointment|portfolio/i] },
  { chipId: 'transactions',  chipLabel: 'Recent transactions', present: [/transaction|payment|deposit|withdraw/i], absent: [/loyalty|appointment/i] },
];

test.describe('banking agent — 4-mode screenshots', () => {
  test.skip(!requireRealLoginEnv(), 'real-login env not set');
  test.setTimeout(240000);

  test('capture all chips across all modes', async ({ page }) => {
    await loginAsCustomer(page);
    await page.goto('/dashboard');

    const rows = [];
    for (const chip of CHIPS) {
      const cells = [];
      for (const mode of MODES) {
        const cell = await captureChip(page, { vertical: VERTICAL, chipId: chip.chipId, chipLabel: chip.chipLabel, modeId: mode.id });
        if (!cell.skipped && cell.text) {
          assertInDomain(cell.text, { present: chip.present, absent: chip.absent });
        }
        cells.push(cell);
      }
      rows.push({ chipId: chip.chipId, chipLabel: chip.chipLabel, cells });
    }
    writeManifest(VERTICAL, rows);

    // At least one mode produced a non-skipped capture.
    const anyCaptured = rows.some((r) => r.cells.some((c) => !c.skipped));
    expect(anyCaptured).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm the stack is running with all configured modes**

Ensure the stack is up (`./run-docker.sh status`) and real-login env vars are set (see `demo_api_ui/tests/e2e/helpers/realLogin.js` for the variable names).

- [ ] **Step 3: Run the banking spec**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
npx playwright test tests/e2e/agent-screenshots/banking-screenshots.real.spec.js --config=playwright.real.config.js
```
Expected: PASS; `__screenshots__/banking/<chip>/<mode>.png` files exist for every configured mode; `manifest.json` written. Any unconfigured mode yields a `skipped: true` cell (no PNG) rather than a failure.

- [ ] **Step 4: Eyeball the screenshots**

Open 2–3 of the PNGs and confirm they show the agent panel with a real, in-domain banking response.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/tests/e2e/agent-screenshots/banking-screenshots.real.spec.js demo_api_ui/tests/e2e/agent-screenshots/__screenshots__/banking
git commit -m "test(agent-screenshots): banking 4-mode capture + baselines"
```

---

## PHASE 3 — Retail

### Task 9: Retail screenshot spec

**Files:**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/retail-screenshots.real.spec.js`

**Interfaces:**
- Consumes: same harness exports as Task 8.
- Produces: `__screenshots__/retail/<chip>/<mode>.png` + `manifest.json`.

- [ ] **Step 1: Identify retail's real chip labels**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests
grep -rn "label" demo_api_server/config/verticals/retail/index.js | grep -i "chip\|order\|loyalty\|store\|product" | head
```
Use the actual chip labels (e.g. orders, loyalty points, store locator) from the retail manifest for `chipLabel`. If chips are served via `/api/verticals/me`, inspect that response while logged into a retail session instead.

- [ ] **Step 2: Write the retail spec**

Create `demo_api_ui/tests/e2e/agent-screenshots/retail-screenshots.real.spec.js` — identical structure to banking (Task 8 Step 1), with these substitutions:
- `const VERTICAL = 'retail';`
- `CHIPS` set to 2–3 real retail chips, for example:

```javascript
const CHIPS = [
  { chipId: 'my_orders',      chipLabel: 'My orders',      present: [/order|purchase|delivery/i], absent: [/checking|balance|appointment|portfolio/i] },
  { chipId: 'loyalty_points', chipLabel: 'Loyalty points', present: [/loyalty|points|rewards/i],   absent: [/checking|appointment|portfolio/i] },
  { chipId: 'store_locator',  chipLabel: 'Find a store',   present: [/store|location|near/i],       absent: [/appointment|portfolio/i] },
];
```
- Navigation: retail may use `/dashboard` under a retail vertical session, or a vertical-specific route — confirm the correct route from the retail session and set `page.goto(...)` accordingly.

- [ ] **Step 3: Run the retail spec**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
npx playwright test tests/e2e/agent-screenshots/retail-screenshots.real.spec.js --config=playwright.real.config.js
```
Expected: PASS; retail PNGs + manifest written; content asserts confirm retail vocabulary with no banking/health/investment leakage.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/tests/e2e/agent-screenshots/retail-screenshots.real.spec.js demo_api_ui/tests/e2e/agent-screenshots/__screenshots__/retail
git commit -m "test(agent-screenshots): retail 4-mode capture + baselines"
```

---

## PHASE 4 — Healthcare

### Task 10: Healthcare screenshot spec

**Files:**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/healthcare-screenshots.real.spec.js`

**Interfaces:**
- Consumes: same harness exports.
- Produces: `__screenshots__/healthcare/<chip>/<mode>.png` + `manifest.json`.

- [ ] **Step 1: Identify healthcare's real chip labels**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests
grep -rn "label\|book_appointment\|provider\|clinic" demo_api_server/config/verticals/healthcare/tools.js | head
grep -rn "label" demo_api_server/config/verticals/healthcare/index.js | head
```
Pick 2–3 real chips (e.g. appointments, prescriptions, find a provider).

- [ ] **Step 2: Write the healthcare spec**

Create `demo_api_ui/tests/e2e/agent-screenshots/healthcare-screenshots.real.spec.js` — identical structure to banking, with:
- `const VERTICAL = 'healthcare';`

```javascript
const CHIPS = [
  { chipId: 'appointments',  chipLabel: 'My appointments', present: [/appointment|visit|clinic|doctor/i], absent: [/checking|balance|loyalty|portfolio/i] },
  { chipId: 'prescriptions', chipLabel: 'My prescriptions', present: [/prescription|medication|refill|rx/i], absent: [/checking|loyalty|portfolio/i] },
  { chipId: 'find_provider', chipLabel: 'Find a provider',  present: [/provider|doctor|specialist|clinic/i], absent: [/loyalty|portfolio/i] },
];
```

- [ ] **Step 3: Run the healthcare spec**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
npx playwright test tests/e2e/agent-screenshots/healthcare-screenshots.real.spec.js --config=playwright.real.config.js
```
Expected: PASS; healthcare PNGs + manifest written.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/tests/e2e/agent-screenshots/healthcare-screenshots.real.spec.js demo_api_ui/tests/e2e/agent-screenshots/__screenshots__/healthcare
git commit -m "test(agent-screenshots): healthcare 4-mode capture + baselines"
```

---

## PHASE 5 — Investment

### Task 11: Investment screenshot spec

**Files:**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/investment-screenshots.real.spec.js`

**Interfaces:**
- Consumes: same harness exports.
- Produces: `__screenshots__/investment/<chip>/<mode>.png` + `manifest.json`.

- [ ] **Step 1: Identify investment's real chip labels**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests
grep -rn "label" demo_api_server/config/verticals/investment/index.js | head
grep -rn "portfolio\|holdings\|position\|watchlist" demo_api_server/config/verticals/investment/tools.js | head
```
Pick 2–3 real chips (e.g. portfolio, holdings, watchlist).

- [ ] **Step 2: Write the investment spec**

Create `demo_api_ui/tests/e2e/agent-screenshots/investment-screenshots.real.spec.js` — identical structure to banking, with:
- `const VERTICAL = 'investment';`

```javascript
const CHIPS = [
  { chipId: 'portfolio',  chipLabel: 'My portfolio',  present: [/portfolio|holdings|position|invest/i], absent: [/checking|loyalty|appointment/i] },
  { chipId: 'performance', chipLabel: 'Performance',  present: [/return|gain|loss|performance|%/i],       absent: [/loyalty|appointment/i] },
  { chipId: 'watchlist',  chipLabel: 'Watchlist',     present: [/watchlist|stock|ticker|symbol/i],        absent: [/loyalty|appointment/i] },
];
```

- [ ] **Step 3: Run the investment spec**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
npx playwright test tests/e2e/agent-screenshots/investment-screenshots.real.spec.js --config=playwright.real.config.js
```
Expected: PASS; investment PNGs + manifest written.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/tests/e2e/agent-screenshots/investment-screenshots.real.spec.js demo_api_ui/tests/e2e/agent-screenshots/__screenshots__/investment
git commit -m "test(agent-screenshots): investment 4-mode capture + baselines"
```

---

## PHASE 6 — Doc assembly

### Task 12: Build the master comparison doc

**Files:**
- Create: `demo_api_ui/tests/e2e/agent-screenshots/build-doc.js`
- Create (generated): `demo_api_ui/tests/e2e/agent-screenshots/README.md`

**Interfaces:**
- Consumes: `__screenshots__/<vertical>/manifest.json` from Phases 2–5.
- Produces: `README.md` with one markdown row per chip showing the 4 mode screenshots side by side, plus a "Skipped modes" section.

- [ ] **Step 1: Write the doc builder**

Create `demo_api_ui/tests/e2e/agent-screenshots/build-doc.js`:

```javascript
// demo_api_ui/tests/e2e/agent-screenshots/build-doc.js
// Assembles README.md from every __screenshots__/<vertical>/manifest.json.
// Each chip becomes one comparison row: 4 mode screenshots side by side.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '__screenshots__');
const MODE_ORDER = ['llamacpp', 'claude', 'helix_google', 'google'];
const MODE_LABEL = { llamacpp: 'llama.cpp', claude: 'Claude', helix_google: 'Helix', google: 'Google API' };

function loadManifests() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT)
    .map((v) => path.join(ROOT, v, 'manifest.json'))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
}

function cellFor(row, modeId) {
  const cell = row.cells.find((c) => c.modeId === modeId);
  if (!cell || cell.skipped) return '_skipped (unconfigured)_';
  return `![${modeId}](__screenshots__/${cell.file.split(path.sep).join('/')})`;
}

function build() {
  const manifests = loadManifests();
  const skipped = [];
  let md = '# Agent UI Response — 4-Mode Screenshot Comparison\n\n';
  md += 'Real-UI (no mock) captures of the agent response per use-case chip, across four LLM modes.\n\n';
  md += `Modes: ${MODE_ORDER.map((m) => MODE_LABEL[m]).join(' · ')}\n\n`;

  for (const man of manifests) {
    md += `## ${man.vertical}\n\n`;
    md += `| Chip | ${MODE_ORDER.map((m) => MODE_LABEL[m]).join(' | ')} |\n`;
    md += `| --- | ${MODE_ORDER.map(() => '---').join(' | ')} |\n`;
    for (const row of man.rows) {
      const cells = MODE_ORDER.map((m) => {
        const c = row.cells.find((x) => x.modeId === m);
        if (c && c.skipped) skipped.push(`${man.vertical} / ${row.chipId} / ${MODE_LABEL[m]}`);
        return cellFor(row, m);
      });
      md += `| **${row.chipLabel}** | ${cells.join(' | ')} |\n`;
    }
    md += '\n';
  }

  if (skipped.length) {
    md += '## Skipped modes (provider unconfigured at capture time)\n\n';
    for (const s of skipped) md += `- ${s}\n`;
    md += '\n';
  }

  fs.writeFileSync(path.join(__dirname, 'README.md'), md);
  console.log(`Wrote README.md — ${manifests.length} vertical(s), ${skipped.length} skipped cell(s)`);
}

build();
```

- [ ] **Step 2: Run the builder**

Run:
```bash
cd .claude/worktrees/agent-ui-screenshot-tests/demo_api_ui
node tests/e2e/agent-screenshots/build-doc.js
```
Expected: prints the vertical/skipped counts; `README.md` created.

- [ ] **Step 3: Verify the doc renders**

Open `demo_api_ui/tests/e2e/agent-screenshots/README.md` in a markdown preview and confirm each vertical shows a table with 4 image columns per chip, and skipped cells read "_skipped (unconfigured)_".

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/tests/e2e/agent-screenshots/build-doc.js demo_api_ui/tests/e2e/agent-screenshots/README.md
git commit -m "docs(agent-screenshots): master 4-mode comparison README"
```

---

## Self-Review Notes

- **Spec coverage:** Google build (Tasks 1–5), live 4-mode validation (Task 6), harness (Task 7), banking/retail/healthcare/investment captures (Tasks 8–11), side-by-side markdown doc + skipped-mode reporting (Task 12). All spec sections mapped.
- **Real UI, no mocks:** enforced in Phases 2–6; only Task 3 unit tests mock the client (allowed).
- **Drift guard:** Task 5 updates both mode tables together and runs `agentModes.test.js`.
- **Provider-down handling:** `modeAvailable` → `skipped` cell, surfaced in the doc's Skipped section (never silently dropped).
- **Open items (resolve during execution, not placeholders):** exact chip labels + navigation route per non-banking vertical are discovered in each phase's Step 1 from the live manifest — these are genuine runtime lookups, not deferred design decisions.
