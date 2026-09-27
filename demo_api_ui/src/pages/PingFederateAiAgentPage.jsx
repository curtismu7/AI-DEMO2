import { useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./PingFederateAiAgentPage.css";

function FeatureStatus({ ready }) {
  return (
    <span className={`pf-ai-agent__status ${ready ? "is-ready" : "is-off"}`}>
      <span aria-hidden="true" />{ready ? "Ready" : "Not configured"}
    </span>
  );
}

function statusLabel(provider) {
  if (provider === "pingone") return "PingOne";
  if (provider === "pingfederate") return "PingFederate";
  return "No signed-in session";
}

export default function PingFederateAiAgentPage({ user }) {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [exchangeResult, setExchangeResult] = useState(null);
  const [rarUserKey, setRarUserKey] = useState(user?.username || "");
  const [exchangeError, setExchangeError] = useState(false);
  const queryStatus = useMemo(() => new URLSearchParams(window.location.search), []);

  useEffect(() => {
    let current = true;
    apiClient.get("/api/pf-ai-agent/status")
      .then((response) => {
        if (current) setStatus(response.data);
      })
      .catch(() => {
        if (current) {
          setStatus(null);
          notifyError("Could not load PingFederate AI Agent status.");
        }
      })
      .finally(() => {
        if (current) setLoadingStatus(false);
      });
    return () => { current = false; };
  }, []);

  const provider = status?.sessionProvider || "none";
  const supportedSession = provider === "pingone" || provider === "pingfederate";
  const features = status?.features || { cimd: false, crossDomain: false, rar: false };
  const rarUserKeyValue = rarUserKey.trim();
  const callbackResult = queryStatus.get("cimd") || queryStatus.get("rar");

  async function runCrossDomainExchange() {
    if (!supportedSession || !features.crossDomain || exchangeBusy) return;
    setExchangeBusy(true);
    setExchangeError(false);
    setExchangeResult(null);
    try {
      const response = await apiClient.post("/api/pf-ai-agent/cross-domain/exchange", {
        subjectProvider: provider,
      });
      setExchangeResult(response.data);
      notifySuccess("Third-party token exchange completed.");
    } catch {
      setExchangeError(true);
      notifyError("Third-party token exchange failed. Check the PF and downstream setup.");
    } finally {
      setExchangeBusy(false);
    }
  }

  return (
    <main className="pf-ai-agent" data-testid="pingfederate-ai-agent-page">
      <header className="pf-ai-agent__hero">
        <div className="pf-ai-agent__hero-copy">
          <p className="pf-ai-agent__eyebrow">PingFederate · AI agent authorization</p>
          <h1>PingFederate AI Agent</h1>
          <p className="pf-ai-agent__lede">
            Exercise PF client metadata, third-party token exchange, and rich authorization requests.
            Each request stays on the PingFederate path.
          </p>
        </div>
        <aside className="pf-ai-agent__session" aria-live="polite">
          <span>Current session</span>
          <strong>{loadingStatus ? "Checking session" : statusLabel(provider)}</strong>
          <p>{supportedSession
            ? "The exchange uses this session's access token as its subject."
            : "Sign in to the app to use a session token as the exchange subject."}</p>
        </aside>
      </header>

      {callbackResult && (
        <div className={`pf-ai-agent__callback ${callbackResult === "success" || callbackResult === "denied" ? "is-complete" : "is-error"}`} role="status">
          {queryStatus.get("cimd")
            ? callbackResult === "success" ? "CIMD authorization completed." : "CIMD authorization did not complete."
            : callbackResult === "success" ? "PF accepted the RAR request." : callbackResult === "denied" ? "PF denied the RAR request." : "RAR authorization did not complete."}
        </div>
      )}

      <section className="pf-ai-agent__overview" aria-label="PF feature readiness">
        <div><span>Client metadata</span><FeatureStatus ready={features.cimd} /></div>
        <div><span>Third-party exchange</span><FeatureStatus ready={features.crossDomain} /></div>
        <div><span>Rich authorization</span><FeatureStatus ready={features.rar} /></div>
        {status?.nativeIdJagPath && (
          <a href={status.nativeIdJagPath}>Open the existing PF ID-JAG demo</a>
        )}
      </section>

      <section className="pf-ai-agent__flow pf-ai-agent__flow--cimd" aria-labelledby="pf-ai-cimd-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">Client identity</p>
          <h2 id="pf-ai-cimd-title">CIMD</h2>
          <p>PingFederate fetches the client metadata document from this demo and uses it to resolve the public PKCE client.</p>
          <FeatureStatus ready={features.cimd} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <dl className="pf-ai-agent__facts">
            <div><dt>Client ID</dt><dd>Metadata document URL</dd></div>
            <div><dt>Client authentication</dt><dd>None · PKCE S256</dd></div>
            <div><dt>Token custody</dt><dd>BFF session only</dd></div>
          </dl>
          {features.cimd
            ? <a className="pf-ai-agent__action" href="/api/pf-ai-agent/cimd/start">Start CIMD authorization</a>
            : <span className="pf-ai-agent__disabled-action">Enable PF CIMD to start authorization</span>}
        </div>
      </section>

      <section className="pf-ai-agent__flow pf-ai-agent__flow--exchange" aria-labelledby="pf-ai-exchange-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">Two explicit token hops</p>
          <h2 id="pf-ai-exchange-title">Third-party token exchange</h2>
          <p>PF issues the ID-JAG. The downstream authorization server redeems it for its own access token.</p>
          <FeatureStatus ready={features.crossDomain} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <div className="pf-ai-agent__hops" aria-label="Token exchange hops">
            <div className="pf-ai-agent__hop">
              <span className="pf-ai-agent__hop-index">1</span>
              <div><strong>{statusLabel(provider)} session</strong><span>subject access token · BFF held</span></div>
              <span className="pf-ai-agent__hop-arrow" aria-hidden="true">›</span>
              <div><strong>PingFederate</strong><span>issues an audience-bound ID-JAG</span></div>
            </div>
            <div className="pf-ai-agent__hop">
              <span className="pf-ai-agent__hop-index">2</span>
              <div><strong>PingFederate ID-JAG</strong><span>JWT bearer assertion · BFF held</span></div>
              <span className="pf-ai-agent__hop-arrow" aria-hidden="true">›</span>
              <div><strong>Third-party AS</strong><span>issues its own access token</span></div>
            </div>
          </div>
          <button
            className="pf-ai-agent__action"
            type="button"
            onClick={runCrossDomainExchange}
            disabled={!supportedSession || !features.crossDomain || exchangeBusy}
          >
            {exchangeBusy ? "Exchanging tokens" : "Run third-party token exchange"}
          </button>
          {exchangeError && <p className="pf-ai-agent__error" role="alert">The exchange failed. Review the PF and downstream authorization server settings.</p>}
          {exchangeResult && (
            <div className="pf-ai-agent__result" role="status" aria-label="Sanitized exchange result">
              <h3>Exchange completed</h3>
              <dl>
                <div><dt>Subject</dt><dd>{exchangeResult.subject || "Not returned"}</dd></div>
                <div><dt>PF issuer</dt><dd>{exchangeResult.pfIssuer}</dd></div>
                <div><dt>ID-JAG audience</dt><dd>{exchangeResult.assertionAudience}</dd></div>
                <div><dt>Downstream resource</dt><dd>{exchangeResult.downstreamAudience}</dd></div>
                <div><dt>Granted scope</dt><dd>{Array.isArray(exchangeResult.scope) ? exchangeResult.scope.join(" ") : "Not returned"}</dd></div>
                <div><dt>Expires</dt><dd>{exchangeResult.expiresAt || "Not returned"}</dd></div>
              </dl>
              {exchangeResult.hops?.length > 0 && (
                <ol>{exchangeResult.hops.map((hop) => <li key={hop.step}>{hop.step}: {hop.issuer} · {hop.tokenType}</li>)}</ol>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="pf-ai-agent__flow pf-ai-agent__flow--rar" aria-labelledby="pf-ai-rar-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">Fine-grained consent</p>
          <h2 id="pf-ai-rar-title">Rich authorization request</h2>
          <p>PF receives the authorization detail through PAR and applies the custom transaction policy.</p>
          <FeatureStatus ready={features.rar} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <label className="pf-ai-agent__user-key">
            PF user key for this request
            <input
              value={rarUserKey}
              onChange={(event) => setRarUserKey(event.target.value)}
              autoComplete="off"
              maxLength={256}
            />
          </label>
          <pre className="pf-ai-agent__detail-preview">{JSON.stringify({
            type: "banking_transaction",
            actions: ["transfer"],
            source_account: "checking-100",
            destination_account: "savings-200",
            amount: 125,
            currency: "USD",
          }, null, 2)}</pre>
          <div className="pf-ai-agent__rar-actions">
            {features.rar && supportedSession && rarUserKeyValue
              ? <>
                <form method="post" action="/api/pf-ai-agent/rar/start">
                  <input type="hidden" name="scenario" value="allowed" />
                  <input type="hidden" name="userKey" value={rarUserKeyValue} />
                  <button className="pf-ai-agent__action" type="submit">Run allowed RAR request</button>
                </form>
                <form method="post" action="/api/pf-ai-agent/rar/start">
                  <input type="hidden" name="scenario" value="denied" />
                  <input type="hidden" name="userKey" value={rarUserKeyValue} />
                  <button className="pf-ai-agent__secondary-action" type="submit">Run out-of-policy RAR request</button>
                </form>
              </>
              : <span className="pf-ai-agent__disabled-action">Configure RAR and sign in to start the request</span>}
          </div>
        </div>
      </section>

      <footer className="pf-ai-agent__note">
        <strong>OAuth and JWT only.</strong> Browser responses contain status and safe provenance. Access tokens, ID-JAGs, codes, and PKCE verifiers remain in the BFF or PingFederate.
      </footer>
    </main>
  );
}
