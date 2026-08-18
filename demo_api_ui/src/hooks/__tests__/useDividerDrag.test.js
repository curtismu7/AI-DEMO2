import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, test, expect, beforeEach } from "vitest";
import useDividerDrag from "../useDividerDrag";

function Harness({ invert = false, storageKey = "test-divider" }) {
  const { size, handleProps } = useDividerDrag({
    min: 100,
    max: 400,
    initial: 200,
    storageKey,
    invert,
  });
  return (
    <div>
      <div data-testid="pane" style={{ width: `${size}px` }} />
      <div data-testid="handle" {...handleProps} />
    </div>
  );
}

const paneWidth = () => screen.getByTestId("pane").style.width;

describe("useDividerDrag", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.style.cursor = "";
  });

  test("drag grows the pane, persists on mouseup, sets and clears body cursor", () => {
    render(<Harness />);
    expect(paneWidth()).toBe("200px");

    fireEvent.mouseDown(screen.getByTestId("handle"), { clientX: 300 });
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.mouseMove(document, { clientX: 390 });
    expect(paneWidth()).toBe("290px");
    fireEvent.mouseUp(document);

    expect(document.body.style.cursor).toBe("");
    expect(window.localStorage.getItem("test-divider")).toBe("290");
  });

  test("clamps at min and max", () => {
    render(<Harness />);
    fireEvent.mouseDown(screen.getByTestId("handle"), { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: -500 });
    expect(paneWidth()).toBe("100px");
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(paneWidth()).toBe("400px");
    fireEvent.mouseUp(document);
  });

  test("invert grows the pane when dragging toward the start", () => {
    render(<Harness invert />);
    fireEvent.mouseDown(screen.getByTestId("handle"), { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 250 });
    expect(paneWidth()).toBe("250px");
    fireEvent.mouseUp(document);
  });

  test("reads persisted width on mount, ignoring out-of-range values", () => {
    window.localStorage.setItem("test-divider", "350");
    const first = render(<Harness />);
    expect(paneWidth()).toBe("350px");
    first.unmount();

    window.localStorage.setItem("test-divider", "9999");
    render(<Harness />);
    expect(paneWidth()).toBe("200px");
  });

  test("unmount mid-drag removes document listeners and resets the cursor", () => {
    const { unmount } = render(<Harness />);
    fireEvent.mouseDown(screen.getByTestId("handle"), { clientX: 300 });
    unmount();
    expect(document.body.style.cursor).toBe("");
    // A stray listener would throw on a detached tree; this must be a no-op.
    fireEvent.mouseMove(document, { clientX: 390 });
    fireEvent.mouseUp(document);
  });
});
