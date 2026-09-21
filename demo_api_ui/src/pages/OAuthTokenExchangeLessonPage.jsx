import { Link } from "react-router-dom";
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
    </div>
  );
}
