import React from "react";
import { act, render } from "@testing-library/react";
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

describe("useDraggablePanel unmount mid-drag", () => {
  beforeEach(() => {
    localStorage.clear();
    captured = undefined;
    document.body.style.userSelect = "";
  });

  afterEach(() => {
    document.body.style.userSelect = "";
    localStorage.clear();
  });

  // Regression: handleDragStart set document.body.style.userSelect = 'none' and
  // attached pointermove/pointerup/pointercancel to the drag target, torn down
  // only by the drag's own onUp. If the component unmounted mid-drag (e.g. the
  // panel's own onClose fires while the user is still holding the pointer down),
  // onUp never ran and the page was left permanently unselectable.
  it("resets userSelect and removes drag listeners if unmounted before pointerup", () => {
    const { unmount } = render(<Probe />);

    const target = document.createElement("div");
    document.body.appendChild(target);
    const removeSpy = vi.spyOn(target, "removeEventListener");

    captured.handleDragStart({
      button: 0,
      target,
      currentTarget: target,
      clientX: 150,
      clientY: 150,
      preventDefault: () => {},
      pointerId: 1,
    });

    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.userSelect).toBe("");
    expect(removeSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("pointercancel", expect.any(Function));

    document.body.removeChild(target);
  });
});

describe("useDraggablePanel resize keeps the title bar reachable", () => {
  beforeEach(() => {
    setViewport(1440, 811);
    localStorage.clear();
    captured = undefined;
  });

  afterEach(() => {
    localStorage.clear();
  });

  const startResize = (direction) =>
    act(() => {
      captured.handleResizeStart(
        { button: 0, clientX: 200, clientY: 100, preventDefault: () => {}, stopPropagation: () => {} },
        direction,
      );
    });

  const moveTo = (clientX, clientY) =>
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
    });

  const endResize = () => act(() => { document.dispatchEvent(new MouseEvent("mouseup")); });

  // Regression: growing from the north edge computed
  //   newH = startH - deltaY;  newT = startT + (startH - newH)
  // with nothing bounding newT, so dragging the top edge upward walked the
  // panel's top off the viewport. The title bar is the ONLY drag target, so
  // once it was above y=0 the panel could not be moved back — the reported
  // "can not see the header when I made it bigger" on Token Topology.
  it("does not push the top edge above the viewport when growing from the north edge", () => {
    render(<Probe />);
    startResize("n");
    moveTo(200, -300); // drag the top edge 400px ABOVE where it started
    endResize();

    expect(captured.pos.y).toBeGreaterThanOrEqual(0);
    // The bottom edge stays put — north resize moves the top, not the panel.
    expect(captured.pos.y + captured.size.h).toBe(100 + SIZE.h);
  });

  it("does not push the left edge off-screen when growing from the west edge", () => {
    render(<Probe />);
    startResize("w");
    moveTo(-300, 100);
    endResize();

    expect(captured.pos.x).toBeGreaterThanOrEqual(0);
    expect(captured.pos.x + captured.size.w).toBe(100 + SIZE.w);
  });

  // The cap must not become a general clamp: growing downward is unbounded, and
  // a north resize that stays on-screen must still work normally.
  it("still grows normally from the south edge and from a bounded north drag", () => {
    render(<Probe />);
    startResize("s");
    moveTo(200, 900);
    endResize();
    expect(captured.size.h).toBeGreaterThan(SIZE.h);

    startResize("n");
    moveTo(200, 60); // 40px up — well inside the viewport
    endResize();
    expect(captured.pos.y).toBe(60);
  });
});
