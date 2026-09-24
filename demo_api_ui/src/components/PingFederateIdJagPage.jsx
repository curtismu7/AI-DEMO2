import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DEFAULT_STEP_MS, DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import "./PingFederateIdJagPage.css";

const MOCK = "MOCK DATA — NOT A REAL TOKEN";
// These samples follow the PF ID-JAG lane in agentMcpTokenService: the BFF
// exchanges its server-held refresh token at PF, then redeems the ID-JAG at the
// separately configured downstream MCP authorization server with JWT bearer.
const PROTOCOL_DETAILS = [
  {
    token: "No delegated token yet",
    claims: { note: "The browser holds a session cookie. The BFF keeps the refresh token and all exchanged tokens server-side." },
    requestTitle: "Enterprise-managed MCP request",
    request: { method: "POST /api/agent/run", headers: { "Content-Type": "application/json", Cookie: "[MOCK SESSION COOKIE]" }, body: { message: "Show my account balance", useCase: "UC40 · enterprise-managed MCP authorization" } },
    responseTitle: "BFF response",
    response: { status: "processing", browser_tokens: "none", next: "BFF obtains a downstream MCP access token" },
  },
  {
    token: "Upstream refresh token · BFF-held",
    claims: { source: "PingFederate user session", token_type: "urn:ietf:params:oauth:token-type:refresh_token", custody: "BFF only · never sent to the browser" },
    requestTitle: "Side 1 · exchange upstream token",
    request: { method: "POST /as/token.oauth2 · application/x-www-form-urlencoded", body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", requested_token_type: "urn:ietf:params:oauth:token-type:id-jag", subject_token: "[MOCK PF REFRESH TOKEN]", subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token", audience: "[DOWNSTREAM MCP AS]", resource: "[MCP RESOURCE URI]", scope: "accounts:read" } },
    responseTitle: "PingFederate validates subject token",
    response: { result: "refresh token accepted by PF token-exchange policy", next: "PF maps user attributes and creates an audience-bound ID-JAG" },
  },
  {
    token: "ID-JAG · decoded claim preview",
    claims: { typ: "oauth-id-jag+jwt", iss: "https://pingfederate.example.invalid", sub: "user-123", aud: "https://mcp-as.example.invalid", resource: "https://mcp.example.invalid", scope: "accounts:read", exp: "[mock expiry]" },
    requestTitle: "Side 1 · PingFederate issues ID-JAG",
    request: { event: "successful response to the upstream exchange", note: "ID-JAG is returned in access_token; issued_token_type identifies it as an ID-JAG" },
    responseTitle: "PingFederate token response",
    response: { access_token: "[MOCK ID-JAG — see decoded claims]", issued_token_type: "urn:ietf:params:oauth:token-type:id-jag", token_type: "N_A", expires_in: 300 },
  },
  {
    token: "ID-JAG · presented as assertion",
    claims: { assertion_type: "ID-JAG", presented_as: "JWT bearer assertion", audience: "https://mcp-as.example.invalid", resource: "https://mcp.example.invalid" },
    requestTitle: "Side 2 · redeem ID-JAG at resource AS",
    request: { method: "POST [CONFIGURED MCP AS TOKEN ENDPOINT] · application/x-www-form-urlencoded", body: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: "[MOCK ID-JAG]", client_id: "[MOCK REDEMPTION CLIENT]", resource: "https://mcp.example.invalid", scope: "accounts:read" } },
    responseTitle: "MCP authorization server validates the ID-JAG",
    response: { checks: ["trusted issuer / signature", "audience for this AS", "expiry and required claims"], result: "accepted · issue a local MCP access token" },
  },
  {
    token: "MCP access token · issued by resource AS",
    claims: { token_type: "Bearer", sub: "user-123", aud: "https://mcp.example.invalid", scope: "accounts:read", exp: "[mock expiry]" },
    requestTitle: "Side 2 · access token response",
    request: { event: "successful JWT bearer grant response", note: "The ID-JAG is an assertion, not the bearer token used on MCP calls." },
    responseTitle: "MCP authorization server response",
    response: { token_type: "Bearer", access_token: "[MOCK LOCAL MCP ACCESS TOKEN]", scope: "accounts:read", expires_in: 300 },
  },
  {
    token: "Local MCP access token · BFF-held",
    claims: { sub: "user-123", aud: "https://mcp.example.invalid", scope: "accounts:read", custody: "BFF only" },
    requestTitle: "Authorized MCP tool call",
    request: { method: "POST /mcp · JSON-RPC", headers: { Authorization: "Bearer [MOCK LOCAL MCP ACCESS TOKEN]" }, body: { jsonrpc: "2.0", id: "tool-1", method: "tools/call", params: { name: "get_account_balance", arguments: { account_id: "acct-demo-01" } } } },
    responseTitle: "MCP resource response",
    response: { jsonrpc: "2.0", id: "tool-1", result: { content: [{ type: "text", text: "[MOCK account balance]" }] }, browser_tokens: "none · BFF returns the result" },
  },
];

