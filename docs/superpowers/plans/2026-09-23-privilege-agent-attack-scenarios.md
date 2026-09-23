# Privilege Agent Attack Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, and Malicious Content run through their appropriate real enforcement paths and show truthful, testable outcomes in the LLM Gateway experience.

**Architecture:** Keep `guardrailAttackCatalog.js` as the menu metadata source, but dispatch non-chat scenarios to authenticated BFF scenario routes. Reuse the existing Privilege MCP relay and existing `/api/a2a` delegation flow; keep Privilege LLM content calls on the existing `/llm/call` route. Return a normalized evidence record that names the actual decision maker and model/backend reachability, then render it in the existing trace/reel without converting a local validation or model refusal into a Privilege verdict.

**Tech Stack:** React 19 + Vite + Vitest; Express 4 CommonJS + Jest/Supertest; existing Privilege LLM and MCP relays; existing A2A delegation services.

**Spec:** `docs/superpowers/specs/2026-09-23-privilege-agent-attack-scenarios-design.md`

## Global Constraints

- Node >= 22; BFF code is CommonJS and UI code is plain JS/JSX.
- The BFF remains the sole browser-token custodian; use existing session/auth gates and do not expose provider credentials to the UI.
- Never fake a Privilege verdict. Identify the actual enforcement component and distinguish policy deny, schema validation, model refusal, pass/no verdict, and transport failure.
- Scenario tools/agents use harmless fixtures; never execute shell payloads, perform real transfers, mutate real transactions, or delegate real credentials.
- Deterministic fixture mode must not depend on an LLM; live model mode is optional and explicitly labeled.
- Preserve current chat-only attack behavior and the project's emoji allowlist.
- Follow `REGRESSION_PLAN.md` §0–§1 before UI/auth-affecting edits; run UI unit tests and build for UI changes, focused Jest/Supertest for BFF changes.

---

## File map

- `demo_api_ui/src/config/guardrailAttackCatalog.js` — scenario ids, labels, safe prompt/content payloads, scenario dispatch metadata; remove executable ransomware and shell text from any payload submitted by the new runner.
- `demo_api_ui/src/pages/LlmGatewayPage.jsx` and `LlmGatewayReel.jsx` — selector dispatch and evidence presentation. Keep ordinary prompt attacks on the current chat route.
- `demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx` and a focused reel test if needed — selector routing, truthful attribution, reachability, and no-verdict rendering.
- `demo_api_server/routes/privilegeMcpClient.js` — existing session-bound Privilege MCP relay and agent-run behavior; extend only where it is the narrowest authenticated place to expose scenario execution.
- `demo_api_server/routes/a2aAgentRoutes.js` and `demo_api_server/services/demoAgentLangGraphService.js` / `a2aDelegationService.js` — existing A2A identity, handoff, and authorization flow; reuse it for a real inter-agent attempt, not a chat-only imitation.
- `demo_api_server/tests/routes/privilegeMcpClient.attackScenarios.test.js` (new) — fixture MCP scenarios, gateway/validator attribution, and backend reachability.
- `demo_api_server/tests/routes/a2aAgentRoutes.attackScenario.test.js` (new) — delegated identity/scope denial and proof Agent B did not execute.
- `demo_api_server/tests/routes/privilegeMcpClient.llmPanel.test.js` — existing LLM route regression coverage; extend only if content scenario request/result behavior changes.

## Chosen defaults for this plan

- Schema Violation may be rejected by the existing MCP adapter/schema boundary; the UI must name that validator unless Privilege returns an actual schema verdict.
- Tool Poisoning starts with hostile `tools/list` metadata. Tool-output poisoning remains a later variant unless it has a separately verified result.
- Inter-Agent Abuse reuses the existing A2A delegation and authorization flow mounted at `/api/a2a`; it does not introduce a parallel policy.
- Deterministic fixture mode is the baseline demo and test mode. Live Anthropic execution is optional, visibly marked, and never required for deterministic tests.

## Task 1: Define and test the normalized scenario evidence contract

