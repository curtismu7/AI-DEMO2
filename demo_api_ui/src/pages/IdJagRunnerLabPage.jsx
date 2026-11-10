import { Link } from "react-router-dom";
import IdJagPathBar from "../components/IdJagPathBar";
import "./IdJagLearnPage.css";
import "./IdJagRunnerLabPage.css";

const LAB_URL = "https://local.ping-devops.com:8443/idjag-runner/";

const ACTS = [
  {
    n: 1,
    title: "Sign in — Authorization server 1 (PingFederate as IdP)",
    body: "The lab sends demouser's password grant to the token endpoint. AS 1 issues the access token, refresh token and — on the refresh grant — the ID token. Every token decodes in the page.",
  },
  {
    n: 2,
    title: "Mint the ID-JAG — Authorization server 1 (enterprise issuer)",
    "body": "The same PingFederate, in its enterprise-issuer role, exchanges the subject token for an ID-JAG: a short-lived signed grant naming the user, the app and the target resource server. Pick any of the three subject kinds — the result is the same oauth-id-jag+jwt assertion.",
  },
  {
    n: 3,
    title: "Redeem it — Authorization server 2 (resource AS)",
    body: "The lab hands the ID-JAG to the second authorization server as a jwt-bearer assertion. AS 2 checks the signature against AS 1's published JWKS and issues its own access token for the resource. Introspection then shows exactly what the API would learn.",
  },
  {
    n: 4,
    title: "Watch it refuse — the policy holds",
    body: "Four deliberate mistakes: the wrong client redeems, the exchange names an unknown resource, a forged assertion, and a scope the client was never granted. Every refusal renders green — the point is that PingFederate says no.",
  },
];

export default function IdJagRunnerLabPage() {
  return (
    <div className="ijl" data-testid="id-jag-runner-lab">
      <IdJagPathBar current="run" />
      <header className="ijl-hero">
        <p className="ijl-eyebrow">Run it live</p>
        <h1>ID-JAG Runner Lab</h1>
        <p className="ijl-lede">
          A standalone lab that runs the ID-JAG demo without Postman: one PingFederate plays two
          authorization servers (the enterprise issuer and the resource AS), and the MCP server is
          the resource. Everything is driven from a browser — every request, response and decoded
          token is shown.
        </p>
      </header>

      <section className="ijrl-cta">
        <a className="ijrl-cta-btn" href={LAB_URL} target="_blank" rel="noreferrer">
          Open the ID-JAG Runner Lab ↗
        </a>
        <p className="ijrl-cta-note">
          Local lab: <span className="mono">{LAB_URL}</span>. Sign in as <span className="mono">demouser</span> —
          only the password is needed; the demo clients are pre-filled.
        </p>
      </section>

      <section className="ijl-section">
        <h2>The four acts</h2>
        <ol className="ijrl-acts">
          {ACTS.map((a) => (
            <li key={a.n} className="ijrl-act">
              <span className="ijrl-act-num">{a.n}</span>
              <div>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="ijl-section">
        <h2>Where it runs</h2>
        <p>
          The lab lives in its own repo (<span className="mono">idjag-runner-LAB</span>) with a Docker
          compose file; locally it is served through the shared lab proxy on the demo domain. It drives a
          real PingFederate 13.1+ — the same <span className="mono">idjag-*</span> demo objects the Postman
          setup collection builds, so both paths show the same configuration.
        </p>
        <p>
          Prefer Postman? The SE package's collections run the identical flow — see the
          {" "}<Link to="/pingfederate-id-jag/implementation">implementation page</Link>.
        </p>
      </section>
    </div>
  );
}
