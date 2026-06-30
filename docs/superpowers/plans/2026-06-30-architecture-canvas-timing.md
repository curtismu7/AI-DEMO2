---
title: Architecture Canvas — Step Timing & Animation
date: 2026-06-30
---

# Architecture Canvas — Step Timing & Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable duration annotations to flow steps, resolve seed position merge conflict, and implement playback animation with Play/Pause UI.

**Architecture:** 
- Resolve merge conflict in `useCanvasLayout.js` seed positions to ensure clean default layout
- Extend FLOWS data model with duration field per step (default 1000ms)
- Add playback state (isPlaying, currentStepIndex, stepDurations) to ArchitectureCanvasPage component
- Implement playback loop using `setInterval` to highlight steps and advance based on configured durations
- Add duration input fields in steps panel + Play/Pause button in header
- Style currently-playing step with pulsing animation via CSS keyframes

**Tech Stack:** React (Konva), localStorage for persistence, CSS animations

## Global Constraints

- Default duration per step: 1000ms if not specified
- Durations persist in localStorage alongside nodes/edges (key: `arch-canvas-v7-durations`)
- No new dependencies; use React hooks + Konva primitives
- Play/Pause button disabled when no flow is selected

---

## Task 1: Resolve Seed Position Merge Conflict

**Files:**
- Modify: `demo_api_ui/src/hooks/useCanvasLayout.js:17-39`

**Interfaces:**
- Produces: `SEED_POSITIONS` object with clean x/y coordinates that avoid overlaps
  ```javascript
  {
    frontend: { x: number, y: number },
    bff: { x: number, y: number },
    // ... all nodes
  }
  ```

- [ ] **Step 1: View the merge conflict**

Open `demo_api_ui/src/hooks/useCanvasLayout.js` and locate the `<<<<<<<` marker around line 18. View both HEAD and origin/main versions.

Expected: See two conflicting SEED_POSITIONS definitions.

- [ ] **Step 2: Choose the correct version and resolve**

The origin/main version (lines 29-37, after the `=======` marker) has better spacing:
- frontend: 30, 220
- bff: 220, 220  
- pingone-sso: 220, 80
- agent-service: 430, 220
- mcp-gateway: 640, 210
- authz-server: 855, 40
- hitl-service: 855, 360
- mcp-server: 1075, 40
- mcp-invest: 1075, 200

Replace lines 17-39 with the resolved version (remove conflict markers):

```javascript
const SEED_POSITIONS = {
  frontend:          { x: 30,   y: 220 },
  bff:               { x: 220,  y: 220 },
  'pingone-sso':     { x: 220,  y: 80  },
  'agent-service':   { x: 430,  y: 220 },
  'mcp-gateway':     { x: 640,  y: 210 },
  'authz-server':    { x: 855,  y: 40  },
  'hitl-service':    { x: 855,  y: 360 },
  'mcp-server':      { x: 1075, y: 40  },
  'mcp-invest':      { x: 1075, y: 200 },
};
```

- [ ] **Step 3: Remove the merge conflict markers**

Verify no `<<<<<<<`, `=======`, or `>>>>>>>` markers remain in the file.

- [ ] **Step 4: Test that nodes load without merge conflicts**

Open the browser to `http://localhost:3001/architecture/flow` and verify the diagram loads with nodes in non-overlapping positions. No console errors.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/hooks/useCanvasLayout.js
git commit -m "fix: resolve seed position merge conflict for clean default layout"
```

---

## Task 2: Add Duration Field to FLOWS

**Files:**
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx:75-115`

**Interfaces:**
- Consumes: None (FLOWS is self-contained)
- Produces: Each step in each flow now has `duration: number` (milliseconds)
  ```javascript
  FLOWS = {
    flowKey: {
      label: string,
      color: string,
      steps: [
        { from: string, to: string, desc: string, duration: number },
        // ...
      ]
    }
  }
  ```

- [ ] **Step 1: Update agui flow with durations**

In `ArchitectureCanvasPage.jsx`, locate the `FLOWS` constant (line 75). Update the `agui` flow steps to include durations:

