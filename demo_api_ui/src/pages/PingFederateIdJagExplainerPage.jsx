import { Link } from "react-router-dom";
import "./PingFederateIdJagExplainerPage.css";

const FLOW = [
  ["01", "Sign in once", "The browser signs in through PingFederate. The BFF keeps the refresh token and browser tokens out of the agent and MCP calls."],
  ["02", "Request an ID-JAG", "The BFF asks PingFederate for an audience-bound Identity Assertion JWT Authorization Grant for the downstream MCP authorization server."],
  ["03", "Redeem the assertion", "The MCP authorization server validates PingFederate's signature through its JWKS, checks issuer, audience, resource, expiry, and replay, then issues its own access token."],
  ["04", "Call the protected tool", "The BFF uses the downstream access token for the MCP call. The ID-JAG is the grant, not the bearer token used by the resource."],
];

export default function PingFederateIdJagExplainerPage() {
  return (
    <main className="pfj-explainer" data-testid="pingfederate-id-jag-explainer">
      <header className="pfj-explainer__hero">
        <div>
          <p className="pfj-explainer__eyebrow">PingFederate · enterprise-managed authorization</p>
          <h1>How the ID-JAG demo works</h1>
          <p className="pfj-explainer__lede">
            This demo shows PingFederate carrying a user identity across the MCP trust boundary without sending the user through a second consent screen.
          </p>
        </div>
        <div className="pfj-explainer__actions">
          <Link className="pfj-explainer__primary" to="/pingfederate-id-jag/demo">Run the demo</Link>
          <Link className="pfj-explainer__secondary" to="/pingfederate-id-jag/diagram">Open the diagram</Link>
        </div>
      </header>

      <section className="pfj-explainer__definition" aria-labelledby="id-jag-definition">
        <div>
          <p className="pfj-explainer__eyebrow">The short version</p>
          <h2 id="id-jag-definition">One identity, two authorization servers</h2>
        </div>
        <p>
          PingFederate is the identity provider and issuer. The downstream MCP authorization server trusts PingFederate's issuer and JWKS, redeems the ID-JAG, and mints the resource-specific access token used for the tool call.
        </p>
      </section>

      <section className="pfj-explainer__flow" aria-labelledby="id-jag-flow">
        <div className="pfj-explainer__section-heading">
          <p className="pfj-explainer__eyebrow">Live request path</p>
          <h2 id="id-jag-flow">What happens when you run “show my balance”</h2>
        </div>
        <div className="pfj-explainer__steps">
          {FLOW.map(([number, title, detail]) => (
            <article key={number} className="pfj-explainer__step">
              <span className="pfj-explainer__step-number">{number}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pfj-explainer__boundary" aria-labelledby="id-jag-boundary">
        <div>
          <p className="pfj-explainer__eyebrow">Trust boundary</p>
          <h2 id="id-jag-boundary">The important distinction</h2>
        </div>
        <div className="pfj-explainer__boundary-grid">
          <div><strong>PingFederate issues</strong><span>the signed ID-JAG assertion</span></div>
          <div><strong>The MCP AS redeems</strong><span>the assertion and issues its local access token</span></div>
          <div><strong>The BFF calls</strong><span>the MCP resource without exposing tokens to the browser</span></div>
        </div>
      </section>
    </main>
  );
}
