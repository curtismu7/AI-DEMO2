import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LessonLayout, Section } from "../components/lesson";
import { callMcpTool } from "../services/demoAgentService";
import "./AgentGatewayAuthorizationLessonPage.css";

const LESSON_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "concepts", label: "Key concepts" },
  { id: "flow", label: "Request flow" },
  { id: "try-it-live", label: "Try it" },
  { id: "summary", label: "What happened" },
];

const FLOW_NODES = [
  { id: "user", label: "User / agent", detail: "The agent proposes an operation for an identified user. The model does not hold the user’s credential or decide whether the action is allowed." },
  { id: "gateway", label: "Agent Gateway", detail: "The gateway is the enforcement point: it validates MCP structure, token signature and audience, scopes, actor chain, rate limits, and the request context before forwarding anything." },
  { id: "authorize", label: "PingOne Authorize", detail: "The policy decision point evaluates the subject, acting agent, action, resource, attributes, consent, and runtime context. It returns a decision and may attach an obligation such as step-up." },
  { id: "resource", label: "Protected resource", detail: "The MCP server or API receives the request only after the gateway gets a permitted decision. It can still perform its own validation as defense in depth." },
];

const SCENARIOS = [
  {
    id: "balance",
    label: "Read account balance",
    outcome: "PERMIT",
    detail: "A low-risk read is allowed for the signed-in user.",
    request: { tool: "get_account_balance", scope: "accounts:read", account_id: "checking" },
  },
  {
    id: "transfer",
    label: "Transfer $500",
    outcome: "STEP-UP",
    detail: "The operation is valid, but policy requires stronger user verification before execution.",
    request: { tool: "create_transfer", scope: "transfers:write", from_account_id: "checking", to_account_id: "savings", amount: 500 },
  },
  {
    id: "untrusted",
    label: "Transfer to blocked payee",
    outcome: "DENY",
    detail: "The request reaches the policy boundary but is blocked by the current context and policy.",
    request: { tool: "create_transfer", scope: "transfers:write", from_account_id: "checking", to_account_id: "blocked-payee", amount: 100 },
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
  const [liveResult, setLiveResult] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioId) || SCENARIOS[0], [scenarioId]);
  const node = FLOW_NODES.find((item) => item.id === selectedNode) || FLOW_NODES[1];

  const runScenario = (id) => {
    setScenarioId(id);
    setRan(true);
    setLiveResult(null);
    setLiveError(null);
    setSelectedNode(id === "balance" ? "resource" : "authorize");
  };

  const runLiveScenario = async () => {
    setLiveBusy(true);
    setLiveResult(null);
    setLiveError(null);
    try {
      const { result } = await callMcpTool(scenario.request.tool, scenario.request, {
        useCaseId: scenario.id === "balance" ? "view_balance" : "step-up-required",
      });
      setLiveResult(result || { status: "completed" });
      setSelectedNode(scenario.outcome === "PERMIT" ? "resource" : "authorize");
    } catch (error) {
      setLiveError(error);
      setSelectedNode("authorize");
    } finally {
      setLiveBusy(false);
    }
  };

  const liveDecision = liveResult?.mcpAuthorizeEvaluation?.decision
    || liveResult?.authorizeEvaluation?.decision
    || liveResult?.decision
    || null;

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
          <article className="agal-card"><h3>Agent Gateway</h3><p>Runtime boundary for MCP traffic. It validates messages, checks tokens and scopes, records actors, applies throttling, and forwards permitted calls.</p></article>
          <article className="agal-card"><h3>PingOne Authorize</h3><p>Centralized policy decision service. It evaluates identity, resource, operation, attributes, consent, and context without embedding policy in every agent or API.</p></article>
          <article className="agal-card"><h3>Protected resource</h3><p>The API or MCP server stays behind the enforcement point and executes only after the request is authorized. The resource remains a second validation boundary.</p></article>
          <article className="agal-card"><h3>Authentication</h3><p>Answers “who is this?” A token can identify the user and the agent acting for them, but identity alone does not grant permission to perform every operation.</p></article>
          <article className="agal-card"><h3>Authorization</h3><p>Answers “may this actor perform this action on this resource now?” The answer can change with amount, destination, device, location, consent, or risk.</p></article>
          <article className="agal-card"><h3>Obligations</h3><p>A policy can require an additional control instead of simply allowing or denying. Step-up verification and human consent keep higher-risk actions in the loop.</p></article>
        </div>
        <div className="agal-context-panel">
          <h3>What the policy evaluates</h3>
          <div className="agal-context-grid">
            <div><strong>Subject</strong><span>the user, group, or service identity</span></div>
            <div><strong>Actor</strong><span>the agent acting on the user’s behalf</span></div>
            <div><strong>Action</strong><span>the operation, such as read or transfer</span></div>
            <div><strong>Resource</strong><span>the account, record, API, or MCP tool</span></div>
            <div><strong>Context</strong><span>amount, destination, device, time, and risk</span></div>
            <div><strong>Obligation</strong><span>step-up, consent, logging, or a final deny</span></div>
          </div>
        </div>
        <p className="agal-source-note">This lesson is based on the provided authorization materials and Ping Identity documentation for PingOne Authorize and the PingGateway Agent Gateway module.</p>
      </Section>

      <Section id="flow" title="Request flow">
        <p>Click each stage to focus the explanation. The important distinction is that the gateway enforces the decision; the policy service supplies it.</p>
        <FlowDiagram selected={selectedNode} onSelect={setSelectedNode} />
        <div className="agal-detail" aria-live="polite">
          <strong>{node.label}</strong>
          <p>{node.detail}</p>
        </div>
      </Section>

      <Section id="try-it-live" title="Try it">
        <p>Run a guided scenario. Each request is sent through the app’s existing BFF path, so the browser never receives or chooses a downstream token. Select a request first, then run it live.</p>
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
            {ran ? <div className={`agal-result agal-result--${scenario.outcome.toLowerCase()}`}><strong>{liveDecision || scenario.outcome}</strong><p>{liveError?.message || scenario.detail}</p></div> : <p className="agal-ready">Select a scenario to walk through its decision.</p>}
            <button type="button" className="agal-live-button" onClick={runLiveScenario} disabled={!ran || liveBusy}>
              {liveBusy ? "Running live request…" : "Run live request"}
            </button>
            {liveResult ? <p className="agal-live-note">Live response captured. Open the inspector to see the gateway and Authorize evidence.</p> : null}
            {liveError ? <p className="agal-live-note">The request was stopped by the live enforcement path or requires sign-in. No local decision was substituted.</p> : null}
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
          <li>The agent proposed an operation for an identified user; its proposal was not treated as permission.</li>
          <li>The BFF prepared the request and the Agent Gateway checked the token, audience, scopes, actor chain, and MCP request.</li>
          <li>PingOne Authorize evaluated attributes and context, not just a static role.</li>
          <li>The gateway enforced the response: forward on PERMIT, pause for an obligation such as STEP-UP, or stop on DENY.</li>
          <li>The protected resource was reachable only after the enforcement boundary allowed the call.</li>
        </ol>
        <div className="agal-next-step"><strong>Continue the demo</strong><p>Open the live inspector to inspect the captured token chain, gateway event, Authorize decision, and MCP result.</p><Link to="/agent-gateway-capabilities">Open the live evidence view</Link></div>
      </Section>
    </LessonLayout>
  );
}
