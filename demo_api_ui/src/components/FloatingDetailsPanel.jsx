import React, { useCallback, useEffect, useRef, useState } from "react";
import "./FloatingDetailsPanel.css";

const MIN_W = 300;
const MIN_H = 280;
const EDGE = 28;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}

function loadState(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.w === "number" &&
      typeof parsed?.h === "number" &&
      typeof parsed?.x === "number" &&
      typeof parsed?.y === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore malformed stored state
  }
  return null;
}

/**
 * Floating, draggable, resizable details pop-out. Anchored top-right inside the
 * nearest positioned ancestor (the diagram card wrapper); dragged by its header,
 * resized from the bottom-left corner, left edge and bottom edge. Size and
 * position persist to localStorage under "fdp-<id>".
 */
export default function FloatingDetailsPanel({
  open,
  title,
  status,
  onClose,
  onDock,
  id = "step-details",
  children,
}) {
  const storageKey = `fdp-${id}`;
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) setPos(loadState(storageKey));
  }, [open, storageKey]);

  const persist = useCallback(
    (next) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage unavailable; state still applies for this session
      }
    },
    [storageKey],
  );

  const startDrag = (e) => {
    if (e.target.closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const parent = panel.offsetParent || panel.parentElement;
    if (!parent) return;
    const pr = panel.getBoundingClientRect();
    const gr = parent.getBoundingClientRect();
    const dx = e.clientX - pr.left;
    const dy = e.clientY - pr.top;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      let x = ev.clientX - gr.left - dx;
      let y = ev.clientY - gr.top - dy;
      x = clamp(x, 0, gr.width - pr.width);
      y = clamp(y, 0, gr.height - pr.height);
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = "auto";
    };
    const onUp = () => {
      setDragging(false);
      e.currentTarget.removeEventListener("pointermove", onMove);
      e.currentTarget.removeEventListener("pointerup", onUp);
      const nr = panel.getBoundingClientRect();
      persist({
        w: nr.width,
        h: nr.height,
        x: nr.left - gr.left,
        y: nr.top - gr.top,
      });
    };
    e.currentTarget.addEventListener("pointermove", onMove);
    e.currentTarget.addEventListener("pointerup", onUp);
  };

  const startResize = (dir) => (e) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const parent = panel.offsetParent || panel.parentElement;
    if (!parent) return;
    const pr = panel.getBoundingClientRect();
    const gr = parent.getBoundingClientRect();
    const st = { x: e.clientX, y: e.clientY, w: pr.width, h: pr.height, left: pr.left, top: pr.top };
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      if (dir === "corner" || dir === "left") {
        const w = clamp(
          dir === "left" ? st.w + (st.x - ev.clientX) : st.w + (ev.clientX - st.x),
          MIN_W,
          gr.width - EDGE,
        );
        panel.style.width = `${w}px`;
        if (dir === "left") {
          panel.style.right = "auto";
          panel.style.left = `${clamp(st.left - (st.w - w) - gr.left, 0, gr.width - w)}px`;
        }
      }
      if (dir === "corner" || dir === "bottom") {
        const h = clamp(st.h + (ev.clientY - st.y), MIN_H, gr.height - EDGE);
        panel.style.height = `${h}px`;
      }
    };
    const onUp = () => {
      e.currentTarget.removeEventListener("pointermove", onMove);
      e.currentTarget.removeEventListener("pointerup", onUp);
      const nr = panel.getBoundingClientRect();
      persist({
        w: nr.width,
        h: nr.height,
        x: nr.left - gr.left,
        y: nr.top - gr.top,
      });
    };
    e.currentTarget.addEventListener("pointermove", onMove);
    e.currentTarget.addEventListener("pointerup", onUp);
  };

  if (!open) return null;

  const style = pos
    ? { width: pos.w, height: pos.h, left: pos.x, top: pos.y, right: "auto" }
    : undefined;

  return (
    <aside
      ref={panelRef}
      className={`fdp${dragging ? " fdp--dragging" : ""}`}
      style={style}
      aria-label="Step details"
    >
      <div className="fdp__head" onPointerDown={startDrag}>
        <span className="fdp__grip" aria-hidden="true">⠿</span>
        <span className="fdp__title">{title}</span>
        {status && <span className="fdp__status">{status}</span>}
        <span className="fdp__spacer" />
        {onDock && (
          <button className="fdp__btn" type="button" title="Dock back below the diagram" onClick={onDock}>
            ⛶
          </button>
        )}
        <button className="fdp__btn" type="button" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="fdp__body">{children}</div>
      <div className="fdp__resize fdp__resize--corner" onPointerDown={startResize("corner")} aria-hidden="true" />
      <div className="fdp__resize fdp__resize--left" onPointerDown={startResize("left")} aria-hidden="true" />
      <div className="fdp__resize fdp__resize--bottom" onPointerDown={startResize("bottom")} aria-hidden="true" />
    </aside>
  );
}
