# Token Teller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slim footer bar to the banking agent panel showing live input/output token counts for the current session and a persistent all-time lifetime total stored in `localStorage`.

**Architecture:** Token counts flow from the Anthropic SDK response (`response.usage`) in `demo_agent_service/src/reasoningGraph.ts`, through the `final` response contract to `agentReasoningClient.js`, up through `bankingAgentLangGraphService.js` to `bankingAgentRoutes.js`, and finally into a new `sessionTokens` React state that drives a `<div className="ba-token-footer">` rendered at the bottom of the agent panel.

**Tech Stack:** TypeScript (demo_agent_service), CommonJS Node.js (demo_api_server), React (demo_api_ui/src/components/BankingAgent.js), CSS, localStorage

---

## File Map

| File | Change |
|---|---|
| `demo_agent_service/src/reasonContract.ts` | Add `inputTokens?: number; outputTokens?: number` to `FinalResponse` type |
| `demo_agent_service/src/reasoningGraph.ts` | Extract `response.usage` from Anthropic SDK call; pass through to `final` response |
| `demo_api_server/services/agentReasoningClient.js` | Pass `inputTokens`/`outputTokens` from `:3006` response through to caller |
| `demo_api_server/services/bankingAgentLangGraphService.js` | Replace `tokensUsed: 0` with `inputTokens`/`outputTokens` from `loopResult` |
| `demo_api_server/routes/bankingAgentRoutes.js` | Include `inputTokens`/`outputTokens` in `responseBody` |
| `demo_api_ui/src/components/BankingAgent.js` | Add `sessionTokens` state, `lifetimeTokens` state from localStorage, token accumulation after each response, footer JSX |
| `demo_api_ui/src/components/BankingAgent.css` | Add `.ba-token-footer` styles |

---

## Task 1: Extend the reason contract type

**Files:**
- Modify: `demo_agent_service/src/reasonContract.ts`

- [ ] **Step 1: Read the current FinalResponse type**

Open `demo_agent_service/src/reasonContract.ts`. The relevant line is:
```typescript
| { type: 'final'; answer: string; messages: ReasonMessage[]; reasoningUnavailable?: boolean };
```

- [ ] **Step 2: Add token fields to FinalResponse**

Replace that line with:
```typescript
| { type: 'final'; answer: string; messages: ReasonMessage[]; reasoningUnavailable?: boolean; inputTokens?: number; outputTokens?: number };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /path/to/repo/demo_agent_service && npm run build
```
Expected: exit 0, no errors

- [ ] **Step 4: Commit**

```bash
git add demo_agent_service/src/reasonContract.ts demo_agent_service/dist
git commit -m "feat(token-teller): extend FinalResponse type with inputTokens/outputTokens"
```

---

## Task 2: Capture token usage in the Anthropic reasoning path

**Files:**
- Modify: `demo_agent_service/src/reasoningGraph.ts` (lines 74–94)

- [ ] **Step 1: Write the failing test**

Create `demo_agent_service/src/reasoningGraph.tokens.test.ts`:

```typescript
import { reasonOnce } from './reasoningGraph';

// Mock Anthropic client to return a response with usage
jest.mock('@anthropic-ai/sdk', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Hello!' }],
          usage: { input_tokens: 42, output_tokens: 7 },
        }),
      },
    })),
  };
});

test('final response includes inputTokens and outputTokens from Anthropic usage', async () => {
  const result = await reasonOnce({
    provider: 'anthropic',
    anthropicApiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
  } as any);

  expect(result.type).toBe('final');
  if (result.type === 'final') {
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(7);
  }
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd demo_agent_service && npx jest reasoningGraph.tokens --no-coverage
```
Expected: FAIL — `inputTokens` is `undefined`

- [ ] **Step 3: Extract usage from the Anthropic response**

