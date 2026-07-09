# Bedrock AgentCore Gateway + Bedrock LLM Implementation Plan

> **For agentic workers:** Work in an isolated git worktree; stage files explicitly (`git add <files>`), never `git add -A`; verify `git branch --show-current` before each commit. Invoke regression-guard before touching protected areas (`REGRESSION_PLAN.md` §1).

**Goal:** Add optional AWS paths on EKS — AgentCore Gateway for MCP tool calls and Bedrock Converse for LLM reasoning — gated by independent feature flags default OFF, with token-chain observability and a blessed demo chip.

**Spec:** `docs/superpowers/specs/2026-07-09-bedrock-agentcore-integration-design.md`

**Architecture:** Two parallel adapters in the BFF (`bedrockGatewayClient`, `bedrockAuthBridge`) branch from existing MCP/LLM resolver chokepoints (`mcpGatewayClient`, `llmProviderResolver`). Agent-service gains a `bedrock` provider via `@aws-sdk/client-bedrock-runtime`. UI extends token chain with AWS product chips. Infra lives under `k8s/aws/bedrock/`. Local dev unchanged when flags OFF.

**Tech Stack:** Node.js (BFF), TypeScript (demo_agent_service), React (demo_api_ui), AWS SDK v3, AgentCore Gateway (managed), IRSA on EKS, jest.

## Global Constraints

- **EKS gate:** Bedrock flags have no effect unless `AWS_DEPLOYMENT=1`. Without it → 503, never silent fallback.
- **Default OFF:** Both flags default `false`, `warnIfEnabled: true`. Regression baseline = flags OFF.
- **Token custody:** BFF only. No AWS tokens in SPA or agent-service session storage.
- **Cost:** `BEDROCK_MAX_TURNS_PER_SESSION` default 3. Integration tests gated behind `BEDROCK_INTEGRATION=1`.
- **Dual registry:** Every new flag in `featureFlags.js` FLAG_REGISTRY **and** `configStore.js` defaults/env mapping.
- **No secrets in repo:** Document env vars in `.env.example` only (commented).
- **Protected areas:** OAuth/RFC 8693, BFF session, `runMcpToolPipeline` outcome contract — minimal seam edits only.
- BFF unit tests: `cd demo_api_server && npx jest tests/<file> --forceExit`
- Agent-service tests: `cd demo_agent_service && npm test -- <file>`

---

## Phase P1 — Flags + resolver scaffolding (no real AWS calls)

### Task 1: Feature flag registry + configStore sync

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js`
- Modify: `demo_api_server/services/configStore.js`
- Create: `demo_api_server/tests/featureFlags.bedrock.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// demo_api_server/tests/featureFlags.bedrock.test.js
const { FLAG_REGISTRY } = require('../routes/featureFlags');

