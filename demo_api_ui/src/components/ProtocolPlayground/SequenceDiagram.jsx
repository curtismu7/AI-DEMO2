import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { buildSequenceSource } from '../../services/protocolMermaid';

/**
 * Mermaid sequence diagram for the selected protocol. Re-renders as steps run,
 * so each message picks up its response code and a failed hop draws as a
 * crossed arrow. An optional decision flowchart shows branching a sequence
 * diagram cannot express.
 */

let renderSeq = 0;

function MermaidBlock({ source, dark, caption }) {
  const containerRef = useRef(null);
  const latestRef = useRef(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!source) return undefined;
    let cancelled = false;
    const renderId = ++renderSeq;
    setError(null);

    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      sequence: { useMaxWidth: true, wrap: true },
      flowchart: { useMaxWidth: true, htmlLabels: false },
    });

    (async () => {
      try {
        const { svg } = await mermaid.render(`pp-mermaid-${renderId}`, source);
        if (!cancelled && latestRef.current <= renderId && containerRef.current) {
          latestRef.current = renderId;
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Diagram failed to render');
      }
    })();

    return () => { cancelled = true; };
  }, [source, dark]);

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
