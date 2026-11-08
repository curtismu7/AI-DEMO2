// /delegated-commerce — the guided delegated-agent lifecycle (register, delegate, approve, revoke).
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the
// shared primitives (components/pingUi, styles/ping-ui.css, docs/ping-ui-primitives.md): P2 banner first,
// P3 frame and sections, P4 cards, P5 key-value lists, P7 chips that carry a word, P9 buttons. The shell bar is
// not added (the app has its own).
//
// P9, exactly one primary button per view state. The primary is ONE button at the foot of the workspace card;
// `primary` below decides its label and action from the page state, so it is the same element across steps
// (keyboard focus stays on it when a step completes and the next one starts). Everything else is a bordered
// secondary. While the consent dialog is open the dialog holds the one primary and this button drops to secondary.
//   step 1, admin, nothing created      -> Create in PingOne
//   step 1, admin, created, no consent  -> Hand claim code to customer (switches persona; the rail keeps its own
//                                          "Switch to customer" button)
//   step 1, customer, no agent claimed  -> Claim agent
//   step 1, customer, agent not active  -> Review scoped consent
//   step 1, consent active (either)     -> Continue to step 2
//   step 2, not called                  -> Call list_orders as agent
//   step 2, called                      -> Continue to step 3
//   step 3, not started                 -> Checkout $600 headphones
//   step 3, approval pending            -> Open approval page (new tab)
//   step 3, approved                    -> Continue to step 4
//   step 4, access still live           -> Revoke agent access
//   step 4, revoked                     -> Start over
//
// A button that cannot act (busy, missing input) takes aria-disabled and ignores the click, so keyboard focus stays
// where it is. Steps 2 and 3 do not jump ahead when they finish: the result stays on the step that produced it and
// the primary becomes "Continue to step 3 / 4". Results are kept per step, so one step never shows another's output.
// The primary ignores auto-repeat Enter, and the one that leaves the page (hand over to the customer) ignores a
// press for a moment after it appears, so a held or doubled Enter on "Create in PingOne" cannot chain into it.

import React from "react";
import useDividerDrag from "../hooks/useDividerDrag";
import "./DelegatedCommercePage.css";
import apiClient from "../services/apiClient";
import { callMcpTool } from "../services/demoAgentService";
import TokenChainTraceRail from "../components/TokenChainTraceRail";
import DraggableModal from "../components/DraggableModal";
import PageHeader from "../components/common/PageHeader";
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from "../components/pingUi";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { notifyError, notifyInfo, notifySuccess } from "../utils/appToast";
import { startRoleSwitch } from "../utils/roleSwitch";
import { useThemeOptional } from "../context/ThemeContext";
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import {
  DELEGATED_COMMERCE_EDGES, DELEGATED_COMMERCE_GROUPS, DELEGATED_COMMERCE_NODES, DELEGATED_COMMERCE_STEPS,
} from "../config/delegatedCommerceDiagram";

const CLAIM_CODE_KEY = "delegated-commerce-claim-code";

const STEPS = [
  { title: "Register + consent", detail: "Create a new agent app, bind it, and choose scopes." },
  { title: "Protected MCP call", detail: "Run list_orders with the delegated token." },
  { title: "Human approval", detail: "Checkout crosses policy and waits for approval by mock phone or email." },
  { title: "Self-service revoke", detail: "Revoke, retry, and prove immediate denial." },
];

