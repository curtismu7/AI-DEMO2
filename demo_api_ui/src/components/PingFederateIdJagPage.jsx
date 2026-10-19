import React, { useState } from "react";
import { DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import "./PingFederateIdJagPage.css";
import IdJagPathBar from "./IdJagPathBar";
import IdJagCallPlayer from "./IdJagCallPlayer";
import StaticFlowDiagram from "./StaticFlowDiagram";
import PageHeader from './common/PageHeader';
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { REFIT_EVENT } from "../hooks/useFitOnResize";
import { JAG_DIAGRAM, JAG_GUIDE, LOGIN_DIAGRAM, LOGIN_GUIDE } from "../config/pfIdJagDiagrams";

const MOCK = "MOCK DATA — NOT A REAL TOKEN";
// ID-JAG samples follow the PF ID-JAG lane in agentMcpTokenService: the BFF
// exchanges its server-held refresh token at PF, then redeems the ID-JAG at the
// separately configured downstream MCP authorization server with JWT bearer.
const PROTOCOL_DETAILS = [
  {
    token: "No delegated token yet",
    claims: { note: "The browser holds a session cookie. The BFF keeps the refresh token and all exchanged tokens server-side." },
    requestTitle: "Enterprise-managed MCP request",
    request: { method: "POST /api/agent/run · text/event-stream", headers: { "Content-Type": "application/json", Cookie: "[MOCK SESSION COOKIE]" }, body: { threadId: "[MOCK THREAD ID]", runId: "[MOCK RUN ID]", messages: [{ role: "user", content: "show my balance" }], useCaseId: "enterprise-managed-mcp-authorization" } },
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
    claims: { header: { alg: "RS256", typ: "oauth-id-jag+jwt" }, claims: { iss: "https://pingfederate.example.invalid", sub: "user-123", aud: "https://mcp-as.example.invalid", resource: "https://mcp.example.invalid", scope: "accounts:read", jti: "[mock single-use ID]", iat: "[mock issued-at]", exp: "[mock expiry]" } },
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
    response: { checks: ["RS256 signature from trusted IdP JWKS", "issuer + audience + expiry", 'typ = "oauth-id-jag+jwt"', "resource is served by this MCP AS", "jti is present and not previously redeemed"], result: "accepted · issue a local MCP access token" },
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
  {
    token: "Same MCP access token · passed through",
    claims: { sub: "user-123", aud: "[MOCK MCP SERVER AUDIENCE]", client_id: "[MOCK REDEEMING CLIENT]", custody: "BFF and MCP server only" },
    requestTitle: "MCP server calls the banking API",
    request: { method: "GET [BFF]/api/accounts/my", headers: { Authorization: "Bearer [MOCK MCP ACCESS TOKEN]" }, note: "TokenResolver sees a token issued by its own authorization server with no stashed PingOne token, so it skips the extra exchange and passes the token through." },
    responseTitle: "Banking API verifies, then answers",
    response: { checks: ["signature against the MCP authorization server's JWKS", "exact issuer", "audience accepted on the MCP-server callback routes", "scope, role and HITL checks"], result: "account data returned to the MCP server" },
  },
];

const PF_LOGIN_PROTOCOL = [
  {
    token: "No OAuth token yet",
    claims: { note: "The BFF starts an OpenID Connect Authorization Code + PKCE sign-in. The browser receives redirects, not OAuth tokens." },
    requestTitle: "Redirect browser to PingFederate",
    request: { method: "GET /as/authorization.oauth2", query: { response_type: "code", client_id: "[MOCK CLIENT ID]", redirect_uri: "[BFF CALLBACK URI]", scope: "openid profile", state: "[MOCK STATE]", nonce: "[MOCK NONCE]", code_challenge: "[MOCK PKCE CHALLENGE]", code_challenge_method: "S256" } },
    responseTitle: "PingFederate sign-in page",
    response: { status: "302 Found", location: "[PingFederate authentication page]", state: "[MOCK STATE]" },
  },
  {
    token: "No OAuth token yet",
    claims: { authentication: "user authenticates directly with PingFederate", browser: "credentials are submitted to PingFederate, not the BFF" },
    requestTitle: "User authenticates with PingFederate",
    request: { event: "user completes the configured PingFederate authentication policy" },
    responseTitle: "PingFederate authentication result",
    response: { result: "user authenticated", next: "return a short-lived authorization code to the BFF callback" },
  },
  {
    token: "Authorization code · short-lived",
    claims: { code: "[MOCK AUTHORIZATION CODE]", state: "[MOCK STATE]", delivered_via: "browser redirect to the BFF callback" },
    requestTitle: "PingFederate redirects to the BFF",
    request: { method: "GET [BFF CALLBACK]", query: { code: "[MOCK AUTHORIZATION CODE]", state: "[MOCK STATE]" } },
    responseTitle: "BFF validates the callback",
    response: { checks: ["state matches the sign-in request", "authorization code is present"] },
  },
  {
    token: "OIDC tokens · BFF only",
    claims: { id_token: { iss: "https://pingfederate.example.invalid", sub: "user-123", aud: "[MOCK CLIENT ID]", nonce: "[MOCK NONCE]", exp: "[mock expiry]" }, access_token: "[MOCK ACCESS TOKEN]", refresh_token: "[MOCK REFRESH TOKEN]", custody: "BFF only · never sent to the browser" },
    requestTitle: "BFF exchanges the authorization code",
    request: { method: "POST /as/token.oauth2", body: { grant_type: "authorization_code", code: "[MOCK AUTHORIZATION CODE]", redirect_uri: "[BFF CALLBACK URI]", client_id: "[MOCK CLIENT ID]", code_verifier: "[MOCK PKCE VERIFIER]" }, note: "BFF authenticates using the configured PingFederate client-authentication method" },
    responseTitle: "PingFederate token response",
    response: { token_type: "Bearer", access_token: "[MOCK ACCESS TOKEN]", id_token: "[MOCK ID TOKEN]", id_token_validation: "BFF validates the ID token nonce, signature, issuer, audience, and expiry", refresh_token: "[MOCK REFRESH TOKEN]", expires_in: 3600 },
  },
  {
    token: "BFF session · browser cookie",
    claims: { browser: "HTTP-only session cookie only", oauth_tokens: "retained in the BFF session" },
    requestTitle: "BFF establishes the application session",
    request: { event: "BFF stores the validated PingFederate tokens in its server-side session" },
    responseTitle: "Signed-in browser session",
    response: { status: "302 Found", set_cookie: "[HTTP-only session cookie]", browser_tokens: "none" },
  },
  {
    token: "BFF session cookie · browser-held",
    claims: { browser: "HTTP-only session cookie", access_tokens: "none in browser", next: "signed-in user submits a natural-language request" },
    requestTitle: "User asks the AI agent",
    request: { method: "POST /api/agent/invoke", headers: { "Content-Type": "application/json", Cookie: "[MOCK SESSION COOKIE]" }, body: { prompt: "Show my account balance", threadId: "[MOCK THREAD ID]" } },
    responseTitle: "BFF starts agent run",
    response: { status: "processing", session: "validated by BFF", token_custody: "server-side" },
  },
  {
    token: "No user token sent to Agent Service",
    claims: { service: "demo_agent_service · :3006", responsibility: "reasoning and tool proposal only", token_custody: "BFF" },
    requestTitle: "BFF requests agent reasoning",
    request: { method: "POST /api/agent/reason", headers: { "x-internal-gateway-secret": "[REDACTED]" }, body: { messages: [{ role: "user", content: "Show my account balance" }], tools: [{ name: "get_account_balance", description: "Return the balance for an account", inputSchema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] } }], provider: "[CONFIGURED PROVIDER]", model: "[CONFIGURED MODEL]" } },
    responseTitle: "Agent proposes an MCP tool call",
    response: { toolCall: { name: "get_account_balance", arguments: { account_id: "[MOCK ACCOUNT ID]" } }, next: "BFF validates and executes the proposed tool" },
  },
  {
    token: "Agent + MCP actor tokens · BFF-held",
    claims: { provider: "PingFederate", flow: "standard two-exchange delegation", custody: "BFF only", note: "Separate from the earlier OIDC login code exchange" },
    requestTitle: "BFF delegates MCP access through PingFederate",
    request: { method: "POST /as/token.oauth2", exchanges: [
      { step: "1 · user subject + agent actor", grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: "[MOCK USER TOKEN]", actor_token: "[MOCK AGENT ACTOR TOKEN]", audience: "[INTERMEDIATE RESOURCE]" },
      { step: "2 · intermediate subject + MCP actor", grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: "[MOCK AGENT-EXCHANGED TOKEN]", actor_token: "[MOCK MCP ACTOR TOKEN]", audience: "[PINGGATEWAY RESOURCE]", scope: "accounts:read" },
    ] },
    responseTitle: "PingFederate-backed delegation completes",
    response: { result: "two RFC 8693 exchanges", mcp_access_token: "[MOCK MCP ACCESS TOKEN]", custody: "BFF only", authorization: "PingGateway checks token; PingOne Authorize evaluates action policy" },
  },
  {
    token: "MCP access token · BFF-held",
    claims: { aud: "[PINGGATEWAY RESOURCE]", scope: "accounts:read", custody: "BFF only", policyDecision: "PingOne Authorize → PERMIT", browser: "session cookie only · no tokens" },
    requestTitle: "BFF sends authorized MCP call",
    request: { method: "POST /mcp · JSON-RPC", headers: { Authorization: "Bearer [MOCK MCP ACCESS TOKEN]" }, body: { jsonrpc: "2.0", id: "tool-1", method: "tools/call", params: { name: "get_account_balance", arguments: { account_id: "[MOCK ACCOUNT ID]" } } }, route: "PingGateway → PingOne Authorize PERMIT → MCP server" },
    responseTitle: "MCP result returns through BFF",
    response: { status: "200 OK", result: "[MOCK MCP RESULT]", path: "MCP server → PingGateway → BFF → browser", token_exposure: "none" },
  },
];

