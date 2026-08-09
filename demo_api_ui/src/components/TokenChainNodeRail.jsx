// demo_api_ui/src/components/TokenChainNodeRail.jsx
//
// Horizontal map of the token chain, shown above the step cards in
// TokenChainTraceRail. Two densities:
//
//   detailed (default) — a card per hop carrying lane, short title and the one
//                        fact that matters (status, or the first kv pair the
//                        step already produced)
//   compact            — the original small numbered circles
//
// Consumes the SAME `steps` array the rail already resolved, so Live mode still
// shows only observed hops and Classic still shows the fixed catalog — this
// component never decides which steps exist (REGRESSION_PLAN §4, 2026-08-05).
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./TokenChainNodeRail.css";

const DENSITY_KEY = "tctr_node_density";
const SPEED_KEY = "tctr_run_speed";

/** Walk-through speeds, fastest first — "Run" is the default for demo setup. */
export const SPEEDS = [
  { ms: 400, label: "Run" },
  { ms: 900, label: "Fast" },
  { ms: 1800, label: "Steady" },
  { ms: 3200, label: "Slow" },
];

/** @returns {"detailed"|"compact"} */
export function readDensity() {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "detailed";
  } catch {
    return "detailed";
  }
}

/** @returns {number} milliseconds per step */
export function readSpeed() {
  try {
    const stored = Number(window.localStorage.getItem(SPEED_KEY));
    return SPEEDS.some((s) => s.ms === stored) ? stored : SPEEDS[0].ms;
  } catch {
    return SPEEDS[0].ms;
  }
}

/**
 * Terse map labels, keyed by step id. Deliberately NOT the step's own title:
 * a 124px node cannot hold "Step-up required — HITL / MFA", and repeating the
 * card's exact wording would make the map a second copy of the list rather
 * than an index into it.
 */
const NODE_LABELS = {
  website: "Browser",
  signin: "Sign-in",
  prompt: "Prompt",
  agent: "Agent",
  llm: "LLM",
  "agent-token": "Agent token",
  exchange: "Exchange",
  authorize: "Authorize",
  stepup: "Step-up",
  "intent-binding": "Intent bind",
  gateway: "Gateway",
  "api-key-swap": "API key",
  mcp: "MCP",
  api: "Resource",
  database: "Database",
  reply: "Reply",
};

/**
 * Label for a node. Falls back to the first two words of the title for step ids
 * this map does not know about (A2A runs add their own), still short enough for
 * the card and still not a duplicate of the full title below.
 */
function nodeLabel(step) {
  if (NODE_LABELS[step.id]) return NODE_LABELS[step.id];
  const head = String(step.title || step.id || "").split(" — ")[0];
  const words = head.split(/\s+/).slice(0, 2).join(" ");
  return words.length > 16 ? `${words.slice(0, 15)}…` : words;
}

/**
 * The one line of evidence a node shows. Prefers the step's own first kv pair
 * (real data the step produced); falls back to the status so a node is never
 * blank and never invents a fact it does not have.
 */
function headline(step) {
  const kv = step?.detail?.kv;
  if (Array.isArray(kv) && kv.length > 0) {
    const [k, v] = kv[0];
    const val = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    if (val) return `${k} ${val.length > 18 ? `${val.slice(0, 17)}…` : val}`;
  }
  // Only "done" may say done. `active` means the hop is still in flight — an
  // authorize step awaiting a decision must never read as if it had succeeded,
  // and anything unrecognised falls back to the raw status rather than to a
  // claim the run has not earned.
  switch (step.status) {
    case "done":
      return "done";
    case "active":
      return "in flight";
    case "notinpath":
      return "not in this path";
    case "pending":
      return "waiting";
    case "denied":
      return "denied";
    case "error":
      return "error";
    default:
      return step.status ? String(step.status) : "waiting";
  }
}

