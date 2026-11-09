// Agent authorization lesson (/agent-gateway-authorization): teaching text and a diagram, plus one live action.
//
// Honesty: the text, the flow diagram and the "expected" outcome next to each request are written into this page and
// never evaluated. Only "Run live request" is live: it sends the chosen request through this app's BFF
// (services/demoAgentService callMcpTool) and shows the decision that call reports. The decision and the engine that
// made it come from the authorize-decision token event (also carried by a thrown denial or step-up) or the result;
// an engine is named only when the response says which ("pingone", else the app's simulated one). No decision, or a
// failure, shows no outcome and substitutes none.
//
// Layout follows the standalone Ping UI Standard on the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P4 cards, P5 key-value, P7 chips, P9 buttons. The shared lesson shell
// (LessonLayout: title band + section nav) stays as the page frame, as on /ping-products/verify-recognize.
// Skipped: P3 PageFrame/Section (the lesson shell is the frame and owns the section anchors), P6 (not an inspector),
// P8 (the flow diagram is the shared StaticFlowDiagram, left as is). The standalone shell bar is not added.
//
// P9, one primary per view state: "Run live request" is the only primary in every state. It uses aria-disabled
// (focus stays on it) with a visible reason:
//   nothing chosen yet : inert, "Choose a request first"
//   request chosen     : active
//   running            : inert, label "Running live request…"
//   result / error     : active again (run it once more)
// The hero's two links, the request choices, the diagram controls and the lesson header's Dark mode / Export PDF are
// secondaries or plain links.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LessonLayout, Section, Lede } from "../components/lesson";
import StaticFlowDiagram from "../components/StaticFlowDiagram";
import { callMcpTool } from "../services/demoAgentService";
import { PingPage, SimBanner, CardGrid, Card, StatusChip, KvList } from "../components/pingUi";
import "./AgentGatewayAuthorizationLessonPage.css";

const LESSON_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "live-demo", label: "Run the story live" },
  { id: "concepts", label: "Key concepts" },
  { id: "flow", label: "Request flow" },
  { id: "try-it-live", label: "Try it" },
  { id: "summary", label: "What happened" },
];

const LIVE_DEMO_LINKS = [
  {
    id: "agent",
    kicker: "Start with the action",
    title: "Run the banking agent",
    detail: "Ask the agent to read data or move money. The same user request drives the live identity and policy flow.",
    href: "/agent-flow-inspector",
    cta: "Run the banking agent",
  },
  {
    id: "gateway",
    kicker: "See the enforcement point",
    title: "Inspect gateway enforcement",
    detail: "Watch MCP traffic, token checks, scopes, actor identity, and the gateway’s decision before a tool is reached.",
    href: "/agent-gateway-inspector",
    cta: "Inspect gateway enforcement",
  },
  {
    id: "authorize",
    kicker: "Change the context",
    title: "Test Authorize decisions",
    detail: "Try the same operation with different amounts, destinations, scopes, and obligations to see policy respond in real time.",
    href: "/pingone-authorize?tab=guided",
    cta: "Test Authorize decisions",
  },
  {
    id: "proof",
    kicker: "Finish with evidence",
    title: "Watch the token and audit trail",
    detail: "Follow the delegated token chain, gateway event, policy outcome, approval step, and protected-resource result.",
    href: "/transaction-trace",
    cta: "Watch the token and audit trail",
  },
];

const FLOW_NODES = [
  { id: "user", group: "user", label: "User / agent", sub: ["Proposes the operation"], x: 40, y: 130, detail: "The agent proposes an operation for an identified user. The model does not hold the user’s credential or decide whether the action is allowed." },
  { id: "gateway", group: "gateway", label: "Agent Gateway", sub: ["Enforces the decision"], x: 340, y: 130, detail: "The gateway is the enforcement point: it validates MCP structure, token signature and audience, scopes, actor chain, rate limits, and the request context before forwarding anything." },
  { id: "authorize", group: "pingone", label: "PingOne Authorize", sub: ["Decides in context"], x: 640, y: 130, detail: "The policy decision point evaluates the subject, acting agent, action, resource, attributes, consent, and runtime context. It returns a decision and may attach an obligation such as step-up." },
  { id: "resource", group: "resource", label: "Protected resource", sub: ["Executes after PERMIT"], x: 940, y: 130, detail: "The MCP server or API receives the request only after the gateway gets a permitted decision. It can still perform its own validation as defense in depth." },
];

