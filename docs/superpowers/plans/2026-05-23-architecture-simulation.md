# Architecture Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static PNG viewer at `/architecture/overview` with a hand-coded interactive SVG diagram that supports three simulation modes: Scenario auto-play, Step-through, and Live trace.

**Architecture:** `ArchitectureOverviewPage.js` owns state via a `useSimulation` reducer hook. Three presentational sub-components (`ArchitectureSimSvg`, `ArchitectureSimControls`, `ArchitectureSimStepDesc`) handle rendering. Scenario data lives in `architecture-sim-scenarios.js`. The toolbar reuses `DiagramControls` from `./diagram` with mode tabs + scenario dropdown passed via the `extra` prop. Live trace is powered by a new BFF SSE endpoint at `/api/arch-events`.

**Tech Stack:** React 18 (CRA, CommonJS-compatible JSX), inline SVG, CSS animations, EventSource (browser SSE), Express SSE (BFF), Node.js EventEmitter singleton.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Replace | `demo_api_ui/src/components/ArchitectureOverviewPage.js` | Page root + `useSimulation` hook |
| Create | `demo_api_ui/src/components/ArchitectureSimSvg.jsx` | Hand-coded SVG diagram |
| Create | `demo_api_ui/src/components/ArchitectureSimControls.jsx` | Toolbar (wraps DiagramControls) |
| Create | `demo_api_ui/src/components/ArchitectureSimStepDesc.jsx` | Step description bar |
| Create | `demo_api_ui/src/config/architecture-sim-scenarios.js` | All scenario step arrays |
| Create | `demo_api_server/services/archEventEmitter.js` | Singleton EventEmitter for BFF events |
| Create | `demo_api_server/routes/archEvents.js` | SSE route `/api/arch-events` |
| Modify | `demo_api_server/server.js` | Register archEvents route |
| Modify | `demo_api_server/routes/oauth.js` | Emit arch events on login callback |
| Modify | `demo_api_server/routes/mcpInspector.js` | Emit arch events on MCP tool calls |

**Do not touch:**
- `demo_api_ui/src/config/diagram-overview-regions.js` — used by other pages
- `demo_api_ui/src/components/diagram/DiagramControls.*` — shared component, no new props
- Any file in `REGRESSION_PLAN.md` §1 except the minimal `emit()` additions to `oauth.js` and `mcpInspector.js`

---

## Task 1: Scenario data

**Files:**
- Create: `demo_api_ui/src/config/architecture-sim-scenarios.js`

- [ ] **Step 1: Create the scenarios file**

