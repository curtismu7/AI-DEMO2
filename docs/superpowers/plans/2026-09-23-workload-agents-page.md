# Workload Agents Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Workload Agents page that explains and runs distinct UC38 and UC44 scenarios across the supported verticals using real delegated workload-agent execution.

**Architecture:** Keep `demo_api_server/config/useCases.js` as the source for each vertical's UC38 write action and UC44 read action. Make the BFF enforce UC38's MFA prerequisite and resolve action from the canonical use-case and vertical. Add `/workload-agents` as the scenario selector and runner context, reusing the Personal Agent Studio while retaining its existing routes.

**Tech Stack:** Node >=22, Express BFF, React 19/Vite 8, Vitest, Jest/Supertest.

**Spec:** `docs/superpowers/specs/2026-09-23-workload-agents-page-design.md`

## Global Constraints

- Preserve BFF token custody: browser code never receives access or exchange tokens.
- Preserve existing login, session, token-exchange, gateway, Authorize, and registered-agent checks.
- UC38 must require MFA and run the selected vertical's UC7 step-up action.
- UC44 must run the selected vertical's customer-owned read action; normal policy may require additional assurance.
- Never accept a tool name from the browser or silently fall back to Airlines or the other use case.
- UI copy uses only the emoji allowlist; themeable styles use `--th-*` tokens and no inline color, background, or font-size.
- Regenerate use-case documentation from its source; never hand-edit generated files.

---

## File Map

- `demo_api_server/config/useCases.js` — canonical vertical action, runner prompt, scope, and narrative mapping for UC38/UC44; preserve each use case's page-link trigger.
- `demo_api_server/routes/agentInvokeRoute.js` — enforce scenario-specific MFA behavior and preserve the existing real delegation path.
- `demo_api_server/tests/agentInvokeRoute.workloadAgents.test.js` — pin auth, action resolution, and no-fallback behavior.
- `demo_api_server/tests/useCases.workloadAgents.test.js` — pin all-vertical mapping and distinct action behavior.
- `demo_api_ui/src/pages/WorkloadAgentsPage.jsx` — explain shared workload identity and present the two use-case choices with a vertical selector.
- `demo_api_ui/src/pages/WorkloadAgentsPage.css` — page layout using project theme tokens.
- `demo_api_ui/src/pages/__tests__/WorkloadAgentsPage.test.jsx` — pin choices, descriptions, selected action, and run context.
- `demo_api_ui/src/pages/PersonalAgentStudioPage.jsx` and `PersonalAgentClientWindow.jsx` — consume explicit UC/vertical run context while retaining existing route defaults.
- `demo_api_ui/src/App.js` — register `/workload-agents`.
- `demo_api_ui/src/config/missionControlCatalog.js` — link the Workload Agent group to the page.
- `demo_api_server/config/auth-requirements.json` — declare the explanation route public; the BFF invocation still requires an authenticated customer.
- `demo_api_server/config/useCases.js` generated documentation — regenerate through `npm run use-cases:gen`.
- `REGRESSION_PLAN.md` §4 — add a concise entry for the behavior and its verification.

## Task 1: Define distinct per-vertical UC38 and UC44 scenarios

**Interfaces:** `resolveUseCase('UC38', vertical)` resolves to the UC7 protected-write action plus a `runPrompt` for each vertical. `resolveUseCase('UC44', vertical)` resolves to the customer-owned read action plus a `runPrompt` for each vertical, including banking. The UI sends the resolved `runPrompt`; the BFF uses the resolved catalog action and never trusts a client tool name. Both use cases keep their `/workload-agents` page-link `trigger` instead of inheriting UC7 or read-chip triggers.

- [ ] Add failing Jest coverage in `demo_api_server/tests/useCases.workloadAgents.test.js`:

