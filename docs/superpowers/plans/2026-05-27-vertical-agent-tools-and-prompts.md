# Vertical Agent Tools and Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every vertical's agent — both the BFF/demo_agent_service reason-loop path and the LangChain WebSocket agent — speaks the vertical's domain language from the first word; admin never appears in the vertical switcher dropdown.

**Architecture:** Four targeted changes: (1) BFF `buildToolSchemasForAgent` injects per-vertical tool description overrides before passing schemas to the reason loop at `:3006`; (2) `verticalConfigService.listVerticals()` filters out the `admin` vertical; (3) `systemPromptFlavor` strings in all vertical manifests are rewritten to be professional (remove meta-commentary like "The underlying tools are banking demo tools"); (4) BFF `runReasonLoop` call gains a `systemPrompt` field propagated through `ReasonRequest`, and LangChain's `_build_system_message()` fetches the active vertical from `verticalConfigService` (in-process, no HTTP) and prepends the flavor string.

**Tech Stack:** Node.js/Express (BFF), TypeScript (demo_agent_service), Python/LangChain (langchain_agent), JSON (vertical manifests), Jest (Node tests)

---

## Current State — What Is Wrong And Why

1. **Tool descriptions** — `BankingToolRegistry.ts` and `agentBuilder.js` (BFF-side tool defs) use banking language ("bank accounts", "checking", "savings"). The LLM at `:3006` sees these descriptions and may use banking terminology in its reasoning even when the active vertical is retail or healthcare.

2. **Admin in switcher** — `verticalConfigService.listVerticals()` returns all 6 verticals including `admin` with zero filtering. The admin vertical is only used on the admin page (role-gated), never in the vertical switcher dropdown — but it currently appears there.

3. **systemPromptFlavor quality** — Several vertical manifests contain the phrase "The underlying tools are banking demo tools" in their `agent.systemPromptFlavor`. This is meta-commentary that leaks implementation details to the LLM and erodes the vertical persona. For a professional demo, the LLM should never know it's talking to a banking backend.

4. **BFF reason loop — no system prompt** — `bankingAgentLangGraphService.js` line 719: `runReasonLoop({ messages: [{ role: 'user', content: message }], ... })`. The `ReasonRequest` contract has no `systemPrompt` field. The LLM at `:3006` receives zero vertical context on every call, so it defaults to whatever persona its model default provides.

5. **LangChain agent — banking-only persona** — `_build_system_message()` (lines 165–204 of `langchain_mcp_agent.py`) returns a hardcoded "You are a helpful AI banking assistant..." prompt. There is no vertical awareness. The function receives `session_id` but never consults any vertical config.

---

## File Map

| File | Change |
|---|---|
| `demo_api_server/services/verticalConfigService.js` | `listVerticals()` filter: exclude `admin` id |
| `demo_api_server/config/verticals/retail.json` | Remove "underlying tools are banking" from `agent.systemPromptFlavor`; rewrite persona |
| `demo_api_server/config/verticals/healthcare.json` | Same |
| `demo_api_server/config/verticals/sporting-goods.json` | Same |
| `demo_api_server/config/verticals/workforce.json` | Same |
| `demo_api_server/services/bankingAgentLangGraphService.js` | `buildToolSchemasForAgent()` accepts vertical manifest; override descriptions; pass `systemPrompt` to `runReasonLoop` |
| `demo_agent_service/src/reasonContract.ts` | Add optional `systemPrompt?: string` to `ReasonRequest` |
| `demo_agent_service/src/agentOrchestrator.ts` | Thread `systemPrompt` into the first system message if present |
| `langchain_agent/src/agent/langchain_mcp_agent.py` | `_build_system_message()` imports `verticalConfigService` equivalent or reads env; prepend `systemPromptFlavor` |

No new files needed. Minimal surface area.

---

## Task 9: Filter Admin from `listVerticals()`

**Files:**
- Modify: `demo_api_server/services/verticalConfigService.js:48–56`
- Test: `demo_api_server/tests/verticalConfigService.test.js` (create if absent)

### What to change

`listVerticals()` currently returns all 6 verticals. Admin should only appear via `getVerticalConfig('admin')` (used by admin page), never in the switcher list.

- [ ] **Step 9.1: Write the failing test**

Create `demo_api_server/tests/verticalConfigService.test.js`:

