// A2aArchitecturePage.jsx — /a2a-architecture under Diagrams.
// The two figures from docs/A2A_ARCHITECTURE.md as React Flow, driven by the shared Play/Step bar.
import React from "react";
import DiagramStepBar from "../DiagramStepBar";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../../hooks/useDiagramStepper";
import {
  DELEGATION_EDGES,
  DELEGATION_NODES,
  DISCOVERY_EDGES,
  DISCOVERY_NODES,
  GROUPS,
} from "./a2aArchitectureData";
import "../personalAgent/PersonalAgent.css";

function Figure({ id, title, intro, nodes, edges, ariaLabel }) {
  const stepper = useDiagramStepper(edges.length);
  const captions = edgeCaptions(edges, Object.fromEntries(nodes.map((n) => [n.id, n.label])));
  const usedGroups = [...new Set(nodes.map((n) => n.group))];

  return (
    <section aria-label={title} data-testid={`a2a-${id}`}>
      <h2>{title}</h2>
      <p>{intro}</p>
      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={`a2a-steps-${id}`} />
      <figure className="pa-figure">
        <StaticFlowDiagram
          NODES={nodes}
          EDGES={edges}
          GROUPS={GROUPS}
          stepper={stepper}
          testId={`a2a-diagram-${id}`}
          height={560}
          ariaLabel={ariaLabel}
        />
        <ul className="pa-legend" aria-label="Legend">
          {usedGroups.map((g) => (
            <li key={g}>
              <i className={`pa-sw pa-sw--${g}`} />
              {GROUPS[g].label}
            </li>
          ))}
        </ul>
      </figure>
    </section>
  );
}

export default function A2aArchitecturePage() {
  return (
    <main className="pa-page" data-testid="a2a-architecture-page">
      <header className="pa-hero">
        <div className="pa-eyebrow">Agents · A2A</div>
        <h1>A2A Architecture</h1>
        <p>
          Two layers share the name A2A: the identity chain (nested RFC 8693 act claims approved by PingOne Authorize)
          and the wire protocol (Agent Card discovery plus JSON-RPC SendMessage over a separate PingOne bearer). The
          protocol runs only in UC2 and UC2.5.
        </p>
      </header>

      <Figure
        id="delegation"
        title="Delegation flow"
        intro="The wire hop carries the Exchange #1 delegated token, which proves the user. The specialist performs Exchange #2 itself, after the hop arrives."
        nodes={DELEGATION_NODES}
        edges={DELEGATION_EDGES}
        ariaLabel="UC2 delegation. The browser calls the generalist agent, which exchanges the user token at PingOne Authorize, then sends an A2A SendMessage to the specialist with that token. The specialist makes a nested-act exchange at PingOne Authorize and calls the A2A MCP gateway with the nested-act token."
      />

      <Figure
        id="discovery"
        title="Card discovery"
        intro="The generalist reads the specialist's Agent Card, then posts a JSON-RPC SendMessage to it."
        nodes={DISCOVERY_NODES}
        edges={DISCOVERY_EDGES}
        ariaLabel="Card discovery. The generalist fetches the Agent Card from the well-known path for the vertical, then posts a JSON-RPC SendMessage to the specialist endpoint."
      />
    </main>
  );
}