In `demo_agent_service/src/reasoningGraph.ts`, find the Anthropic `final` return at line ~94:
```typescript
const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
const answer = textBlock?.text ?? '';
return { type: 'final', answer, messages: [...req.messages, { role: 'assistant', content: answer }] };
```

Replace with:
```typescript
const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
const answer = textBlock?.text ?? '';
return {
  type: 'final',
  answer,
  messages: [...req.messages, { role: 'assistant', content: answer }],
  inputTokens: response.usage?.input_tokens,
  outputTokens: response.usage?.output_tokens,
};
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd demo_agent_service && npx jest reasoningGraph.tokens --no-coverage
```
Expected: PASS

- [ ] **Step 5: Build**

```bash
cd demo_agent_service && npm run build
```
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add demo_agent_service/src/reasoningGraph.ts demo_agent_service/src/reasoningGraph.tokens.test.ts demo_agent_service/dist
git commit -m "feat(token-teller): capture Anthropic usage tokens in reasonOnce final response"
```

---

## Task 3: Pass tokens through agentReasoningClient

**Files:**
- Modify: `demo_api_server/services/agentReasoningClient.js` (line 38)

The current return on a `final` response is:
```javascript
return { ok: true, answer: data.answer };
```

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/agentReasoningClient.tokens.test.js`:

```javascript
const axios = require('axios');
jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => 'test-secret') }));

const { runReasonLoop } = require('../services/agentReasoningClient');

test('runReasonLoop passes inputTokens and outputTokens from final response', async () => {
  axios.post.mockResolvedValueOnce({
    data: { type: 'final', answer: 'Hello', inputTokens: 42, outputTokens: 7 },
  });

  const result = await runReasonLoop({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    anthropicApiKey: 'sk-test',
    maxIterations: 3,
    executeTool: jest.fn(),
  });

  expect(result.ok).toBe(true);
  expect(result.inputTokens).toBe(42);
  expect(result.outputTokens).toBe(7);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd demo_api_server && npx jest agentReasoningClient.tokens --no-coverage
```
Expected: FAIL — `inputTokens` is `undefined`

- [ ] **Step 3: Pass token fields through**

In `demo_api_server/services/agentReasoningClient.js`, find line 38:
```javascript
return { ok: true, answer: data.answer };
```

Replace with:
```javascript
return { ok: true, answer: data.answer, inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0 };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd demo_api_server && npx jest agentReasoningClient.tokens --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentReasoningClient.js demo_api_server/tests/agentReasoningClient.tokens.test.js
git commit -m "feat(token-teller): pass inputTokens/outputTokens through agentReasoningClient"
```

---

## Task 4: Surface tokens in bankingAgentLangGraphService

**Files:**
- Modify: `demo_api_server/services/bankingAgentLangGraphService.js` (line ~735)

The successful LLM path at line ~735:
```javascript
return {
  reply: loopResult.answer,
  success: true,
  toolsCalled: [],
  tokensUsed: 0,
  requiresConsent: false,
  agentConfigured: true,
  tokenEvents: tokenEvents || [],
};
```

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/bankingAgentLangGraphService.tokens.test.js`:

```javascript
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn().mockResolvedValue({
    ok: true,
    answer: 'Your balance is $4,200.',
    inputTokens: 38,
    outputTokens: 12,
  }),
}));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => null) }));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../data/store', () => ({ getUserById: jest.fn(() => null) }));

const { processAgentMessage } = require('../services/bankingAgentLangGraphService');

