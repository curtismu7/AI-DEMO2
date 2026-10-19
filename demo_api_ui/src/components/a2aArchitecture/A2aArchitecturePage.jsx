// A2aArchitecturePage.jsx — /a2a-architecture under Diagrams.
// Both figures are StaticFlowDiagram in the Ping style (a2aArchitectureDiagram.js: boxes, numbered arrows, request form,
// MOCK tokens and standards per step). The delegation figure is docs/a2a-delegation-sequence.mmd drawn as boxes; the
// .mmd text itself stays exported as DELEGATION_SOURCE (a2aArchitectureData.js) for the Lucid paste and its drift test.
import React from "react";
import DiagramStepBar from "../DiagramStepBar";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../../hooks/useDiagramStepper";
import { DELEGATION_DIAGRAM, DISCOVERY_DIAGRAM } from "../../config/a2aArchitectureDiagram";
import "../personalAgent/PersonalAgent.css";

function Figure({ config, testId, stepsTestId, ariaLabel }) {
  const { GROUPS, NODES, EDGES, STEPS } = config;
  const stepper = useDiagramStepper(EDGES.length);
  const captions = edgeCaptions(EDGES, Object.fromEntries(NODES.map((n) => [n.id, n.label])));
  const usedGroups = [...new Set(NODES.map((n) => n.group))];
  return (
    <>
      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={stepsTestId} />
      <figure className="pa-figure">
        <StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={GROUPS} stepper={stepper} pingStyle steps={STEPS} testId={testId} height={560} ariaLabel={ariaLabel} />
        <ul className="pa-legend" aria-label="Legend">
          {usedGroups.map((g) => (
            <li key={g}><i className="pa-sw" style={{ borderTopColor: GROUPS[g].bg }} />{GROUPS[g].label}</li>
          ))}
        </ul>
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
          Exchange #2 itself, after the hop arrives. Click a box or an arrow to see the request, the MOCK tokens and
          the standards for that step.
        </p>
        <Figure
          config={DELEGATION_DIAGRAM}
          testId="a2a-diagram-delegation"
          stepsTestId="a2a-steps-delegation"
          ariaLabel="Delegation flow. The browser asks the generalist. The generalist exchanges the user token at PingOne for a delegated token, sends it to the specialist over the A2A wire. The specialist exchanges it for a nested-act token, calls the MCP gateway, which asks PingOne Authorize to decide, and the result returns as data only."
        />
      </section>

      <section aria-label="Card discovery" data-testid="a2a-discovery">
        <h2>Card discovery</h2>
        <p>The generalist reads the specialist's Agent Card, then posts a JSON-RPC SendMessage to it.</p>
        <Figure
          config={DISCOVERY_DIAGRAM}
          testId="a2a-diagram-discovery"
          stepsTestId="a2a-steps-discovery"
          ariaLabel="Card discovery. The generalist fetches the Agent Card from the well-known path for the vertical and reads its capabilities, then posts a JSON-RPC SendMessage to the specialist endpoint."
        />
      </section>
    </main>
  );
}