```javascript
agui: {
  label: 'AG-UI · Streaming',
  color: '#059669',
  steps: [
    { from: 'frontend',        to: 'bff',             desc: 'User sends a message. Browser POSTs to BFF (/api/agent/run) and opens an SSE stream for the response.', duration: 500 },
    { from: 'bff',             to: 'langchain-agent', desc: 'BFF forwards to LangChain agent (POST :8888/run) with tool schemas, thread ID, and a callback URL for tool execution.', duration: 1500 },
    { from: 'langchain-agent', to: 'bff',             desc: 'Agent decides to call a tool. It POSTs back to BFF (/internal/agent-tool) with the tool name and arguments.', duration: 300 },
    { from: 'bff',             to: 'pingone-sso',     desc: 'BFF performs RFC 8693 token exchange with PingOne SSO — minting a delegated mcp-gateway-scoped token with act claim.', duration: 800 },
    { from: 'bff',             to: 'mcp-gateway',     desc: 'BFF calls Ping Agent Gateway (POST JSON-RPC tools/call) with the delegated token.', duration: 1000 },
    { from: 'mcp-gateway',     to: 'authz-server',    desc: 'Gateway sends 18-parameter policy decision to PingOne Authorize (P1AZ): user, tool, scopes, amounts, act chain. Expects PERMIT / DENY / INDETERMINATE.', duration: 1200 },
    { from: 'mcp-gateway',     to: 'mcp-server',      desc: 'PERMIT received. Gateway opens a WebSocket to mcp-server and proxies the tools/call. Result travels back up the chain to the browser.', duration: 2000 },
  ],
}
```

- [ ] **Step 2: Update nl flow with durations**

Update the `nl` flow (lines 89-101) with durations:

```javascript
nl: {
  label: 'NL Mode · Agent service',
  color: '#7c3aed',
  steps: [
    { from: 'frontend',      to: 'bff',          desc: 'User sends a natural-language message. Browser POSTs to BFF (/api/demo-agent/message).', duration: 400 },
    { from: 'bff',           to: 'agent-service', desc: 'BFF dispatches to agent-service (/api/agent/reason) with tool schemas only — no user tokens leave the BFF.', duration: 1000 },
    { from: 'agent-service', to: 'bff',           desc: 'Agent-service returns tool_calls from the LLM. BFF executes each tool via its own MCP pipeline and loops until it gets a final answer.', duration: 800 },
    { from: 'bff',           to: 'pingone-sso',   desc: 'BFF performs RFC 8693 token exchange with PingOne SSO to obtain a delegated mcp-scoped token.', duration: 700 },
    { from: 'bff',           to: 'mcp-gateway',   desc: 'BFF calls Ping Agent Gateway with the delegated token.', duration: 900 },
    { from: 'mcp-gateway',   to: 'authz-server',  desc: 'PingOne Authorize evaluates the request (user identity, tool, scopes, transaction amount).', duration: 1100 },
    { from: 'mcp-gateway',   to: 'mcp-server',    desc: 'PERMIT → gateway proxies the tool call over WebSocket to the mcp-server backend.', duration: 1800 },
  ],
}
```

- [ ] **Step 3: Update hitl flow with durations**

Update the `hitl` flow (lines 102-115) with durations:

```javascript
hitl: {
  label: 'HITL · Human approval',
  color: '#db2777',
  steps: [
    { from: 'frontend',     to: 'bff',          desc: 'High-value action triggered (e.g. large transfer). BFF initiates the MCP tool call pipeline.', duration: 500 },
    { from: 'bff',          to: 'pingone-sso',   desc: 'BFF mints a delegated token via RFC 8693 with PingOne SSO before calling the gateway.', duration: 750 },
    { from: 'bff',          to: 'mcp-gateway',   desc: 'BFF calls Ping Agent Gateway with the delegated token and full transaction context.', duration: 1000 },
    { from: 'mcp-gateway',  to: 'authz-server',  desc: 'PingOne Authorize evaluates policy and returns INDETERMINATE — the transaction requires explicit human approval.', duration: 1300 },
    { from: 'mcp-gateway',  to: 'hitl-service',  desc: 'Gateway creates a challenge (POST /challenges) and returns JSON-RPC error -32002 to BFF with challengeId.', duration: 600 },
    { from: 'hitl-service', to: 'bff',           desc: 'User approves the challenge in the UI. HITL service notifies BFF; agent retries the tool call with _hitl_challenge_id.', duration: 3000 },
    { from: 'mcp-gateway',  to: 'mcp-server',    desc: 'P1AZ now returns PERMIT for the approved challenge. Tool executes on mcp-server and result returns to user.', duration: 2000 },
  ],
}
```

- [ ] **Step 4: Verify syntax**

Check the file for syntax errors (mismatched braces, quotes). Run the app and confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ArchitectureCanvasPage.jsx
git commit -m "feat: add duration field to FLOWS steps (default 1000ms)"
```

---

## Task 3: Add Playback State to Component

**Files:**
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx:242-260` (state declarations)

