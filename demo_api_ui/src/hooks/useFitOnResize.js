import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

/**
 * React Flow fits the view once, on mount. A page whose layout settles afterwards
 * (side nav expanding, window resize) leaves the diagram clipped, so refit whenever
 * the canvas element changes size. Call inside a <ReactFlowProvider>.
 */
export function useFitOnResize(ref, fitViewOptions) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitView(fitViewOptions));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, fitView, fitViewOptions]);
}