```javascript
'use strict';
const path = require('path');

// We test the real service against the actual JSON files.
// No mocks — this is integration-style.
const svc = require('../services/verticalConfigService');

describe('verticalConfigService', () => {
  beforeEach(() => {
    // Clear cache so each test starts fresh
    svc.reloadVerticals();
  });

  it('listVerticals() does not include admin', () => {
    const list = svc.listVerticals();
    const ids = list.map(v => v.id);
    expect(ids).not.toContain('admin');
  });

  it('listVerticals() includes banking, retail, healthcare, sporting-goods, workforce', () => {
    const list = svc.listVerticals();
    const ids = list.map(v => v.id);
    expect(ids).toContain('banking');
    expect(ids).toContain('retail');
    expect(ids).toContain('healthcare');
    expect(ids).toContain('sporting-goods');
    expect(ids).toContain('workforce');
  });

  it('getVerticalConfig("admin") still returns the admin manifest', () => {
    const cfg = svc.getVerticalConfig('admin');
    expect(cfg).not.toBeNull();
    expect(cfg.id).toBe('admin');
  });
});
```

- [ ] **Step 9.2: Run test to confirm it fails**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest verticalConfigService --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `listVerticals()` includes admin.

- [ ] **Step 9.3: Fix `listVerticals()`**

In `demo_api_server/services/verticalConfigService.js`, find (lines 48–56):

```javascript
function listVerticals() {
  const all = loadVerticals();
  return Object.values(all).map(v => ({
    id: v.id,
    displayName: (v.identity && v.identity.displayName) || v.displayName,
    tagline: (v.identity && v.identity.tagline) || v.tagline,
    theme: v.theme
  }));
}
```

Replace with:

```javascript
// Verticals that are only used internally — never surfaced in the switcher dropdown.
const INTERNAL_VERTICALS = new Set(['admin']);

function listVerticals() {
  const all = loadVerticals();
  return Object.values(all)
    .filter(v => !INTERNAL_VERTICALS.has(v.id))
    .map(v => ({
      id: v.id,
      displayName: (v.identity && v.identity.displayName) || v.displayName,
      tagline: (v.identity && v.identity.tagline) || v.tagline,
      theme: v.theme
    }));
}
```

