import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

/** Dispatched on window by Reset so every diagram on the page goes back to its fitted view. */
export const REFIT_EVENT = "diagram:refit";

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
    const onRefit = () => fitView(fitViewOptions);
    window.addEventListener(REFIT_EVENT, onRefit);
    return () => {
      window.removeEventListener(REFIT_EVENT, onRefit);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, fitView, fitViewOptions]);
}

/**
 * A page that swaps the diagram's source in place (Protocol Playground picking a
 * protocol, Token Flow switching scenario) changes the drawing's size without
 * resizing the canvas, so the ResizeObserver never fires and the previous
 * protocol's viewport clips the new drawing. Refit when the source changes,
 * after React Flow has measured the new nodes.
 */
export function useFitOnSource(source, fitViewOptions) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!source) return undefined;
    // Nodes measure a frame after the source lands; fitView inside React Flow
    // waits for measured nodes on its own, so one rAF here is enough ordering.
    let raf = requestAnimationFrame(() => fitView(fitViewOptions));
    return () => cancelAnimationFrame(raf);
  }, [source, fitView, fitViewOptions]);
}