**Interfaces:**
- Consumes: React `useState`, `useRef`, `useEffect`
- Produces: 
  - `isPlaying: boolean` - true when animation is running
  - `currentStepIndex: number | null` - index of currently highlighted step, or null if none
  - `stepDurations: object` - map of `${flowId}-${stepIndex}` to user-configured duration (ms)
  - `playbackTimeoutRef: React.MutableRefObject<number>` - setTimeout ID for cleanup

- [ ] **Step 1: Add new state variables**

After line 260 (the `dragWireRef` declarations), add:

```javascript
const [isPlaying, setIsPlaying] = useState(false);
const [currentStepIndex, setCurrentStepIndex] = useState(null);
const [stepDurations, setStepDurations] = useState(() => {
  try {
    const raw = localStorage.getItem('arch-canvas-v7-durations');
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
});
const playbackTimeoutRef = useRef(null);
```

- [ ] **Step 2: Add duration persistence helper**

Add a function to save durations to localStorage after the state declarations:

```javascript
const persistDurations = useCallback((durations) => {
  try {
    localStorage.setItem('arch-canvas-v7-durations', JSON.stringify(durations));
  } catch (_) {}
}, []);
```

- [ ] **Step 3: Add cleanup effect for timeout**

Add a new `useEffect` hook to clean up the timeout on unmount or when playback stops:

```javascript
useEffect(() => {
  return () => {
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
  };
}, []);
```

- [ ] **Step 4: Test that state loads without errors**

Open the browser and check console. No errors about undefined state or localStorage.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ArchitectureCanvasPage.jsx
git commit -m "feat: add playback state (isPlaying, currentStepIndex, stepDurations)"
```

---

## Task 4: Implement Playback Animation Loop

**Files:**
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx:360-420` (new playback function)

**Interfaces:**
- Consumes:
  - `selectedFlow: string | null` - current flow ID
  - `isPlaying: boolean` - playback state
  - `currentStepIndex: number | null` - current step
  - `stepDurations: object` - user durations map
  - `FLOWS: object` - flow definitions with steps
- Produces:
  - `playFlow(): void` - starts playback from step 0
  - `advanceToNextStep(): void` - advances to next step or stops
  - Updates to `currentStepIndex`, `isPlaying`, and playback timeout

- [ ] **Step 1: Add playFlow function**

Add this function after the `handleDeleteNode` function (around line 390):

```javascript
const playFlow = useCallback(() => {
  if (!selectedFlow || !FLOWS[selectedFlow]) return;
  setIsPlaying(true);
  setCurrentStepIndex(0);
  advanceToNextStep();
}, [selectedFlow]);
```

- [ ] **Step 2: Add advanceToNextStep function**

Add right after `playFlow`:

```javascript
const advanceToNextStep = useCallback(() => {
  if (!selectedFlow || !FLOWS[selectedFlow]) {
    setIsPlaying(false);
    setCurrentStepIndex(null);
    return;
  }
  
  const flow = FLOWS[selectedFlow];
  const nextIndex = currentStepIndex + 1;
  
  if (nextIndex >= flow.steps.length) {
    // End of flow
    setIsPlaying(false);
    setCurrentStepIndex(null);
    return;
  }
  
  // Get duration for current step
  const durationKey = `${selectedFlow}-${currentStepIndex}`;
  const duration = stepDurations[durationKey] ?? (flow.steps[currentStepIndex]?.duration ?? 1000);
  
  // Schedule next step
  const timeoutId = setTimeout(() => {
    setCurrentStepIndex(nextIndex);
  }, duration);
  
  playbackTimeoutRef.current = timeoutId;
}, [selectedFlow, currentStepIndex, stepDurations]);
```

- [ ] **Step 3: Add effect to trigger advanceToNextStep**

Add this `useEffect` hook to automatically advance when currentStepIndex changes:

```javascript
useEffect(() => {
  if (!isPlaying || currentStepIndex === null) return;
  advanceToNextStep();
}, [isPlaying, currentStepIndex, advanceToNextStep]);
```

- [ ] **Step 4: Add pausePlayback function**

Add after the advance functions:

```javascript
const pausePlayback = useCallback(() => {
  setIsPlaying(false);
  if (playbackTimeoutRef.current) {
    clearTimeout(playbackTimeoutRef.current);
    playbackTimeoutRef.current = null;
  }
}, []);
```

- [ ] **Step 5: Test the playback logic (manual)**