```js
// demo_api_ui/src/config/architecture-sim-scenarios.js
/**
 * Pre-authored simulation scenarios for ArchitectureOverviewPage.
 *
 * Each scenario is an array of steps. When a step fires:
 *   - step.nodes  → set to "active" (amber pulse)
 *   - step.edges  → set to "active" (sweep animation)
 *   - Previous active nodes/edges are promoted to "done" (green)
 *
 * nodeId / edgeId values must match the `id` attributes in ArchitectureSimSvg.jsx.
 */

export const SCENARIOS = [
  {
    id: 'oauth-login',
    label: 'OAuth Login (PKCE)',
    steps: [
      { nodes: ['n-browser'],  edges: [],                    desc: 'User opens the app in the browser' },
      { nodes: ['n-bff'],      edges: ['e-browser-bff'],     desc: 'Browser → BFF: PKCE auth redirect begins (RFC 6749 §4.1 + RFC 7636)' },
      { nodes: ['n-pingone'],  edges: ['e-bff-pingone'],     desc: 'BFF exchanges auth code at PingOne token endpoint' },
      { nodes: ['n-bff'],      edges: [],                    desc: 'BFF receives access + ID tokens; sets httpOnly session cookie' },
      { nodes: ['n-browser'],  edges: ['e-browser-bff'],     desc: 'Session established — login complete ✅' },
    ],
  },
  {
    id: 'mcp-tool-call',
    label: 'MCP Tool Call',
    steps: [
      { nodes: ['n-browser'],     edges: [],                    desc: 'User triggers an AI tool call (e.g. "Get my accounts")' },
      { nodes: ['n-bff'],         edges: ['e-browser-bff'],     desc: 'BFF validates session; resolves user access token' },
      { nodes: ['n-mcp-gw'],      edges: ['e-bff-mcpgw'],       desc: 'BFF sends request to MCP Gateway with user token' },
      { nodes: ['n-pingone'],     edges: ['e-mcpgw-pingone'],   desc: 'Gateway performs RFC 8693 token exchange with PingOne' },
      { nodes: ['n-mcp-server'],  edges: ['e-mcpgw-mcpserver'], desc: 'Gateway forwards exchanged token to MCP Server; tool executes' },
      { nodes: ['n-bff'],         edges: [],                    desc: 'Tool result returns to BFF → browser' },
    ],
  },
  {
    id: 'token-exchange',
    label: 'RFC 8693 Token Exchange',
    steps: [
      { nodes: ['n-bff'],         edges: [],                    desc: 'BFF holds user access token (subject_token) from session' },
      { nodes: ['n-mcp-gw'],      edges: ['e-bff-mcpgw'],       desc: 'MCP Gateway receives request + user token' },
      { nodes: ['n-pingone'],     edges: ['e-mcpgw-pingone'],   desc: 'Token Exchange: subject_token → narrowed MCP-scoped token (new aud)' },
      { nodes: ['n-mcp-gw'],      edges: [],                    desc: 'Gateway holds narrowed token with MCP audience + delegated scopes' },
      { nodes: ['n-mcp-server'],  edges: ['e-mcpgw-mcpserver'], desc: 'Narrowed token forwarded to MCP Server — tool call authorised' },
    ],
  },
  {
    id: 'hitl-consent',
    label: 'HITL Consent Flow',
    steps: [
      { nodes: ['n-browser'],  edges: [],                desc: 'User initiates high-value transfer (> threshold)' },
      { nodes: ['n-bff'],      edges: ['e-browser-bff'], desc: 'BFF detects amount ≥ threshold; triggers HITL challenge (428)' },
      { nodes: ['n-hitl'],     edges: ['e-bff-hitl'],    desc: 'HITL Service sends out-of-band consent request (push/email)' },
      { nodes: ['n-bff'],      edges: [],                desc: 'BFF polls HITL Service for approval decision' },
      { nodes: ['n-bff'],      edges: ['e-bff-hitl'],    desc: 'Approval received — transaction proceeds through normal gate' },
      { nodes: ['n-browser'],  edges: ['e-browser-bff'], desc: 'Transfer complete — confirmation returned to browser ✅' },
    ],
  },
  {
    id: 'step-up-mfa',
    label: 'Step-Up MFA',
    steps: [
      { nodes: ['n-browser'],       edges: [],                  desc: 'User attempts large transfer' },
      { nodes: ['n-bff'],           edges: ['e-browser-bff'],   desc: 'BFF Step-Up Gate: amount ≥ threshold → 428 step_up_required' },
      { nodes: ['n-pingone'],       edges: ['e-bff-pingone'],   desc: 'Browser redirected to PingOne for MFA challenge' },
      { nodes: ['n-bff'],           edges: ['e-bff-pingone'],   desc: 'BFF validates step-up token; ACR value confirmed' },
      { nodes: ['n-pingauthorize'], edges: ['e-bff-pingauth'],  desc: 'PingAuthorize evaluates transfer policy → PERMIT' },
      { nodes: ['n-browser'],       edges: ['e-browser-bff'],   desc: 'Transfer authorised — response returned ✅' },
    ],
  },
  {
    id: 'path-a-api-key',
    label: 'MCP Gateway Path A (API Key)',
    steps: [
      { nodes: ['n-bff'],           edges: [],                    desc: 'BFF selects Path A: api_key disposition' },
      { nodes: ['n-mcp-gw'],        edges: ['e-bff-mcpgw'],       desc: 'MCP Gateway receives request; drops RFC 6750 Bearer token' },
      { nodes: ['n-mcp-gw'],        edges: [],                    desc: 'Gateway injects X-API-Key + X-User-Sub headers' },
      { nodes: ['n-mortgage'],      edges: ['e-mcpgw-mortgage'],  desc: 'Request forwarded to Mortgage Service (:8082) with API key auth' },
    ],
  },
  {
    id: 'path-b-dual-token',
    label: 'MCP Gateway Path B (Dual Token)',
    steps: [
      { nodes: ['n-bff'],              edges: [],                        desc: 'BFF selects Path B: dual_token disposition' },
      { nodes: ['n-mcp-gw'],           edges: ['e-bff-mcpgw'],           desc: 'MCP Gateway forwards Bearer + id_token to Resource Server' },
      { nodes: ['n-resource-server'],  edges: ['e-mcpgw-resourceserver'], desc: 'Resource Server validates Bearer (RFC 6750) + id_token (OIDC Core §3.1.3.7)' },
    ],
  },
  {
    id: 'path-c-oauth-bearer',
    label: 'MCP Gateway Path C (OAuth Bearer)',
    steps: [
      { nodes: ['n-bff'],              edges: [],                        desc: 'BFF selects Path C: oauth_bearer disposition' },
      { nodes: ['n-mcp-gw'],           edges: ['e-bff-mcpgw'],           desc: 'MCP Gateway performs RFC 8693 exchange; new token has Resource Server aud' },
      { nodes: ['n-pingone'],          edges: ['e-mcpgw-pingone'],       desc: 'Token Exchange: narrowed Bearer for Resource Server audience' },
      { nodes: ['n-resource-server'],  edges: ['e-mcpgw-resourceserver'], desc: 'Exchanged Bearer forwarded to /accounts or /transactions endpoint ✅' },
    ],
  },
];

export const SCENARIO_MAP = Object.fromEntries(SCENARIOS.map(s => [s.id, s]));
export const DEFAULT_SCENARIO_ID = 'oauth-login';
```

- [ ] **Step 2: Verify the file is importable (no build step needed yet — just syntax check)**

```bash
cd demo_api_ui && node -e "require('./src/config/architecture-sim-scenarios.js')" 2>&1 || echo "ESM — will validate at build time"
```

Expected: either silent (CJS) or "ESM" message (fine — CRA handles ESM).

---

## Task 2: `useSimulation` hook + page shell

**Files:**
- Replace: `demo_api_ui/src/components/ArchitectureOverviewPage.js`

- [ ] **Step 1: Write the new ArchitectureOverviewPage.js**

