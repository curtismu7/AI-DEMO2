# Hand-off: Ping-style diagrams, routing rollout, next batch (2026-10-19 07:24, updated 12:57)

Written because the working session was about to run out of context. Read this first, then continue at "What to do next".

## Goal (from the user)

Convert the app's diagrams to the **Ping slide look** with learning features, in AI-DEMO2 (`/Users/cmuir/Development/AI-DEMO2`) and the standalone ID-JAG playground (`/Users/cmuir/Development/id-jag-standalone`). Standing instructions from the user:

- **Claude does all merging** (merge commits, only after CI is green). Memory: `feedback-claude-does-merging`. If the classifier blocks `gh pr merge`, ask for a permission rule, do not work around it. `gh pr merge` and `kubectl -n ping-devops-cmuir set image` are allow-listed now.
- Skip HTML mocks now: **just convert** (user decision, 2026-10-18). Mocks were used for the first few only.
- Every diagram: thick **black arrows** in light mode, **near-white** in dark mode, **light grey canvas** in light mode, dark text, labels above the lines, **orange (#ff8c00) numbered arrows** matching the steps, blue dashed lines for future steps/decisions, per-step detail (**request form, MOCK JSON tokens, standards with emerging drafts marked**), click a box = select + jump the reel + scroll to detail, a drag is not a click.
- **Arrows must not cross boxes** (routing, see below).
- "Do it twice" is to be avoided: build new pages on top of the routing work, not before it.

## Done and live (merged, deployed to the hosted frontend sha `d5c4af626`)

AI-DEMO2 PRs merged: #1537 (ID4AI slides 301 + pencil), #1547, #1556, #1557 (slides, Control Plane), #1570 (Token Chain), #1571 (Ping-style infra + 14 pages), #1573 (Token Chain dark-mode colours), #1575 (Token Chain routing around boxes). id-jag-standalone PRs merged: #9 (restyle), #12 (numbered arrows, step detail, standards on all 4 modes; its CI was still queued at merge time, builds never ran), #21 (routing, merge `36f9d84f8`; its worktree and branch are removed). Routing PR #1579 and handoff docs #1576 are merged too, see below.

Converted: all 6 demo-arch slides, 23 ID4AI slides (`/id4ai-slides/*`), Token Chain, Server Topology, System Diagram, AI Agent Gateway (3 tabs), Privilege-First Gateway, Gateway vs P1AZ, Group Policy Board, Resource Server Placement, Privilege Gateway Topologies, 3 MFA diagrams (`/mfa-test`), Transaction Consent, AIC Token Exchange, the Identity for AI slide, and the 4 playground modes. A global pencil overlay (`DrawOverlay`, Ctrl/Cmd+Shift+D) is live.

Key code: shared opt-in `pingStyle` on `StaticFlowDiagram` / `EmbeddedFlowDiagram`; `PingSlideFlow` (slides); `DiagramReel` (reel + detail, supports `{code}` lines and `refs`); `config/pingStyleStandards.js` (RFC/DRAFT/SPEC helpers + bundles); per-diagram configs in `src/config/`; `utils/orthoRoute.js` (router, Token Chain only on main).

## Routing: MERGED and DEPLOYED (2026-10-19)
- AI-DEMO2 **PR #1579** (merge commit `f9e4dc597`): shared router (any handle side, shared grid, adaptive cell, lane spreading) wired into StaticFlowDiagram (pingStyle pages), PingSlideFlow (29 slides), Server Topology and System Diagram. The first workflow (`wf_c2b6715a-fcc`) was stopped before its review/fix passes finished; leftover edits in rt-slides and rt-topology were committed as WIP and merged. Details of what the workflow got: `docs/superpowers/ROUTING-RESULT.md`.
- id-jag-standalone **PR #21** (playground routing on all four modes) merged.
- Independent re-measure on the merged tree (headless, measure script): 13/13 slides 0 crossing edges, static pages (arch, seq, auth, PF gateway, enforcement map) 0, Server Topology 0 of 75 (live was 43), System Diagram 0 of 66 (+ all 4 focus tabs 0). Full UI suite 966 files / 7506 tests passed; `authz:verify` OK. CI green on the PR.
- Deployed: hosted frontend set to `sha-f9e4dc597869229bf9e3056e32f88051fe863594`, rollout complete, bundle contains `data-route-fallbacks`. Not looked at in a browser on the live host. Local :4000 main checkout fast-forwarded.
- `rt-*` worktrees, local branches and `feat/routing-integrate` removed. Handoff docs PR #1576 merged.

## Batch 2: PR #1585 OPEN (owned by agents-89), not merged, not deployed
Pages: PingFederate ID-JAG, Token Flow, A2A Architecture, Personal Agent Design, MCP Gateway OAuth Flow, External Door. Workflow `wf_2fbb37a4-af4` (script `/Users/cmuir/.claude/projects/-Users-cmuir--agents/b2df1c6e-8429-4853-9632-0bd084f3f85a/workflows/scripts/ping-batch-2-wf_ef7f20c1-3fb.js`) was resumed after the 10:50 session limit and finished 42 of 42 agents, 0 errors: convert, four review lenses, fix and verify for every page.
- **One combined PR**: https://github.com/cmuir_pingcorp/AI-DEMO2/pull/1585, branch `feat/ping2-batch` (worktree `.worktrees/p2-integrate`), the six `feat/ping2-*` branches merged with `--no-ff` onto `ed3c349ab`, no conflicts. 46 files, no shared diagram/router/standards file edited; `themingRatchet` pin lowered 55 -> 54 (mcpgw-oauth).
- **Verified by agents-89 on the merged tree**: 17 vitest files (every changed test + designTokenRatchet, themingRatchet, contrastRatchet) pass. Headless measure on 7 routes (the six + `/personal-agent-dual-gateway`) x light/dark x one box drag: edgesCrossing 0, crossings 0, page errors 0 everywhere. Looked at the PF ID-JAG (light), MCP Gateway OAuth (dark) and Personal Agent (light) screenshots. The full UI suite is left to CI. Drag test used a copy of the measure script that scrolls the box into view (`scratchpad/route/measure-drag.mjs`) and a selector without a colon (`--drag '.react-flow__node:70,45'`).
- **Review findings fixed** (all high/medium ones the reviewers raised; examples): A2A SendMessage method name and reply shape, client-credentials/exchange forms follow the repo defaults (body credentials, audience handling), nested `act` chain on the PF final token, `McpToolCall` decision context at the gateway hop.
- **Known leftovers**: the 19-call PingFederate sequence is still a hand-built SVG with lifelines (restyled, not router-measured); the PF login figure is crowded between the BFF and PingFederate boxes (0 crossings); wire forms follow the repo's SDK, not a live capture; the sibling `/architecture/a2a` page (A2A Delegation, `A2ATokenFlowDiagram`) is still in the old style; pages needing sign-in were measured with `/api` stubbed.
- **Coordination**: agents-30 is read-only on `p2-*`, has been asked for an independent crossing measure on #1585 and will only speak up on a nonzero count. `p2-a2a-alt` (`feat/ping2-a2a-alt`, agents-30's stray A2A attempt) is to be deleted after the merge; compare it with `feat/ping2-a2a` first if wanted.
- **After CI is green**: `gh pr merge 1585 --merge`, `git merge --ff-only origin/main` in the main checkout (when clean), wait for "Build images" on the merge commit, guarded `kubectl set image` for the frontend (see Deploy below), check the pod, then delete the worktrees `p2-*` and `p2-integrate`, local and remote branches `feat/ping2-*` and `feat/ping2-batch`. Remove `node_modules` links first.

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

- **Account session limit**: workflows with many agents can hit it (10:50 reset on 2026-10-19) and every running agent fails at once; the run still "completes". Check the `failures` list of a workflow result before trusting it, and resume after the reset.
- **Two sessions on one script/worktrees**: before launching or resuming a workflow, `ListAgents` and ask the owning session; the shared `.worktrees/` names collide silently.
- **`set image` is allow-listed but the auto-mode classifier can still deny it** ("Production Deploy"); that is separate from `permissions.allow`. An explicit user "deploy"/"add the permission" message let it through on a retry.
- **Measuring**: a vite dev server killed by another session's `pkill` gives ERR_CONNECTION_REFUSED mid-run; a stale dep optimisation gives "Couldn't lay out this diagram ... elkjs" and 0 edges (not a pass: look at the PNG). The `grep` in this shell is an alias (rtk); use `/usr/bin/grep` for raw output. `timeout` is not installed on macOS.
- The measure script's raw edge count on some pages includes the global "Draw" overlay (`sfx-flow`); scope the selectors to the page's own diagram.

## Known open items

- `src/utils/__tests__/parseCitations.test.js` "resolves to null when fetch fails" times out (30 s) on unmodified main too. Not ours, not fixed.
- id-jag-standalone PR #12 merged while its CI was still queued; the builds ran afterwards (07:41) and passed (build 20, build 22, secrets): closed.
- The standards lists and mock tokens are teaching values; draft names/section numbers should be verified before quoting externally.
- Everything merged so far is deployed (hosted frontend `f9e4dc597`, routing included). Batch 2 (#1585) is open, not merged.
- Routing is applied to pingStyle StaticFlowDiagram/EmbeddedFlowDiagram, slides, Server Topology, System Diagram and the playground; other diagram components still draw their own paths.
- The app's PR #1574 ("Start over button...") is another session's, not ours.

## What to do next (in order)

1. Finish batch 2: watch CI on #1585 (rerun the UI job on the runner memory-guard flake, `gh run rerun <run> --failed`), merge, ff the main checkout, deploy, clean up (see the batch 2 section). If the session that owns it is gone, take over from branch `feat/ping2-batch` / worktree `.worktrees/p2-integrate`.
2. Then the remaining-diagrams list above, in the order the user chooses (ask). The convert -> four review lenses -> fix -> verify workflow pattern worked; run it in smaller groups so one session limit cannot stop every agent, and check the result's `failures` list.
3. Clean up worktrees/branches of everything merged (remove `node_modules` links first, check for leftover `node_modules/.vite` directories after `git worktree remove`; `git branch -D`, `git push origin --delete`).
