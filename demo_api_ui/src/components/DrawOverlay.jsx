// DrawOverlay.jsx — a pencil for demos: draw over any page to circle a box, then clear.
// Toggle with the floating pencil or Ctrl/Cmd+Shift+D; Esc leaves draw mode (marks stay until Clear);
// marks are viewport-fixed and wiped on navigation. Works with mouse, touch and Apple Pencil (pointer events).
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import "./DrawOverlay.css";

const COLORS = ["#ff2d2d", "#ffd400", "#2b8cff", "#27d17f", "#ffffff"];
const WIDTHS = [3, 6, 12];

function paint(canvas, strokes) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom has no canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = canvas.width / canvas.clientWidth || 1;
  ctx.scale(dpr, dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 2;
    const p = s.points;
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0].x, p[0].y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i].x + p[i + 1].x) / 2;
      const my = (p[i].y + p[i + 1].y) / 2;
      ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my);
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    ctx.stroke();
  }
}

export default function DrawOverlay() {
  const canvasRef = useRef(null);
  const strokes = useRef([]);
  const current = useRef(null);
  const [on, setOn] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [count, setCount] = useState(0);
  const { pathname } = useLocation();

  const redraw = useCallback(() => {
    if (canvasRef.current) paint(canvasRef.current, strokes.current);
  }, []);

  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    redraw();
  }, [redraw]);

  const clear = useCallback(() => {
    strokes.current = [];
    current.current = null;
    setCount(0);
    redraw();
  }, [redraw]);

  const undo = useCallback(() => {
    strokes.current.pop();
    setCount(strokes.current.length);
    redraw();
  }, [redraw]);

  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  // Marks belong to the page they were drawn on.
  useEffect(() => { clear(); }, [pathname, clear]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOn((v) => !v);
      } else if (e.key === "Escape") setOn(false);
      else if (on && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, undo]);

  const down = (e) => {
    if (!on) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    current.current = { color, width, points: [{ x: e.clientX, y: e.clientY }] };
    strokes.current.push(current.current);
    redraw();
  };
  const move = (e) => {
    if (!current.current) return;
    current.current.points.push({ x: e.clientX, y: e.clientY });
    redraw();
  };
  const up = () => {
    if (!current.current) return;
    current.current = null;
    setCount(strokes.current.length);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`draw-canvas${on ? " draw-canvas--on" : ""}`}
        data-testid="draw-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-hidden="true"
      />
      <div className="draw-bar" data-testid="draw-bar" role="toolbar" aria-label="Pencil">
        {on && (
          <>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`draw-swatch${c === color ? " draw-swatch--on" : ""}`}
                style={{ background: c }}
                aria-label={`Pencil colour ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`draw-w${w === width ? " draw-w--on" : ""}`}
                aria-label={`Pencil width ${w}`}
                onClick={() => setWidth(w)}
              >
                <i style={{ width: w + 4, height: w + 4 }} />
              </button>
            ))}
            <button type="button" className="draw-btn" onClick={undo} disabled={count === 0}>Undo</button>
          </>
        )}
        {(on || count > 0) && <button type="button" className="draw-btn" onClick={clear} disabled={count === 0}>Clear</button>}
        <button
          type="button"
          className={`draw-pencil${on ? " draw-pencil--on" : ""}`}
          onClick={() => setOn((v) => !v)}
          aria-pressed={on}
          title="Pencil: draw on the screen (Ctrl/Cmd+Shift+D, Esc to stop)"
        >
          {on ? "Done" : "Draw"}
        </button>
      </div>
    </>
  );
}