- [ ] **Step 9.4: Run test to confirm it passes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest verticalConfigService --no-coverage 2>&1 | tail -20
```
Expected: PASS — admin absent from list, all 5 non-admin verticals present, `getVerticalConfig('admin')` still works.

- [ ] **Step 9.5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/services/verticalConfigService.js demo_api_server/tests/verticalConfigService.test.js
git commit -m "fix(verticals): exclude admin from listVerticals() switcher; keep internal-only verticals set

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Rewrite `systemPromptFlavor` — Remove Meta-Commentary

**Files:**
- Modify: `demo_api_server/config/verticals/retail.json`
- Modify: `demo_api_server/config/verticals/healthcare.json`
- Modify: `demo_api_server/config/verticals/sporting-goods.json`
- Modify: `demo_api_server/config/verticals/workforce.json`

### What to change

Remove any phrase like "The underlying tools are banking demo tools" and "keep responses X-flavored". These leak implementation details to the LLM. Replace with a clean, professional persona instruction per vertical — same quality you'd write for a production AI assistant.

Also verify `banking.json`'s `agent.systemPromptFlavor` field. Banking is the native vertical so it should have minimal or no extra flavor needed.

- [ ] **Step 10.1: Check current `systemPromptFlavor` in all manifests**

```bash
cd /Users/curtismuir/Development/AI-Demo
grep -A2 '"systemPromptFlavor"' demo_api_server/config/verticals/*.json
```

Read each value and note which ones contain "banking demo tools" or similar implementation-leaking phrases.

- [ ] **Step 10.2: Rewrite `retail.json` systemPromptFlavor**

In `demo_api_server/config/verticals/retail.json`, find:

```json
"systemPromptFlavor": "You are a Great Buy shopping assistant. The underlying tools are banking demo tools; keep responses retail-flavored."
```

Replace with:

```json
"systemPromptFlavor": "You are a Great Buy shopping assistant. Help customers check their reward points, browse purchase history, view their account balances, and complete checkouts. Use retail language: accounts are loyalty accounts, transactions are purchases, balance is reward points, transfers are orders. Be concise and professional."
```

- [ ] **Step 10.3: Rewrite `sporting-goods.json` systemPromptFlavor**

In `demo_api_server/config/verticals/sporting-goods.json`, find:

```json
"systemPromptFlavor": "You are a Super Sports assistant. The underlying tools are banking demo tools; keep responses sporting-goods-flavored — accounts are loyalty accounts, transactions are purchases, balance is reward points, transfers are orders."
```

Replace with:

```json
"systemPromptFlavor": "You are a Super Sports assistant. Help members check their reward points, view loyalty account details, browse purchase history, and place orders for gear and equipment. Use sports retail language: accounts are loyalty accounts, transactions are purchases, balance is reward points. Be concise and professional."
```

- [ ] **Step 10.4: Rewrite `healthcare.json` systemPromptFlavor**

Read the current value:

```bash
grep -A2 '"systemPromptFlavor"' demo_api_server/config/verticals/healthcare.json
```

Replace whatever is there with:

```json
"systemPromptFlavor": "You are a PingHealth patient assistant. Help patients view their insurance coverage, check patient records, review appointment history, and understand their benefits. Use healthcare language: accounts are patient records, transactions are appointments or claims, balance is coverage amount. Respond with appropriate care and clarity."
```

- [ ] **Step 10.5: Rewrite `workforce.json` systemPromptFlavor**

Read the current value:

```bash
grep -A2 '"systemPromptFlavor"' demo_api_server/config/verticals/workforce.json
```

Replace whatever is there with:

```json
"systemPromptFlavor": "You are a WX Workforce HR assistant. Help employees check PTO balances, submit expense reports, review benefits, and track reimbursements. Use HR language: accounts are benefit or expense accounts, transactions are requests or submissions, balance is PTO or budget balance. Be professional and direct."
```

- [ ] **Step 10.6: Verify JSON is valid for all modified files**

```bash
for f in demo_api_server/config/verticals/retail.json demo_api_server/config/verticals/sporting-goods.json demo_api_server/config/verticals/healthcare.json demo_api_server/config/verticals/workforce.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('OK: $f')"
done
```

Expected: `OK:` for each file, no parse errors.

- [ ] **Step 10.7: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/config/verticals/retail.json \
        demo_api_server/config/verticals/sporting-goods.json \
        demo_api_server/config/verticals/healthcare.json \
        demo_api_server/config/verticals/workforce.json
git commit -m "feat(verticals): rewrite systemPromptFlavor — professional personas, no meta-commentary

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Per-Vertical Tool Description Overrides in BFF

**Files:**
- Modify: `demo_api_server/services/bankingAgentLangGraphService.js:396–411` (`buildToolSchemasForAgent`)
- Test: (unit test in existing or new file — see step below)

### What to change

`buildToolSchemasForAgent()` currently builds tool schemas from `getBankingToolDefinitions()` using their hardcoded banking descriptions. When the LLM sees "Retrieve the user's bank accounts", it naturally uses banking terminology in its replies even for retail or healthcare.

The fix: accept the active vertical manifest and, for each of the 4 shared tools (`get_my_accounts`, `get_account_balance`, `get_my_transactions`, `create_transfer`), override the `description` with a vertical-specific string if the manifest provides one. Other tools (vertical feature tools, sensitive data tools) keep their descriptions unchanged.

The vertical manifests already have a `terminology` object. We derive descriptions from that at the BFF call site — no changes to `BankingToolRegistry.ts` needed.

The description overrides map:

| Tool | Override template |
|---|---|
| `get_my_accounts` | `List the user's {accounts} with details including {account} type, masked number, {balance}, and currency.` |
| `get_account_balance` | `Get the {balance} for a specific {account}. Use account ID from get_my_accounts.` |
| `get_my_transactions` | `List the user's recent {transactions}. Each entry shows {transaction} type, amount, description, and date.` |
| `create_transfer` | `Submit a new {highValueAction} between {accounts}. Requires source account ID, destination account ID, and amount.` |

All other tools retain their existing descriptions unchanged.

- [ ] **Step 11.1: Write the failing test**

In `demo_api_server/tests/bankingAgentToolSchemas.test.js` (create):

```javascript
'use strict';

// Expose the private helper for testing by calling the exported processAgentMessage
// indirectly. Instead, we extract and test the description-override logic directly
// by requiring the module and using a fresh require with the vertical manifest.
// The simplest approach: extract the override helper to a testable export.

// After Step 11.3 adds buildToolSchemasForAgent(manifest) and exports it, test:
const { buildToolSchemasForAgentForVertical } = require('../services/bankingAgentLangGraphService');

const retailManifest = {
  id: 'retail',
  terminology: {
    account: 'Loyalty Account',
    accounts: 'Loyalty Accounts',
    balance: 'Reward Points',
    transaction: 'Purchase',
    transactions: 'Purchases',
    highValueAction: 'Large Purchase',
  }
};

const bankingManifest = { id: 'banking', terminology: null };

describe('buildToolSchemasForAgentForVertical', () => {
  it('overrides get_my_accounts description for retail vertical', () => {
    const schemas = buildToolSchemasForAgentForVertical(retailManifest);
    const tool = schemas.find(s => s.name === 'get_my_accounts');
    expect(tool.description).toContain('Loyalty Accounts');
    expect(tool.description).not.toMatch(/bank accounts/i);
  });

  it('overrides get_my_transactions description for retail vertical', () => {
    const schemas = buildToolSchemasForAgentForVertical(retailManifest);
    const tool = schemas.find(s => s.name === 'get_my_transactions');
    expect(tool.description).toContain('Purchases');
  });

  it('overrides get_account_balance description for retail vertical', () => {
    const schemas = buildToolSchemasForAgentForVertical(retailManifest);
    const tool = schemas.find(s => s.name === 'get_account_balance');
    expect(tool.description).toContain('Reward Points');
  });

  it('overrides create_transfer description for retail vertical', () => {
    const schemas = buildToolSchemasForAgentForVertical(retailManifest);
    const tool = schemas.find(s => s.name === 'create_transfer');
    expect(tool.description).toContain('Large Purchase');
  });

  it('falls back to original descriptions for banking vertical (no terminology)', () => {
    const schemas = buildToolSchemasForAgentForVertical(bankingManifest);
    const tool = schemas.find(s => s.name === 'get_my_accounts');
    // Original description contains "bank accounts"
    expect(tool.description).toMatch(/accounts/i);
    // Should NOT contain retail/healthcare terminology
    expect(tool.description).not.toMatch(/loyalty/i);
  });

  it('non-overridden tools retain original descriptions', () => {
    const schemas = buildToolSchemasForAgentForVertical(retailManifest);
    // show_large_purchase is a vertical feature tool — not overridden
    const featureTool = schemas.find(s => s.name === 'show_large_purchase');
    if (featureTool) {
      // Its description should be unchanged (original from agentBuilder)
      expect(featureTool.description).toBeTruthy();
    }
  });
});
```

- [ ] **Step 11.2: Run test to confirm it fails**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest bankingAgentToolSchemas --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `buildToolSchemasForAgentForVertical` not exported.

- [ ] **Step 11.3: Implement the override logic**

In `demo_api_server/services/bankingAgentLangGraphService.js`, find `buildToolSchemasForAgent()` (line 396):

```javascript
function buildToolSchemasForAgent() {
  const tools = getBankingToolDefinitions();
  return tools.map((tool) => {
    let inputSchema;
    try {
      inputSchema = tool.schema ? z.toJSONSchema(tool.schema) : { type: 'object', properties: {} };
    } catch (_e) {
      inputSchema = { type: 'object', properties: {} };
    }
    return {
      name: tool.name,
      description: tool.description || '',
      inputSchema,
    };
  });
}
```

Replace with:

```javascript
/**
 * Build the description for a core tool overridden with vertical terminology.
 * Returns null if no override applies (tool is not a core shared tool, or
 * manifest has no terminology).
 */
