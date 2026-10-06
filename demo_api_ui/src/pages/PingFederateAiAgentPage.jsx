import { useEffect, useMemo, useState } from "react";
import DraggableModal from "../components/DraggableModal";
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

const PROVIDER_COMPARISONS = [
  {
    capability: "AI identity and lifecycle",
    pingOne: (
      <>
        Agent IAM Core manages first-class agent identities, owners, credentials, lifecycle, and resource access. This is the P1 identity baseline. See{" "}
        <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html" target="_blank" rel="noreferrer">PingOne AI Agents</a>.
      </>
    ),
    pingFederate: (
      <>
        This page identifies its OAuth client through CIMD. The BFF publishes the metadata document and PF retrieves it during authorization. It does not create an Agent IAM Core-managed identity or owner record.
      </>
    ),
  },
  {
    capability: "Delegation and downstream access",
    pingOne: (
      <>
        The P1 agent flow uses RFC 8693 delegation: a user subject and agent actor produce a scoped PingOne token. PingOne supports standard token exchange;{" "}
        <a href="https://docs.pingidentity.com/pingone/use_cases/p1_oauth_2_token_exchange.html" target="_blank" rel="noreferrer">see the product flow</a>.
      </>
    ),
    pingFederate: (
      <>
        The BFF sends the session token to PF for an ID-JAG, verifies its signature, issuer, audience, and scope, then redeems it at a third-party authorization server for that server&apos;s access token. Both hops stay server-side.
      </>
    ),
  },
  {
    capability: "PAR and transaction intent (RAR)",
    pingOne: (
      <>
        Agent IAM Core identities can require PAR. The separate P1 Intent Binding demo pushes RAR details with PAR; its Gateway checks the intent and PingOne Authorize supplies the live policy decision.{" "}
        <a href="/intent-binding-learning">Open that P1 flow</a>.
      </>
    ),
    pingFederate: (
      <>
        This path pushes <code>banking_transaction</code> details through PF PAR. The custom processor checks the user, requested action and scope, mapped accounts, currency, and transaction limit.
      </>
    ),
  },
  {
    capability: "Human approval and agent audit",
    pingOne: (
      <>
        Agent IAM Core supports CIBA for human approval and records AI agent identity changes and activity for audit. See{" "}
        <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html" target="_blank" rel="noreferrer">AI Agent capabilities</a> and{" "}
        <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agent_logging.html" target="_blank" rel="noreferrer">AI agent auditing</a>.
      </>
    ),
    pingFederate: (
      <>
        PF supports CIBA as a general OAuth flow, but this page does not connect CIBA to an AI-agent identity or approval step. See{" "}
        <a href="https://docs.pingidentity.com/pingfederate/13.0/introduction_to_pingfederate/pf_ciba_by_ping.html" target="_blank" rel="noreferrer">PF CIBA</a>.
      </>
    ),
  },
];