const FLOW_EDGES = [
  ["user", "gateway", "tool call", { detail: "The gateway intercepts every MCP call before it can reach anything." }],
  ["gateway", "authorize", "evaluate", { detail: "The gateway always asks before dispatching — identity, actor, resource, context." }],
  ["authorize", "gateway", "decision + obligation", { detail: "PERMIT, DENY, or STEP-UP — the gateway enforces whatever comes back." }],
  ["gateway", "resource", "forward on PERMIT", { detail: "Only a permitted call is forwarded; the resource validates again as defense in depth." }],
];

// The walkthrough: one story step per edge, the same click-to-focus the stage
// cards had — now driving the shared reel instead of a bespoke detail box.
const FLOW_WALK = [
  {
    title: "Agent proposes the call", label: "Nothing is trusted yet",
    nodes: ["user", "gateway"], edges: [0],
    lines: [{ who: FLOW_NODES[0].label, text: FLOW_NODES[0].detail }],
  },
  {
    title: "Gateway evaluates", label: "The enforcement point asks",
    nodes: ["gateway", "authorize"], edges: [1],
    lines: [{ who: FLOW_NODES[1].label, text: FLOW_NODES[1].detail }],
  },
  {
    title: "Policy decides", label: "PERMIT · DENY · STEP-UP",
    nodes: ["authorize", "gateway"], edges: [2],
    lines: [{ who: FLOW_NODES[2].label, text: FLOW_NODES[2].detail }],
  },
  {
    title: "Gateway enforces", label: "Forward, pause, or stop",
    nodes: ["gateway", "resource"], edges: [3],
    lines: [{ who: FLOW_NODES[3].label, text: FLOW_NODES[3].detail }],
  },
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

const AGAL_GROUPS = {
  user: { label: "User", bg: "var(--th-status-info)" },
  gateway: { label: "Gateway", bg: "var(--th-status-warning)" },
  pingone: { label: "PingOne", bg: "var(--th-status-success)" },
  resource: { label: "Resource server", bg: "var(--th-border-strong)" },
};

// Replaces the old hand-rolled chip row: StaticFlowDiagram attaches the shared
// Play/Step bar and movie reel itself (walk drives it), and clicking a node
// still focuses that stage's explanation.
function FlowDiagram() {
  return (
    <StaticFlowDiagram
      NODES={FLOW_NODES}
      EDGES={FLOW_EDGES}
      GROUPS={AGAL_GROUPS}
      walk={FLOW_WALK}
      details={Object.fromEntries(FLOW_NODES.map((n) => [n.id, n.detail]))}
      ariaLabel="Agent authorization request flow"
      testId="agal-flow"
    />
  );
}

const CONCEPTS = [
  { title: "Agent Gateway", text: "Runtime boundary for MCP traffic. It validates messages, checks tokens and scopes, records actors, applies throttling, and forwards permitted calls." },
  { title: "PingOne Authorize", text: "Centralized policy decision service. It evaluates identity, resource, operation, attributes, consent, and context without embedding policy in every agent or API." },
  { title: "Protected resource", text: "The API or MCP server stays behind the enforcement point and executes only after the request is authorized. The resource remains a second validation boundary." },
  { title: "Authentication", text: "Answers “who is this?” A token can identify the user and the agent acting for them, but identity alone does not grant permission to perform every operation." },
  { title: "Authorization", text: "Answers “may this actor perform this action on this resource now?” The answer can change with amount, destination, device, location, consent, or risk." },
  { title: "Obligations", text: "A policy can require an additional control instead of simply allowing or denying. Step-up verification and human consent keep higher-risk actions in the loop." },
];

const POLICY_INPUTS = [
  { label: "Subject", value: "the user, group, or service identity" },
  { label: "Actor", value: "the agent acting on the user’s behalf" },
  { label: "Action", value: "the operation, such as read or transfer" },
  { label: "Resource", value: "the account, record, API, or MCP tool" },
  { label: "Context", value: "amount, destination, device, time, and risk" },
  { label: "Obligation", value: "step-up, consent, logging, or a final deny" },
];

// The decision a live response carries, shown as a chip tone. Only a string decision is shown; anything else is
// treated as "no decision field" rather than rendered.
const decisionTone = (decision) => {
  if (/^permit/i.test(decision)) return "ok";
  if (/deny/i.test(decision)) return "danger";
  if (/step/i.test(decision)) return "warn";
  return "info";
};

export default function AgentGatewayAuthorizationLessonPage() {
  const [selectedNode, setSelectedNode] = useState("gateway");
  const [scenarioId, setScenarioId] = useState("balance");
  const [ran, setRan] = useState(false);
  const [liveResult, setLiveResult] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const [liveBusy, setLiveBusy] = useState(false);
  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioId) || SCENARIOS[0], [scenarioId]);
  const node = FLOW_NODES.find((item) => item.id === selectedNode) || FLOW_NODES[1];

  const runScenario = (id) => {
    setScenarioId(id);
    setRan(true);
    setLiveResult(null);
    setLiveError(null);
    setLiveEvents([]);
    setSelectedNode(id === "balance" ? "resource" : "authorize");
  };

  const runLiveScenario = async () => {
    // aria-disabled keeps keyboard focus on the button, so the click is ignored here instead of by `disabled`.
    if (!ran || liveBusy) return;
    setLiveBusy(true);
    setLiveResult(null);
    setLiveError(null);
    setLiveEvents([]);
    try {
      const { result, tokenEvents } = await callMcpTool(scenario.request.tool, scenario.request, {
        useCaseId: scenario.id === "balance" ? "view_balance" : "step-up-required",
      });
      setLiveResult(result || { status: "completed" });
      setLiveEvents(Array.isArray(tokenEvents) ? tokenEvents : []);
      setSelectedNode(scenario.outcome === "PERMIT" ? "resource" : "authorize");
    } catch (error) {
      setLiveError(error);
      // A policy denial or step-up throws, but carries the decision in its token events.
      setLiveEvents(Array.isArray(error?.tokenEvents) ? error.tokenEvents : []);
      setSelectedNode("authorize");
    } finally {
      setLiveBusy(false);
    }
  };

  // The decision the live path reports: the app's authorize-decision event (also set on a denial or step-up that
  // throws), else the evaluation the result carries. The engine is named only when one of them says which.
  const authorizeEvent = liveEvents.find((e) => e?.id === "authorize-decision") || null;
  const evaluation = liveResult?.mcpAuthorizeEvaluation || liveResult?.authorizeEvaluation || null;
  const rawDecision = authorizeEvent?.authorizeDecision || evaluation?.decision || liveResult?.decision || null;
  const liveDecision = typeof rawDecision === "string" ? rawDecision : null;
  const rawEngine = authorizeEvent?.authorizeEngine || evaluation?.engine || null;
  const engine = typeof rawEngine === "string" ? rawEngine : null;
  const simulated = Boolean(engine) && engine !== "pingone";
  const liveWord = simulated ? "Simulated decision" : "Live decision";
  const liveSource = engine === "pingone"
    ? "Returned by PingOne Authorize."
    : simulated
      ? "Returned by the app’s simulated policy engine, not PingOne Authorize."
      : "The response did not say which engine decided.";
  const runUnavailable = !ran || liveBusy;
  const runHint = !ran
    ? "Choose a request first: this button stays inactive until you do."
    : liveBusy
      ? "Running the request. The result appears above."
      : "Sends the chosen request to this app’s BFF. It needs a signed-in session.";

  return (
    <PingPage className="agal-page">
      <SimBanner data-testid="agal-banner">
        <strong>LESSON WITH ONE LIVE ACTION</strong> — the text and the flow diagram are teaching material; nothing in
        them is evaluated. In Try it, a chosen request shows the outcome the lesson expects (written into this page,
        not evaluated). Run live request sends it through this app’s BFF for the signed-in user and shows the decision
        the response carries; it needs a signed-in session. A failed or decision-less response shows no outcome. Which
        service decides (PingOne Authorize or the app’s simulated engine) depends on this server’s configuration; the
        result names the engine only when the response reports it.
      </SimBanner>
      <LessonLayout
        pageClassName="agal-lesson-page"
        title="Securing AI Agent access using Ping Identity"
        subtitle="Give every AI action an identity, a policy decision, and an accountable outcome."
        sections={LESSON_SECTIONS}
        storageKey="agent-gateway-authorization-lesson-nav-width"
      >
        <Section id="overview" title="Overview">
          <Card className="agal-hero" data-testid="agal-hero">
            <div>
              <p className="agal-eyebrow">Agent Gateway + PingOne Authorize</p>
              <h3 className="pu-h3 agal-hero-title">Make every agent action accountable.</h3>
              <p className="pu-note">
                Secure the full journey from user intent to tool execution: establish who the agent is, delegate only the authority it needs, evaluate the request in context, and prove what happened.
              </p>
              <div className="pu-actions agal-hero-links">
                <Link className="pu-btn" to="/agent-flow-inspector">Run the live story</Link>
                <Link className="pu-btn" to="/agent-gateway-inspector">Open the gateway inspector</Link>
              </div>
            </div>
            <div className="agal-vocab">
              <p className="agal-eyebrow">Decision vocabulary</p>
              <p className="pu-status-line">
                <StatusChip>PERMIT</StatusChip>
                <StatusChip>DENY</StatusChip>
                <StatusChip>STEP-UP</StatusChip>
              </p>
              <p className="pu-note">The gateway enforces the returned outcome.</p>
            </div>
          </Card>
        </Section>

        <Section id="live-demo" title="Run the story live">
          <Lede>
            These surfaces are connected to the running demo. Follow identity, delegated authority, runtime policy, and proof from the first agent request to the final tool result.
          </Lede>
          <CardGrid>
            {LIVE_DEMO_LINKS.map((item, index) => (
              <Card className="agal-live-card" key={item.id} title={item.title}>
                <p className="agal-eyebrow">0{index + 1} · {item.kicker}</p>
                <p className="pu-note">{item.detail}</p>
                <Link className="agal-link" to={item.href}>{item.cta}</Link>
              </Card>
            ))}
          </CardGrid>
          <Card tone="neutral" title="One security story, four responsibilities." data-testid="agal-positioning">
            <p className="pu-note"><b>AI Core</b> establishes the agent credentials and delegated identity. <b>PingOne Authorize</b> decides whether this action is allowed now. <b>Agent Gateway</b> protects MCP traffic and enforces the result. <b>Privilege AI</b> extends the story with controls for models, tools, spend, and AI traffic.</p>
            <p className="pu-note"><Link className="agal-link" to="/privilege-for-ai">See the Privilege AI threat-control story</Link></p>
          </Card>
        </Section>

        <Section id="concepts" title="Key concepts">
          <CardGrid>
            {CONCEPTS.map((item) => (
              <Card key={item.title} title={item.title}>
                <p className="pu-note">{item.text}</p>
              </Card>
            ))}
          </CardGrid>
          <Card tone="neutral" title="What the policy evaluates">
            <KvList items={POLICY_INPUTS} />
          </Card>
          <p className="pu-note">This lesson is based on the provided authorization materials and Ping Identity documentation for PingOne Authorize and the PingOne Agent Gateway Agent Gateway module.</p>
        </Section>

        <Section id="flow" title="Request flow">
          <Lede>Play the walkthrough, or click a stage, to read what each part does. The important distinction is that the gateway enforces the decision; the policy service supplies it. The panel under the diagram follows the request you pick in Try it.</Lede>
          <FlowDiagram />
          <Card tone="neutral" className="agal-detail" aria-live="polite" data-testid="agal-detail">
            <p className="pu-status-line"><StatusChip>Lesson text</StatusChip><strong>{node.label}</strong></p>
            <p className="pu-note">{node.detail}</p>
          </Card>
        </Section>

        <Section id="try-it-live" title="Try it">
          <Lede>Run a guided scenario. Each request is sent through the app’s existing BFF path, so the browser never receives or chooses a downstream token. Select a request first, then run it live.</Lede>
          <CardGrid>
            <Card title="Choose a request" data-testid="agal-choose">
              <p className="pu-note">The chip is the outcome the lesson expects for that request. It is not evaluated until you run it live.</p>
              <div className="agal-scenarios">
                {SCENARIOS.map((item) => (
                  <button key={item.id} type="button" className="pu-btn agal-scenario" aria-pressed={ran && scenarioId === item.id} onClick={() => runScenario(item.id)}>
                    <span>{item.label}</span><StatusChip>{item.outcome}</StatusChip>
                  </button>
                ))}
              </div>
              <div className="agal-result-region" role="status" data-testid="agal-result">
                {!ran ? (
                  <p className="pu-note pu-empty agal-ready">Select a scenario to walk through its decision.</p>
                ) : liveDecision ? (
                  <Card tone={simulated ? "neutral" : decisionTone(liveDecision)} className="agal-result">
                    <p className="pu-status-line">
                      <StatusChip tone={simulated ? "neutral" : decisionTone(liveDecision)}>{liveWord}</StatusChip>
                      <strong>{liveDecision}</strong>
                    </p>
                    <p className="pu-note">{liveSource}</p>
                    {liveError?.message ? <p className="pu-note">{liveError.message}</p> : null}
                  </Card>
                ) : liveError ? (
                  <Card tone="warn" className="agal-result">
                    <p className="pu-status-line"><StatusChip tone="warn">No decision</StatusChip></p>
                    <p className="pu-note">{liveError.message || "The live request did not complete."}</p>
                  </Card>
                ) : liveResult ? (
                  <Card tone="live" className="agal-result">
                    <p className="pu-status-line"><StatusChip tone="info">Live response</StatusChip></p>
                    <p className="pu-note">The response carried no decision field, so no outcome is shown.</p>
                  </Card>
                ) : (
                  <Card tone="neutral" className="agal-result">
                    <p className="pu-status-line"><StatusChip>Expected, not evaluated</StatusChip><strong>{scenario.outcome}</strong></p>
                    <p className="pu-note">{scenario.detail}</p>
                  </Card>
                )}
              </div>
              <button type="button" className="pu-btn pu-btn--primary agal-run" aria-disabled={runUnavailable ? "true" : undefined} aria-describedby="agal-run-hint" onClick={runLiveScenario}>
                {liveBusy ? "Running live request…" : "Run live request"}
              </button>
              <p id="agal-run-hint" className="pu-note">{runHint}</p>
              {liveResult ? <p className="pu-note">Live response captured. Open the inspector to see the gateway and Authorize evidence.</p> : null}
              {liveError && !liveDecision ? <p className="pu-note">The request did not complete: it was stopped on the way, or you are signed out. No outcome was substituted.</p> : null}
            </Card>
            <Card tone="neutral" title="Decision request">
              <p className="pu-status-line"><StatusChip>Example payload</StatusChip></p>
              <pre tabIndex={0} role="region" aria-label="Decision request example">{JSON.stringify({ actor: "demo-user", resource: "banking-mcp", operation: scenario.request.tool, context: scenario.request }, null, 2)}</pre>
              <p className="pu-note">An illustration of what a policy decision weighs. The live request sends only the context object, not this wrapper.</p>
              <p className="pu-note agal-links"><Link className="agal-link" to="/agent-gateway-inspector">Open Agent Gateway Inspector</Link><Link className="agal-link" to="/pingone-authorize?tab=guided">Open Authorize tester</Link></p>
            </Card>
          </CardGrid>
        </Section>

        <Section id="summary" title="What happened">
          <Lede>The steps this lesson describes, in order. This is the lesson’s account, not a record of your run: the live evidence view has that.</Lede>
          <Card tone="neutral">
            <ol className="agal-summary">
              <li>The agent proposed an operation for an identified user; its proposal was not treated as permission.</li>
              <li>The BFF prepared the request and the Agent Gateway checked the token, audience, scopes, actor chain, and MCP request.</li>
              <li>PingOne Authorize evaluated attributes and context, not just a static role.</li>
              <li>The gateway enforced the response: forward on PERMIT, pause for an obligation such as STEP-UP, or stop on DENY.</li>
              <li>The protected resource was reachable only after the enforcement boundary allowed the call.</li>
            </ol>
          </Card>
          <Card title="Continue the demo" data-testid="agal-next">
            <p className="pu-note">Open the live inspector to inspect the captured token chain, gateway event, Authorize decision, and MCP result.</p>
            <p className="pu-note"><Link className="agal-link" to="/transaction-trace">Open the live evidence view</Link></p>
          </Card>
        </Section>
      </LessonLayout>
    </PingPage>
  );
}
