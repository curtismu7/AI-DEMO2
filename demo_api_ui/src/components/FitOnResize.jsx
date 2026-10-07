import { useEffect } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { REFIT_EVENT } from "../hooks/useFitOnResize";

const NO_OPTIONS = { padding: 0.04 };

/**
 * Render as a child of <ReactFlow>. React Flow fits the view once, on mount, so a page whose
 * layout settles afterwards (side nav opening, window resize, tab switch) leaves the diagram
 * clipped. This refits whenever the canvas changes size. Pages that own their ReactFlowProvider
 * use useFitOnResize instead.
 */
export default function FitOnResize({ options = NO_OPTIONS }) {
  const { fitView } = useReactFlow();
  const dom = useStore((s) => s.domNode);
  useEffect(() => {
    if (!dom || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitView(options));
    });
    ro.observe(dom);
    const onRefit = () => fitView(options);
    window.addEventListener(REFIT_EVENT, onRefit);
    return () => {
      window.removeEventListener(REFIT_EVENT, onRefit);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [dom, fitView, options]);
  return null;
}