test('processAgentMessage returns inputTokens and outputTokens from loop result', async () => {
  const result = await processAgentMessage({
    message: 'what is my balance',
    userId: 'user1',
    userToken: 'tok',
    req: { session: {} },
    langchainConfig: { provider: 'anthropic' },
    sessionId: 'sess1',
  });

  expect(result.inputTokens).toBe(38);
  expect(result.outputTokens).toBe(12);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd demo_api_server && npx jest bankingAgentLangGraphService.tokens --no-coverage
```
Expected: FAIL — `inputTokens` is `undefined`

- [ ] **Step 3: Replace tokensUsed: 0 with real token fields in the success path**

In `demo_api_server/services/bankingAgentLangGraphService.js`, find the successful LLM return (~line 735):
```javascript
      return {
        reply: loopResult.answer,
        success: true,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
      };
```

Replace with:
```javascript
      return {
        reply: loopResult.answer,
        success: true,
        toolsCalled: [],
        inputTokens: loopResult.inputTokens ?? 0,
        outputTokens: loopResult.outputTokens ?? 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
      };
```

Note: leave all other `tokensUsed: 0` occurrences (heuristic paths, error paths) untouched — they don't go through the LLM and have no token data.

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd demo_api_server && npx jest bankingAgentLangGraphService.tokens --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/bankingAgentLangGraphService.js demo_api_server/tests/bankingAgentLangGraphService.tokens.test.js
git commit -m "feat(token-teller): surface inputTokens/outputTokens from LLM loop in bankingAgentLangGraphService"
```

---

## Task 5: Include tokens in the BFF route response

**Files:**
- Modify: `demo_api_server/routes/bankingAgentRoutes.js` (lines 289–299)

The current `responseBody`:
```javascript
const responseBody = {
  reply: response.reply,
  success: response.success,
  toolsCalled: response.toolsCalled,
  tokensUsed: response.tokensUsed,
  requiresConsent: response.requiresConsent,
  agentConfigured: response.agentConfigured,
  degradedDelegation: response.degradedDelegation,
  error: response.error,
  tokenEvents: resolvedTokenEvents
};
```

- [ ] **Step 1: Replace tokensUsed with inputTokens/outputTokens**

Replace the `tokensUsed: response.tokensUsed,` line with:
```javascript
  inputTokens: response.inputTokens ?? 0,
  outputTokens: response.outputTokens ?? 0,
```

The full updated block:
```javascript
const responseBody = {
  reply: response.reply,
  success: response.success,
  toolsCalled: response.toolsCalled,
  inputTokens: response.inputTokens ?? 0,
  outputTokens: response.outputTokens ?? 0,
  requiresConsent: response.requiresConsent,
  agentConfigured: response.agentConfigured,
  degradedDelegation: response.degradedDelegation,
  error: response.error,
  tokenEvents: resolvedTokenEvents
};
```

- [ ] **Step 2: Run existing route tests to confirm nothing regressed**

```bash
cd demo_api_server && npx jest hitlGateway.regression hitlGateway.integration --no-coverage
```
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/routes/bankingAgentRoutes.js
git commit -m "feat(token-teller): include inputTokens/outputTokens in BFF route response"
```

---

## Task 6: Add Token Teller CSS

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.css`

- [ ] **Step 1: Add .ba-token-footer styles**

Append to the end of `demo_api_ui/src/components/BankingAgent.css`:

```css
/* Token Teller — slim footer strip showing session + lifetime token counts */
.ba-token-footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 4px 12px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 11px;
  font-family: ui-monospace, "SFMono-Regular", monospace;
  color: #64748b;
  border-radius: 0 0 14px 14px;
  gap: 8px;
  user-select: none;
}
```

- [ ] **Step 2: Verify build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/BankingAgent.css
git commit -m "feat(token-teller): add .ba-token-footer CSS"
```

---

## Task 7: Add Token Teller React state and JSX

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js`

- [ ] **Step 1: Add sessionTokens state and lifetimeTokens state**

Find the block of `useState` declarations near line 1723–1747. After the line:
```javascript
const [messages, setMessages] = useState([]);
```

Add:
```javascript
const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0 });
const [lifetimeTokens, setLifetimeTokens] = useState(() => {
  try {
    const stored = JSON.parse(localStorage.getItem('ba_tokens_lifetime') || 'null');
    return stored && typeof stored.input === 'number' ? stored : { input: 0, output: 0 };
  } catch (_) {
    return { input: 0, output: 0 };
  }
});
```

- [ ] **Step 2: Accumulate tokens after each agent LLM response**

In the `sendAgentMessage` response handler at line ~6163 (the `else` branch after `addMessage("assistant", ...)`):

Find:
```javascript
            addMessage("assistant", response.reply || "Done.");
            if (response.tokenEvents?.length) {
              appendTokenEvents(response.tokenEvents);
              if (tokenChain) {
                tokenChain.setTokenEvents("agent", response.tokenEvents);
              }
            }
```

Replace with:
```javascript
            addMessage("assistant", response.reply || "Done.");
            if (response.tokenEvents?.length) {
              appendTokenEvents(response.tokenEvents);
              if (tokenChain) {
                tokenChain.setTokenEvents("agent", response.tokenEvents);
              }
            }
            if (response.inputTokens || response.outputTokens) {
              const inc = {
                input: response.inputTokens ?? 0,
                output: response.outputTokens ?? 0,
              };
              setSessionTokens((prev) => ({
                input: prev.input + inc.input,
                output: prev.output + inc.output,
              }));
              setLifetimeTokens((prev) => {
                const next = { input: prev.input + inc.input, output: prev.output + inc.output };
                try { localStorage.setItem('ba_tokens_lifetime', JSON.stringify(next)); } catch (_) {}
                return next;
              });
            }
```

- [ ] **Step 3: Add the footer JSX**

Find line ~8805 (the closing `</div>` of `.ba-right-col`):
```jsx
              </div>
            </div>
          </div>
```

The last `</div>` on line 8805 closes `.ba-bottom-extra`. The `</div>` on 8806 closes `.ba-right-col`. Insert the footer JSX before the `.ba-right-col` closing tag:

Find this exact sequence:
```jsx
              </div>
            </div>
          </div>
          {/* Resize handles — all 8 directions, float mode only */}
```

Replace with:
```jsx
              </div>
            </div>
            {/* Token Teller — session + lifetime token counter */}
            <div className="ba-token-footer">
              <span>⬆ {sessionTokens.input.toLocaleString()} in</span>
              <span>⬇ {sessionTokens.output.toLocaleString()} out</span>
              <span>∑ {(lifetimeTokens.input + lifetimeTokens.output).toLocaleString()}</span>
            </div>
          </div>
          {/* Resize handles — all 8 directions, float mode only */}
```

- [ ] **Step 4: Build to verify no JSX/compile errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/BankingAgent.js
git commit -m "feat(token-teller): add sessionTokens state, lifetime localStorage persistence, and footer JSX"
```

---

## Task 8: Build agent service and verify end-to-end

- [ ] **Step 1: Build demo_agent_service**

```bash
cd demo_agent_service && npm run build
```
Expected: exit 0

- [ ] **Step 2: Run full API server test suite**

```bash
cd demo_api_server && npm test 2>&1 | tail -20
```
Expected: all suites pass (no new failures)

- [ ] **Step 3: Run UI build one final time**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 4: Final commit if any dist files changed**

```bash
git add demo_agent_service/dist
git diff --staged --quiet || git commit -m "chore(token-teller): rebuild agent service dist"
```

---

## Verification Checklist

After all tasks are complete, verify against success criteria:

- [ ] Panel fills viewport height — no 820px cap visible on a tall monitor
- [ ] Send a message to the agent (Anthropic provider) — ⬆ in and ⬇ out increment by non-zero values
- [ ] Refresh the page — session counters reset to `0 in / 0 out`; ∑ all-time total is preserved
- [ ] Send another message — ∑ continues to grow from where it left off
- [ ] Footer is visible below the input bar without overlapping the message scroll area
- [ ] `npm run build` (UI) exits 0
- [ ] Heuristic-path responses (no LLM) show `0 in / 0 out` for that turn — footer still renders