function LearningPanel({ learning }) {
  return (
    <section className="pfj-learning" aria-labelledby="pfj-learning-title">
      <div className="pfj-learning__intro">
        <span className="pfj-protocol__eyebrow">THE IMPORTANT IDEAS</span>
        <h3 id="pfj-learning-title">Understand this flow</h3>
        <p>{learning.summary}</p>
      </div>
      <div className="pfj-learning__points">
        {learning.points.map((point, index) => (
          <article key={point.title}>
            <span className="pfj-learning__number">{String(index + 1).padStart(2, "0")}</span>
            <div><h4>{point.title}</h4><p>{point.body}</p></div>
          </article>
        ))}
      </div>
      <nav className="pfj-learning__docs" aria-label="PingFederate learning links">
        <h4>Learn from PingFederate documentation</h4>
        <div>{learning.docs.map((doc) => <a key={doc.label} href={doc.href} target="_blank" rel="noreferrer">{doc.label}<span aria-hidden="true"> ↗</span></a>)}</div>
      </nav>
    </section>
  );
}

function ProtocolDetails({ diagramId, stepIndex, learning }) {
  const example = diagramId === "pingfederate" ? PF_LOGIN_PROTOCOL[stepIndex] : PROTOCOL_DETAILS[stepIndex];
  return (
    <details open className="pfj-protocol">
      <summary>Protocol details <span>Mock tokens · API request / response</span></summary>
      <LearningPanel learning={learning} />
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

const withDetail = (guide) => guide.map((g) => ({ ...g, detail: g.what }));

export const DIAGRAMS = {
  jag: {
    label: "ID-JAG flow",
    exchangeSummary: "2 token exchanges",
    title: "ID-JAG token journey",
    intro: "Two sides: PingFederate issues the ID-JAG; the downstream MCP authorization server validates and redeems it.",
    badge: "ID-JAG · urn:ietf:params:oauth:token-type:id-jag",
    lanes: ["ID-JAG issuance and grant redemption", "Gateway policy and protected resource"],
    chain: ["upstream refresh token", "PingFederate ID-JAG", "MCP access token"],
    learning: {
      summary: "ID-JAG has two distinct validation sides. PingFederate validates the refresh token and issues the ID-JAG; the resource authorization server validates that assertion when it redeems it.",
      points: [
        { title: "Side 1 · issue", body: "The BFF sends its server-held refresh token to PingFederate in an OAuth token-exchange request. PingFederate validates it under the configured processor policy, then issues a signed ID-JAG whose audience identifies the receiving authorization server." },
        { title: "Side 2 · validate and redeem", body: "The BFF presents the ID-JAG as a JWT bearer assertion to the downstream MCP authorization server. That server validates the issuer and signature, audience, expiry, ID-JAG type, resource and replay identifier, then returns its own local access token." },
        { title: "Use the right token", body: "The ID-JAG is a short-lived delegation assertion, not the credential sent to the MCP API. The BFF uses the newly issued resource-scoped access token for the PingGateway call; PingOne Authorize evaluates the action policy." },
      ],
      docs: [
        { label: "OAuth grant types", href: "https://docs.pingidentity.com/pingfederate/13.1/introduction_to_pingfederate/pf_grant_types.html" },
        { label: "Refresh token → ID-JAG setup", href: "https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_refresh_token_to_idjag_exchange.html" },
        { label: "JWT bearer assertion setup", href: "https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_oauth_assertion_grant_idp_connection.html" },
      ],
    },
    flow: JAG_DIAGRAM,
    steps: withDetail(JAG_GUIDE),
  },
  pingfederate: {
    label: "PingFederate login",
    exchangeSummary: "PF login + agent authorization",
    title: "PingFederate standard login",
    intro: "PingFederate handles OIDC login. The signed-in user then follows the full AI path: BFF → agent service → PingGateway → PingOne Authorize → MCP server.",
    badge: "Login: PingFederate · Runtime policy: PingOne Authorize",
    lanes: ["Standard PingFederate OIDC login", "AI request · BFF-mediated authorization and MCP call"],
    chain: ["PingFederate login", "BFF session", "Agent Service", "PingGateway + P1AZ", "MCP server"],
    learning: {
      summary: "This comparison uses standard PingFederate OIDC login. After login, the BFF runs the AI request and performs the app's separate agent-delegation exchanges before calling the protected MCP tool.",
      points: [
        { title: "Login · authenticate once", body: "The BFF starts OIDC Authorization Code with PKCE. PingFederate authenticates the user and returns a code; the BFF redeems it, validates the ID token and keeps OAuth tokens server-side behind an HTTP-only browser session." },
        { title: "Agent · propose, BFF executes", body: "The BFF sends the prompt to the reasoning-only Agent Service. The agent proposes a tool call; it does not receive the user's OAuth tokens or call MCP. The BFF owns credentials and executes the approved request." },
        { title: "Delegation · two exchanges after login", body: "The two agent exchanges happen after login. The standard PingFederate adapter performs two RFC 8693 exchanges to construct a scoped MCP access token for the agent action. These runtime delegation exchanges are separate from the earlier OIDC code exchange and from the ID-JAG flow in the other tab." },
        { title: "Policy · protect the MCP action", body: "PingGateway enforces the access token and calls PingOne Authorize. PingOne Authorize evaluates the action policy; PingFederate is the login provider in this view." },
      ],
      docs: [
        { label: "OAuth grant types", href: "https://docs.pingidentity.com/pingfederate/13.1/introduction_to_pingfederate/pf_grant_types.html" },
        { label: "OIDC authorization endpoint", href: "https://docs.pingidentity.com/pingfederate/13.1/developers_reference_guide/pf_authorization_endpoint.html" },
      ],
    },
    flow: LOGIN_DIAGRAM,
    steps: withDetail(LOGIN_GUIDE),
  },
};

export default function PingFederateIdJagPage() {
  const [diagramId, setDiagramId] = useState("jag");
  const diagram = DIAGRAMS[diagramId];
  const { GROUPS, NODES, EDGES, STEPS } = diagram.flow;
  // One stepper walks the arrows: the diagram, its movie reel, the controls and the guide below all follow it.
  const stepper = useDiagramStepper(EDGES.length);
  const guideIndex = stepper.step < 0 ? 0 : Math.max(0, diagram.steps.findIndex((s) => s.edges.includes(stepper.step)));
  const step = diagram.steps[guideIndex];
  const goToGuide = (index) => stepper.goTo(diagram.steps[index].edges[0]);
  const onReset = () => {
    stepper.stop();
    window.dispatchEvent(new Event(REFIT_EVENT));
  };

  const selectDiagram = (id) => {
    stepper.stop();
    setDiagramId(id);
  };

  const controlProps = {
    currentStep: Math.max(stepper.step, 0) + 1,
    totalSteps: stepper.total,
    isSimulating: stepper.active,
    isPaused: stepper.paused,
    onSimulate: stepper.simulate,
    onPrev: stepper.prev,
    onPause: stepper.pause,
    onResume: stepper.resume,
    onNext: stepper.next,
    onStop: stepper.stop,
    onReset,
    stepTimeOptions: STEP_TIME_OPTIONS,
    stepMs: stepper.stepMs,
    onSetStepMs: stepper.setStepMs,
  };

  return (
    <main className="pfj-page" data-testid="pingfederate-id-jag-page">
      <IdJagPathBar current="protocol" />
      <PageHeader className="pfj-header" eyebrow="UC40 · Enterprise-managed MCP authorization" title={diagram.title} summary={diagram.intro}
        actions={<>        <div className="pfj-provider-badge"><span /> {diagram.badge}</div>
        </>} />

      <nav className="pfj-diagram-tabs" role="tablist" aria-label="Architecture views">
        {Object.entries(DIAGRAMS).map(([id, item]) => (
          <button key={id} type="button" role="tab" aria-label={`${item.label}, ${item.exchangeSummary}`} aria-selected={diagramId === id} className={diagramId === id ? "is-current" : ""} onClick={() => selectDiagram(id)}>
            <span>{item.label}</span>
            <small>{item.exchangeSummary}</small>
          </button>
        ))}
      </nav>

      <div className="pfj-toolbar" role="group" aria-label="Top diagram controls">
        <DiagramControls {...controlProps} />
      </div>

      <section className="pfj-diagram" aria-label={`Interactive ${diagram.label}`}>
        <p className="pfj-lanes">{diagram.lanes.map((lane) => <span key={lane}>{lane}</span>)}</p>
        <StaticFlowDiagram
          key={diagramId}
          NODES={NODES}
          EDGES={EDGES}
          GROUPS={GROUPS}
          stepper={stepper}
          steps={STEPS}
          pingStyle
          testId={`pfj-${diagramId}`}
          ariaLabel={`Interactive ${diagram.label}`}
        />
        <div className="pfj-chain" aria-label="Token chain">
          {diagram.chain.map((name, index) => <React.Fragment key={name}>{index > 0 && <b aria-hidden="true">→</b>}<span>{name}</span></React.Fragment>)}
        </div>
      </section>

      <section className="pfj-guide" aria-live="polite">
        <div className="pfj-guide__copy">
          <span className="pfj-step-count">{String(guideIndex + 1).padStart(2, "0")} / {String(diagram.steps.length).padStart(2, "0")}</span>
          <div><h2>{step.title}</h2><p>{step.detail}</p></div>
        </div>
        <nav className="pfj-step-nav" aria-label={`${diagram.label} steps`}>
          <button type="button" onClick={() => goToGuide(Math.max(guideIndex - 1, 0))} disabled={guideIndex === 0} aria-label="Previous step">‹</button>
          {diagram.steps.map((item, index) => (
            <button key={item.title} type="button" className={index === guideIndex ? "is-current" : ""} onClick={() => goToGuide(index)} aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === guideIndex ? "step" : undefined}>{index + 1}</button>
          ))}
          <button type="button" onClick={() => goToGuide(Math.min(guideIndex + 1, diagram.steps.length - 1))} disabled={guideIndex === diagram.steps.length - 1} aria-label="Next step">›</button>
        </nav>
      </section>

      <div className="pfj-toolbar pfj-toolbar--mid" role="group" aria-label="Mid-page diagram controls">
        <span className="pfj-toolbar__label">Playback controls</span>
        <DiagramControls {...controlProps} />
      </div>

      <ProtocolDetails diagramId={diagramId} stepIndex={guideIndex} learning={diagram.learning} />

      {diagramId === "jag" && <p className="pfj-footnote">Two distinct servers validate two distinct credentials: PingFederate validates the upstream token during Side 1; the downstream MCP authorization server validates the ID-JAG during Side 2. The returned MCP access token is used for the resource call.</p>}
      <section className="pfj-calls" aria-labelledby="pfj-calls-h" data-testid="pfj-calls">
        <h2 id="pfj-calls-h">Every call, in order</h2>
        <p className="pfj-intro">The diagram above groups the flow into steps. This lists all 19 calls, from sign-in to the banking API.</p>
        <IdJagCallPlayer />
      </section>
    </main>
  );
}
