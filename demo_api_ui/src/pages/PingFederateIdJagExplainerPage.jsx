import { useState } from "react";
import { Link } from "react-router-dom";
import IdJagPathBar from "../components/IdJagPathBar";
import { diagramLinkProps } from "../utils/diagramLinks";
import "./PingFederateIdJagExplainerPage.css";
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from '../components/pingUi';

// /pingfederate-id-jag: a written explainer. Nothing on it makes a request, so nothing is simulated either: the
// banner says so, and sends the reader to "Run the demo" for the page where a run happens.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 key-value, P7 chip, P9 buttons.
// P9 "one primary per view": "Run the demo" is the primary in both toggle states (technical and plain-language);
// the other two header links and the Simple/Detailed toggle are secondaries. The learning-path bar's "Next: Run it"
// link is a shared child that fills itself red, so this page's sheet restyles it as a secondary.

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
  const heroActions = (
    <div className="pu-actions pfj-explainer__actions">
      <Link className="pu-btn pu-btn--primary" to="/pingfederate-id-jag/demo">Run the demo</Link>
      <Link className="pu-btn" to="/pingfederate-id-jag/diagram" {...diagramLinkProps("/pingfederate-id-jag/diagram")}>Open the diagram</Link>
      <Link className="pu-btn" to="/pingfederate-id-jag/implementation" {...diagramLinkProps("/pingfederate-id-jag/implementation")}>See how we built it</Link>
    </div>
  );
  return (
    <PingPage className="pfj-explainer" data-testid="pingfederate-id-jag-explainer">
      <SimBanner data-testid="pfj-banner">
        <strong>EXPLAINER</strong> — nothing on this page runs. It describes the ID-JAG flow in words: no request is
        made from here to PingFederate, the MCP authorization server, the gateway or the banking API, and the
        plain-language version is an analogy, not a trace. “Run the demo” opens the page where a run happens, in the
        mode you pick there.
      </SimBanner>
      <PageHeader className="pfj-explainer__hero" eyebrow="PingFederate · enterprise-managed authorization" title="How the ID-JAG demo works" summary="This demo shows PingFederate carrying a user identity across the MCP trust boundary without sending the user through a second consent screen."
        actions={heroActions} />

      <PageFrame>
        <IdJagPathBar current="explain" />

        <Section
          id="id-jag-definition"
          kicker="The short version"
          title="One identity, two authorization servers"
          lede="PingFederate is the identity provider and issuer. The downstream MCP authorization server trusts PingFederate's issuer and JWKS, redeems the ID-JAG, and mints the resource-specific access token used for the tool call."
        />

        <Section id="id-jag-flow" kicker="The request path" title="What happens when you run “show my balance”">
          <div className="pu-status-line">
            <button type="button" className="pu-btn" aria-pressed={simple} onClick={() => setSimple(!simple)}>
              {simple ? "Show the technical version" : "Explain it simply"}
            </button>
            <StatusChip tone="neutral">{simple ? "Plain-language story" : "Technical version"}</StatusChip>
          </div>
          <CardGrid>
            {FLOW.map(([number, title, detail]) => (
              <Card key={number}>
                <p className="pu-label">Step {number}</p>
                <h3 className="pu-h3">{title}</h3>
                <p className="pu-note">{simple ? SIMPLE[Number(number) - 1] : detail}</p>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section id="id-jag-boundary" kicker="Trust boundary" title="The important distinction">
          <Card>
            <KvList
              items={[
                { label: "PingFederate issues", value: "the signed ID-JAG assertion" },
                { label: "The MCP AS redeems", value: "the assertion and issues its local access token" },
                { label: "The BFF calls", value: "the gateway, MCP server and banking API without exposing tokens to the browser" },
              ]}
            />
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