export default function TokenChainNodeRail({ steps, activeId, onSelect, onPresent }) {
  const [density, setDensity] = useState(readDensity);
  const [speed, setSpeed] = useState(readSpeed);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_KEY, density);
    } catch {
      /* private mode — the toggle still works for this session */
    }
  }, [density]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      /* ignore */
    }
  }, [speed]);

  const select = useCallback(
    (id) => {
      if (typeof onSelect === "function") onSelect(id);
    },
    [onSelect],
  );

  const count = Array.isArray(steps) ? steps.length : 0;
  const atEnd = count > 0 && steps[count - 1]?.id === activeId;

  /**
   * Walk the chain on a timer. Plays THROUGH and stops on the last step rather
   * than looping: a looping walk-through never settles anywhere long enough to
   * read, which makes the detail below it useless during a demo.
   */
  // The tick reads live values through a ref rather than closing over them.
  // Depending on `steps`/`activeId`/`select` directly tore the interval down and
  // rebuilt it on every rail re-render — and the rail re-renders on every store
  // event and on window focus (trust-flag refetch). During a streaming run at
  // Steady or Slow that reset the timer faster than it could ever fire, so Run
  // silently never advanced.
  const tickRef = useRef(null);
  tickRef.current = () => {
    const at = steps.findIndex((s) => s.id === activeId);
    if (at >= steps.length - 1) {
      setRunning(false);
      return;
    }
    select(steps[at + 1].id);
  };

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => tickRef.current?.(), speed);
    return () => window.clearInterval(timer);
  }, [running, speed]);

  const toggleRun = useCallback(() => {
    if (running) {
      setRunning(false);
      return;
    }
    // Replay: restart from the top rather than sitting on the final step.
    if (atEnd || !activeId) select(steps[0].id);
    setRunning(true);
  }, [running, atEnd, activeId, steps, select]);

  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <div className="tcnr" data-density={density}>
      <div className="tcnr-head">
        <span className="tcnr-title">Chain map</span>
        <span className="tcnr-count">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>

        <button
          type="button"
          className="tcnr-run"
          data-state={running ? "running" : "paused"}
          onClick={toggleRun}
        >
          <span className="tcnr-run-ico" aria-hidden="true" />
          {running ? "Pause" : atEnd ? "Replay" : "Run"}
        </button>
        <select
          className="tcnr-speed"
          aria-label="Walk-through speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s.ms} value={s.ms}>
              {s.label}
            </option>
          ))}
        </select>

        {typeof onPresent === "function" ? (
          <button type="button" className="tcnr-present" onClick={onPresent}>
            Present
          </button>
        ) : null}

        <div className="tcnr-density">
          <button
            type="button"
            className={density === "detailed" ? "active" : ""}
            aria-pressed={density === "detailed"}
            onClick={() => setDensity("detailed")}
          >
            Detailed
          </button>
          <button
            type="button"
            className={density === "compact" ? "active" : ""}
            aria-pressed={density === "compact"}
            onClick={() => setDensity("compact")}
          >
            Compact
          </button>
        </div>
      </div>

      <ol className="tcnr-track">
        {steps.map((step, i) => (
          <li key={step.id} className="tcnr-item">
            <button
              type="button"
              // Selection is `--sel`, not `--active`: "active" is a real step
              // status (an exchange or authorize hop still in flight), so a
              // status modifier of `tcnr-node--active` would style an in-flight
              // node as the selected one and two nodes would read as current.
              className={`tcnr-node tcnr-node--${step.status || "pending"}${
                step.id === activeId ? " tcnr-node--sel" : ""
              }`}
              aria-current={step.id === activeId ? "step" : undefined}
              onClick={() => select(step.id)}
              title={step.title}
            >
              <span className="tcnr-node-top">
                <span className="tcnr-node-n">{i + 1}</span>
                <span className="tcnr-node-lane">{step.lane}</span>
              </span>
              <span className="tcnr-node-title">{nodeLabel(step)}</span>
              <span className="tcnr-node-fact">{headline(step)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