function _buildVerticalToolDescription(toolName, terminology) {
  if (!terminology) return null;
  const t = terminology;
  switch (toolName) {
    case 'get_my_accounts':
      return `List the user's ${t.accounts || 'accounts'} with details including ${t.account || 'account'} type, masked number, ${t.balance || 'balance'}, and currency. Use this for any request about ${t.account || 'account'} information or overview.`;
    case 'get_account_balance':
      return `Get the ${t.balance || 'balance'} for a specific ${t.account || 'account'}. Use account ID (not account number) from get_my_accounts.`;
    case 'get_my_transactions':
      return `List the user's recent ${t.transactions || 'transactions'}. Each entry shows ${t.transaction || 'transaction'} type, amount, description, and date.`;
    case 'create_transfer':
      return `Submit a new ${t.highValueAction || 'transfer'} between ${t.accounts || 'accounts'}. Requires source account ID, destination account ID, and amount in dollars.`;
    default:
      return null;
  }
}

function buildToolSchemasForAgentForVertical(manifest) {
  const tools = getBankingToolDefinitions();
  const terminology = manifest && manifest.terminology ? manifest.terminology : null;
  return tools.map((tool) => {
    let inputSchema;
    try {
      inputSchema = tool.schema ? z.toJSONSchema(tool.schema) : { type: 'object', properties: {} };
    } catch (_e) {
      inputSchema = { type: 'object', properties: {} };
    }
    const overrideDesc = _buildVerticalToolDescription(tool.name, terminology);
    return {
      name: tool.name,
      description: overrideDesc !== null ? overrideDesc : (tool.description || ''),
      inputSchema,
    };
  });
}

