import { Link } from "react-router-dom";
import StaticFlowDiagram from "../components/StaticFlowDiagram";
import RelatedLearningRail from "../components/learning/RelatedLearningRail";
import { EDU } from "../components/education/educationIds";
import "./OAuthTokenExchangeLessonPage.css";

const FLOW_STEPS = [
  {
    eyebrow: "T1",
    title: "User session",
    detail: "PingOne authenticates the person. The BFF keeps the browser session and user token out of the model.",
    tone: "user",
  },
  {
    eyebrow: "RFC 8693",
    title: "RFC 8693 exchange",
    detail: "The BFF presents the subject token and an agent actor to request only the authority needed for this action.",
    tone: "exchange",
  },
  {
    eyebrow: "T2",
    title: "Scoped MCP token",
    detail: "The downstream token carries a narrower audience, scopes, and an act chain that the gateway can verify.",
    tone: "downstream",
  },
];

const DELEGATED_PROOF_STEPS = [
  {
    title: "Gateway authorization",
    detail: "PingOne Agent Gateway validates aud, scope, and act before the request can move downstream.",
    tone: "gateway",
  },
  {
    title: "Policy decision",
    detail: "PingOne Authorize returns PERMIT, DENY, or STEP-UP for this user, agent, and action.",
    tone: "policy",
  },
  {
    title: "Tool execution",
    detail: "Tool executes only after PERMIT, using the narrowed token and recording the result as evidence.",
    tone: "tool",
  },
];

// The same three hops as the cards above, drawn as a walkthrough: Play/Step
// walks the arrows in order and the shared movie reel opens the claims detail
// for each hop. StaticFlowDiagram attaches both itself — no extra wiring.
const EXCHANGE_NODES = [
  { id: "browser", group: "user", label: "Browser", sub: ["Agent runs here"], x: 40, y: 130 },
  { id: "bff", group: "agent", label: "BFF", sub: ["Holds the user token"], x: 340, y: 130 },
  { id: "pingone", group: "pingone", label: "PingOne", sub: ["RFC 8693 exchange"], x: 640, y: 130 },
  { id: "mcp", group: "resource", label: "MCP Server", sub: ["Verifies act chain"], x: 940, y: 130 },
];

const EXCHANGE_EDGES = [
  ["browser", "bff", "user session", { detail: "PingOne authenticated the person; the browser session stays in the BFF." }],
  ["bff", "pingone", "exchange: subject + actor", { detail: "The BFF presents the user token as subject and the agent token as actor." }],
  ["pingone", "bff", "scoped MCP token", { detail: "Narrower audience, narrower scopes, act = agent. The user token never left the BFF." }],
  ["bff", "mcp", "tool call with MCP token", { detail: "The MCP server verifies aud, scope, and act before executing." }],
];

const EXCHANGE_WALK = [
  {
    title: "User session", label: "T1 — who is acting for whom",
    nodes: ["browser", "bff"], edges: [0],
    lines: [{ who: "User", text: FLOW_STEPS[0].detail }],
  },
  {
    title: "RFC 8693 exchange", label: "Subject + actor in, authority out",
    nodes: ["bff", "pingone"], edges: [1],
    lines: [{ who: "BFF", text: FLOW_STEPS[1].detail }],
  },
  {
    title: "Scoped MCP token", label: "T2 — shaped for its job",
    nodes: ["pingone", "bff"], edges: [2],
    lines: [{ who: "PingOne", text: FLOW_STEPS[2].detail }],
  },
  {
    title: "Governed tool call", label: "The gateway can verify every claim",
    nodes: ["bff", "mcp"], edges: [3],
    lines: [
      { who: "Gateway", text: DELEGATED_PROOF_STEPS[0].detail },
      { who: "Tool", text: DELEGATED_PROOF_STEPS[2].detail },
    ],
  },
];

const EXCHANGE_GROUPS = {
  user: { label: "User", bg: "var(--th-status-info)" },
  agent: { label: "Agent / BFF", bg: "var(--th-bg-emphasis)" },
  pingone: { label: "PingOne", bg: "var(--th-status-success)" },
  resource: { label: "Resource server", bg: "var(--th-border-strong)" },
};

// The proof cards below as a walkable diagram, with the deny / step-up branch.
const PROOF_NODES = [
  { id: "gateway", group: "agent", label: "Agent Gateway", sub: ["Checks aud, scope, act"], x: 40, y: 60 },
  { id: "authorize", group: "pingone", label: "PingOne Authorize", sub: ["PERMIT / DENY / STEP-UP"], x: 340, y: 60 },
  { id: "tool", group: "resource", label: "MCP tool", sub: ["Runs on PERMIT"], x: 640, y: 60 },
  { id: "challenge", group: "user", label: "Challenge", sub: ["No tool call"], x: 340, y: 230 },
];

