import { Link } from "react-router-dom";
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
    detail: "Ping Agent Gateway validates aud, scope, and act before the request can move downstream.",
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

const OAUTH_EDUCATION_LINKS = [
  {
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