// Backwards-compatible wrapper — used internally in processAgentMessage
function buildToolSchemasForAgent() {
  const { getActiveManifest } = require('./verticalConfigService');
  const manifest = getActiveManifest();
  return buildToolSchemasForAgentForVertical(manifest);
}
```

Also add `buildToolSchemasForAgentForVertical` to the file's exports. Find at the bottom of the file the `module.exports` block (or the line that exports `processAgentMessage`):

```bash
grep -n "module.exports" /Users/curtismuir/Development/AI-Demo/demo_api_server/services/bankingAgentLangGraphService.js
```

Add `buildToolSchemasForAgentForVertical` to whatever export mechanism the file uses. If using `module.exports = { processAgentMessage }`, extend it:

```javascript
module.exports = { processAgentMessage, buildToolSchemasForAgentForVertical };
```

- [ ] **Step 11.4: Run test to confirm it passes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest bankingAgentToolSchemas --no-coverage 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/services/bankingAgentLangGraphService.js \
        demo_api_server/tests/bankingAgentToolSchemas.test.js
git commit -m "feat(verticals): BFF injects per-vertical tool description overrides for shared MCP tools

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Inject `systemPromptFlavor` into BFF Reason Loop

**Files:**
- Modify: `demo_agent_service/src/reasonContract.ts:17–27`
- Modify: `demo_agent_service/src/agentOrchestrator.ts` (thread `systemPrompt` into first message)
- Modify: `demo_api_server/services/bankingAgentLangGraphService.js:719–730` (`runReasonLoop` call)
- Test: existing `demo_agent_service` tests — run to confirm nothing broken

### What to change

The reason loop at `:3006` currently receives only `messages[]` and `tools[]`. There is no system prompt field. Adding one lets the BFF inject vertical context without changing the LLM provider logic.

#### Part A: Add `systemPrompt` to `ReasonRequest`

- [ ] **Step 12.1: Read `reasonContract.ts`**

```bash
cat demo_agent_service/src/reasonContract.ts
```

- [ ] **Step 12.2: Add optional `systemPrompt` field**

In `demo_agent_service/src/reasonContract.ts`, find:

```typescript
export interface ReasonRequest {
  messages: ReasonMessage[];
  tools: ReasonToolSchema[];
  provider: 'helix' | 'ollama' | 'anthropic'; // already resolved by the BFF
  model?: string;
  // Helix connection config (BFF-owned; passed through, never a token)
  helixConfig?: Record<string, string | undefined>;
  ollamaBaseUrl?: string;
  // Anthropic — API key passed from BFF env; never a user token
  anthropicApiKey?: string;
}
```

Replace with:

```typescript
export interface ReasonRequest {
  messages: ReasonMessage[];
  tools: ReasonToolSchema[];
  provider: 'helix' | 'ollama' | 'anthropic'; // already resolved by the BFF
  model?: string;
  // Optional system prompt injected by the BFF (e.g. vertical persona).
  // When present, the orchestrator prepends a system message before all
  // user/assistant turns.
  systemPrompt?: string;
  // Helix connection config (BFF-owned; passed through, never a token)
  helixConfig?: Record<string, string | undefined>;
  ollamaBaseUrl?: string;
  // Anthropic — API key passed from BFF env; never a user token
  anthropicApiKey?: string;
}
```

#### Part B: Thread `systemPrompt` into the orchestrator

- [ ] **Step 12.3: Find where messages are prepared in `agentOrchestrator.ts`**

```bash
grep -n "messages\|systemPrompt\|system\|buildMessages" demo_agent_service/src/agentOrchestrator.ts | head -30
```

Look for where the `ReasonRequest.messages` array is passed to the LLM. The orchestrator needs to prepend a `{ role: 'system', content: systemPrompt }` message before the user messages when `systemPrompt` is present.

- [ ] **Step 12.4: Prepend system message in orchestrator**

Find the code path where `request.messages` is passed to the LLM (likely in `agentOrchestrator.ts`). It will look something like:

```typescript
const messages = request.messages;
// OR
const response = await llm.invoke(request.messages, ...);
```

Wrap it to prepend the system message:

```typescript
const messages: ReasonMessage[] = request.systemPrompt
  ? [{ role: 'system' as const, content: request.systemPrompt }, ...request.messages]
  : request.messages;