describe('Bedrock feature flags', () => {
  const ids = ['ff_bedrock_agentcore_gateway', 'ff_bedrock_llm'];
  for (const id of ids) {
    it(`${id} exists with safe defaults`, () => {
      const flag = FLAG_REGISTRY.find((f) => f.id === id);
      expect(flag).toBeDefined();
      expect(flag.defaultValue).toBe(false);
      expect(flag.warnIfEnabled).toBe(true);
      expect(flag.category).toBe('AWS / Bedrock');
      expect(flag.runtimeKey).toBeTruthy();
    });
  }
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd demo_api_server && npx jest tests/featureFlags.bedrock.test.js --forceExit`

- [ ] **Step 3: Add flags to FLAG_REGISTRY**

Add after the MCP gateway flags block:

```javascript
{
  id: 'ff_bedrock_agentcore_gateway',
  name: 'Bedrock AgentCore Gateway',
  category: 'AWS / Bedrock',
  description: 'Route MCP tool calls through Amazon Bedrock AgentCore Gateway (EKS only). Complements Ping/demo gateway; does not replace local dev path.',
  impact: 'OFF (default) = demo_mcp_gateway / PingGateway unchanged. ON + AWS_DEPLOYMENT=1 = AgentCore Gateway MCP endpoint.',
  type: 'boolean',
  defaultValue: false,
  warnIfEnabled: true,
  runtimeKey: 'bedrockGatewayEnabled',
},
{
  id: 'ff_bedrock_llm',
  name: 'Bedrock LLM',
  category: 'AWS / Bedrock',
  description: 'Use Amazon Bedrock Converse API for agent reasoning (EKS only). Default model: Haiku (cost-conscious).',
  impact: 'OFF (default) = llama.cpp / Helix unchanged. ON + AWS_DEPLOYMENT=1 = Bedrock Converse via IRSA.',
  type: 'boolean',
  defaultValue: false,
  warnIfEnabled: true,
  runtimeKey: 'bedrockLlmEnabled',
},
```

Add env mappings in configStore (mirror `ff_mcp_gateway_pinggateway` pattern):

```javascript
ff_bedrock_agentcore_gateway: { public: false, default: 'false' },
ff_bedrock_llm:               { public: false, default: 'false' },
```

And in the env-var alias tables: `FF_BEDROCK_AGENTCORE_GATEWAY`, `FF_BEDROCK_LLM`.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/services/configStore.js demo_api_server/tests/featureFlags.bedrock.test.js
git commit -m "feat(flags): add Bedrock gateway and LLM feature flags (default OFF)"
```

---

### Task 2: AWS deployment gate helper

**Files:**
- Create: `demo_api_server/services/bedrockPathGate.js`
- Create: `demo_api_server/tests/bedrockPathGate.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe('bedrockPathGate', () => {
  it('isAwsDeployment returns true when AWS_DEPLOYMENT=1', () => { /* ... */ });
  it('isBedrockGatewayEffective requires flag AND aws', () => { /* ... */ });
  it('isBedrockLlmEffective requires flag AND aws', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement**

```javascript
// bedrockPathGate.js
function isAwsDeployment() {
  return process.env.AWS_DEPLOYMENT === '1';
}
function isFlagOn(key) {
  return configStore.getEffective(key) === 'true';
}
function isBedrockGatewayEffective() {
  return isAwsDeployment() && isFlagOn('ff_bedrock_agentcore_gateway');
}
function isBedrockLlmEffective() {
  return isAwsDeployment() && isFlagOn('ff_bedrock_llm');
}
function assertBedrockPath(kind) {
  if (!isAwsDeployment()) {
    const err = new Error(`Bedrock ${kind} path requires AWS deployment (AWS_DEPLOYMENT=1)`);
    err.code = 'bedrock_aws_required';
    err.httpStatus = 503;
    throw err;
  }
}
module.exports = { isAwsDeployment, isBedrockGatewayEffective, isBedrockLlmEffective, assertBedrockPath };
```

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

### Task 3: LLM resolver branch (stub)

**Files:**
- Modify: `demo_api_server/services/llmProviderResolver.js`
- Create: `demo_api_server/tests/llmProviderResolver.bedrock.test.js`

- [ ] **Step 1: Test — flag OFF unchanged; flag ON + AWS → bedrock**

- [ ] **Step 2: Add branch**

```javascript
const { isBedrockLlmEffective } = require('./bedrockPathGate');

// Inside resolveLlmProvider, after explicit provider checks:
if (isBedrockLlmEffective()) {
  return { provider: 'bedrock', model: process.env.BEDROCK_MODEL_ID };
}
```

Also honor explicit `requested === 'bedrock'` when AWS gate passes (pass-through pattern).

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

### Task 4: Gateway resolver branch (stub client)

**Files:**
- Create: `demo_api_server/services/bedrockGatewayClient.js` (stub throws `bedrock_not_configured` until P3)
- Modify: `demo_api_server/services/mcpGatewayClient.js` — export `resolveMcpGatewayTransport()`
- Create: `demo_api_server/tests/mcpGatewayResolver.bedrock.test.js`

- [ ] **Step 1: Test routing**

When `isBedrockGatewayEffective()` → transport `{ kind: 'agentcore', url: AGENTCORE_GATEWAY_URL }`.  
When flag ON but no AWS → 503 via `assertBedrockPath`.  
When flag OFF → `{ kind: 'demo', url: getMcpGatewayHttpUrl() }` (existing).

- [ ] **Step 2: Implement resolver + stub client**

`bedrockGatewayClient.callToolViaAgentCore()` — for P1, if `AGENTCORE_GATEWAY_URL` missing, throw 503 with config hint.

- [ ] **Step 3: Wire into `mcpToolPipeline.js` deps seam**

In the pipeline's gateway call site, branch:

```javascript
if (isBedrockGatewayEffective()) {
  ({ result, gwAuditTrail } = await bedrockGatewayClient.callToolViaAgentCore(...));
} else {
  ({ result, gwAuditTrail } = await deps.callToolViaGateway(...));
}
```

Keep characterization test green with flags OFF.

- [ ] **Step 4: Run `mcpToolPipeline.characterization.test.js` + new bedrock resolver test**

- [ ] **Step 5: Commit**

---

## Phase P2 — Bedrock LLM provider

### Task 5: Agent-service Bedrock Converse provider

**Files:**
- Modify: `demo_agent_service/src/config.ts` — add `'bedrock'` to `VALID_LLM_PROVIDERS` and `AgentConfig.llmProvider`
- Modify: `demo_agent_service/src/reasonContract.ts` — add `'bedrock'` to provider union
- Modify: `demo_agent_service/src/reasoningGraph.ts` — `reasonOnce` bedrock branch
- Modify: `demo_agent_service/package.json` — add `@aws-sdk/client-bedrock-runtime`
- Create: `demo_agent_service/tests/reasoningGraph.bedrock.test.ts`
- Modify: `demo_agent_service/tests/config.test.ts`

- [ ] **Step 1: Write failing test with mocked BedrockRuntimeClient**

Assert ConverseCommand shape, model ID from request, token usage extracted into teachLog metadata.

- [ ] **Step 2: Implement bedrock branch in reasonOnce**

```typescript
if (req.provider === 'bedrock') {
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  const response = await client.send(new ConverseCommand({
    modelId: req.model || process.env.BEDROCK_MODEL_ID,
    messages: [/* map from req */],
    inferenceConfig: { maxTokens: 1024 },
  }));
  // Map tool_calls if present; return ReasonOnceResult
}
```

One retry on `ThrottlingException`.

- [ ] **Step 3: Startup validation**

When `LLM_PROVIDER=bedrock`, require `AWS_REGION` and `BEDROCK_MODEL_ID` (or fail fast in loadConfig).

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

---

### Task 6: BFF cost cap + trace events for Bedrock LLM

**Files:**
- Create: `demo_api_server/services/bedrockTurnBudget.js`
- Modify: `demo_api_server/services/unifiedTrace.js` (or existing trace emitter used by agent routes)
- Create: `demo_api_server/tests/bedrockTurnBudget.test.js`

- [ ] **Step 1: Session-scoped turn counter**

Key: `sessionId` in BFF session state. Max from `BEDROCK_MAX_TURNS_PER_SESSION` (default 3). Return 429 when exceeded.

- [ ] **Step 2: Emit `bedrock-converse` trace event**

Fields: `modelId`, `region`, `inputTokens`, `outputTokens`, `latencyMs`.

- [ ] **Step 3: Tests — PASS**

- [ ] **Step 4: Commit**

---

### Task 7: EKS IRSA for Bedrock invoke

**Files:**
- Create: `k8s/aws/bedrock/irsa-bedrock-policy.json`
- Modify: `k8s/aws/deploy.sh` (or document manual step in plan README)

- [ ] **Step 1: IAM policy document**

```json
{
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    "Resource": "arn:aws:bedrock:*::foundation-model/*"
  }]
}
```

- [ ] **Step 2: Annotate agent-service ServiceAccount in k8s manifest**

- [ ] **Step 3: Document in `k8s/aws/bedrock/README.md` (stub until Task 12)**

- [ ] **Step 4: Commit**

---

## Phase P3 — AgentCore Gateway client + auth bridge

### Task 8: bedrockAuthBridge (AgentCore Identity 3LO)

**Files:**
- Create: `demo_api_server/services/bedrockAuthBridge.js`
- Create: `demo_api_server/tests/bedrockAuthBridge.test.js`

- [ ] **Step 1: Session store for AgentCore binding**

Per BFF session: `{ agentcoreSessionId, boundAt, expiresAt }`. Persist in existing session object (not new cookie).

- [ ] **Step 2: bindSession(bearerToken, opts)**

Calls AgentCore Identity OAuth flow endpoints per AWS docs. On first tool call, may return `{ needsRedirect: true, authUrl }` — BFF surfaces 428 with education payload for demo (or admin pre-binds during deploy sync).

- [ ] **Step 3: reauth on expiry — emit `agentcore-reauth` trace**

- [ ] **Step 4: Tests with mocked HTTP — no live AWS**

- [ ] **Step 5: Commit**

> **HARD GATE (Task 8):** Do not proceed to Task 9 until PingOne ↔ AgentCore Identity OAuth mapping is confirmed with AWS (spec open question #1). Stub may ship; live 3LO requires credentials.

---

### Task 9: bedrockGatewayClient (real MCP calls)

**Files:**
- Modify: `demo_api_server/services/bedrockGatewayClient.js`
- Create: `demo_api_server/tests/bedrockGatewayClient.test.js`

- [ ] **Step 1: Implement callToolViaAgentCore**

Mirror `mcpGatewayClient.callToolViaGateway` contract: same return shape `{ result, gwAuditTrail }`, same error mapping (`mcp_tool_error`, HITL rpcData preservation).

Headers: `Authorization: Bearer <agentcore-bound-token>`, `MCP-Protocol-Version: 2025-11-25`.

- [ ] **Step 2: Emit `agentcore-gateway` trace**

Fields: `tool`, `targetId`, `latencyMs`, `gatewayUrl` (host only, no secrets).

- [ ] **Step 3: Unit tests — mocked axios**

- [ ] **Step 4: Commit**

---

### Task 10: AgentCore Gateway infra scripts

**Files:**
- Create: `k8s/aws/bedrock/create-gateway.sh`
- Create: `k8s/aws/bedrock/register-mcp-target.sh`
- Create: `k8s/aws/bedrock/sync-targets.sh`
- Create: `k8s/aws/bedrock/README.md`

- [ ] **Step 1: create-gateway.sh**

AWS CLI / boto3 script: create AgentCore Gateway with MCP protocol `2025-11-25`. Output `AGENTCORE_GATEWAY_URL`.

- [ ] **Step 2: register-mcp-target.sh**

Register MCP target pointing at `https://<ALB>/mcp` (banking_mcp_server). OAuth via AgentCore Identity → PingOne. Authorization code grant (3LO).

