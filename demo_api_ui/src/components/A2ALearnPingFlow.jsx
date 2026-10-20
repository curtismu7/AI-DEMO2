// A2ALearnPingFlow.jsx — the /a2a-protocol-learning delegation figure in the shared Ping style, built from the run's token events.
// Step bar (Simulate, Step, Reset, speed), movable-box StaticFlowDiagram and legend, same as /a2a-architecture.
import React, { useMemo } from 'react';
import A2aDiagramFigure from './a2aArchitecture/A2aDiagramFigure';
import { buildLearnDiagram } from '../config/a2aLearnDiagram';

export default function A2ALearnPingFlow({ tokenEvents, labels }) {
  const config = useMemo(() => buildLearnDiagram(tokenEvents, labels), [tokenEvents, labels]);
  if (!config.EDGES.length) return null;
  return (
    <A2aDiagramFigure
      config={config}
      testId="a2a-learn-diagram"
      stepsTestId="a2a-learn-steps"
      ariaLabel="A2A delegation chain for this run. The user token is the subject, PingOne issues two actor tokens and two RFC 8693 exchanges, and the generalist hands the first delegated token to the specialist over the A2A wire."
    />
  );
}