```js
// demo_api_ui/src/components/ArchitectureOverviewPage.js
import { useReducer, useEffect, useRef, useCallback } from 'react';
import ArchitectureSimSvg from './ArchitectureSimSvg';
import ArchitectureSimControls from './ArchitectureSimControls';
import ArchitectureSimStepDesc from './ArchitectureSimStepDesc';
import { SCENARIOS, SCENARIO_MAP, DEFAULT_SCENARIO_ID } from '../config/architecture-sim-scenarios';

// ─── State machine ───────────────────────────────────────────────────────────

const INITIAL_STATE = {
  mode: 'scenario',            // 'scenario' | 'step' | 'live'
  scenarioId: DEFAULT_SCENARIO_ID,
  stepIndex: 0,                // 0 = not started; 1..n = step number
  playing: false,
  speed: 1,                    // 0.5 | 1 | 2  (multiplier; 1× = 1000ms/step)
  nodeStates: {},              // { [nodeId]: 'idle' | 'active' | 'done' }
  edgeStates: {},              // { [edgeId]: 'idle' | 'active' | 'done' }
};

function advanceState(state, steps) {
  // Promote current active → done, then activate next step's nodes/edges
  const nodeStates = { ...state.nodeStates };
  const edgeStates = { ...state.edgeStates };

  // Promote active → done
  for (const id of Object.keys(nodeStates)) {
    if (nodeStates[id] === 'active') nodeStates[id] = 'done';
  }
  for (const id of Object.keys(edgeStates)) {
    if (edgeStates[id] === 'active') edgeStates[id] = 'done';
  }

  const stepIdx = state.stepIndex; // 0-based index into steps array
  if (stepIdx >= steps.length) return { ...state, playing: false, nodeStates, edgeStates };

  const step = steps[stepIdx];
  step.nodes.forEach(id => { nodeStates[id] = 'active'; });
  step.edges.forEach(id => { edgeStates[id] = 'active'; });

  return {
    ...state,
    nodeStates,
    edgeStates,
    stepIndex: state.stepIndex + 1,
  };
}

function resetStates() {
  return { nodeStates: {}, edgeStates: {}, stepIndex: 0, playing: false };
}

function simReducer(state, action) {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, ...resetStates(), mode: action.mode };

    case 'SET_SCENARIO':
      return { ...state, ...resetStates(), scenarioId: action.scenarioId };

    case 'SET_SPEED':
      return { ...state, speed: action.speed };

    case 'PLAY': {
      if (state.mode === 'live') return { ...state, playing: true };
      const scenario = SCENARIO_MAP[state.scenarioId];
      if (!scenario) return state;
      // If at end, reset first then play
      if (state.stepIndex >= scenario.steps.length) {
        return { ...state, ...resetStates(), playing: true };
      }
      return { ...state, playing: true };
    }

    case 'PAUSE':
      return { ...state, playing: false };

    case 'STEP': {
      const scenario = SCENARIO_MAP[state.scenarioId];
      if (!scenario) return state;
      return advanceState({ ...state, playing: false }, scenario.steps);
    }

    case 'RESET':
      return { ...state, ...resetStates() };

    case 'TICK': {
      // Called by the play timer
      const scenario = SCENARIO_MAP[state.scenarioId];
      if (!scenario) return { ...state, playing: false };
      if (state.stepIndex >= scenario.steps.length) {
        return { ...state, playing: false };
      }
      return advanceState(state, scenario.steps);
    }

    case 'LIVE_EVENT': {
      // Fired when SSE event arrives in Live Trace mode
      const { nodeId, edgeId } = action;
      const nodeStates = { ...state.nodeStates };
      const edgeStates = { ...state.edgeStates };
      // Promote previous active → done
      for (const id of Object.keys(nodeStates)) {
        if (nodeStates[id] === 'active') nodeStates[id] = 'done';
      }
      for (const id of Object.keys(edgeStates)) {
        if (edgeStates[id] === 'active') edgeStates[id] = 'done';
      }
      if (nodeId) nodeStates[nodeId] = 'active';
      if (edgeId) edgeStates[edgeId] = 'active';
      return { ...state, nodeStates, edgeStates, stepIndex: state.stepIndex + 1 };
    }

    default:
      return state;
  }
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function ArchitectureOverviewPage() {
  const [sim, dispatch] = useReducer(simReducer, INITIAL_STATE);
  const playTimerRef = useRef(null);
  const sseRef = useRef(null);

  // Auto-play ticker
  useEffect(() => {
    if (sim.playing && sim.mode !== 'live') {
      const delay = 1000 / sim.speed;
      playTimerRef.current = setTimeout(() => dispatch({ type: 'TICK' }), delay);
    }
    return () => clearTimeout(playTimerRef.current);
  }, [sim.playing, sim.mode, sim.speed, sim.stepIndex]);

  // SSE connection for Live Trace mode
  useEffect(() => {
    if (sim.mode !== 'live' || !sim.playing) {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      return;
    }
    const es = new EventSource('/api/arch-events');
    sseRef.current = es;
    es.addEventListener('arch-node', (ev) => {
      try {
        const { nodeId, edgeId } = JSON.parse(ev.data);
        dispatch({ type: 'LIVE_EVENT', nodeId, edgeId });
      } catch (_) {}
    });
    es.onerror = () => { es.close(); sseRef.current = null; };
    return () => { es.close(); sseRef.current = null; };
  }, [sim.mode, sim.playing]);

  const scenario = SCENARIO_MAP[sim.scenarioId];
  const totalSteps = scenario ? scenario.steps.length : 0;
  const currentStepDesc = (() => {
    if (sim.stepIndex === 0) return null;
    if (!scenario) return null;
    return scenario.steps[sim.stepIndex - 1]?.desc ?? null;
  })();
  const isComplete = sim.stepIndex > 0 && sim.stepIndex >= totalSteps && !sim.playing;

  const handlers = {
    onPlay:        useCallback(() => dispatch({ type: 'PLAY' }),                    []),
    onPause:       useCallback(() => dispatch({ type: 'PAUSE' }),                   []),
    onStep:        useCallback(() => dispatch({ type: 'STEP' }),                    []),
    onReset:       useCallback(() => dispatch({ type: 'RESET' }),                   []),
    onSetMode:     useCallback((mode) => dispatch({ type: 'SET_MODE', mode }),      []),
    onSetScenario: useCallback((id) => dispatch({ type: 'SET_SCENARIO', scenarioId: id }), []),
    onSetSpeed:    useCallback((speed) => dispatch({ type: 'SET_SPEED', speed }),   []),
  };

  return (
    <div style={{ padding: '1.5rem', background: '#f8fafc', minHeight: 'calc(100vh - 64px)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.25rem 0' }}>
            Architecture Overview
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#475569', margin: 0 }}>
            Interactive simulation of request flows through the banking demo system. For the step-by-step
            token-exchange walkthrough, see{' '}
            <a href="/sequence-diagram" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>
              /sequence-diagram
            </a>.
          </p>
        </div>

        <ArchitectureSimControls
          mode={sim.mode}
          scenarioId={sim.scenarioId}
          scenarios={SCENARIOS}
          playing={sim.playing}
          speed={sim.speed}
          stepIndex={sim.stepIndex}
          totalSteps={totalSteps}
          {...handlers}
        />

        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          overflow: 'auto',
          marginTop: '0.5rem',
        }}>
          <ArchitectureSimSvg
            nodeStates={sim.nodeStates}
            edgeStates={sim.edgeStates}
          />
        </div>

        <ArchitectureSimStepDesc
          stepIndex={sim.stepIndex}
          totalSteps={totalSteps}
          desc={currentStepDesc}
          isComplete={isComplete}
          mode={sim.mode}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to check for syntax errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: will fail with "Cannot find module ArchitectureSimSvg" — that's expected at this stage. Fix only if it's a *syntax* error in ArchitectureOverviewPage.js itself.

---

## Task 3: Step description bar

**Files:**
- Create: `demo_api_ui/src/components/ArchitectureSimStepDesc.jsx`

- [ ] **Step 1: Create the component**

```jsx
// demo_api_ui/src/components/ArchitectureSimStepDesc.jsx
import { memo } from 'react';

