# Privilege Attack Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single Attack Lab tab to `/llm-gateway` where Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, and Malicious Content run through their correct existing paths and show truthful evidence.

**Architecture:** Keep the existing Chat console, Raw request, Malicious MCP tab, and transaction dashboard unchanged. Add a thin Attack Lab tab that selects an attack and mounts a focused runner; each runner uses existing BFF endpoints or existing scenario components, and a small evidence adapter presents the observed outcome without turning model refusals or local validation into Privilege decisions. Deterministic fixtures are the default for automated tests; a live model request is optional and explicitly labeled.

**Tech Stack:** React 19, Vitest/Testing Library, existing `apiClient`, Express BFF routes already mounted by the app.

**Spec:** `docs/superpowers/specs/2026-09-23-privilege-agent-attack-scenarios-design.md`

## Global Constraints

- Use the existing `/llm-gateway` tab wrapper; do not change authentication, OAuth, sessions, banking transfers, or the screenshot's transaction dashboard.
- Never execute destructive commands, real transfers, external exfiltration, or real credential delegation.
- Show observed policy/validator result, provider/model reachability, and tool/agent backend reachability separately; never synthesize a Privilege decision.
- Keep a deterministic fixture mode separate from optional live-model runs; label live results as variable.
- Preserve the project's emoji allowlist and `--th-*` theme-token rules; run the UI unit suite, production build, and both-theme contrast audit.

---

## File map

- Modify `demo_api_ui/src/pages/LlmGatewayCombinedPage.jsx` and `.css` to add the Attack Lab tab without changing existing tab defaults or deep links.
- Create `demo_api_ui/src/pages/AttackLabTab.jsx` and `.css` for attack selection, focused runner mounting, observed-result presentation, loading/error/unavailable states, and run trace.
- Create `demo_api_ui/src/pages/attackLabEvidence.js` for pure normalization of actual runner results into `{ attackId, mode, path, enforcement, modelReached, backendReached, raw }`; it must not assign a verdict when the source result has none.
- Create `demo_api_ui/src/pages/hostileMcpOutcome.js` for truthful classification of denied, allowed-stub, user-not-found, unavailable, and inconclusive hostile-agent results.
- Reuse `demo_api_ui/src/pages/HostileMcpTab.jsx`, `demo_api_ui/src/components/AgentGatewayTester.jsx`, and `demo_api_ui/src/components/InterAgentAbuseTester.jsx` where their props and side effects permit; only add the smallest prop/API seams needed for embedding. Keep their existing standalone routes/behavior intact.
- Reuse `demo_api_server/routes/attackSimulator.js` (`POST /api/demo/attack-sim/run`), `demo_api_server/routes/privilegeMcpClient.js` (`/api/privilege-mcp/llm/call` and the agent/MCP relay), `/api/mcp-gateway/test`, and the current A2A specialist endpoints. Add no backend route unless testing confirms an existing route cannot provide the approved safe behavior.
- Add/extend `demo_api_ui/src/pages/__tests__/LlmGatewayCombinedPage.test.jsx`, `AttackLabTab.test.jsx`, and `attackLabEvidence.test.js`; extend the existing scenario tests when a runner receives a new embedding prop.
- Add `HostileMcpTab.test.jsx` and `hostileMcpOutcome.test.js` for the live hostile-MCP outcome states.

## Execution notes

- Implemented the five-entry Attack Lab tab and wired each entry to its existing safe path/component. Tool Abuse is the non-mutating cross-owner balance-read simulation; schema validation remains explicitly attributed to the local MCP input schema unless the gateway reports otherwise.
- Focused scenario tests pass (28 tests); the full UI suite passes with `--maxWorkers=4` (657 files, 5,019 passed, 24 skipped); production build passes.
- The DOM contrast audit and PKCE/Privilege live-policy test remain pending. The sandbox denied binding an isolated Vite preview (`listen EPERM`); no shared Docker stack or tenant policy was altered.

## Task 1: Add the Attack Lab tab shell

