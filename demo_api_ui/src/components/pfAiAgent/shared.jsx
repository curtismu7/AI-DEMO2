import { useMemo } from "react";
import FlowDiagram from "../FlowDiagram";
import { sequenceSource as pfSequenceSource } from "../../utils/pfTraceSequence";

export function FeatureStatus({ ready }) {
  return (
    <span className={`pf-ai-agent__status ${ready ? "is-ready" : "is-off"}`}>
      <span aria-hidden="true" />{ready ? "Ready" : "Not configured"}
    </span>
  );
}

// The shape of one captured flow, as a walkable sequence diagram above the
// raw traffic. Empty trace -> no diagram (ProtocolTrace stays the evidence).
export function TraceSequenceDiagram({ steps, selfCall, testId }) {
  const source = useMemo(() => pfSequenceSource(steps, { selfCall }), [steps, selfCall]);
  if (!source) return null;
  return (
    <div className="pf-ai-agent__sequence" data-testid={testId}>
      <FlowDiagram source={source} label="Request sequence" />
    </div>
  );
}
