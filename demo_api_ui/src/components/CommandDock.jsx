// CommandDock — the demo-control tray that declutters the agent header.
// Collapsed: a single pill fixed top-right (clear of the agent FAB at
// bottom-right). Expanded: a FloatingPanel shell that keeps the shared
// drag / resize / pop-out (window.open + PopOutPortal) behavior, so the
// tray can be moved anywhere on screen or popped into its own browser
// window entirely.
//
// The panel content mounts only while open. Tests that exercise the moved
// controls click the pill first (getByRole("button", { name:
// /Demo Controls/i })), exactly like a presenter would.
import React from "react";
import FloatingPanel from "./FloatingPanel";
import "./CommandDock.css";

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

  return (
    <>
      {!open && (
        <button
          type="button"
          className="cmd-dock-pill"
          aria-expanded="false"
          onClick={() => onOpenChange(true)}
          title="Demo Controls — agent mode, surfaces, inspectors, session"
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