/**
 * Thin bar below the diagram showing the current step description.
 * Background turns green on completion.
 */
function ArchitectureSimStepDesc({ stepIndex, totalSteps, desc, isComplete, mode }) {
  if (mode === 'live' && stepIndex === 0) {
    return (
      <div style={barStyle(false)}>
        <span style={tagStyle('#64748b')}>LIVE</span>
        Waiting for real system events… trigger a login or MCP tool call in another tab.
      </div>
    );
  }

  if (stepIndex === 0) {
    return (
      <div style={barStyle(false)}>
        <span style={tagStyle('#64748b')}>READY</span>
        Select a scenario and press Play — or use Step to advance manually.
      </div>
    );
  }

  if (isComplete) {
    return (
      <div style={barStyle(true)}>
        <span style={tagStyle('#22c55e')}>DONE</span>
        Scenario complete. Press Reset to replay.
      </div>
    );
  }

  return (
    <div style={barStyle(false)}>
      <span style={tagStyle('#1d4ed8')}>STEP {stepIndex}/{totalSteps}</span>
      {desc}
    </div>
  );
}

function barStyle(done) {
  return {
    background: done ? '#f0fdf4' : '#eff6ff',
    border: `1px solid ${done ? '#bbf7d0' : '#bfdbfe'}`,
    borderTop: 'none',
    borderRadius: '0 0 6px 6px',
    padding: '0.45rem 0.8rem',
    fontSize: '0.8rem',
    color: done ? '#166534' : '#1e40af',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    minHeight: '2.2rem',
  };
}

function tagStyle(color) {
  return {
    background: color,
    color: '#fff',
    borderRadius: '3px',
    padding: '0.1rem 0.45rem',
    fontSize: '0.68rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
}

export default memo(ArchitectureSimStepDesc);
```

---

## Task 4: Controls toolbar

**Files:**
- Create: `demo_api_ui/src/components/ArchitectureSimControls.jsx`

- [ ] **Step 1: Create the component**

```jsx
// demo_api_ui/src/components/ArchitectureSimControls.jsx
import { memo } from 'react';
import { DiagramControls } from './diagram';

/**
 * Toolbar for the architecture simulation page.
 * Uses DiagramControls with mode tabs + scenario dropdown in the `extra` prop.
 * No zoom block — the SVG scales with the container.
 */
function ArchitectureSimControls({
  mode, scenarioId, scenarios, playing, speed, stepIndex, totalSteps,
  onPlay, onPause, onStep, onReset, onSetMode, onSetScenario, onSetSpeed,
}) {
  const MODES = [
    { id: 'scenario',  label: 'Scenario' },
    { id: 'step',      label: 'Step-through' },
    { id: 'live',      label: 'Live trace' },
  ];

  const SPEEDS = [
    { value: 0.5, label: '0.5×' },
    { value: 1,   label: '1×' },
    { value: 2,   label: '2×' },
  ];

  const showScenarioDropdown = mode === 'scenario';
  const atEnd = stepIndex >= totalSteps && totalSteps > 0;

  const extra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      {/* Mode tabs */}
      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>Mode:</span>
      <div style={{ display: 'flex', gap: '2px' }}>
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSetMode(m.id)}
            style={{
              fontSize: '0.72rem',
              padding: '0.2rem 0.55rem',
              border: '1px solid',
              borderRadius: '3px',
              cursor: 'pointer',
              background: mode === m.id ? '#1d4ed8' : '#f1f5f9',
              borderColor: mode === m.id ? '#1d4ed8' : '#cbd5e1',
              color: mode === m.id ? '#fff' : '#475569',
              fontWeight: mode === m.id ? 700 : 400,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Scenario dropdown — only in scenario mode */}
      {showScenarioDropdown && (
        <>
          <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>Scenario:</span>
          <select
            value={scenarioId}
            onChange={e => onSetScenario(e.target.value)}
            style={{
              fontSize: '0.78rem',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              padding: '0.22rem 0.5rem',
              background: '#f8fafc',
              color: '#0f172a',
            }}
          >
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </>
      )}

      {/* Playback controls */}
      <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }} />
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        style={ctrlBtn(playing ? '#f59e0b' : '#004687')}
        disabled={mode === 'live' && atEnd}
      >
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>
      {mode !== 'live' && (
        <button type="button" onClick={onStep} style={ctrlBtn('#004687')} disabled={playing || atEnd}>
          ⏭ Step
        </button>
      )}
      <button type="button" onClick={onReset} style={ctrlBtn(null)}>
        ↺ Reset
      </button>

      {/* Speed selector — not shown in live mode */}
      {mode !== 'live' && (
        <>
          <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }} />
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Speed:</span>
          <select
            value={speed}
            onChange={e => onSetSpeed(Number(e.target.value))}
            style={{ fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '0.22rem 0.4rem', background: '#f8fafc' }}
          >
            {SPEEDS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </>
      )}

      {/* Step counter */}
      {totalSteps > 0 && (
        <span style={{ fontSize: '0.72rem', color: '#475569', marginLeft: '0.25rem' }}>
          {stepIndex}/{totalSteps}
        </span>
      )}
    </div>
  );

  // DiagramControls with no zoom props — only the extra content rendered
  return <DiagramControls extra={extra} />;
}