```js
const {
  VERTICALS,
  resolveUseCase,
} = require('../config/useCases');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { toolForAction } = require('./helpers/actionToTool');

describe('workload-agent use-case mappings', () => {
  it('maps UC38 to the vertical UC7 step-up action in every vertical', () => {
    for (const vertical of VERTICALS) {
      const uc38 = resolveUseCase('UC38', vertical);
      const uc7 = resolveUseCase('UC7', vertical);
      expect(uc38.primaryTool).toBe(uc7.primaryTool);
      expect(uc38.runPrompt).toBe(uc7.trigger.text);
      expect(uc38.trigger.type).toBe('link');
      expect(uc38.trigger.path).toBe('/workload-agents?useCase=UC38');
    }
  });

  it('maps UC44 to a customer read distinct from UC38 in every vertical', () => {
    for (const vertical of VERTICALS) {
      const uc38 = resolveUseCase('UC38', vertical);
      const uc44 = resolveUseCase('UC44', vertical);
      expect(uc44.primaryTool).toBeTruthy();
      expect(uc44.primaryTool).not.toBe(uc38.primaryTool);
      expect(uc44.runPrompt).toBeTruthy();
      expect(uc44.trigger.type).toBe('link');
      expect(uc44.trigger.path).toBe('/workload-agents?useCase=UC44');
    }
  });

  it('routes each catalog runner prompt to its declared action', () => {
    for (const vertical of VERTICALS) {
      for (const id of ['UC38', 'UC44']) {
        const useCase = resolveUseCase(id, vertical);
        const parsed = parseHeuristic(
          useCase.runPrompt,
          vertical,
          resolveVerticalCtx(vertical),
          {},
        );
        const action = parsed?.banking?.action ?? parsed?.action ?? null;
        expect(toolForAction(action, vertical)).toBe(useCase.primaryTool);
      }
    }
  });
});
```

- [ ] Run `cd demo_api_server && CI=true npx jest tests/useCases.workloadAgents.test.js --forceExit`; confirm it fails because UC38/UC44 still resolve to the shared Airlines `redeem_miles` path.
- [ ] In `config/useCases.js`, point the UC38 and UC44 link triggers to `/workload-agents?useCase=UC38` and `...?useCase=UC44`. Set UC38 vertical overrides from resolved UC7 actions/prompts and UC44 overrides from existing customer-read mappings. Add an explicit banking read action/prompt so UC44 does not inherit UC38's write action. Store vertical prompts in `runPrompt`, leaving both use cases' trigger types as links. Give the entries distinct titles and decision cues.

```js
const AMOUNT_600_PROMPTS = amountTriggerByVertical(600);
const WORKLOAD_AGENT_UC38_BY_VERTICAL = Object.fromEntries(
  VERTICALS.map((vertical) => [vertical, {
    primaryTool: vertical === 'banking'
      ? 'create_transfer'
      : AMOUNT_PRIMARY_TOOL_BY_VERTICAL[vertical],
    runPrompt: AMOUNT_600_PROMPTS[vertical]
      || 'transfer $600 from checking to savings',
  }]),
);
const WORKLOAD_AGENT_UC44_BY_VERTICAL = Object.fromEntries(
  VERTICALS.map((vertical) => [vertical, {
    primaryTool: vertical === 'banking'
      ? 'get_account_balance'
      : READ_PRIMARY_TOOL_BY_VERTICAL[vertical],
    runPrompt: READ_TRIGGER_BY_VERTICAL[vertical] || 'show my balance',
  }]),
);
```

Store these maps as `perVertical` on UC38 and UC44. Keep UC38's and UC44's
`trigger` entries as the deep links to `/workload-agents`.
- [ ] Run the focused test again and confirm all 11 vertical mappings pass and UC38's action differs from UC44's.
- [ ] Run `npm run use-cases:gen` and `npm run use-cases:check` from `demo_api_server`; include only generated output produced by the script.
- [ ] Commit the catalog, test, and generated documentation paths explicitly.

## Task 2: Enforce different BFF behavior for UC38 and UC44

**Interfaces:** Invocation request body carries `prompt`, `vertical`, and canonical `useCaseId`. It never carries an executable tool name. UC38 requires a customer MFA claim before delegation; UC44 skips only that blanket pre-check and continues through the normal OBO, gateway, and Authorize policy path.

