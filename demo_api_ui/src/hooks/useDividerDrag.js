import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize for a split-pane divider. One body owns the clamp, the
 * localStorage persistence, the body cursor, and the unmount cleanup that
 * several hand-rolled copies (InspectorShell, UserDashboard, TokenRail…)
 * each missed or re-patched separately. Floating panels are a different
 * job — use useDraggablePanel for those.
 *
 * @param {Object} opts
 * @param {'x'|'y'} [opts.axis='x'] drag axis (x = column width, y = row height)
 * @param {number} opts.min clamp floor, px
 * @param {number} opts.max clamp ceiling, px
 * @param {number} opts.initial default size, px
 * @param {string} [opts.storageKey] localStorage key; omit to skip persistence
 * @param {boolean} [opts.invert=false] true when the pane sits on the right/bottom
 *   of its divider, so dragging toward the start grows it
 * @returns {{ size: number, setSize: Function, handleProps: Object }}
 *   Spread `handleProps` onto the divider element.
 */
export default function useDividerDrag({
  axis = "x",
  min,
  max,
  initial,
  storageKey,
  invert = false,
}) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      try {
        const saved = Number(window.localStorage.getItem(storageKey));
        if (Number.isFinite(saved) && saved >= min && saved <= max) return saved;
      } catch {
        // Unavailable storage (private browsing, quota) — fall through.
      }
    }
    return initial;
  });
  const dragRef = useRef(null);

  const onMove = useCallback(
    (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pos = axis === "x" ? e.clientX : e.clientY;
      const delta = (pos - drag.start) * (invert ? -1 : 1);
      setSize(Math.min(Math.max(drag.startSize + delta, min), max));
    },
    [axis, invert, min, max],
  );

  const onUp = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    setSize((s) => {
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, String(s));
        } catch {
          // Ignore write failures (private browsing, quota).
        }
      }
      return s;
    });
  }, [onMove, storageKey]);

  const onMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      dragRef.current = {
        start: axis === "x" ? e.clientX : e.clientY,
        startSize: size,
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    },
    [axis, size, onMove, onUp],
  );

  // Unmounting mid-drag (route change with the button held) must not leave
  // listeners or the resize cursor on `document` for the rest of the session.
  useEffect(
    () => () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    },
    [onMove, onUp],
  );

  return {
    size,
    setSize,
    handleProps: {
      onMouseDown,
      role: "separator",
      "aria-orientation": axis === "x" ? "vertical" : "horizontal",
    },
  };
}
