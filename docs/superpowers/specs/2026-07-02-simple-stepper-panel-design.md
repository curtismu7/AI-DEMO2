# Simple Stepper Panel — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm with user, HTML mock reviewed in browser)

## Problem

The inline token chain view (`InlineTokenChainView`) renders the delegation chain as a
horizontally wrapping row of pills with arrows. With 16 steps it wraps across many lines
and is hard to read (user screenshot, 2026-07-02). The user wants:

1. A **table** — each step on its own row.
2. A **pop-out** — toggled open/closed from the agent UI, moveable, resizable, and
   draggable off-screen (e.g. to a second monitor).
3. Named **"Simple Stepper"** — NOT "Token Chain" — to avoid confusion with the full
   Token Chain panel (`FloatingTokenChainPanel` / education `TokenChainPanel`), which is
   unchanged by this work.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Keep the inline pill flow? | **No — replace it.** Only a compact header bar remains inline; the button pops out the floating table panel. |
| Table columns | **# / Step / Product / Status.** Status: green ✓ ok, red ✕ + error code for the halted step, greyed "— did not run" for post-halt steps (row greyed + italic). |
| Naming | **Simple Stepper** everywhere (component names, CSS prefix, titles, storage keys). |
| Surfaces | Banking agent **all display modes** (float / embedded / bottom-dock — one shared mount covers all), **all backend agent frameworks** (LangChain, helix, etc. — same chat UI), **OAuth Academy**, and the **clinical agent TalkPane** (new mount). **Not** the Copilot Studio agent (isolated; has no token chain events). |

## Architecture

### Approach

Reuse the existing in-house floating-panel pattern — `useDraggablePanel` hook
(pointer-capture drag with no viewport clamping → can go off-screen; 8-direction resize;
localStorage persistence) + `createPortal` into `document.body` — exactly as
`FloatingTokenChainPanel.js` does. No new dependencies.

Rejected alternatives:
- Extending `FloatingTokenChainPanel` — it wraps the education `TokenChainPanel` with a
  different data source; overloading it tangles two features.
- `react-rnd` / `react-draggable` — project deliberately has no drag/resize dependency.

### Components

**New: `demo_api_ui/src/components/SimpleStepperPanel.js` + `SimpleStepperPanel.css`**
(CSS prefix `ssp-`)

- Floating panel via `createPortal(…, document.body)`, positioned by `useDraggablePanel`
  with `storageKey: 'ssp-pos'`, default ~560×480, min 360×240, default position right of
  center. z-index in the 998x band (matches `FloatingTokenChainPanel`).
- Header (drag handle): title "Simple Stepper", step-count badge, minimize ▾/▸ button
  (collapses body, height auto), close ✕ button. 8 resize handles from the shared
  `draggablePanel.css` classes, hidden while minimized.
- Body: scrollable table, sticky header row. Columns **# / Step / Product / Status**.
  - Data: `events` from `TokenChainContext` (`useTokenChainOptional()`), live — same
    source the pills use today.
  - Status logic reuses `resolveStatusVisual` and `isHaltedAt` from `TokenChainDisplay`
    verbatim: halted row gets red background + "✕ <errorCode|halted>"; rows after the
    halt index are greyed with "— did not run"; ok rows show green ✓.
  - Product column reuses `PingProductChip` + `productForEvent` (A8 attribution).
- Props: `isOpen`, `onClose`. Renders `null` when closed or outside the provider.
- Empty state: "No token events yet." row spanning the table.

**Changed: `InlineTokenChainView.js` → renamed `SimpleStepperBar.js`** (+ CSS renamed to
`SimpleStepperBar.css`, prefix `ssb-`; old `itcv-` files deleted)

- The wrapping pill flow (`InlineStep`, `.itcv-flow`, arrows, ghost/halt pill styling) is
  **removed**.
- What remains is the compact bar: title "Simple Stepper", count badge, one toggle button
  ("Show" / "Hide") that opens/closes `SimpleStepperPanel`.
- Open state persists in localStorage under `ba_simple_stepper_open` (replaces
  `ba_inline_tc_show`; no migration — default closed on first visit).
- Outside the provider → render `null` (unchanged behavior).

**Changed mounts:**

| File | Change |
|---|---|
| `AIAgent.js` (~line 8279, `.ba-right-col`) | `InlineTokenChainView` → `SimpleStepperBar`. Single mount already covers float, embedded, and bottom-dock modes (single portalled `<AIAgent>`) and every backend framework. |
| `OAuthAcademyPage.jsx` | Same swap. |
| `agent-clinical/TalkPane.jsx` | **New**: mount `SimpleStepperBar` above the chat messages (TalkPane already subscribes to `TokenChainContext`). Styling must sit cleanly in clinical-split styling — reuse the bar as-is. |

### Data flow

Unchanged. `TokenChainContext` → `events` array → table rows. The panel re-renders live
as events stream in. No new fetches, no BFF changes.

### Error handling

- Outside `TokenChainContext` provider: bar and panel render `null`.
- `localStorage` reads/writes stay try/catch-wrapped (existing pattern).
- Unknown status strings already bucket to "failed" via `resolveStatusVisual`.

## Mock

Interactive HTML mock (approved by user, includes working drag/resize/minimize/close):
session scratchpad `token-chain-table-mock.html`. Visual language: existing light theme
(`#f8fafc` / `#f1f5f9` surfaces, `#2563eb` accent, red `#fef2f2` halted row).

## Testing

- Update `__tests__/InlineTokenChainView.test.jsx` → `SimpleStepperBar.test.jsx`:
  - renders title "Simple Stepper" + count
  - toggle opens the panel (portal content appears), second click / ✕ closes it
  - open state persisted to `ba_simple_stepper_open`
  - renders null outside provider
- New `SimpleStepperPanel.test.jsx`:
  - one row per event, in order, numbered
  - halted event row shows ✕ + error code; subsequent rows show "— did not run"
  - product chip renders when `productForEvent` matches
  - empty state row when no events
- Existing `FloatingTokenChainPanel` and education Token Chain tests must stay green
  (untouched files).

## Success criteria

1. Wrapping pill flow no longer renders anywhere; compact "Simple Stepper" bar in its place.
2. Toggle opens a floating table panel; each step is one table row (# / Step / Product / Status).
3. Panel drags by header (including fully off-screen), resizes from 8 handles, minimizes, closes; position/size persist across reloads.
4. Works in agent float, embedded, and bottom-dock modes, on OAuth Academy, and in the clinical TalkPane.
5. Halted chain renders red halted row + greyed did-not-run rows, matching current pill semantics.
6. All new/updated unit tests pass; no changes to the full Token Chain panel.
