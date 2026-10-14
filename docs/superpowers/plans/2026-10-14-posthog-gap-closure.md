# PostHog-Gap Closure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax. Work in a worktree (main checkout is shared). Check applicable skills before each task.

**Goal:** Close the six areas where PostHog's "38 things we've learned about building AI products" (2026-10-12) is ahead of AI-DEMO2.

**Architecture:** Reuse what exists. Token data is already captured (span tags, `contextTokens`, PostHog emit) but never priced or surfaced. Evals/goldens/drift gates exist but sit outside CI. Each task is independent and ships alone.

**Tech Stack:** jest+supertest (demo_api_server), vitest (demo_api_ui), `node --test` (scripts), promptfoo (installed, not in CI), TypeScript (demo_agent_service).

**Source audit:** 2026-10-14 read-only audit (findings inline per task). Lesson numbers = PostHog article.

## Global Constraints
- Minimum code; reuse `traceProjector`, `check-goldens.js`, `hygiene:check`, `AgentGreetingHero` patterns.
- Diagram/demo/Learning Hub trio stays in sync: any UI surface change checks the other two.
- New public SPA routes need the checklist (auth-requirements.json, oauth-bypass ingress, e2e storageState). This plan adds none.
- CI runs serially; never two Playwright runs at once.

## Review Focus
- Provider returns no `usage` (chars/4 fallback already in reasoningGraph.ts): cost must be labelled *estimated*, never shown as exact.
- Unknown model ID has no price: show tokens, omit cost, don't crash.
- Streaming (SSE) responses: usage arrives in the final chunk only.
- Suggestion chips must not render for signed-out/guest where the sign-in prompt already owns the empty state.
- Drift gate must not fail on pre-existing known drift: baseline first, then enforce.

