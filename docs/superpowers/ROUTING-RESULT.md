# Routing workflow wf_c2b6715a-fcc: partial result (stopped 2026-10-19 ~07:50)

Stopped at the request of agents-30 (on the user's instruction). Source: the workflow journal at `/Users/cmuir/.claude/projects/-Users-cmuir--agents/b2df1c6e-8429-4853-9632-0bd084f3f85a/subagents/workflows/wf_c2b6715a-fcc/journal.jsonl`. Numbers are from the agents' own runs of `scratchpad/route/measure.mjs`, NOT re-verified by me. Reviews were only partly finished; not all fixes were reviewed again.

State of worktrees when stopped (AI-DEMO2 `.worktrees/`): rt-infra (router, committed 6c39eb07b), rt-static (3 commits, clean), rt-slides (2 commits + 4 uncommitted files), rt-topology (2 commits + 7 uncommitted files), rt-system (2 commits, clean). Playground: `/Users/cmuir/Development/id-jag-standalone/.worktrees/rt-playground`, branch feat/routing-playground, fix commit d376dbf. Nothing pushed.

## Router (feat/routing-infra, 6c39eb07b)
`createRouter` shared grid, `startDir`/`endDir` on all four sides, adaptive cell size, lane spreading, `ignore` option; `orthoRoute`/`pathFromPoints`/`labelPoint` unchanged. 70 routes on a 3000x2500 layout with 100 boxes: about 173 ms total, grid build about 2 ms, 70/70 routed. Tests pass.

## Per target (edges crossing a box: before -> after, router fallbacks)
- **Server Topology** (feat/routing-topology, committed 000dfdf8d; 7 uncommitted files since, probably review fixes): default view 43 of 75 -> 0 of 75 (86 box crossings -> 0); after 4 Next presses 44 -> 0; dark mode 0; after dragging a box into empty space 0; 0 fallbacks. Needed the bottom-row boxes moved apart (12 px gaps left no route: 13 fallbacks before that data change).
- **System Diagram** (feat/routing-system, committed e47c1890e): Full topology (66 edges) 24 crossing (44 crossings) -> 0, route time 43 ms; BFF & Gateways focus 21 -> 0 (51 edges, 24 ms); MCP Servers & Agents 4 -> 0; Frontend & Auth and PingOne Cloud 0 -> 0; dark 0; drops into empty space 0 (dragging GwProxy to overlap other boxes gave 4 fallbacks, expected).
- **Shared Ping-style diagrams, StaticFlowDiagram** (feat/routing-static, committed 919c0ab98 after review fixes): baseline was already 0 crossings on all 5 views (privilege-mcp-diagrams 3 tabs, privilege-first-gateway, gateway-enforcement-map: old curves did not cross boxes), now 0 with right-angle paths, 0 fallbacks (one view uses a retry on a finer grid). Review fixes: badge overlap/clipping, jog before arrowheads, parallel arrows sharing one handle point. Trunk still shared on the enforcement map.
- **Slides, PingSlideFlow** (feat/routing-slides, committed 66600a1f9; 4 uncommitted files since): 13 slides, 244 edges: 1 crossing edge before (jit-access e10 through `appr`) -> 0, 0 fallbacks; drop test 0; dark 0.
- **Playground (id-jag-standalone)** (feat/routing-playground; fix commit d376dbf): mock 1 -> 0, pf-as 1 -> 0, pf-pf 1 -> 0, byo 2 -> 0, 0 fallbacks, dark 0, drop test 0; review fixes: label pills covering box text/badges, shared runs. One pill (byo step 3, edge b3r) runs past the right edge of an 1800 px window, covers no box.

## Not finished
Reviews (measurement / regressions / visual lenses) for topology, static, slides, system were still running or incomplete; verify steps ran only for static and playground (tests passed). Run the full UI suite and re-measure before merging. The uncommitted edits in rt-slides and rt-topology are the agents' work in progress: inspect before committing.