function ctrlBtn(bgColor) {
  return {
    fontSize: '0.78rem',
    fontWeight: 600,
    padding: '0.25rem 0.7rem',
    border: '1px solid',
    borderRadius: '4px',
    cursor: 'pointer',
    background: bgColor ?? '#ffffff',
    borderColor: bgColor ?? '#cbd5e1',
    color: bgColor ? '#ffffff' : '#0f172a',
  };
}

export default memo(ArchitectureSimControls);
```

---

## Task 5: SVG diagram

**Files:**
- Create: `demo_api_ui/src/components/ArchitectureSimSvg.jsx`

This is the largest task — the full hand-coded SVG with all 11 nodes and all edges.

- [ ] **Step 1: Create ArchitectureSimSvg.jsx**

```jsx
// demo_api_ui/src/components/ArchitectureSimSvg.jsx
import { memo } from 'react';

/**
 * Hand-coded SVG architecture diagram for the simulation page.
 *
 * viewBox: 0 0 1100 520
 * Node size: 130 × 52 px
 * Label font: 13px bold (name) + 10px (subtitle)
 *
 * Node IDs match architecture-sim-scenarios.js:
 *   n-browser, n-bff, n-mcp-gw, n-mcp-server, n-mcp-invest,
 *   n-agent, n-pingone, n-pingauthorize, n-hitl, n-mortgage, n-resource-server
 *
 * Edge IDs: e-{source}-{dest} e.g. e-browser-bff, e-bff-mcpgw, …
 */

// ── Layout constants ─────────────────────────────────────────────────────────
const NW = 130;  // node width
const NH = 52;   // node height
const NR = 7;    // border-radius

// Column x-origins
const COL = {
  browser:  20,
  bff:      200,
  mcpGw:    400,
  services: 620,
  external: 830,
};

// Row y-origins
const ROW = {
  top:    30,
  mid:   180,
  lower: 330,
  bot:   420,
};

// Node centre helpers
function cx(x) { return x + NW / 2; }
function cy(y) { return y + NH / 2; }

// ── Colour palette ───────────────────────────────────────────────────────────
const STATE_STYLES = {
  idle: {
    fill: '#f1f5f9', stroke: '#cbd5e1', textFill: '#475569',
    shadow: 'none',
  },
  active: {
    fill: '#fffbeb', stroke: '#f59e0b', textFill: '#92400e',
    shadow: 'drop-shadow(0 0 8px rgba(245,158,11,0.6))',
  },
  done: {
    fill: '#f0fdf4', stroke: '#22c55e', textFill: '#166534',
    shadow: 'none',
  },
};

