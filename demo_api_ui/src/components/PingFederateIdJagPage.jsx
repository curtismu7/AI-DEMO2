import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DEFAULT_STEP_MS, DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import "./PingFederateIdJagPage.css";

const MOCK = "MOCK DATA — NOT A REAL TOKEN";
// Exchange samples follow the UC2 A2A delegation path in a2aDelegationService:
// PF mode requests an ID-JAG while preserving the generalist actor token.
const PROTOCOL_DETAILS = [
  {
    token: "No delegated token yet",
    claims: { note: "The browser holds a session cookie; OAuth tokens stay in the BFF." },
    requestTitle: "Portfolio request",
    request: { method: "POST /api/rpc", headers: { "Content-Type": "application/json", Cookie: "[MOCK SESSION COOKIE]" }, body: { jsonrpc: "2.0", id: "demo-1", method: "tools/call", params: { name: "get_portfolio_summary", vertical: "banking" } } },
    responseTitle: "BFF response",
    response: { jsonrpc: "2.0", id: "demo-1", result: { content: [{ type: "text", text: "[MOCK portfolio result after the delegated call completes]" }] } },
  },
  {
    token: "ID-JAG · decoded claim preview",
    claims: { typ: "oauth-id-jag+jwt", iss: "https://pingfederate.example.invalid", sub: "user-123", act: { sub: "generalist-agent" }, aud: "investment-intermediate", resource: "https://investment-mcp.example.invalid", scope: "agent:invoke:investment", exp: "[mock expiry]" },
    requestTitle: "Exchange 1 · issue ID-JAG",
    request: { method: "POST /as/token.oauth2 · application/x-www-form-urlencoded", body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", requested_token_type: "urn:ietf:params:oauth:token-type:id-jag", subject_token: "[MOCK USER ACCESS TOKEN]", subject_token_type: "urn:ietf:params:oauth:token-type:access_token", actor_token: "[MOCK GENERALIST ACTOR TOKEN]", actor_token_type: "urn:ietf:params:oauth:token-type:access_token", audience: "investment-intermediate", scope: "agent:invoke:investment" } },
    responseTitle: "PingFederate response",
    response: { issued_token_type: "urn:ietf:params:oauth:token-type:id-jag", token_type: "N_A", access_token: "[MOCK ID-JAG — see decoded claims]", expires_in: 300 },
  },
  {
    token: "ID-JAG · A2A bearer preview",
    claims: { sub: "user-123", act: { sub: "generalist-agent" }, aud: "investment-intermediate", scope: "agent:invoke:investment", exp: "[mock expiry]" },
    requestTitle: "A2A handoff to specialist",
    request: { method: "POST /a2a/specialists/banking · JSON-RPC", headers: { Authorization: "Bearer [MOCK ID-JAG]", "A2A-Version": "1.0" }, body: { jsonrpc: "2.0", id: "handoff-1", method: "message/send", params: { message: { role: "user", parts: [{ text: "Retrieve the portfolio summary" }], metadata: { vertical: "banking", demoLayer: "a2a-protocol-wire", tool: "get_portfolio_summary", args: { account_id: "acct-demo-01" } } } } } },
    responseTitle: "Gateway validation",
    response: { status: "accepted", checks: ["issuer and signature", "audience", "expiry", "delegated actor"] },
  },
  {
    token: "Investment access token · nested actor preview",
    claims: { sub: "user-123", act: { sub: "investment-advisor", act: { sub: "generalist-agent" } }, aud: "investment-mcp", scope: "portfolio:read", exp: "[mock expiry]" },
    requestTitle: "Exchange 2 · build act chain",
    request: { method: "POST /as/token.oauth2 · application/x-www-form-urlencoded", body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", requested_token_type: "urn:ietf:params:oauth:token-type:access_token", subject_token: "[MOCK ID-JAG]", subject_token_type: "urn:ietf:params:oauth:token-type:id-jag", actor_token: "[MOCK INVESTMENT ADVISOR TOKEN]", actor_token_type: "urn:ietf:params:oauth:token-type:access_token", audience: "investment-mcp", scope: "portfolio:read" } },
    responseTitle: "PingFederate response",
    response: { issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", access_token: "[MOCK NESTED-ACTOR ACCESS TOKEN]", expires_in: 300 },
  },
  {
    token: "Delegated identity · policy input",
    claims: { sub: "user-123", act: { sub: "investment-advisor", act: { sub: "generalist-agent" } }, action: "get_portfolio_summary", resource: "investment-mcp" },
    requestTitle: "Authorize the requested action",
    request: { method: "POST PingOne Authorize /decision", body: { subject: "user-123", actor_chain: ["generalist-agent", "investment-advisor"], action: "get_portfolio_summary", resource: "investment-mcp" } },
    responseTitle: "Policy decision",
    response: { decision: "PERMIT", reason: "policy matched" },
  },
  {
    token: "Resource access token · mock claims",
    claims: { sub: "user-123", act: { sub: "investment-advisor", act: { sub: "generalist-agent" } }, aud: "investment-mcp", scope: "portfolio:read", exp: "[mock expiry]" },
    requestTitle: "Exchange 3 + investment MCP call",
    request: { exchange_3: { method: "POST /as/token.oauth2", body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: "[MOCK NESTED-ACTOR TOKEN]", subject_token_type: "urn:ietf:params:oauth:token-type:access_token", requested_token_type: "urn:ietf:params:oauth:token-type:access_token", resource: "https://investment-mcp.example.invalid", scope: "portfolio:read" } }, resource_call: { method: "POST /mcp · JSON-RPC", headers: { Authorization: "Bearer [MOCK RESOURCE ACCESS TOKEN]" }, body: { jsonrpc: "2.0", id: "tool-1", method: "tools/call", params: { name: "get_portfolio_summary", arguments: { account_id: "acct-demo-01" } } } } },
    responseTitle: "Token + tool responses",
    response: { exchange_3: { token_type: "Bearer", access_token: "[MOCK RESOURCE ACCESS TOKEN]", expires_in: 300 }, resource_call: { jsonrpc: "2.0", id: "tool-1", result: { content: [{ type: "text", text: "[MOCK portfolio summary]" }] } } },
  },
];

const PF_LOGIN_PROTOCOL = {
  token: "No delegated token yet",
  claims: { note: "OAuth tokens stay in the BFF; the browser receives a session cookie." },
  requestTitle: "Browser sign-in redirect",
  request: { method: "GET PingFederate /as/authorization.oauth2", query: { response_type: "code", client_id: "[MOCK CLIENT ID]", redirect_uri: "[BFF CALLBACK URI]", scope: "openid profile", code_challenge: "[MOCK PKCE CHALLENGE]", state: "[MOCK STATE]" } },
  responseTitle: "Authorization + BFF callback",
  response: { pingFederate: { status: "302 Found", location: "[BFF callback]?code=[MOCK AUTHORIZATION CODE]&state=[MOCK STATE]" }, bff: { status: "302 Found", set_cookie: "[HTTP-only session cookie]", browser_tokens: "none" } },
};

function ProtocolDetails({ diagramId, stepIndex }) {
  const example = diagramId === "pingfederate" && stepIndex === 0 ? PF_LOGIN_PROTOCOL : PROTOCOL_DETAILS[stepIndex];
  return (
    <details className="pfj-protocol">
      <summary>Protocol details <span>Mock tokens · API request / response</span></summary>
      <div className="pfj-protocol__body">
        <div className="pfj-protocol__token">
          <div className="pfj-protocol__heading"><div><span className="pfj-protocol__eyebrow">TOKEN PREVIEW</span><h3>{example.token}</h3></div><span className="pfj-protocol__mock">{MOCK}</span></div>
          <pre>{JSON.stringify(example.claims, null, 2)}</pre>
        </div>
        <div className="pfj-protocol__exchange">
          <article><span className="pfj-protocol__eyebrow">REQUEST</span><h3>{example.requestTitle}</h3><pre>{JSON.stringify(example.request, null, 2)}</pre></article>
          <article><span className="pfj-protocol__eyebrow">RESPONSE</span><h3>{example.responseTitle}</h3><pre>{JSON.stringify(example.response, null, 2)}</pre></article>
        </div>
      </div>
    </details>
  );
}

const DIAGRAMS = {
  jag: {
    label: "ID-JAG flow",
    title: "ID-JAG token journey",
    intro: "Follow the signed delegation token from issuance to the protected investment call.",
    badge: "ID-JAG · urn:ietf:params:oauth:token-type:id-jag",
    chain: ["user", "generalist", "Investment Advisor"],
    steps: [
      { title: "Start the delegated request", detail: "The user asks the AI agent to retrieve a sensitive investment portfolio.", active: ["user", "bff"], links: ["request"] },
      { title: "Exchange 1 issues an ID-JAG", detail: "The BFF asks PingFederate for an ID-JAG. The user remains sub, the generalist agent is in act, and the audience is the investment intermediate.", active: ["bff", "pingfed"], links: ["issue"] },
      { title: "Carry the ID-JAG to PingGateway", detail: "PingFederate signs the ID-JAG; the agent presents it as the bearer token on the A2A request. PingGateway validates its issuer and signature.", active: ["pingfed", "jag", "gateway"], links: ["mint", "bearer"] },
      { title: "Exchange 2 builds the act chain", detail: "PingGateway presents the ID-JAG as subject_token and requests an access_token from PingFederate. The returned token nests the Investment Advisor and generalist actors over the user.", active: ["gateway", "pingfed"], links: ["ex2"] },
      { title: "PingOne Authorize permits the action", detail: "PingGateway sends the delegated identity and MCP action to PingOne Authorize (P1AZ). A PERMIT decision allows the request to continue.", active: ["gateway", "authorize"], links: ["policy"] },
      { title: "Exchange 3 reaches the investment resource", detail: "PingGateway obtains a resource access token from PingFederate, calls Investment MCP, and returns the real portfolio result.", active: ["gateway", "pingfed", "invest"], links: ["ex3", "tool"] },
    ],
    participants: [
      { id: "user", title: "User + agent", subtitle: "UC2 · portfolio request", role: "request" },
      { id: "bff", title: "Demo BFF", subtitle: "trusted exchange client", role: "runtime" },
      { id: "pingfed", title: "PingFederate", subtitle: "issuer + token exchange", role: "identity" },
      { id: "jag", title: "ID-JAG", subtitle: "sub=demoUser · act=generalist", role: "token" },
      { id: "gateway", title: "PingGateway", subtitle: "A2A · delegated MCP", role: "gateway" },
      { id: "authorize", title: "PingOne Authorize", subtitle: "P1AZ · PERMIT", role: "policy" },
      { id: "invest", title: "Investment MCP", subtitle: "get portfolio summary", role: "resource" },
    ],
    links: [
      { id: "request", source: "user", target: "bff", label: "UC2 request" },
      { id: "issue", source: "bff", target: "pingfed", label: "Ex1 · request ID-JAG" },
      { id: "mint", source: "pingfed", target: "jag", label: "signed ID-JAG" },
      { id: "bearer", source: "jag", target: "gateway", label: "A2A bearer" },
      { id: "ex2", source: "gateway", target: "pingfed", label: "Ex2 · ID-JAG → access_token", sourceHandle: "top", targetHandle: "top" },
      { id: "policy", source: "gateway", target: "authorize", label: "policy check" },
      { id: "ex3", source: "gateway", target: "pingfed", label: "Ex3 · resource token", sourceHandle: "bottom", targetHandle: "bottom" },
      { id: "tool", source: "gateway", target: "invest", label: "MCP tool call" },
    ],
  },
  pingfederate: {
    label: "PingFederate architecture",
    title: "PingFederate in the system",
    intro: "See where the PingFederate agent, gateway, policy service, and investment API connect.",
    badge: "PingFederate · identity and token services",
    chain: ["user", "generalist", "Investment Advisor"],
    steps: [
      { title: "The user signs in", detail: "The browser session is established through the BFF. OAuth tokens remain server-side; the browser uses its session cookie.", active: ["user", "bff"], links: ["login"] },
      { title: "PingFederate issues delegated identity", detail: "The BFF uses its trusted token-exchange connection to obtain the user-bound ID-JAG from PingFederate.", active: ["bff", "pingfed"], links: ["mint"] },
      { title: "The generalist agent delegates", detail: "The generalist agent calls PingGateway with the ID-JAG. PingGateway is the MCP enforcement point for the A2A request.", active: ["pingfed", "generalist", "gateway"], links: ["agent-jag", "a2a"] },
      { title: "PingFederate expands delegation", detail: "PingGateway returns to PingFederate for Exchange 2. The access token carries the nested user → generalist → Investment Advisor act chain.", active: ["gateway", "pingfed"], links: ["ex2"] },
      { title: "PingOne Authorize makes the decision", detail: "PingGateway asks P1AZ to evaluate the user, actor chain, and requested MCP action. In this successful path, P1AZ returns PERMIT.", active: ["gateway", "authorize"], links: ["policy"] },
      { title: "Investment MCP returns the result", detail: "After Exchange 3 obtains the resource token from PingFederate, PingGateway forwards the permitted call to Investment MCP.", active: ["gateway", "pingfed", "invest"], links: ["ex3", "tool"] },
    ],
    participants: [
      { id: "user", title: "User", subtitle: "portfolio request", role: "request" },
      { id: "bff", title: "Demo BFF", subtitle: "OAuth client · session custodian", role: "runtime" },
      { id: "pingfed", title: "PingFederate", subtitle: "ID-JAG issuer · token endpoint", role: "identity" },
      { id: "generalist", title: "Generalist agent", subtitle: "A2A delegation source", role: "agent" },
      { id: "gateway", title: "PingGateway", subtitle: "Agent Gateway · MCP enforcement", role: "gateway" },
      { id: "authorize", title: "PingOne Authorize", subtitle: "policy decision · PERMIT", role: "policy" },
      { id: "invest", title: "Investment MCP", subtitle: "protected portfolio tools", role: "resource" },
    ],
    links: [
      { id: "login", source: "user", target: "bff", label: "sign-in · session" },
      { id: "mint", source: "bff", target: "pingfed", label: "Ex1 · ID-JAG" },
      { id: "agent-jag", source: "pingfed", target: "generalist", label: "delegated identity" },
      { id: "a2a", source: "generalist", target: "gateway", label: "A2A · ID-JAG bearer" },
      { id: "ex2", source: "gateway", target: "pingfed", label: "Ex2 · nested-act token", sourceHandle: "top", targetHandle: "top" },
      { id: "policy", source: "gateway", target: "authorize", label: "authorize action" },
      { id: "ex3", source: "gateway", target: "pingfed", label: "Ex3 · resource token", sourceHandle: "bottom", targetHandle: "bottom" },
      { id: "tool", source: "gateway", target: "invest", label: "permitted MCP call" },
    ],
  },
};

const NODE_MARKS = { request: "01", runtime: "BFF", identity: "PF", token: "JAG", agent: "AI", gateway: "IG", policy: "P1AZ", resource: "MCP" };
const ParticipantNode = memo(function ParticipantNode({ data, selected }) {
  return (
    <div className={`pfj-node pfj-node--${data.role}${selected ? " is-active" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <Handle id="top" type="target" position={Position.Top} />
      <Handle id="bottom" type="target" position={Position.Bottom} />
      <span className="pfj-node__mark" aria-hidden="true">{data.mark}</span>
      <strong>{data.title}</strong>
      <span>{data.subtitle}</span>
      <Handle id="top" type="source" position={Position.Top} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const NODE_TYPES = { participant: ParticipantNode };

function buildNodes(diagram, step) {
  const gap = diagram.participants.length > 6 ? 220 : 230;
  return diagram.participants.map((participant, index) => ({
    id: participant.id,
    type: "participant",
    position: { x: 26 + index * gap, y: participant.id === "authorize" ? 325 : 142 },
    data: { ...participant, mark: NODE_MARKS[participant.role] },
    selected: step.active.includes(participant.id),
    draggable: false,
  }));
}

function buildEdges(diagram, activeStep) {
  const activeLinks = diagram.steps[activeStep].links;
  return diagram.links.map((link) => {
    const active = activeLinks.includes(link.id);
    return {
      ...link,
      type: "smoothstep",
      animated: active,
      markerEnd: { type: MarkerType.ArrowClosed, color: active ? "#126c83" : "#93a8b7" },
      style: { stroke: active ? "#126c83" : "#b1c0c9", strokeWidth: active ? 2.7 : 1.4 },
      labelStyle: { fill: active ? "#07566d" : "#617684", fontWeight: active ? 700 : 500, fontSize: 11 },
      labelBgStyle: { fill: "var(--pfj-canvas)", fillOpacity: 0.96 },
      labelBgPadding: [5, 7],
      labelBgBorderRadius: 4,
      zIndex: active ? 2 : 1,
    };
  });
}

export default function PingFederateIdJagPage() {
  const [diagramId, setDiagramId] = useState("jag");
  const [activeStep, setActiveStep] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const timerRef = useRef(null);
  const diagram = DIAGRAMS[diagramId];
  const step = diagram.steps[activeStep];
  const nodes = useMemo(() => buildNodes(diagram, step), [diagram, step]);
  const edges = useMemo(() => buildEdges(diagram, activeStep), [diagram, activeStep]);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    clearTimer();
    setSimulating(false);
    setPaused(false);
  }, [clearTimer]);

  const scheduleNext = useCallback((fromIndex) => {
    timerRef.current = window.setTimeout(() => {
      const nextIndex = fromIndex + 1;
      if (nextIndex >= diagram.steps.length) {
        timerRef.current = null;
        setSimulating(false);
        setPaused(false);
        return;
      }

      setActiveStep(nextIndex);
      if (nextIndex === diagram.steps.length - 1) {
        timerRef.current = null;
        setSimulating(false);
        setPaused(false);
      } else {
        scheduleNext(nextIndex);
      }
    }, stepMs);
  }, [diagram.steps.length, stepMs]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const goToStep = useCallback((index) => {
    stopPlayback();
    setActiveStep(index);
  }, [stopPlayback]);

  const onNodeClick = useCallback((_event, node) => {
    const next = diagram.steps.findIndex((item) => item.active.includes(node.id));
    if (next >= 0) goToStep(next);
  }, [diagram, goToStep]);

  const onSimulate = () => {
    clearTimer();
    setActiveStep(0);
    setSimulating(true);
    setPaused(false);
    if (diagram.steps.length > 1) scheduleNext(0);
    else setSimulating(false);
  };

  const onPause = () => {
    clearTimer();
    setPaused(true);
  };

  const onResume = () => {
    if (activeStep < diagram.steps.length - 1) {
      setPaused(false);
      scheduleNext(activeStep);
    } else {
      stopPlayback();
    }
  };

  const onNext = () => {
    clearTimer();
    setActiveStep((current) => Math.min(current + 1, diagram.steps.length - 1));
  };
  const onPrev = () => {
    clearTimer();
    setActiveStep((current) => Math.max(current - 1, 0));
  };
  const onReset = () => goToStep(0);

  const selectDiagram = (id) => {
    stopPlayback();
    setDiagramId(id);
    setActiveStep(0);
  };

  return (
    <main className="pfj-page" data-testid="pingfederate-id-jag-page">
      <header className="pfj-header">
        <div>
          <p className="pfj-kicker">UC2 · Agent delegation</p>
          <h1>{diagram.title}</h1>
          <p className="pfj-intro">{diagram.intro}</p>
        </div>
        <div className="pfj-provider-badge"><span /> {diagram.badge}</div>
      </header>

      <nav className="pfj-diagram-tabs" role="tablist" aria-label="Architecture views">
        {Object.entries(DIAGRAMS).map(([id, item]) => (
          <button key={id} type="button" role="tab" aria-selected={diagramId === id} className={diagramId === id ? "is-current" : ""} onClick={() => selectDiagram(id)}>{item.label}</button>
        ))}
      </nav>

      <div className="pfj-toolbar">
        <DiagramControls
          currentStep={activeStep + 1}
          totalSteps={diagram.steps.length}
          isSimulating={simulating}
          isPaused={paused}
          onSimulate={onSimulate}
          onPrev={onPrev}
          onPause={onPause}
          onResume={onResume}
          onNext={onNext}
          onStop={stopPlayback}
          onReset={onReset}
          stepTimeOptions={STEP_TIME_OPTIONS}
          stepMs={stepMs}
          onSetStepMs={setStepMs}
        />
      </div>

      <section className="pfj-diagram" aria-label={`Interactive ${diagram.label}`}>
        <div className="pfj-lane pfj-lane--top">Identity and delegation</div>
        <div className="pfj-lane pfj-lane--bottom">Policy decision and protected resource</div>
        <ReactFlow
          key={diagramId}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.13, minZoom: 0.42, maxZoom: 1 }}
          minZoom={0.35}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#b8c9d1" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="pfj-chain" aria-label="Token chain">
          {diagram.chain.map((name, index) => <React.Fragment key={name}>{index > 0 && <b aria-hidden="true">→</b>}<span>{name}</span></React.Fragment>)}
        </div>
      </section>

      <section className="pfj-guide" aria-live="polite">
        <div className="pfj-guide__copy">
          <span className="pfj-step-count">{String(activeStep + 1).padStart(2, "0")} / {String(diagram.steps.length).padStart(2, "0")}</span>
          <div><h2>{step.title}</h2><p>{step.detail}</p></div>
        </div>
        <nav className="pfj-step-nav" aria-label={`${diagram.label} steps`}>
          <button type="button" onClick={() => goToStep(Math.max(activeStep - 1, 0))} disabled={activeStep === 0} aria-label="Previous step">‹</button>
          {diagram.steps.map((item, index) => (
            <button key={item.title} type="button" className={index === activeStep ? "is-current" : ""} onClick={() => goToStep(index)} aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === activeStep ? "step" : undefined}>{index + 1}</button>
          ))}
          <button type="button" onClick={() => goToStep(Math.min(activeStep + 1, diagram.steps.length - 1))} disabled={activeStep === diagram.steps.length - 1} aria-label="Next step">›</button>
        </nav>
      </section>

      <ProtocolDetails diagramId={diagramId} stepIndex={activeStep} />

      {diagramId === "jag" && <p className="pfj-footnote">Exchange 2 presents the ID-JAG as subject_token and requests access_token, matching PingFederate’s token-exchange behavior.</p>}
    </main>
  );
}