const PROOF_EDGES = [
  ["gateway", "authorize", "decision request", { detail: DELEGATED_PROOF_STEPS[0].detail }],
  ["authorize", "tool", "PERMIT", { detail: DELEGATED_PROOF_STEPS[2].detail }],
  ["authorize", "challenge", "DENY / STEP-UP", { detail: "Stop before tool execution, return the challenge, and require a new decision before retrying." }],
];

const OAUTH_EDUCATION_LINKS = [  {
    panelId: EDU.RFC_8693,
    tabId: "overview",
    label: "RFC 8693 deep dive",
    detail: "Request, response, act claim, hops, and security guidance.",
    ariaLabel: "Open RFC 8693 in Education Hub",
  },
  {
    panelId: EDU.TOKEN_FLOW,
    tabId: "diagram",
    label: "Token flow",
    detail: "Trace audiences, scopes, and custody through the app.",
    ariaLabel: "Open token flow in Education Hub",
  },
  {
    panelId: EDU.PINGONE_AUTHORIZE,
    tabId: "what",
    label: "PingOne Authorize",
    detail: "See how policy decides over delegated identity.",
    ariaLabel: "Open PingOne Authorize in Education Hub",
  },
];

const OAUTH_APP_LINKS = [
  {
    to: "/oauth-academy",
    label: "OAuth Academy",
    detail: "Continue through the complete OAuth teaching path.",
    ariaLabel: "Continue in OAuth Academy",
  },
  {
    to: "/token-exchange-tester",
    label: "Token Exchange Tester",
    detail: "Run a real exchange and inspect its response.",
    ariaLabel: "Run the Token Exchange Tester",
  },
  {
    to: "/transaction-trace",
    label: "Transaction trace",
    detail: "Review the resulting evidence across protected hops.",
    ariaLabel: "Open the transaction trace",
  },
];

const OAUTH_EXTERNAL_LINKS = [
  {
    href: "https://www.rfc-editor.org/rfc/rfc8693",
    label: "OAuth 2.0 Token Exchange",
    detail: "The RFC 8693 specification from the RFC Editor.",
    ariaLabel: "Read RFC 8693",
  },
  {
    href: "https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html",
    label: "PingOne AI Agents",
    detail: "Official product guidance for agent identities and delegated access.",
    ariaLabel: "Explore PingOne AI agents",
  },
];