function ProviderComparison() {
  return (
    <section className="pf-ai-agent__comparison" aria-labelledby="pf-ai-agent-comparison-title">
      <div className="pf-ai-agent__comparison-heading">
        <div>
          <p className="pf-ai-agent__eyebrow">Provider comparison</p>
          <h2 id="pf-ai-agent-comparison-title">Product and implementation differences</h2>
        </div>
        <p>
          PingOne Agent IAM Core is our P1 identity and delegation baseline. The P1 Intent Binding route is a separate demo; this page adds a separate PF path.
        </p>
      </div>

      <div className="pf-ai-agent__comparison-grid" role="table" aria-label="Configured PingOne and PingFederate AI flow comparison">
        <div className="pf-ai-agent__comparison-header" role="rowgroup">
          <div role="row">
            <span role="columnheader">Capability</span>
            <span role="columnheader">PingOne / Agent IAM Core</span>
            <span role="columnheader">PingFederate / this page</span>
          </div>
        </div>
        <div role="rowgroup">
          {PROVIDER_COMPARISONS.map((row) => (
            <article className="pf-ai-agent__comparison-row" role="row" key={row.capability}>
              <h3 role="rowheader">{row.capability}</h3>
              <div className="pf-ai-agent__comparison-cell" role="cell">
                <span className="pf-ai-agent__comparison-label">PingOne / Agent IAM Core</span>
                <p>{row.pingOne}</p>
              </div>
              <div className="pf-ai-agent__comparison-cell pf-ai-agent__comparison-cell--pf" role="cell">
                <span className="pf-ai-agent__comparison-label">PingFederate / this page</span>
                <p>{row.pingFederate}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="pf-ai-agent__shared-note">
        <strong>PAR and standard RFC 8693 token exchange are supported by PingOne too.</strong>{" "}
        They are not PF-only product features. The implementation difference here is that PF issues an ID-JAG and a separate authorization server redeems it; PingOne&apos;s Agent IAM Core lane exchanges at PingOne. CIMD and the custom PF RAR processor are also part of this PF page.
        <span>
          <a href="https://docs.pingidentity.com/pingone/applications/p1_pushed_authorization_request.html" target="_blank" rel="noreferrer">PingOne PAR docs</a>
          <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_managing_ai_agents.html" target="_blank" rel="noreferrer">PingOne AI identity configuration</a>
          <a href="https://docs.pingidentity.com/pingfederate/13.1/release_notes/pf_release_notes_131.html" target="_blank" rel="noreferrer">PF 13.1 AI-related OAuth features</a>
          <a href="https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_config_oauth_rar.html" target="_blank" rel="noreferrer">PF RAR processor setup</a>
        </span>
      </aside>
    </section>
  );
}

const EXCHANGE_HINTS = {
  PF_AI_SUBJECT_ISSUER_NOT_RECOGNIZED: "PingFederate does not trust this session's token. Sign in through PingFederate, not PingOne, and run the exchange again.",
};

const CIBA_ERRORS = {
  PF_AI_CIBA_USER_UNKNOWN: "PingFederate does not know that user.",
  PF_AI_FLOW_ALREADY_PENDING: "An approval request is already pending.",
  PF_AI_CIBA_BINDING_MESSAGE_INVALID: "The message may only use letters, digits and . _ + / ! ? # -, up to 20 characters, with no spaces.",
  PF_AI_CIBA_USER_REQUIRED: "Enter the user to ask.",
  PF_AI_CIBA_UNREACHABLE: "PingFederate could not be reached.",
  PF_AI_CIBA_P1_EMAIL_REQUIRED: "PingOne CIBA needs the signed-in user's email address, and this session has none.",
  PF_AI_CIBA_P1_NOT_CONFIGURED: "PingOne CIBA is not enabled on this stack.",
};

// Which authorization server answered: the BFF picks it from the signed-in provider.
const cibaServerName = (state) => (state?.provider === "pingone" ? "PingOne" : "PingFederate");

function cibaOutcome(state) {
  switch (state?.state) {
    case "approved": return `Approved by ${state.subject || state.loginHint} through ${cibaServerName(state)} CIBA.`;
    case "denied": return "The user denied the request.";
    case "expired": return "The request expired before anyone answered it.";
    case "error": return "The approval request failed.";
    default: return null;
  }
}

export default function PingFederateAiAgentPage({ user }) {
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [exchangeResult, setExchangeResult] = useState(null);
  // Only what the user typed. `user` is null until the session check resolves, so a
  // useState initialiser would freeze the empty value and hide the RAR buttons.
  const [typedUserKey, setTypedUserKey] = useState(null);
  const rarUserKey = typedUserKey ?? user?.username ?? "";
  const [bindDpop, setBindDpop] = useState(false);
  const [exchangeError, setExchangeError] = useState(false);
  // CIBA: ask a named user to approve on their device, then poll through the BFF.
  const [typedCibaUser, setTypedCibaUser] = useState(null);
  const cibaUser = typedCibaUser ?? user?.username ?? "";
  const [cibaMessage, setCibaMessage] = useState("");
  const [cibaState, setCibaState] = useState(null);
  const [cibaBusy, setCibaBusy] = useState(false);
  const [cibaError, setCibaError] = useState("");
  const [phoneClosed, setPhoneClosed] = useState(false);
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

  // A PingOne session uses PingOne CIBA (the BFF checks it is on), so the button shows for it regardless of the PF flags.
  const cibaEnabled = Boolean(status?.features?.ciba || status?.features?.cibaMock || status?.sessionProvider === "pingone");
  // Pick up an approval already in flight (a reload) or the last answer for this session.
  useEffect(() => {
    if (!cibaEnabled) return undefined;
    let current = true;
    apiClient.get("/api/pf-ai-agent/ciba/status")
      .then((response) => {
        if (current && response.data?.state && response.data.state !== "none") setCibaState(response.data);
      })
      .catch(() => {});
    return () => { current = false; };
  }, [cibaEnabled]);

  // While an approval is pending, ask again after PingFederate's interval. Every answer is a new
  // object, so this re-arms itself until the state stops being pending.
  const cibaPending = cibaState?.state === "pending";
  const cibaInterval = cibaState?.interval || 5;
  useEffect(() => {
    if (!cibaPending) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      apiClient.get("/api/pf-ai-agent/ciba/status")
        .then((response) => { if (current) setCibaState(response.data); })
        .catch(() => { if (current) setCibaState({ state: "error" }); });
    }, cibaInterval * 1000);
    return () => { current = false; clearTimeout(timer); };
  }, [cibaPending, cibaInterval, cibaState]);

  const provider = status?.sessionProvider || "none";
  const supportedSession = provider === "pingone" || provider === "pingfederate";
  // Signing in at PingFederate through the CIMD card does not change the app's own session, but it leaves a
  // PingFederate token with the BFF, and the exchange uses that: PingFederate trusts only tokens it issued.
  const pfSignedIn = Boolean(status?.pfSignedIn);
  const exchangeProvider = pfSignedIn && provider !== "pingfederate" ? "pingfederate" : provider;
  const canExchange = (supportedSession || pfSignedIn) && Boolean(status?.features?.crossDomain) && !exchangeBusy;
  const features = status?.features || { cimd: false, crossDomain: false, rar: false, rarDpop: false, ciba: false, cibaMock: false, cibaWebApprover: false };
  const rarResult = status?.rarResult || null;
  const rarUserKeyValue = rarUserKey.trim();
  const callbackResult = queryStatus.get("cimd") || queryStatus.get("rar");

  async function askForApproval() {
    if (!cibaEnabled || cibaBusy || cibaPending || !cibaUser.trim()) return;
    setCibaBusy(true);
    setCibaError("");
    setCibaState(null);
    setPhoneClosed(false);
    try {
      const response = await apiClient.post("/api/pf-ai-agent/ciba/start", {
        loginHint: cibaUser.trim(),
        bindingMessage: cibaMessage.trim() || undefined,
      });
      setCibaState(response.data);
    } catch (error) {
      const code = error?.response?.data?.error;
      setCibaError(CIBA_ERRORS[code] || `Could not start the approval request.${code ? ` Reason: ${code}` : ""}`);
    } finally {
      setCibaBusy(false);
    }
  }

  // The mock phone pops up while a request is pending: PF_AI_CIBA_MOCK_ENABLED answers in the BFF, the web
  // approver answers the stand-in PingFederate authenticator. Either way it stands in for the user's device.
  const phoneChannel = features.cibaWebApprover ? "web" : features.cibaMock ? "mock" : null;
  // PingOne CIBA is answered on the user's real device, so the mock phone only serves PingFederate requests.
  const phoneOpen = cibaPending && Boolean(phoneChannel) && !phoneClosed && cibaState?.provider !== "pingone";
  const answerOnPhone = (decision) => (phoneChannel === "web" ? decideOnWebApprover(decision) : decideOnMockPhone(decision));
  const phoneLabel = (decision) => (phoneChannel === "web"
    ? `${decision === "approve" ? "Approve" : "Deny"} (web approver)`
    : `${decision === "approve" ? "Approve" : "Deny"} on mock phone`);

  // Mock phone: stands in for the user's device when PF_AI_CIBA_MOCK_ENABLED is on.
  async function decideOnMockPhone(decision) {
    try {
      const response = await apiClient.post("/api/pf-ai-agent/ciba/mock-decision", { decision });
      setCibaState(response.data);
    } catch {
      setCibaError("The mock phone could not answer.");
    }
  }

  // Web approver: the PingFederate stand-in authenticator is waiting for a person; the next poll sees the answer.
  async function decideOnWebApprover(decision) {
    try {
      await apiClient.post("/api/pf-ai-agent/ciba/web-approver/decision", { decision });
    } catch {
      setCibaError("PingFederate has not asked for approval yet. Try again in a moment.");
    }
  }

  async function runCrossDomainExchange() {
    if (!canExchange) return;
    setExchangeBusy(true);
    setExchangeError(false);
    setExchangeResult(null);
    try {
      const response = await apiClient.post("/api/pf-ai-agent/cross-domain/exchange", {
        subjectProvider: exchangeProvider,
      });
      setExchangeResult(response.data);
      notifySuccess("Third-party token exchange completed.");
    } catch (error) {
      // The BFF names the cause (for example PF_AI_ID_JAG_AUDIENCE_INVALID); keep it so the failure is diagnosable.
      setExchangeError(error?.response?.data?.error || true);
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
            ? callbackResult === "success"
              ? "CIMD authorization completed. You are signed in at PingFederate; the token stays with the BFF and the third-party exchange below now uses it."
              : "CIMD authorization did not complete."
            : callbackResult === "success" ? "PF accepted the RAR request." : callbackResult === "denied" ? "PF denied the RAR request." : "RAR authorization did not complete."}
        </div>
      )}
      {queryStatus.get("rar") === "success" && rarResult?.tokenType && (
        <p className="pf-ai-agent__token-line" data-testid="rar-token-line">
          Access token type: <strong>{rarResult.tokenType}</strong>
          {rarResult.dpopThumbprint
            ? <> · bound to this app&apos;s key, thumbprint <code>{rarResult.dpopThumbprint}</code></>
            : " · not bound to a key (a bearer token works for whoever holds it)"}
        </p>
      )}

      <section className="pf-ai-agent__overview" aria-label="PF feature readiness">
        <div><span>Client metadata</span><FeatureStatus ready={features.cimd} /></div>
        <div><span>Third-party exchange</span><FeatureStatus ready={features.crossDomain} /></div>
        <div><span>Rich authorization</span><FeatureStatus ready={features.rar} /></div>
        <div><span>Human approval (CIBA)</span><FeatureStatus ready={features.ciba} /></div>
        {status?.nativeIdJagPath && (
          <a href={status.nativeIdJagPath}>Open the existing PF ID-JAG demo</a>
        )}
      </section>

      <ProviderComparison />

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
              <div>
                <strong>{pfSignedIn && provider !== "pingfederate" ? "PingFederate sign-in (CIMD)" : `${statusLabel(provider)} session`}</strong>
                <span>subject access token · BFF held</span>
              </div>
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
            disabled={!canExchange}
          >
            {exchangeBusy ? "Exchanging tokens" : "Run third-party token exchange"}
          </button>
          {!pfSignedIn && provider !== "pingfederate" && (
            <p className="pf-ai-agent__hint" data-testid="exchange-needs-pf">
              PingFederate only accepts tokens it issued. Sign in at PingFederate with the CIMD card above first,
              then run this; until then a PingOne session is refused.
            </p>
          )}
          {pfSignedIn && provider !== "pingfederate" && (
            <p className="pf-ai-agent__hint">Using your PingFederate sign-in from the CIMD card; your PingOne session is not sent.</p>
          )}
          {exchangeError && (
            <p className="pf-ai-agent__error" role="alert">
              The exchange failed. Review the PF and downstream authorization server settings.
              {typeof exchangeError === "string" && <> Reason: <code>{exchangeError}</code></>}
              {EXCHANGE_HINTS[exchangeError] && <> {EXCHANGE_HINTS[exchangeError]}</>}
            </p>
          )}
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
              onChange={(event) => setTypedUserKey(event.target.value)}
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
          {features.rarDpop && (
            <label className="pf-ai-agent__dpop-option">
              <input type="checkbox" checked={bindDpop} onChange={(event) => setBindDpop(event.target.checked)} />
              Bind the access token to this app&apos;s key with DPoP
            </label>
          )}
          <div className="pf-ai-agent__rar-actions">
            {features.rar && supportedSession && rarUserKeyValue
              ? <>
                <form method="post" action="/api/pf-ai-agent/rar/start">
                  <input type="hidden" name="scenario" value="allowed" />
                  <input type="hidden" name="userKey" value={rarUserKeyValue} />
                  {features.rarDpop && bindDpop && <input type="hidden" name="dpop" value="1" />}
                  <button className="pf-ai-agent__action" type="submit">Run allowed RAR request</button>
                </form>
                <form method="post" action="/api/pf-ai-agent/rar/start">
                  <input type="hidden" name="scenario" value="denied" />
                  <input type="hidden" name="userKey" value={rarUserKeyValue} />
                  {features.rarDpop && bindDpop && <input type="hidden" name="dpop" value="1" />}
                  <button className="pf-ai-agent__secondary-action" type="submit">Run out-of-policy RAR request</button>
                </form>
              </>
              : <span className="pf-ai-agent__disabled-action">Configure RAR and sign in to start the request</span>}
          </div>
        </div>
      </section>

      <section className="pf-ai-agent__flow pf-ai-agent__flow--ciba" aria-labelledby="pf-ai-ciba-title">
        <div className="pf-ai-agent__flow-title">
          <p className="pf-ai-agent__eyebrow">Human approval</p>
          <h2 id="pf-ai-ciba-title">Ask a person to approve (CIBA)</h2>
          <p>PingFederate asks the named user&apos;s PingOne MFA device to approve this request, and this page waits for the answer. The user needs an enrolled MFA device.</p>
          <FeatureStatus ready={features.ciba} />
        </div>
        <div className="pf-ai-agent__flow-body">
          <label className="pf-ai-agent__user-key">
            User to ask (PingOne username)
            <input
              value={cibaUser}
              onChange={(event) => setTypedCibaUser(event.target.value)}
              autoComplete="off"
              maxLength={256}
            />
          </label>
          <label className="pf-ai-agent__user-key">
            Message shown on their device (optional)
            <input
              value={cibaMessage}
              onChange={(event) => setCibaMessage(event.target.value)}
              autoComplete="off"
              maxLength={20}
            />
          </label>
          <div className="pf-ai-agent__rar-actions">
            {cibaEnabled && supportedSession
              ? <button
                className="pf-ai-agent__action"
                type="button"
                onClick={askForApproval}
                disabled={cibaBusy || cibaPending || !cibaUser.trim()}
              >
                {cibaBusy ? "Sending…" : "Ask for approval"}
              </button>
              : <span className="pf-ai-agent__disabled-action">Configure CIBA and sign in to ask for approval</span>}
          </div>
          {cibaError && <p className="pf-ai-agent__callback is-error" role="alert">{cibaError}</p>}
          {cibaPending && (
            <p className="pf-ai-agent__callback" role="status" data-testid="ciba-pending">
              Waiting for {cibaState.loginHint} to approve on their device ({cibaServerName(cibaState)} CIBA). Expires {new Date(cibaState.expiresAt).toLocaleTimeString()}.
            </p>
          )}
          {cibaPending && phoneChannel && phoneClosed && cibaState?.provider !== "pingone" && (
            <button className="pf-ai-agent__secondary-action" type="button" onClick={() => setPhoneClosed(false)}>Open mock phone</button>
          )}
          {cibaOutcome(cibaState) && (
            <p
              className={`pf-ai-agent__callback ${cibaState.state === "approved" || cibaState.state === "denied" ? "is-complete" : "is-error"}`}
              role="status"
              data-testid="ciba-outcome"
            >
              {cibaOutcome(cibaState)}
            </p>
          )}
        </div>
      </section>

      <DraggableModal
        isOpen={phoneOpen}
        onClose={() => setPhoneClosed(true)}
        title="Mock phone"
        defaultWidth={360}
        defaultHeight={640}
        storageKey="pf-ai-agent-mock-phone"
      >
        {/* dm-scroll: `dm-body` is bare by contract — no padding, no scroll. */}
        <div className="dm-scroll pf-ai-agent__phone-wrap" data-testid={phoneChannel === "web" ? "ciba-web-approver" : "ciba-mock-phone"}>
          <div className="pf-ai-agent__phone">
            <div className="pf-ai-agent__phone-screen">
              <div className="pf-ai-agent__phone-island" aria-hidden="true" />
              <div className="pf-ai-agent__phone-clock" aria-hidden="true">
                <span className="pf-ai-agent__phone-date">Lock screen</span>
                <span className="pf-ai-agent__phone-time">9:41</span>
              </div>
              <div className="pf-ai-agent__phone-card">
                <p className="pf-ai-agent__phone-app">
                  <span className="pf-ai-agent__phone-icon" aria-hidden="true">P</span>
                  PingOne MFA (mock)
                  <span className="pf-ai-agent__phone-now">now</span>
                </p>
                <h3>Approve this request?</h3>
                <p>An AI agent is asking {cibaState?.loginHint} to approve it.</p>
                {cibaState?.bindingMessage && <p className="pf-ai-agent__phone-message">{cibaState.bindingMessage}</p>}
              </div>
              <div className="pf-ai-agent__phone-actions">
                <button className="pf-ai-agent__action" type="button" onClick={() => answerOnPhone("approve")}>{phoneLabel("approve")}</button>
                <button className="pf-ai-agent__secondary-action" type="button" onClick={() => answerOnPhone("deny")}>{phoneLabel("deny")}</button>
              </div>
              <div className="pf-ai-agent__phone-home" aria-hidden="true" />
            </div>
          </div>
        </div>
      </DraggableModal>

      <footer className="pf-ai-agent__note">
        <strong>OAuth and JWT only.</strong> Browser responses contain status and safe provenance. Access tokens, ID-JAGs, codes, and PKCE verifiers remain in the BFF or PingFederate.
      </footer>
    </main>
  );
}
