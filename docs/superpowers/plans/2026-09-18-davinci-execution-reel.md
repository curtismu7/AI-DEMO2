# DaVinci SDK Execution Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a previewable movie-reel execution view to `/davinci-orchestration-sdk`, wire it to real masked DaVinci/SDK/collector events, make existing code lessons collapsible, and document the P1 Forms and ACR lessons learned.

**Architecture:** A pure `SdkExecutionReel` renders normalized events. `sdkExecutionEvents.js` owns event normalization and masking; `DavinciSdkLoginPage.jsx` remains the only owner of the live operation callbacks and appends semantic events at the existing `start`, `flow`, `next`, response, and collector-update boundaries. The static lesson source remains in `SdkLessonSections.jsx`; a local disclosure wrapper makes each code block collapsible without changing its code content.

**Tech Stack:** React, Vitest, Testing Library, existing lesson components, CSS custom properties, Ping Orchestration SDK hooks already exposed by `davinciSdkClient.js`, Playwright CLI for deployed browser verification.

**Spec:** `docs/superpowers/specs/2026-09-18-davinci-execution-reel-design.md`

## Global Constraints

- Use the existing isolated worktree at `/Users/cmuir/Development/AI-DEMO2/.worktrees/davinci-execution-reel` on branch `feat/davinci-execution-reel`.
- Node.js must be >=22; use `/opt/homebrew/opt/node@22/bin` when the default Homebrew Node runtime fails.
- Preserve the existing DaVinci BFF, PingOne policy assignment, ACR behavior, callback flow, and collector rendering semantics.
- No raw secrets, PKCE values, nonce, state, interaction identifiers, or authorization codes may reach rendered event details; only existing masked placeholders such as `…` may appear.
- Use the existing `requestShape`, `responseShape`, `maskStepBody`, `stepCode`, and `client.cache` evidence paths; do not create a parallel HTTP client or simulated live execution path.
- Keep the existing static code examples and copyable content; only add disclosure behavior around them.
- Follow the project emoji allowlist, theme token rules, minimum font-size rule, no inline color/background/font-size rule, and both-theme readability gate in `REGRESSION_PLAN.md` §0.
- After any `demo_api_ui/` change, `cd demo_api_ui && npm run build` must exit 0.
- Do not run `docker compose` from the worktree; deploy only from the merged main checkout using `scripts/deploy-live.sh`.

---

### Task 1: Build the normalized execution-event model

**Files:**
- Create: `demo_api_ui/src/components/davinci/sdkExecutionEvents.js`
- Create: `demo_api_ui/src/components/davinci/__tests__/sdkExecutionEvents.test.js`

**Interfaces:**
- Produces `PREVIEW_EVENTS`, a stable fixture array used only by the concept mock.
- Produces `normalizeTraceEntry(entry)`, returning either one display-safe event or `null` for an unsupported trace entry.
- Produces `createOperationEvent({ lane, kind, label, codeKey, detail })`, returning the normalized event shape with `id`, `sequence` assigned by the caller, and `at` copied from the source event or set from `Date.now()`.
- Produces `maskExecutionDetail(detail)`, which retains allowlisted method/path/parameter names, event types, action keys, statuses, collector types/categories, and form-data keys while replacing non-empty values with `…`.

- [ ] **Step 1: Write failing tests**

  Add tests that:

  - convert an HTTP trace entry into a DaVinci request event with method, host, path, parameter names, and no query values;
  - convert a state trace entry into a collector/state event with collector type and category;
  - drop unknown entries rather than displaying arbitrary logger arguments;
  - mask `formData.email`, `formData.password`, nonce, state, PKCE, interaction IDs, and authorization codes;
  - preserve `PREVIEW_EVENTS` as display-safe sample data with movie, debugger, and storyboard-relevant milestones.

  Example assertion:

  ```js
  expect(normalizeTraceEntry({
    at: 10,
    source: "http",
    method: "POST",
    url: "https://auth.example/as/authorize?nonce=secret&response_mode=pi.flow",
    body: JSON.stringify({ parameters: { data: { formData: { password: "secret" } } } }),
  })).toMatchObject({
    lane: "davinci",
    kind: "request",
    detail: { method: "POST", responseMode: "pi.flow", body: { parameters: { data: { formData: { password: "…" } } } } },
  });
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  cd demo_api_ui
  PATH=/opt/homebrew/opt/node@22/bin:$PATH ./node_modules/.bin/vitest run src/components/davinci/__tests__/sdkExecutionEvents.test.js
  ```

  Expected: the new module exports are missing or return incomplete event shapes.

