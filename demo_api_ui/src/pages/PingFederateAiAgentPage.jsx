import { useEffect, useMemo, useRef, useState } from "react";
import DraggableModal from "../components/DraggableModal";
import ProtocolTrace from "../components/ProtocolTrace";
import apiClient from "../services/apiClient";
import { notifyError, notifySuccess } from "../utils/appToast";
import { Card, KvList, PageFrame, PingPage, SimBanner, StatusChip } from "../components/pingUi";
import { FeatureStatus, FlowSection, RunStatus, TraceSequenceDiagram, Unavailable } from "../components/pfAiAgent/shared";
import { leadAction } from "../components/pfAiAgent/leadAction";
import ProviderComparison from "../components/pfAiAgent/ProviderComparison";
import PfDcrSection from "../components/pfAiAgent/PfDcrSection";
import PfCimdTester from "../components/pfAiAgent/PfCimdTester";
import PfPiFlowSection from "../components/pfAiAgent/PfPiFlowSection";
import PfDpopSection from "../components/pfAiAgent/PfDpopSection";
import PfTokenExchangeSection from "../components/pfAiAgent/PfTokenExchangeSection";
import "./PingFederateAiAgentPage.css";
import PageHeader from '../components/common/PageHeader';

function statusLabel(provider) {
  if (provider === "pingone") return "PingOne";
  if (provider === "pingfederate") return "PingFederate";
  return "No signed-in session";
}

// What each captured step means, in plain words. The traffic itself comes from the BFF, with secrets replaced.
const RAR_EXPLAIN = {
  par: "The agent does not put the transaction in a URL. It POSTs it to PingFederate's pushed authorization request (PAR) endpoint. authorization_details says exactly what it wants to do: one transfer, between these accounts, up to this amount. PingFederate runs the policy processor on it now, and refuses here if the shape is wrong. Back comes a one-time request_uri.",
  authorize: "The browser carries only the client and the request_uri, so the transaction cannot be edited on the way. The user signs in; only after that can the processor check that the user is the one named, that both accounts are theirs and that the amount is within their limit.",
  callback: "PingFederate sends the user back to the app: with a one-time code if the policy passed, or with a refusal if it did not. The refusal's own text is not shown here, only how the app classified it.",
  token: "The BFF redeems the code, proving it started the flow with the PKCE verifier. authorization_details in the response is what PingFederate actually granted. The ID token's claims say who signed in. The access and refresh tokens stay on the server and are shown only as redacted.",
};

const CIMD_EXPLAIN = {
  metadata: "There is no pre-registered client. The client_id is this URL, and the URL serves the client's own metadata: its redirect URI, that it is a public client with no secret, and the scopes it may ask for. PingFederate fetches this document to learn who is asking.",
  authorize: "The browser is sent to PingFederate with that URL as client_id and a PKCE challenge, so only this app can redeem the code later. login_hint pre-fills the user PingFederate already knows about.",
  callback: "PingFederate sends the user back to the redirect URI from the metadata document, with a one-time code.",
  token: "The BFF redeems the code with the PKCE verifier; no client secret is involved. The ID token's claims say who signed in and where. The access and refresh tokens stay on the server and are shown only as redacted.",
};

const RAR_REASONS = {
  authorization_details_refused: "the policy processor refused the transaction as out of policy",
  authorization_rejected: "the sign-in or consent was rejected",
};

// The few facts a reader should take away from one run, taken from what was captured.
function rarProofPoints(result) {
  const steps = result?.trace || [];
  const par = steps.find((s) => s.id === "par");
  const token = steps.find((s) => s.id === "token");
  const points = [];
  if (par?.response?.status) {
    points.push(`PingFederate accepted the request at PAR (HTTP ${par.response.status}) and returned a one-time request_uri.`);
  }
  if (result?.outcome === "accepted") {
    points.push("After sign-in, the processor checked the user, the accounts and the amount, and PingFederate issued an authorization code.");
    if (token?.response?.body?.authorization_details) {
      points.push("The token response carries authorization_details: PingFederate's record of what was granted.");
    }
    if (token?.claims?.idToken?.sub) points.push(`The ID token says ${token.claims.idToken.sub} signed in.`);
    points.push(result.dpopThumbprint
      ? "The access token is bound to this app's key with DPoP, so a stolen copy cannot be replayed."
      : "The access token is a plain Bearer token.");
  } else if (result?.outcome === "denied") {
    points.push(`PingFederate then refused it: ${RAR_REASONS[result.reason] || "the request was refused"}. No token was issued.`);
  }
  return points;
}

const EXCHANGE_EXPLAIN = {
  "pf-exchange": "The BFF hands PingFederate a token it issued (the subject) and asks, under RFC 8693 token exchange, for an ID-JAG: a short-lived signed assertion that names the user, the third party it is for (audience) and what it allows (scope, resource). The decoded header and claims below are that assertion; its typ marks it as an ID-JAG.",
  verify: "The BFF does not trust what came back. It checks the signature against PingFederate's published keys, then the issuer, audience, expiry, scope and resource, before using it anywhere.",
  redeem: "The ID-JAG goes to the third party as a JWT bearer assertion (RFC 7523). The third party trusts PingFederate's signature, so it issues its own access token without the user signing in again. PingFederate and the third party never shared a session.",
};

