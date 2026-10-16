import { useState } from "react";
import StaticFlowDiagram from "../components/StaticFlowDiagram";
import DiagramStepBar from "../components/DiagramStepBar";
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { NODES, EDGES, GROUPS, walk, PANELS } from "./chatgptLoginDiagram";
import "../components/UseCaseDiagramPage.css";
import "./ChatgptLoginPage.css";

// Same page anatomy as /use-case-diagrams/:ucId (UseCaseDiagramPage): step bar, StaticFlowDiagram, hop panel.
function WireRows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="ucd-wire">
      {rows.map((r, i) => (
        <div key={i} className="ucd-wire__row">
          <span className={`ucd-wire__tag ucd-wire__tag--${r.t.toLowerCase()}`}>{r.t}</span>
          <code>{r.c}</code>
        </div>
      ))}
    </div>
  );
}

export default function ChatgptLoginPage() {
  const stepper = useDiagramStepper(walk.length);
  const [pickedNode, setPickedNode] = useState(null);
  const hop = stepper.step >= 0 ? walk[stepper.step] : null;
  const picked = pickedNode ? NODES.find((n) => n.id === pickedNode) : null;

  return (
    <main className="ucd-page">
      <header className="ucd-head">
        <div className="ucd-head__row1">
          <h1>How ChatGPT Requests User Login</h1>
        </div>
        <p className="ucd-desc">MCP signals the requirement. ChatGPT opens the flow. Your identity service authenticates the user.</p>
      </header>

      <DiagramStepBar stepper={stepper} testId="chatgpt-login-stepbar" />

      <StaticFlowDiagram
        NODES={NODES}
        EDGES={EDGES}
        GROUPS={GROUPS}
        walk={walk}
        stepper={stepper}
        onNodeClick={(node) => setPickedNode((prev) => (prev === node.id ? null : node.id))}
        testId="chatgpt-login-diagram"
        ariaLabel="How ChatGPT requests user login"
      />

      <section className="ucd-panel" data-testid="chatgpt-login-panel">
        <span className="ucd-panel__chip">{picked ? picked.label.toUpperCase() : hop ? `STEP ${stepper.step + 1} / ${walk.length}` : "DETAILS"}</span>
        <div className="ucd-panel__body">
          {picked ? (
            <p className="ucd-panel__line">{picked.detail}</p>
          ) : hop ? (
            <>
              <div className="ucd-panel__hop"><b>{hop.title}</b> — {hop.label}</div>
              {hop.lines.map((l, i) => <p key={i} className="ucd-panel__line">{l.who}: {l.text}</p>)}
              <WireRows rows={hop.tech} />
            </>
          ) : (
            <p className="ucd-panel__hint">Press Simulate to walk the flow; click a node for its detail.</p>
          )}
        </div>
      </section>

      <div className="cl-panels">
        {PANELS.map((p) => (
          <section key={p.title} className="cl-panel">
            <h3>{p.title}</h3>
            <ol>{p.items.map((it) => <li key={it}>{it}</li>)}</ol>
            <div className="cl-panel__foot">{p.foot}</div>
          </section>
        ))}
      </div>
      <p className="cl-page__src">OAuth authorization code + PKCE (RFC 7636) · MCP resource-bound access token (RFC 8707 / RFC 9728) · Source: developers.openai.com Apps SDK auth</p>
    </main>
  );
}
