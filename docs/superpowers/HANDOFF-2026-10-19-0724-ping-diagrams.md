# Hand-off: Ping-style diagrams, routing rollout, next batch (2026-10-19 07:24)

Written because the working session was about to run out of context. Read this first, then continue at "What to do next".

## Goal (from the user)

Convert the app's diagrams to the **Ping slide look** with learning features, in AI-DEMO2 (`/Users/cmuir/Development/AI-DEMO2`) and the standalone ID-JAG playground (`/Users/cmuir/Development/id-jag-standalone`). Standing instructions from the user:

- **Claude does all merging** (merge commits, only after CI is green). Memory: `feedback-claude-does-merging`. If the classifier blocks `gh pr merge`, ask for a permission rule, do not work around it. `gh pr merge` and `kubectl -n ping-devops-cmuir set image` are allow-listed now.
- Skip HTML mocks now: **just convert** (user decision, 2026-10-18). Mocks were used for the first few only.
- Every diagram: thick **black arrows** in light mode, **near-white** in dark mode, **light grey canvas** in light mode, dark text, labels above the lines, **orange (#ff8c00) numbered arrows** matching the steps, blue dashed lines for future steps/decisions, per-step detail (**request form, MOCK JSON tokens, standards with emerging drafts marked**), click a box = select + jump the reel + scroll to detail, a drag is not a click.
- **Arrows must not cross boxes** (routing, see below).
- "Do it twice" is to be avoided: build new pages on top of the routing work, not before it.

## Done and live (merged, deployed to the hosted frontend sha `d5c4af626`)

AI-DEMO2 PRs merged: #1537 (ID4AI slides 301 + pencil), #1547, #1556, #1557 (slides, Control Plane), #1570 (Token Chain), #1571 (Ping-style infra + 14 pages), #1573 (Token Chain dark-mode colours), #1575 (Token Chain routing around boxes). id-jag-standalone PRs merged: #9 (restyle), #12 (numbered arrows, step detail, standards on all 4 modes; its CI was still queued at merge time, builds never ran).

Converted: all 6 demo-arch slides, 23 ID4AI slides (`/id4ai-slides/*`), Token Chain, Server Topology, System Diagram, AI Agent Gateway (3 tabs), Privilege-First Gateway, Gateway vs P1AZ, Group Policy Board, Resource Server Placement, Privilege Gateway Topologies, 3 MFA diagrams (`/mfa-test`), Transaction Consent, AIC Token Exchange, the Identity for AI slide, and the 4 playground modes. A global pencil overlay (`DrawOverlay`, Ctrl/Cmd+Shift+D) is live.

Key code: shared opt-in `pingStyle` on `StaticFlowDiagram` / `EmbeddedFlowDiagram`; `PingSlideFlow` (slides); `DiagramReel` (reel + detail, supports `{code}` lines and `refs`); `config/pingStyleStandards.js` (RFC/DRAFT/SPEC helpers + bundles); per-diagram configs in `src/config/`; `utils/orthoRoute.js` (router, Token Chain only on main).

## In flight right now

### Routing workflow `wf_c2b6715a-fcc` (RUNNING when this was written)
Script: `/Users/cmuir/.claude/projects/-Users-cmuir--agents/b2df1c6e-8429-4853-9632-0bd084f3f85a/workflows/scripts/route-around-boxes-wf_c2b6715a-fcc.js`. Resume: `Workflow({scriptPath, resumeFromRunId: "wf_c2b6715a-fcc"})`. Journal: `.../subagents/workflows/wf_c2b6715a-fcc/journal.jsonl`.

Phases: **router** (done, committed on `feat/routing-infra` in worktree `.worktrees/rt-infra`, commit `6c39eb07b`: any handle side, shared grid `createRouter`, adaptive cell, lane spreading) then five **wire** agents (each own worktree/branch, then 3 reviews, fix, verify): `feat/routing-static` (StaticFlowDiagram, covers pingStyle pages), `feat/routing-slides` (PingSlideFlow, 29 slides), `feat/routing-topology` (Server Topology), `feat/routing-system` (System Diagram / FlowchartFlowDiagram), `feat/routing-playground` (id-jag-standalone, worktree `.worktrees/rt-playground` there). Worktrees: `AI-DEMO2/.worktrees/rt-{infra,static,slides,topology,system}`.
When it finishes the tool returns per-target `measurements` (crossings before/after), review issues, final verification. Agents do not push.

**Integrate it like this:**
1. Read the workflow result. Check each target's before/after (goal: 0 crossings).
2. New worktree off `origin/main`, merge `feat/routing-infra` first, then the four AI-DEMO2 targets (expect small conflicts only if two touched the same shared file; they were told not to touch orthoRoute.js).
3. Full UI suite: `cd demo_api_ui && CI=true npx vitest run --reporter=default > /tmp/x.log 2>&1; grep -E "Test Files|Tests  |FAIL" /tmp/x.log` (about 10-25 min; redirect to a log, never pipe straight to grep). Also `npm run authz:verify` from the repo root (link `demo_api_server/node_modules`).
4. Verify visually with the measure script (below) and screenshots; push; open PR; wait for CI; merge; fast-forward the main checkout (`git merge --ff-only origin/main` in `/Users/cmuir/Development/AI-DEMO2`, it serves :4000); deploy (below).
5. Playground: separate repo and PR (`feat/routing-playground`), then clean worktrees and branches.

### Batch 2 (NOT started, deliberately; waits for routing to be merged)
The user asked for **#5 PingFederate ID-JAG, #6 Token Flow, #12 A2A Architecture, #19 Personal Agent Design, #27 MCP Gateway OAuth Flow, #28 External Door** (routes: `/architecture/pingfederate-id-jag`, `/architecture/token-flow`, `/a2a-architecture`, `/personal-agent-design`, `/mcp-gateway-oauth-flow`, `/external-door-diagrams`). The script is saved: `.../workflows/scripts/ping-batch-2-wf_ef7f20c1-3fb.js` (that run was stopped after launch, no worktrees were created). Relaunch it AFTER routing is merged into main: `Workflow({scriptPath: <that file>})` (do not resume the stopped run), after editing the spec to say routing already exists on main and that the acceptance check is **0 crossings** from the measure script (currently it says crossings are informational). Sequence/lifeline figures are exempt from draggable boxes but need the Ping look + steps + detail.

## Remaining diagrams (after batch 2)
Ping-product: CIMD in Privilege, Personal Agent Dual Gateway, Personal Agent Design Review. Tokens/delegation: Delegated Access Proof, Invest Dual-Auth, Delegated Commerce, Delegation Chain Value. Other architecture: Overview Diagram, System Flow (Live), Phase 266, DaVinci SDK explainer, Observability Demo, MCP Observability. Onboarding/agents: Agent Onboarding Flow (+ Subway, + React Flow), Dot Workbench, Personal Agent Studio. Probably not worth it: Interactive Flow, Sequence Diagram, Canvas Diagram, Demo Steps Lifeline Audit, Demo Map, Jev Demo Gallery, Hosted Registration. Plus the ~68 use-case diagram configs in `src/config/useCaseDiagrams/` (one big batch).

## Tools and recipes

- **Crossing measurement** (the acceptance test): `node /private/tmp/claude-502/-Users-cmuir--agents/b2df1c6e-8429-4853-9632-0bd084f3f85a/scratchpad/route/measure.mjs --url <url> --nodes "<css of boxes>" --edges ".react-flow__edge path.react-flow__edge-path" --tag name [--drag "<css>:dx,dy"] [--theme dark]`. Headless Chromium, stubs `/api/**`, neutralises the app's CSS page zoom, writes `<tag>.png` next to it. Baseline numbers: live Server Topology had 43 of 75 edges crossing boxes; Token Chain 11 before routing, 0 after. (`/tmp` scratch files may be gone in a new session: it is plain Node + `@playwright/test` from `AI-DEMO2/demo_api_ui/node_modules`.)
- **Preview a worktree**: `ln -sfn /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules <wt>/demo_api_ui/node_modules; cd <wt>/demo_api_ui && (nohup npx vite --port 40xx --strictPort > /tmp/vite.log 2>&1 &)`. First load compiles for a long time. The page shows a "Loading feature flags" overlay until `/api` answers; the measure script stubs it. Remove the link before committing.
- **Do not use the shared Playwright MCP browser for loops**: it hung for 30 minutes once and locked. Use standalone scripts.
- **Deploy (hosted frontend)**: wait for the "Build images" run on the merge commit (`gh run list --workflow "Build images" --branch main`), check live image sha is an ancestor of the merge (`kubectl -n ping-devops-cmuir get deploy frontend -o jsonpath='{.spec.template.spec.containers[0].image}'`), then `kubectl -n ping-devops-cmuir set image deploy/frontend frontend=ghcr.io/cmuir_pingcorp/ai-demo-frontend:sha-<full merge sha>`, `rollout status`, and grep a pod (`kubectl ... get pods -o name | grep frontend-`; `exec <pod> -- grep -rl <marker> /usr/share/nginx/html/assets`). Live at deploy time: `d5c4af626`.
- **Local stack :4000** serves the main checkout via bind mount: after a merge do `git merge --ff-only origin/main` in `/Users/cmuir/Development/AI-DEMO2` (only when clean). Other sessions also sync it. Docker/OrbStack hung once under load (API :3001 and :4000 timed out); it recovered by itself, do not restart it.
- **CI**: required checks "UI tests (Vitest) + build", "Hygiene + topology gates", "Select affected test suites". The UI job sometimes dies in the runner memory guard ("Could not inspect worker RSS ... stopping Vitest"): that is infrastructure, `gh run rerun <run> --failed`. The id-jag-standalone CI run can sit queued a long time.
- Repo ratchets: no new literal `border-radius` / `font-size` in CSS (use `var(--radius-*)`, `var(--font-size-*)`; `src/__tests__/designTokenRatchet.test.js`, pins must not be raised), no emoji in UI strings, new CSS must reference a `--th-*` token (`themingRatchet`).
- Workflow tool limits: agents cannot use browser MCP, cannot push; they commit locally in their own worktrees. `/workflows` is not available here.

## Traps already paid for (do not repeat)

- **Router (Token Chain) failed first** for three reasons: (1) the edge's own two boxes must also be obstacles, the lead-in/out reaches the handle, otherwise the route cuts through its target; (2) a "snap bend to the handle row" step collapsed corners into diagonals, never snap; (3) after a drag the node map is stale: React Flow mutates `nodeLookup` in place, so subscribe via `useStore` to a **string key built from `internals.positionAbsolute`** (React Flow clamps children into groups; do your own parent+relative arithmetic and it is wrong). Use cheap paths while dragging, re-route on drop (~40 ms for 36 edges).
- **Global CSS page zoom (the "A 113%" control)** skews React Flow handle measurement (arrows ~35 px off boxes). `PingSlideFlow` cancels it inside the canvas (`zoom: 1/k`). `getBoundingClientRect` values are scaled, the measure script resets zoom to 1.
- A worktree has no `node_modules`; `web/node_modules` in id-jag-standalone may exist as a real folder of Vite cache: delete it first, never `ln -s` into an existing directory.
- A new CSS rule that applies to both themes will make black arrows vanish on the dark canvas: always add a `:root[data-theme="dark"]` override.
- Dashed future-step edges get their dash from an inline style: target `[style*="stroke-dasharray"]`, not `[stroke-dasharray]`.
- Pages gated on sign-in (Group Policy, Transaction Consent, AIC Token Exchange) never rendered in headless checks; they are covered by unit tests only. Check them signed in.
- `git branch -d` refuses when local `main` is behind `origin/main`: confirm `git merge-base --is-ancestor <branch> origin/main` then `-D`.
- Sibling sessions share the main checkout and the docker stack: edit only in worktrees; do not touch other sessions' worktrees (`fix-1547`, `fix-1554`, `fix-1556`, `choice-spacing`, `ciba-*`, ... are not ours; `rt-*` and `handoff` are).

## Known open items

- `src/utils/__tests__/parseCitations.test.js` "resolves to null when fetch fails" times out (30 s) on unmodified main too. Not ours, not fixed.
- id-jag-standalone PR #12 merged while its CI was still queued; the builds ran afterwards (07:41) and passed (build 20, build 22, secrets): closed.
- The standards lists and mock tokens are teaching values; draft names/section numbers should be verified before quoting externally.
- Dark-mode and routing changes for Token Chain are deployed; the Ping-style batch is deployed. Everything merged so far is deployed except what the routing workflow will add.
- Arrows can still share a channel and overlap each other where routing is not yet applied; the new router adds lane spreading.
- The app's PR #1574 ("Start over button...") is another session's, not ours.

## What to do next (in order)

1. Wait for / read the routing workflow result; integrate, test, PR, merge, ff the main checkout, deploy (see "Integrate it like this"). Do the playground routing PR too.
2. Edit the batch-2 script (routing exists; 0 crossings required) and run it for the six pages; integrate the same way.
3. Then the remaining-diagrams list above, in the order the user chooses (ask).
4. Clean up worktrees/branches of everything merged (remove `node_modules` links first; `git worktree remove --force`, `git branch -D`, `git push origin --delete`).
