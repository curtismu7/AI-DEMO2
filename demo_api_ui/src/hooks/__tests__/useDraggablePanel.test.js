simport React from "react";
import { render } from "@testing-library/react";
import { useDraggablePanel } from "../useDraggablePanel";

const STORAGE_KEY = "test-panel-pos";
const SIZE = { w: 360, h: 480 };

let captured;
function Probe() {
  captured = useDraggablePanel({ x: 100, y: 100 }, SIZE, { storageKey: STORAGE_KEY });
  return null;
}

function setViewport(w, h) {
  window.innerWidth = w;
  window.innerHeight = h;
}

describe("useDraggablePanel restore clamping", () => {
  const originalW = window.innerWidth;
  const originalH = window.innerHeight;

  beforeEach(() => {
    setViewport(1440, 811);
    localStorage.clear();
    captured = undefined;
  });

  afterEach(() => {
    setViewport(originalW, originalH);
    localStorage.clear();
  });

  // Regression: a panel positioned when the window was larger (or on a since-detached
  // second monitor) saved off-screen coords; useDraggablePanel restored them verbatim
  // so the panel mounted off-screen and stayed invisible (e.g. the "What's happening" toggle).
  it("clamps a restored off-screen position back into the viewport", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pos: { x: 3000, y: 1800 }, size: SIZE }),
    );
    render(<Probe />);
    expect(captured.pos.x + SIZE.w).toBeLessThanOrEqual(window.innerWidth);
    expect(captured.pos.y + SIZE.h).toBeLessThanOrEqual(window.innerHeight);
    expect(captured.pos.x).toBeGreaterThanOrEqual(0);
    expect(captured.pos.y).toBeGreaterThanOrEqual(0);
  });

  it("clamps a restored negative (off top-left) position into the viewport", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pos: { x: -500, y: -500 }, size: SIZE }),
    );
    render(<Probe />);
    expect(captured.pos.x).toBeGreaterThanOrEqual(0);
    expect(captured.pos.y).toBeGreaterThanOrEqual(0);
  });

  it("leaves an already on-screen restored position unchanged", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pos: { x: 900, y: 80 }, size: SIZE }),
    );
    render(<Probe />);
    expect(captured.pos).toEqual({ x: 900, y: 80 });
  });
});
