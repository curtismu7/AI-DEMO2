import { useState } from "react";
import apiClient from "../../services/apiClient";
import { FeatureStatus } from "./shared";

// DPoP (RFC 9449): the token PingFederate issues is bound to a key the BFF holds, so a copy of it is useless.
export default function PfDpopSection({ ready, result }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bound = result?.dpopThumbprint ? result : null;

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { data } = await apiClient.post("/api/pf-ai-agent/dpop/start");
      window.location.assign(data.authorizeUrl);
    } catch (failure) {
      setError(failure?.response?.data?.error || "pf_ai_start_failed");
      setBusy(false);
    }
  }

  return (
    <section className="pf-ai-agent__flow pf-ai-agent__flow--dpop" aria-labelledby="pf-ai-dpop-title" id="dpop">
      <div className="pf-ai-agent__flow-title">
        <p className="pf-ai-agent__eyebrow">Sender-constrained tokens</p>
        <h2 id="pf-ai-dpop-title">DPoP</h2>
        <p>PingFederate binds the access token to a key only the BFF holds. A stolen copy fails without that key.</p>
        <FeatureStatus ready={ready} />
      </div>
      <div className="pf-ai-agent__flow-body">
        <dl className="pf-ai-agent__facts">
          <div><dt>Standard</dt><dd>RFC 9449</dd></div>
          <div><dt>Client</dt><dd>ai-demo-pf-rar-dpop (DPoP required)</dd></div>
          <div><dt>Proof</dt><dd>A signed JWT per request, carrying the public key</dd></div>
        </dl>
        {ready
          ? (
            <button className="pf-ai-agent__action" type="button" onClick={start} disabled={busy}>
              {busy ? "Opening PingFederate" : "Sign in and get a DPoP-bound token"}
            </button>
          )
          : <span className="pf-ai-agent__disabled-action">Enable the PF DPoP client to run this</span>}
        {error && <p className="pf-ai-agent__error" role="alert">DPoP sign-in did not start. Reason: <code>{error}</code></p>}
        {bound && (
          <div className="pf-ai-agent__result" role="status" data-testid="dpop-result">
            <h3>Token bound to this app&apos;s key</h3>
            <dl>
              <div><dt>Token type</dt><dd>{bound.tokenType}</dd></div>
              <div><dt>Key thumbprint (cnf.jkt)</dt><dd><code>{bound.dpopThumbprint}</code></dd></div>
            </dl>
            <p className="pf-ai-agent__hint">The full request trace is in the rich authorization request section below.</p>
          </div>
        )}
      </div>
    </section>
  );
}
