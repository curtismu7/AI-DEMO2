# Diagram pages: one movie reel, one details row, one motion language

Status: 2026-10-07. Built: the reel, click-for-details row, node ring, Reset (clears and refits), shared motion. Decisions below were made with the owner. Remaining: reel for the pages that keep their own simulators (see Build order 5).

## Goal

Every diagram page plays the same way:

1. **Play / Step / Reset** drive the diagram (**done**: `DiagramStepBar`, all React Flow diagrams).
2. A **movie reel** under the diagram shows the steps as a strip of cards; the card in focus matches the arrow in focus.
3. **Click a card** (or a node) and its **details open under the reel**, in the page flow, so the diagram never gets smaller.
4. The arrow in focus always looks the same: a thick dashed accent line whose dashes run along the edge (**done**: `NOW_STYLE` in `useDiagramStepper.js`, `dstep-flow` keyframes, `.sfd-edge.step-now`).

## What exists today (reuse, do not fork)

| Piece | Where | Use |
|---|---|---|
| Step state (Simulate, Pause, Next, Prev, Reset) | `hooks/useDiagramStepper.js` | the single source of "which step" |
| Control bar | `components/DiagramStepBar.jsx` on `diagram/DiagramControls` | stays the control surface |
| Diagram renderers | `StaticFlowDiagram`, `SequenceFlowDiagram`, `FlowchartFlowDiagram`, Agent Privilege graphs, Token Chain | each already takes a step index |
| Live movie reel | `TokenChainFilmstrip`, `ReelDock` (dashboard) | visual language to match; built for live traces, not static steps |
| Step detail sheet | `StepDetailPanel` | pattern for a details row; shape is trace-specific |
| Per-page node details | `RSP_DETAILS`, `AOM_DETAILS`, `EXT_DOOR_DETAILS`, `NODE_DETAILS`, `personalAgentData.js` | text for the details row already exists per page |

The reel on the dashboard has vanished five times (see the movie-reel memory): static "it renders" checks stayed green while it sat off screen. The new reel needs a real viewport assertion from day one.

## Design

### Data: one step shape for every diagram

Each renderer already produces, per step, a caption (`edgeCaptions`). Add a small shared shape:

```js
{ id, from, to, label, detail: { title, body, bullets?, claims? } }
```

- StaticFlow pages: `from`/`to`/`label` come from `EDGES`; `detail` is assembled from the page's existing per-node details map (source node and target node) plus the edge label.
- Sequence diagrams: one step per message; `detail.body` is the message text, `from`/`to` are the lifelines.
- Flowcharts / Agent Privilege graphs / Token Chain: same, from the edge list.

A helper `buildReelSteps({ nodes, edges, details })` returns the array. Pages without details still get a reel (caption only, no details row).

### Reel: `DiagramReel`

- A horizontally scrolling strip of cards, one per step: step number, `from → to`, short label.
- The card for the current step is highlighted and scrolled into view; clicking a card sets the step (pausing playback).
- Lives directly under the diagram and above the page's other content, inside the same container as the diagram so it cannot drift off screen. No `position: fixed`.
- Visual language (card shape, active state, done/pending) follows `TokenChainFilmstrip.css` tokens.

### Details row

- Opens **below the reel** by default, full width, in normal page flow. The diagram canvas keeps its viewport-fit height; the page grows downward instead. This is the "do not make the diagram smaller" rule.
- Content: title, body, bullets, and for token steps the claims view (reuse `StepDetailPanel` pieces where the step is a real trace step).
- Clicking a **node** in the diagram opens the same row for that node's details (nodes have details even when no step is in focus).
- Closed by default, one toggle; remembers nothing across pages (per-viewer convenience only).
- Optional later: a "dock to side" toggle for very wide screens. Not in the first cut.

### Reset

Done. `Reset` clears the walkthrough to the plain diagram. Decision still open: should Reset also refit the view (zoom/pan back to fit)? Proposed yes, via `useReactFlow().fitView` in `FitOnResize`'s sibling.

### One motion language

Done for edges. Remaining: nodes. Proposed: the node at each end of the arrow in focus gets the same ring (`step-hot` today on StaticFlow; Sequence participants, flowchart nodes and graph nodes do not yet). Add one shared class and token so every renderer rings its endpoints identically.

## Build order

1. `buildReelSteps` + `DiagramReel` (no details) and wire into `StaticFlowDiagram` and `SequenceFlowDiagram` (these two cover most pages). Unit tests for ordering and click-to-step.
2. Details row + node click, fed from the existing per-page details maps. Unit tests for open/close and "canvas height unchanged when details open".
3. Wire the remaining renderers: `FlowchartFlowDiagram`, Agent Privilege graphs, Token Chain.
4. Shared node ring across renderers; Reset refits the view.
5. Pages that keep their own simulators (Overview, Agent Onboarding Flow / Subway, Sequence Diagram, Token Flow, Canvas) are out of scope until they move to React Flow; list them in the page catalog as the exceptions.

## Acceptance checks (run on the live UI, not just jsdom)

- Reel is in the viewport on a 1440x700 window for every diagram page (`toBeInViewport`, same as the dashboard reel lock). A short-laptop case is mandatory.
- Opening details does not change the diagram canvas height (assert `getBoundingClientRect().height` before and after).
- The reel card, the diagram arrow and the caption always show the same step (click a card, Next, Prev, Reset).
- Reduced motion: dashes stop moving, the highlight remains.
- Font floor: node text and reel text render at 12px or larger at the fitted zoom; the audit script used for the width/font pass is the template.

## Decisions (answered 2026-10-07)

1. **Reel vs caption:** keep both. The caption stays in the control bar (accessible live region); the reel sits under the diagram.
2. **Thin diagrams:** short details are written by hand where a page had none: Phase 266 (4 nodes added to its map), Invest participants, Agent Privilege Architecture nodes and Sign-in sequence participants. Pages with node text of their own reuse it; the rest fall back to the node's own lines.
3. **Long reels:** one horizontally scrolling strip that follows the current card. On sequence diagrams the reel sits above the canvas (the drawing is as tall as the sequence), on every other diagram it sits below.
4. **Personal Agent pages:** keep the long "Step by step" write-up, add the reel above it.

Built as: `utils/diagramReel.js` (`buildReelSteps`, `buildNodeDetail`), `components/DiagramReel.jsx`, `markNodes` and `goTo` in `hooks/useDiagramStepper.js`, the shared `dstep-hot` ring, and a `diagram:refit` event Reset sends so every canvas returns to its fitted view. `StaticFlowDiagram` takes `stepper` (page-owned walkthrough) and `details`; sequences, flowcharts, the Agent Privilege graphs and Token Chain wire the same pieces.
