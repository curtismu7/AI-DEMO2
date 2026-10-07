// A2aArchitecturePage.jsx — /a2a-architecture under Diagrams.
// Delegation flow: the original sequence diagram from docs/A2A_ARCHITECTURE.md, drawn as written by FlowDiagram
// (Mermaid-format text on React Flow, so the Mermaid library is never loaded).
// Card discovery: the original flowchart has a back-arrow cycle that FlowDiagram's auto-layout draws badly, so it
// is placed by hand with StaticFlowDiagram. Same three boxes and arrows as docs/a2a-card-discovery.mmd.
import React from "react";
import DiagramStepBar from "../DiagramStepBar";
import FlowDiagram from "../FlowDiagram";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../../hooks/useDiagramStepper";
import { DELEGATION_SOURCE, DISCOVERY_EDGES, DISCOVERY_GROUPS, DISCOVERY_NODES } from "./a2aArchitectureData";
import "../personalAgent/PersonalAgent.css";

function DiscoveryFigure() {
  const stepper = useDiagramStepper(DISCOVERY_EDGES.length);
  const captions = edgeCaptions(DISCOVERY_EDGES, Object.fromEntries(DISCOVERY_NODES.map((n) => [n.id, n.label])));
  return (
    <>
      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId="a2a-steps-discovery" />
      <figure className="pa-figure">
        <StaticFlowDiagram
          NODES={DISCOVERY_NODES}
          EDGES={DISCOVERY_EDGES}
          GROUPS={DISCOVERY_GROUPS}
          stepper={stepper}
          testId="a2a-diagram-discovery"
          height={400}
          ariaLabel="Card discovery. The generalist fetches the Agent Card from the well-known path for the vertical and reads its capabilities, then posts a JSON-RPC SendMessage to the specialist endpoint."
        />
      </figure>
    </>
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

      <section aria-label="Delegation flow" data-testid="a2a-delegation">
        <h2>Delegation flow</h2>
        <p>
          The wire hop carries the Exchange #1 delegated token, which proves the user. The specialist performs
          Exchange #2 itself, after the hop arrives.
        </p>
        <figure className="pa-figure">
          <FlowDiagram source={DELEGATION_SOURCE} label="Delegation flow" />
        </figure>
      </section>

      <section aria-label="Card discovery" data-testid="a2a-discovery">
        <h2>Card discovery</h2>
        <p>The generalist reads the specialist's Agent Card, then posts a JSON-RPC SendMessage to it.</p>
        <DiscoveryFigure />
      </section>
    </main>
  );
}
