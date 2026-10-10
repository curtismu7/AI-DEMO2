import React, { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "./LearningProtocolLabPage.css";

const LABS = {
  par: {
    title: "PAR protocol lab",
    standard: "RFC 9126",
    summary: "Push the full authorization request server-to-server, then redirect with only a short-lived request URI.",
  },
  rar: {
    title: "RAR policy lab",
    standard: "RFC 9396",
    summary: "Change the requested transaction amount and see a deterministic policy decision for the authorization details.",
  },
  "jwt-client-auth": {
    title: "JWT client authentication lab",
    standard: "RFC 7523",
    summary: "Validate a client assertion, then deliberately change its issuer to see the trust check fail.",
  },
  "step-up": {
    title: "Step-up MFA lab",
    standard: "Demo policy",
    summary: "Evaluate a transfer, trigger a stronger-authentication requirement, and complete the approval branch.",
  },
};

function LabHeader({ lab }) {
  return (
    <header className="learning-lab__header">
      <div>
        <Link className="learning-lab__back" to="/learning">Back to Learning Hub</Link>
        <p className="learning-lab__eyebrow">Runnable simulated example · {lab.standard}</p>
        <h1>{lab.title}</h1>
        <p>{lab.summary}</p>
      </div>
      <span className="learning-lab__badge">SIMULATED</span>
    </header>
  );
}

function Result({ children, kind = "info" }) {
  return <div className={`learning-lab__result learning-lab__result--${kind}`} role="status">{children}</div>;
}

function ParLab() {
  const [pushed, setPushed] = useState(false);
  return (
    <section className="learning-lab__panel" aria-labelledby="par-lab-title">
      <h2 id="par-lab-title">Push before redirect</h2>
      <p>The browser never carries the full scope, PKCE, and redirect parameters in this mock flow.</p>
      <div className="learning-lab__flow">
        <span>1. Build request</span><span>→</span><span>2. POST /as/par</span><span>→</span><span>3. Redirect with request_uri</span>
      </div>
      <button type="button" onClick={() => setPushed(true)}>Push authorization request</button>
      {pushed && (
        <Result kind="success">
          <strong>request_uri created</strong>
          <code>urn:example:par:request-001</code>
          <small>expires_in: 90 seconds · one-time use · browser-visible parameters: client_id + request_uri</small>
        </Result>
      )}
    </section>
  );
}

function RarLab() {
  const [amount, setAmount] = useState("50");
  const decision = Number(amount) > 1000 ? "STEP-UP" : Number(amount) > 0 ? "PERMIT" : "DENY";
  return (
    <section className="learning-lab__panel" aria-labelledby="rar-lab-title">
      <h2 id="rar-lab-title">Evaluate authorization details</h2>
      <p>The mock policy permits ordinary transfers, requires stronger approval above $1,000, and denies invalid amounts.</p>
      <label htmlFor="rar-amount">Amount</label>
      <div className="learning-lab__input-row">
        <input id="rar-amount" type="number" min="-1" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button type="button" onClick={() => setAmount(amount)}>Evaluate authorization details</button>
      </div>
      <Result kind={decision === "PERMIT" ? "success" : decision === "STEP-UP" ? "warning" : "danger"}>
        <strong>Decision: {decision}</strong>
        <code>{JSON.stringify({ type: "payment", amount: Number(amount) || 0, currency: "USD" })}</code>
      </Result>
    </section>
  );
}

function JwtClientAuthLab() {
  const [invalidIssuer, setInvalidIssuer] = useState(false);
  const [validated, setValidated] = useState(false);
  const result = validated ? (invalidIssuer ? "issuer rejected" : "assertion accepted") : null;
  return (
    <section className="learning-lab__panel" aria-labelledby="jwt-lab-title">
      <h2 id="jwt-lab-title">Validate a client assertion</h2>
      <p>This mock validator checks the issuer, audience, signature placeholder, and expiration claims before token issuance.</p>
      <pre>{JSON.stringify({ iss: invalidIssuer ? "untrusted-client" : "agent-demo-client", aud: "https://auth.example.test/as/token", alg: "RS256", exp: 1893456000 }, null, 2)}</pre>
      <div className="learning-lab__button-row">
        <button type="button" onClick={() => setValidated(true)}>Validate assertion</button>
        <button type="button" className="learning-lab__secondary" onClick={() => { setInvalidIssuer(true); setValidated(false); }}>Use invalid issuer</button>
      </div>
      {result && <Result kind={invalidIssuer ? "danger" : "success"}><strong>{result}</strong></Result>}

      <h2 id="jwt-lab-live">This one is live in the demo</h2>
      <p>
        The simulated validator above teaches the check; the demo also runs the real thing.
        The BFF's RFC 8693 token exchange (UC1 and every MCP hop) can authenticate with a
        dedicated application whose token-endpoint auth method is <code>private_key_jwt</code>:
        the BFF signs a short-lived RS256 assertion (iss = sub = its client id, aud = the token
        endpoint, exp 60s) with an RSA key provisioned on that app as a JWKS — no client secret
        crosses the wire.
      </p>
      <p>
        Verified live 2026-10-10: the dedicated exchanger performed a client-credentials
        grant and a full RFC 8693 exchange, both authenticated by the signed assertion.
        Watch it run: <Link to="/config">/config</Link> (flag <code>ff_private_key_jwt_token_exchange</code>)
        and the Token Exchange dashboard's <code>dedicated-app</code> facet records each
        assertion-authenticated exchange.
      </p>
    </section>
  );
}

function StepUpLab() {
  const [amount, setAmount] = useState("25");
  const [decision, setDecision] = useState("PERMIT");
  const [approved, setApproved] = useState(false);
  const evaluated = useMemo(() => Number(amount) >= 500, [amount]);
  const evaluate = () => {
    setApproved(false);
    setDecision(evaluated ? "STEP-UP REQUIRED" : Number(amount) > 0 ? "PERMIT" : "DENY");
  };
  return (
    <section className="learning-lab__panel" aria-labelledby="step-up-lab-title">
      <h2 id="step-up-lab-title">Escalate a sensitive action</h2>
      <p>Transfers at or above $500 pause until the stronger-authentication challenge is approved.</p>
      <label htmlFor="step-up-amount">Amount</label>
      <div className="learning-lab__input-row">
        <input id="step-up-amount" type="number" min="-1" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button type="button" onClick={evaluate}>Evaluate transfer</button>
      </div>
      {decision === "STEP-UP REQUIRED" && !approved && (
        <Result kind="warning"><strong>Step-up required</strong><button type="button" onClick={() => setApproved(true)}>Approve step-up</button></Result>
      )}
      {approved && <Result kind="success"><strong>Transfer permitted after step-up</strong></Result>}
      {decision !== "STEP-UP REQUIRED" && !approved && <Result kind={decision === "PERMIT" ? "success" : "danger"}><strong>Decision: {decision}</strong></Result>}
    </section>
  );
}

export default function LearningProtocolLabPage() {
  const { lab: labId } = useParams();
  const lab = LABS[labId];
  if (!lab) {
    return (
      <main className="learning-lab">
        <Link className="learning-lab__back" to="/learning">Back to Learning Hub</Link>
        <h1>Training lab not found</h1>
        <p className="learning-lab__honesty">Choose a runnable simulated example from the Learning Hub.</p>
      </main>
    );
  }
  return (
    <main className="learning-lab">
      <LabHeader lab={lab} />
      {labId === "rar" ? <RarLab /> : labId === "jwt-client-auth" ? <JwtClientAuthLab /> : labId === "step-up" ? <StepUpLab /> : <ParLab />}
      <p className="learning-lab__honesty">This is a deterministic training lab. It demonstrates the protocol decision and evidence shape without calling an external authorization server.</p>
    </main>
  );
}