**Files:**
- Create: `demo_api_server/services/agentAttackScenarioService.js`
- Test: `demo_api_server/tests/services/agentAttackScenarioService.test.js`

**Interface:** `runScenario({ scenarioId, mode, requestContext, adapters })` returns a promise of `{ scenarioId, mode, path, decision: { outcome, enforcementPoint, detail }, providerReached, backendReached, evidence }`. `outcome` is one of `deny`, `allow`, `validated_reject`, `no_verdict`, `model_refusal`, or `error`. `providerReached` and `backendReached` are booleans; no field may infer a Privilege decision from a local validator or provider response.

- [ ] **Step 1: Write contract tests for every outcome and attribution boundary.** Cover a Privilege deny, local schema reject, model refusal, allow/no verdict, and transport error. Assert the adapter call counts and returned reachability booleans.
- [ ] **Step 2: Run the focused test and verify it fails for the missing module.**

  Run: `cd demo_api_server && CI=true npx jest tests/services/agentAttackScenarioService.test.js --runInBand --forceExit`

  Expected: FAIL because `agentAttackScenarioService` does not exist.
- [ ] **Step 3: Implement the smallest service that validates scenario id/mode, invokes an injected scenario adapter, and normalizes its observed evidence.** The service must reject unknown ids before any adapter call and must not manufacture a verdict when evidence is absent.
- [ ] **Step 4: Re-run the focused service test and verify all contract cases pass.**
- [ ] **Step 5: Commit the service and test.**

  ```bash
  git add demo_api_server/services/agentAttackScenarioService.js demo_api_server/tests/services/agentAttackScenarioService.test.js
  git commit -m "feat: define agent attack scenario evidence contract"
  ```

