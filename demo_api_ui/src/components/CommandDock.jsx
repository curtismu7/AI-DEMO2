// CommandDock — the demo-control tray that declutters the agent header.
// Collapsed: a single draggable pill (position persisted in localStorage),
// defaulting to top-right (clear of the agent FAB at bottom-right).
// Expanded: a FloatingPanel shell that keeps the shared drag / resize /
// pop-out (window.open + PopOutPortal) behavior, so the tray can be moved
// anywhere on screen or popped into its own browser window entirely.
//
// The panel content mounts only while open. Tests that exercise the moved
// controls click the pill first (getByRole("button", { name:
// /Demo Controls/i })), exactly like a presenter would.
import React, { useCallback, useEffect, useRef, useState } from "react";
import FloatingPanel from "./FloatingPanel";
import "./CommandDock.css";

const PILL_POS_KEY = "cmd_dock_pill_pos";

function clampPillPos(x, y) {
  const pad = 4;
  const maxX = Math.max(pad, window.innerWidth - pad);
  const maxY = Math.max(pad, window.innerHeight - pad);
  return {
    x: Math.min(Math.max(x, pad), maxX),
    y: Math.min(Math.max(y, pad), maxY),
  };
}

function loadPillPos() {
  try {
    const raw = localStorage.getItem(PILL_POS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (typeof o?.x !== "number" || typeof o?.y !== "number") return null;
    return o;
  } catch {
    return null;
  }
}

export default function CommandDock({
  open,
  onOpenChange,
  title = "Demo Controls",
  children,
}) {
  const width = Math.min(480, Math.max(340, window.innerWidth - 24));
  const height = Math.min(620, Math.max(320, window.innerHeight - 24));
  const defaultX = Math.max(8, window.innerWidth - width - 16);
  const defaultY = 52;

  // Collapsed pill position — null means "use the CSS default top-right".
  const [pillPos, setPillPos] = useState(loadPillPos);
  const pillDragRef = useRef(null);
  const justDraggedRef = useRef(false);

  // Re-clamp on resize so a dragged pill never ends up off-screen.
  useEffect(() => {
    if (!pillPos) return undefined;
    const onResize = () => setPillPos((p) => (p ? clampPillPos(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pillPos]);

  const onPillPointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      pillDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: rect.left,
        originY: rect.top,
        moved: false,
      };
      el.setPointerCapture(e.pointerId);
    },
    []
  );

  const onPillPointerMove = useCallback((e) => {
    const d = pillDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    // Keep the grab point under the cursor: anchor by the pill's top-left.
    const next = clampPillPos(d.originX + dx, d.originY + dy);
    // Compensate for clamping so the pill doesn't jump ahead of the cursor.
    d.originX += next.x - (d.originX + dx);
    d.originY += next.y - (d.originY + dy);
    setPillPos(next);
    // Reposition the capture target so the origin stays accurate across moves.
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
    el.style.right = "auto";
  }, []);

  const onPillPointerUp = useCallback((e) => {
    const d = pillDragRef.current;
    pillDragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d?.moved) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);
      setPillPos((p) => {
        const clamped = clampPillPos(p?.x ?? 0, p?.y ?? 0);
        try {
          localStorage.setItem(PILL_POS_KEY, JSON.stringify(clamped));
        } catch {
          /* storage unavailable — position just won't persist */
        }
        return clamped;
      });
    }
    // Plain clicks fall through to onClick below (also covers jsdom tests,
    // which fire click without pointer events).
  }, []);

  const onPillClick = useCallback(() => {
    // Suppress the click that follows a completed drag.
    if (justDraggedRef.current) return;
    onOpenChange(true);
  }, [onOpenChange]);

  const pillStyle = pillPos
    ? { left: pillPos.x, top: pillPos.y, right: "auto" }
    : undefined;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="cmd-dock-pill"
          aria-expanded="false"
          onPointerDown={onPillPointerDown}
          onPointerMove={onPillPointerMove}
          onPointerUp={onPillPointerUp}
          onClick={onPillClick}
          style={pillStyle}
          title="Demo Controls — drag to move; click to open"
        >
          🎛 <span>Demo Controls</span>
        </button>
      )}
      {open && (
        <FloatingPanel
          title={title}
          className="cmd-dock-panel"
          defaultWidth={width}
          defaultHeight={height}
          defaultX={defaultX}
          defaultY={defaultY}
          minWidth={320}
          minHeight={220}
          zIndex={100061}
          onClose={() => onOpenChange(false)}
        >
          <div className="cmd-dock-body">{children}</div>
        </FloatingPanel>
      )}
    </>
  );
}