## Priority order (value / effort)
1. Task 1 CI evals+goldens (tiny, high value)
2. Task 2 Model-ID single source + validation (#15, fixes real staleness)
3. Task 3 Token/cost ledger (#22, #25, #26)
4. Task 4 Per-agent columns in A2A trace (#26)
5. Task 5 Suggested prompts for Dot + A2A workbench (#35)
6. Task 6 Learning-mirror/Jev drift gate (#30)

---

### Task 1: Put evals and goldens in CI (#34)

**Finding:** `scripts/check-goldens.js` runs via `npm run use-cases:check`; promptfoo configs in `demo_api_server/promptfoo/` exist; neither is in `.github/workflows/ci.yml`. Jev gallery has render-only tests (a crash-on-run once shipped).

**Files:**
- Modify: `.github/workflows/ci.yml` (add step after the hygiene gate)
- Create: `demo_api_ui/src/pages/__tests__/JevDemoGalleryPage.run.test.jsx` (run each of the 8 demos to completion with mocked API, assert no thrown error and a result rendered)

- [ ] Step 1: `grep -n "use-cases:check\|goldens" .github/workflows/ci.yml` to confirm absence.
- [ ] Step 2: Run `npm run use-cases:check` locally on main; record pass/fail. If failing, list failures, do not fix in this task.
- [ ] Step 3: Add CI step `npm run use-cases:check` (only if Step 2 passes; else add as `continue-on-error: true` and file the failures).
- [ ] Step 4: Write the Jev run-to-completion vitest (one parametrised test over the 8 demos). Run `npx vitest run JevDemoGalleryPage.run`. Expect FAIL if any demo crashes on run, otherwise PASS.
- [ ] Step 5: Promptfoo: run `agent-eval.yaml` once heuristics-mode against local server, record baseline pass rate in the plan PR description. Do NOT add to CI yet (needs live server; revisit if baseline is stable).
- [ ] Step 6: Commit.

**Done when:** CI fails on a deliberately poisoned golden (verify on a throwaway branch) and the Jev run test passes.

---

### Task 2: One source of truth for model IDs (#15)

**Finding:** Model names conflict across `routes/langchainConfig.js` (claude-opus-4-5, sonnet-4-5, 3-5-haiku), `demo_agent_service/src/config.ts:91` (claude-sonnet-5-5), `reasoningGraph.ts`, `summarizationQueue.js`, `geminiNlIntent.js`, `agentBuilder.js`, `platformAgentRuntime.js`. `llmProviderStatus.js` is on-demand only.

**Files:**
- Create: `demo_api_server/config/llmModels.json` (provider → default + allow-list; start from current `langchainConfig.js` values updated to claude-sonnet-5-5 where the agent service already uses it)
- Modify: `routes/langchainConfig.js`, `services/summarizationQueue.js`, `geminiNlIntent.js`, `agentBuilder.js`, `platformAgentRuntime.js` to read from it
- Create: `scripts/check-llm-models.js` (fails if a model literal matching `claude-|gemini-|gpt-` appears in `services/` or `routes/` outside the JSON) + wire into `hygiene:check`
- Test: `scripts/check-llm-models.test.js` (`node --test`)

- [ ] Step 1: Write the failing `node --test` that feeds the checker a fixture file with a stray `claude-sonnet-4-5` literal and expects exit 1; clean fixture exits 0.
- [ ] Step 2: Implement checker (regex scan, allowlist the JSON file and tests). Run; PASS.
- [ ] Step 3: Run checker on repo to get the real offender list (baseline). Migrate offenders one file at a time, rerunning jest for that file's tests after each.
- [ ] Step 4: `demo_agent_service` stays TS; it reads the same JSON at build via relative import only if trivial, otherwise keep its default and add it to the checker's allowlist with a `ponytail:` comment noting the second source.
- [ ] Step 5: Boot-time check: call `getProviderStatus` once at server start and log a single warning per unreachable configured provider (no blocking).
- [ ] Step 6: Commit.

**Done when:** `hygiene:check` fails on a stray model literal, and the BFF and agent-service defaults agree.

---

### Task 3: Token + estimated-cost ledger (#22, #25)

**Finding:** Tokens exist in span tags (`agentRunHandler.ts`), `traceProjector.js` sums them, `posthogAi.js` emits to PostHog. No price table, no cost, no usage route, no UI. BFF LLM services never record usage.

**Files:**
- Create: `demo_api_server/config/llmPrices.json` ($/1M in/out per model ID; sourced from provider pricing, dated)
- Create: `demo_api_server/services/llmUsageLedger.js` (`recordUsage({runId, agent, model, inputTokens, outputTokens, estimated})`, `summarize(runId)`; in-memory ring buffer, cap 1000 — ponytail: no persistence; upgrade if demo needs history across restarts)
- Modify: `services/traceProjector.js` (~97-102): compute `estCostUsd` from summed tokens + price table; flag `estimated` when tokens came from the chars/4 fallback
- Modify: `routes/tracing.js`: include `cost` in the existing projection response (no new route)
- Modify: UI surface that renders the projection summary (find the consumer of `tokens N in / M out`; add "≈ $0.0042 (est.)")
- Test: `tests/llmUsageLedger.test.js`, `tests/traceProjector.cost.test.js`

- [ ] Step 1: Failing jest: projection with 1000 in / 500 out on a priced model returns `estCostUsd` = exact expected number; unknown model returns `estCostUsd: null` (no throw).
- [ ] Step 2: Implement price lookup + compute in traceProjector. PASS.
- [ ] Step 3: Failing test for `estimated` flag when tags carry the fallback marker (confirm how `reasoningGraph.ts` marks estimates; add a boolean span tag `tokens_estimated` there if absent).
- [ ] Step 4: Wire ledger only if a consumer other than traceProjector needs it; otherwise skip ledger file entirely (YAGNI — decide after Step 2).
- [ ] Step 5: UI: render cost next to token summary; vitest asserts "(est.)" label and null-cost omission.
- [ ] Step 6: Commit. Reconcile one real run against PostHog `$ai_*` numbers by hand and record the delta in the PR.

**Done when:** a live agent run shows tokens + "≈ $x (est.)" in the trace view and the number matches PostHog within rounding.

---

### Task 4: Per-agent latency/tokens in the A2A view (#26)

**Finding:** `traceProjector` already has `durationMs` and token sums per step but `AgentRunTimeline`, `A2AFlowVisualizer`, `PrivilegeA2aTab` render none. Gateway-record "model-call" lines don't name the agent.

**Files:**
- Modify: `services/a2aOrchestratorService.js` (add `agent` name + token/duration to the whitelisted display fields)
- Modify: `components/AgentRunTimeline.jsx` (columns: agent, ms, tokens, est. cost)
- Modify: `PrivilegeA2aTab.jsx` trace panel; label model-call rows with agent where the orchestrator provides it
- Test: orchestrator whitelist jest test; vitest for timeline columns

- [ ] Step 1: Verify (not assumed): is traceProjector output actually rendered anywhere? `grep -rn "tracing" demo_api_ui/src | head`. Adjust task if not.
- [ ] Step 2: Failing jest: orchestrator output for a 2-agent delegation includes per-agent `durationMs` and tokens, plus a parent total equal to the sum (parent total must include subagent tokens — this is PostHog's "subagents cost more than expected").
- [ ] Step 3: Implement; PASS. Step 4: UI columns + vitest. Step 5: Commit.

**Done when:** an A2A run shows a per-agent table and a parent total that equals the sum of the rows.

---

### Task 5: Suggested prompts for Dot + A2A workbench (#35)

**Finding:** `AIAgent.js` (via `agentActions.js`, `AgentGreetingHero`), `PrivilegeA2aTab` have chips. `PersonalAgentStudioPage.jsx`/`PersonalAgentClientWindow.jsx` and `LiveUseCaseWorkbenchPage.js` have none. Chips are re-implemented per surface; no shared component.

**Files:**
- Create: `demo_api_ui/src/components/SuggestionChips.jsx` (props: `chips: string[]`, `onPick`) — small; do not refactor existing surfaces onto it (out of scope)
- Modify: `PersonalAgentClientWindow.jsx` (empty-state chips for Dot's actual capabilities; read capabilities from `personalAgentData.js`, don't hand-write a second list)
- Modify: `LiveUseCaseWorkbenchPage.js` (empty drawer → chips from the selected vertical's manifest `chips10`, via `verticalSuggestionChips()`)
- Test: vitest per surface: empty state renders ≥1 chip; clicking fills/sends input; chips absent once messages exist

- [ ] Step 1: Failing vitest for Dot empty state. Step 2: implement. Step 3: same for workbench. Step 4: manual browser check (Welcome wizard intercepts fresh-browser clicks — Skip first). Step 5: Commit.
- [ ] Step 6: Trio sync check: Learning Hub / diagram copy for Dot mentions suggested prompts? Update if so.

**Done when:** both surfaces show chips on first load, verified in the browser.

---

### Task 6: Drift gate for Learning Hub / Jev content (#30)

**Finding:** Many drift gates exist (`check-goldens`, `topology:check`, `navStructureCatalog.drift.test.js`, `learningMirrorIndexDemoLinks.test.js`). Missing: learning-mirror freshness, and agreement between `jevLessons.js`, `jevDemoContent.js`, `demoUseCaseSteps.js` and Learning Hub copy.

**Files:**
- Create: `scripts/check-learning-sync.js` + `scripts/check-learning-sync.test.js`
- Modify: `package.json` (wire into `hygiene:check`)

- [ ] Step 1: Define the cheapest checkable invariant first: every Jev demo id in `jevDemoContent.js` has a lesson in `jevLessons.js` and an entry in `learning-hub-manifest.json` (and vice versa). Failing `node --test` with a fixture missing one entry.
- [ ] Step 2: Implement. Run on repo; record baseline of existing mismatches.
- [ ] Step 3: Fix or explicitly allowlist baseline mismatches (allowlist entries need a reason string), then enforce.
- [ ] Step 4: Mirror freshness: compare mtime/hash of source Learning Hub components to `learning-mirror/` index; warn (not fail) — export needs Playwright, too heavy for CI.
- [ ] Step 5: Commit.

**Done when:** deleting a lesson entry for a live demo fails `hygiene:check`.

---

## Explicitly not planned
- PostHog #1–#9, #38 (product-bet validation): demo platform, not applicable.
- Full OpenRouter usage wrapper: no wrapper exists; Task 3 covers usage via the traces that already exist. Add only if OpenRouter cost becomes a demo story.
- Promptfoo in CI: depends on a live server; Task 1 records a baseline first.

## Corrections to my earlier note
- `mainagentdemo` is a k8s Deployment (`standalone/privilege-a2a-anthropic-demo/k8s/deployment.yaml`, `PRIVILEGE_A2A_MAIN_URL` in `k8s/02-configmap.yaml`), not a llama.cpp live-patched env. The "fragility" is the stale model-ID spread (Task 2), not a live patch. Memory note [[ai-demo2-a2a-tab-floating-agent]] should be re-verified.

## Self-review
- Coverage: all six gaps map to Tasks 1–6 (#34→1, #15→2, #22/#25→3, #26→3+4, #35→5, #30→6).
- Open verification steps (not placeholders): Task 3 Step 3 (estimate marker), Task 4 Step 1 (is traceProjector rendered). Both gate scope and are stated as the first action.
- Type names (`estCostUsd`, `tokens_estimated`, `recordUsage`) are used consistently.
