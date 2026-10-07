// CimdPrivilegePage.jsx — /cimd-privilege under Diagrams.
// Two figures in the Personal Agent format: React Flow (StaticFlowDiagram) driven by the shared Play/Step
// bar, with one card per step underneath. Each card says what happens, why it matters, and whether it was
// observed or is still expected, so the page can be shown to others without overclaiming.
import React from "react";
import DiagramStepBar from "../DiagramStepBar";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../../hooks/useDiagramStepper";
import {
  ASSUMPTIONS,
  CAP_EDGES,
  CAP_GROUPS,
  CAP_NODES,
  CAP_STEPS,
  FLOW_EDGES,
  FLOW_GROUPS,
  FLOW_NODES,
  FLOW_STEPS,
  STATUS,
} from "./cimdPrivilegeData";
import "../personalAgent/PersonalAgent.css";

function Figure({ id, title, intro, nodes, edges, groups, steps, ariaLabel }) {
  const stepper = useDiagramStepper(edges.length);
  const names = Object.fromEntries(nodes.map((n) => [n.id, n.label]));
  const captions = edgeCaptions(edges, names);
  const usedGroups = [...new Set(nodes.map((n) => n.group))];

  return (
    <section aria-label={title} data-testid={`cimd-${id}`}>
      <h2>{title}</h2>
      <p>{intro}</p>

      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={`cimd-steps-${id}`} />

      <figure className="pa-figure">
        <StaticFlowDiagram
          NODES={nodes}
          EDGES={edges}
          GROUPS={groups}
          stepper={stepper}
          testId={`cimd-diagram-${id}`}
          height={560}
          ariaLabel={ariaLabel}
        />
        <ul className="pa-legend" aria-label="Legend">
          {usedGroups.map((g) => (
            <li key={g}>
              <i className={`pa-sw pa-sw--${g}`} />
              {groups[g].label}
            </li>
          ))}
        </ul>
      </figure>

      <ol className="pa-step-list" aria-label={`${title}, step by step`}>
        {steps.map((s, i) => {
          const active = stepper.active && s.edges.includes(stepper.step);
          return (
            <li key={s.key} className={`pa-step${active ? " pa-step--active" : ""}`} data-testid={`cimd-${id}-step-${i + 1}`}>
              <h3>
                <span className="pa-step-n">{i + 1}</span>
                {s.title}
              </h3>
              <dl>
                <div>
                  <dt>What happens</dt>
                  <dd>{s.what}</dd>
                </div>
                <div>
                  <dt>Why it matters</dt>
                  <dd>{s.why}</dd>
                </div>
                <div className="pa-today">
                  <dt>{STATUS[s.status]}</dt>
                  <dd>{s.evidence}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function CimdPrivilegePage() {
  return (
    <main className="pa-page" data-testid="cimd-privilege-page">
      <header className="pa-hero">
        <div className="pa-eyebrow">Privilege · client documents</div>
        <h1>CIMD in Privilege</h1>
        <p>
          A Client ID Metadata Document lets an AI client identify itself to Privilege with a web address instead of a
          registration. The client's client_id is the address of a small JSON file. Privilege keeps a list of the
          addresses it accepts, fetches each one, and reads the client's name and redirect addresses from it.
        </p>
      </header>

      <Figure
        id="flow"
        title="How it works"
        intro="One client, from its first request to a tool call. Press Play or step through the arrows."
        nodes={FLOW_NODES}
        edges={FLOW_EDGES}
        groups={FLOW_GROUPS}
        steps={FLOW_STEPS}
        ariaLabel="How a client that identifies itself by a document URL is admitted by Privilege. The client authorizes with its document URL as client_id. Privilege checks the URL against its MCP Client Documents list, fetches the document, signs the user in at PingOne, sends the code to a redirect URI named in the document, exchanges the code with PKCE, and then forwards the client's tool call to the MCP server."
      />

      <Figure
        id="capabilities"
        title="What it can do"
        intro="What a stable, published identity gives each agent. Green is observed in the console or on the live host. Amber follows from the design and is still to be tested."
        nodes={CAP_NODES}
        edges={CAP_EDGES}
        groups={CAP_GROUPS}
        steps={CAP_STEPS}
        ariaLabel="What a client document gives an agent. The document URL names the client, is checked against an admin allow-list, and declares a public client with no secret. A named client can be targeted by per-client policy and appear by name in audit. Listed clients are admitted by URL without calling the registration endpoint, the same way Claude identifies itself."
      />

      <section className="pa-assume" aria-label="Assumptions and open checks">
        <h2>Assumptions and open checks</h2>
        <ul>
          {ASSUMPTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