const PF_LOGIN_PROTOCOL = {
  token: "No OAuth token in browser",
  claims: { note: "The browser holds a session cookie; the BFF stores the PingFederate refresh token." },
  requestTitle: "PingFederate user sign-in",
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
    intro: "Two sides: PingFederate issues the ID-JAG; the downstream MCP authorization server validates and redeems it.",
    badge: "ID-JAG · urn:ietf:params:oauth:token-type:id-jag",
    chain: ["upstream refresh token", "PingFederate ID-JAG", "MCP access token"],
    steps: [
      { title: "Start the UC40 MCP request", detail: "The BFF receives the user's request and keeps OAuth tokens out of the browser. The UC40 PingFederate lane uses its server-held refresh token as the upstream subject.", active: ["user", "bff"], links: ["request"] },
      { title: "Side 1 · PingFederate validates the upstream token", detail: "The BFF sends a token-exchange request with the refresh token, its token type, the downstream audience/resource, and requested scopes. PingFederate's token-exchange policy validates the refresh token.", active: ["bff", "pingfed"], links: ["issue"] },
      { title: "PingFederate issues the ID-JAG", detail: "After validation and attribute mapping, PingFederate returns a signed ID-JAG to the BFF. Its audience identifies the downstream authorization server; its resource and scope constrain the MCP access being requested.", active: ["pingfed", "jag", "bff"], links: ["mint", "return"] },
      { title: "Side 2 · submit ID-JAG for validation", detail: "The BFF sends the ID-JAG to the configured downstream MCP authorization server as the JWT bearer assertion. That server validates the assertion against its trust configuration, including issuer/signature, audience, expiry, and required claims.", active: ["bff", "jag", "mcpas"], links: ["return", "redeem"] },
      { title: "Downstream AS issues its local access token", detail: "A successful JWT bearer grant returns a resource-specific MCP access token. The ID-JAG was the grant assertion; the newly issued access token is what authorizes the protected call.", active: ["mcpas", "bff", "gateway"], links: ["local-token"] },
      { title: "Call the protected MCP tool", detail: "The BFF uses the downstream access token for the MCP request. PingGateway and PingOne Authorize apply the configured access-token and action policy checks before the MCP resource returns data.", active: ["bff", "gateway", "authorize", "invest"], links: ["policy", "tool"] },
    ],
    participants: [
      { id: "user", title: "User + agent", subtitle: "UC40 · MCP request", role: "request" },
      { id: "bff", title: "Demo BFF", subtitle: "token custodian · OAuth client", role: "runtime" },
      { id: "pingfed", title: "PingFederate", subtitle: "Side 1 · validates + issues", role: "identity" },
      { id: "jag", title: "ID-JAG", subtitle: "signed JWT assertion", role: "token" },
      { id: "mcpas", title: "MCP Authorization Server", subtitle: "Side 2 · validates + redeems", role: "mcpas" },
      { id: "gateway", title: "PingGateway", subtitle: "access-token enforcement", role: "gateway" },
      { id: "authorize", title: "PingOne Authorize", subtitle: "action policy · PERMIT", role: "policy" },
      { id: "invest", title: "MCP resource", subtitle: "protected tools", role: "resource" },
    ],
    links: [
      { id: "request", source: "user", target: "bff", label: "UC40 request" },
      { id: "issue", source: "bff", target: "pingfed", label: "Side 1 · refresh_token exchange" },
      { id: "mint", source: "pingfed", target: "jag", label: "signed ID-JAG" },
      { id: "return", source: "jag", target: "bff", label: "ID-JAG to BFF", sourceHandle: "top", targetHandle: "top" },
      { id: "redeem", source: "bff", target: "mcpas", label: "Side 2 · JWT bearer assertion" },
      { id: "local-token", source: "mcpas", target: "bff", label: "local MCP access token", sourceHandle: "bottom", targetHandle: "bottom" },
      { id: "policy", source: "gateway", target: "authorize", label: "authorize tool action" },
      { id: "tool", source: "gateway", target: "invest", label: "MCP call · access token" },
    ],
  },
  pingfederate: {
    label: "PingFederate architecture",
    title: "PingFederate in the system",
    intro: "See both ID-JAG sides: PingFederate issues the assertion, then the MCP authorization server validates it and issues its own token.",
    badge: "PingFederate · identity and token services",
    chain: ["refresh token", "ID-JAG assertion", "MCP access token"],
    steps: [
      { title: "User signs in with PingFederate", detail: "The browser receives a BFF session cookie. The refresh token remains in the BFF session and never enters the browser.", active: ["user", "bff", "pingfed"], links: ["login"] },
      { title: "Side 1 · PingFederate validates the refresh token", detail: "For UC40, the BFF calls PingFederate's token endpoint using token exchange and requests an ID-JAG for the configured MCP authorization server and resource.", active: ["bff", "pingfed"], links: ["issue"] },
      { title: "PingFederate returns the ID-JAG", detail: "PingFederate validates the upstream refresh token, applies its processor policy, then signs and returns an audience-bound ID-JAG to the BFF.", active: ["pingfed", "jag", "bff"], links: ["mint", "return"] },
      { title: "Side 2 · MCP AS validates the ID-JAG", detail: "The BFF submits the ID-JAG in a JWT bearer grant to the configured downstream MCP authorization server. The MCP AS validates the assertion before accepting the grant.", active: ["bff", "jag", "mcpas"], links: ["redeem"] },
      { title: "MCP AS issues its own access token", detail: "The downstream authorization server returns a scoped MCP access token. That local token, not the ID-JAG, is used for the protected MCP call.", active: ["mcpas", "bff", "gateway"], links: ["local-token"] },
      { title: "Gateway authorizes and forwards the call", detail: "PingGateway and PingOne Authorize evaluate the downstream access token and requested action, then the MCP resource returns the tool result.", active: ["gateway", "authorize", "invest"], links: ["policy", "tool"] },
    ],
    participants: [
      { id: "user", title: "User + agent", subtitle: "UC40 request", role: "request" },
      { id: "bff", title: "Demo BFF", subtitle: "session + token custodian", role: "runtime" },
      { id: "pingfed", title: "PingFederate", subtitle: "IdP AS · Side 1", role: "identity" },
      { id: "jag", title: "ID-JAG", subtitle: "signed authorization assertion", role: "token" },
      { id: "mcpas", title: "MCP Authorization Server", subtitle: "resource AS · Side 2", role: "mcpas" },
      { id: "gateway", title: "PingGateway", subtitle: "MCP access-token enforcement", role: "gateway" },
      { id: "authorize", title: "PingOne Authorize", subtitle: "tool action policy", role: "policy" },
      { id: "invest", title: "MCP resource", subtitle: "protected tools", role: "resource" },
    ],
    links: [
      { id: "login", source: "user", target: "bff", label: "sign-in · session" },
      { id: "issue", source: "bff", target: "pingfed", label: "Side 1 · refresh_token exchange" },
      { id: "mint", source: "pingfed", target: "jag", label: "signed ID-JAG" },
      { id: "return", source: "jag", target: "bff", label: "ID-JAG to BFF", sourceHandle: "top", targetHandle: "top" },
      { id: "redeem", source: "bff", target: "mcpas", label: "Side 2 · JWT bearer grant" },
      { id: "local-token", source: "mcpas", target: "bff", label: "local MCP access token", sourceHandle: "bottom", targetHandle: "bottom" },
      { id: "policy", source: "gateway", target: "authorize", label: "authorize tool action" },
      { id: "tool", source: "gateway", target: "invest", label: "MCP call · access token" },
    ],
  },
};
const NODE_MARKS = { request: "01", runtime: "BFF", identity: "PF", token: "JAG", agent: "AI", gateway: "IG", policy: "P1AZ", mcpas: "AS", resource: "MCP" };
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

function ArrowDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        <marker id="pfj-arrow-on" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#126c83" />
        </marker>
        <marker id="pfj-arrow-off" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#93a8b7" />
        </marker>
      </defs>
    </svg>
  );
}

function buildNodes(diagram, step) {
  const gap = diagram.participants.length > 6 ? 215 : 230;
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
      markerEnd: `url(#pfj-arrow-${active ? "on" : "off"})`,
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
          <p className="pfj-kicker">UC40 · Enterprise-managed MCP authorization</p>
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
        <ArrowDefs />
        <div className="pfj-lane pfj-lane--top">ID-JAG issuance and grant redemption</div>
        <div className="pfj-lane pfj-lane--bottom">Gateway policy and protected resource</div>
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

      {diagramId === "jag" && <p className="pfj-footnote">Two distinct servers validate two distinct credentials: PingFederate validates the upstream token during Side 1; the downstream MCP authorization server validates the ID-JAG during Side 2. The returned MCP access token is used for the resource call.</p>}
    </main>
  );
}