- [ ] **Step 3: sync-targets.sh**

Wrap `SynchronizeGatewayTargets` API. Emit `agentcore-sync` event hook (optional log line for operators).

- [ ] **Step 4: README with prerequisites and env var table**

- [ ] **Step 5: Commit**

> **HARD GATE (Task 10):** Live verification requires EKS cluster + AgentCore enabled in account/region. If API unavailable, commit scripts as dry-run documented stubs.

---

## Phase P4 — Demo polish + UI observability

### Task 11: AWS product chips in token chain

**Files:**
- Create: `demo_api_ui/src/utils/awsProducts.js`
- Create: `demo_api_ui/src/components/AwsProductChip.js`
- Create: `demo_api_ui/src/components/AwsProductChip.css`
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js`
- Modify: `demo_api_ui/src/utils/pingProducts.test.js` (ensure no collision)

- [ ] **Step 1: awsProducts registry**

```javascript
export const AWS_PRODUCTS = {
  agentcore: { id: 'agentcore', label: 'AgentCore Gateway', cssClass: 'ap--agentcore' },
  bedrock:   { id: 'bedrock',   label: 'Amazon Bedrock',    cssClass: 'ap--bedrock' },
};
const STEP_MAP = {
  'agentcore-gateway': 'agentcore',
  'agentcore-sync': 'agentcore',
  'agentcore-reauth': 'agentcore',
  'bedrock-converse': 'bedrock',
};
```

- [ ] **Step 2: Render chip alongside PingProductChip in TokenChainDisplay**

- [ ] **Step 3: Agent chip badge in AIAgent.js when flags active**

Read public effective flags from config API (or session snapshot).

- [ ] **Step 4: Snapshot/unit test for new event IDs**

- [ ] **Step 5: Commit**

---

### Task 12: Education panel + blessed chip

**Files:**
- Create: `demo_api_ui/src/components/education/AwsBedrockPathPanel.js`
- Modify: education registry (where `EDU.*` constants live — grep `EDU.ENTERPRISE`)
- Modify: chip registry for `aws_enterprise_path`
- Create: `demo_api_ui/tests/e2e/aws-enterprise-path.spec.js` (mocked)

- [ ] **Step 1: Education panel**

Explain: PingOne login → RFC 8693 → AgentCore Gateway → MCP → Bedrock Converse. Show flag state. Warn when flags OFF.

- [ ] **Step 2: Blessed chip `aws_enterprise_path`**

Action routes to `get_accounts` with narration prefix. Requires both flags ON (UI warning otherwise).

- [ ] **Step 3: Playwright test with mocks**

Flags on → AWS badges visible. Flags off → warning, no bedrock API calls (assert network mock).

- [ ] **Step 4: Commit**

---

## Phase P5 — Docs + integration verify

### Task 13: Operator runbook

**Files:**
- Create: `docs/AWS_BEDROCK_PATH.md`
- Modify: `docs/AWS_DEPLOY.md` — link to Bedrock path section

- [ ] **Step 1: Document enable sequence**

1. Deploy EKS stack (`AWS_DEPLOYMENT=1`)
2. Run `k8s/aws/bedrock/create-gateway.sh`
3. Run `register-mcp-target.sh` + `sync-targets.sh`
4. Set secrets in k8s (gateway URL, model ID, region)
5. Enable flags in admin UI (both OFF by default)
6. Run blessed chip demo

- [ ] **Step 2: Cost guidance**

Default Haiku, turn cap, disable flags after demo.

- [ ] **Step 3: Rollback**

Flip flags OFF — instant revert.

- [ ] **Step 4: Commit**

---

### Task 14: Integration verify script

**Files:**
- Create: `scripts/verify-bedrock-path.sh`

- [ ] **Step 1: Script gates**

Requires `BEDROCK_INTEGRATION=1`, `AWS_DEPLOYMENT=1`, both flags ON, env vars set.

- [ ] **Step 2: Assert**

One MCP tool call + one agent turn via blessed flow; grep token chain API for `agentcore-gateway` and `bedrock-converse`; assert 429 on 4th turn.

- [ ] **Step 3: Document in runbook — NOT in default CI**

- [ ] **Step 4: Commit**

---

## Verification checklist (before marking complete)

- [ ] `./run-tests.sh unit` passes with flags OFF (regression baseline)
- [ ] New bedrock unit tests pass
- [ ] `REGRESSION_PLAN.md` §1 areas unchanged when flags OFF
- [ ] Token chain renders Ping events unchanged + new AWS events when ON
- [ ] Local `./run.sh` with flags ON but no `AWS_DEPLOYMENT` → 503, no AWS charges
- [ ] EKS dry-run: infra scripts documented; live test behind `BEDROCK_INTEGRATION=1`

## Task dependency graph

```text
P1: Task 1 → Task 2 → Task 3 ∥ Task 4
P2: Task 5 → Task 6; Task 7 (parallel)
P3: Task 8 → Task 9 → Task 10  (Task 8 HARD GATE for live 3LO)
P4: Task 11 ∥ Task 12 (after P2 trace events + P3 client stubs)
P5: Task 13 → Task 14 (after P4)
```

## Out of scope (do not implement in this plan)

- Replacing local `demo_mcp_gateway`
- Bedrock Knowledge Bases / Bedrock Agents runtime
- Layering AgentCore in front of PingGateway
- Committing AWS credentials or PingOne policy mutations