Open the browser, select a flow (e.g., "AG-UI · Streaming"), and you should see the Play button ready. Don't click it yet—that's in the next task.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/ArchitectureCanvasPage.jsx
git commit -m "feat: implement playback animation loop with step advancement"
```

---

## Task 5: Add Duration Input UI in Steps Panel

**Files:**
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx:703-724` (steps list rendering)
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.css` (add input styles)

**Interfaces:**
- Consumes:
  - `stepDurations: object`
  - `flow.steps: array` 
  - `persistDurations: function`
- Produces: Duration input field rendered next to each step with onChange handler

- [ ] **Step 1: Update step rendering to include duration input**

In `ArchitectureCanvasPage.jsx`, find the `.canvas-steps-list` section (around line 712-722). Replace the step rendering with:

```javascript
<div className="canvas-steps-list">
  {flow.steps.map((step, i) => {
    const durationKey = `${selectedFlow}-${i}`;
    const currentDuration = stepDurations[durationKey] ?? (step.duration ?? 1000);
    
    return (
      <div key={i} className="canvas-step">
        <span className="canvas-step-num" style={{ background: flow.color }}>{i + 1}</span>
        <div className="canvas-step-body">
          <span className="canvas-step-route">{step.from} → {step.to}</span>
          <span className="canvas-step-desc">{step.desc}</span>
          <div className="canvas-step-duration">
            <label>Duration:</label>
            <input
              type="number"
              min="0"
              step="100"
              value={currentDuration}
              onChange={(e) => {
                const newVal = parseInt(e.target.value, 10) || 0;
                const newDurations = { ...stepDurations, [durationKey]: newVal };
                setStepDurations(newDurations);
                persistDurations(newDurations);
              }}
            />
            <span className="canvas-step-duration-unit">ms</span>
          </div>
        </div>
      </div>
    );
  })}
</div>
```

- [ ] **Step 2: Add CSS for duration input row**

In `ArchitectureCanvasPage.css`, add at the end of the file:

```css
.canvas-step-duration {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 11px;
  color: #64748b;
}

.canvas-step-duration label {
  font-weight: 600;
  color: #475569;
}

.canvas-step-duration input {
  width: 60px;
  padding: 3px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'ui-monospace', monospace;
  color: #1e293b;
}

.canvas-step-duration input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.canvas-step-duration-unit {
  font-weight: 600;
  color: #94a3b8;
}
```

- [ ] **Step 3: Test duration inputs**

Open browser, select a flow. Each step should show an input field with the default or saved duration. Change a value and verify it updates state + localStorage.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/ArchitectureCanvasPage.jsx demo_api_ui/src/components/ArchitectureCanvasPage.css
git commit -m "feat: add duration input fields to steps panel"
```

---

## Task 6: Add Play/Pause Button to Steps Header

**Files:**
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx:705-711` (steps header)
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.css` (button styles)

**Interfaces:**
- Consumes:
  - `isPlaying: boolean`
  - `selectedFlow: string | null`
  - `playFlow(): void`
  - `pausePlayback(): void`
- Produces: Play/Pause button in steps header; disabled when no flow selected

- [ ] **Step 1: Update steps header with Play/Pause button**

In `ArchitectureCanvasPage.jsx`, find the `.canvas-steps-header` section (around line 705-710). Add the button:

```javascript
<div className="canvas-steps-header">
  <span className="canvas-steps-title" style={{ borderColor: flow.color, color: flow.color }}>
    {flow.label}
  </span>
  <span className="canvas-steps-sub">Numbered steps map to arrows on the diagram above</span>
  <button 
    className="canvas-steps-play"
    disabled={!selectedFlow}
    onClick={() => isPlaying ? pausePlayback() : playFlow()}
  >
    {isPlaying ? '⏸ Pause' : '▶ Play'}
  </button>
  <button className="canvas-steps-close" onClick={() => setSelectedFlow(null)}>✕ Close</button>
</div>
```

- [ ] **Step 2: Add Play/Pause button styles**

In `ArchitectureCanvasPage.css`, add:

```css
.canvas-steps-play {
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.canvas-steps-play:hover:not(:disabled) {
  background: #059669;
}

.canvas-steps-play:disabled {
  background: #cbd5e1;
  cursor: default;
  opacity: 0.6;
}
```

- [ ] **Step 3: Test Play/Pause button**

Open browser, select a flow. Play button should be enabled. Click it and verify button changes to "Pause". Click Pause and verify it stops animation.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/ArchitectureCanvasPage.jsx demo_api_ui/src/components/ArchitectureCanvasPage.css
git commit -m "feat: add Play/Pause button to steps panel header"
```

---

## Task 7: Add Pulsing Animation for Current Step

**Files:**
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.jsx:713-722` (step rendering)
- Modify: `demo_api_ui/src/components/ArchitectureCanvasPage.css` (keyframes + class)