- [ ] Add failing route tests in `demo_api_server/tests/agentInvokeRoute.workloadAgents.test.js` for: anonymous calls return 401 for both IDs; UC38 without MFA returns the existing step-up response without invoking the agent; UC38 with MFA continues; UC44 without MFA continues to normal policy; an unsupported vertical or use-case ID cannot fall back to Airlines; the browser cannot select a tool by posting `toolName`.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/agentInvokeRoute.workloadAgents.test.js --forceExit`; verify the new UC44 expectation fails against the shared current pre-check.
- [ ] Update `routes/agentInvokeRoute.js` so only `personal-agent-concierge` applies the UC38 MFA pre-check. Keep registered-agent verification for both canonical use-case IDs. Use the resolved scenario catalog for the selected vertical's action and scopes; reject missing mappings rather than falling back.
- [ ] Run the focused route and catalog tests; confirm anonymous access remains denied, UC38 remains MFA-gated, and UC44 still reaches gateway/Authorize before a tool executes.
- [ ] Run nearby existing route suites for `agentInvokeRoute` and commit only route and test files.

## Task 3: Build the Workload Agents selector and runner context

**Interfaces:** `/workload-agents?useCase=UC38&vertical=banking` and the UC44 equivalent initialize the page and selected run. The page renders action and suggested prompt from the canonical catalog. The studio posts only prompt, vertical, and canonical use-case ID to `/api/agent/invoke`.

- [ ] Add failing `WorkloadAgentsPage.test.jsx` cases for all 11 vertical choices, the different UC38/UC44 descriptions, vertical-specific action and run-prompt labels, UC selection in the run button, and the lack of an Airlines default when an explicit vertical is selected.
- [ ] Run `cd demo_api_ui && npm run test:unit -- --run src/pages/__tests__/WorkloadAgentsPage.test.jsx`; confirm it fails because the page does not exist.
- [ ] Add `WorkloadAgentsPage.jsx` and its CSS. Explain the shared `sub=user` / `act=agent` model; show UC38 as an MFA-gated protected write and UC44 as an OBO customer-data read; keep selected vertical, use case, and action visible through the run.
- [ ] Update `PersonalAgentStudioPage.jsx` and `PersonalAgentClientWindow.jsx` to derive vertical and use-case context from the route query and use the correct scenario-specific opening copy and prompt. Preserve the old `/personal-agent` default for existing callers.
- [ ] Run the focused page and studio tests and confirm each runner request carries the selected use-case ID and vertical.
- [ ] Commit page, style, studio, and test files explicitly.

## Task 4: Connect the page to Mission Control and routes

- [ ] Add failing checks that the Workload Agent catalog group's Run link points to `/workload-agents` and UC38/UC44 deep links include their canonical use-case and vertical context.
- [ ] Add `/workload-agents` to `App.js` and `config/auth-requirements.json` as a public explanatory page. Keep actual BFF execution customer-authenticated. Update the Mission Control Workload Agent catalog group to link to the new page.
- [ ] Have DemoStepsDropdown append its active vertical when opening a UC38/UC44 deep link; direct links without a vertical initialize from the active vertical provider, with banking as the safe first-visit default.
- [ ] Run affected UI config/page tests and `npm run authz:verify` from the repo root.
- [ ] Run `cd demo_api_ui && npm run build`; commit the route, auth-requirement, catalog, test, and runbook paths explicitly.

## Task 5: Regression record and final verification

- [ ] Add a reverse-chronology `REGRESSION_PLAN.md` §4 entry describing the old shared Airlines/UC44 behavior, the scenario split, invariants, and exact verification commands.
- [ ] Run focused UI tests, focused BFF tests, `npm run use-cases:check`, `npm run authz:verify`, and `cd demo_api_ui && npm run build`.
- [ ] Run `graphify update .`, `git diff --check`, and inspect `git status --short` to ensure only intended files changed.
- [ ] Commit the regression record and final verification changes. Report the worktree branch and each check result.
