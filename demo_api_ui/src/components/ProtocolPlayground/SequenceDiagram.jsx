import React from 'react';
import { buildSequenceSource } from '../../services/protocolMermaid';
import FlowDiagram from '../FlowDiagram';

/**
 * Sequence diagram (React Flow, drawn from Mermaid text) for the selected protocol. Re-renders as steps run,
 * so each message picks up its response code and a failed hop draws as a
 * crossed arrow. An optional decision flowchart shows branching a sequence
 * diagram cannot express.
 */

function DiagramBlock({ source, caption }) {
  if (!source) return null;

  return (
    <figure className="pp-mermaid">
      {caption && <figcaption className="pp-mermaid__caption">{caption}</figcaption>}
      <div className="pp-mermaid__canvas">
        <FlowDiagram source={source} label={caption || 'Protocol diagram'} height={420} step={-1} />
      </div>
    </figure>
  );
}

export default function SequenceDiagram({ flowSpec, currentStep, results = [] }) {
  const source = buildSequenceSource(flowSpec, results, currentStep);
  const ran = results.length > 0;

  return (
    <div className="pp-diagrams">
      <DiagramBlock
        source={source}
        caption={ran ? 'Sequence — response code shown per step' : 'Sequence — run the flow to fill in responses'}
      />
      <DiagramBlock
        source={flowSpec?.decisionDiagram}
        caption="Decision — how the request is judged"
      />
    </div>
  );
}
