# OAuth Visualizer Integration Design

## Goal

Integrate the supplied `oauth-visualizer-main.zip` project into the existing
React dashboard as a first-class visual surface. The visualizer must be
available through the shared Quick Config surface selector as `None`,
`Embedded`, `Pop-out`, or `Both`, and must support both light and dark themes.

## Context and constraints

The supplied project is a standalone Vite 6 application using native ES
modules, Mermaid sequence diagrams, and browser-side OAuth execution. It has
no backend and stores its client configuration in browser local storage. The
dashboard is React 19 + Vite 8 and already owns the shared surface taxonomy,
theme tokens, draggable modal behavior, and protected browser-token custody.

The integration will not iframe or independently host the supplied app. An
iframe would isolate theme state, resizing, surface controls, and dashboard
state. The visualizer's flow definitions and browser-safe presentation logic
will be adapted into React components while preserving the dashboard's BFF as
the only browser-token custodian for existing dashboard flows.

## Surface behavior

The visualizer receives the same four-way surface value used by Token Topology,
RFC Info, Agent Flow Diagram, Simple Step, and Sequence View:

- `none`: no visualizer is rendered.
- `embedded`: render the visualizer in the dashboard's available inline panel.
- `popout`: render it only in an existing `DraggableModal` pop-out.
- `both`: render the inline panel and a pop-out launcher/modal.

The Quick Config menu will expose the new visualizer alongside the existing
surface selectors. Existing saved boolean settings will continue to migrate
without changing their meaning. A saved four-way value is authoritative for
the visualizer.

## Components and data flow

1. `OAuthVisualizerPanel` owns selected flow, visualizer configuration, active
   step, run state, and local detail selection.
2. Adapted flow modules provide the supplied grant-type and token-exchange
   definitions. They remain data/runner modules and do not import React or
   dashboard state directly.
3. A Mermaid adapter renders the selected flow and maps active step IDs to
   highlighted arrows using the supplied `stepMsgs` contract.
4. A request/response detail pane renders the current step's request, response,
   decoded data, notes, or error using dashboard theme tokens and font-size
   controls.
5. Pop-out mode uses `DraggableModal`; it must not introduce a raw dialog or a
   second overlay implementation.
6. The visualizer's configuration is isolated under a namespaced local-storage
   key so it cannot collide with dashboard configuration. Existing dashboard
   token custody and API client rules remain unchanged.

The first integration slice will preserve the supplied visualizer's browser
execution model and supported flows. It will not add a new server endpoint,
proxy, OAuth credential storage path, or automatic coupling to dashboard run
events unless an existing dashboard adapter can provide that data without
moving custody into the visualizer.

## Theme and controls

The panel will consume the dashboard's theme context/tokens and provide a
light/dark control with the existing `☀️` / `🌙` allowlisted glyphs. Font-size
controls will use the existing dashboard scale and will never render below the
10px floor. Colors, backgrounds, and font sizes will remain stylesheet/token
driven rather than themeable inline styles. Embedded and pop-out instances use
the same theme and size state.

## Error handling

- Discovery and network failures appear in the visualizer's existing detail
  model with request/response context when available.
- A failed step stops the run and marks the step as failed; it does not expose
  secrets in logs or copy them into dashboard state.
- If Mermaid cannot render a malformed diagram, the panel shows a solid
  high-contrast fallback message and keeps the step list usable.
- Pop-out close/reopen preserves the selected flow and configuration but does
  not duplicate an active run.

## Testing and verification

- Unit-test surface values and legacy-setting migration.
- Unit-test flow selection, step status transitions, arrow highlighting, and
  detail rendering for request/response/error states.
- Unit-test embedded, pop-out, both, and none rendering, including modal
  close/reopen behavior.
- Unit-test light/dark and font-size controls in both surfaces.
- Run the UI Vitest suite and `npm run build` in `demo_api_ui`.
- Run the required theme contrast auditor in both themes on the touched panel.
- Run `graphify update .` and inspect the focused diff before commit.

## Out of scope

- Rebuilding the supplied visualizer as a separate service.
- Adding OAuth server endpoints or changing existing BFF token custody.
- Replacing the dashboard's existing Token Topology, Sequence View, or Agent
  Flow Diagram implementations.
- Adding new grant types beyond those present in the supplied project.
