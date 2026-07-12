# Hidden Diagram Pages — what they are and how to bring them back

On 2026-07-11 the admin nav's **Diagrams** section was consolidated to the three
most useful pages. The other four pages were **hidden from the nav only** —
their routes, components, and data files are all still in the repo and still
render if you visit the URL directly.

## What was kept (the top 3)

| Nav entry | Route | Why it stayed |
| --- | --- | --- |
| System Diagram | `/architecture/system` | Authoritative view — static render of `docs/diagrams/architecture.mmd` (the source of truth, regenerable from the page's admin toolbar), plus Token Exchange, Narrative, and CIBA Step-Up tabs. |
| Overview Diagram | `/architecture/overview` | Interactive scenario simulator (~17 scenarios incl. the 5 attack scenarios used in demos), live SSE mode. |
| Sequence Diagram | `/sequence-diagram` | Step-by-step RFC 8693 / Ping Authorize walkthrough mirroring `i4ai-ref-arch.mmd`; strongest educational page. |

## What was hidden

All four remain reachable by direct URL; only the nav entries are commented out.

### Token Flow (Interactive) — `/architecture/token-flow`

- **Component:** `demo_api_ui/src/components/ArchitectureTokenFlowPage.js`
  (rendered through the shared `ArchitectureDiagramPage.js` PNG+overlay viewer),
  regions config in `demo_api_ui/src/config/diagram-token-flow-regions.js`.
- **What it shows:** the static `token-flow.png` (rendered from
  `docs/diagrams/i4ai-ref-arch.mmd`) with clickable hotspot regions, a 15-step
  token-exchange simulation, SSE-driven region highlighting, and a Path A/B/C
  credential-disposition selector.
- **Why hidden:** overlaps the Sequence Diagram (both are built from
  `i4ai-ref-arch.mmd`); step text still uses stale `banking_*` service names and
  "Phase 266/267" labels.

### Interactive Flow — `/architecture/flow`

- **Component:** `demo_api_ui/src/components/ArchitectureFlowPage.js`
  (React Flow / `@xyflow/react` graph, ~3000 lines, node/edge data inline).
- **What it shows:** a pannable service graph with live SSE activity
  highlighting, A2A orchestrator/specialist nodes, scenario playback with
  adjustable step speed.
- **Why hidden:** overlaps the Overview simulator; heavy stale `banking_*`
  naming and Phase 266/267 labels throughout the inline node data.

### Phase 266 — 3 Paths — `/architecture/phase-266`

- **Component:** `demo_api_ui/src/components/Phase266ArchitecturePage.jsx`
  (client-side Mermaid render of an inline source string + path filter bar).
- **What it shows:** the three credential dispositions at the gateway
  (Path A api_key, Path B dual_token, Path C oauth_bearer) with per-path
  dim/highlight filtering and an RFC hop list.
- **Why hidden:** one-off phase-named snapshot, self-declared scope-limited
  (no invest/HITL); entirely stale `banking_*` naming; content is covered by
  the System Diagram and Sequence Diagram.

### Canvas Diagram — `/architecture/canvas`

- **Component:** `demo_api_ui/src/components/ArchitectureCanvasPage.jsx`
  (`react-konva` canvas, auto-layout via `hooks/useCanvasLayout.js`, drag /
  multi-select / export to Mermaid + draw.io).
- **What it shows:** an editable canvas version of the service topology with
  live service-status coloring and step-timing playback.
- **Why hidden:** experimental editor rather than a reference diagram; overlaps
  the Overview simulator; uses emoji node icons outside the repo's
  REGRESSION_PLAN §0 allowlist.

## How to restore an entry

1. Open `demo_api_ui/src/components/AdminSideNav.jsx` and find the "Diagrams"
   group (search for `label: "Diagrams"`).
2. Uncomment the entry you want under the `Hidden 2026-07-11` comment block.
3. Rebuild the UI (`cd demo_api_ui && npm run build`) or let the dev server
   hot-reload. No route changes are needed — the routes in
   `demo_api_ui/src/routes/EducationRoutes.js` (and `MonitoringRoutes.js` for
   `/sequence-diagram`) were never removed.

If a restored page is used again, bring its service naming up to date first:
the current defaults are PingGateway (IG, `:3036`) as the MCP gateway,
llama.cpp via `demo_llm_proxy :8090` as the LLM, and fail-closed
`AUTHORIZE_FAILOVER_MODE=deny` on Ping Authorize outage (see `DIAGRAMS.md`).
