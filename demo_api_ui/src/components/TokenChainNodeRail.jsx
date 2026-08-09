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
import React, { useCallback, useEffect, useState } from "react";
import "./TokenChainNodeRail.css";

const DENSITY_KEY = "tctr_node_density";

/** @returns {"detailed"|"compact"} */
export function readDensity() {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "detailed";
  } catch {
    return "detailed";
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
  if (step.status === "notinpath") return "not in this path";
  if (step.status === "pending") return "waiting";
  if (step.status === "denied") return "denied";
  if (step.status === "error") return "error";
  return "done";
}

export default function TokenChainNodeRail({ steps, activeId, onSelect }) {
  const [density, setDensity] = useState(readDensity);

  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_KEY, density);
    } catch {
      /* private mode — the toggle still works for this session */
    }
  }, [density]);

  const select = useCallback(
    (id) => {
      if (typeof onSelect === "function") onSelect(id);
    },
    [onSelect],
  );

  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <div className="tcnr" data-density={density}>
      <div className="tcnr-head">
        <span className="tcnr-title">Chain map</span>
        <span className="tcnr-count">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>
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
              className={`tcnr-node tcnr-node--${step.status || "pending"}${
                step.id === activeId ? " tcnr-node--active" : ""
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