- [ ] **Step 3: Implement the event adapter**

  Keep the adapter pure. Use the existing `requestShape`/`maskStepBody` behavior as the model, but return the reel’s explicit `lane`, `kind`, `label`, `codeKey`, and masked `detail` fields. Do not copy arbitrary `logger.parts` into `detail`.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Re-run the same Vitest command. Expected: all event-adapter tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/src/components/davinci/sdkExecutionEvents.js demo_api_ui/src/components/davinci/__tests__/sdkExecutionEvents.test.js
  git commit -m "feat(davinci): normalize execution reel events"
  ```

### Task 2: Build the concept mock and live movie-reel renderer

**Files:**
- Create: `demo_api_ui/src/components/davinci/SdkExecutionReel.jsx`
- Create: `demo_api_ui/src/components/davinci/SdkExecutionReel.css`
- Create: `demo_api_ui/src/components/davinci/__tests__/SdkExecutionReel.test.jsx`

**Interfaces:**
- Consumes `events`, `previewEvents`, `mode`, and `onModeChange` props.
- `mode` is one of `"movie"`, `"debugger"`, or `"storyboard"`.
- Produces accessible concept tabs, a live/preview badge, selectable frame buttons, a selected frame detail region, and the synchronized DaVinci/SDK-collector lanes.
- Exports `SdkExecutionReel` and `PREVIEW_EVENTS` only through the event-model module; the renderer must not mutate fixture data.

- [ ] **Step 1: Write failing component tests**

  Test that:

  - preview mode renders the three concept buttons and the Movie reel selected by default;
  - preview copy identifies the content as a concept preview;
  - a live event list renders both DaVinci and SDK/collector lanes;
  - selecting a frame exposes its Code, Request, DaVinci response, and Collectors disclosures;
  - the selected frame is a real button with an accessible name and keyboard focus;
  - an empty live list explains that the first frame appears after `start()`;
  - `prefers-reduced-motion` does not remove information or selection behavior.

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  cd demo_api_ui
  PATH=/opt/homebrew/opt/node@22/bin:$PATH ./node_modules/.bin/vitest run src/components/davinci/__tests__/SdkExecutionReel.test.jsx
  ```

