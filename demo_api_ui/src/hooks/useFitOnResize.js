import { useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";

/** Dispatched on window by Reset so every diagram on the page goes back to its fitted view. */
export const REFIT_EVENT = "diagram:refit";

/**
 * React Flow fits the view once, on mount. A page whose layout settles afterwards
 * (side nav expanding, window resize) leaves the diagram clipped, so refit whenever
 * the canvas element changes size. Call inside a <ReactFlowProvider>.
 *
 * `readable` ({ narrowBelow, minZoom }) is for a pane that is too narrow to show the whole drawing at a
 * legible size (a phone): below `narrowBelow` px wide the fit is not allowed to go under `minZoom`, so the
 * text stays readable, and the drawing is pinned top-left so the user pans to the rest. The hook returns
 * true while the view is in that clamped, pannable state (the caller shows a pan hint); false otherwise.
 */
export function useFitOnResize(ref, fitViewOptions, readable) {
  const { fitView, getNodes, getZoom, setViewport, getNodesBounds } = useReactFlow();
  const [pannable, setPannable] = useState(false);
  const narrowBelow = readable?.narrowBelow;
  const floor = readable?.minZoom;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    let live = true;
    const run = () => {
      const narrow = Boolean(floor) && el.clientWidth < narrowBelow;
      const opts = narrow ? { ...fitViewOptions, minZoom: floor } : fitViewOptions;
      Promise.resolve(fitView(opts)).then(() => {
        if (!live) return;
        if (!narrow) {
          setPannable(false);
          return;
        }
        const zoom = getZoom();
        const clamped = zoom <= floor + 0.001;
        setPannable(clamped);
        if (clamped) {
          const b = getNodesBounds(getNodes());
          const pad = fitViewOptions?.padding || {};
          setViewport({ x: (parseFloat(pad.left) || 0) - b.x * zoom, y: (parseFloat(pad.top) || 0) - b.y * zoom, zoom });
        }
      });
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(run);
    });
    ro.observe(el);
    window.addEventListener(REFIT_EVENT, run);
    return () => {
      live = false;
      window.removeEventListener(REFIT_EVENT, run);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, fitView, getNodes, getZoom, setViewport, getNodesBounds, fitViewOptions, narrowBelow, floor]);
  return pannable;
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
