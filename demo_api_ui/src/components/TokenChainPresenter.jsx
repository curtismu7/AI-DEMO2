// demo_api_ui/src/components/TokenChainPresenter.jsx
//
// Room-sized view of one chain step. The rail is built for someone sitting at
// the screen; this is for everyone else in the room — one hop at a time, type
// large enough to read from the back, arrow keys to move, Escape to leave.
//
// It owns no data. Same `steps` array and same `activeId` as the rail and the
// chain map, so Run keeps walking while it is open and closing it lands you on
// whatever step you finished on.
import React, { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import "./TokenChainPresenter.css";

const STATUS_TEXT = {
  done: "Completed",
  pending: "Not yet run",
  notinpath: "Not in this path",
  denied: "Denied",
  error: "Error",
};

export default function TokenChainPresenter({ steps, activeId, onSelect, onClose }) {
  const count = Array.isArray(steps) ? steps.length : 0;
  const index = count ? steps.findIndex((s) => s.id === activeId) : -1;
  const at = index < 0 ? 0 : index;
  const step = count ? steps[at] : null;

  const go = useCallback(
    (delta) => {
      if (!count) return;
      const next = Math.min(count - 1, Math.max(0, at + delta));
      if (next !== at && typeof onSelect === "function") onSelect(steps[next].id);
    },
    [at, count, steps, onSelect],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!step) return null;

  const kv = Array.isArray(step.detail?.kv) ? step.detail.kv.slice(0, 6) : [];
  const rfcs = Array.isArray(step.detail?.rfcs) ? step.detail.rfcs : [];

  // Portalled to <body>: the rail lives inside a `.section`, and app-level
  // descendant rules (`.section h2 { font-size: 1.15rem }`) out-specify a plain
  // `.tcp-title` class, which quietly shrank the presenter's headline to 18px.
  // Rendering outside that subtree removes the whole category of collision
  // rather than out-specifying one rule at a time.
  return createPortal(
    <div className="tcp" role="dialog" aria-modal="true" aria-label="Token chain presenter">
      <div className="tcp-top">
        <span className="tcp-count">
          Step {at + 1} of {count}
        </span>
        <span className="tcp-lane">{step.lane}</span>
        <span className={`tcp-status tcp-status--${step.status || "pending"}`}>
          {STATUS_TEXT[step.status] || step.status}
        </span>
        <button type="button" className="tcp-close" onClick={onClose}>
          Close &#10005;
        </button>
      </div>

      <h2 className="tcp-title">{step.title}</h2>

      {step.detail?.narrative ? <p className="tcp-what">{step.detail.narrative}</p> : null}

      {kv.length > 0 ? (
        <dl className="tcp-kv">
          {kv.map(([k, v]) => (
            <div className="tcp-kv-row" key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {rfcs.length > 0 ? (
        <div className="tcp-rfcs">
          {rfcs.map((r) => (
            <span className="tcp-rfc" key={typeof r === "string" ? r : r.label}>
              {typeof r === "string" ? r : r.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="tcp-foot">
        <div className="tcp-bar" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`tcp-seg${i < at ? " tcp-seg--done" : ""}${i === at ? " tcp-seg--on" : ""}`}
            />
          ))}
        </div>
        <div className="tcp-nav">
          <button type="button" onClick={() => go(-1)} disabled={at === 0}>
            Prev
          </button>
          <button type="button" onClick={() => go(1)} disabled={at >= count - 1}>
            Next
          </button>
        </div>
        <span className="tcp-hint">Arrow keys move &middot; Escape closes</span>
      </div>
    </div>,
    document.body,
  );
}
