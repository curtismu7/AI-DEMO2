// A2aDiagramFigure.jsx — one Ping-style A2A figure: step bar (Simulate, Reset, speed) + movable-box StaticFlowDiagram + legend.
// Shared by /a2a-architecture and /architecture/a2a so both draw the same config the same way.
import React from "react";
import DiagramStepBar from "../DiagramStepBar";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../../hooks/useDiagramStepper";
import "../personalAgent/PersonalAgent.css";
import "./a2aArchitecture.css";

export default function A2aDiagramFigure({ config, testId, stepsTestId, ariaLabel }) {
  const { GROUPS, NODES, EDGES, STEPS } = config;
  const stepper = useDiagramStepper(EDGES.length);
  const captions = edgeCaptions(EDGES, Object.fromEntries(NODES.map((n) => [n.id, n.label])));
  const usedGroups = [...new Set(NODES.map((n) => n.group))];
  return (
    <>
      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={stepsTestId} />
      <figure className="pa-figure">
        <StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={GROUPS} stepper={stepper} pingStyle steps={STEPS} testId={testId} height={560} ariaLabel={ariaLabel} />
        <ul className="pa-legend a2a-legend" aria-label="Legend">
          {usedGroups.map((g) => (
            <li key={g}><i className="pa-sw" style={{ borderTopColor: GROUPS[g].bg }} />{GROUPS[g].label}</li>
          ))}
        </ul>
      </figure>
    </>
  );
}

