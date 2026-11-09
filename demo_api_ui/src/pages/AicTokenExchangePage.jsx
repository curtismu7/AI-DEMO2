// /aic-token-exchange: an RFC 8693 delegation exchange at PingOne Advanced Identity Cloud (AIC).
//
// Honesty: nothing on this page is simulated. Every step makes a real request to the AIC tenant the BFF is
// configured for, and the traces are what the BFF recorded (secrets replaced). The one illustration is the
// animated diagram, which is a walkthrough, not live traffic. The banner, the chips and the cards say only what the
// BFF reported (/api/aic-demo/status): while that is loading or failed they say so instead of "not configured".
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
// P9 "one primary per view": the primary is the NEXT step of the flow, never more than one:
//   loading / status unavailable / nothing configured  none (there is nothing to act on)
//   no user token yet (sign-in configured)             "Sign in at AIC"
//   user token held, actor token missing              "Get actor token"
//   both held, no delegated token yet                  "Exchange tokens"
//   delegated token issued (flow complete)             none: every action is a secondary and can be repeated
// A step's button keeps its label while AIC is asked; it takes aria-disabled (not disabled) so keyboard focus stays
// on it, and the progress is announced in that step's status line (role="status", mounted before its text changes).
import { useEffect, useMemo, useState } from "react";
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { AIC_EXCHANGE_GROUPS, AIC_EXCHANGE_NODES, AIC_EXCHANGE_EDGES, AIC_EXCHANGE_STEPS } from "../config/aicTokenExchangeDiagram";
import ProtocolTrace from "../components/ProtocolTrace";
import PageHeader from "../components/common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList } from "../components/pingUi";
import apiClient from "../services/apiClient";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./AicTokenExchangePage.css";

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
 * Why a click on a step failed, naming the party that actually answered. The BFF only returns a message when it got as
 * far as AIC (or knew the step was off); a 401 means the app session ended before any request reached AIC.
 */
function failureMessage(error) {
  const response = error?.response;
  if (!response) return "The BFF did not answer, so it is not known whether AIC was asked.";
  if (response.status === 401) return "Your app session has ended, so nothing was sent to AIC. Sign in to the app again.";
  if (response.data?.message) return response.data.message;
  return `The BFF failed with HTTP ${response.status} and gave no reason.`;
}

/**
 * AIC token exchange: an RFC 8693 delegation exchange at PingOne Advanced
 * Identity Cloud. The user token comes from a direct AIC sign-in, the actor token
 * from client credentials, and the exchange turns the pair into a delegated token.
 * All three stay in the BFF session; this page shows the redacted trace the BFF recorded.
 */