## Task 2: Implement harmless MCP tool scenarios

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js`
- Modify: `demo_api_server/services/agentAttackScenarioService.js`
- Create: `demo_api_server/tests/routes/privilegeMcpClient.attackScenarios.test.js`
- Reference: `demo_api_ui/src/config/toolAttackCatalog.js`, `demo_api_server/services/attackSimulatorService.js`, `demo_api_server/routes/demoAttackSeeds.js`

**Interface:** Add a session-authenticated scenario endpoint under the existing Privilege MCP route, `POST /attack-scenarios/run`, accepting `{ scenarioId, mode }` for `tool_abuse`, `tool_poisoning`, or `schema_violation`. Responses use the Task 1 evidence contract. The endpoint must use the active session's configured relay for any live Privilege MCP request; deterministic tests inject fake relay and fixture-server adapters.

- [ ] **Step 1: Write route tests** for all three scenarios. Assert Tool Abuse produces a real gateway deny before fixture execution; Tool Poisoning returns the malicious fixture tool description unchanged and reports whether the attempted call is denied or passes; Schema Violation reports the actual rejecting layer and never reaches the fixture backend. Add unauthenticated and unknown-id cases.
- [ ] **Step 2: Run the focused route suite and confirm the new route is absent.**

  Run: `cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.attackScenarios.test.js --runInBand --forceExit`

  Expected: FAIL because the route/test adapters are not implemented.
- [ ] **Step 3: Implement the route using existing session checks, `callMcp` relay, and injected side-effect-free fixture adapters.** Never pass the catalog's destructive shell payload to a tool. For Tool Poisoning, serve a controlled poisoned tool description, capture the model proposal in deterministic mode, and submit any attempted call through the configured MCP relay; report metadata inspection separately from call authorization. For Schema Violation, preserve the gateway response and local schema result as separate evidence.
- [ ] **Step 4: Run the route suite and verify backend non-execution on deny/reject.**
- [ ] **Step 5: Run existing focused MCP regressions.**

  Run: `cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.llmPanel.test.js tests/routes/privilegeMcpClient.streamableHttp.test.js tests/routes/privilegeMcpClient.attackScenarios.test.js --runInBand --forceExit`

- [ ] **Step 6: Commit the MCP scenario route and tests.**

  ```bash
  git add demo_api_server/routes/privilegeMcpClient.js demo_api_server/services/agentAttackScenarioService.js demo_api_server/tests/routes/privilegeMcpClient.attackScenarios.test.js
  git commit -m "feat: add safe MCP attack scenarios"
  ```

## Task 3: Implement a real A2A abuse attempt

**Files:**
- Modify: `demo_api_server/routes/a2aAgentRoutes.js`
- Modify: `demo_api_server/services/a2aDelegationService.js` only if the existing flow lacks a safe scenario entry point
- Modify: `demo_api_server/services/agentAttackScenarioService.js`
- Create: `demo_api_server/tests/routes/a2aAgentRoutes.attackScenario.test.js`

**Interface:** `POST /api/a2a/attack-scenario` accepts `{ mode: 'deterministic' }` and uses the authenticated request identity. It attempts a fixed, harmless delegation with an intentionally unauthorized actor/scope. It returns the Task 1 evidence contract and the actual A2A authorization response; it must not accept caller-supplied tokens, scopes, or arbitrary Agent B operations.

- [ ] **Step 1: Write tests** asserting authenticated user context is used, the unauthorized delegation is denied by the existing policy path, and Agent B's fixture handler is not invoked. Assert denial attribution is the observed A2A/token/Authorize layer, not Privilege LLM.
- [ ] **Step 2: Run the focused test and confirm the scenario endpoint is absent.**

  Run: `cd demo_api_server && CI=true npx jest tests/routes/a2aAgentRoutes.attackScenario.test.js --runInBand --forceExit`

  Expected: FAIL because the attack-scenario route does not exist.
- [ ] **Step 3: Add the narrow scenario entry point and delegate through existing `a2aDelegationService` / protocol handoff.** Keep normal `/api/a2a` behavior unchanged; use the existing policy check and a fixture Agent B operation.
- [ ] **Step 4: Run the new suite plus the existing A2A route/service tests.**
- [ ] **Step 5: Commit the A2A scenario and tests.**

  ```bash
  git add demo_api_server/routes/a2aAgentRoutes.js demo_api_server/services/a2aDelegationService.js demo_api_server/services/agentAttackScenarioService.js demo_api_server/tests/routes/a2aAgentRoutes.attackScenario.test.js
  git commit -m "feat: demonstrate inter-agent authorization abuse"
  ```

## Task 4: Make Malicious Content safe and evidence-backed

**Files:**
- Modify: `demo_api_ui/src/config/guardrailAttackCatalog.js`
- Modify: `demo_api_server/routes/privilegeMcpClient.js` only if a new content-run mode is required
- Test: `demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx`
- Test: `demo_api_server/tests/routes/privilegeMcpClient.llmPanel.test.js` if BFF behavior changes

- [ ] **Step 1: Add regression assertions** that the selected Malicious Content payload is a safe, non-executable simulated sample, does not request working ransomware, and the displayed outcome follows the observed Privilege response.
- [ ] **Step 2: Run the focused UI test to verify current dangerous prompt/unsupported attribution is caught.**

  Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/LlmGatewayPage.test.jsx`

- [ ] **Step 3: Replace the working-ransomware request with a non-executable training fixture and route through the existing Privilege LLM `/llm/call` path.** Preserve actual pass/no-verdict behavior if policy does not act; distinguish a model refusal from a Privilege block and a redaction from a block.
- [ ] **Step 4: Run focused UI and, if changed, BFF LLM route tests.**
- [ ] **Step 5: Commit the safe content scenario and regressions.**

  ```bash
  git add demo_api_ui/src/config/guardrailAttackCatalog.js demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx demo_api_server/routes/privilegeMcpClient.js demo_api_server/tests/routes/privilegeMcpClient.llmPanel.test.js
  git commit -m "fix: make malicious content demo safe and truthful"
  ```

## Task 5: Route selector entries and render evidence

**Files:**
- Modify: `demo_api_ui/src/config/guardrailAttackCatalog.js`
- Modify: `demo_api_ui/src/pages/LlmGatewayPage.jsx`
- Modify: `demo_api_ui/src/pages/LlmGatewayReel.jsx`
- Test: `demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx`
- Test: reel test colocated under `demo_api_ui/src/pages/__tests__/` if a dedicated reel suite is needed

