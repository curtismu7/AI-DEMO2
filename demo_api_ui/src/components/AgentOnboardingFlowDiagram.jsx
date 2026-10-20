// AgentOnboardingFlowDiagram.jsx
// Step-through walkthrough of Tarun Madiraju's "Enterprise AI Onboarding &
// Governance Architecture" — a proposed target-state design, not a live trace.
// The diagram is the same React Flow graph as /agent-onboarding-flow-mermaid; each persona's
// scripted steps (data/agentOnboardingFlows.js) light the cards and links they touch, with the
// shared Play/Step bar, movie reel and details row.
// Spec: docs/superpowers/specs/2026-07-12-agent-onboarding-flow-diagram-design.md
import React, { useMemo, useState } from "react";
import StaticFlowDiagram from "./StaticFlowDiagram";
import { AOM_DETAILS, AOM_EDGES, AOM_GROUPS, AOM_NODES } from "./AgentOnboardingMermaidPage";
import { LEGEND, FLOWS, FLOW_ORDER } from "../data/agentOnboardingFlows";
import "./AgentOnboardingFlowDiagram.css";

// Each flow step names the cards it touches by `activeCardKeys`; the graph's nodes have their own ids.
const KEY_TO_NODE = {
  "entry-user": "A1",
  "entry-dev": "A2",
  "entry-admin": "A3",
  "agent-studio": "AS",
  orchestration: "ORCH",
  "privileges-gw": "PG",
  pinggateway: "PGW",
  pingauthorize: "PA",
  "privilege-discovery": "PD",
  "cloud-discovery-iga": "CD",
  "iga-ai": "IGA",
  runtime: "RT",
};

function toWalk(steps) {
  return steps.map((s) => {
    const nodes = [...new Set(s.activeCardKeys.map((k) => KEY_TO_NODE[k]).filter(Boolean))];
    const edges = AOM_EDGES.flatMap((e, i) => (nodes.includes(e[0]) && nodes.includes(e[1]) ? [i] : []));
    return { title: s.title, label: s.narrative, lines: [{ who: "", text: s.narrative }], nodes, edges };
  });
}

export default function AgentOnboardingFlowDiagram() {
  const [flowKey, setFlowKey] = useState(FLOW_ORDER[0]);
  const [story, setStory] = useState("browserDevice");

  const flow = FLOWS[flowKey];
  const steps = flowKey === "admin" ? flow.stories[story].steps : flow.steps;
  const walk = useMemo(() => toWalk(steps), [steps]);
  const outcome = flowKey === "admin" ? FLOWS.admin.stories[story].outcome : flow.outcome;

  return (
    <div className="aof-page">
      <section className="aof-hero">
        <span className="aof-eyebrow">Proposed architecture — T. Madiraju</span>
        <h1>Enterprise AI Onboarding &amp; Governance Architecture</h1>
        <p className="aof-subhead">
          Illustrative walkthrough of a target-state design: any AI agent should
          automatically become a managed enterprise identity, with governance,
          privileges, and security applied throughout its lifecycle. This is a
          scripted walkthrough, not a live trace — most of the components shown
          here are not yet built in this demo.
        </p>
        <a
          className="learning-hub__weblink aof-share-link"
          href="/learning-mirror/agent-onboarding-flow.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the static web copy of this diagram ↗
        </a>
      </section>

      <div className="aof-root">
        <div className="aof-flow-tabs" role="tablist" aria-label="Onboarding flow">
          {FLOW_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={flowKey === key}
              className={`aof-flow-tab${flowKey === key ? " active" : ""}`}
              onClick={() => setFlowKey(key)}
            >
              {FLOWS[key].label}
            </button>
          ))}
        </div>

        {flowKey === "admin" && (
          <div className="aof-story-tabs" role="tablist" aria-label="Discovery story">
            {Object.entries(FLOWS.admin.stories).map(([key, s]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={story === key}
                className={`aof-story-tab${story === key ? " active" : ""}`}
                onClick={() => setStory(key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <p className="aof-persona">Persona: {flow.persona}</p>

        {/* keyed by flow + story so switching resets the walkthrough to the start */}
        <StaticFlowDiagram
          key={`${flowKey}-${story}`}
          NODES={AOM_NODES}
          EDGES={AOM_EDGES}
          GROUPS={AOM_GROUPS}
          walk={walk}
          details={AOM_DETAILS}
          pingStyle
          testId="aof-flow-diagram"
          ariaLabel="Onboarding architecture diagram"
        />

        <div className="aof-legend" aria-label="Flow step legend">
          <span className="aof-legend-title">Legend</span>
          {LEGEND.map((l) => (
            <span key={l.num} className="aof-legend-entry">
              <span className={`aof-legend-badge aof-legend-badge--${l.num}`}>{l.num}</span>
              {l.label}
            </span>
          ))}
        </div>

        <div className="aof-outcome">
          <strong>Outcome:</strong> {outcome}
        </div>
      </div>
    </div>
  );
}