**Interfaces:**
- Consumes:
  - `currentStepIndex: number | null`
  - `flow.color: string`
- Produces: `.canvas-step-num--active` class applied when step is playing; CSS keyframe animation `pulse`

- [ ] **Step 1: Add conditional class to step number badge**

In `ArchitectureCanvasPage.jsx`, update the step number rendering (inside the map function from Task 5):

```javascript
<span 
  className={`canvas-step-num${i === currentStepIndex ? ' canvas-step-num--active' : ''}`}
  style={{ background: flow.color }}
>
  {i + 1}
</span>
```

- [ ] **Step 2: Add pulsing keyframe animation**

In `ArchitectureCanvasPage.css`, add at the end:

```css
@keyframes pulse-step {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.2);
  }
}

.canvas-step-num--active {
  animation: pulse-step 1.5s ease-in-out infinite !important;
}
```

- [ ] **Step 3: Test the pulsing effect**

Open browser, select flow, click Play. The current step's number badge should pulse with a green glow. As each step advances, the pulse moves to the next step number.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/ArchitectureCanvasPage.jsx demo_api_ui/src/components/ArchitectureCanvasPage.css
git commit -m "feat: add pulsing animation to active step during playback"
```

---

## Task 8: End-to-End Testing & Cleanup

**Files:**
- No file changes; testing only

**Interfaces:**
- Tests: All features from Tasks 1-7

- [ ] **Step 1: Test clean default layout**

Load `http://localhost:3001/architecture/flow` in a fresh browser tab. Nodes should load without overlaps. No merge conflict message or warnings.

Expected: Nodes arranged in clear columns (Browser, BFF, Agent, Gateway, Auth, Backends).

- [ ] **Step 2: Test flow selection**

Select "AG-UI · Streaming" from the flow dropdown. Verify:
- Steps panel appears
- Each step shows duration input with correct default value
- Play button is enabled
- All arrows highlighted in green with step numbers

- [ ] **Step 3: Test playback**

Click Play. Verify:
- Current step number pulses with green glow
- After configured duration, pulses move to next step
- No console errors
- Playback completes at the last step

Expected: Smooth animation through all 7 steps of agui flow.

- [ ] **Step 4: Test Pause/Resume**

During playback, click Pause. Verify:
- Animation stops
- Current step stays highlighted
- Button changes to Play
- Click Play again, resumes from that step

- [ ] **Step 5: Test duration editing mid-playback**

Start playback, then change a duration value in an upcoming step's input. Verify:
- Change takes effect when that step is reached
- No crashes or console errors

- [ ] **Step 6: Test flow switching during playback**

Start playback on agui, then select nl flow. Verify:
- agui playback pauses
- nl flow loads in steps panel
- nl flow's durations display correctly
- Click Play starts nl flow from step 0

- [ ] **Step 7: Test persistence**

Edit durations for agui flow, then refresh the page. Verify:
- Durations are restored from localStorage
- No reset to defaults

- [ ] **Step 8: Test other flows**

Test playback on nl and hitl flows. Verify:
- Different colors (purple, pink) animate correctly
- Durations are unique per flow
- All steps advance smoothly

- [ ] **Step 9: Verify no console errors**

Throughout all tests, open DevTools console and confirm no errors, warnings, or unhandled promises.

- [ ] **Step 10: Final commit (if any cleanup)**

If any minor issues were fixed during testing:

```bash
git add .
git commit -m "test: verify end-to-end playback and layout"
```

If no changes needed, skip this step.

---

## Spec Coverage Verification

✅ **Fix default layout overlap** (Task 1) — Resolved merge conflict, clean seed positions  
✅ **Duration annotations** (Task 2) — Added duration field to all FLOWS steps  
✅ **Playback state** (Task 3) — isPlaying, currentStepIndex, stepDurations  
✅ **Playback loop** (Task 4) — advanceToNextStep with setTimeout, effect-driven loop  
✅ **Duration inputs** (Task 5) — Input fields in steps panel, localStorage persistence  
✅ **Play/Pause button** (Task 6) — Toggle button in steps header, disabled when no flow  
✅ **Pulsing animation** (Task 7) — CSS keyframe on active step badge  
✅ **Edge cases** (Task 4-8) — Flow switching pauses, duration edit mid-play, zero duration, single-step flows  
✅ **Reset button** — Unchanged; existing reset already works  

**No gaps identified.**
