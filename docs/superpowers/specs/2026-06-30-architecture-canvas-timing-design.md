---
title: Architecture Canvas — Step Timing & Animation
date: 2026-06-30
scope: Add configurable durations to flow steps + playback animation
---

## Summary

1. **Fix default layout overlap** — resolve merge conflict in seed positions and ensure nodes load without overlaps
2. **Add duration annotations** — each step in flows (agui, nl, hitl) gets a configurable duration (ms)
3. **Add playback UI** — Play/Pause button in steps panel to animate through steps with timed visualization

This allows users to see a clean diagram by default, annotate realistic latencies, and demo flows with timed visualization.

## Changes Required

### 1. Data Model — Add Durations to FLOWS

In `ArchitectureCanvasPage.jsx`, update the `FLOWS` constant to include a `duration` field (milliseconds) per step:

```jsx
const FLOWS = {
  agui: {
    label: 'AG-UI · Streaming',
    color: '#059669',
    steps: [
      { from: 'frontend', to: 'bff', desc: '...', duration: 500 },
      { from: 'bff', to: 'langchain-agent', desc: '...', duration: 1500 },
      { from: 'langchain-agent', to: 'bff', desc: '...', duration: 300 },
      // ... rest of steps with default 1000ms
    ],
  },
  // ... other flows
};
```

Default duration is **1000ms** if not specified. User can adjust via UI.

### 2. Component State — Track Playback

Add state to `ArchitectureCanvasPage`:

- `isPlaying` (boolean) — true during playback
- `currentStepIndex` (number) — which step is currently highlighted (null = none)
- `stepDurations` (object) — user-edited durations per `${flowId}-${stepIndex}` key

### 3. UI — Steps Panel Updates

Modify `.canvas-steps-list` to show:

- Each step displays a **duration input field** (e.g., "500ms")
- Steps panel header shows **Play** / **Pause** button (disabled if no flow selected)
- While playing, the current step is highlighted with a pulsing animation
- Clicking a step number jumps playback to that step (if playing)

### 4. Animation — Playback Loop

On Play click:
1. Start at step 0
2. Highlight the current step visually (green glow + pulse)
3. Wait for `stepDurations[currentStepIndex]` milliseconds
4. Advance to next step
5. Repeat until all steps complete or user clicks Pause
6. Reset highlight when done

Pause/Resume:
- Pause stops the timer, keeps current step highlighted
- Resume continues from that step

### 5. Visual Changes

**Step highlighting during playback:**

- Add a pulsing green glow to the current step number badge
- Optional: slight highlight on the step-body text

**Buttons:**

- Add **Play** button (triangle ▶) to `.canvas-steps-header`
- When playing, show **Pause** button (⏸) instead
- Both buttons disabled when no flow is selected

## Data Flow

```
User selects flow
  ↓
Steps panel renders with editable durations
  ↓
User clicks Play
  ↓
Highlight step 0, wait for duration[0]
  ↓
Advance to step 1, repeat
  ↓
User clicks Pause → freeze current step
  ↓
User clicks Resume → continue from current step
  ↓
All steps complete → reset highlight
```

## Edge Cases & Behavior

- **Selecting a different flow while playing:** Pause current playback, show new flow's steps with their durations
- **Editing duration mid-playback:** Changes take effect on next step transition
- **Empty flow:** Play button disabled
- **Single-step flow:** Highlight the one step, wait, then done
- **Zero duration:** Treat as instant (0ms wait, advance immediately)

## Files to Modify

1. `demo_api_ui/src/components/ArchitectureCanvasPage.jsx` — state, playback loop, UI updates
2. `demo_api_ui/src/components/ArchitectureCanvasPage.css` — pulsing animation, step input styles

## Testing

- Flows load with default durations
- Durations persist in localStorage (alongside nodes/edges)
- Play → Pause → Resume works smoothly
- Changing flows mid-playback resets
- Manually editing duration updates immediately
- Animations are smooth (no jank at 60fps)

## Success Criteria

✅ Each flow step shows an editable duration input
✅ Play button animates through steps with configured timings
✅ Pause/Resume work without losing position
✅ Durations are stored (don't reset on page reload)
✅ No console errors; smooth animation