const EDGE_COLORS = {
  idle:   '#cbd5e1',
  active: '#f59e0b',
  done:   '#22c55e',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SimNode({ id, x, y, label, sub, state = 'idle' }) {
  const s = STATE_STYLES[state] ?? STATE_STYLES.idle;
  const isActive = state === 'active';
  const isDone   = state === 'done';

  return (
    <g id={id} style={{ filter: isActive ? s.shadow : 'none' }}>
      <rect
        x={x} y={y} width={NW} height={NH} rx={NR} ry={NR}
        fill={s.fill} stroke={s.stroke} strokeWidth={isActive || isDone ? 2 : 1.5}
      >
        {isActive && (
          <animate
            attributeName="stroke-opacity"
            values="1;0.4;1" dur="1s"
            repeatCount="indefinite"
          />
        )}
      </rect>
      <text x={cx(x)} y={y + (sub ? 20 : 28)} textAnchor="middle"
            fontSize={13} fontWeight={700} fill={s.textFill} fontFamily="system-ui,sans-serif">
        {label}
      </text>
      {sub && (
        <text x={cx(x)} y={y + 37} textAnchor="middle"
              fontSize={10} fill={s.textFill} fontFamily="system-ui,sans-serif" opacity={0.8}>
          {sub}
        </text>
      )}
      {isDone && (
        <text x={x + NW - 4} y={y - 2} fontSize={13} textAnchor="end">✅</text>
      )}
    </g>
  );
}

function SimEdge({ id, x1, y1, x2, y2, state = 'idle', markerId }) {
  const color = EDGE_COLORS[state] ?? EDGE_COLORS.idle;
  const isActive = state === 'active';

  // Length for dash animation
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  return (
    <line
      id={id}
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color} strokeWidth={isActive ? 2.5 : 1.5}
      markerEnd={`url(#${markerId})`}
      strokeDasharray={isActive ? len : undefined}
      strokeDashoffset={isActive ? len : undefined}
    >
      {isActive && (
        <animate
          attributeName="stroke-dashoffset"
          from={len} to={0}
          dur="0.7s"
          fill="freeze"
          key={`${id}-sweep`}
        />
      )}
    </line>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ArchitectureSimSvg({ nodeStates = {}, edgeStates = {} }) {
  function ns(id) { return nodeStates[id] ?? 'idle'; }
  function es(id) { return edgeStates[id] ?? 'idle'; }

  // Arrowhead colour helpers
  function arrowId(state) {
    return state === 'active' ? 'arr-active' : state === 'done' ? 'arr-done' : 'arr-idle';
  }

  return (
    <svg
      viewBox="0 0 1100 520"
      width="100%"
      style={{ display: 'block', minWidth: 700 }}
      aria-label="Banking demo architecture diagram"
    >
      <defs>
        <marker id="arr-idle"   markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.idle}/>
        </marker>
        <marker id="arr-active" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.active}/>
        </marker>
        <marker id="arr-done"   markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.done}/>
        </marker>
      </defs>

      {/* ── Background labels ───────────────────────────────────────── */}
      <text x={cx(COL.browser)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">Client</text>
      <text x={cx(COL.bff)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">BFF</text>
      <text x={cx(COL.mcpGw)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">MCP Layer</text>
      <text x={cx(COL.services)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">Services</text>
      <text x={cx(COL.external)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">PingOne / External</text>

      {/* ── Edges (drawn behind nodes) ─────────────────────────────── */}
      {/* browser ↔ bff */}
      <SimEdge id="e-browser-bff"
        x1={COL.browser + NW} y1={cy(ROW.top)}
        x2={COL.bff}          y2={cy(ROW.top)}
        state={es('e-browser-bff')} markerId={arrowId(es('e-browser-bff'))} />

      {/* bff → mcp-gw */}
      <SimEdge id="e-bff-mcpgw"
        x1={COL.bff + NW}  y1={cy(ROW.top)}
        x2={COL.mcpGw}     y2={cy(ROW.top)}
        state={es('e-bff-mcpgw')} markerId={arrowId(es('e-bff-mcpgw'))} />

      {/* mcp-gw → mcp-server */}
      <SimEdge id="e-mcpgw-mcpserver"
        x1={COL.mcpGw + NW}   y1={cy(ROW.top)}
        x2={COL.services}      y2={cy(ROW.top)}
        state={es('e-mcpgw-mcpserver')} markerId={arrowId(es('e-mcpgw-mcpserver'))} />

      {/* mcp-gw → mortgage (lower row) */}
      <SimEdge id="e-mcpgw-mortgage"
        x1={cx(COL.mcpGw)}  y1={ROW.top + NH}
        x2={cx(COL.mcpGw)}  y2={ROW.mid}
        state={es('e-mcpgw-mortgage')} markerId={arrowId(es('e-mcpgw-mortgage'))} />
      <SimEdge id="e-mcpgw-mortgage-h"
        x1={cx(COL.mcpGw)}  y1={cy(ROW.mid)}
        x2={COL.services}   y2={cy(ROW.mid)}
        state={es('e-mcpgw-mortgage')} markerId={arrowId(es('e-mcpgw-mortgage'))} />

      {/* mcp-gw → resource-server */}
      <SimEdge id="e-mcpgw-resourceserver"
        x1={COL.mcpGw + NW}   y1={cy(ROW.lower)}
        x2={COL.services}      y2={cy(ROW.lower)}
        state={es('e-mcpgw-resourceserver')} markerId={arrowId(es('e-mcpgw-resourceserver'))} />

      {/* bff → pingone (vertical) */}
      <SimEdge id="e-bff-pingone"
        x1={cx(COL.bff)}   y1={ROW.top + NH}
        x2={cx(COL.bff)}   y2={ROW.mid}
        state={es('e-bff-pingone')} markerId={arrowId(es('e-bff-pingone'))} />
      <SimEdge id="e-bff-pingone-h"
        x1={cx(COL.bff)}     y1={cy(ROW.mid)}
        x2={COL.external}    y2={cy(ROW.mid)}
        state={es('e-bff-pingone')} markerId={arrowId(es('e-bff-pingone'))} />

      {/* mcp-gw → pingone */}
      <SimEdge id="e-mcpgw-pingone"
        x1={cx(COL.mcpGw)}  y1={ROW.top + NH}
        x2={cx(COL.mcpGw)}  y2={ROW.mid + 15}
        state={es('e-mcpgw-pingone')} markerId={arrowId(es('e-mcpgw-pingone'))} />
      <SimEdge id="e-mcpgw-pingone-h"
        x1={cx(COL.mcpGw)}   y1={cy(ROW.mid) + 15}
        x2={COL.external}    y2={cy(ROW.mid) + 15}
        state={es('e-mcpgw-pingone')} markerId={arrowId(es('e-mcpgw-pingone'))} />

      {/* bff → pingauthorize */}
      <SimEdge id="e-bff-pingauth"
        x1={cx(COL.bff)}  y1={ROW.top + NH}
        x2={cx(COL.bff)}  y2={ROW.lower}
        state={es('e-bff-pingauth')} markerId={arrowId(es('e-bff-pingauth'))} />
      <SimEdge id="e-bff-pingauth-h"
        x1={cx(COL.bff)}    y1={cy(ROW.lower)}
        x2={COL.external}   y2={cy(ROW.lower)}
        state={es('e-bff-pingauth')} markerId={arrowId(es('e-bff-pingauth'))} />

      {/* bff → hitl */}
      <SimEdge id="e-bff-hitl"
        x1={cx(COL.bff)}  y1={ROW.top + NH}
        x2={cx(COL.bff)}  y2={ROW.bot}
        state={es('e-bff-hitl')} markerId={arrowId(es('e-bff-hitl'))} />
      <SimEdge id="e-bff-hitl-h"
        x1={cx(COL.bff)}    y1={cy(ROW.bot)}
        x2={COL.services}   y2={cy(ROW.bot)}
        state={es('e-bff-hitl')} markerId={arrowId(es('e-bff-hitl'))} />

      {/* ── Nodes ──────────────────────────────────────────────────── */}
      {/* Row 1: main request path */}
      <SimNode id="n-browser"  x={COL.browser}  y={ROW.top} label="Browser"       sub="port 4000"             state={ns('n-browser')} />
      <SimNode id="n-bff"      x={COL.bff}      y={ROW.top} label="BFF"           sub="demo_api_server :3001"  state={ns('n-bff')} />
      <SimNode id="n-mcp-gw"   x={COL.mcpGw}   y={ROW.top} label="MCP Gateway"   sub=":3005"                  state={ns('n-mcp-gw')} />
      <SimNode id="n-mcp-server" x={COL.services} y={ROW.top} label="MCP Server"  sub=":8080"                  state={ns('n-mcp-server')} />

      {/* Row 2: parallel services */}
      <SimNode id="n-agent"      x={COL.mcpGw}    y={ROW.mid} label="Agent Service" sub=":3006 / :8888"         state={ns('n-agent')} />
      <SimNode id="n-mcp-invest" x={COL.services} y={ROW.mid} label="MCP Invest"    sub=":8081"                 state={ns('n-mcp-invest')} />
      <SimNode id="n-mortgage"   x={COL.services} y={ROW.mid + NH + 10} label="Mortgage Svc" sub=":8082"        state={ns('n-mortgage')} />
      <SimNode id="n-pingone"    x={COL.external} y={ROW.mid} label="PingOne"        sub="OAuth AS"              state={ns('n-pingone')} />

      {/* Row 3: lower services */}
      <SimNode id="n-resource-server" x={COL.services} y={ROW.lower} label="Resource Server" sub=":3001"        state={ns('n-resource-server')} />
      <SimNode id="n-pingauthorize"   x={COL.external} y={ROW.lower} label="PingAuthorize"   sub="PDP"          state={ns('n-pingauthorize')} />

      {/* Row 4: HITL */}
      <SimNode id="n-hitl" x={COL.services} y={ROW.bot} label="HITL Service" sub=":3009"                       state={ns('n-hitl')} />
    </svg>
  );
}

export default memo(ArchitectureSimSvg);
```

- [ ] **Step 2: Build the UI — must exit 0**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -30
```

Expected: `Compiled successfully.` (exit 0). Fix any JSX/import errors before continuing.

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/ArchitectureOverviewPage.js \
        demo_api_ui/src/components/ArchitectureSimSvg.jsx \
        demo_api_ui/src/components/ArchitectureSimControls.jsx \
        demo_api_ui/src/components/ArchitectureSimStepDesc.jsx \
        demo_api_ui/src/config/architecture-sim-scenarios.js
git commit -m "feat(arch-sim): hand-coded SVG diagram + scenario/step simulation modes"
```

---

## Task 6: BFF — arch event emitter + SSE route

**Files:**
- Create: `demo_api_server/services/archEventEmitter.js`
- Create: `demo_api_server/routes/archEvents.js`
- Modify: `demo_api_server/server.js` (one line — register route)

- [ ] **Step 1: Create the singleton emitter**

```js
// demo_api_server/services/archEventEmitter.js
'use strict';

/**
 * Singleton EventEmitter for architecture diagram live trace events.
 *
 * Usage in any route handler:
 *   const archEmit = require('../services/archEventEmitter');
 *   archEmit({ nodeId: 'n-bff', edgeId: 'e-browser-bff', label: 'OAuth callback received' });
 *
 * The SSE route (routes/archEvents.js) subscribes to 'arch-node' events
 * and streams them to connected browser clients.
 *
 * If no clients are connected, emit() is a no-op (the EventEmitter just has no listeners).
 */

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(50); // up to 50 concurrent SSE clients

/**
 * Emit an arch event. Silently no-ops if there are no SSE subscribers.
 * @param {object} payload
 * @param {string}  payload.nodeId   - e.g. 'n-bff'
 * @param {string} [payload.edgeId]  - e.g. 'e-browser-bff' (optional)
 * @param {string} [payload.label]   - human-readable description (optional)
 */
function archEmit({ nodeId, edgeId, label } = {}) {
  if (!nodeId) return;
  emitter.emit('arch-node', { nodeId, edgeId, label });
}

archEmit.emitter = emitter; // expose raw emitter for the SSE route to subscribe
module.exports = archEmit;
```

- [ ] **Step 2: Create the SSE route**

```js
// demo_api_server/routes/archEvents.js
'use strict';

/**
 * GET /api/arch-events
 *
 * Server-Sent Events stream for the architecture simulation Live Trace mode.
 * Emits events of type 'arch-node' when real system activity occurs.
 *
 * Auth: session cookie (authenticateToken middleware applied at mount point).
 * Format: text/event-stream (standard SSE).
 *
 * Event format:
 *   event: arch-node
 *   data: {"nodeId":"n-bff","edgeId":"e-browser-bff","label":"OAuth callback received"}
 *
 * The BFF keeps the connection alive with a comment ping every 20 seconds.
 * Clients reconnect automatically via the EventSource API.
 */

const express = require('express');
const archEmit = require('../services/archEventEmitter');

const router = express.Router();

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
  res.flushHeaders();

  // Send an initial connected event so the client knows the stream is live
  res.write('event: arch-connected\ndata: {"status":"connected"}\n\n');

  function onEvent({ nodeId, edgeId, label }) {
    const payload = JSON.stringify({ nodeId, edgeId: edgeId ?? null, label: label ?? null });
    res.write(`event: arch-node\ndata: ${payload}\n\n`);
  }

  archEmit.emitter.on('arch-node', onEvent);

  // Keep-alive ping every 20 s (prevents idle connection timeout)
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 20_000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    archEmit.emitter.off('arch-node', onEvent);
  });
});

