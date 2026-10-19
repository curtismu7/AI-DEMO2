# Hand-off: Ping-style diagrams, routing rollout, next batch (2026-10-19 07:24, updated 13:05, note on #1582 added)

Written because the working session was about to run out of context. Read this first, then continue at "What to do next".

## Goal (from the user)

Convert the app's diagrams to the **Ping slide look** with learning features, in AI-DEMO2 (`/Users/cmuir/Development/AI-DEMO2`) and the standalone ID-JAG playground (`/Users/cmuir/Development/id-jag-standalone`). Standing instructions from the user:

- **Claude does all merging** (merge commits, only after CI is green). Memory: `feedback-claude-does-merging`. If the classifier blocks `gh pr merge`, ask for a permission rule, do not work around it. `gh pr merge` and `kubectl -n ping-devops-cmuir set image` are allow-listed now.
- Skip HTML mocks now: **just convert** (user decision, 2026-10-18). Mocks were used for the first few only.
- Every diagram: thick **black arrows** in light mode, **near-white** in dark mode, **light grey canvas** in light mode, dark text, labels above the lines, **orange (#ff8c00) numbered arrows** matching the steps, blue dashed lines for future steps/decisions, per-step detail (**request form, MOCK JSON tokens, standards with emerging drafts marked**), click a box = select + jump the reel + scroll to detail, a drag is not a click.
- **Arrows must not cross boxes** (routing, see below).
- "Do it twice" is to be avoided: build new pages on top of the routing work, not before it.

## Done and live (merged, deployed to the hosted frontend sha `d5c4af626`)

AI-DEMO2 PRs merged: #1537 (ID4AI slides 301 + pencil), #1547, #1556, #1557 (slides, Control Plane), #1570 (Token Chain), #1571 (Ping-style infra + 14 pages), #1573 (Token Chain dark-mode colours), #1575 (Token Chain routing around boxes). id-jag-standalone PRs merged: #9 (restyle), #12 (numbered arrows, step detail, standards on all 4 modes; its CI was still queued at merge time, builds never ran), #21 (routing). Routing PR #1579 and handoff docs #1576 are merged too, see below.

Converted: all 6 demo-arch slides, 23 ID4AI slides (`/id4ai-slides/*`), Token Chain, Server Topology, System Diagram, AI Agent Gateway (3 tabs), Privilege-First Gateway, Gateway vs P1AZ, Group Policy Board, Resource Server Placement, Privilege Gateway Topologies, 3 MFA diagrams (`/mfa-test`), Transaction Consent, AIC Token Exchange, the Identity for AI slide, and the 4 playground modes. A global pencil overlay (`DrawOverlay`, Ctrl/Cmd+Shift+D) is live.

Key code: shared opt-in `pingStyle` on `StaticFlowDiagram` / `EmbeddedFlowDiagram`; `PingSlideFlow` (slides); `DiagramReel` (reel + detail, supports `{code}` lines and `refs`); `config/pingStyleStandards.js` (RFC/DRAFT/SPEC helpers + bundles); per-diagram configs in `src/config/`; `utils/orthoRoute.js` (router, Token Chain only on main).

## Routing: MERGED and DEPLOYED (2026-10-19)
- AI-DEMO2 **PR #1579** (merge commit `f9e4dc597`): shared router (any handle side, shared grid, adaptive cell, lane spreading) wired into StaticFlowDiagram (pingStyle pages), PingSlideFlow (29 slides), Server Topology and System Diagram. The first workflow (`wf_c2b6715a-fcc`) was stopped before its review/fix passes finished; leftover edits in rt-slides and rt-topology were committed as WIP and merged. Details of what the workflow got: `docs/superpowers/ROUTING-RESULT.md`.
- id-jag-standalone **PR #21** (playground routing on all four modes) merged.
- Independent re-measure on the merged tree (headless, measure script): 13/13 slides 0 crossing edges, static pages (arch, seq, auth, PF gateway, enforcement map) 0, Server Topology 0 of 75 (live was 43), System Diagram 0 of 66 (+ all 4 focus tabs 0). Full UI suite 966 files / 7506 tests passed; `authz:verify` OK. CI green on the PR.
- Deployed: hosted frontend set to `sha-f9e4dc597869229bf9e3056e32f88051fe863594`, rollout complete, bundle contains `data-route-fallbacks`. Not looked at in a browser on the live host. Local :4000 main checkout fast-forwarded.
- `rt-*` worktrees, local branches and `feat/routing-integrate` removed. Handoff docs PR #1576 merged.

## Batch 2: in flight, OWNED BY agents-89 (do not edit p2-* worktrees)
Pages: PingFederate ID-JAG, Token Flow, A2A Architecture, Personal Agent Design, MCP Gateway OAuth Flow, External Door. Script: `/Users/cmuir/.claude/projects/-Users-cmuir--agents/b2df1c6e-8429-4853-9632-0bd084f3f85a/workflows/scripts/ping-batch-2-wf_ef7f20c1-3fb.js` (edited: routing exists on main, acceptance = 0 crossing edges in light and dark and after a drag, 0 router fallbacks; shared diagram files must not be edited).
Status at ~13:05: agents-89 merged the six pages into ONE combined PR, **#1585** (branch `feat/ping2-batch`, worktree `.worktrees/p2-integrate`). agents-89's own numbers: 7 routes (the 6 pages + `/personal-agent-dual-gateway`) x light/dark x one box drag = 0 crossing edges, 0 page errors, 17 vitest files green; it merges when CI is green, then deletes `p2-a2a-alt` and the `p2-*` worktrees/branches. agents-30's independent measure of #1585 (headless, default view of each of the 7 routes, light and dark, no drag, no scenario/tab switching): 0 crossing edges, 0 page errors on all 14 (edges: pf-id-jag 18, token-flow 23, a2a 20, personal 23, mcp-gateway-oauth 47, external-door 29, dual-gateway 24). Not independently covered: other Token Flow scenarios/tabs, drags, signed-in states.
- Two runs happened by accident (agents-30 `wf_d9848dcc-2a1`, agents-89 `wf_2fbb37a4-af4`), both hit the account session limit at 10:50 (22 of 41 agents failed in the first). agents-89 resumed its run at ~11:35 and owns all six worktrees `.worktrees/p2-{pf-idjag,token-flow,a2a,personal,mcpgw-oauth,external-door}` (branches `feat/ping2-*`) plus the integration (PRs, CI, merge, deploy). Status at 12:41 (branch: commits ahead of origin/main, last commit): pf-idjag 3, 12:13; token-flow 3, 12:14; external-door 3, 12:09; personal 3, 11:56; a2a 2, 11:57; mcpgw-oauth 1, 09:02 with 9 uncommitted files in `p2-mcpgw-oauth` (agents-89's run is presumably still working there). No batch-2 PR is open, nothing is pushed, nothing is merged or deployed. agents-30 is read-only on them and will run an independent crossing measure before the merge if asked.
- `p2-a2a-alt` (`feat/ping2-a2a-alt`) is a stray second A2A attempt from agents-30's run; delete it once agents-89 has picked the A2A branch.
- Reviews known from the first run (journal of `wf_d9848dcc-2a1`): requirements/regressions/accuracy done for external-door, mcpgw-oauth, personal, token-flow; pf-idjag regressions only; a2a none; no visual review, fix or verify finished. Known pf-idjag findings: first Next/Prev click does nothing visible (stepper starts at -1); committed vs on-disk `pfIdJagDiagrams.js` layouts differed (later re-laid out in a fix commit).
- After #1585 merges: fast-forward the main checkout, wait for the "Build images" run on the merge commit, deploy the frontend (`set image`, recipe above), grep a pod for a batch-2 marker, then clean worktrees/branches.

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

- **Pre-commit hook blocks commits from the main checkout, and a failed commit leaves the files staged**: `git diff` then exports an empty patch; use `git diff HEAD`, apply it in a `git worktree add .claude/worktrees/<name> -b <branch> origin/main`, then `git restore --staged --worktree` the files in main.
- **Router (Token Chain) failed first** for three reasons: (1) the edge's own two boxes must also be obstacles, the lead-in/out reaches the handle, otherwise the route cuts through its target; (2) a "snap bend to the handle row" step collapsed corners into diagonals, never snap; (3) after a drag the node map is stale: React Flow mutates `nodeLookup` in place, so subscribe via `useStore` to a **string key built from `internals.positionAbsolute`** (React Flow clamps children into groups; do your own parent+relative arithmetic and it is wrong). Use cheap paths while dragging, re-route on drop (~40 ms for 36 edges).
- **Global CSS page zoom (the "A 113%" control)** skews React Flow handle measurement (arrows ~35 px off boxes). `PingSlideFlow` cancels it inside the canvas (`zoom: 1/k`). `getBoundingClientRect` values are scaled, the measure script resets zoom to 1.
- A worktree has no `node_modules`; `web/node_modules` in id-jag-standalone may exist as a real folder of Vite cache: delete it first, never `ln -s` into an existing directory.
- A new CSS rule that applies to both themes will make black arrows vanish on the dark canvas: always add a `:root[data-theme="dark"]` override.
- Dashed future-step edges get their dash from an inline style: target `[style*="stroke-dasharray"]`, not `[stroke-dasharray]`.
- Pages gated on sign-in (Group Policy, Transaction Consent, AIC Token Exchange) never rendered in headless checks; they are covered by unit tests only. Check them signed in.
- `git branch -d` refuses when local `main` is behind `origin/main`: confirm `git merge-base --is-ancestor <branch> origin/main` then `-D`.
- Sibling sessions share the main checkout and the docker stack: edit only in worktrees; do not touch other sessions' worktrees (`fix-1547`, `fix-1554`, `fix-1556`, `choice-spacing`, `ciba-*`, ... are not ours; `rt-*` and `handoff` are).

- **Account session limit**: workflows with many agents can hit it (10:50 reset on 2026-10-19) and every running agent fails at once; the run still "completes". Check the `failures` list of a workflow result before trusting it, and resume after the reset.
- **Two sessions on one script/worktrees**: before launching or resuming a workflow, `ListAgents` and ask the owning session; the shared `.worktrees/` names collide silently.
- **`set image` is allow-listed but the auto-mode classifier can still deny it** ("Production Deploy"); that is separate from `permissions.allow`. An explicit user "deploy"/"add the permission" message let it through on a retry.
- **Measuring**: a vite dev server killed by another session's `pkill` gives ERR_CONNECTION_REFUSED mid-run; a stale dep optimisation gives "Couldn't lay out this diagram ... elkjs" and 0 edges (not a pass: look at the PNG). The `grep` in this shell is an alias (rtk); use `/usr/bin/grep` for raw output. `timeout` is not installed on macOS.
- The measure script's raw edge count on some pages includes the global "Draw" overlay (`sfx-flow`); scope the selectors to the page's own diagram.

## Known open items

- `src/utils/__tests__/parseCitations.test.js` "resolves to null when fetch fails" times out (30 s) on unmodified main too. Not ours, not fixed.
- id-jag-standalone PR #12 merged while its CI was still queued; the builds ran afterwards (07:41) and passed (build 20, build 22, secrets): closed.
- The standards lists and mock tokens are teaching values; draft names/section numbers should be verified before quoting externally.
- Everything merged so far is deployed (hosted frontend now `001d8f5e6`, which contains routing `f9e4dc597`). Batch 2 is not merged.
- Unrelated fix in the same window: **PR #1582** (merge `001d8f5e6`): the `/llm-gateway` Malicious MCP tab's "Sign in with Privilege" bounced to `/privilege-mcp-client` because `/auth/start` sent no `returnTo`; it now sends `returnTo: '/llm-gateway'` and reads `oauth.authenticated` from `/state` on mount (`HostileMcpTab.jsx` + test). Deployed to the hosted frontend (pod digest checked, bundle grepped); local :4000 hot-reloads it. NOT clicked through in a browser: the BFF only accepts a bare-path `returnTo` (no `?`), so the bounce lands on `/llm-gateway` and the tab comes back via the last-tab memory in `LlmGatewayCombinedPage`; if it opens Chat instead, that memory is the thing to look at. Related: the Attack Library's Tool Abuse / Tool Poisoning / Schema Violation / Inter-Agent Abuse entries have a `demoPath` and leave the prompt empty on purpose, so Send says "Enter a prompt…" (`guardrailAttackCatalog.js`, `LlmGatewayPage.jsx` ~L497); a tool-path-specific message there is an open nicety, not done.
- Routing is applied to pingStyle StaticFlowDiagram/EmbeddedFlowDiagram, slides, Server Topology, System Diagram and the playground; other diagram components still draw their own paths.
- The app's PR #1574 ("Start over button...") is another session's, not ours.

## What to do next (in order)

1. Let agents-89 finish and integrate batch 2 (see above). If it runs out of context, take over from the committed `feat/ping2-*` branches; re-run reviews/fix/verify with `Workflow({scriptPath, resumeFromRunId})` only from the session that started a run, otherwise start a fresh run (stop the old one first).
2. Then the remaining-diagrams list above, in the order the user chooses (ask).
3. Clean up worktrees/branches of everything merged (remove `node_modules` links first, check for leftover `node_modules/.vite` directories after `git worktree remove`; `git branch -D`, `git push origin --delete`).
