// The rail's non-inline views, behind one trigger.
//
// Seven tabs no longer fit once the chain map and the step detail panel are
// present. Token Chain stays inline because it is the thing being taught; the
// other six become pop-outs, so a presenter can put Tokens on a second screen
// beside the chain instead of switching away from it.
//
// A <button> and a useState flag, not <details>: the native `open` attribute
// fights Testing Library's click semantics, and this menu is asserted on.
//
// The popover PORTALS to document.body with fixed positioning. In split
// layout the token card is an overflow-y:auto scroll container, and on the
// short views (Simple/Detailed) an absolutely-positioned popover taller than
// the space below the trigger was clipped mid-list — the presenter could see
// Tokens/MCP/Trust and nothing else (reported live 2026-08-10). A portal has
// no clipping ancestor to fight.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // Fixed-position coords for the portaled popover, derived from the trigger's
  // rect at open time (top-left origin; right-aligned to the trigger).
  const [popPos, setPopPos] = useState(null);
  const rootRef = useRef(null);
  const popRef = useRef(null);
  const count = Array.isArray(steps) ? steps.length : 0;
  // Trust only exists for ff_dpop / ff_rar runs. The rail drops a Trust
  // selection the moment that stops being true, so offering it unconditionally
  // would give the presenter an item that bounces straight back to the chain.
  const views = showTrust ? VIEWS : VIEWS.filter(([id]) => id !== "trust");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      // The popover is portaled, so the trigger's subtree no longer contains
      // it — both refs must vouch for the click.
      if (!rootRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    // Any scroll (capture phase catches the card's own scroll container, which
    // never bubbles to window) would leave a fixed-position popover floating
    // detached from its trigger — close instead of chasing it.
    const onScroll = () => close();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  return (
    <div className="cvm" ref={rootRef}>
      <button
        type="button"
        className="cvm-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPopPos({
            top: rect.bottom + 5,
            right: Math.max(8, window.innerWidth - rect.right),
          });
          setOpen((v) => !v);
        }}
      >
        Views
      </button>
      {open ? createPortal(
        <div
          className="cvm-pop"
          ref={popRef}
          style={popPos ? { top: popPos.top, right: popPos.right } : undefined}
        >
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
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
