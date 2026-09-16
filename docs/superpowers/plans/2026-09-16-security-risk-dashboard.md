# Security & Risk Dashboard plan

## Outcome

Replace the current `Dashboard` destination (which opens the agent workspace) with an operational security dashboard for CISO, risk, and identity/security operations users. Keep the agent workspace available as a separate, clearly labelled `Agent` entry.

This document is a product and implementation plan. The companion mock is [ciso-security-dashboard.html](../../mockups/ciso-security-dashboard.html).

## What the dashboard must answer

Within 30 seconds, an executive should be able to answer:

- Are we safe enough to operate right now, and is posture improving or worsening?
- Which risks are material, overdue, or without an accountable owner?
- Are authentication, authorization, token exchange, policy, and human approval controls working as designed?
- Which infrastructure dependency is creating user or security exposure?
- What evidence supports each score, and what action is required next?

The dashboard is a decision surface, not a second agent console or a replacement for raw observability tools.

## Personas and views

### CISO / security executive

- Overall posture with an explicit scoring explanation and confidence/data-freshness indicator.
- Critical and high risks, open incidents, control coverage, and seven-day trend.
- Material business impact, affected applications/verticals, and risks exceeding SLA.
- One-click path to evidence, owner, remediation plan, and an exportable executive report.

### Risk / compliance professional

- Risk register with severity, likelihood, impact, control mapping, owner, due date, exception, and evidence status.
- Control effectiveness across identity, token/delegation, authorization, transaction approval, and resilience.
- Stale or missing evidence, policy exceptions, failed tests, and audit history.
- Filters by application, environment, data sensitivity, policy, owner, and framework/control family.

### Security / identity operator

- Authentication volume and failure anomalies, MFA/step-up outcomes, policy denials, token-exchange denials, and pending human approvals.
- Actor/delegation-chain anomalies such as audience mismatch, unexpected subject/actor combinations, or scope escalation.
- Dependency health for the BFF, PingOne/DaVinci, authorization/PDP, MCP gateway, agent services, and telemetry pipeline.
- Correlation ID and trace links so an alert can be investigated without copying identifiers between tools.

## Proposed information architecture

1. **Header and context** — environment, tenant/vertical, time range, last refresh, data freshness, and report/export controls.
2. **Posture summary** — overall posture, critical exposure, open incidents, effective controls, and 24-hour security decisions.
3. **Action-required banner** — only material issues, with count, SLA state, owner, and direct investigation action.
4. **Risk trend** — authentication failures, policy denials, token anomalies, and service errors over time; show volume and rate so traffic growth is not mistaken for risk.
5. **Control effectiveness** — control families with score, coverage denominator, latest test, evidence freshness, and drill-down.
6. **Risk queue** — sortable risk register focused on overdue or high-impact items.
7. **Identity and token signals** — authentications, step-up success/failure, RFC 8693 exchanges, denied actions, HITL pending, and suspicious delegation chains.
8. **Infrastructure health** — status, latency, error rate, dependency owner, and last event for each trust-boundary component.
9. **Evidence timeline** — policy changes, deployments, incidents, control tests, approvals, and acknowledgements with immutable event IDs.
10. **Selected-risk detail** — why it matters, affected assets, evidence, suggested next actions, owner, and audit trail.

## Repository data mapping

The first implementation should aggregate existing signals rather than introduce a parallel telemetry store:

| Dashboard area | Initial sources in this repository |
| --- | --- |
| Authentication and session posture | BFF OAuth/session routes, PingOne authorization services, session and token status events |
| Authorization and policy | `demo_authz_server`, authorization rules, policy decision events, configured DaVinci/PingOne policy metadata |
| Token and delegation risk | token exchange services, `TokenChainContext`, scope/audience/actor claims, exchange permit/deny events |
| Transaction and human approval | consent/challenge services, HITL events, approval receipts, transaction-token telemetry |
| Infrastructure health | BFF, UI, `demo_mcp_gateway`, MCP/agent services, PingOne/DaVinci dependency probes |
| Evidence and trends | `appEventService`, structured security logs, Prometheus/Grafana/Jaeger/Loki/Alertmanager integrations |

Each aggregate should carry `observedAt`, `source`, `environment`, `correlationId` when available, and a freshness/quality flag. A score without those fields should be treated as presentation-only, not audit evidence.

## Scoring and guardrails

- Start with transparent rules, not an opaque composite score. Show the contributing controls and the most severe open condition beside every score.
- Separate **risk severity** from **service health**. A healthy service can still enforce a dangerous policy; a degraded service can create availability risk without indicating compromise.
- Make “unknown” visible when telemetry is stale or incomplete; never render missing evidence as green.
- Default to production and the current tenant/vertical, with explicit environment switching.
- Redact secrets, raw tokens, personal data, and unnecessary claim values. Show claim names and safe fingerprints only.
- Restrict dashboard and evidence actions through existing admin authorization; record acknowledgements, assignments, exports, and status changes.

## Delivery plan

### Phase 1 — contract and read-only MVP

- Define `SecurityPostureSnapshot`, `RiskItem`, `ControlSummary`, `DependencyHealth`, `SecuritySignal`, and `EvidenceEvent` schemas.
- Build a read-only aggregate endpoint with source timestamps and quality flags.
- Implement posture cards, action-required banner, trend, risk queue, and dependency health.
- Keep the existing agent dashboard reachable as `Agent`; do not overload its route or data model.

### Phase 2 — evidence and investigation

- Add selected-risk drawer, correlation/trace links, evidence timeline, filters, and CSV/JSON executive export.
- Link each score to its underlying events and control tests.
- Add explicit data-source failure states and stale-data banners.

### Phase 3 — ownership and governance

- Add owner assignment, acknowledgement, due date, exception workflow, and audit history.
- Add role-specific views for CISO, risk, and operator users while preserving one canonical risk record.
- Add retention/redaction tests and authorization tests for every mutation and export.

### Phase 4 — navigation migration

- Add a dedicated route such as `/security-dashboard` for this dashboard.
- Change the side-nav `Dashboard` item to that route.
- Rename or move the current `/dashboard` entry to `Agent` so the existing button remains discoverable and unambiguous.
- Validate direct links, responsive nav, deep links, and browser history before removing any legacy alias.

## Success criteria

- CISO can identify the top three material risks, their owners, and evidence in under one minute.
- Risk users can distinguish overdue remediation from stale telemetry without leaving the dashboard.
- Operators can follow a signal to a correlation ID and affected trust-boundary dependency.
- Every displayed score has a freshness timestamp, source, and drill-down path.
- No raw credential, token, or unnecessary personal data is exposed.
- Existing agent workflows, navigation permissions, and monitoring tools continue to work unchanged during rollout.

## Non-goals

- Rebuilding Grafana, Jaeger, or log search inside the product.
- Turning the dashboard into an agent chat or infrastructure control plane.
- Claiming regulatory compliance from a percentage score alone.
- Adding real-time streaming before the read-only aggregate contract and stale-data behavior are reliable.