```

Then use `messages` (not `request.messages`) in the LLM invocation.

Note: The `ReasonMessage` interface currently allows `role: 'user' | 'assistant' | 'tool'`. If `'system'` is not in the union, extend it:

```typescript
export interface ReasonMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  // ... rest unchanged
}
```

- [ ] **Step 12.5: Build demo_agent_service to confirm no TypeScript errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_agent_service
npm run build 2>&1 | tail -20
```
Expected: exit 0, no TS errors.

#### Part C: BFF injects systemPrompt into runReasonLoop call

- [ ] **Step 12.6: Read the runReasonLoop call site**

In `demo_api_server/services/bankingAgentLangGraphService.js`, find line ~719:

```javascript
const loopResult = await runReasonLoop({
  messages: [{ role: 'user', content: message }],
  tools: toolSchemas,
  provider,
  model,
  helixConfig: extractHelixConfig(langchainConfig),
  ollamaBaseUrl: langchainConfig && langchainConfig.ollama_base_url,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  maxIterations: MAX_TOOL_ITERATIONS,
  executeTool: async (name, args) =>
    executeBffTool({ name, args, userId, userToken, req, tokenEvents, sessionId }),
});
```

- [ ] **Step 12.7: Add `systemPrompt` to the call**

Add `getActiveManifest` to the requires at the top of the BFF service file. Find the existing require for `verticalConfigService`:

```bash
grep -n "verticalConfigService" demo_api_server/services/bankingAgentLangGraphService.js | head -5
```

If it's not required yet, find the `buildToolSchemasForAgent` function (which already calls `require('./verticalConfigService')` inline as of Task 11) — change that inline require to a top-level require at the top of the file.

Find the top `require` block (lines 1–22) and add:

```javascript
const { getActiveManifest } = require('./verticalConfigService');
```

Then find the `buildToolSchemasForAgent` wrapper (from Task 11) and remove its inline require since it's now at the top.

Then in the `runReasonLoop` call (line ~719), add `systemPrompt`:

```javascript
const manifest = getActiveManifest();
const toolSchemas = buildToolSchemasForAgentForVertical(manifest);
const systemPrompt = manifest && manifest.agent && manifest.agent.systemPromptFlavor
  ? manifest.agent.systemPromptFlavor
  : undefined;

const loopResult = await runReasonLoop({
  messages: [{ role: 'user', content: message }],
  tools: toolSchemas,
  provider,
  model,
  systemPrompt,
  helixConfig: extractHelixConfig(langchainConfig),
  ollamaBaseUrl: langchainConfig && langchainConfig.ollama_base_url,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  maxIterations: MAX_TOOL_ITERATIONS,
  executeTool: async (name, args) =>
    executeBffTool({ name, args, userId, userToken, req, tokenEvents, sessionId }),
});
```

Note: `buildToolSchemasForAgent()` call at line 711 should also be replaced with `buildToolSchemasForAgentForVertical(manifest)` to avoid calling `getActiveManifest()` twice. Remove the old `buildToolSchemasForAgent()` call entirely and use the `toolSchemas` from the new block above.

- [ ] **Step 12.8: Run BFF tests**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npm test 2>&1 | tail -30
```
Expected: all tests pass; no new failures.

- [ ] **Step 12.9: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_agent_service/src/reasonContract.ts \
        demo_agent_service/src/agentOrchestrator.ts \
        demo_api_server/services/bankingAgentLangGraphService.js
git commit -m "feat(verticals): inject vertical systemPromptFlavor into BFF reason loop

- ReasonRequest gains optional systemPrompt field
- agentOrchestrator prepends system message when present
- BFF injects manifest.agent.systemPromptFlavor on every agent call

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 13: LangChain Agent — Inject Vertical Persona

**Files:**
- Modify: `langchain_agent/src/agent/langchain_mcp_agent.py:118–204` (`_build_system_message`)

### What to change

The LangChain agent runs as a separate Python process (`:8888`). It has no direct access to the Node `verticalConfigService`. The simplest approach that avoids an HTTP round-trip on every session: the BFF already sends a `session_init` message when establishing the WebSocket to `:8888`. Add a `vertical_flavor` field to that message; the LangChain agent reads it in `_handle_session_init` and stores it in session state. `_build_system_message()` prepends it to the system prompt if present.

#### Part A: BFF sends `vertical_flavor` in `session_init`

The BFF's WebSocket proxy to `:8888` is in `demo_api_server` — find where `session_init` is sent:

- [ ] **Step 13.1: Find where BFF sends session_init to LangChain**

```bash
grep -rn "session_init\|langchain.*init\|8888\|8889\|langchain_ws\|langchainWs" /Users/curtismuir/Development/AI-Demo/demo_api_server/ --include="*.js" | grep -v "node_modules" | head -20
```

Read the found file(s) to see the `session_init` message shape.

- [ ] **Step 13.2: Add `vertical_flavor` to the session_init message**

In the BFF file that constructs the `session_init` message to `:8888`, find the object literal (looks like `{ type: 'session_init', session_id: ..., auth_token: ..., ... }`).

Add `vertical_flavor`:

```javascript
const manifest = getActiveManifest();
const verticalFlavor = (manifest && manifest.agent && manifest.agent.systemPromptFlavor) || null;

