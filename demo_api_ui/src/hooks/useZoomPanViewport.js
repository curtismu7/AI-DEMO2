import { useState, useRef, useCallback, useEffect } from "react";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Wheel-zoom + right-click-drag-pan for a diagram viewport, with a zoom API
 * shaped to drop straight into components/diagram/DiagramControls' zoom
 * block (zoom/onZoomIn/onZoomOut/onZoomReset/zoomMin/zoomMax/zoomStep) — the
 * shared toolbar several architecture pages already use for button-only
 * zoom. This hook is the wheel/pan half of that same "standard."
 *
 * Usage: put `containerRef` and spread `viewportProps` onto the fixed-size,
 * `overflow: hidden` clipping element (containerRef also doubles as where a
 * real, non-passive wheel listener gets attached — see below), and apply
 * `contentStyle` to the element inside it that should actually scale/move
 * (a Mermaid SVG container, a canvas wrapper, ...).
 *
 * @param {object} [opts]
 * @param {number} [opts.initialZoom=1]
 * @param {number} [opts.min=0.5]
 * @param {number} [opts.max=4]
 * @param {number} [opts.step=0.25]
 */
export default function useZoomPanViewport({ initialZoom = 1, min = 0.5, max = 4, step = 0.25 } = {}) {
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef(null);
  const zoomRef = useRef(zoom);
  const dragStart = useRef(null); // { x, y, panX, panY } while right-dragging
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Zooms by `delta`, keeping the point at (clientX, clientY) fixed on screen
  // — the same trick Figma/Google Maps use, so zooming toward your cursor
  // doesn't fling the diagram off-center.
  const zoomAt = useCallback((delta, clientX, clientY) => {
    const prevZoom = zoomRef.current;
    const nextZoom = clamp(parseFloat((prevZoom + delta).toFixed(2)), min, max);
    if (nextZoom === prevZoom) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const ratio = nextZoom / prevZoom;
      setPan((p) => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
    }
    setZoom(nextZoom);
  }, [min, max]);

  const zoomButton = useCallback((delta) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    zoomAt(delta, cx, cy);
  }, [zoomAt]);

  const zoomIn = useCallback(() => zoomButton(step), [zoomButton, step]);
  const zoomOut = useCallback(() => zoomButton(-step), [zoomButton, step]);
  const zoomReset = useCallback(() => { setZoom(initialZoom); setPan({ x: 0, y: 0 }); }, [initialZoom]);

  // React attaches its own `wheel` listener as passive (for scroll
  // performance), so a React onWheel prop can update state but can never
  // preventDefault — the page would zoom the diagram AND scroll underneath
  // it. Attaching a real, non-passive listener straight to the DOM node is
  // the standard workaround (same one react-zoom-pan-pinch and friends use).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(e.deltaY > 0 ? -step : step, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, step]);

  // Right-click is the pan gesture (left click stays free for selecting text,
  // clicking links/buttons inside the diagram, etc.), so suppress the
  // browser's context menu on the viewport.
  const onContextMenu = useCallback((e) => e.preventDefault(), []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
  }, [pan]);

  // Tracked on window, not just the viewport element, so a fast drag that
  // crosses the viewport's edge doesn't silently stop panning.
  useEffect(() => {
    if (!isPanning) return undefined;
    const onMove = (e) => {
      if (!dragStart.current) return;
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    };
    const onUp = () => { dragStart.current = null; setIsPanning(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  return {
    zoom,
    pan,
    isPanning,
    containerRef,
    zoomIn,
    zoomOut,
    zoomReset,
    viewportProps: { onContextMenu, onMouseDown },
    contentStyle: { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" },
  };
}