- [ ] **Step 3: Implement the renderer and theme-aware styles**

  Render the concept preview from `PREVIEW_EVENTS`, and render live events from `events` without adding timers. Use CSS grid for the two lanes and an overflow-safe horizontal frame rail. Use existing `--th-*` tokens, visible focus rings, a selected frame state, stacked `<details>` disclosures, and a `@media (prefers-reduced-motion: reduce)` override that disables transitions while preserving the playhead and event order.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Re-run the reel test. Expected: all preview, live, selection, accessibility, and disclosure assertions pass.

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/src/components/davinci/SdkExecutionReel.jsx demo_api_ui/src/components/davinci/SdkExecutionReel.css demo_api_ui/src/components/davinci/__tests__/SdkExecutionReel.test.jsx
  git commit -m "feat(davinci): add execution reel concept mock"
  ```

### Task 3: Wire real SDK, DaVinci, and collector events into the page

**Files:**
- Modify: `demo_api_ui/src/pages/DavinciSdkLoginPage.jsx`
- Modify: `demo_api_ui/src/pages/DavinciSdkLoginPage.css` for page-level placement
- Test: `demo_api_ui/src/pages/__tests__/DavinciSdkLoginPage.steps.test.jsx`
- Test: `demo_api_ui/src/components/davinci/__tests__/SdkExecutionReel.test.jsx`

**Interfaces:**
- The page owns `executionEvents` state and an append helper that assigns monotonic sequence numbers.
- `onTrace` continues writing the existing `traceRef`, then calls `normalizeTraceEntry(entry)` and appends the result when non-null.
- `start`, `takeFlow`, `submit`, `recordStep`, `syncFromClient`, and `finish` emit operation/response/terminal events around their existing calls; the existing SDK calls remain unchanged.
- Collector updates use a page-created updater wrapper: it calls the existing `client.update(c)(value)`, emits a masked `collector.update` event, and returns the original SDK result to `CollectorField`.

- [ ] **Step 1: Write failing page tests**

  Extend the page tests with a fake client whose `start`, `flow`, `next`, `update`, `getCollectors`, and cache response are observable. Assert that:

  - `start` emits an operation event before the SDK call, then request/response/collector events after it resolves;
  - `flow` emits a FlowCollector event and does not emit a form-data update;
  - `next` emits an update/next operation and terminal success when the node succeeds;
  - the updater wrapper returns the SDK update result and emits only masked values;
  - the reel receives live events without changing the existing Step Inspector steps.

- [ ] **Step 2: Run the page tests and verify RED**

  ```bash
  cd demo_api_ui
  PATH=/opt/homebrew/opt/node@22/bin:$PATH ./node_modules/.bin/vitest run src/pages/__tests__/DavinciSdkLoginPage.steps.test.jsx
  ```

- [ ] **Step 3: Implement event ownership at existing operation boundaries**

  Add the event buffer and render `<SdkExecutionReel events={executionEvents} />` in the live section. Implement the updater wrapper in `DavinciSdkLoginPage.jsx` so `CollectorField` remains unchanged: call `clientRef.current.update(collector)(value)`, append the masked event, and return the SDK result. Preserve the existing `traceRef`, `steps`, form phases, callback wait, sign-out behavior, and `recordStep` output. Do not derive a fake event sequence from `steps` after the fact; append events as the actual callbacks occur.

- [ ] **Step 4: Run page and DaVinci focused tests and verify GREEN**

  ```bash
  PATH=/opt/homebrew/opt/node@22/bin:$PATH ./node_modules/.bin/vitest run src/pages/__tests__/DavinciSdkLoginPage.steps.test.jsx src/components/davinci/__tests__/SdkExecutionReel.test.jsx src/components/davinci/__tests__/StepInspector.test.jsx
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/src/pages/DavinciSdkLoginPage.jsx demo_api_ui/src/pages/DavinciSdkLoginPage.css demo_api_ui/src/pages/__tests__/DavinciSdkLoginPage.steps.test.jsx
  git commit -m "feat(davinci): stream live execution events"
  ```

### Task 4: Make static code lessons collapsible and add the lessons learned

**Files:**
- Create: `demo_api_ui/src/components/davinci/CollapsibleCodeBlock.jsx`
- Create: `demo_api_ui/src/components/davinci/__tests__/CollapsibleCodeBlock.test.jsx`
- Modify: `demo_api_ui/src/components/davinci/SdkLessonSections.jsx`
- Modify: `demo_api_ui/src/components/davinci/__tests__/SdkLessonSections.test.jsx`
- Modify: `demo_api_ui/src/pages/DavinciSdkLoginPage.css`

**Interfaces:**
- `CollapsibleCodeBlock({ title, code, language = "js", defaultOpen = false })` renders a labeled disclosure around the existing `CodeBlock` without modifying the code string.
- `SdkLessonSections` uses the wrapper for every existing static `CodeBlock`, and keeps the current IDs, headings, source snippets, and navigation links.
- The new lesson text identifies preview data versus live evidence and documents `pi.flow`, ACR policy selection, P1 Forms collector categories, immutable updates, FlowCollector/SubmitCollector differences, and BFF callback completion.

- [ ] **Step 1: Write failing tests**

  Test that the code disclosure starts closed unless `defaultOpen`, opens and closes with its summary button, preserves the supplied code text, and that the lesson DOM contains the required P1 Forms/ACR/live-evidence copy.

- [ ] **Step 2: Run focused tests and verify RED**

  ```bash
  cd demo_api_ui
  PATH=/opt/homebrew/opt/node@22/bin:$PATH ./node_modules/.bin/vitest run src/components/davinci/__tests__/CollapsibleCodeBlock.test.jsx src/components/davinci/__tests__/SdkLessonSections.test.jsx
  ```

- [ ] **Step 3: Implement the wrapper and replace lesson code blocks**

  Use semantic `<details>`/`<summary>` or an equivalent accessible disclosure already used by the lesson system. Keep code copy controls and existing `CodeBlock` rendering intact. Add the new lessons as prose/table rows, not as executable pseudo-code that could contradict the live renderer.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Re-run the same command. Expected: disclosure interaction, preserved source snippets, and education-copy tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/src/components/davinci/CollapsibleCodeBlock.jsx demo_api_ui/src/components/davinci/__tests__/CollapsibleCodeBlock.test.jsx demo_api_ui/src/components/davinci/SdkLessonSections.jsx demo_api_ui/src/components/davinci/__tests__/SdkLessonSections.test.jsx demo_api_ui/src/pages/DavinciSdkLoginPage.css
  git commit -m "docs(davinci): teach live execution and P1 Forms"
  ```