// In the session_init message:
{
  type: 'session_init',
  session_id: sessionId,
  auth_token: userToken,
  // ... existing fields ...
  vertical_flavor: verticalFlavor,
}
```

- [ ] **Step 13.3: LangChain `_handle_session_init` — store `vertical_flavor`**

In `langchain_agent/src/api/websocket_handler.py`, find `_handle_session_init` (line 270). After the session is created, read `vertical_flavor` from the message and store it in session state:

```python
vertical_flavor = message.get("vertical_flavor")
if self._session_manager and session_id and vertical_flavor:
    await self._session_manager.update_session_context(
        session_id, {"vertical_flavor": vertical_flavor}
    )
```

Check what `update_session_context` signature looks like:

```bash
grep -n "update_session_context\|def update" /Users/curtismuir/Development/AI-Demo/langchain_agent/src/ -r | head -10
```

Use the correct method to persist per-session data. If `update_session_context` doesn't exist, store it directly on the session object as appropriate for the session manager implementation.

- [ ] **Step 13.4: `_build_system_message` prepends vertical flavor**

In `langchain_agent/src/agent/langchain_mcp_agent.py`, find `_build_system_message` (line 118). It currently begins building `tool_descriptions` and then returns a hardcoded string starting with "You are a helpful AI banking assistant...".

Add vertical flavor lookup before the final `return`:

```python
async def _build_system_message(self, session_id: str) -> str:
    """Build the system prompt string for the given session."""
    # ... existing tool_descriptions and user_context logic (keep unchanged) ...

    # Fetch vertical persona from session context (set during session_init)
    vertical_flavor = None
    if self._session_manager:
        try:
            session = await self._session_manager.get_session(session_id)
            if session and hasattr(session, 'context') and session.context:
                vertical_flavor = session.context.get('vertical_flavor')
        except Exception:
            pass  # Vertical flavor is best-effort; never break the session

    base_persona = vertical_flavor if vertical_flavor else "You are a helpful AI banking assistant that can perform actions through various MCP (Model Context Protocol) servers."

    return f"""{base_persona}

{user_context}

Account Registration Process:
When registering a new user, collect the following information conversationally:
1. Email address (already provided during lookup)
2. First name and last name
3. Phone number
4. Date of birth (YYYY-MM-DD format)
5. Complete address (street, city, state, zip code, country)

Then use the user_management_account_registration tool with all collected information.

You have access to tools that can interact with external systems and APIs. When a user asks you to do something that requires external actions, use the appropriate tools to help them.

Key guidelines:
1. ALWAYS start by asking for the user's email address if they haven't been identified yet
2. Use banking_query_user_by_email to verify user existence before any banking operations
3. If user doesn't exist, guide them through account registration
4. When collecting registration info, ask for one piece of information at a time in a friendly, conversational manner
5. Validate information format (especially email, phone, date of birth) before proceeding
6. When a user asks to transfer money, use the banking_create_transfer tool (only after user identification)
7. When a user asks to check account balances, use the banking_get_account_balance tool (only after user identification)
8. When a user asks to list accounts, use the banking_get_my_accounts tool (only after user identification)
9. When a user asks about transactions, use the banking_get_my_transactions tool (only after user identification)
10. IMPORTANT: Account IDs are critical for operations. When you retrieve accounts with banking_get_my_accounts, the response includes account IDs that you MUST use for other operations like transfers, balance checks, etc.
11. When users refer to accounts by type, use the account ID from the most recent account listing
12. If you need to perform operations on specific accounts but don't have recent account information, first call banking_get_my_accounts to get current account IDs
13. TRANSFER REVERSALS: When a user asks to reverse or undo a transfer, look at the conversation history for the most recent transfer details. A reversal means transferring the same amount back from the destination account to the source account.
14. Pay close attention to the conversation history — recent transfers will show the exact account IDs and amounts that can be used for reversals
15. Explain what you're doing when using tools
16. Handle authentication challenges gracefully by informing the user when authorization is needed
17. Provide clear, helpful responses based on tool results
18. If a tool fails, explain the error and suggest alternatives when possible
19. Be conversational and friendly when collecting user information for registration
20. Before calling any tool marked as destructive (such as create_withdrawal, create_transfer, freeze_account, or delete_customer), state clearly what you are about to do and what the effect will be, so the user understands the action before it executes.

Available tools:
{tools_info}"""
```

- [ ] **Step 13.5: Verify Python syntax**

```bash
cd /Users/curtismuir/Development/AI-Demo/langchain_agent
python3 -c "import ast; ast.parse(open('src/agent/langchain_mcp_agent.py').read()); print('Syntax OK')"
```
Expected: `Syntax OK`.

- [ ] **Step 13.6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add langchain_agent/src/agent/langchain_mcp_agent.py \
        langchain_agent/src/api/websocket_handler.py
git commit -m "feat(verticals): LangChain agent reads vertical_flavor from session_init; prepends to system prompt

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Also commit any BFF file changes from Step 13.2:

```bash
git add demo_api_server/ -u
git commit -m "feat(verticals): BFF sends vertical_flavor in session_init to LangChain agent

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Full Regression + Build

