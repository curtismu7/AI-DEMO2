// AgentOnboardingSubwayPage.jsx — subway-map walkthrough of Tarun Madiraju's onboarding
// architecture. A second view of the same FLOWS data as AgentOnboardingFlowDiagram.jsx (the
// card diagram): one station per run of steps on the same component, drawn as a React Flow
// line that the shared Play/Step bar, movie reel and details row walk, station by station.
import React, { useMemo, useState } from "react";
import StaticFlowDiagram from "./StaticFlowDiagram";
import { FLOWS, FLOW_ORDER } from "../data/agentOnboardingFlows";
import { STATION_LABELS, collapseStations } from "../data/agentOnboardingStations";
import "./AgentOnboardingSubwayPage.css";

const PER_ROW = 4;
const GROUPS = { station: { label: "Station", bg: "var(--th-status-info)" } };

// Stations laid out in a snake (left to right, then right to left) so every hop joins neighbours.
function buildLine(steps) {
  const { slots, slotForStep } = collapseStations(steps);
  const nodes = slots.map((key, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = row % 2 ? PER_ROW - 1 - (i % PER_ROW) : i % PER_ROW;
    return { id: `s${i}`, group: "station", label: STATION_LABELS[key] || key, x: col * 260, y: row * 110 };
  });
  const edges = slots.slice(1).map((_, i) => [`s${i}`, `s${i + 1}`, "", { vertical: (i + 1) % PER_ROW === 0 }]);
  const walk = steps.map((s, i) => {
    const slot = slotForStep[i];
    const station = nodes[slot].label;
    return {
      title: s.title,
      label: s.narrative,
      lines: [{ who: station, text: s.narrative }],
      nodes: [`s${slot}`],
      // the line the journey just travelled to reach this station
      edges: slot > 0 && slotForStep[i - 1] !== slot ? [slot - 1] : [],
    };
  });
  return { nodes, edges, walk };
}

export default function AgentOnboardingSubwayPage() {
  const [flowKey, setFlowKey] = useState(FLOW_ORDER[0]);
  const [story, setStory] = useState("browserDevice");

  const flow = FLOWS[flowKey];
  const steps = flowKey === "admin" ? flow.stories[story].steps : flow.steps;
  const line = useMemo(() => buildLine(steps), [steps]);
  const outcome = flowKey === "admin" ? FLOWS.admin.stories[story].outcome : flow.outcome;

  return (
    <div className="aos-page">
      <div className="aos-hero">
        <h1>Enterprise AI Onboarding — Subway Map</h1>
        <p className="aos-sub">
          Same onboarding flows as the box+arrow diagram, oriented as a pipeline —
          walk one persona's journey station by station.
        </p>
      </div>

      <div className="aos-flow-tabs" role="tablist" aria-label="Onboarding flow">
        {FLOW_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={flowKey === key}
            className={`aos-flow-tab${flowKey === key ? " active" : ""}`}
            onClick={() => setFlowKey(key)}
          >
            {FLOWS[key].label}
          </button>
        ))}
      </div>

      {flowKey === "admin" && (
        <div className="aos-story-tabs" role="tablist" aria-label="Discovery story">
          {Object.entries(FLOWS.admin.stories).map(([key, s]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={story === key}
              className={`aos-story-tab${story === key ? " active" : ""}`}
              onClick={() => setStory(key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <p className="aos-persona">Persona: {flow.persona}</p>

      {/* keyed by flow + story so switching starts the walkthrough over */}
      <StaticFlowDiagram
        key={`${flowKey}-${story}`}
        NODES={line.nodes}
        EDGES={line.edges}
        GROUPS={GROUPS}
        walk={line.walk}
        testId="aos-line"
        ariaLabel="Onboarding subway map: one station per component, walked in order"
      />

      <div className="aos-outcome">
        <strong>Outcome:</strong> {outcome}
      </div>
    </div>
  );
}