function parseToolResult(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// A button that cannot act right now keeps keyboard focus: aria-disabled and no handler, never `disabled`.
const act = (disabled, onClick) => (disabled ? { "aria-disabled": "true" } : { onClick });

// The word on the chip that sits beside a result sentence. null = the sentence is not a verdict.
function resultChip(result) {
  if (/^Confirmed denied/.test(result)) return { tone: "ok", word: "Denied" };
  if (/^Unexpected/.test(result)) return { tone: "danger", word: "Not denied" };
  if (/without a human gate/.test(result)) return { tone: "warn", word: "No gate" };
  if (/after human approval/.test(result)) return { tone: "ok", word: "Approved" };
  return null;
}

// Where the approval chip stands: nothing started, the in-process simulated engine, or the PingOne engine.
function approvalChip(ciba) {
  if (!ciba) return { tone: "neutral", word: "Mock phone or email" };
  if (ciba.engine === "simulated") return { tone: "warn", word: "Mock approval" };
  return { tone: "info", word: "PingOne approval" };
}

export default function DelegatedCommercePage({ user }) {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  // Ranges are capped so the three columns always fit the 1100px frame (the workspace keeps at least 300px).
  const { size: seqWidth, handleProps: seqHandleProps } = useDividerDrag({
    min: 220,
    max: 300,
    initial: 250,
    storageKey: "dcp-sequence-width",
  });
  const { size: proofWidth, handleProps: proofHandleProps } = useDividerDrag({
    min: 310,
    max: 420,
    initial: 350,
    storageKey: "dcp-proof-width",
    invert: true, // proof rail sits right of its divider
  });
  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = React.useState(null);
  const agentHostRef = React.useCallback((node) => setAgentHostEl(node), []);
  const isAdmin = user?.role === "admin" || user?.isAdmin === true;

  const [activeStep, setActiveStep] = React.useState(0);
  const [completed, setCompleted] = React.useState([]);
  const [busy, setBusy] = React.useState("");
  const [registration, setRegistration] = React.useState(null);
  const [claimCode, setClaimCode] = React.useState(
    () => window.sessionStorage.getItem(CLAIM_CODE_KEY) || "",
  );
  const [scopes, setScopes] = React.useState(["read", "write"]);
  const [consentOpen, setConsentOpen] = React.useState(false);
  const [evidence, setEvidence] = React.useState({});
  // Results are kept per step index so one step never shows another step's output.
  const [results, setResults] = React.useState({});
  const setStepResult = React.useCallback((step, value) => {
    setResults((current) => ({ ...current, [step]: value }));
  }, []);
  const [ciba, setCiba] = React.useState(null);
  const pollTimerRef = React.useRef(null);
  // Bumped by Reset and on unmount. A checkout / poll started under an older token drops its result.
  const runTokenRef = React.useRef(0);
  const primaryRef = React.useRef(null);
  const consentWasOpen = React.useRef(false);
  const consentFirstFieldRef = React.useRef(null);
  const handoverReadyAt = React.useRef(0);

  React.useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((current) => (current === agentHostEl ? null : current));
  }, [agentHostEl, setSurfaceHostEl]);

  React.useEffect(() => {
    Promise.all([
      apiClient.post("/api/verticals/active", { id: "retail" }),
      apiClient.get("/api/delegated-commerce/status"),
    ])
      .then(([, status]) => {
        if (status.data?.registration) {
          setRegistration(status.data.registration);
          setScopes(status.data.scopes || []);
          if (status.data.authorized) setCompleted([0]);
        }
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => () => {
    runTokenRef.current += 1;
    window.clearTimeout(pollTimerRef.current);
  }, []);

  // The consent dialog opened: DraggableModal is shared and does not move focus, so it would stay on the page button
  // behind the dialog. Put it on the first scope checkbox. When the dialog closes and focus falls to the body, hand it
  // back to the page's primary button.
  React.useEffect(() => {
    if (consentOpen) {
      consentWasOpen.current = true;
      consentFirstFieldRef.current?.focus();
      return;
    }
    if (!consentWasOpen.current) return;
    consentWasOpen.current = false;
    const focused = document.activeElement;
    if ((!focused || focused === document.body) && primaryRef.current) primaryRef.current.focus();
  }, [consentOpen]);

  // `advance: false` marks the step done but stays on it, so its result is seen where it was produced.
  const markComplete = React.useCallback((step, { advance = true } = {}) => {
    setCompleted((current) => [...new Set([...current, step])]);
    if (advance) setActiveStep((current) => Math.min(3, Math.max(current, step + 1)));
  }, []);

  const registerAgent = async () => {
    setBusy("register");
    try {
      const response = await apiClient.post("/api/delegated-commerce/register", {
        name: "AF Personal Shopping Agent",
      });
      const data = response.data;
      setRegistration(data.registration);
      setClaimCode(data.claimCode);
      window.sessionStorage.setItem(CLAIM_CODE_KEY, data.claimCode);
      setEvidence((current) => ({ ...current, registration: data.actorToken }));
      notifySuccess("Agent application created and verified in PingOne.");
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Registration failed.");
    } finally {
      setBusy("");
    }
  };

  const claimAgent = async () => {
    setBusy("claim");
    try {
      const response = await apiClient.post("/api/delegated-commerce/claim", { claimCode });
      setRegistration(response.data.registration);
      setConsentOpen(true);
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Claim failed.");
    } finally {
      setBusy("");
    }
  };

  const authorizeAgent = async () => {
    setBusy("consent");
    try {
      const response = await apiClient.post("/api/delegated-commerce/consent", { scopes });
      setRegistration(response.data.registration);
      setEvidence((current) => ({
        ...current,
        consent: {
          delegationId: response.data.delegationId,
          scopes: response.data.registration.scopes,
        },
      }));
      setConsentOpen(false);
      window.sessionStorage.removeItem(CLAIM_CODE_KEY);
      markComplete(0);
      notifySuccess("Scoped consent is active.");
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Consent failed.");
    } finally {
      setBusy("");
    }
  };

  const callOrders = async () => {
    setBusy("orders");
    setStepResult(1, "");
    try {
      const response = await callMcpTool("list_orders", {}, { vertical: "retail" });
      if (response.result?.error) {
        throw new Error(response.result.error_description || response.result.message || response.result.error);
      }
      const parsed = parseToolResult(response.result);
      setStepResult(1, JSON.stringify(parsed, null, 2));
      const exchanged = response.tokenEvents?.find((event) =>
        ["two-ex-final-token", "mcp-access-token"].includes(event.id),
      );
      setEvidence((current) => ({ ...current, exchange: exchanged || { status: "completed" } }));
      markComplete(1, { advance: false });
    } catch (err) {
      setStepResult(1, err.message || "Protected MCP call failed.");
      notifyError(err.message || "Protected MCP call failed.");
    } finally {
      setBusy("");
    }
  };

  const postCheckout = React.useCallback(async () => {
    try {
      const response = await callMcpTool(
        "checkout",
        { product: "Headphones", amount: 600 },
        { vertical: "retail", useCaseId: "ciba-out-of-band-approval" },
      );
      const error = response.result?.error;
      if (error) return { ok: false, error, message: response.result.error_description || response.result.message };
      return { ok: true, response };
    } catch (err) {
      return {
        ok: false,
        error: err.code || err.response?.data?.error,
        message: err.message,
        status: err.statusCode || err.response?.status,
      };
    }
  }, []);

  const pollCiba = React.useCallback((authReqId, intervalMs, token) => {
    pollTimerRef.current = window.setTimeout(async () => {
      if (token !== runTokenRef.current) return;
      try {
        const response = await apiClient.get(`/api/auth/ciba/poll/${authReqId}`);
        if (token !== runTokenRef.current) return;
        setCiba((current) => ({ ...current, ...response.data }));
        if (response.data.status === "approved") {
          const retry = await postCheckout();
          if (token !== runTokenRef.current) return;
          if (!retry.ok) throw new Error(retry.message || retry.error || "Checkout retry failed.");
          setStepResult(2, "Checkout completed after human approval.");
          markComplete(2, { advance: false });
          setBusy("");
          return;
        }
        pollCiba(authReqId, intervalMs, token);
      } catch (err) {
        if (token !== runTokenRef.current) return;
        setBusy("");
        notifyError(err.response?.data?.message || err.message || "Approval polling failed.");
      }
    }, intervalMs);
  }, [markComplete, postCheckout, setStepResult]);

  const checkout = async () => {
    const token = ++runTokenRef.current;
    setBusy("checkout");
    setStepResult(2, "");
    const initial = await postCheckout();
    if (token !== runTokenRef.current) return;
    const gated = initial.status === 428 || [
      "mcp_step_up_required",
      "mcp_hitl_required",
      "step_up_required",
      "hitl_required",
    ].includes(initial.error);
    if (!gated) {
      if (initial.ok) {
        setStepResult(2, "Checkout completed without a human gate; verify the active policy threshold.");
      } else {
        notifyError(initial.message || initial.error || "Checkout failed.");
      }
      setBusy("");
      return;
    }
    try {
      const response = await apiClient.post("/api/auth/ciba/initiate", {
        binding_message: "Approve your $600 headphones purchase",
        amount: 600,
        tool: "checkout",
      });
      if (token !== runTokenRef.current) return;
      const request = response.data;
      setCiba({ ...request, status: "pending" });
      setEvidence((current) => ({
        ...current,
        approval: { requestId: request.auth_req_id, engine: request.engine },
      }));
      pollCiba(request.auth_req_id, Math.max(1000, (request.interval || 5) * 1000), token);
    } catch (err) {
      if (token !== runTokenRef.current) return;
      setBusy("");
      notifyError(err.response?.data?.message || err.message || "Could not start approval.");
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    try {
      const response = await apiClient.post("/api/delegated-commerce/revoke", {
        reason: "Customer ended shopping-agent access",
      });
      let retry;
      let denied = false;
      try {
        const retryResponse = await callMcpTool("list_orders", {}, { vertical: "retail" });
        if (retryResponse.result?.error) {
          denied = true;
          retry = `Confirmed denied: ${
            retryResponse.result.error_description ||
            retryResponse.result.message ||
            retryResponse.result.error
          }`;
        } else {
          retry = "Unexpected: the protected call still succeeded.";
        }
      } catch (err) {
        denied = true;
        retry = `Confirmed denied: ${err.code || err.message}`;
      }
      setEvidence((current) => ({
        ...current,
        revocation: { auditId: response.data.auditId, retry },
      }));
      setStepResult(3, retry);
      setRegistration(response.data.registration);
      if (denied) {
        markComplete(3);
      } else {
        notifyError(retry);
      }
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Revocation failed.");
    } finally {
      setBusy("");
    }
  };

  const preflight = async () => {
    setBusy("preflight");
    try {
      const [status, cibaStatus] = await Promise.all([
        apiClient.get("/api/delegated-commerce/status"),
        apiClient.get("/api/auth/ciba/status"),
      ]);
      setEvidence((current) => ({
        ...current,
        preflight: {
          session: user?.email || user?.username || "authenticated",
          registration: status.data.registration?.status || "not claimed",
          ciba: cibaStatus.data.engine,
          failoverMode: cibaStatus.data.failoverMode,
        },
      }));
      notifySuccess("Preflight checks completed.");
    } catch (err) {
      notifyError(err.message || "Preflight failed.");
    } finally {
      setBusy("");
    }
  };

  const runCurrent = () => {
    if (activeStep === 0) {
      if (isAdmin && !registration) return registerAgent();
      if (!isAdmin && !registration) return claimAgent();
      if (!isAdmin && registration?.status !== "active") return setConsentOpen(true);
      // Nothing left to run in this step: say so and point at what comes next, instead of doing nothing.
      return notifyInfo(
        consentActive
          ? "Step 1 is done. Use Continue to step 2."
          : "The agent is created. Hand the claim code to the customer to finish step 1.",
      );
    }
    if (activeStep === 1) return callOrders();
    if (activeStep === 2) return checkout();
    return revoke();
  };

  const reset = () => {
    // Cancel an approval that is still being polled: no later retry, and the controls come back.
    runTokenRef.current += 1;
    window.clearTimeout(pollTimerRef.current);
    setBusy("");
    window.sessionStorage.removeItem(CLAIM_CODE_KEY);
    setActiveStep(0);
    setCompleted([]);
    setResults({});
    setCiba(null);
    setEvidence({});
  };

  const approvalUrl = ciba?.auth_req_id
    ? `/ciba-approve?authReqId=${encodeURIComponent(ciba.auth_req_id)}`
    : "";
  const openApproval = () => window.open(approvalUrl, "_blank", "noopener,noreferrer");

  const consentActive = registration?.status === "active";
  const revoked = registration?.status === "revoked";
  const approvalPending = ciba?.status === "pending" && !!approvalUrl;

  const switchPersona = () => startRoleSwitch(isAdmin ? "customer" : "admin", "/delegated-commerce");

  const HANDOVER_SETTLE_MS = 800;

  // The one primary button for this view state (see the table at the top of the file). `off` = cannot act now.
  const primary = (() => {
    if (activeStep === 0) {
      if (consentActive) return { label: "Continue to step 2", run: () => setActiveStep(1) };
      if (isAdmin) {
        return registration
          ? { label: "Hand claim code to customer", run: switchPersona, settle: true }
          : { label: "Create in PingOne", run: registerAgent, off: busy === "register" };
      }
      return registration
        ? { label: "Review scoped consent", run: () => setConsentOpen(true) }
        : { label: "Claim agent", run: claimAgent, off: !claimCode || busy === "claim" };
    }
    if (activeStep === 1) {
      return completed.includes(1)
        ? { label: "Continue to step 3", run: () => setActiveStep(2) }
        : { label: "Call list_orders as agent", run: callOrders, off: !!busy };
    }
    if (activeStep === 2) {
      if (completed.includes(2)) return { label: "Continue to step 4", run: () => setActiveStep(3) };
      if (approvalPending) return { label: "Open approval page (new tab)", run: openApproval };
      return {
        label: busy === "checkout" ? "Starting checkout..." : "Checkout $600 headphones",
        run: checkout,
        off: !!busy,
      };
    }
    return revoked
      ? { label: "Start over", run: reset }
      : { label: "Revoke agent access", run: revoke, off: !!busy };
  })();

  // A primary that leaves the page ignores presses for a moment after it first appears, and every primary ignores the
  // auto-repeat of a held Enter, so Create in PingOne followed by a held or doubled Enter cannot chain into it.
  const primaryLabelRef = React.useRef(primary.label);
  if (primaryLabelRef.current !== primary.label) {
    primaryLabelRef.current = primary.label;
    handoverReadyAt.current = primary.settle ? Date.now() + HANDOVER_SETTLE_MS : 0;
  }
  const primaryAction = () => {
    if (primary.settle && Date.now() < handoverReadyAt.current) return;
    primary.run();
  };
  const primaryProps = primary.off
    ? { "aria-disabled": "true" }
    : { onClick: primaryAction };

  const result = results[activeStep] || "";
  const approval = approvalChip(ciba);
  const stepChip = result ? resultChip(result) : null;
  // Step 3 card edge: grey until an approval is requested, then amber for the simulated engine, blue for PingOne.
  const workspaceTone = activeStep === 2
    ? (!ciba ? "neutral" : ciba.engine === "simulated" ? "warn" : "live")
    : "live";

  const proofItems = [
    {
      key: "registration",
      label: "Agent registration",
      done: !!evidence.registration,
      detail: evidence.registration ? evidence.registration.clientId : "Waiting for a new PingOne client.",
    },
    {
      key: "consent",
      label: "User consent",
      done: !!evidence.consent,
      detail: evidence.consent ? evidence.consent.scopes.join(", ") : "Waiting for scope selection.",
    },
    {
      key: "exchange",
      label: "RFC 8693 exchange",
      done: !!evidence.exchange,
      detail: evidence.exchange ? "Subject and actor evidence captured." : "Will prove subject + actor.",
    },
    {
      key: "approval",
      label: "Human approval",
      done: !!evidence.approval,
      detail: evidence.approval ? `${evidence.approval.engine}: ${evidence.approval.requestId}` : "Execution mode shown explicitly.",
    },
    {
      key: "revocation",
      label: "Revocation proof",
      done: !!evidence.revocation,
      detail: evidence.revocation?.retry || "Retry and audit close the lifecycle.",
    },
  ];

  return (
    <PingPage className="dcom-page">
      <SimBanner data-testid="dcom-banner">
        <strong>MIXED: LIVE CALLS, MOCK APPROVAL</strong> — Creating the agent, the protected list_orders call and
        revocation are real calls from this page to the demo server, against the PingOne environment it is
        configured for; whatever the server answers is shown as the result. The approval in step 3 is out-of-band by
        mock phone or email only: the approval page stands in for the approver&apos;s phone, and nothing is ever
        pushed to a real phone. The AI-agent registration profile is a demo pattern over a standard OAuth
        application, not a product feature.
      </SimBanner>
      <PageHeader
        eyebrow="Agentic AI / Delegated-Agent Commerce"
        title="Register. Delegate. Approve. Revoke."
        summary="A single guided workspace for proving the complete delegated-agent lifecycle."
        actions={(
          <div className="pu-actions">
            <button className="pu-btn" type="button" {...act(!!busy, preflight)}>Run preflight</button>
            <button className="pu-btn" type="button" onClick={reset}>Reset view</button>
            <button className="pu-btn" type="button" {...act(!!busy, runCurrent)}>{busy ? "Running..." : "Run current step"}</button>
            <button
              type="button"
              onClick={toggleDarkMode}
              className="pu-btn"
              title="Switch this page between light and dark"
              aria-pressed={darkMode}
            >
              {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
            </button>
          </div>
        )}
      />
      <PageFrame>
        <Section
          id="dcom-truth"
          kicker="1 · What is real"
          title="Building blocks, a demo pattern and the approval mode"
        >
          <Card tone="neutral" className="dcom-truth" data-testid="dcom-truth">
            <KvList
              items={[
                {
                  label: "Building blocks",
                  value: (
                    <>
                      <StatusChip tone="ok">GA building blocks</StatusChip>{" "}
                      OAuth app, scopes, token exchange, protected API, revocation
                    </>
                  ),
                },
                {
                  label: "Registration",
                  value: (
                    <>
                      <StatusChip tone="warn">Demo pattern</StatusChip>{" "}
                      AI-agent registration profile
                    </>
                  ),
                },
                {
                  label: "Approval",
                  value: (
                    <>
                      <StatusChip tone={approval.tone}>{approval.word}</StatusChip>{" "}
                      Approved by mock phone or email, never a push to a real phone
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </Section>

        <Section
          id="dcom-run"
          kicker="2 · Run the lifecycle"
          title="Four steps, one proof trail"
          lede="Work through the steps in order. Each step has one main action; the proof rail records the evidence as you go."
        >
          <div className="dcom-layout-wrap">
            <div
              className="dcom-layout"
              style={{ "--dcom-seq-w": `${seqWidth}px`, "--dcom-proof-w": `${proofWidth}px` }}
            >
              <Card tone="neutral" className="dcom-sequence">
                <div className="dcom-card-head">
                  <h3 className="pu-h3">Guided sequence</h3>
                  <StatusChip tone="info">{completed.length} of 4</StatusChip>
                </div>
                <ol className="dcom-steps">
                  {STEPS.map((step, index) => (
                    <li key={step.title}>
                      <button
                        type="button"
                        className={`dcom-step ${activeStep === index ? "dcom-step--active" : ""}`}
                        aria-current={activeStep === index ? "step" : undefined}
                        onClick={() => setActiveStep(index)}
                      >
                        <span className="dcom-step-number" aria-hidden="true">{completed.includes(index) ? "✓" : index + 1}</span>
                        <span className="dcom-step-text">
                          <strong>{step.title}</strong>
                          <small>{step.detail}</small>
                          {completed.includes(index) && <StatusChip tone="ok">Done</StatusChip>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="dcom-persona">
                  <strong>Current persona: {isAdmin ? "Administrator" : "Customer"}</strong>
                  <button
                    type="button"
                    className="pu-btn"
                    onClick={switchPersona}
                  >
                    Switch to {isAdmin ? "customer" : "administrator"}
                  </button>
                </div>
              </Card>

              <div className="divider-drag-handle" aria-label="Resize sequence rail" {...seqHandleProps} />

              <Card tone={workspaceTone} className="dcom-workspace" data-testid="dcom-workspace">
                <div className="dcom-card-head" aria-live="polite">
                  <h3 className="pu-h3">Step {activeStep + 1} workspace</h3>
                  <StatusChip tone={completed.includes(activeStep) ? "ok" : "neutral"}>
                    {completed.includes(activeStep) ? "Complete" : "Ready"}
                  </StatusChip>
                </div>

                {activeStep === 0 && (
                  <div className="dcom-workspace-body">
                    <div className="dcom-title-row">
                      <div>
                        <h4 className="dcom-step-title">Create and authorize a new shopping agent</h4>
                        <p>The client secret remains server-side.</p>
                      </div>
                      <div className="dcom-chips">
                        <StatusChip tone="ok">GA building blocks</StatusChip>
                        <StatusChip tone="info">Live</StatusChip>
                      </div>
                    </div>
                    <p className="pu-note pu-empty"><strong>Availability note:</strong> This creates a standard PingOne OAuth/OIDC application representing an agent. A dedicated AI-agent registry is presented as a demo pattern.</p>
                    {isAdmin ? (
                      <div className="dcom-subcard">
                        <h5 className="dcom-sub-title">1A. Register the agent application</h5>
                        <label className="dcom-field">
                          <span className="pu-label">Agent display name</span>
                          <input value="AF Personal Shopping Agent" readOnly />
                        </label>
                        {registration && (
                          <div className="dcom-outcome">
                            <p className="pu-status-line"><StatusChip tone="ok">Created</StatusChip><strong>Agent application created and verified</strong></p>
                            <KvList
                              items={[
                                { label: "client_id", value: registration.applicationId, mono: true },
                                { label: "claim code", value: claimCode, mono: true },
                                { label: "secret", value: "Held server-side; never returned" },
                              ]}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="dcom-subcard">
                        <h5 className="dcom-sub-title">1B. Claim and authorize the agent</h5>
                        {!registration && (
                          <>
                            <p className="dcom-claim-code-help">
                              The administrator receives this one-time code after completing 1A. Ask them to create the agent and share the displayed code before claiming it.
                            </p>
                            <label className="dcom-field">
                              <span className="pu-label">One-time agent claim code</span>
                              <input value={claimCode} onChange={(event) => setClaimCode(event.target.value)} />
                            </label>
                          </>
                        )}
                        {consentActive && (
                          <div className="dcom-outcome">
                            <p className="pu-status-line"><StatusChip tone="ok">Active</StatusChip><strong>Scoped consent active</strong></p>
                            <p className="pu-note">{registration.scopes.join(", ")}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeStep === 1 && (
                  <div className="dcom-workspace-body">
                    <div className="dcom-title-row">
                      <div>
                        <h4 className="dcom-step-title">Call a protected MCP tool</h4>
                        <p>Run list_orders through RFC 8693 and PingOne Authorize.</p>
                      </div>
                      <div className="dcom-chips"><StatusChip tone="info">Live</StatusChip></div>
                    </div>
                    {result && <pre className="dcom-result">{result}</pre>}
                  </div>
                )}

                {activeStep === 2 && (
                  <div className="dcom-workspace-body">
                    <div className="dcom-title-row">
                      <div>
                        <h4 className="dcom-step-title">Require human approval</h4>
                        <p>A $600 checkout crosses the configured policy threshold. The approver answers by mock phone or email, never a real phone push.</p>
                      </div>
                      <div className="dcom-chips"><StatusChip tone={approval.tone}>{approval.word}</StatusChip></div>
                    </div>
                    {ciba && (
                      <div className="dcom-outcome">
                        <p className="pu-status-line">
                          <StatusChip tone={ciba.status === "approved" ? "ok" : "warn"}>{ciba.status === "approved" ? "Approved" : "Pending"}</StatusChip>
                          <strong>Approval {ciba.status}</strong>
                        </p>
                        <KvList
                          items={[
                            { label: "Engine", value: ciba.engine },
                            { label: "Request", value: ciba.auth_req_id, mono: true },
                          ]}
                        />
                      </div>
                    )}
                    {result && (
                      <p className="pu-status-line dcom-status">
                        {stepChip && <StatusChip tone={stepChip.tone}>{stepChip.word}</StatusChip>}
                        <span>{result}</span>
                      </p>
                    )}
                  </div>
                )}

                {activeStep === 3 && (
                  <div className="dcom-workspace-body">
                    <div className="dcom-title-row">
                      <div>
                        <h4 className="dcom-step-title">Revoke delegated access</h4>
                        <p>The customer ends consent, then the page retries list_orders.</p>
                      </div>
                      <div className="dcom-chips"><StatusChip tone="info">Live</StatusChip></div>
                    </div>
                    {result && (
                      <p className="pu-status-line dcom-status">
                        {stepChip && <StatusChip tone={stepChip.tone}>{stepChip.word}</StatusChip>}
                        <span>{result}</span>
                      </p>
                    )}
                    {evidence.revocation?.auditId && <a className="dcom-link" href={`/audit?agentId=${registration.applicationId}`}>View audit evidence</a>}
                  </div>
                )}

                <div className="pu-actions dcom-actionbar">
                  <button
                    className={consentOpen ? "pu-btn" : "pu-btn pu-btn--primary"}
                    type="button"
                    data-testid="dcom-primary"
                    ref={primaryRef}
                    onKeyDown={(event) => { if (event.repeat && event.key === "Enter") event.preventDefault(); }}
                    {...primaryProps}
                  >
                    {primary.label}
                  </button>
                </div>
              </Card>

              <div className="divider-drag-handle" aria-label="Resize proof rail" {...proofHandleProps} />

              <aside className="dcom-proof" aria-label="Agent and proof">
                <Card tone="neutral" className="dcom-agent-card">
                  <div className="dcom-card-head">
                    <h3 className="pu-h3">Agent + proof</h3>
                    <StatusChip tone="neutral">Docked</StatusChip>
                  </div>
                  <div className="dcom-agent-host" ref={agentHostRef} />
                </Card>
                <Card tone="neutral" className="dcom-proof-card" title="Token and policy chain">
                  <ol className="dcom-proof-list">
                    {proofItems.map((item) => (
                      <li key={item.key} className={item.done ? "dcom-proof-item dcom-proof-item--active" : "dcom-proof-item"}>
                        <span className="dcom-proof-head">
                          <strong>{item.label}</strong>
                          <StatusChip tone={item.done ? "ok" : "neutral"}>{item.done ? "Captured" : "Waiting"}</StatusChip>
                        </span>
                        <small>{item.detail}</small>
                      </li>
                    ))}
                  </ol>
                </Card>
                <Card tone="neutral" className="dcom-trace"><TokenChainTraceRail /></Card>
              </aside>
            </div>
          </div>
        </Section>

        <Section
          id="dcom-diagram"
          kicker="3 · How it fits together"
          title="Who talks to whom"
        >
          <EmbeddedFlowDiagram
            testId="dcom-lifecycle-diagram"
            title="Delegated-agent lifecycle, end to end"
            ariaLabel="Delegated-agent lifecycle diagram"
            diagramLabel="Register, consent, protected call, approval and revoke for a delegated shopping agent"
            lede="Who talks to whom in each of the four steps above: the administrator and customer, the demo routes, PingOne, and the MCP gateway."
            config={{ GROUPS: DELEGATED_COMMERCE_GROUPS, NODES: DELEGATED_COMMERCE_NODES, EDGES: DELEGATED_COMMERCE_EDGES, STEPS: DELEGATED_COMMERCE_STEPS }}
            pingStyle
          />
        </Section>
      </PageFrame>

      <ConsentModal
        open={consentOpen}
        scopes={scopes}
        onScopesChange={setScopes}
        onClose={() => setConsentOpen(false)}
        onConfirm={authorizeAgent}
        busy={busy === "consent"}
        firstFieldRef={consentFirstFieldRef}
      />
    </PingPage>
  );
}

function ConsentModal({ open, scopes, onScopesChange, onClose, onConfirm, busy, firstFieldRef }) {
  const toggle = (scope) => {
    onScopesChange(
      scopes.includes(scope)
        ? scopes.filter((item) => item !== scope)
        : [...scopes, scope],
    );
  };
  return (
    <DraggableModal
      isOpen={open}
      onClose={onClose}
      title="Authorize AF Personal Shopping Agent"
      storageKey="delegated-commerce-consent"
      defaultWidth={560}
      defaultHeight={500}
      footer={
        <div className="dcom-modal-actions">
          <button className="dcom-modal-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          {/* The dialog is outside .pu-page, so it carries its own copy of the fixed Ping Red primary. */}
          <button
            className="dcom-modal-btn dcom-modal-btn--confirm"
            type="button"
            {...act(busy || scopes.length === 0, onConfirm)}
          >
            {busy ? "Authorizing..." : "Authorize selected scopes"}
          </button>
        </div>
      }
    >
      {/* dm-scroll: `dm-body` is bare by contract — no padding, no scroll. */}
      <div className="dm-scroll">
      <p className="dcom-modal-copy">
        This agent can act only within the permissions selected below. Sensitive
        purchases still require human approval.
      </p>
      <label className="dcom-scope">
        <input
          type="checkbox"
          ref={firstFieldRef}
          checked={scopes.includes("read")}
          onChange={() => toggle("read")}
        />
        <span><strong>Read my orders</strong><small>Allows list_orders using the read scope.</small></span>
      </label>
      <label className="dcom-scope">
        <input
          type="checkbox"
          checked={scopes.includes("write")}
          onChange={() => toggle("write")}
        />
        <span><strong>Place purchases</strong><small>Allows checkout using the write scope; policy approval still applies.</small></span>
      </label>
      </div>
    </DraggableModal>
  );
}
