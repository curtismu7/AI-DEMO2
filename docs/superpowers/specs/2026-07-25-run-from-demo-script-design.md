# Run-from-Script — Design

**Date:** 2026-07-25
**Deliverable:** Add a ▶ Run button to each runnable beat of the 15-min security demo
teleprompter (`DemoScriptLauncher`), so the presenter runs the use case directly from the
script — including from the popped-out second-screen window (Option 2 / "both").
**Depends on:** the shipped teleprompter (PR #864/#866/#867/#869) and the `/use-cases/live`
"15-Min Security Demo" group (PR #868).

## Goal

The presenter reads the talk-track in the teleprompter and can trigger the matching use case
with one click, instead of switching focus to the workbench tiles. Works when the script is
in-page on `/use-cases/live` and when it is popped out to a second monitor (driving the agent
on the main window).

## Design (Option 2)

### 1. Mark the runnable beats

Attach a `ucId` to the 7 runnable beats in `demo_api_ui/src/components/demoScript.js`:
UC1, UC24, UC6, UC8, UC31, UC12, UC5. Non-UC beats (the mode-flip beat 1b, intro) have no
`ucId` and no button. The **kill-switch closer** is not a use case, so instead of `ucId` it gets
a `navPath: '/ai-control-plane'` (see §5).

### 2. Run trigger — one shared BroadcastChannel (as built)

The Run button calls `runUseCase(ucId)` which posts `{ type: 'run', ucId }` on a module-scope
`BroadcastChannel('demo-script')`. A BroadcastChannel delivers each message to every other
channel object of the same name — **including one in the same window** — but never to the object
that posted it. So the launcher's channel reaches the workbench's channel **exactly once**,
whether the click came from the in-page modal or the popped-out 2nd-screen window. No window
event is used — a window event *plus* the channel would double-run in-page. Requires
BroadcastChannel (all modern browsers); if absent, Run is a no-op.

### 3. Workbench listens and reuses its own run path

`demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` opens its own `BroadcastChannel('demo-script')`
in a `useEffect` and, on a `{ type: 'run', ucId }` message, looks up the use case
(`useCases.find(uc => uc.id === ucId)`) and calls the **existing** `handleRunSelected(uc)` — the
exact path the tiles use (chips dispatch to the agent, runnable attack sims POST
`/api/demo/attack-sim/run`). It also sets `selectedId` so the tile highlights. No new run logic;
the Run button is just a new entry point into `handleRunSelected`.

### 4. Run button UI

In `DemoScriptLauncher`, for a beat with `ucId`, render a small ▶ Run button in the beat card
(top-right, mirroring the workbench `luw-card__run` styling but self-contained so it reads in the
pop-out). Plain text label "▶ Run" (▶ is a text glyph, not an emoji; if flagged, use "Run").

### 5. Kill-switch closer — navigate button (in v1, non-destructive)

The kill-switch closer beat gets a **"Go to AI Control Plane →"** button (from its `navPath`),
not a Run. It navigates the main window to `/ai-control-plane`; it does **not** auto-execute the
revocation — the presenter still performs the deliberate STOP → instance scope → Confirm on that
page (per the script), because a force-logout / agent-revoke must not fire from a one-click script
button.

`DemoScriptLauncher` uses `useNavigate` (mounted inside the Router). The button calls
`navigate(navPath)` directly. `useNavigate` returns a function bound to the main-window router at
render time, so it navigates the **main** window even when the click fires in the popped-out
window — no channel needed for navigation (only Run uses the channel).

## Scope boundaries / known v1 limitations

- **Run requires the workbench to be mounted** to receive it: in-page on `/use-cases/live`, or
  popped-out with the main window on `/use-cases/live`. If neither window is on the workbench,
  Run is a no-op (no crash). Auto-navigating a stray window to `/use-cases/live` and draining a
  pending run on mount is a **v1.1** nicety, out of scope here. (The closer nav button has no such
  dependency — it just navigates.)
- **Kill-switch closer navigates, does not revoke.** The destructive STOP stays a deliberate
  manual action on `/ai-control-plane`.
- **No run-state feedback in the script.** The result renders in the workbench / agent (which the
  presenter watches on screen 1). The script stays a trigger, not a status surface.

## Components / files

| File | Change |
|---|---|
| `demo_api_ui/src/components/demoScript.js` | add `ucId` to the 7 runnable beats; add `navPath: '/ai-control-plane'` to the closer |
| `demo_api_ui/src/components/DemoScriptLauncher.jsx` | module-scope `BroadcastChannel('demo-script')`; `runUseCase(ucId)` posts `{type:'run'}`; Run button per `ucId` beat; `useNavigate` + "Go to AI Control Plane →" button (`goTo`) for the `navPath` closer |
| `demo_api_ui/src/components/DemoScriptLauncher.css` | Run + nav button styles (self-contained) |
| `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` | `useEffect` listener (window + channel `type:'run'`) → `handleRunSelected(uc)` |

All additive. No REGRESSION_PLAN §1 files (App.js is not touched). Emoji allowlist respected.

## Success criteria

- In-page on `/use-cases/live`: clicking ▶ Run on a script beat runs that use case (chip
  dispatches / sim DENYs) identically to clicking its workbench tile.
- Popped out to a second window with the main window on `/use-cases/live`: ▶ Run on screen 2 runs
  the use case on screen 1. Exactly one run per click (no double-run).
- Non-UC beats show no Run button.
- The kill-switch closer shows a "Go to AI Control Plane →" button that navigates the main window
  to `/ai-control-plane` (in-page and from the pop-out) and does NOT revoke anything.
- `cd demo_api_ui && npm run build` exits 0.
- No change to existing tile behavior or the teleprompter's read/pop-out/font/toggle features.

## Verification (live, Playwright)

Signed in as demoUser on `local.ping-devops.com:4000`, on `/use-cases/live`, open the script from
the sidebar, click ▶ Run on UC1 → agent runs "show my balance"; click ▶ Run on UC12 → replay sim
DENY. Then pop out and repeat from the second window.