**Files:** No changes — verification only.

- [ ] **Step 14.1: Run full test suite**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm test 2>&1 | tail -40
```
Expected: all tests pass; no new failures.

- [ ] **Step 14.2: Build demo_api_ui**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```
Expected: exit 0.

- [ ] **Step 14.3: Build demo_agent_service**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_agent_service
npm run build 2>&1 | tail -10
```
Expected: exit 0, no TypeScript errors.

- [ ] **Step 14.4: Build demo_mcp_server (no changes, quick check)**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_mcp_server
npm run build 2>&1 | tail -10
```
Expected: exit 0.

- [ ] **Step 14.5: Smoke test — vertical switcher dropdown**

Start the app and verify admin does NOT appear in the vertical switcher:

```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh
```

Navigate to `https://api.ping.demo:4000` → Admin page → Vertical tab. Confirm the dropdown shows: banking, retail, healthcare, sporting-goods, workforce — but NOT admin.

- [ ] **Step 14.6: Smoke test — agent persona per vertical**

For retail vertical, trigger agent with "list my accounts":
- Expected BFF path: tool description says "Loyalty Accounts", LLM reply uses retail language
- Expected LangChain path: system prompt begins with Great Buy persona

For workforce vertical:
- Expected: LLM reply uses "benefits account" / "PTO" / "expense" language, not "savings" / "checking"

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Admin NOT in vertical switcher dropdown | Task 9 |
| `systemPromptFlavor` free of meta-commentary, professional quality | Task 10 |
| BFF agent tool descriptions use vertical terminology | Task 11 |
| BFF reason loop receives vertical system prompt | Task 12 |
| LangChain agent receives vertical system prompt | Task 13 |
| All tests pass, builds clean | Task 14 |
| Both agents covered (BFF + LangChain) | Tasks 12, 13 |

### Placeholder scan

All code blocks are complete. No TBD or "similar to Task N" references.

### Type consistency

- `ReasonRequest.systemPrompt?: string` — optional, so all existing callers compile without change.
- `ReasonMessage.role` union extended to include `'system'` only in `agentOrchestrator.ts` usage — `reasonContract.ts` update ensures TypeScript agreement.
- `buildToolSchemasForAgentForVertical(manifest)` — `manifest` is the return type of `getActiveManifest()` (typed as the full vertical config object). The function only accesses `manifest.terminology` and guards with `manifest && manifest.terminology ? ... : null`, so it is null-safe.

### Edge cases confirmed

- **Banking vertical** (`terminology: null`): `_buildVerticalToolDescription` returns `null` for all tools → original descriptions used. Behavior unchanged.
- **LangChain session_init without `vertical_flavor`**: `message.get("vertical_flavor")` returns `None` → no `update_session_context` call → `_build_system_message` falls back to the banking default. Backward compatible.
- **`runReasonLoop` with `systemPrompt: undefined`**: If `manifest.agent.systemPromptFlavor` is absent, `systemPrompt` is `undefined`. The orchestrator checks `request.systemPrompt ? [...] : request.messages` → uses original messages array unchanged. Backward compatible.
- **Admin vertical config access**: `getVerticalConfig('admin')` still works (used by admin page). Only `listVerticals()` filters it out.
