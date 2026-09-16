import { useEffect, useRef } from "react";
import mermaid from "mermaid";
import { getDiagramArrowIndexes } from "./oauthVisualizerModel";

export default function MermaidFlowDiagram({ flow, activeStepIndex, darkMode }) {
  const hostRef = useRef(null);
  const renderId = useRef(`oauth_visualizer_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!hostRef.current || !flow) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: darkMode ? "dark" : "base" });
      try {
        const result = await mermaid.render(renderId.current, flow.diagram);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = result.svg;
        const active = new Set(getDiagramArrowIndexes(flow, activeStepIndex));
        hostRef.current.querySelectorAll(".messageLine0, .messageLine1").forEach((line, index) => {
          line.classList.toggle("ov-diagram-active", active.has(index + 1));
        });
      } catch {
        if (!cancelled && hostRef.current) hostRef.current.textContent = "This flow diagram could not be rendered.";
      }
    }
    render();
    return () => { cancelled = true; };
  }, [activeStepIndex, darkMode, flow]);

  return <div ref={hostRef} className="ov-diagram" aria-label={`${flow?.name || "OAuth"} sequence diagram`} />;
}
