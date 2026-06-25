# HITL Sequence Diagram — Step-by-Step Panel

**Date:** 2026-05-23  
**Status:** Approved  
**Scope:** Add interactive step-by-step explanations to `/architecture/hitl`, matching the UX of `/sequence-diagram`.

---

## Goal

The `/sequence-diagram` page walks users through the i4ai reference architecture one arrow at a time, with a left panel explaining each step (why, HTTP details, rules evaluated, failure modes). The `/architecture/hitl` page shows the HITL consent flow as a static Mermaid render with no per-step explanations. This spec closes that gap.

---

## Decisions

| Question | Decision |
|---|---|
| Step granularity | Every arrow = one step (~48 total), matching `/sequence-diagram` |
| Path navigation | Scenario dropdown: All Paths / Path 1 / Path 2 / Path 3 |
| Diagram rendering | Custom React SVG renderer (replaces Mermaid live render) |
| Panel sections | `why`, `request/response`, `rulesEvaluated`, `onError` — full parity |

---

## File Changes

### New: `demo_api_ui/src/components/HitlSequenceDiagram.js`

Self-contained component. Contains:

- **`HITL_PARTICIPANTS`** — 4 entries:

  | Alias | Display label |
  |---|---|
  | `B` | Browser |
  | `BFF` | BFF (demo_api_server) |
  | `TC` | transactionConsentChallenge.js |
  | `P1` | PingOne MFA |

- **`HITL_STEPS`** — array of ~48 step objects. Each step:

  ```js
  {
    step: 7,                      // sequential 1-N across all paths
    path: "onetime",              // "shared" | "homegrown" | "onetime" | "device"
    from: "B",                    // participant alias
    to: "BFF",                    // participant alias
    label: "POST /consent-challenge/:id/confirm",
    type: "request",              // "request" | "response" | "note"
    description: "Confirm challenge",  // 2–5 words, shown in step list header
    why: "…",                     // plain-English rationale
    request: { method, url, headers, body },   // optional
    response: { status, headers, body },       // optional
    rulesEvaluated: [{ rule, result, detail }], // optional
    onError: ["…"],               // optional array of failure strings
  }
  ```

  For `type: "note"`, `from`/`to` are replaced by `participants: ["B", "P1"]` (span range), and only `why` and `onError` apply — no `request`/`response`.

- **`HITL_SCENARIOS`** — object with 4 keys:

  ```js
  {
    "all":        ALL_HITL_STEPS,
    "homegrown":  steps where path === "shared" || path === "homegrown",
    "onetime":    steps where path === "shared" || path === "onetime",
    "device":     steps where path === "shared" || path === "device",
  }
  ```

- **`StepInfoPanel`** — copied verbatim from `SequenceDiagramPage.js`. Not extracted into a shared module (out of scope). Renders `description`, `why`, collapsible `request`/`response` cards, `rulesEvaluated` badges, and `onError` list.

- **SVG renderer** — draws the diagram using React SVG elements:
  - 4 vertical dashed lifelines with participant label boxes at top
  - Arrows: solid stroke for `request`, dashed stroke for `response`
  - `note` steps render as a labelled box spanning the relevant participant columns
  - Coloured background rects for each path section (matching existing legend chip colours): green `#bbf7d0` / Path 1, blue `#bfdbfe` / Path 2, orange `#fed7aa` / Path 3
  - Active step: arrow and step-number badge highlighted in `#1d4ed8`; all other arrows dimmed to 25% opacity
  - Zoom: `viewBox` scale controlled by a zoom state (50 / 75 / 100 / 150 / 200%)

- **Controls bar** (above the split layout):
  - Scenario `<select>`: "All Paths", "Path 1 — Homegrown OTP", "Path 2 — PingOne One-Time", "Path 3 — Device Picker"
  - Simulate / Pause / Prev / Next buttons — same auto-advance behaviour as `/sequence-diagram`
  - Zoom − / + buttons
  - Step counter label: "Step N of M · {path name}"

- **Layout**: resizable split — left step panel (default 300px, draggable divider) + right SVG area filling remaining width. Same pattern as `/sequence-diagram`.

### Modified: `demo_api_ui/src/components/HitlSequencePage.jsx`

- Remove: `import mermaid`, `MERMAID_SOURCE` string constant, the `useEffect` render block, `containerRef`
- Remove: `renderError` state (no longer needed)
- Keep: page header (title, subtitle, config flag reference), path legend chips (`HITL_PATHS` array + chip row)
- Add: `import HitlSequenceDiagram from './HitlSequenceDiagram'`
- Render `<HitlSequenceDiagram />` in place of the old `<div ref={containerRef} />`

No other files change. Route stays at `/architecture/hitl`. `App.js` unchanged.

---

## Step data scope

All ~48 steps must have `why` and `onError` filled in. `request`/`response` applies to every arrow step (not notes). `rulesEvaluated` applies to BFF-internal validation steps (challenge lookup, snapshot match, OTP verify, one-time consume). Steps that are pure PingOne API calls do not need `rulesEvaluated`.

**Step count breakdown:**

| Section | Approx. steps |
|---|---|
| Shared preamble (428 gate → challenge create) | 6 |
| Path 1 — Homegrown OTP | 9 |
| Path 2 — PingOne One-Time OTP | 14 |
| Path 3 — Device Picker | 18 |
| Closing note (OTP bypass) | 1 |
| **Total** | **~48** |

Exact step numbering is determined during implementation by walking `MERMAID_SOURCE` in `HitlSequencePage.jsx` top-to-bottom.

---

## Visual design

Matches `/sequence-diagram` exactly:

- Left panel background: `#fff`, right area: `#f8fafc`
- Active arrow: `#1d4ed8` (blue), stroke-width 3
- Dimmed arrows: `#cbd5e1`, opacity 0.25
- Step badge: filled circle, `#1d4ed8`, white number
- Path rect backgrounds: same colours as the existing legend chips in `HitlSequencePage.jsx`
- `StepInfoPanel` typography and card styles: unchanged from `SequenceDiagramPage.js`

---

## Out of scope

- Extracting `StepInfoPanel` or other shared SVG primitives into a common module
- Modifying `/sequence-diagram`
- Simulation speed controls (auto-advance uses same fixed interval as `/sequence-diagram`)
- Mobile/responsive layout
- Replacing `hitl-sequence.mmd` (it remains at the repo root as documentation; the page no longer renders it)

---

## Verification

- `cd demo_api_ui && npm run build` exits 0
- `/architecture/hitl` loads without console errors
- Scenario dropdown filters steps correctly for each path (shared preamble always included)
- Prev/Next walks all steps; counter updates correctly
- Active arrow highlighted; all others dimmed
- All four panel sections render for at least one step per path
- `mermaid` import removed from `HitlSequencePage.jsx` (no runtime Mermaid dependency on this page)
