# Observability Demo — Design

Date: 2026-10-11
Status: approved in chat, pending spec review

## Story (two parts, sequenced)

**Part 1 — Forensics (security buyers).** Run UC20 as it exists today: chip
`show my balance` → Token Chain + Activity evidence panels → Transaction
Trace page. Talking point: the act chain (who the agent was, who it acted
for, what the policy decided) is stamped on every event without
application-layer instrumentation.

**Part 2 — Ops (platform/SRE buyers).** The same traffic is just a monitored
service. Open Grafana (PingOne SSO via `grafana-admins`) on a new overview
dashboard, trigger a live Authorize DENY (UC6, already in demo steps), and
watch decision panels move in real time. Close on the alert-rules page.

**Alert expectations (must be stated in the runbook):** a single DENY will
NOT fire `McpDoorMostlyRejecting` — it needs >80% 4xx for 10 minutes across
≥10 requests, by design (RFC 9728 discovery makes 401 challenges normal).
UC18's rate-limit burst runs on the Node demo gateway, not pinggateway, so
it cannot trip these rules either. The live moment is **dashboards
reacting**; the alerts page is explained, not awaited.

## Deliverables

### 1. React Flow diagram page — `/architecture/observability`

New `ObservabilityDiagramPage` following the `PingFederateIdJagPage` pattern
(`@xyflow/react`, already a dependency; route in
`demo_api_ui/src/routes/EducationRoutes.js` alongside `pingfederate-id-jag`).

Two views:

- **Telemetry data-flow**: emitters (BFF structured logger → lokiForwarder,
  gateway `:8085` admin connector → Prometheus, agent service OTel spans →
  Jaeger, MCP server) → collectors (Alloy, Loki, Prometheus, Jaeger) →
  surfaces (Grafana dashboards, alert rules, in-app Tracing /
  Transaction Trace / MCP Observability pages). Click-to-highlight per
  plane (metrics / logs / traces).
- **Demo walkthrough**: the two-part story as a sequenced flow.

JSX is the source of truth — no `.mmd` twin (ID-JAG has none either).

### 2. Grafana dashboard

`monitoring/grafana/dashboards/agent-observability-overview.json`. Reuse the
existing panels' queries so the new dashboard is honest about what's wired:

| Panel | Source | Query basis |
|---|---|---|
| Decisions by outcome/tool | Loki | `{service="ping-gateway"} \|= "[P1AZ] DECISION:"` (same as p1az-decisions.json) |
| MCP door status mix | Prometheus | `sum by (family) (rate(ig_route_response_status_total{route=~".*mcp.*"}[5m]))` |
| MCP calls by method | Prometheus | `ig_mcp_method_time_seconds_count` / `mcpgw_mcp_call_duration_seconds_count` |
| BFF app events | Loki | `{service="ai-demo-bff", logtype="app_event"}` |
| Firing alerts | Prometheus | `ALERTS{alertstate="firing"}` |

Picked up by the existing dashboards provisioning (`monitoring/grafana/
provisioning/dashboards/dashboards.yml` reads the folder) — zero
provisioning changes.

### 3. Demo runbook

`docs/runbooks/observability-demo.md`: launch command
(`--profile observability --profile tracing`), click order for both parts,
live-DENY steps (UC6), fallback lines, and the alert-expectations caveat
above verbatim.

### 4. Demo steps wiring

- UC20 is already in `DEMO_PRIMARY_USE_CASE_IDS` — no list change.
- Add a `DEMO_STEP_DESTINATIONS.UC20` entry (kind `page`) deep-linking the
  new diagram page.
- Extend the UC20 entry in `demo_api_ui/src/config/demoStepGuides.js` "how
  to run" line with the Grafana + live-DENY beats.

### 5. Side nav

One entry in the Telemetry group of `demo_api_ui/src/components/
AdminSideNav.jsx`: "Observability Demo" → `/architecture/observability`.
Also add to `navPagePaths.js` and `navStructureCatalog.js` (Observability
group) so search and the nav catalog agree.

### 6. Learning Hub + diagram index (trio rule)

- Learning Hub (`demo_api_ui/src/components/LearningHub.tsx`): follow-on
  card after guided step 04 "Prove what happened" → CTA to the new page.
- Register in `demo_api_ui/src/config/diagramsIndex.js` and
  `docs/diagrams/DIAGRAMS.md`.

## Concurrency constraint

The main checkout is shared and currently holds another session's
uncommitted edits to `App.js` and `AdminSideNav.jsx` (Claude Skills Index).
Implementation runs in a **git worktree**; those two files are known merge
points on rebase/merge back.

## Explicitly skipped

- New backend instrumentation — the stack exists end to end.
- New alert rules — existing three are correct as designed.
- Datadog / New Relic story — scaffold/forwarder only, not demo surfaces.
- `.mmd` twin of the diagram.

## Done looks like

1. Full stack up with `--profile observability --profile tracing` → new
   dashboard populated.
2. UC6 DENY visible in the new dashboard within ~30s.
3. `/architecture/observability` renders both views; side nav entry, nav
   catalog, step destination, Learning Hub card, diagrams index all wired.
4. Tests pass for every touched file that has them
   (`demoUseCaseSteps`, `demoStepGuides`, LearningHub, nav catalogs).
