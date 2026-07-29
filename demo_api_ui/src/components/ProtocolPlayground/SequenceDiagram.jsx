import React, { useEffect, useRef } from 'react';
import { renderDiagram } from '../../services/diagramRenderer';

export default function SequenceDiagram({ flowSpec, currentStep }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !flowSpec) return;

    containerRef.current.innerHTML = '';
    const svg = renderDiagram(flowSpec, 800, 600, currentStep);
    containerRef.current.appendChild(svg);
  }, [flowSpec, currentStep]);

  return (
    <div className="sequence-diagram-container" ref={containerRef} />
  );
}