**Files:**
- Modify: `demo_api_ui/src/pages/LlmGatewayCombinedPage.jsx`
- Modify: `demo_api_ui/src/pages/LlmGatewayCombinedPage.css`
- Test: `demo_api_ui/src/pages/__tests__/LlmGatewayCombinedPage.test.jsx`

**Interfaces:**
- Produces tab key `attacks`, label `Attack Lab`, and renders `<AttackLabTab />` only while selected.
- `?tab=attacks` opens the tab; `/llm-gateway` continues to open Chat console and `/llm-test` continues to open Raw request.

- [ ] **Step 1: Add failing tab-routing tests** asserting the new tab exists, opens from `?tab=attacks`, mounts Attack Lab, and leaves current default/deep-link tests unchanged.

```jsx
renderUi(
  <MemoryRouter initialEntries={["/llm-gateway?tab=attacks"]}>
    <LlmGatewayCombinedPage defaultTab="chat" />
  </MemoryRouter>,
);
expect(screen.getByRole("tab", { name: /attack lab/i })).toHaveAttribute("aria-selected", "true");
expect(await screen.findByRole("heading", { name: /attack lab/i })).toBeInTheDocument();
```
- [ ] **Step 2: Run the focused test** with `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/LlmGatewayCombinedPage.test.jsx`; verify failure is only the absent tab.
- [ ] **Step 3: Add the tab and a minimal placeholder component import/render branch**; preserve existing tab keys and default behavior.
- [ ] **Step 4: Add theme-token styling for the tab only** and verify responsive wrapping plus visible focus state.
- [ ] **Step 5: Re-run the focused test** and commit the shell independently.

## Task 2: Define the attack evidence contract and deterministic UI states

**Files:**
- Create: `demo_api_ui/src/pages/attackLabEvidence.js`
- Create: `demo_api_ui/src/pages/__tests__/attackLabEvidence.test.js`
- Create: `demo_api_ui/src/pages/AttackLabTab.jsx`
- Create: `demo_api_ui/src/pages/AttackLabTab.css`
- Create: `demo_api_ui/src/pages/__tests__/AttackLabTab.test.jsx`

**Interfaces:**
- `normalizeAttackEvidence(attackId, sourceResult, mode)` returns the five scenario identity fields plus `enforcement: { component, outcome, reason } | null`, `modelReached: true | false | null`, `backendReached: true | false | null`, and `raw`.
- Missing or malformed source decisions normalize to `enforcement: null`; they are rendered as “No gateway decision reported,” not a deny.
- `AttackLabTab` presents exactly the five requested attacks; its deterministic paths can be run without contacting an LLM or changing external state. A fixture-only rendering test is always labeled as not sent to Privilege.

- [ ] **Step 1: Write normalization tests** for actual deny, actual allow/no verdict, local schema rejection, model refusal, absent/malformed source data, and missing backend reachability.

```js
it('does not call local schema rejection a Privilege deny', () => {
  const evidence = normalizeAttackEvidence('schema_violation', {
    validator: { outcome: 'rejected', name: 'MCP input schema' },
    privilegeDecision: null,
    backendReached: false,
  }, 'fixture');

  expect(evidence.enforcement).toEqual({
    component: 'MCP input schema', outcome: 'rejected', reason: null,
  });
  expect(evidence.modelReached).toBeNull();
  expect(evidence.backendReached).toBe(false);
});
```
- [ ] **Step 2: Run the focused test** and confirm the missing module causes the expected failure.
- [ ] **Step 3: Implement the pure normalizer** using only source-provided decision and reachability fields.
- [ ] **Step 4: Write Attack Lab tests** for the five entries, initial empty state, deterministic fixture label, unavailable state, and prohibition on displaying “Blocked by Privilege” without a source Privilege deny.
- [ ] **Step 5: Run the focused tests** and confirm they fail because the component is absent.
- [ ] **Step 6: Implement the Attack Lab shell** with five selectable scenarios, run state, result/evidence region, clear error/unavailable messaging, and a movie-reel/sequence view made only from observed steps; keep only layout properties inline if needed.
- [ ] **Step 7: Run both focused test files** and commit the UI/evidence contract.

