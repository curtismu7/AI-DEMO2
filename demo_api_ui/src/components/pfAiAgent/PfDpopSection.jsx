import { useState } from "react";
import apiClient from "../../services/apiClient";
import { Card, KvList, StatusChip } from "../pingUi";
import { FeatureStatus, FlowSection, RunStatus, Unavailable, actionClass } from "./shared";

// DPoP (RFC 9449): the token PingFederate issues is bound to a key the BFF holds, so a copy of it is useless.
export default function PfDpopSection({ ready, result, checked = true, lead = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bound = result?.dpopThumbprint ? result : null;

  async function start() {
    if (busy) return;
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
    <FlowSection
      anchor="dpop"
      id="pf-ai-dpop-title"
      kicker="Sender-constrained tokens"
      title="DPoP"
      lede="PingFederate binds the access token to a key only the BFF holds. A stolen copy fails without that key."
    >
      <Card>
        <div className="pu-status-line"><FeatureStatus ready={ready} checked={checked} /></div>
        <KvList
          items={[
            { label: "Standard", value: "RFC 9449" },
            { label: "Client", value: "ai-demo-pf-rar-dpop (DPoP required)" },
            { label: "Proof", value: "A signed JWT per request, carrying the public key" },
          ]}
        />
        {ready
          ? (
            <div className="pu-actions">
              <button className={actionClass(lead)} type="button" onClick={start} aria-disabled={busy ? "true" : undefined}>
                Sign in and get a DPoP-bound token
              </button>
            </div>
          )
          : <Unavailable checked={checked}>Enable the PF DPoP client to run this</Unavailable>}
        <RunStatus tone="info" word={busy ? "Opening" : ""}>Opening PingFederate to sign in.</RunStatus>
        {error && <p className="pfai-error" role="alert">DPoP sign-in did not start. Reason: <code>{error}</code></p>}
      </Card>
      {bound && (
        <Card tone="ok" title="Token bound to this app's key" data-testid="dpop-result">
          <div className="pu-status-line"><StatusChip tone="ok">Bound</StatusChip></div>
          <KvList
            items={[
              { label: "Token type", value: bound.tokenType },
              { label: "Key thumbprint (cnf.jkt)", value: <code>{bound.dpopThumbprint}</code> },
            ]}
          />
          <p className="pu-note">The full request trace is in the rich authorization request section above.</p>
        </Card>
      )}
    </FlowSection>
  );
}
