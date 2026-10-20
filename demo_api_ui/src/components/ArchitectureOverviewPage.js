// demo_api_ui/src/components/ArchitectureOverviewPage.js
// /architecture/overview: the whole-system diagram in the Ping style (StaticFlowDiagram pingStyle + a page-owned walk, the
// way the use-case diagrams run). A scenario is a walk: each step rings its boxes and runs the dashed line along its arrows,
// and the movie reel under the diagram carries the step text and its "why". Live trace appends one beat per system event.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_SCENARIO_ID, SCENARIO_MAP, SCENARIOS } from '../config/architecture-sim-scenarios';
import {
  OVERVIEW_EDGES, OVERVIEW_GROUPS, OVERVIEW_NODES, buildOverviewWalk, liveOverviewBeat,
} from '../config/architectureOverviewDiagram';
import { useDiagramStepper } from '../hooks/useDiagramStepper';
import { useVertical } from '../vertical/useVertical';
import DiagramExportBar from './DiagramExportBar';
import DiagramStepBar from './DiagramStepBar';
import StaticFlowDiagram from './StaticFlowDiagram';
import './ArchitectureOverviewPage.css';

const MODES = [
  { id: 'scenario', label: 'Scenario' },
  { id: 'live', label: 'Live trace' },
];

const NODE_BY_ID = Object.fromEntries(OVERVIEW_NODES.map((n) => [n.id, n]));

// One <optgroup> per scenario group (Flows, Attacks), in the order the scenarios list them.
const SCENARIO_GROUPS = Object.entries(
  SCENARIOS.reduce((groups, s) => {
    (groups[s.group || 'Other'] ||= []).push(s);
    return groups;
  }, {}),
);

export default function ArchitectureOverviewPage() {
  const { activeId, pageManifest } = useVertical();
  const verticalName = activeId === 'banking'
    ? 'Banking'
    : pageManifest?.identity?.displayName || 'Banking';
  const [mode, setMode] = useState('scenario');
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [liveBeats, setLiveBeats] = useState([]);
  const [pickedId, setPickedId] = useState(null);

  const scenario = SCENARIO_MAP[scenarioId];
  const scenarioWalk = useMemo(() => buildOverviewWalk(scenario), [scenario]);
  const walk = mode === 'live' ? liveBeats : scenarioWalk;
  const stepper = useDiagramStepper(walk.length);
  const { stop, goTo } = stepper;

  // A new scenario or mode is a new story: back to the plain diagram.
  useEffect(() => { stop(); }, [mode, scenarioId, stop]);

  // Live trace: one beat per event the BFF streams.
  useEffect(() => {
    if (mode !== 'live') return undefined;
    setLiveBeats([]);
    const es = new EventSource('/api/arch-events');
    es.addEventListener('arch-node', (ev) => {
      try {
        setLiveBeats((beats) => [...beats, liveOverviewBeat(JSON.parse(ev.data))]);
      } catch (_) { /* a malformed event is skipped */ }
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [mode]);
  // ...and the diagram follows the newest one.
  useEffect(() => {
    if (mode === 'live' && liveBeats.length) goTo(liveBeats.length - 1);
  }, [mode, liveBeats.length, goTo]);

  const onNodeClick = useCallback((node) => setPickedId((prev) => (prev === node.id ? null : node.id)), []);
  const picked = pickedId ? NODE_BY_ID[pickedId] : null;

  return (
    <div className="aov-page">
      <div className="aov-inner">
        <div className="aov-header-row">
          <div>
            <h1>PingOne AI {verticalName} Architecture</h1>
            <p className="aov-subtitle">
              Run the complete request path across PingOne, PingGateway, the BFF vault, agents, and protected
              resource servers. Choose a flow, then Simulate it or step through it. For deeper token-exchange details, see{' '}
              <a href="/sequence-diagram" target="_blank" rel="noopener noreferrer">
                /sequence-diagram
              </a>.
            </p>
          </div>
        </div>

        <div className="aov-controls">
          <div className="aov-modes" role="group" aria-label="Mode">
            {MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'scenario' && (
            <label className="aov-scenario">
              <span>Scenario</span>
              <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                {SCENARIO_GROUPS.map(([groupName, items]) => (
                  <optgroup key={groupName} label={groupName}>
                    {items.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
        </div>

        {mode === 'live' && walk.length === 0 && (
          <p className="aov-live-wait">
            Waiting for real system events. Trigger a login or MCP tool call in another tab.
          </p>
        )}

        <DiagramStepBar stepper={stepper} testId="aov-stepbar" />

        <div className="aov-diagram-wrap">
          <StaticFlowDiagram
            NODES={OVERVIEW_NODES}
            EDGES={OVERVIEW_EDGES}
            GROUPS={OVERVIEW_GROUPS}
            walk={walk}
            stepper={stepper}
            pingStyle
            onNodeClick={onNodeClick}
            testId="aov-flow"
            ariaLabel="PingOne AI architecture"
          />
        </div>

        {picked && (
          <p className="aov-node-detail" data-testid="aov-node-detail">
            <strong>{picked.label}</strong>
            {' '}{picked.detail}
          </p>
        )}

        {/* Box colour identifies the system area; the arrow key under the diagram explains the lines. */}
        <div className="aov-legend">
          {Object.entries(OVERVIEW_GROUPS).map(([key, g]) => (
            <span key={key} className="aov-legend-item">
              <span className={`aov-legend-swatch aov-legend-${key}`} />
              {g.label}
            </span>
          ))}
          <span className="aov-legend-hint">Click a box for what it does</span>
        </div>

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