module.exports = router;
```

- [ ] **Step 3: Register the route in server.js**

Find this block in `demo_api_server/server.js` (near line 962 where `diagramsRoutes` is mounted):

```js
app.use('/api/admin/diagrams', authenticateToken, diagramsRoutes);
```

Add immediately after it:

```js
const archEventsRoutes = require('./routes/archEvents');
app.use('/api/arch-events', authenticateToken, archEventsRoutes);
```

- [ ] **Step 4: Verify server starts without errors**

```bash
cd demo_api_server && node -e "require('./server.js')" 2>&1 | head -20
```

Expected: startup log lines, no `Error` or `Cannot find module`.

Kill the process (Ctrl+C) — this is just a syntax/require check.

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/services/archEventEmitter.js \
        demo_api_server/routes/archEvents.js \
        demo_api_server/server.js
git commit -m "feat(arch-sim): BFF SSE endpoint /api/arch-events for live trace mode"
```

---

## Task 7: Wire live trace events into existing BFF routes

**Files:**
- Modify: `demo_api_server/routes/oauth.js` (additive only — emit calls)
- Modify: `demo_api_server/routes/mcpInspector.js` (additive only — emit calls)

> ⚠️ These files are in `REGRESSION_PLAN.md` §1. Changes are **additive only** — require one new line at the top of each file and 2–3 `archEmit()` calls. No logic changes.

