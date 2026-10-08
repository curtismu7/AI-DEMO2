# Use-case diagrams: standard, shared page, and three pilots

Date: 2026-10-08 · Status: draft for review
Visual contract: `mockups/use-case-launcher/showtime-ribbon.html` (approved rev, includes console layout, wire details, running trace)

## Goal

Every use case in the demo script gets a React Flow diagram an SE can open mid-pitch and walk through with play/pause/reset — all built from one shared page and one config file per use case, so they are consistent by construction.

## Decisions (settled with the user)

- **Standard + 3 pilots first.** Build the standard, the shared page, and diagrams for UC1 (delegated access), UC7 (MFA step-up), UC6 (authz DENY) — happy path, step-up, deny. The remaining ~15 primary UCs are a follow-up batch once SEs validate the format.
- **Both routes.** Dynamic deep link `/use-case-diagrams/:ucId` **and** a gallery page `/use-case-diagrams` listing all configs, cross-linked from `/diagrams`.
- **Scripted walk per UC** — story beats the SE reads aloud, written in the diagram config.
- **Launcher: Concept A with both layouts.** Filmstrip (script order, by act) and Console (grouped by initiating actor + live filter) are two views over the same config list, toggled in-page. Same stage in both.
- **Three view modes:** Flow (arrows + labels), Details (**default**; edge details + click-to-inspect), Focus (selected node + its neighbours, details drawn on the diagram).
- **Header shows:** title, description, business value, demo step number (from `demoStepNumbers.js`), result verdict, UC id, hop/actor counts.
- **Details panel below the diagram** shows: UC context block (the five header fields, always), node details on pick, per-hop **wire-level rows** (`API` / `TOKEN` / `A2A` / `POLICY`), and during Simulate a **running trace** (one row per completed hop, current expanded, auto-scroll).
- **Activity = dotted line**: round dots travelling along the edge (matches `useDiagramStepper`'s animated edge; the mock's `.dashflow` is the visual contract).
- **Open state:** demo step 1 selected, Details view, hop 1 active-and-paused — diagram and details visible with no clicks.
- **Conveniences:** keyboard (←/→ step, Space play/pause), `#UCid` deep links, walked ✓ ticks, "Next stop" chip after a completed walk.
- **Light/dark aware.** All colors from tokens; a `--brand-text`-style token for band-as-text (navy in light, light blue in dark). No dark-on-dark.
- **Live mode (second phase of the page, specced now):** scripted by default; a Scripted/Live toggle. In Live, the page subscribes to `/api/app-events/stream` via the existing `useAppEventsSSE` hook, filters by use-case id (already stamped on token events), and lights hops as the real run emits the events each walk step declares. If no events arrive, the page says "waiting for live events" — never pretends.

## The standard (config contract)

One file per UC: `demo_api_ui/src/config/useCaseDiagrams/<UCID>.js`, default-exporting:

```js
export default {
  id: "UC1",
  result: { label: "PERMIT", tone: "ok" },          // ok | warn | err | info
  GROUPS: { user: {…}, agent: {…}, gateway: {…}, ping: {…}, resource: {…} }, // keys from shared palette.js
  NODES: [ { id, group, label, sub?: string[], x, y, detail } ],   // StaticFlowDiagram node shape + one detail sentence
  EDGES: [ [srcId, tgtId, label, { detail? , dashed?, vertical? }] ],
  walk: [ {                                            // story beats, in order — one per hop
    title, label,                                      // reel card title + the sentence the SE reads
    nodes: [nodeId, …], edges: [edgeIndex, …],         // what lights up (StaticFlowDiagram walk shape)
    tech: [ { t: "API"|"TOKEN"|"A2A"|"POLICY", c: "wire line" }, … ],
    live: ["token_exchange", …],                       // app-event names that advance this step in Live mode
  } ],
};
```

Not in the config (imported, never duplicated):

- `title`, description (`what`), business value (`businessValue`) — from the existing `config/demoStepGuides.js`.
- Demo step number — from `config/demoStepNumbers.js` (`demoStepNumber(id)`).
- Palette colors/labels — from one shared `config/useCaseDiagrams/palette.js`, keyed by participant role (user, agent, gateway, PingOne, resource server). Every diagram reads it; no per-diagram colors.

Layout rules (enforced by the standards doc + drift test): participants left→right in call order, one row; hand-placed `x/y` (same as every existing diagram); one walk step per hop; every edge label ≤ ~40 chars with the detail sentence carrying the nuance.

## Shared page

`demo_api_ui/src/components/UseCaseDiagramPage.jsx` (route component) + `UseCaseDiagramsGalleryPage.jsx`. The page:

1. Reads `:ucId`, imports the matching config (registry module `config/useCaseDiagrams/index.js`), falls back to a "no diagram yet" state listing which UCs exist.
2. Renders the header (five fields + chips), the view-mode toggle, and `StaticFlowDiagram` with `walk` + a page-owned `useDiagramStepper` — play/pause/resume/prev/next/stop/step-timing/reel come from the existing shared controls, zero new stepper code.
3. Renders the details panel: UC context (from `demoStepGuides` + config `result`), node details, wire rows, running trace during Simulate.
4. Launcher layouts: filmstrip (default) and console, one `layout` state, both reading the same registry. Toggle rides the URL (`?layout=console`).
5. Conveniences: keyboard, `#UCid` hash sync, walked ticks (session state), next-chip.

Wire rows and the running trace are the only genuinely new UI; they extend the existing `DiagramReel` details row pattern (small additions, not a second reel).

## Live mode

Config walk steps declare `live: [eventName, …]`. With Live on, the page maps arriving SSE events (filtered by the run's use-case id) to walk indexes and advances the stepper as they land; manual controls pause auto-advance as today. Scripted remains the default and the offline-safe path. Live wiring is a separate task behind the same page — no diagram config changes required to ship scripted first.

## Drift test

`config/useCaseDiagrams/__tests__/drift.test.js` (pattern: existing `diagramsIndex` drift test): every id in `DEMO_PRIMARY_USE_CASE_IDS` must resolve to a config module whose `walk` covers every `EDGES` index and whose `tech` rows exist per step; every config id must be a real UC. Adding a use case without a diagram fails CI — the standard stays enforced.

## Standards doc

`docs/use-case-diagram-standards.md`: palette, layout rules, edge conventions, walk-beat authoring (what makes a good beat), wire-row authoring (tag vocabulary, one line per artifact), Live event naming. One page, linked from the gallery page.

## Testing

- Drift test (above) — node `--test`, in the repo's hygiene lane.
- Page tests following `ReactFlowPocPage.test.jsx`: renders header fields for a config, defaults to step 1 + Details + hop 1 paused, node click opens details, keyboard stepping, unknown `:ucId` fallback.
- Verify both routes + `/diagrams` cross-link manually via the run skill.

## Out of scope

The remaining ~15 UC diagrams (follow-up batch); editable diagrams; auto-layout; live-event mapping per UC (phase 2 of Live); print handout.