### Task 5: Add regression contract and run repository verification

**Files:**
- Modify: `REGRESSION_PLAN.md` §4
- Test/build: `demo_api_ui` focused suites and build

- [ ] **Step 1: Add the regression-log entry**

  Record that the execution reel consumes masked real callbacks, that static examples remain intact, and that concept preview data must never be presented as a live run. List the new components and page integration files.

- [ ] **Step 2: Run all touched DaVinci tests**

  ```bash
  cd demo_api_ui
  PATH=/opt/homebrew/opt/node@22/bin:$PATH ./node_modules/.bin/vitest run \
    src/components/davinci/__tests__/sdkExecutionEvents.test.js \
    src/components/davinci/__tests__/SdkExecutionReel.test.jsx \
    src/components/davinci/__tests__/CollapsibleCodeBlock.test.jsx \
    src/components/davinci/__tests__/SdkLessonSections.test.jsx \
    src/components/davinci/__tests__/StepInspector.test.jsx \
    src/pages/__tests__/DavinciSdkLoginPage.steps.test.jsx
  ```

- [ ] **Step 3: Run the required UI build**

  ```bash
  PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
  ```

- [ ] **Step 4: Run diff and topology hygiene checks**

  From the repository root:

  ```bash
  git diff --check
  npm run topology:verify
  npm run hygiene:check
  ```

- [ ] **Step 5: Commit the regression entry**

  ```bash
  git add REGRESSION_PLAN.md
  git commit -m "test(davinci): record execution reel contract"
  ```

### Task 6: Deploy and verify the live page

**Files:**
- No source files; verify the merged source and deployed UI.

- [ ] **Step 1: Run the project’s full UI unit suite**

  ```bash
  cd demo_api_ui
  PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:unit
  ```

  Record unrelated pre-existing failures separately; no changed DaVinci test may fail.

- [ ] **Step 2: Request code review before integration**

  Review the final diff against `main`, specifically checking that displayed code is derived from real operation metadata and that masking is applied before state reaches the reel.

- [ ] **Step 3: Merge to main and deploy**

  Merge the feature branch into `main`, run `scripts/sync-main-checkout.sh`, then deploy with:

  ```bash
  scripts/deploy-live.sh
  ```

- [ ] **Step 4: Run Playwright against the deployed route**

  Verify `https://local.ping-devops.com:4000/davinci-orchestration-sdk` shows the concept tabs, starts with the Movie reel preview, and after `start()` receives live frames for the authorize request, DaVinci form response, collector snapshot, and security status. Select a frame and verify Code/Request/DaVinci response/Collectors disclosures. Switch to dark mode and confirm the reel remains readable.

- [ ] **Step 5: Run the §1.4 readability auditor in both themes**

  Use the repository’s documented contrast auditor on the deployed page in light and dark modes. Record empty results for the new reel/disclosure classes or fix any contrast issue before completion.

- [ ] **Step 6: Commit/merge/push/deploy handoff**

  Report the final merge SHA, deployed SHA, focused test count, build result, full-suite exceptions, and live browser evidence. Preserve any existing untracked browser/output artifacts in the shared checkout.