- [ ] **Step 1: Add emit to oauth.js**

Open `demo_api_server/routes/oauth.js`. At the top of the file, after the existing `require` statements, add:

```js
const archEmit = require('../services/archEventEmitter');
```

Then find the OAuth callback handler — the route that handles the `code` exchange (look for `req.query.code` or `grant_type: 'authorization_code'`). After a successful token response is received, add:

```js
archEmit({ nodeId: 'n-bff', edgeId: 'e-browser-bff', label: 'OAuth callback: code exchange complete' });
```

And after the session is set (look for `req.session.` assignments):

```js
archEmit({ nodeId: 'n-pingone', edgeId: 'e-bff-pingone', label: 'PingOne issued access + ID token' });
```

- [ ] **Step 2: Add emit to mcpInspector.js**

Open `demo_api_server/routes/mcpInspector.js`. Add at top:

```js
const archEmit = require('../services/archEventEmitter');
```

Find the route that forwards a tool invocation to the MCP server (look for `tools/call` or `mcpWebSocketClient`). Before forwarding:

```js
archEmit({ nodeId: 'n-mcp-gw', edgeId: 'e-bff-mcpgw', label: 'MCP tool call dispatched to gateway' });
```

After a successful tool result:

```js
archEmit({ nodeId: 'n-mcp-server', edgeId: 'e-mcpgw-mcpserver', label: 'MCP Server executed tool' });
```

- [ ] **Step 3: Run the existing regression tests to confirm no logic change**

```bash
cd demo_api_server && npx jest oauthStatus.regression oauthStatus.integration hitlRoute.regression hitlRoute.integration 2>&1 | tail -20
```

Expected: all tests pass (same output as before this task).

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/routes/oauth.js demo_api_server/routes/mcpInspector.js
git commit -m "feat(arch-sim): emit live trace events from OAuth callback + MCP inspector"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full UI build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.` (exit 0)

- [ ] **Step 2: Start services and smoke-test Scenario mode**

```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh
```

Open `https://api.ping.demo:4000/architecture/overview`.

Verify:
- Page loads with no console errors
- Nodes are visible and readable without zooming (labels ≥ 13px)
- Select "OAuth Login (PKCE)" → press ▶ Play → nodes pulse amber → turn green ✅ in sequence
- Press ↺ Reset → all nodes return to idle grey

- [ ] **Step 3: Smoke-test Step-through mode**

- Click "Step-through" mode tab
- Press ⏭ Step repeatedly — each press advances exactly one node/edge
- Press ↺ Reset — all nodes return to idle

- [ ] **Step 4: Smoke-test Live Trace mode**

- Click "Live trace" mode tab → press ▶ Play
- In a second tab, log in via `https://api.ping.demo:4000`
- Verify that `n-browser`, `n-bff`, `n-pingone` nodes light up in the simulation tab
- Press ↺ Reset to clear

- [ ] **Step 5: Regression check — other diagram pages still work**

Navigate to:
- `/architecture` (ArchitectureDiagramPage) — verify zoom + simulate still works
- `/sequence-diagram` (SequenceDiagramPage) — verify play/step/stop work
- `/admin/hitl-sequence` (HitlSequenceDiagram) — verify scenario dropdown + simulation works

- [ ] **Step 6: Final commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add -A
git commit -m "feat(arch-sim): architecture simulation complete — all 3 modes verified"
```

---

## Self-Review

**Spec coverage:**
- ✅ Hand-coded SVG (`viewBox="0 0 1100 520"`, nodes 130×52px, 13px labels) → Task 5
- ✅ All 11 nodes with correct IDs → Task 5
- ✅ Node active = amber pulse → Task 5 `STATE_STYLES.active` + `<animate>`
- ✅ Node done = green + ✅ badge → Task 5 `STATE_STYLES.done` + badge `<text>`
- ✅ Edge active = colour sweep (stroke-dashoffset animate) → Task 5 `SimEdge`
- ✅ Edge done = green static → Task 5
- ✅ Scenario mode with 8 scenarios → Tasks 1 + 4
- ✅ Step-through mode → Task 2 reducer `STEP` action
- ✅ Live trace mode via SSE → Tasks 6 + 7
- ✅ Top toolbar via `DiagramControls extra` prop → Task 4
- ✅ Step description bar → Task 3
- ✅ Speed control (0.5×/1×/2×) → Tasks 2 + 4
- ✅ Zoom removed (SVG scales) → Task 4 (no zoom props passed)
- ✅ BFF SSE endpoint `/api/arch-events` → Task 6
- ✅ `archEventEmitter` singleton → Task 6
- ✅ Additive-only emit in oauth.js + mcpInspector.js → Task 7
- ✅ Regression tests still pass → Task 7 Step 3
- ✅ `npm run build` exits 0 → Tasks 5 + 8
- ✅ Route stays `/architecture/overview` → no route change in plan
- ✅ `diagram-overview-regions.js` untouched → not in file map

**Placeholder scan:** No TBDs, no "implement later", all code blocks are complete.

**Type consistency:**
- `archEmit` called identically in Tasks 6, 7
- `SimEdge` `markerId` prop used consistently — `arrowId()` helper produces correct IDs
- Scenario `nodes`/`edges` arrays use the same IDs as SVG `id` attributes
- `useSimulation` reducer actions (`PLAY`, `PAUSE`, `STEP`, `RESET`, `TICK`, `LIVE_EVENT`, `SET_MODE`, `SET_SCENARIO`, `SET_SPEED`) all handled in `simReducer` switch
