import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LessonLayout, Section } from "../components/lesson";
import "./AgentGatewayAuthorizationLessonPage.css";

const LESSON_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "concepts", label: "Key concepts" },
  { id: "flow", label: "Request flow" },
  { id: "try-it-live", label: "Try it" },
  { id: "summary", label: "What happened" },
];

const FLOW_NODES = [
  { id: "user", label: "User / agent", detail: "The agent starts an action on behalf of an identified user." },
  { id: "gateway", label: "Agent Gateway", detail: "The gateway validates MCP structure, token, scope, actor, and request context before forwarding anything." },
  { id: "authorize", label: "PingOne Authorize", detail: "The policy decision service evaluates identity, resource, operation, consent, and real-time context." },
  { id: "resource", label: "Protected resource", detail: "The MCP server or API receives the request only after the gateway gets a permitted decision." },
];

const SCENARIOS = [
  {
    id: "balance",
    label: "Read account balance",
    outcome: "PERMIT",
    detail: "A low-risk read is allowed for the signed-in user.",
    request: { tool: "get_account_balance", scope: "accounts:read", amount: 0 },
  },
  {
    id: "transfer",
    label: "Transfer $500",
    outcome: "STEP-UP",
    detail: "The operation is valid, but policy requires stronger user verification before execution.",
    request: { tool: "create_transfer", scope: "transfers:write", amount: 500 },
  },
  {
    id: "untrusted",
    label: "Transfer to blocked payee",
    outcome: "DENY",
    detail: "The request reaches the policy boundary but is blocked by the current context and policy.",
    request: { tool: "create_transfer", scope: "transfers:write", payee: "blocked-payee", amount: 100 },
  },
];

function FlowDiagram({ selected, onSelect }) {
  return (
    <div className="agal-flow" aria-label="Agent authorization request flow">
      {FLOW_NODES.map((node, index) => (
        <div key={node.id} className="agal-flow-item">
          <button
            type="button"
            className={`agal-node${selected === node.id ? " agal-node--active" : ""}`}
            onClick={() => onSelect(node.id)}
            aria-pressed={selected === node.id}
          >
            <span className="agal-node-number">{index + 1}</span>
            <strong>{node.label}</strong>
          </button>
          {index < FLOW_NODES.length - 1 ? <span className="agal-arrow" aria-hidden="true">→</span> : null}
        </div>
      ))}
    </div>
  );
}

export default function AgentGatewayAuthorizationLessonPage() {
  const [selectedNode, setSelectedNode] = useState("gateway");
  const [scenarioId, setScenarioId] = useState("balance");
  const [ran, setRan] = useState(false);
  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioId) || SCENARIOS[0], [scenarioId]);
  const node = FLOW_NODES.find((item) => item.id === selectedNode) || FLOW_NODES[1];

  const runScenario = (id) => {
    setScenarioId(id);
    setRan(true);
    setSelectedNode(id === "balance" ? "resource" : "authorize");
  };

  return (
    <LessonLayout
      title="Secure Agent Access"
      subtitle="See how an Agent Gateway validates and enforces an agent request, while PingOne Authorize supplies the policy decision."
      sections={LESSON_SECTIONS}
      storageKey="agent-gateway-authorization-lesson-nav-width"
    >
      <Section id="overview" title="Overview">
        <div className="agal-hero">
          <div>
            <p className="agal-eyebrow">Agent Gateway + PingOne Authorize</p>
            <h2>Authentication identifies the actor. Authorization decides the action.</h2>
            <p>
              Follow one MCP request from the user through the Agent Gateway, into PingOne Authorize, and back to the protected resource.
            </p>
          </div>
          <div className="agal-outcome-card">
            <span>Decision vocabulary</span>
            <strong>PERMIT · DENY · STEP-UP</strong>
            <small>The gateway enforces the returned outcome.</small>
          </div>
        </div>
      </Section>

      <Section id="concepts" title="Key concepts">
        <div className="agal-card-grid">
          <article className="agal-card"><h3>Agent Gateway</h3><p>Runtime boundary for MCP traffic: validates messages, checks tokens and scopes, records actors, applies throttling, and forwards permitted calls.</p></article>
          <article className="agal-card"><h3>PingOne Authorize</h3><p>Centralized policy decision service that evaluates identity, resource, operation, attributes, consent, and context.</p></article>
          <article className="agal-card"><h3>Protected resource</h3><p>The API or MCP server stays behind the enforcement point and executes only after the request is authorized.</p></article>
        </div>
        <p className="agal-source-note">This lesson is based on the provided authorization materials and Ping Identity documentation for PingOne Authorize and the PingGateway Agent Gateway module.</p>
      </Section>

      <Section id="flow" title="Request flow">
        <p>Click each stage to focus the explanation.</p>
        <FlowDiagram selected={selectedNode} onSelect={setSelectedNode} />
        <div className="agal-detail" aria-live="polite">
          <strong>{node.label}</strong>
          <p>{node.detail}</p>
        </div>
      </Section>

      <Section id="try-it-live" title="Try it">
        <p>Run a guided scenario. These outcomes mirror the app’s existing authorization and gateway demos; the page makes the decision logic easy to explain before opening the live inspector.</p>
        <div className="agal-demo-grid">
          <div className="agal-card">
            <h3>Choose a request</h3>
            <div className="agal-scenarios">
              {SCENARIOS.map((item) => (
                <button key={item.id} type="button" className={`agal-scenario${scenarioId === item.id ? " agal-scenario--active" : ""}`} onClick={() => runScenario(item.id)}>
                  <span>{item.label}</span><strong>{item.outcome}</strong>
                </button>
              ))}
            </div>
            {ran ? <div className={`agal-result agal-result--${scenario.outcome.toLowerCase()}`}><strong>{scenario.outcome}</strong><p>{scenario.detail}</p></div> : <p className="agal-ready">Select a scenario to walk through its decision.</p>}
          </div>
          <div className="agal-card">
            <h3>Decision request</h3>
            <pre>{JSON.stringify({ actor: "demo-user", resource: "banking-mcp", operation: scenario.request.tool, context: scenario.request }, null, 2)}</pre>
            <div className="agal-links"><Link to="/agent-gateway-capabilities">Open Agent Gateway Inspector</Link><Link to="/pingone-authorize?tab=guided">Open Authorize tester</Link></div>
          </div>
        </div>
      </Section>

      <Section id="summary" title="What happened">
        <ol className="agal-summary">
          <li>The agent requested an operation for an identified user.</li>
          <li>The Agent Gateway validated and inspected the request.</li>
          <li>PingOne Authorize evaluated policy and context.</li>
          <li>The gateway enforced the result before the resource was reached.</li>
        </ol>
      </Section>
    </LessonLayout>
  );
}
