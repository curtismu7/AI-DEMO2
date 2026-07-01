# PingOne Authorize (P1AZ) Learning Page — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending spec review
**Branch:** `worktree-p1az-learning-page`

## Problem

The existing `/authz-test` page ([demo_api_ui/src/components/AuthzTestPage.jsx](../../../../demo_api_ui/src/components/AuthzTestPage.jsx)) is a
banking-transaction authorization tester. It exercises exactly **one** PingOne
Authorize (P1AZ) policy pattern — transaction **amount thresholds** producing
`PERMIT` / `STEP_UP` / `DENY`, with ACR/MFA satisfaction. It demonstrates a
small slice of what P1AZ can do and teaches almost none of the product model.

The goal: turn this page into a **learning page** that both **covers the full
P1AZ policy model** and **shows what the product can do**, with runnable,
interactive demos — not just prose.

## Product model to cover (from the docs)

Grounded in the PingOne Authorize documentation
([Introduction](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_introduction.html),
[Policies](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_policies.html),
[Conditions](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_conditions.html)):

- **Trust Framework** — attributes, services (data resolvers); the ABAC inputs.
- **Policies & policy sets** — hierarchical tree; **combining algorithms**.
- **Rules** + **conditions** — comparisons evaluating to true/false.
- **Effects** — `PERMIT` / `DENY` / `INDETERMINATE` (fail-closed).
- **Statements** — obligations/advice, and API payload **filter/transform**
  (data redaction).
- **API Access Management** — scope/operation-level authorization vs raw
  decision-endpoint authorization.

## Decisions (from brainstorming)

- **Depth:** Add **interactive policy demos**, not explainer-only. Each new
  capability gets a runnable demo.
- **Grounding:** **Hybrid.** Teach generic P1AZ concepts with a guaranteed
  **Simulated** path, plus a **Live** toggle per demo that calls a provisioned
  PingOne decision endpoint where one exists.
- **Placement:** Transform the **existing** `/authz-test` page in place
  (Approach A). No new nav page. Reuse the working engine plumbing
  (`test-evaluate`, dual simulated/live engines, endpoint auto-fetch).

## Design

Reorganize [AuthzTestPage.jsx](../../../../demo_api_ui/src/components/AuthzTestPage.jsx)
into **7 teaching sections**. Each section is a self-contained unit:

- **Concept panel** — short explainer grounded in the docs, with a "Learn more"
  link to the relevant doc page.
- **Runnable demo** — Simulated engine always works; a **Live** toggle appears
  only when a decision endpoint is configured for that demo.
- **Annotated result** — shows the decision AND *which policy element fired*
  (policy set → rule → condition → effect → statement), plus raw
  request/response JSON (preserving the existing debug view).

### Sections

| # | Section | Teaches | Demo |
|---|---------|---------|------|
| 1 | **Overview & Trust Framework** | PDP/PEP model, ABAC vs RBAC, attributes & services | Live view of configured endpoints/attributes; explainer only |
| 2 | **Policies, Policy Sets & Combining Algorithms** | Policy tree, how sub-decisions combine | *Existing* amount demo, re-annotated: policy set → rule → condition → effect |
| 3 | **Rules, Conditions & Effects** | PERMIT / DENY / **INDETERMINATE** | *Existing* tester + **new**: unresolvable attribute → INDETERMINATE → fail-closed deny |
| 4 | **Attributes & ABAC** | Decisions from user/resource/environment attributes | **New**: same request, vary role/region/time → different decision |
| 5 | **Statements: Obligations & Advice** | Directives attached to a decision | *Existing* step-up obligation + **new** second obligation (e.g. audit-log) |
| 6 | **Statements: Payload Filtering** | Response redaction/transform by role | **New**: submit account JSON → statement masks/drops fields by role |
| 7 | **API Access Management** | Scope/operation-level authorization | **New**: tie to existing `scope-topology.json` — which API ops a token may call |

### Frontend

- Single page, sectioned layout (collapsible sections or an in-page section
  nav — decided at plan time). Preserve the existing Engine Status banner,
  Engine Settings panel, and Run History table as page-level chrome shared
  across sections.
- New shared presentational unit: a **DemoSection** component (concept panel +
  demo form + annotated result), so each of the 7 sections is one focused,
  independently-understandable instance rather than 1000+ lines of inline JSX.
- **Annotated result** is a new sub-view that renders the policy-element trace
  returned by the backend alongside the existing raw JSON.

### Backend

- Extend [simulatedAuthorizeService.js](../../../../demo_api_server/services/simulatedAuthorizeService.js)
  with handlers for the new capabilities: **ABAC** (attribute-driven decision),
  **INDETERMINATE** (unresolvable attribute → fail-closed), **payload
  filtering** (redact/transform a JSON payload by role), and the **second
  obligation**. Each handler returns, in addition to the decision, a structured
  **policy-element trace** (which policy/rule/condition/statement fired) so the
  frontend can annotate.
- Widen the demo request contract: either extend
  `POST /api/authorize/test-evaluate` to accept the richer inputs (attributes
  map, payload, demo-type discriminator) or add sibling endpoints per demo
  type. Chosen at plan time; the existing amount-threshold path must keep
  working unchanged.
- **Live path is best-effort.** Where a provisioned decision endpoint exists
  for a demo, the Live toggle calls it (reusing existing live-call plumbing).
  Where it does not, the Live toggle is hidden/disabled and Simulated is the
  taught path.

## Success criteria

- All 7 sections render on `/authz-test`, each with a concept panel, a runnable
  Simulated demo, and an annotated result.
- The 4 new capabilities (ABAC, INDETERMINATE, payload filtering, second
  obligation) each produce a correct, annotated Simulated decision.
- The existing amount-threshold scenarios and live PingOne path continue to
  work unchanged (no regression).
- Each section links to the relevant P1AZ doc page.
- Live toggle appears only where an endpoint is configured; its absence never
  breaks a section.

## Out of scope (YAGNI)

- No new navigation entry or standalone Academy page.
- No auth/permission changes.
- No rewrite of the existing live PingOne integration.
- **Provisioning new live P1AZ policies** for the new sections is a stretch,
  not a requirement — Simulated is the guaranteed teaching path, so the build
  does not block on new Trust Framework config.
