// demo_api_ui/src/components/ArchitectureOverviewPage.js
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { DEFAULT_SCENARIO_ID, SCENARIO_MAP, SCENARIOS } from '../config/architecture-sim-scenarios';
import ArchitectureSimControls from './ArchitectureSimControls';
import ArchitectureSimStepDesc from './ArchitectureSimStepDesc';
import ArchitectureSimSvg from './ArchitectureSimSvg';

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

    case 'SET_SPEED':
      return { ...state, speed: action.speed };

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
  }, [sim.playing, sim.mode, sim.speed]);

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
          borderRadius: '6px 6px 0 0',
          overflow: 'auto',
          marginTop: '0.5rem',
        }}>
          <ArchitectureSimSvg
            nodeStates={sim.nodeStates}
            edgeStates={sim.edgeStates}
          />
        </div>

        {/* Colour legend */}
        <div style={{
          display: 'flex',
          gap: '1.25rem',
          padding: '0.3rem 0.8rem',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderTop: 'none',
          fontSize: '0.75rem',
          color: '#64748b',
          flexWrap: 'wrap',
        }}>
          {[
            { bg: '#f1f5f9', border: '#cbd5e1', label: 'Idle' },
            { bg: '#fffbeb', border: '#f59e0b', label: 'Active request' },
            { bg: '#f0fdf4', border: '#22c55e', label: 'Completed' },
            { bg: '#fef2f2', border: '#ef4444', label: 'Blocked / Denied' },
          ].map(({ bg, border, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{
                display: 'inline-block',
                width: 11, height: 11,
                borderRadius: 2,
                background: bg,
                border: `2px solid ${border}`,
                flexShrink: 0,
              }} />
              {label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Hover any node for details</span>
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
      </div>
    </div>
  );
}
