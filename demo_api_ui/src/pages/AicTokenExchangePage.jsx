import { useEffect, useMemo, useState } from "react";
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { AIC_EXCHANGE_GROUPS, AIC_EXCHANGE_NODES, AIC_EXCHANGE_EDGES, AIC_EXCHANGE_STEPS } from "../config/aicTokenExchangeDiagram";
import ProtocolTrace from "../components/ProtocolTrace";
import apiClient from "../services/apiClient";
import { notifyError, notifySuccess } from "../utils/appToast";
// Same layout as the PingFederate AI Agent page, so it shares that stylesheet.
import "./PingFederateAiAgentPage.css";

function FeatureStatus({ ready }) {
  return (
    <span className={`pf-ai-agent__status ${ready ? "is-ready" : "is-off"}`}>
      <span aria-hidden="true" />{ready ? "Ready" : "Not configured"}
    </span>
  );
}

const USER_EXPLAIN = {
  authorize: "A second sign-in, beside your app session: AIC only exchanges tokens it issued itself, and the app's normal login yields PingOne tokens.",
  callback: "AIC returns a one-time code to the BFF. The browser never sees a token.",
  token: "The BFF redeems the code with the PKCE verifier. This access token is the subject token of the exchange.",
  "introspect-user": "AIC access tokens are opaque by default, so the BFF asks AIC what this one carries.",
};

const EXCHANGE_EXPLAIN = {
  exchange: "The agent presents both tokens and authenticates as itself. AIC checks the user token's may_act claim before it issues anything.",
  "introspect-exchanged": "The delegated token belongs to the agent's client, so the agent can introspect it. The act claim names who is acting for the user.",
};

const ACTOR_EXPLAIN = {
  "actor-token": "The agent authenticates as itself. This access token is the actor token of the exchange.",
  "introspect-actor": "The agent introspects its own token to show its claims.",
};

/**
 * AIC token exchange — an RFC 8693 delegation exchange at PingOne Advanced
 * Identity Cloud. The user token comes from a direct AIC sign-in, the actor token
 * from client credentials, and the exchange turns the pair into a delegated token.
 * All three stay in the BFF session; this page shows the redacted trace the BFF recorded.
 */