// The few facts a reader should take from one exchange, from what was captured.
function exchangeProofPoints(result) {
  const steps = result?.trace || [];
  const exchange = steps.find((s) => s.id === "pf-exchange");
  const idJag = exchange?.claims?.idJag;
  const redeem = steps.find((s) => s.id === "redeem");
  const points = [];
  if (idJag) {
    points.push(`PingFederate issued an ID-JAG for ${idJag.sub}, addressed to ${idJag.aud}, allowing ${idJag.scope}.`);
  }
  points.push("The BFF verified its signature, issuer, audience, scope and resource before using it.");
  if (redeem?.response?.status === 200) {
    points.push("The third-party server accepted it as a bearer assertion and issued its own access token, with no second sign-in.");
  }
  return points;
}

const CIBA_EXPLAIN = {
  start: "The BFF (the client) asks the authorization server to authenticate a named user out of band. It authenticates with its own client credentials and sends only the user hint and an optional message. The auth_req_id that comes back is the handle for this request: it stays on the server.",
  poll: "The BFF polls the token endpoint with the CIBA grant until the user answers. Each poll before the answer returns authorization_pending; the one shown here is the poll that ended the wait.",
  decision: "With the mock phone, the person's tap is the whole decision, and nothing outside this page is involved.",
};

// What a CIBA run proved, in plain words, from the captured steps and the outcome.
function cibaProofPoints(state) {
  const steps = state?.trace || [];
  const server = cibaServerName(state);
  const mock = steps[0]?.title?.includes("mock phone");
  const points = [];
  if (!mock && steps.some((s) => s.id === "start")) {
    points.push(`${server} accepted the request and returned an auth_req_id. The BFF keeps it; the browser never sees it.`);
  }
  if (state?.state === "pending") {
    points.push(mock
      ? "Waiting for a tap on the mock phone."
      : `Waiting: the BFF polls ${server} for the answer, and each poll until then returns authorization_pending.`);
  } else if (state?.state === "approved") {
    points.push(mock
      ? "The mock phone approved. This proves the page flow only: no token was issued."
      : `The user approved. The ID token says ${state.subject || state.loginHint} approved, and ${server} signed it.`);
  } else if (state?.state === "denied" || state?.state === "expired") {
    points.push(`The request ended ${state.state}. No token was issued.`);
  }
  return points;
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

// The BFF titles a mock-phone run's first step "... (mock phone)"; the page also remembers a tap it sent itself.
const isMockCiba = (state, tapped = false) => tapped || Boolean(state?.trace?.[0]?.title?.includes("mock phone"));

function cibaOutcome(state, mock = false) {
  switch (state?.state) {
    case "approved": return mock
      ? `Approved by ${state.subject || state.loginHint} on the mock phone. No real device was contacted and no token was issued.`
      : `Approved by ${state.subject || state.loginHint} through ${cibaServerName(state)} CIBA.`;
    case "denied": return "The user denied the request.";
    case "expired": return "The request expired before anyone answered it.";
    case "error": return "The approval request failed.";
    default: return null;
  }
}

// What the banner may say about the approval step comes from the flags the BFF reported, never fixed text.
function cibaBannerText(features, provider, cibaEnabled) {
  const parts = [];
  if (features.cibaWebApprover) parts.push("Human approval (CIBA) on PingFederate is answered by a stand-in web approver on this page, not by a person's own device.");
  else if (features.cibaMock) parts.push("Human approval (CIBA) on PingFederate is answered on a mock phone on this page: no real device is contacted, so an approval proves the page flow only.");
  else if (features.ciba) parts.push("Human approval (CIBA) is sent to PingFederate and answered outside this page.");
  else if (!cibaEnabled) parts.push("Human approval (CIBA) is not configured.");
  if (provider === "pingone") parts.push("A PingOne session sends CIBA to PingOne instead.");
  if (features.cibaEmail) parts.push("The email channel uses a link sent through an in-process SMTP sink, not a real mailbox.");
  return parts.join(" ");
}

const cibaTone = (state) => ({ approved: "ok", denied: "warn", expired: "neutral", error: "danger", pending: "info" }[state?.state] || "neutral");
const cibaWord = (state, mock = false) => {
  if (state?.state === "approved") return mock ? "Approved on mock phone" : "Approved";
  return { denied: "Denied", expired: "Expired", error: "Failed", pending: "Waiting" }[state?.state] || "";
};

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
  const [exchangeDetail, setExchangeDetail] = useState("");
  // CIBA: ask a named user to approve on their device, then poll through the BFF.
  const [typedCibaUser, setTypedCibaUser] = useState(null);
  const cibaUser = typedCibaUser ?? user?.username ?? "";
  const [cibaMessage, setCibaMessage] = useState("");
  const [cibaState, setCibaState] = useState(null);
  const [cibaBusy, setCibaBusy] = useState(false);
  const [cibaError, setCibaError] = useState("");
  const [phoneClosed, setPhoneClosed] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [mockTapped, setMockTapped] = useState(false);
  // The callback line is mounted empty and filled after mount, so the live region announces it.
  const [callbackShown, setCallbackShown] = useState(false);
  useEffect(() => setCallbackShown(true), []);
  const queryStatus = useMemo(() => new URLSearchParams(window.location.search), []);
  const askRef = useRef(null);
  const reopenRef = useRef(null);
  const phoneRef = useRef(null);

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
  const features = status?.features || { cimd: false, crossDomain: false, rar: false, rarDpop: false, ciba: false, cibaMock: false, cibaWebApprover: false, dcr: false };
  const rarResult = status?.rarResult || null;
  // ID-JAG is ready when this page's own exchange is configured or the PingFederate ID-JAG demo is on.
  const idJagReady = Boolean(features.crossDomain || status?.idJagDemoEnabled);
  const cimdResult = status?.cimdResult || null;
  const rarUserKeyValue = rarUserKey.trim();
  const callbackResult = queryStatus.get("cimd") || queryStatus.get("rar");

  async function askForApproval() {
    if (!cibaEnabled || cibaBusy || cibaPending || !cibaUser.trim()) return;
    setCibaBusy(true);
    setCibaError("");
    setCibaState(null);
    setPhoneClosed(false);
    setEmailSent(false);
    setMockTapped(false);
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
  // The email channel answers from the emailed one-time link instead — no phone popup.
  const phoneChannel = features.cibaWebApprover ? "web" : features.cibaMock ? "mock" : null;
  const emailChannelLive = Boolean(features.cibaEmail);
  // PingOne CIBA is answered on the user's real device, so the mock phone only serves PingFederate requests.
  const phoneOpen = cibaPending && Boolean(phoneChannel) && !phoneClosed && cibaState?.provider !== "pingone";
  const emailPending = cibaPending && emailChannelLive && cibaState?.provider !== "pingone";

  // Email channel: send the approval email over a real SMTP round trip to the BFF's in-process sink.
  async function sendApprovalEmail() {
    setEmailSent(false);
    setCibaError("");
    try {
      const response = await apiClient.post("/api/pf-ai-agent/ciba/email/send", {});
      setEmailSent(true);
      notifySuccess(`Approval email sent to ${response.data.sentTo}.`);
    } catch (error) {
      setCibaError(error?.response?.data?.error === "pf_ai_ciba_email_send_failed"
        ? "The approval email could not be sent."
        : "The approval email could not be sent.");
    }
  }
  const answerOnPhone = (decision) => (phoneChannel === "web" ? decideOnWebApprover(decision) : decideOnMockPhone(decision));
  const phoneLabel = (decision) => (phoneChannel === "web"
    ? `${decision === "approve" ? "Approve" : "Deny"} (web approver)`
    : `${decision === "approve" ? "Approve" : "Deny"} on mock phone`);

  // Mock phone: stands in for the user's device when PF_AI_CIBA_MOCK_ENABLED is on.
  async function decideOnMockPhone(decision) {
    setCibaError("");
    try {
      const response = await apiClient.post("/api/pf-ai-agent/ciba/mock-decision", { decision });
      setMockTapped(true);
      setCibaState(response.data);
    } catch {
      setCibaError("The mock phone could not answer.");
    }
  }

  // Web approver: the PingFederate stand-in authenticator is waiting for a person; the next poll sees the answer.
  async function decideOnWebApprover(decision) {
    setCibaError("");
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
    setExchangeDetail("");
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
      setExchangeDetail(error?.response?.data?.detail || "");
      notifyError("Third-party token exchange failed. Check the PF and downstream setup.");
    } finally {
      setExchangeBusy(false);
    }
  }

  const statusKnown = !loadingStatus && status !== null;
  const anyPfReady = Boolean(features.cimd || idJagReady || features.rar || features.ciba || features.dcr || features.rarDpop);
  // A working stand-in for human approval, named in words where the real feature reads "Not configured".
  const cibaStand = features.cibaMock ? "Mock phone only" : features.cibaWebApprover ? "Web approver only" : "";
  const lead = leadAction({
    loading: loadingStatus,
    phoneOpen,
    runnable: {
      // Only a PingFederate token can start the exchange (a PingOne-only session is refused), so only that makes it the lead.
      exchange: (provider === "pingfederate" || pfSignedIn) && Boolean(features.crossDomain),
      rar: Boolean(features.rar && supportedSession && rarUserKeyValue),
      ciba: Boolean(cibaEnabled && supportedSession && cibaUser.trim()),
      dcr: Boolean(features.dcr),
      delegation: provider === "pingfederate",
      dpop: Boolean(features.rarDpop),
    },
  });

  // The popup is a dialog: move focus into it when it opens and hand it back when it closes (DraggableModal does neither).
  const wasPhoneOpen = useRef(false);
  useEffect(() => {
    if (phoneOpen && !wasPhoneOpen.current) {
      const frame = window.requestAnimationFrame(() => phoneRef.current?.querySelector("button")?.focus());
      wasPhoneOpen.current = true;
      return () => window.cancelAnimationFrame(frame);
    }
    if (!phoneOpen && wasPhoneOpen.current) {
      wasPhoneOpen.current = false;
      (reopenRef.current || askRef.current)?.focus();
    }
    return undefined;
  }, [phoneOpen]);

  let banner;
  if (loadingStatus) {
    banner = <>Checking which PingFederate features this BFF has configured. Until that answers, nothing below is marked ready and no action is offered as the main one.</>;
  } else if (!status) {
    banner = <>The status check failed, so this page cannot tell which PingFederate flows are configured. Nothing here has been run, and actions that need the status are not offered.</>;
  } else {
    banner = (
      <>
        {anyPfReady
          ? <><strong>Read from this BFF.</strong> A flow marked Ready is configured here and sends real requests to the PingFederate this BFF is configured for; Ready means configured, not that PingFederate was reached. Each proof panel shows the traffic that came back, with secrets redacted by the BFF. A flow marked Not configured does not run.</>
          : <><strong>No PingFederate flow is configured on this BFF.</strong> Nothing below sends a request to PingFederate until a flow is configured.</>}{" "}
        {features.dcr ? "Dynamic client registration creates a real client at PingFederate and the same run deletes it. " : ""}
        {cibaBannerText(features, provider, cibaEnabled)}
      </>
    );
  }

  // The line says what the BFF confirmed, not just what the URL claims: green only where the status call backs it.
  let callbackWord;
  let callbackTone;
  let callbackText;
  if (queryStatus.get("cimd")) {
    if (callbackResult !== "success") {
      callbackWord = callbackResult === "denied" ? "Denied" : "Not completed";
      callbackTone = callbackResult === "denied" ? "warn" : "danger";
      callbackText = "CIMD authorization did not complete.";
    } else if (loadingStatus) {
      [callbackWord, callbackTone, callbackText] = ["Checking", "neutral", "Returned from PingFederate. Checking the BFF session."];
    } else if (!status) {
      [callbackWord, callbackTone, callbackText] = ["Returned", "neutral", "PingFederate returned success, but the status check failed, so this page cannot say whether the BFF holds a PingFederate sign-in."];
    } else if (pfSignedIn) {
      [callbackWord, callbackTone, callbackText] = ["Done", "ok", "CIMD authorization completed. You are signed in at PingFederate; the token stays with the BFF and the third-party exchange below now uses it."];
    } else {
      [callbackWord, callbackTone, callbackText] = ["No sign-in", "warn", "PingFederate returned success, but the BFF reports no PingFederate sign-in for this session, so the exchange below will not use it."];
    }
  } else if (callbackResult === "success") {
    if (rarResult?.outcome === "accepted") {
      [callbackWord, callbackTone, callbackText] = ["Done", "ok", "PingFederate accepted the RAR request."];
    } else if (loadingStatus) {
      [callbackWord, callbackTone, callbackText] = ["Checking", "neutral", "Returned from PingFederate. Checking the BFF's record of the request."];
    } else {
      [callbackWord, callbackTone, callbackText] = ["Returned", "neutral", "PingFederate sent the user back with success, but the BFF has no recorded result for this request, so it is not confirmed here."];
    }
  } else if (callbackResult === "denied") {
    [callbackWord, callbackTone, callbackText] = ["Denied", "warn", "PF denied the RAR request."];
  } else {
    [callbackWord, callbackTone, callbackText] = ["Not completed", "danger", "RAR authorization did not complete."];
  }

  // Where the answer comes from is the channel the BFF reported, so a mock phone is never described as a real device.
  const cibaWhere = cibaState?.provider === "pingone" ? "their device (PingOne CIBA)"
    : phoneChannel === "mock" ? "the mock phone (no real device is contacted)"
      : phoneChannel === "web" ? "the web approver"
        : `their device (${cibaServerName(cibaState)} CIBA)`;
  const cibaMock = isMockCiba(cibaState, mockTapped);
  const cibaMessageText = cibaPending
    ? `Waiting for ${cibaState.loginHint} to approve on ${cibaWhere}. Expires ${new Date(cibaState.expiresAt).toLocaleTimeString()}.`
    : cibaOutcome(cibaState, cibaMock);
  const exchangeNeedsPf = !pfSignedIn && provider !== "pingfederate";

  return (
    <PingPage className="pfai" data-testid="pingfederate-ai-agent-page">
      <SimBanner data-testid="pfai-banner">{banner}</SimBanner>

      <PageHeader className="pfai-hero" eyebrow="PingFederate · AI agent authorization" title="PingFederate AI Agent" summary={<>ID-JAG, CIMD, dynamic client registration, rich authorization, CIBA, DPoP, token exchange and the Authentication API, each run against PingFederate.
            Each request stays on the PingFederate path.</>}
        actions={<div className="pfai-session" aria-live="polite">
          <span>Current session</span>
          <strong>{loadingStatus ? "Checking session" : status ? statusLabel(provider) : "Session unknown"}</strong>
          <StatusChip tone={statusKnown && supportedSession ? "ok" : "neutral"}>
            {loadingStatus ? "Checking" : !status ? "Unknown" : supportedSession ? "Signed in" : "Signed out"}
          </StatusChip>
          <p>{!status && !loadingStatus
            ? "The status check failed, so the session could not be read."
            : supportedSession
              ? "The exchange uses this session's access token as its subject."
              : "Sign in to the app to use a session token as the exchange subject."}</p>
        </div>} />

      <PageFrame>
        {callbackResult && (
          <div className="pu-status-line pfai-callback" role="status">
            {callbackShown && <><StatusChip tone={callbackTone}>{callbackWord}</StatusChip><span>{callbackText}</span></>}
          </div>
        )}
        {queryStatus.get("rar") === "success" && rarResult?.tokenType && (
          <p className="pu-note" data-testid="rar-token-line">
            Access token type: <strong>{rarResult.tokenType}</strong>
            {rarResult.dpopThumbprint
              ? <> · bound to this app&apos;s key, thumbprint <code>{rarResult.dpopThumbprint}</code></>
              : " · not bound to a key (a bearer token works for whoever holds it)"}
          </p>
        )}

        <FlowSection id="pf-ai-readiness-title" kicker="Readiness" title="What this PingFederate is set up for" lede="Read from the BFF's status check; a feature that is not configured does not run.">
          <Card>
            <KvList
              items={[
                { label: "Client metadata", value: <FeatureStatus ready={features.cimd} checked={statusKnown} /> },
                { label: "ID-JAG (third-party exchange)", value: <FeatureStatus ready={idJagReady} checked={statusKnown} /> },
                { label: "Rich authorization", value: <FeatureStatus ready={features.rar} checked={statusKnown} /> },
                { label: "Human approval (CIBA)", value: <FeatureStatus ready={features.ciba} checked={statusKnown} stand={cibaStand} /> },
                { label: "Client registration (DCR)", value: <FeatureStatus ready={features.dcr} checked={statusKnown} /> },
                { label: "DPoP", value: <FeatureStatus ready={features.rarDpop} checked={statusKnown} /> },
              ]}
            />
            {status?.nativeIdJagPath && (
              <div className="pu-actions"><a className="pu-btn" href={status.nativeIdJagPath}>Open the existing PF ID-JAG demo</a></div>
            )}
          </Card>
        </FlowSection>

        <ProviderComparison />

        <FlowSection id="pf-ai-cimd-title" kicker="Client identity" title="CIMD" lede="PingFederate fetches the client metadata document from this demo and uses it to resolve the public PKCE client.">
          <Card>
            <div className="pu-status-line"><FeatureStatus ready={features.cimd} checked={statusKnown} /></div>
            <KvList
              items={[
                { label: "Client ID", value: "Metadata document URL" },
                { label: "Client authentication", value: "None · PKCE S256" },
                { label: "Token custody", value: "BFF session only" },
              ]}
            />
            <div className="pu-actions">
              {features.cimd
                ? <a className="pu-btn" href="/api/pf-ai-agent/cimd/start">Start CIMD authorization</a>
                : <Unavailable checked={statusKnown}>Enable PF CIMD to start authorization</Unavailable>}
            </div>
          </Card>
          {cimdResult?.trace?.length > 0 && (
            <Card tone="ok" title="Proof: what was sent and what came back" data-testid="cimd-proof">
              <div className="pu-status-line"><StatusChip tone="ok">Captured</StatusChip></div>
              <TraceSequenceDiagram steps={cimdResult.trace} testId="cimd-sequence" />
              <ul className="pfai-points">
                <li>The client_id is a URL that serves its own metadata; nothing was registered in PingFederate beforehand.</li>
                <li>The ID token says {cimdResult.subject} signed in at {cimdResult.issuer}.</li>
              </ul>
              <ProtocolTrace steps={cimdResult.trace} explain={CIMD_EXPLAIN} />
            </Card>
          )}
        </FlowSection>

        <PfCimdTester ready={features.cimd} checked={statusKnown} />

        <FlowSection anchor="id-jag" id="pf-ai-exchange-title" kicker="Two explicit token hops" title="ID-JAG: third-party token exchange" lede="PF issues the ID-JAG. The downstream authorization server redeems it for its own access token.">
          <Card>
            <div className="pu-status-line"><FeatureStatus ready={idJagReady} checked={statusKnown} /></div>
            {/* The ID-JAG demo runs on the online PingFederate servers: the SE PF issues, the Acme PF redeems. */}
            <div data-testid="idjag-demo-links">
              <p className="pu-note">
                Run it in the PingFederate ID-JAG demo, with real PingFederate on both sides: one PingFederate issues
                the ID-JAG, a second PingFederate redeems it. Every request and response is shown.
              </p>
              <div className="pu-actions">
                <a className="pu-btn" href="/pingfederate-id-jag/playground?mode=pf-pf">Run ID-JAG: PingFederate → PingFederate</a>
                <a className="pu-btn" href="/pingfederate-id-jag">How ID-JAG works</a>
              </div>
            </div>
            {features.crossDomain && (<>
              <p className="pu-note">Or run this page&apos;s own two-hop exchange against the third-party server configured here:</p>
              <div className="pfai-hops" role="group" aria-label="Token exchange hops">
                <div className="pfai-hop">
                  <span className="pfai-hop__index">1</span>
                  <div>
                    <strong>{pfSignedIn && provider !== "pingfederate" ? "PingFederate sign-in (CIMD)" : `${statusLabel(provider)} session`}</strong>
                    <span>subject access token · BFF held</span>
                  </div>
                  <span className="pfai-hop__arrow" aria-hidden="true">›</span>
                  <div><strong>PingFederate</strong><span>issues an audience-bound ID-JAG</span></div>
                </div>
                <div className="pfai-hop">
                  <span className="pfai-hop__index">2</span>
                  <div><strong>PingFederate ID-JAG</strong><span>JWT bearer assertion · BFF held</span></div>
                  <span className="pfai-hop__arrow" aria-hidden="true">›</span>
                  <div><strong>Third-party AS</strong><span>issues its own access token</span></div>
                </div>
              </div>
              <div className="pu-actions">
                <PfButton lead={lead === "exchange"} onClick={runCrossDomainExchange} aria-disabled={canExchange ? undefined : "true"}>
                  Run third-party token exchange
                </PfButton>
              </div>
              <RunStatus tone={exchangeBusy ? "info" : "ok"} word={exchangeBusy ? "Running" : exchangeResult ? "Done" : ""}>
                {exchangeBusy ? "Exchanging tokens at PingFederate and the third-party server." : "The third-party token exchange completed."}
              </RunStatus>
              {exchangeNeedsPf && (
                <p className="pu-note" data-testid="exchange-needs-pf">
                  PingFederate only accepts tokens it issued. Sign in at PingFederate with the CIMD card above first,
                  then run this; until then a PingOne session is refused.
                </p>
              )}
              {pfSignedIn && provider !== "pingfederate" && (
                <p className="pu-note">Using your PingFederate sign-in from the CIMD card; your PingOne session is not sent.</p>
              )}
            </>)}
            {exchangeError && (
              <p className="pfai-error" role="alert">
                The exchange failed. Review the PF and downstream authorization server settings.
                {typeof exchangeError === "string" && <> Reason: <code>{exchangeError}</code></>}
                {exchangeDetail && <> {exchangeDetail}</>}
                {EXCHANGE_HINTS[exchangeError] && <> {EXCHANGE_HINTS[exchangeError]}</>}
              </p>
            )}
          </Card>
          {exchangeResult && (
            <Card tone="ok" title="Exchange completed" aria-label="Sanitized exchange result">
              <div className="pu-status-line"><StatusChip tone="ok">Done</StatusChip></div>
              <KvList
                items={[
                  { label: "Subject", value: exchangeResult.subject || "Not returned" },
                  { label: "PF issuer", value: exchangeResult.pfIssuer },
                  { label: "ID-JAG audience", value: exchangeResult.assertionAudience },
                  { label: "Downstream resource", value: exchangeResult.downstreamAudience },
                  { label: "Granted scope", value: Array.isArray(exchangeResult.scope) ? exchangeResult.scope.join(" ") : "Not returned" },
                  { label: "Expires", value: exchangeResult.expiresAt || "Not returned" },
                ]}
              />
              {exchangeResult.hops?.length > 0 && (
                <ol className="pfai-hoplist">{exchangeResult.hops.map((hop) => <li key={hop.step}>{hop.step}: {hop.issuer} · {hop.tokenType}</li>)}</ol>
              )}
              {exchangeResult.trace?.length > 0 && (
                <div className="pfai-proof" data-testid="exchange-proof">
                  <h4 className="pfai-sub">Proof: what was sent and what came back</h4>
                  <TraceSequenceDiagram steps={exchangeResult.trace} selfCall testId="exchange-sequence" />
                  <ul className="pfai-points">
                    {exchangeProofPoints(exchangeResult).map((point) => <li key={point}>{point}</li>)}
                  </ul>
                  <ProtocolTrace steps={exchangeResult.trace} explain={EXCHANGE_EXPLAIN} />
                </div>
              )}
            </Card>
          )}
        </FlowSection>

        <FlowSection id="pf-ai-rar-title" kicker="Fine-grained consent" title="Rich authorization request" lede="PF receives the authorization detail through PAR and applies the custom transaction policy.">
          <Card>
            <div className="pu-status-line"><FeatureStatus ready={features.rar} checked={statusKnown} /></div>
            <details className="pfai-explain" open>
              <summary>What is RAR, and what does this run do?</summary>
              <p>
                Normally an agent asks for a broad scope such as <code>transactions:write</code>, which says nothing about
                how much or to whom. Rich Authorization Requests (RFC 9396) let it send the exact action instead, as
                <code> authorization_details</code>, and let the authorization server decide on that.
              </p>
              <p>
                Run the <strong>allowed</strong> request: one transfer inside your accounts and limit. PingFederate checks it
                and issues a token that records what was granted. Run the <strong>out-of-policy</strong> one: the same request
                for more than your limit, which PingFederate refuses after you sign in. The decision lives in PingFederate,
                not in the agent. The proof panel under the buttons shows every request and response.
              </p>
            </details>
            <label className="pfai-field">
              <span>PF user key for this request</span>
              <input
                className="pu-select"
                value={rarUserKey}
                onChange={(event) => setTypedUserKey(event.target.value)}
                autoComplete="off"
                maxLength={256}
              />
            </label>
            <pre className="pfai-pre">{JSON.stringify({
              type: "banking_transaction",
              actions: ["transfer"],
              source_account: "checking-100",
              destination_account: "savings-200",
              amount: 125,
              currency: "USD",
            }, null, 2)}</pre>
            {features.rarDpop && (
              <label className="pfai-check">
                <input type="checkbox" checked={bindDpop} onChange={(event) => setBindDpop(event.target.checked)} />
                Bind the access token to this app&apos;s key with DPoP
              </label>
            )}
            <div className="pu-actions pfai-forms">
              {features.rar && supportedSession && rarUserKeyValue
                ? <>
                  <form method="post" action="/api/pf-ai-agent/rar/start">
                    <input type="hidden" name="scenario" value="allowed" />
                    <input type="hidden" name="userKey" value={rarUserKeyValue} />
                    {features.rarDpop && bindDpop && <input type="hidden" name="dpop" value="1" />}
                    <PfButton lead={lead === "rar"} type="submit">Run allowed RAR request</PfButton>
                  </form>
                  <form method="post" action="/api/pf-ai-agent/rar/start">
                    <input type="hidden" name="scenario" value="denied" />
                    <input type="hidden" name="userKey" value={rarUserKeyValue} />
                    {features.rarDpop && bindDpop && <input type="hidden" name="dpop" value="1" />}
                    <PfButton type="submit">Run out-of-policy RAR request</PfButton>
                  </form>
                </>
                : <Unavailable checked={statusKnown}>Configure RAR and sign in to start the request</Unavailable>}
            </div>
          </Card>
          {rarResult?.trace?.length > 0 && (
            <Card tone={rarResult.outcome === "denied" ? "warn" : "ok"} title="Proof: what was sent and what came back" data-testid="rar-proof">
              <div className="pu-status-line">
                <StatusChip tone={rarResult.outcome === "denied" ? "warn" : rarResult.outcome === "accepted" ? "ok" : "neutral"}>
                  {rarResult.outcome === "denied" ? "Refused" : rarResult.outcome === "accepted" ? "Accepted" : "Captured"}
                </StatusChip>
              </div>
              <TraceSequenceDiagram steps={rarResult.trace} testId="rar-sequence" />
              <ul className="pfai-points">
                {rarProofPoints(rarResult).map((point) => <li key={point}>{point}</li>)}
              </ul>
              <ProtocolTrace steps={rarResult.trace} explain={RAR_EXPLAIN} />
            </Card>
          )}
        </FlowSection>

        <FlowSection id="pf-ai-ciba-title" kicker="Human approval" title="Ask a person to approve (CIBA)" lede="PingFederate asks the named user's PingOne MFA device to approve this request, and this page waits for the answer. The user needs an enrolled MFA device.">
          <Card>
            <div className="pu-status-line"><FeatureStatus ready={features.ciba} checked={statusKnown} stand={cibaStand} /></div>
            <label className="pfai-field">
              <span>User to ask (PingOne username)</span>
              <input
                className="pu-select"
                value={cibaUser}
                onChange={(event) => setTypedCibaUser(event.target.value)}
                autoComplete="off"
                maxLength={256}
              />
            </label>
            <label className="pfai-field">
              <span>Message shown on their device (optional)</span>
              <input
                className="pu-select"
                value={cibaMessage}
                onChange={(event) => setCibaMessage(event.target.value)}
                autoComplete="off"
                maxLength={20}
              />
            </label>
            <div className="pu-actions">
              {cibaEnabled && supportedSession
                ? <PfButton
                  lead={lead === "ciba"}
                  ref={askRef}
                  onClick={askForApproval}
                  aria-disabled={cibaBusy || cibaPending || !cibaUser.trim() ? "true" : undefined}
                  aria-describedby={cibaUser.trim() ? undefined : "pfai-ciba-needs-user"}
                >
                  Ask for approval
                </PfButton>
                : <Unavailable checked={statusKnown}>Configure CIBA and sign in to ask for approval</Unavailable>}
              {cibaPending && phoneChannel && phoneClosed && cibaState?.provider !== "pingone" && (
                <PfButton ref={reopenRef} onClick={() => setPhoneClosed(false)}>Open mock phone</PfButton>
              )}
              {emailPending && <PfButton onClick={sendApprovalEmail}>Send approval email</PfButton>}
            </div>
            {cibaEnabled && supportedSession && !cibaUser.trim() && (
              <p className="pu-note" id="pfai-ciba-needs-user">Enter a user to ask before you can ask for approval.</p>
            )}
            <RunStatus
              tone={cibaBusy ? "info" : cibaTone(cibaState)}
              word={cibaBusy ? "Sending" : cibaMessageText ? cibaWord(cibaState, cibaMock) : ""}
              testId={cibaPending ? "ciba-pending" : cibaOutcome(cibaState) ? "ciba-outcome" : undefined}
            >
              {cibaBusy ? "Sending the approval request." : cibaMessageText}
            </RunStatus>
            {emailPending && (
              <div role="status">
                {emailSent && (
                  <p className="pu-note" data-testid="ciba-email-sent">
                    Approval email sent to {cibaState.loginHint} over the in-process SMTP sink. Open the one-time link in the email to approve or deny — this page polls until it is answered.
                  </p>
                )}
              </div>
            )}
            {cibaError && <p className="pfai-error" role="alert">{cibaError}</p>}
          </Card>
          {cibaState?.trace?.length > 0 && (
            <Card tone={cibaState.state === "approved" ? "ok" : cibaState.state === "pending" ? "live" : "neutral"} title="Proof: what was sent and what came back" data-testid="ciba-proof">
              <div className="pu-status-line"><StatusChip tone={cibaTone(cibaState)}>{cibaWord(cibaState, cibaMock) || "Captured"}</StatusChip></div>
              <TraceSequenceDiagram steps={cibaState.trace} testId="ciba-sequence" />
              <ul className="pfai-points">
                {cibaProofPoints(cibaState).map((point) => <li key={point}>{point}</li>)}
              </ul>
              <ProtocolTrace steps={cibaState.trace} explain={CIBA_EXPLAIN} />
            </Card>
          )}
        </FlowSection>

        <PfDcrSection ready={features.dcr} checked={statusKnown} lead={lead === "dcr"} />

        <PfTokenExchangeSection provider={provider} lead={lead === "delegation"} />

        <PfDpopSection ready={features.rarDpop} result={rarResult} checked={statusKnown} lead={lead === "dpop"} />

        <PfPiFlowSection lead={lead === "piflow"} />

        <Card tone="neutral" className="pfai-note">
          <p><strong>OAuth and JWT only.</strong> Browser responses contain status and safe provenance. Access tokens, ID-JAGs, codes, and PKCE verifiers remain in the BFF or PingFederate.</p>
        </Card>
      </PageFrame>

      <DraggableModal
        isOpen={phoneOpen}
        onClose={() => setPhoneClosed(true)}
        title="Mock phone"
        defaultWidth={360}
        defaultHeight={640}
        storageKey="pf-ai-agent-mock-phone"
      >
        {/* dm-scroll: `dm-body` is bare by contract — no padding, no scroll. */}
        <div ref={phoneRef} className="dm-scroll pfai-phone-wrap" data-testid={phoneChannel === "web" ? "ciba-web-approver" : "ciba-mock-phone"}>
          <div className="pfai-phone">
            <div className="pfai-phone__screen">
              <div className="pfai-phone__island" aria-hidden="true" />
              <div className="pfai-phone__clock" aria-hidden="true">
                <span className="pfai-phone__date">Lock screen</span>
                <span className="pfai-phone__time">9:41</span>
              </div>
              <div className="pfai-phone__card">
                <p className="pfai-phone__app">
                  <span className="pfai-phone__icon" aria-hidden="true">P</span>
                  PingOne MFA (mock)
                  <span className="pfai-phone__now">now</span>
                </p>
                <h3>Approve this request?</h3>
                <p>An AI agent is asking {cibaState?.loginHint} to approve it.</p>
                {cibaState?.bindingMessage && <p className="pfai-phone__message">{cibaState.bindingMessage}</p>}
              </div>
              <div className="pfai-phone__actions">
                <button className="pfai-phone__btn pfai-phone__btn--approve" type="button" onClick={() => answerOnPhone("approve")}>{phoneLabel("approve")}</button>
                <button className="pfai-phone__btn" type="button" onClick={() => answerOnPhone("deny")}>{phoneLabel("deny")}</button>
              </div>
              <div className="pfai-phone__home" aria-hidden="true" />
            </div>
          </div>
        </div>
      </DraggableModal>
    </PingPage>
  );
}

// One button element carries the primary class, so the pattern check counts exactly one primary on this page.
function PfButton({ lead, ...rest }) {
  return <button className={lead ? "pu-btn pu-btn--primary" : "pu-btn"} type="button" {...rest} />;
}