## Task 3: Wire Tool Abuse and Schema Violation to real tool-policy paths

**Files:**
- Modify: `demo_api_ui/src/pages/AttackLabTab.jsx`
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx` only if a minimal initial-attack prop is needed
- Test: `demo_api_ui/src/pages/__tests__/AttackLabTab.test.jsx`
- Test: `demo_api_ui/src/components/__tests__/AgentGatewayTester.attackLibrary.test.jsx`

**Interfaces:**
- Tool Abuse runs the existing authenticated `POST /api/demo/attack-sim/run` with `sim: 'cross-owner-account'`, which attempts a non-mutating balance read through the full exchange → Authorize → MCP pipeline; show the returned authorization/resource-owner result and do not claim an LLM/provider was reached. Do not use `insufficient-scope`, because that simulator attempts `create_transfer`.
- Schema Violation sends the existing schema-invalid `create_transfer` arguments through `POST /api/mcp-gateway/test` using `AgentGatewayTester` with `twoStep={false}`. Show the adapter's schema rejection separately from any gateway decision and show backend not reached only when the response proves it. The intentionally invalid arguments must be rejected before transfer logic; never approve, retry, or replace them with valid arguments.

- [ ] **Step 1: Add failing dispatch/evidence tests** that assert `{ sim: 'cross-owner-account' }` for Tool Abuse and the existing schema-invalid `create_transfer` args for Schema Violation.
- [ ] **Step 2: Run the focused tests** and verify they fail because the Attack Lab actions are not wired.
- [ ] **Step 3: Add the Tool Abuse runner** using `apiClient.post('/api/demo/attack-sim/run', { sim: 'cross-owner-account' })` and normalize the returned `authorize` or resource-owner denial without treating HTTP success as PERMIT.
- [ ] **Step 4: Add the Schema Violation runner** using the `schema_violation` entry in `TOOL_ATTACKS`; pass its `tool` and `args` to the existing MCP tester with `twoStep={false}`, preserve the raw validator/gateway result, and never retry or approve the transfer.
- [ ] **Step 5: Re-run focused tests** and commit the two runner paths.

## Task 4: Wire Tool Poisoning and Inter-Agent Abuse to their existing runners

**Files:**
- Modify: `demo_api_ui/src/pages/AttackLabTab.jsx`
- Modify: `demo_api_ui/src/pages/HostileMcpTab.jsx` only if a controlled embedded mode is required
- Modify: `demo_api_ui/src/components/InterAgentAbuseTester.jsx` only if result callbacks/controlled mode are required
- Test: `demo_api_ui/src/pages/__tests__/AttackLabTab.test.jsx`
- Test: existing Hostile MCP and Inter-Agent Abuse tests, plus focused additions for any new prop

**Interfaces:**
- Tool Poisoning uses the hostile MCP server's poisoned `tools/list` metadata and tool-call boundary. Metadata being relayed is not labeled as scanned or blocked; a downstream Privilege call result is reported only when received.
- The live hostile-mcp run requires a manually configured policy on the `hostile-mcp` Agentic App that denies `create_transfer` for the demo user. The UI never creates/changes that policy. A user-signed-in browser session is required for live validation.
- Inter-Agent Abuse uses the existing no-bearer and forged-bearer A2A probes against the Super Sports specialist. Report actual HTTP status and wire-hop attribution; agent execution remains false/unknown unless the endpoint evidence establishes it.

- [ ] **Step 1: Add failing integration tests** proving both existing runners mount inside the Attack Lab without replacing the top-level tab or firing requests on mere selection.
- [ ] **Step 2: Run focused tests** and verify the embedded runner branch/prop is missing.
- [ ] **Step 3: Reuse the Hostile MCP runner** with the narrowest embedding seam; selection may perform its existing read-only `/state` load, but must not persist an MCP URL, start auth, load tools, or make a model/tool call. Keep door switch, sign-in, Get MCP Tools, and Run agent as explicit actions. Before Run agent, show the manual `hostile-mcp` policy prerequisite and explain that the model must actually propose `create_transfer` for the call to be evaluated.
- [ ] **Step 4: Normalize hostile run results** into four separate states: Privilege denied; allowed and the hostile server's no-money stub ran; error text indicates `user not found in system`; or inconclusive because no `create_transfer` proposal / no gateway call / auth or service failure. Never turn an empty gateway log into a passing result.
- [ ] **Step 5: Reuse the A2A tester** with a result callback or controlled output only if needed to show its real statuses in the common evidence area; keep its standalone behavior intact.
- [ ] **Step 6: Run focused tests** for each hostile outcome and for the A2A probes; commit the two integrations.

## Task 5: Wire Malicious Content and complete evidence honesty checks

**Files:**
- Modify: `demo_api_ui/src/pages/AttackLabTab.jsx`
- Modify: `demo_api_ui/src/pages/LlmGatewayPage.jsx` only if extracting a small reusable `/llm/call` operation is necessary
- Test: `demo_api_ui/src/pages/__tests__/AttackLabTab.test.jsx`
- Test: `demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx` if a helper is extracted

**Interfaces:**
- Malicious Content uses a safe simulated sample through the existing Privilege LLM `/api/privilege-mcp/llm/call` path. It requires an explicit live run; absent gateway/provider configuration is “Unavailable,” not a simulated verdict. Any pass, redaction, policy denial, rate limit, or provider refusal is separately labeled from the observed response.
- The deterministic fixture mode may validate the runner/rendering contract but is labeled “Fixture — not sent to Privilege”; it must never imply a real inspection occurred.

- [ ] **Step 1: Add failing tests** for live request payload, `llm_policy_denied` (`reachedProvider: false`), provider refusal/error (`reachedProvider: true`), redaction, and missing configuration.
- [ ] **Step 2: Run focused tests** and verify the Attack Lab has no content run path.
- [ ] **Step 3: Add a harmless, non-executable security-awareness sample** with only an `example.invalid` link and route it through the existing privileged lane selected by the user; require the user to press Run.
- [ ] **Step 4: Keep fixture results visibly non-live** and add assertions that fixture evidence cannot produce a Privilege verdict.
- [ ] **Step 5: Run the focused test set** and commit the content scenario.

## Task 6: Full UI regression, contrast, and handoff

**Files:**
- Verify all changed Attack Lab and LLM Gateway files; update `REGRESSION_PLAN.md` §4 only if the implementation fixes a demonstrated regression rather than adding a feature.

- [ ] **Step 1: Run the targeted UI tests** for `LlmGatewayCombinedPage`, `AttackLabTab`, `attackLabEvidence`, `HostileMcpTab`, `InterAgentAbuseTester`, and `AgentGatewayTester`.
- [ ] **Step 2: Run the full UI unit suite** with `cd demo_api_ui && npm run test:unit`.
- [ ] **Step 3: Run the required production build** with `cd demo_api_ui && npm run build`.
- [ ] **Step 4: Run the THEMING.md §1.4 contrast audit** for `/llm-gateway` in light and dark themes; inspect tab focus and narrow viewport behavior. Verify the Attack Lab sequence/reel distinguishes gateway deny, local schema rejection, model/provider refusal, no verdict, and not evaluated.
- [ ] **Step 5: Review `git diff --check`, changed-file scope, and emoji allowlist; confirm no transaction dashboard/auth/session changes.**
- [ ] **Step 6: Run a live browser acceptance check only if the user is present to complete PKCE sign-in and has configured the `hostile-mcp` policy; otherwise report it as pending, with the exact run instructions.**
- [ ] **Step 7: Commit the verified integration and report automated tests/build separately from the user's pending or completed live policy check.**