export default function AicTokenExchangePage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const outcome = useMemo(() => new URLSearchParams(window.location.search).get("aic"), []);

  useEffect(() => {
    let current = true;
    apiClient.get("/api/aic-demo/status")
      .then((response) => { if (current) setStatus(response.data); })
      .catch(() => { if (current) notifyError("Could not load the AIC token exchange status."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (outcome === "success") {
      notifySuccess("Signed in at AIC — the user token is held by the BFF.");
      // Drop the param so a refresh does not replay the toast.
      const url = new URL(window.location.href);
      url.searchParams.delete("aic");
      window.history.replaceState(null, "", url);
    }
  }, [outcome]);

  async function getActorToken() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await apiClient.post("/api/aic-demo/actor-token");
      // A new actor token invalidates any earlier exchange (the BFF discarded it too).
      setStatus((previous) => ({ ...previous, actorReady: true, actorResult: response.data.actorResult, exchangeResult: null }));
      notifySuccess("Actor token issued by AIC.");
    } catch (error) {
      notifyError(error?.response?.data?.message || "AIC did not issue an actor token.");
    } finally {
      setBusy(false);
    }
  }

  async function exchange() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await apiClient.post("/api/aic-demo/exchange");
      setStatus((previous) => ({ ...previous, exchangeResult: response.data.exchangeResult }));
      notifySuccess("AIC issued the delegated token.");
    } catch (error) {
      notifyError(error?.response?.data?.message || "AIC refused the token exchange.");
    } finally {
      setBusy(false);
    }
  }

  const features = status?.features || {};
  const userResult = status?.userResult;
  const actorResult = status?.actorResult;
  const exchangeResult = status?.exchangeResult;
  const canExchange = Boolean(status?.userSignedIn && status?.actorReady);

  return (
    <main className="pf-ai-agent" data-testid="aic-token-exchange-page">
      <header>
        <p className="pf-ai-agent__eyebrow">PingOne Advanced Identity Cloud</p>
        <h1>AIC token exchange</h1>
        <p className="pf-ai-agent__lede">
          A delegation exchange needs a token for the person and a token for the agent acting for them, both issued by AIC.
          Get each one, then exchange the pair for a narrower token that records who is acting. The BFF keeps every token
          and shows what went over the wire with every secret replaced.
        </p>
      </header>

      <EmbeddedFlowDiagram
        testId="aic-diagram"
        pingStyle
        title="How the AIC delegation exchange works"
        lede="Three calls to AIC, all brokered by the BFF: the user token, the agent token, then the RFC 8693 exchange of the pair."
        config={{ GROUPS: AIC_EXCHANGE_GROUPS, NODES: AIC_EXCHANGE_NODES, EDGES: AIC_EXCHANGE_EDGES, STEPS: AIC_EXCHANGE_STEPS }}
      />

      {!loading && outcome === "error" && (
        <p className="pf-ai-agent__disabled-action" role="alert" data-testid="aic-login-error">
          AIC sign-in did not complete{status?.lastError?.message ? `: ${status.lastError.message}` : "."}
        </p>
      )}

      <section className="pf-ai-agent__flow" aria-labelledby="aic-user-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">Subject token</p>
          <h2 id="aic-user-title">User token</h2>
          <p>The person signs in directly at AIC with authorization code and PKCE.</p>
          <FeatureStatus ready={Boolean(features.login)} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <dl className="pf-ai-agent__facts">
            <div><dt>Client</dt><dd>{status?.subjectClientId || "not set"} · public, PKCE S256</dd></div>
            <div><dt>Redirect URI to register in AIC</dt><dd>{status?.redirectUri || "—"}</dd></div>
            <div><dt>Held by the BFF</dt><dd>{status?.userSignedIn ? `Yes — ${userResult?.subject}` : "No"}</dd></div>
          </dl>
          {features.login
            ? <a className="pf-ai-agent__action" href="/api/aic-demo/login/start">{status?.userSignedIn ? "Sign in at AIC again" : "Sign in at AIC"}</a>
            : <span className="pf-ai-agent__disabled-action">Set AIC_ISSUER and AIC_SUBJECT_CLIENT_ID to sign in</span>}
          {userResult?.trace?.length > 0 && (
            <div className="pf-ai-agent__proof" data-testid="aic-user-proof">
              <h3>Proof: what was sent and what came back</h3>
              <ul className="pf-ai-agent__proof-points">
                <li>The ID token says {userResult.subject} signed in at {userResult.issuer}.</li>
                <li>Scopes on the user token: {userResult.scope || "none reported"}.</li>
                {userResult.opaque && <li>The access token is opaque, so its contents come from introspection, not from decoding it.</li>}
              </ul>
              <ProtocolTrace steps={userResult.trace} explain={USER_EXPLAIN} />
            </div>
          )}
        </div>
      </section>

      <section className="pf-ai-agent__flow" aria-labelledby="aic-actor-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">Actor token</p>
          <h2 id="aic-actor-title">Agent token</h2>
          <p>The agent gets its own token from AIC with client credentials.</p>
          <FeatureStatus ready={Boolean(features.actor)} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <dl className="pf-ai-agent__facts">
            <div><dt>Client</dt><dd>{status?.actorClientId || "not set"} · confidential</dd></div>
            <div><dt>Scope requested</dt><dd>{status?.delegatedScope || "client default"}</dd></div>
            <div><dt>Held by the BFF</dt><dd>{status?.actorReady ? "Yes" : "No"}</dd></div>
          </dl>
          {features.actor
            ? <button type="button" className="pf-ai-agent__action" onClick={getActorToken} disabled={busy}>{busy ? "Asking AIC…" : "Get actor token"}</button>
            : <span className="pf-ai-agent__disabled-action">Set AIC_ACTOR_CLIENT_ID and AIC_ACTOR_CLIENT_SECRET to get an actor token</span>}
          {actorResult?.trace?.length > 0 && (
            <div className="pf-ai-agent__proof" data-testid="aic-actor-proof">
              <h3>Proof: what was sent and what came back</h3>
              <ul className="pf-ai-agent__proof-points">
                <li>Issued to {actorResult.clientId} with scope: {actorResult.scope || "none reported"}.</li>
                {actorResult.opaque && <li>The access token is opaque, so its contents come from introspection, not from decoding it.</li>}
              </ul>
              <ProtocolTrace steps={actorResult.trace} explain={ACTOR_EXPLAIN} />
            </div>
          )}
        </div>
      </section>

      <section className="pf-ai-agent__flow" aria-labelledby="aic-exchange-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">RFC 8693 delegation</p>
          <h2 id="aic-exchange-title">Delegated token</h2>
          <p>The agent exchanges the user token and its own token for one that acts for the user.</p>
          <FeatureStatus ready={canExchange} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <dl className="pf-ai-agent__facts">
            <div><dt>Subject</dt><dd>{status?.userSignedIn ? userResult?.subject : "user token needed"}</dd></div>
            <div><dt>Actor</dt><dd>{status?.actorReady ? status?.actorClientId : "actor token needed"}</dd></div>
            <div><dt>Scope requested</dt><dd>{status?.delegatedScope || "none"}</dd></div>
          </dl>
          {canExchange
            ? <button type="button" className="pf-ai-agent__action" onClick={exchange} disabled={busy}>{busy ? "Asking AIC…" : "Exchange tokens"}</button>
            : <span className="pf-ai-agent__disabled-action">Get the user token and the actor token first</span>}
          {exchangeResult?.trace?.length > 0 && (
            <div className="pf-ai-agent__proof" data-testid="aic-exchange-proof">
              <h3>Proof: what was sent and what came back</h3>
              <ul className="pf-ai-agent__proof-points">
                <li>Delegated token for {exchangeResult.subject || "the user"}, with scope: {exchangeResult.scope || "none reported"}.</li>
                <li>
                  {exchangeResult.act
                    ? `Acting party (act claim): ${JSON.stringify(exchangeResult.act)}.`
                    : "AIC did not report an act claim for this token."}
                </li>
                {exchangeResult.opaque && <li>The token is opaque, so its contents come from introspection, not from decoding it.</li>}
              </ul>
              <ProtocolTrace steps={exchangeResult.trace} explain={EXCHANGE_EXPLAIN} />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
