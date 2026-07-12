# Use Case Launcher — Demo section

**Date:** 2026-07-12
**Status:** Approved (brainstorming)
**Scope:** `demo_api_ui/src/pages/UseCaseLauncherPage.js` (+ its `.css`), `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`

**Supersedes/extends:** builds on `docs/superpowers/specs/2026-07-12-use-case-search-happy-path-design.md`. That spec's Task 1 (Happy Path grouping, PERMIT-outcome) is already implemented and committed (`9217e0318`). Task 2 of that spec (search box) has not started implementation — its scope is extended by this document (see "Interaction with search" below); the implementation plan will be revised accordingly rather than run as originally written.

## Problem

The just-shipped Happy Path section groups use cases by outcome (`expectedOutcome === 'PERMIT'`), which is useful for browsing but has no narrative order — it can't serve as "the thing you click through when giving a live demo." The user wants a second, distinct section: a fixed-order, curated sequence of use cases that tells a complete presenter story in one pass.

Note: the codebase already has an unrelated "Progressive Trust Demo" track (`track: 'demo'`, `ProgressiveTrustDemoStrip` component, 5 Acts) serving a similar narrative purpose for a different story (public access → auth → HITL → step-up → CIBA → deny, framed around the Ping MyHotels blog pattern). This spec's new section is intentionally independent of that one — it is not renamed, extended, reused, or otherwise modified.

## Goals

- Add a new "Demo" section, rendered first (above Happy Path, above all track sections).
- Cards render in a fixed script order, not catalog/alphabetical order.
- Each card shows a step number so the order reads as a script.
- No deduplication against Happy Path or track sections — a use case may legitimately appear in Demo and elsewhere on the page.
- Demo participates in the search box (Task 2 of the prior spec, not yet implemented) the same way Happy Path and track sections do.

## Non-goals

- Modifying the existing Progressive Trust Demo track/strip in any way.
- Deduplicating Demo's membership against any other section.
- A generalized "curated section" mechanism for arbitrary future scripts — this is one fixed list for one section, YAGNI beyond that.

## Design

### 1. Ordered membership

A new module-level constant, alongside `PROGRESSIVE_TRUST_STRIP_IDS`:

```js
const DEMO_USE_CASE_IDS = ['UC1', 'UC2', 'UC2.5', 'UC8', 'UC7', 'UC6', 'UC10', 'UC5', 'UC13', 'UC11', 'UC12', 'UC20'];
```

| Step | id | Use case | Why |
|---|---|---|---|
| 1 | UC1 | Delegated access with proof | Baseline success + full token chain |
| 2 | UC2 | A2A delegation | Nested-act baseline (flag-gated: `ff_a2a_delegation`) |
| 3 | UC2.5 | A2A Orchestrator (interactive) | Visible specialist routing |
| 4 | UC8 | HITL consent ($300) | Human-in-the-loop approval |
| 5 | UC7 | Step-up required ($600) | MFA escalation |
| 6 | UC6 | Authz denied ($2500) | Hard policy ceiling |
| 7 | UC10 | Cross-owner-account attack | Resource-ownership defense |
| 8 | UC5 | Insufficient-scope attack | Scope enforcement |
| 9 | UC13 | Confused-deputy actor injection | Actor-identity defense |
| 10 | UC11 | Bad client → gateway (wrong aud) | Token validation at the gateway |
| 11 | UC12 | Token theft/replay attack | Audience/DPoP binding (flag-gated: `ff_dpop`) |
| 12 | UC20 | Audit trail | Closer — proves it was all logged |

At render time:

```js
const demoAll = DEMO_USE_CASE_IDS
  .map((id) => useCases.find((uc) => uc.id === id))
  .filter(Boolean);
```

`.filter(Boolean)` is defensive only — every id is expected to resolve for every vertical, since `resolveUseCase` only overrides per-vertical trigger text/copy, never removes catalog entries.

Flag-gated steps (UC2, UC12) render exactly like any other flag-gated `UseCaseCard` today — the existing `FlagGate` component already handles the gate UI generically; no new logic is needed for that.

### 2. Rendering — reuse `UseCaseCard`, add a step badge

Demo renders as its own `<section className="uc-track uc-track--demo-script">`, structurally identical to the Happy Path section (`uc-track__heading` + `uc-track__grid` of `UseCaseCard`s), but each card additionally receives its 1-based step index. `UseCaseCard` gains one new optional prop, `stepNumber`, rendered as a small badge in the card header (next to the existing `uc.id` chip) when present; omitted entirely for Happy Path/track cards (no visual change to those).

Heading label: `"Demo — a scripted walkthrough"`.

### 3. No dedup

Demo's membership is computed independently — it does not read or write `happyPathIds` (from the prior spec) and does not remove its members from Happy Path or their track sections. A use case may render up to three times on the page (Demo, Happy Path, its track) if it qualifies for all three. This is a deliberate simplification: Demo is a fixed script, not a filtered view, so coupling it to the dedup mechanism would make both harder to reason about for a small cosmetic gain (one fewer repeated card).

### 4. Section order

Page order becomes: Demo → Happy Path → track sections (`TRACK_ORDER`, unchanged). This revises the prior spec's "Happy Path renders first" statement — Demo now takes that position.

### 5. Interaction with search (extends prior spec's Task 2)

The prior spec's not-yet-implemented search box must also filter Demo, using the same `matchesQuery(uc, query)` predicate, applied to `demoAll` to produce `demoVisible`, preserving `DEMO_USE_CASE_IDS` order. Demo's section-empty guard follows the same "hide when zero visible" rule as every other section. `hasAnyResults` (the page-wide empty-state check) must additionally consider `demoVisible.length > 0`.

The Progressive Trust Demo strip's existing "hide while searching" behavior (from the prior spec) is unaffected and unrelated to this Demo section.

### 6. Test coverage additions

- Demo section renders first, above Happy Path.
- The 12 cards render in `DEMO_USE_CASE_IDS` order (not catalog order) — assert by reading rendered step badges/ids in DOM order.
- Step badges show the correct 1-based number per card.
- A use case present in both Demo and Happy Path (e.g. UC1) renders twice on the page (once per section) — assert both occurrences exist, each inside its respective section.
- Flag-gated Demo steps (UC2, UC12) show the existing gate UI.
- Search filters Demo independently of other sections; an empty-after-filter Demo section disappears; `hasAnyResults` accounts for Demo matches.

## Open questions

None outstanding — resolved during brainstorming:
- Relationship to Happy Path: separate section, no dedup, both stay.
- Relationship to existing Progressive Trust Demo strip: fully independent, untouched.
- Exact ordered content: 12 ids as listed above.
- Visual treatment: step-number badge on `UseCaseCard`.
- Section order: Demo, then Happy Path, then tracks.
- Search: Demo is filtered the same as every other section.
