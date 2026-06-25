# Feature Touchpoints skill + CIBA step-up propagation — Design

Date: 2026-06-16
Status: Approved (design)
Branch: worktree-feature-touchpoints-and-ciba-propagation

## Problem

Changes to a demo flow must surface in many places — token-chain UI, diagrams,
reports, learning pages, docs, skills, bootstrap config, tests — and surfaces
get missed. Two needs:

1. A **durable skill** that catalogs every surface a change must propagate to
   (the "where else do I update this" checklist), modeled on the existing
   `add-vertical` skill.
2. **Propagate the recent CIBA step-up knowledge** (corrected flow + known bug +
   approval-channel table, captured in commit `b9603247`) across all those
   surfaces, as the first real use of the new skill.

## Scope (approved)

Five workstreams. WS0 first (it defines the checklist the rest follow); then
WS1 → WS4. WS1 precedes WS2 so the live step-up path actually emits token-chain
events for the new tab to render.

| # | Workstream | Risk |
|---|-----------|------|
| 0 | `feature-touchpoints` skill (durable) | Low (docs) |
| 1 | Fix camelCase transfer→CIBA bridge bug | Med (runtime) |
| 2 | New "CIBA Step-Up" token-chain tab | Med (React) |
| 3 | Education + docs + diagrams | Low |
| 4 | Reports surface | Low/Med |

## WS0 — `feature-touchpoints` skill

- **File:** `.claude/skills/feature-touchpoints/SKILL.md`; one index line in `AGENTS.md`.
- **Approach A (static checklist)** — chosen over a verify-script (B) or JSON map
  (C) for lowest maintenance and parity with `add-vertical`.
- **Frontmatter trigger phrases:** "where else do I update / what did I miss /
  show this in the token chain / propagate this change / did I update
  reports/diagrams/learning pages."
- **Body:**
  - How-to-use: identify *change type* → run matching rows → tick each.
  - Master surface table, 8 groups, each with file paths + "how to add one":
    1. Token chain UI — `ArchitectureTabsPanel.jsx` (tab registry),
       `TokenChainContext.js`, `UnifiedTokenFlowInspector.jsx`,
       `FloatingTokenChainPanel.js`, `tokenChainService.js` /
       `tokenDisplayService.js` (event emission).
    2. Diagrams — `*.mmd` (repo root), `scripts/build-diagrams.sh`,
       `routes/diagrams.js` allowlist, `config/diagram-*-regions.js`,
       `public/architecture/*.png|svg`.
    3. Reports — `RunReportPage.js`, `/api/reports/history`.
    4. Learning pages — `routes/EducationRoutes.js`, routes in `App.js`,
       `utils/educationalPages.js` prefixes, `components/education/*`
       (`educationContent.js`, `educationIds.js`), `docs/education-panels.md`.
    5. Docs (SoT) — `ARCHITECTURE-TRUTHS.md`, `SCOPE_AUDIENCE_MAPPING.md`,
       `INTROSPECTION_VALIDATION_GUIDE.md`, `OAUTH2_TOKEN_EXCHANGE_*.md`,
       `user-guide/PINGONE_CONFIG.md`, `REGRESSION_PLAN.md`.
    6. Skills — relevant `.claude/skills/<topic>/SKILL.md`,
       `.sdlc/framework/skills/00-index.md`, `AGENTS.md`.
    7. Bootstrap/config SoT — `service-topology.json` (+`gen-service-topology.js`),
       `scope-topology.json`, `config/pingone-bootstrap.manifest.example.json`,
       `pingoneBootstrapService.js`.
    8. Tests — `tests/real/*`, skip-proof pipeline, regression tests.
  - Change-type → rows quick map (new OAuth/step-up flow → 1,2,4,5,6,8; new
    scope → 7,5,6; new vertical → defer to `add-vertical`; bug fix in a
    documented flow → fix code + documenting skill + `REGRESSION_PLAN` bug log).
  - Self-maintenance rule: add a row when a new surface *type* appears;
    re-verify paths before relying on them.

## WS1 — Fix the camelCase bug

- Root cause (per `ciba` SKILL.md, verified 2026-06-16): `UserDashboard.handleCibaStepUp`
  POSTs `{ loginHint, bindingMessage, scope }` and reads `data.authReqId`, but
  `routes/ciba.js` reads `login_hint` / `binding_message` and returns
  `auth_req_id`. `bindingMessage` is dropped; `authReqId` is undefined → polling
  never starts. `CIBAPanel` "Try It" uses snake_case and works.
- **Fix:** make `routes/ciba.js` tolerant (accept `binding_message` ||
  `bindingMessage`; return both `auth_req_id` and `authReqId`) AND align
  `UserDashboard.handleCibaStepUp` to the canonical snake_case contract.
- Add a regression test asserting the bridge round-trips `binding_message` and
  surfaces an `auth_req_id`.
- Update `ciba` SKILL.md "known bug" note → "fixed 2026-06-16."

## WS2 — New "CIBA Step-Up" token-chain tab

- Add a 4th tab to `ArchitectureTabsPanel.jsx` → new `CibaStepUpFlowPanel.jsx`.
- Visualizes: `428 (step_up_method: ciba)` → `POST /api/auth/ciba/initiate` →
  poll → token. Pulls **live** events from `TokenChainContext` when a session
  step-up occurred; static teaching view otherwise. Includes the
  approval-channel table.
- Precondition: confirm `tokenChainService.js` emits CIBA initiate/poll/token
  events; add event types if missing.

## WS3 — Education + docs + diagrams

- Diagram: new `ciba-stepup-sequence.mmd` (sibling to `hitl-sequence.mmd`) +
  `build-diagrams.sh` entry + `routes/diagrams.js` allowlist + regenerated
  PNG/SVG.
- Learning page: extend CIBA content in `components/education/educationContent.js`
  (+ route + `educationalPages.js` prefix if standalone) and link from
  `docs/education-panels.md`.
- Docs: add a CIBA step-up truth to `ARCHITECTURE-TRUTHS.md` (the 428 bridge is
  frontend-driven); `REGRESSION_PLAN.md` bug-log entry for WS1.

## WS4 — Reports surface

- Include the CIBA step-up leg in `/api/reports/history` run data; render a
  step-up indicator in `RunReportPage.js` (after confirming the report event
  shape).

## Cross-cutting constraints

- All work in worktrees; explicit `git add` (never `git add -A`); verify branch
  before each commit.
- UI build gate: `cd demo_api_ui && npm run build` must be 0 errors.
- Regression-guard discipline; no emojis in code.
- Mock authz parity is not touched by this work.

## Success criteria

- `feature-touchpoints` skill exists, is indexed in `AGENTS.md`, and its table
  rows resolve to real files.
- Live transfer→CIBA step-up completes end-to-end and emits token-chain events.
- New token-chain tab renders the CIBA step-up sequence (live + static).
- CIBA step-up appears in a diagram, a learning page, the reports view, and
  `ARCHITECTURE-TRUTHS.md`.
- UI build green; regression tests for WS1 pass.