export default function AicTokenExchangePage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the last click on each step did, so a result or a failure stays with its own step.
  const [runs, setRuns] = useState({});
  const outcome = useMemo(() => new URLSearchParams(window.location.search).get("aic"), []);

  useEffect(() => {
    let current = true;
    apiClient.get("/api/aic-demo/status")
      .then((response) => { if (current) setStatus(response.data); })
      .catch(() => {
        if (!current) return;
        setLoadFailed(true);
        notifyError("Could not load the AIC token exchange status.");
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (outcome === "success") {
      notifySuccess("Signed in at AIC \u2014 the user token is held by the BFF.");
      // Drop the param so a refresh does not replay the toast.
      const url = new URL(window.location.href);
      url.searchParams.delete("aic");
      window.history.replaceState(null, "", url);
    }
  }, [outcome]);

  // After a failed click, ask the BFF what it holds now. A failed actor request discards the earlier exchange there,
  // and the page must not keep showing it. Quiet: the cards stay mounted (no loading state) so focus is not dropped.
  async function resyncStatus() {
    try {
      const response = await apiClient.get("/api/aic-demo/status");
      setStatus(response.data);
    } catch {
      // Keep what is shown; the failed step already says it failed.
    }
  }

  async function getActorToken() {
    if (busy) return;
    setBusy(true);
    setRuns((previous) => ({ ...previous, actor: { state: "running" }, exchange: previous.exchange?.state === "failed" ? null : previous.exchange }));
    try {
      const response = await apiClient.post("/api/aic-demo/actor-token");
      // A new actor token invalidates any earlier exchange (the BFF discarded it too).
      setStatus((previous) => ({ ...previous, actorReady: true, actorResult: response.data.actorResult, exchangeResult: null }));
      setRuns((previous) => ({ ...previous, actor: { state: "done" } }));
      notifySuccess("Actor token issued by AIC.");
    } catch (error) {
      const message = failureMessage(error);
      setRuns((previous) => ({ ...previous, actor: { state: "failed", message } }));
      notifyError(message);
      await resyncStatus();
    } finally {
      setBusy(false);
    }
  }

  async function exchange() {
    if (busy) return;
    setBusy(true);
    setRuns((previous) => ({ ...previous, exchange: { state: "running" } }));
    try {
      const response = await apiClient.post("/api/aic-demo/exchange");
      setStatus((previous) => ({ ...previous, exchangeResult: response.data.exchangeResult }));
      setRuns((previous) => ({ ...previous, exchange: { state: "done" } }));
      notifySuccess("AIC issued the delegated token.");
    } catch (error) {
      const message = failureMessage(error);
      setRuns((previous) => ({ ...previous, exchange: { state: "failed", message } }));
      notifyError(message);
      await resyncStatus();
    } finally {
      setBusy(false);
    }
  }

  // `unknown` = the BFF has not told us yet (loading) or could not (failed): never say "not configured" then.
  const unknown = !status;
  const features = status?.features || {};
  const userResult = status?.userResult;
  const actorResult = status?.actorResult;
  const exchangeResult = status?.exchangeResult;
  const userSignedIn = Boolean(status?.userSignedIn);
  const actorReady = Boolean(status?.actorReady);
  const canExchange = userSignedIn && actorReady;
  const nothingConfigured = !unknown && !features.login && !features.actor;

  // The exchange needs both tokens. A token that is not held and whose step is off on this BFF can never arrive.
  const exchangeOff = [];
  if (!unknown && !userSignedIn && !features.login) exchangeOff.push("the user token");
  if (!unknown && !actorReady && !features.actor) exchangeOff.push("the actor token");

  let next = null;
  if (!unknown) {
    if (features.login && !userSignedIn) next = "user";
    else if (features.actor && !actorReady) next = "actor";
    else if (canExchange && !exchangeResult) next = "exchange";
  }

  const unknownStatus = loading
    ? { tone: "neutral", word: "Loading", text: "Asking the BFF what is configured and held." }
    : { tone: "neutral", word: "Unavailable", text: "The BFF did not answer, so this step cannot be described. Reload the page to try again." };

  let userStatus;
  if (unknown) userStatus = unknownStatus;
  else if (userSignedIn) userStatus = { tone: "ok", word: "Token held", text: `The BFF holds the user token${userResult?.subject ? ` for ${userResult.subject}` : ""}.` };
  else if (!features.login) userStatus = { tone: "warn", word: "Not configured", text: "Sign-in is off: this BFF has no AIC issuer or subject client set." };
  else userStatus = { tone: "neutral", word: "Not signed in", text: "No user token yet. Sign in at AIC to get one." };

  let actorStatus;
  const actorRun = runs.actor;
  if (unknown) actorStatus = unknownStatus;
  else if (actorRun?.state === "running") actorStatus = { tone: "info", word: "Asking AIC", text: "Requesting the actor token from AIC." };
  else if (actorRun?.state === "failed") actorStatus = { tone: "danger", word: "Failed", text: actorRun.message };
  else if (actorReady) actorStatus = { tone: "ok", word: "Token held", text: `The BFF holds the actor token${status?.actorClientId ? ` for ${status.actorClientId}` : ""}.` };
  else if (!features.actor) actorStatus = { tone: "warn", word: "Not configured", text: "The agent client is off: this BFF has no AIC actor client set." };
  else actorStatus = { tone: "neutral", word: "Not requested", text: "No actor token yet." };

  let exchangeStatus;
  const exchangeRun = runs.exchange;
  if (unknown) exchangeStatus = unknownStatus;
  else if (exchangeRun?.state === "running") exchangeStatus = { tone: "info", word: "Asking AIC", text: "Exchanging the two tokens at AIC." };
  else if (exchangeRun?.state === "failed") exchangeStatus = { tone: "danger", word: "Failed", text: exchangeRun.message };
  else if (exchangeResult?.trace?.length > 0) exchangeStatus = { tone: "ok", word: "Issued", text: "AIC issued the delegated token." };
  else if (canExchange) exchangeStatus = { tone: "info", word: "Ready", text: "Both tokens are held. The exchange has not run yet." };
  else if (exchangeOff.length > 0) exchangeStatus = { tone: "warn", word: "Not configured", text: `This BFF cannot get ${exchangeOff.join(" or ")}, so the exchange cannot run here.` };
  else exchangeStatus = { tone: "neutral", word: "Waiting", text: "Needs the user token and the actor token." };

  let banner;
  if (loading) banner = { word: "CHECKING", text: "asking the BFF which AIC steps are configured. Nothing on this page has called AIC yet." };
  else if (unknown) banner = { word: "STATUS UNAVAILABLE", text: "the BFF did not answer, so this page cannot say what is configured or held. Nothing below is known. Reload to try again. The animated diagram is a walkthrough only." };
  else if (nothingConfigured) banner = { word: "NOT CONFIGURED", text: "this BFF has no AIC tenant settings, so every step is off and nothing here calls AIC. The animated diagram is a walkthrough only." };
  else banner = { word: "LIVE AIC CALLS", text: "nothing on this page is simulated. Each step you run sends a real request to the Advanced Identity Cloud tenant this BFF is configured for, and the traces show what the BFF recorded with every secret replaced. A step that is not configured stays off. The animated diagram is a walkthrough, not live traffic." };

  const flowTone = (done) => (done ? "ok" : undefined);

  return (
    <PingPage className="aic-page" data-testid="aic-token-exchange-page">
      <SimBanner data-testid="aic-banner">
        <strong>{banner.word}</strong> &mdash; {banner.text}
      </SimBanner>
      <PageHeader
        eyebrow="PingOne Advanced Identity Cloud"
        title="AIC token exchange"
        summary="A delegation exchange needs a token for the person and a token for the agent acting for them, both issued by AIC. Get each one, then exchange the pair for a narrower token that records who is acting. The BFF keeps every token and shows what went over the wire with every secret replaced."
      />
      <PageFrame>
        {!loading && outcome === "error" && (
          <p className="pu-status-line" role="alert" data-testid="aic-login-error">
            <StatusChip tone="danger">Failed</StatusChip>
            AIC sign-in did not complete{status?.lastError?.message ? `: ${status.lastError.message}` : "."}
          </p>
        )}

        <Section id="aic-flow-h" kicker="1 · The flow" title="Three calls, one delegated token">
          <EmbeddedFlowDiagram
            testId="aic-diagram"
            pingStyle
            title="How the AIC delegation exchange works"
            lede="Three calls to AIC, all brokered by the BFF: the user token, the agent token, then the RFC 8693 exchange of the pair."
            config={{ GROUPS: AIC_EXCHANGE_GROUPS, NODES: AIC_EXCHANGE_NODES, EDGES: AIC_EXCHANGE_EDGES, STEPS: AIC_EXCHANGE_STEPS }}
          />
        </Section>

        <Section id="aic-user-title" kicker="2 · Subject token" title="User token" lede="The person signs in directly at AIC with authorization code and PKCE.">
          <Card tone={flowTone(userSignedIn)} data-testid="aic-user-card">
            <StepStatus tone={userStatus.tone} word={userStatus.word} data-testid="aic-user-status">{userStatus.text}</StepStatus>
            <KvList
              items={[
                { label: "Client", value: unknown ? "\u2014" : `${status.subjectClientId || "not set"} \u00b7 public, PKCE S256`, mono: true },
                { label: "Redirect URI to register in AIC", value: status?.redirectUri || "\u2014", mono: true },
                { label: "Held by the BFF", value: unknown ? "\u2014" : (userSignedIn ? `Yes \u2014 ${userResult?.subject}` : "No") },
              ]}
            />
            {!unknown && (features.login
              ? (
                <div className="pu-actions">
                  <a className={next === "user" ? "pu-btn aic-page__next" : "pu-btn"} href="/api/aic-demo/login/start">
                    {userSignedIn ? "Sign in at AIC again" : "Sign in at AIC"}
                  </a>
                </div>
              )
              : <p className="pu-note">Set AIC_ISSUER and AIC_SUBJECT_CLIENT_ID to sign in</p>)}
            {userResult?.trace?.length > 0 && (
              <Proof
                testId="aic-user-proof"
                steps={userResult.trace}
                explain={USER_EXPLAIN}
                points={(
                  <>
                    <li>The ID token says {userResult.subject} signed in at {userResult.issuer}.</li>
                    <li>Scopes on the user token: {userResult.scope || "none reported"}.</li>
                    {userResult.opaque && <li>The access token is opaque, so its contents come from introspection, not from decoding it.</li>}
                  </>
                )}
              />
            )}
          </Card>
        </Section>

        <Section id="aic-actor-title" kicker="3 · Actor token" title="Agent token" lede="The agent gets its own token from AIC with client credentials.">
          <Card tone={flowTone(actorReady && actorRun?.state !== "failed")} data-testid="aic-actor-card">
            <StepStatus tone={actorStatus.tone} word={actorStatus.word} data-testid="aic-actor-status">{actorStatus.text}</StepStatus>
            <KvList
              items={[
                { label: "Client", value: unknown ? "\u2014" : `${status.actorClientId || "not set"} \u00b7 confidential`, mono: true },
                { label: "Scope requested", value: unknown ? "\u2014" : (status.delegatedScope || "client default"), mono: true },
                { label: "Held by the BFF", value: unknown ? "\u2014" : (actorReady ? "Yes" : "No") },
              ]}
            />
            {!unknown && (features.actor
              ? (
                <div className="pu-actions">
                  <StepAction isNext={next === "actor"} busy={busy} onClick={getActorToken}>Get actor token</StepAction>
                </div>
              )
              : <p className="pu-note">Set AIC_ACTOR_CLIENT_ID and AIC_ACTOR_CLIENT_SECRET to get an actor token</p>)}
            {actorResult?.trace?.length > 0 && actorRun?.state !== "failed" && (
              <Proof
                testId="aic-actor-proof"
                steps={actorResult.trace}
                explain={ACTOR_EXPLAIN}
                points={(
                  <>
                    <li>Issued to {actorResult.clientId} with scope: {actorResult.scope || "none reported"}.</li>
                    {actorResult.opaque && <li>The access token is opaque, so its contents come from introspection, not from decoding it.</li>}
                  </>
                )}
              />
            )}
          </Card>
        </Section>

        <Section id="aic-exchange-title" kicker="4 · RFC 8693 delegation" title="Delegated token" lede="The agent exchanges the user token and its own token for one that acts for the user.">
          <Card tone={flowTone(exchangeStatus.word === "Issued")} data-testid="aic-exchange-card">
            <StepStatus tone={exchangeStatus.tone} word={exchangeStatus.word} data-testid="aic-exchange-status">{exchangeStatus.text}</StepStatus>
            <KvList
              items={[
                { label: "Subject", value: unknown ? "\u2014" : (userSignedIn ? userResult?.subject : "user token needed") },
                { label: "Actor", value: unknown ? "\u2014" : (actorReady ? status.actorClientId : "actor token needed") },
                { label: "Scope requested", value: unknown ? "\u2014" : (status.delegatedScope || "none"), mono: true },
              ]}
            />
            {!unknown && (canExchange
              ? (
                <div className="pu-actions">
                  <StepAction isNext={next === "exchange"} busy={busy} onClick={exchange}>Exchange tokens</StepAction>
                </div>
              )
              : <p className="pu-note">{exchangeOff.length > 0 ? "Turn on the step marked Not configured above to enable the exchange" : "Get the user token and the actor token first"}</p>)}
            {exchangeResult?.trace?.length > 0 && exchangeRun?.state !== "failed" && (
              <Proof
                testId="aic-exchange-proof"
                steps={exchangeResult.trace}
                explain={EXCHANGE_EXPLAIN}
                points={(
                  <>
                    <li>Delegated token for {exchangeResult.subject || "the user"}, with scope: {exchangeResult.scope || "none reported"}.</li>
                    <li>
                      {exchangeResult.act
                        ? `Acting party (act claim): ${JSON.stringify(exchangeResult.act)}.`
                        : "AIC did not report an act claim for this token."}
                    </li>
                    {exchangeResult.opaque && <li>The token is opaque, so its contents come from introspection, not from decoding it.</li>}
                  </>
                )}
              />
            )}
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

/** A step's button. `isNext` marks the one next step, which is the view's only primary; the label never changes while busy (aria-disabled keeps focus). */
function StepAction({ isNext, busy, onClick, children, ...rest }) {
  return (
    <button
      type="button"
      className={isNext ? "pu-btn pu-btn--primary" : "pu-btn"}
      aria-disabled={busy ? "true" : undefined}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Status line: a chip with its word plus a sentence, in a live region that is mounted before its text changes. */
function StepStatus({ tone, word, children, ...rest }) {
  return (
    <p className="pu-status-line" role="status" {...rest}>
      <StatusChip tone={tone}>{word}</StatusChip>
      {children}
    </p>
  );
}

function Proof({ testId, points, steps, explain }) {
  return (
    <div className="aic-page__proof" data-testid={testId}>
      <h3 className="pu-h3">Proof: what was sent and what came back</h3>
      <ul className="aic-page__points">{points}</ul>
      <ProtocolTrace steps={steps} explain={explain} />
    </div>
  );
}
