import { useState } from "react";
import { Link } from "react-router-dom";
import IdJagPathBar from "../components/IdJagPathBar";
import { diagramLinkProps } from "../utils/diagramLinks";
import "./PingFederateIdJagExplainerPage.css";
import PageHeader from '../components/common/PageHeader';

const FLOW = [
  ["01", "Sign in once", "The browser signs in through PingFederate. The BFF keeps the refresh token and browser tokens out of the agent and MCP calls."],
  ["02", "Request an ID-JAG", "The BFF asks PingFederate for an audience-bound Identity Assertion JWT Authorization Grant addressed to the MCP authorization server."],
  ["03", "Redeem the assertion", "The MCP authorization server validates PingFederate's signature through its JWKS, checks issuer, audience, resource, expiry, the client it was issued to, and replay, then issues its own access token. The ID-JAG goes no further."],
  ["04", "Pass the gateway", "The BFF sends the access token to the MCP gateway, which verifies it against the authorization server's keys, applies policy, and forwards it to the backend that owns the tool."],
  ["05", "Run the tool", "The MCP server (the OLB backend) runs get_my_accounts. It sees a token its own authorization server issued and passes it through unchanged."],
  ["06", "Read the data", "The MCP server calls the BFF banking API with that same token. The banking API verifies the signature and issuer, then returns the account data."],
  ["07", "Nothing goes back", "PingFederate is not called again. The authorization server only reads PingFederate's public keys. When the access token expires, the BFF repeats from step 02."],
];

// "Explain it like I'm five": the same seven steps as a school story.
const SIMPLE = [
  "You sign in at the school front office. The school computer keeps your special pass locked in a drawer. You never touch it.",
  "The computer takes your pass back to the front office and says: please write a note for the toy room. The note is a permission slip.",
  "The toy-room teacher checks the slip: is the signature real, is it still fresh, is it for this toy room, is it for this kid? A slip works only once.",
  "The teacher keeps the slip and hands over a visitor sticker. The kid shows the sticker to the hallway guard, who lets it through.",
  "The toy-room helper sees the sticker and goes to fetch your toy, which is your account balance.",
  "The helper shows the same sticker at the bank vault. The vault checks it once more and hands over the answer.",
  "Nobody goes back to the front office. When the sticker runs out, the kid asks for a new slip.",
];


export default function PingFederateIdJagExplainerPage() {
  const [simple, setSimple] = useState(false);
  return (
    <main className="pfj-explainer" data-testid="pingfederate-id-jag-explainer">
      <IdJagPathBar current="explain" />
      <PageHeader className="pfj-explainer__hero" eyebrow="PingFederate · enterprise-managed authorization" title="How the ID-JAG demo works" summary="This demo shows PingFederate carrying a user identity across the MCP trust boundary without sending the user through a second consent screen."
        actions={<>        <div className="pfj-explainer__actions">
          <Link className="pfj-explainer__primary" to="/pingfederate-id-jag/demo">Run the demo</Link>
          <Link className="pfj-explainer__secondary" to="/pingfederate-id-jag/diagram" {...diagramLinkProps("/pingfederate-id-jag/diagram")}>Open the diagram</Link>
          <Link className="pfj-explainer__secondary" to="/pingfederate-id-jag/implementation" {...diagramLinkProps("/pingfederate-id-jag/implementation")}>See how we built it</Link>
        </div>
        </>} />

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
          <button type="button" className="pfj-explainer__secondary" aria-pressed={simple} onClick={() => setSimple(!simple)}>
            {simple ? "Show the technical version" : "Explain it simply"}
          </button>
        </div>
        <div className="pfj-explainer__steps">
          {FLOW.map(([number, title, detail]) => (
            <article key={number} className="pfj-explainer__step">
              <span className="pfj-explainer__step-number">{number}</span>
              <h3>{title}</h3>
              <p>{simple ? SIMPLE[Number(number) - 1] : detail}</p>
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
          <div><strong>The BFF calls</strong><span>the gateway, MCP server and banking API without exposing tokens to the browser</span></div>
        </div>
      </section>
    </main>
  );
}