export default function OAuthTokenExchangeLessonPage() {
  return (
    <div className="ote-lesson">
      <section className="ote-hero" aria-labelledby="ote-title">
        <div className="ote-hero__copy">
          <p className="ote-eyebrow">OAuth teaching / RFC 8693</p>
          <h2 id="ote-title">Turn one user session into the right token for each hop.</h2>
          <p className="ote-hero__lede">
            Use this story when someone asks, “Why can’t the agent just reuse the user’s token?”
            The answer is visible: each downstream service gets a token shaped for its job.
          </p>
          <div className="ote-hero__actions">
            <Link className="ote-button ote-button--primary" to="/token-exchange-tester">
              Open the live token exchange
            </Link>
            <Link className="ote-button ote-button--quiet" to="/transaction-trace">
              Inspect the evidence trail
            </Link>
          </div>
        </div>
        <div className="ote-hero__proof" aria-label="Token exchange outcomes">
          <div className="ote-proof-stat">
            <strong>1 → 3</strong>
            <span>one user intent, three accountable boundaries</span>
          </div>
          <div className="ote-proof-stat">
            <strong>0</strong>
            <span>raw browser bearer tokens sent to the model</span>
          </div>
          <div className="ote-proof-stat ote-proof-stat--accent">
            <strong>aud + scope + act</strong>
            <span>the claims a downstream service can verify</span>
          </div>
        </div>
      </section>

      <section className="ote-section" aria-labelledby="ote-flow-title">
        <div className="ote-section__heading">
          <div>
            <p className="ote-eyebrow">The request path</p>
            <h3 id="ote-flow-title">Follow the authority, not just the token.</h3>
          </div>
          <p>Click through the live tester after this page to see the same sequence populated with evidence.</p>
        </div>
        <div className="ote-flow" aria-label="OAuth token exchange flow">
          {FLOW_STEPS.map((step, index) => (
            <div className="ote-flow__item" key={step.title}>
              <article className={`ote-flow-card ote-flow-card--${step.tone}`}>
                <span className="ote-flow-card__eyebrow">{step.eyebrow}</span>
                <h4>{step.title}</h4>
                <p>{step.detail}</p>
              </article>
              {index < FLOW_STEPS.length - 1 ? <span className="ote-flow__arrow" aria-hidden="true">→</span> : null}
            </div>
          ))}
        </div>
        <div className="ote-flow-diagram">
          <StaticFlowDiagram
            NODES={EXCHANGE_NODES}
            EDGES={EXCHANGE_EDGES}
            GROUPS={EXCHANGE_GROUPS}
            walk={EXCHANGE_WALK}
            details={Object.fromEntries(EXCHANGE_NODES.map((n) => [n.id, (EXCHANGE_EDGES.find(([from]) => from === n.id) || [])[3]?.detail || ""]))}
            ariaLabel="RFC 8693 token exchange walkthrough"
            testId="ote-exchange-diagram"
          />
        </div>
      </section>

      <section className="ote-section ote-proof-section" aria-labelledby="ote-proof-title">
        <div className="ote-section__heading">
          <div>
            <p className="ote-eyebrow">Delegated access proof</p>
            <h3 id="ote-proof-title">Gateway authorization and proof</h3>
          </div>
          <p>The token proves delegation; the policy decision proves whether this action is allowed.</p>
        </div>
        <div className="ote-proof-flow" aria-label="Delegated access authorization flow">
          {DELEGATED_PROOF_STEPS.map((step, index) => (
            <div className="ote-proof-flow__item" key={step.title}>
              <article className={`ote-proof-card ote-proof-card--${step.tone}`}>
                <span className="ote-proof-card__number">0{index + 1}</span>
                <h4>{step.title}</h4>
                <p>{step.detail}</p>
              </article>
              {index < DELEGATED_PROOF_STEPS.length - 1 ? <span className="ote-flow__arrow" aria-hidden="true">→</span> : null}
            </div>
          ))}
        </div>
        <div className="ote-flow-diagram">
          <StaticFlowDiagram
            NODES={PROOF_NODES}
            EDGES={PROOF_EDGES}
            GROUPS={EXCHANGE_GROUPS}
            details={Object.fromEntries(PROOF_NODES.map((n) => [n.id, (PROOF_EDGES.find(([from]) => from === n.id) || [])[3]?.detail || ""]))}
            ariaLabel="Delegated access authorization walkthrough"
            testId="ote-proof-diagram"
          />
        </div>
        <div className="ote-proof-branch" role="note">
          <strong>Deny or step-up</strong>
          <span>Stop before tool execution, return the challenge, and require a new decision before retrying.</span>
        </div>
      </section>

      <section className="ote-section ote-section--split" aria-labelledby="ote-show-title">
        <div>
          <p className="ote-eyebrow">Demo choice</p>
          <h3 id="ote-show-title">What you can show in the room</h3>
          <p className="ote-section__intro">
            Start with the proof you have available, then move to the live tenant when the audience wants to inspect the real decision.
          </p>
        </div>
        <div className="ote-demo-grid">
          <article className="ote-demo-card ote-demo-card--live">
            <div className="ote-demo-card__topline"><span className="ote-dot" /> Live tenant</div>
            <h4>Live: run the exchange against the configured PingOne tenant.</h4>
            <p>Show the actual authorization, exchange, audience, scope, and downstream evidence available in this environment.</p>
            <ul>
              <li>Best for technical validation</li>
              <li>Requires sign-in and tenant connectivity</li>
            </ul>
          </article>
          <article className="ote-demo-card ote-demo-card--mock">
            <div className="ote-demo-card__topline"><span className="ote-dot" /> Recorded path</div>
            <h4>Mock: use the recorded chain when credentials or network access are unavailable.</h4>
            <p>Keep the explanation moving with the same claims and checkpoints, clearly labeled as recorded evidence.</p>
            <ul>
              <li>Best for a short standalone demo</li>
              <li>Never presented as live tenant proof</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="ote-talk-track" aria-labelledby="ote-talk-title">
        <div>
          <p className="ote-eyebrow">Sales-engineer talk track</p>
          <h3 id="ote-talk-title">Three sentences that land the point.</h3>
        </div>
        <ol>
          <li><strong>Authentication</strong> establishes the user; it does not give the agent unlimited authority.</li>
          <li><strong>Token exchange</strong> changes the token for a new audience and a purpose-built scope set.</li>
          <li><strong>Authorization</strong> still decides whether this specific action is allowed right now.</li>
        </ol>
      </section>

      <RelatedLearningRail
        id="oauth-token-exchange"
        educationLinks={OAUTH_EDUCATION_LINKS}
        appLinks={OAUTH_APP_LINKS}
        externalLinks={OAUTH_EXTERNAL_LINKS}
      />
    </div>
  );
}
