// The rail's non-inline views, behind one trigger.
//
// Seven tabs no longer fit once the chain map and the step detail panel are
// present. Token Chain stays inline because it is the thing being taught; the
// other six become pop-outs, so a presenter can put Tokens on a second screen
// beside the chain instead of switching away from it.
//
// A <button> and a useState flag, not <details>: the native `open` attribute
// fights Testing Library's click semantics, and this menu is asserted on.
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./ChainViewMenu.css";

const VIEWS = [
  ["tokens", "Tokens", "Every token this run issued, with its claims."],
  ["mcp", "MCP", "The MCP tool calls and their results."],
  ["trust", "Trust", "DPoP and RAR proof-of-possession evidence."],
  ["simple", "Simple", "The chain as a short stepper."],
  ["detailed", "Detailed", "The chain as a full stepper, claim by claim."],
  ["demoTrack", "Demo Track", "The guided nine-step demo script."],
];

export default function ChainViewMenu({ steps, onOpenView, showTrust = true, mcpCount = 0 }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const count = Array.isArray(steps) ? steps.length : 0;
  // Trust only exists for ff_dpop / ff_rar runs. The rail drops a Trust
  // selection the moment that stops being true, so offering it unconditionally
  // would give the presenter an item that bounces straight back to the chain.
  const views = showTrust ? VIEWS : VIEWS.filter(([id]) => id !== "trust");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="cvm" ref={rootRef}>
      <button
        type="button"
        className="cvm-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Views
      </button>
      {open ? (
        <div className="cvm-pop">
          {views.map(([id, label, hint]) => (
            <button
              type="button"
              className="cvm-item"
              key={id}
              // The hint is inside the button, so without this the accessible
              // name would be "Tokens Every token this run issued…".
              aria-label={label}
              onClick={() => {
                onOpenView?.(id);
                close();
              }}
            >
              <span className="cvm-item-label">
                {label}
                {/* The MCP tab carried a done-call count; it must survive the
                    move into this menu. */}
                {id === "mcp" && mcpCount > 0 ? (
                  <span className="cvm-item-count">{mcpCount}</span>
                ) : null}
              </span>
              <span className="cvm-item-hint">{hint}</span>
            </button>
          ))}
          <p className="cvm-note">
            Token Chain runs inline, below{count ? ` — ${count} ${count === 1 ? "step" : "steps"}` : ""}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
