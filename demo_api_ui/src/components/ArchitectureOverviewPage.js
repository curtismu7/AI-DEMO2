// demo_api_ui/src/components/ArchitectureOverviewPage.js
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { DEFAULT_SCENARIO_ID, SCENARIO_MAP, SCENARIOS } from '../config/architecture-sim-scenarios';
import { DEFAULT_STEP_MS, STEP_TIME_OPTIONS } from './diagram';
import ArchitectureSimControls from './ArchitectureSimControls';
import ArchitectureSimStepDesc from './ArchitectureSimStepDesc';
import ArchitectureSimSvg from './ArchitectureSimSvg';
import DiagramExportBar from './DiagramExportBar';
import { useThemeOptional } from '../context/ThemeContext';
import './ArchitectureOverviewPage.css';

// ─── State machine ───────────────────────────────────────────────────────────

const INITIAL_STATE = {
  mode: 'scenario',            // 'scenario' | 'step' | 'live'
  scenarioId: DEFAULT_SCENARIO_ID,
  stepIndex: 0,                // 0 = not started; 1..n = step number
  playing: false,
  stepMs: DEFAULT_STEP_MS,      // dwell time per step, in ms (shared STEP_TIME_OPTIONS)
  nodeStates: {},              // { [nodeId]: 'idle' | 'active' | 'done' }
  edgeStates: {},              // { [edgeId]: 'idle' | 'active' | 'done' }
};

function advanceState(state, steps) {
  const nodeStates = { ...state.nodeStates };
  const edgeStates = { ...state.edgeStates };

  // Promote active → done; 'blocked' stays blocked (red — marks an attack stop point)
  for (const id of Object.keys(nodeStates)) {
    if (nodeStates[id] === 'active') nodeStates[id] = 'done';
  }
  for (const id of Object.keys(edgeStates)) {
    if (edgeStates[id] === 'active') edgeStates[id] = 'done';
  }

  const stepIdx = state.stepIndex;
  if (stepIdx >= steps.length) return { ...state, playing: false, nodeStates, edgeStates };

  const step = steps[stepIdx];
  step.nodes.forEach(id => { nodeStates[id] = 'active'; });
  step.edges.forEach(id => { edgeStates[id] = 'active'; });
  step.blocked?.forEach(id => { nodeStates[id] = 'blocked'; });

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

    case 'SET_STEP_MS':
      return { ...state, stepMs: action.stepMs };

    case 'PLAY': {
      if (state.mode === 'live') return { ...state, playing: true };
      const scenario = SCENARIO_MAP[state.scenarioId];
      if (!scenario) return state;
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
      const scenario = SCENARIO_MAP[state.scenarioId];
      if (!scenario) return { ...state, playing: false };
      if (state.stepIndex >= scenario.steps.length) {
        return { ...state, playing: false };
      }
      return advanceState(state, scenario.steps);
    }

    case 'LIVE_EVENT': {
      const { nodeId, edgeId } = action;
      const nodeStates = { ...state.nodeStates };
      const edgeStates = { ...state.edgeStates };
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
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [sim, dispatch] = useReducer(simReducer, INITIAL_STATE);
  const playTimerRef = useRef(null);
  const sseRef = useRef(null);

  // Auto-play ticker
  useEffect(() => {
    if (sim.playing && sim.mode !== 'live') {
      const delay = sim.stepMs;
      playTimerRef.current = setTimeout(() => dispatch({ type: 'TICK' }), delay);
    }
    return () => clearTimeout(playTimerRef.current);
  }, [sim.playing, sim.mode, sim.stepMs]);

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
  const currentStepWhy = (() => {
    if (sim.stepIndex === 0) return null;
    if (!scenario) return null;
    return scenario.steps[sim.stepIndex - 1]?.why ?? null;
  })();
  const currentStepIsBlock = (() => {
    if (!scenario) return false;
    // When complete, check the last step; otherwise check the current step
    const idx = sim.stepIndex >= totalSteps ? totalSteps - 1 : sim.stepIndex - 1;
    return scenario.steps[idx]?.isBlock ?? false;
  })();
  const isComplete = sim.stepIndex > 0 && sim.stepIndex >= totalSteps && !sim.playing;

  const handlers = {
    onPlay:        useCallback(() => dispatch({ type: 'PLAY' }),                    []),
    onPause:       useCallback(() => dispatch({ type: 'PAUSE' }),                   []),
    onStep:        useCallback(() => dispatch({ type: 'STEP' }),                    []),
    onReset:       useCallback(() => dispatch({ type: 'RESET' }),                   []),
    onSetMode:     useCallback((mode) => dispatch({ type: 'SET_MODE', mode }),      []),
    onSetScenario: useCallback((id) => dispatch({ type: 'SET_SCENARIO', scenarioId: id }), []),
    onSetStepMs:   useCallback((stepMs) => dispatch({ type: 'SET_STEP_MS', stepMs }), []),
  };

  return (
    <div className="aov-page">
      <div className="aov-inner">
        <div className="aov-header-row">
          <div>
            <h1>Architecture Overview</h1>
            <p className="aov-subtitle">
              Interactive simulation of request flows through the banking demo system. For the step-by-step
              token-exchange walkthrough, see{' '}
              <a href="/sequence-diagram">
                /sequence-diagram
              </a>.
            </p>
          </div>
          <button
            type="button"
            className="aov-theme-toggle"
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        </div>

        <ArchitectureSimControls
          mode={sim.mode}
          scenarioId={sim.scenarioId}
          scenarios={SCENARIOS}
          playing={sim.playing}
          stepMs={sim.stepMs}
          stepTimeOptions={STEP_TIME_OPTIONS}
          stepIndex={sim.stepIndex}
          totalSteps={totalSteps}
          {...handlers}
        />

        <div className="aov-diagram-wrap">
          <ArchitectureSimSvg
            nodeStates={sim.nodeStates}
            edgeStates={sim.edgeStates}
          />
        </div>

        {/* Colour legend — matches ArchitectureSimSvg's own node-state
            palette, so it stays its own fixed colors regardless of theme. */}
        <div className="aov-legend">
          {[
            { bg: '#f1f5f9', border: '#cbd5e1', label: 'Idle' },
            { bg: '#fffbeb', border: '#f59e0b', label: 'Active request' },
            { bg: '#f0fdf4', border: '#22c55e', label: 'Completed' },
            { bg: '#fef2f2', border: '#ef4444', label: 'Blocked / Denied' },
          ].map(({ bg, border, label }) => (
            <span key={label} className="aov-legend-item">
              <span
                className="aov-legend-swatch"
                style={{ background: bg, border: `2px solid ${border}` }}
              />
              {label}
            </span>
          ))}
          <span className="aov-legend-hint">Hover any node for details</span>
        </div>

        <ArchitectureSimStepDesc
          stepIndex={sim.stepIndex}
          totalSteps={totalSteps}
          desc={currentStepDesc}
          why={currentStepWhy}
          isBlock={currentStepIsBlock}
          isComplete={isComplete}
          mode={sim.mode}
          allSteps={scenario?.steps}
        />

        {/* Downloads of the equivalent clean-view diagram (architecture-simple.mmd) */}
        <DiagramExportBar
          items={[
            { label: 'Mermaid (.mmd)', href: '/architecture/architecture-simple.mmd' },
            { label: 'PNG', href: '/architecture/overview.png' },
            { label: 'draw.io / Lucid (.drawio)', href: '/architecture/architecture-simple.drawio' },
          ]}
        />
      </div>
    </div>
  );
}