**Interface:** Add `scenarioPath` metadata to the four tool/agent entries. Ordinary prompt attacks and Malicious Content continue to use `/llm/call`; tool cases call `/api/privilege-mcp/attack-scenarios/run`; Inter-Agent Abuse calls `/api/a2a/attack-scenario`. UI consumes the normalized BFF evidence fields `scenarioId`, `mode`, `path`, `decision`, `providerReached`, `backendReached`, and `evidence`.

- [ ] **Step 1: Write UI tests** asserting each selector option dispatches to its scenario route, ordinary prompt attacks still dispatch to `/llm/call`, and UI copy accurately distinguishes Privilege deny, schema reject, model refusal, and no verdict. Assert both provider and backend reached states appear in the trace/reel.
- [ ] **Step 2: Run the focused UI suite and confirm the five entries still incorrectly submit as chat prompts.**

  Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/LlmGatewayPage.test.jsx`

- [ ] **Step 3: Implement selection dispatch, loading/error state, and evidence rendering.** Derive presenter text from returned evidence; do not use expected catalog effect as proof of the observed decision. Preserve manual prompt selection and existing local-provider compare behavior.
- [ ] **Step 4: Run all LLM Gateway page/reel unit tests and build the UI.**

  Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/LlmGatewayPage.test.jsx src/pages/__tests__/LlmGatewayPage.reelPlacement.test.jsx && npm run build`

- [ ] **Step 5: Commit selector dispatch and evidence presentation.**

  ```bash
  git add demo_api_ui/src/config/guardrailAttackCatalog.js demo_api_ui/src/pages/LlmGatewayPage.jsx demo_api_ui/src/pages/LlmGatewayReel.jsx demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx
  git commit -m "feat: route agent attack demos by enforcement path"
  ```

## Task 6: Verify the integrated five-scenario experience

**Files:**
- Test: `demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx`
- Test: `demo_api_server/tests/routes/privilegeMcpClient.attackScenarios.test.js`
- Test: `demo_api_server/tests/routes/a2aAgentRoutes.attackScenario.test.js`
- Modify docs only if observed run modes or configuration requirements need documenting.

- [ ] **Step 1: Run focused BFF test suites** with `CI=true` and no external network dependence.

  Run: `cd demo_api_server && CI=true npx jest tests/services/agentAttackScenarioService.test.js tests/routes/privilegeMcpClient.attackScenarios.test.js tests/routes/a2aAgentRoutes.attackScenario.test.js tests/routes/privilegeMcpClient.llmPanel.test.js --runInBand --forceExit`

- [ ] **Step 2: Run the focused UI tests and production build.**

  Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/LlmGatewayPage.test.jsx src/pages/__tests__/LlmGatewayPage.reelPlacement.test.jsx && npm run build`

- [ ] **Step 3: Review the five rendered traces against the spec checklist:** correct path, real enforcement label, provider reached, backend reached, deterministic/live mode, and no false Privilege claim. Confirm denied/rejected paths do not invoke fixture backends.
- [ ] **Step 4: Run `git diff --check`, inspect staged paths, and commit any final test-only corrections.**

## Self-review against the design spec

- All five attack classes have a task: MCP Tool Abuse/Poisoning/Schema Violation (Task 2), Inter-Agent Abuse (Task 3), Malicious Content (Task 4), and common routing/evidence UI (Task 5).
- The result contract and false-attribution safeguards are tested in Tasks 1, 2, 3, and 5.
- Safe fixtures and backend reachability assertions are covered in Tasks 2 and 3.
- Deterministic mode is independent of model calls; live-model mode is optional and labeled (Tasks 1, 2, 3, and 5).
- Existing chat behavior, auth/session boundaries, UI build, BFF focused suites, and clean diff checks are explicitly retained (Tasks 4–6).
- No implementation is authorized by this plan alone; begin only after plan review and execution-mode selection.
