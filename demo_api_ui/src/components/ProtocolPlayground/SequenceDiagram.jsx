import React from 'react';
import { buildSequenceSource } from '../../services/protocolMermaid';
import { useMermaidRender } from '../../hooks/useMermaidRender';

/**
 * Mermaid sequence diagram for the selected protocol. Re-renders as steps run,
 * so each message picks up its response code and a failed hop draws as a
 * crossed arrow. An optional decision flowchart shows branching a sequence
 * diagram cannot express.
 */

// wrap: false — mermaid's auto-wrap hard-hyphenates long unbroken tokens
// (e.g. "authReqId" split as "aut-/hReqId") since endpoint labels have no
// internal spaces to wrap on. useMaxWidth scales the whole SVG down to fit
// instead, so long labels shrink, not mangle.
const SEQUENCE_OPTS = { useMaxWidth: true, wrap: false };
const FLOWCHART_OPTS = { useMaxWidth: true, htmlLabels: false };

function MermaidBlock({ source, dark, caption }) {
  // dark is this page's OWN independent toggle (Protocol Playground has one,
  // unrelated to the app-wide theme) — passed through explicitly rather than
  // letting the hook read the app theme.
  const { containerRef, error } = useMermaidRender(source, {
    darkMode: dark,
    securityLevel: 'strict',
    sequence: SEQUENCE_OPTS,
    flowchart: FLOWCHART_OPTS,
  });

  if (!source) return null;

  return (
    <figure className="pp-mermaid">
      {caption && <figcaption className="pp-mermaid__caption">{caption}</figcaption>}
      {error ? (
        <p className="pp-mermaid__error">{error}</p>
      ) : (
        <div className="pp-mermaid__canvas" ref={containerRef} />
      )}
    </figure>
  );
}

export default function SequenceDiagram({ flowSpec, currentStep, results = [], dark = false }) {
  const source = buildSequenceSource(flowSpec, results, currentStep);
  const ran = results.length > 0;

  return (
    <div className="pp-diagrams">
      <MermaidBlock
        source={source}
        dark={dark}
        caption={ran ? 'Sequence — response code shown per step' : 'Sequence — run the flow to fill in responses'}
      />
      <MermaidBlock
        source={flowSpec?.decisionDiagram}
        dark={dark}
        caption="Decision — how the request is judged"
      />
    </div>
  );
}
