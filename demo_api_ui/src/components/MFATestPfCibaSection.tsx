import { FC, useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";

type Phase = "idle" | "starting" | "pending" | "approved" | "denied" | "expired" | "error";

interface Features {
  ciba?: boolean;
  cibaMock?: boolean;
  cibaWebApprover?: boolean;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  starting: "Starting…",
  pending: "Waiting for approval",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  error: "Error",
};

// Same status vocabulary as MFATestCard / MFATestCibaSection.
const CARD_STATUS: Record<Phase, "pending" | "running" | "passed" | "failed"> = {
  idle: "pending",
  starting: "running",
  pending: "running",
  approved: "passed",
  denied: "failed",
  expired: "failed",
  error: "failed",
};
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };

// Same wording as PingFederateAiAgentPage's CIBA_ERRORS (not exported there).
const START_ERRORS: Record<string, string> = {
  PF_AI_CIBA_USER_UNKNOWN: "PingFederate does not know that user.",
  PF_AI_FLOW_ALREADY_PENDING: "An approval request is already pending.",
  PF_AI_CIBA_BINDING_MESSAGE_INVALID: "The message may only use letters, digits and . _ + / ! ? # -, up to 20 characters, with no spaces.",
  PF_AI_CIBA_USER_REQUIRED: "Enter the user to ask.",
  PF_AI_CIBA_UNREACHABLE: "PingFederate could not be reached.",
};

const POLL_MS = 2000;

/**
 * PingFederate's own CIBA (not the PingOne CIBA cards): the BFF starts the backchannel request at
 * PingFederate and polls its token endpoint; the page polls the BFF. The demo web approver (or mock
 * phone) stands in for the user's device and is answered with the Approve / Deny buttons here.
 */
const MFATestPfCibaSection: FC = () => {
  const [features, setFeatures] = useState<Features | null>(null);
  const [hint, setHint] = useState("");
  const [message, setMessage] = useState("Approve");
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    let live = true;
    apiClient
      .get("/api/pf-ai-agent/status")
      .then(({ data }) => { if (live) setFeatures(data?.features || {}); })
      .catch(() => { if (live) setFeatures({}); });
    return () => { live = false; };
  }, []);

  const stop = useCallback(() => {
    runId.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  // A finished state from the BFF ends the run; anything else keeps it pending.
  const applyState = (data: any) => {
    const s = data?.state;
    if (s === "approved") {
      setPhase("approved");
      setDetail(`PingFederate CIBA approved by ${data.subject || data.loginHint || "the user"}.`);
    } else if (s === "denied") {
      setPhase("denied");
      setDetail("The user denied the request.");
    } else if (s === "expired") {
      setPhase("expired");
      setDetail("The request expired before anyone answered it.");
    } else if (s === "error" || s === "none") {
      setPhase("error");
      setDetail("The approval request failed.");
    } else {
      return false;
    }
    stop();
    return true;
  };

  const poll = (myRun: number) => {
    timer.current = setTimeout(async () => {
      if (myRun !== runId.current) return;
      try {
        const { data } = await apiClient.get("/api/pf-ai-agent/ciba/status");
        if (myRun !== runId.current) return;
        if (!applyState(data)) poll(myRun);
      } catch (err: any) {
        if (myRun !== runId.current) return;
        setPhase("error");
        setDetail(err?.response?.data?.error || err?.message || "Poll failed");
      }
    }, POLL_MS);
  };

  const start = async () => {
    stop();
    const myRun = runId.current;
    setPhase("starting");
    setDetail("");
    try {
      const { data } = await apiClient.post("/api/pf-ai-agent/ciba/start", {
        loginHint: hint.trim() || undefined,
        bindingMessage: message.trim() || undefined,
      });
      if (myRun !== runId.current || applyState(data)) return;
      setPhase("pending");
      poll(myRun);
    } catch (err: any) {
      if (myRun !== runId.current) return;
      const code = err?.response?.data?.error;
      setPhase("error");
      setDetail(START_ERRORS[code] || `Could not start the approval request.${code ? ` Reason: ${code}` : ""}`);
    }
  };

  // Mirrors PingFederateAiAgentPage: web approver if on, else mock phone; mutually exclusive in the BFF.
  const channel = features?.cibaWebApprover ? "web" : features?.cibaMock ? "mock" : null;
  const decide = async (decision: "approve" | "deny") => {
    try {
      if (channel === "web") {
        // The approver authenticator relays this to PingFederate; the next poll sees the answer.
        await apiClient.post("/api/pf-ai-agent/ciba/web-approver/decision", { decision });
      } else {
        const { data } = await apiClient.post("/api/pf-ai-agent/ciba/mock-decision", { decision });
        applyState(data);
      }
    } catch {
      setDetail(channel === "web"
        ? "PingFederate has not asked for approval yet. Try again in a moment."
        : "The mock phone could not answer.");
    }
  };

  // Mock-only stacks still run (the page enables on ciba || cibaMock).
  const enabled = Boolean(features?.ciba || features?.cibaMock);
  const busy = phase === "starting" || phase === "pending";
  const status = CARD_STATUS[phase];

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid="mfa-pfciba">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">/api/pf-ai-agent/ciba/start</code>
          <a
            href="https://docs.pingidentity.com/pingfederate/latest/developers_reference_guide/pf_ciba.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingFederate CIBA"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        PingFederate's own CIBA: the BFF sends the backchannel request to PingFederate and polls its token
        endpoint; this card polls <code>GET /api/pf-ai-agent/ciba/status</code> every 2s.
        {channel === "web" && " PingFederate's demo web-approver authenticator waits for your answer here."}
        {channel === "mock" && " The mock phone answers in the BFF; no PingFederate call is made."}
      </p>

      {features && !enabled && (
        <p className="info-text" data-testid="mfa-pfciba-disabled">
          PingFederate CIBA is not enabled on this stack.
        </p>
      )}

      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">Login hint (PingFederate user; leave empty for the signed-in user)</div>
        <input
          type="text"
          className="otp-input"
          style={{ width: "100%", fontSize: "1rem" }}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="Empty = the signed-in user"
          data-testid="mfa-pfciba-hint"
        />
      </div>
      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">Binding message (letters, digits and . _ + / ! ? # -, max 20, no spaces)</div>
        <input
          type="text"
          className="otp-input"
          style={{ width: "100%", fontSize: "1rem" }}
          value={message}
          maxLength={20}
          onChange={(e) => setMessage(e.target.value)}
          data-testid="mfa-pfciba-message"
        />
      </div>

      <div className="mfa-test-card__actions">
        <button
          type="button"
          className="mfa-test-button mfa-test-button--primary"
          onClick={start}
          disabled={busy || !enabled}
          data-testid="mfa-pfciba-start"
        >
          {busy ? "Waiting…" : "Ask for approval"}
        </button>
        {phase === "pending" && channel && (
          <>
            <button
              type="button"
              className="mfa-test-button mfa-test-button--primary"
              onClick={() => decide("approve")}
              data-testid="mfa-pfciba-approve"
            >
              Approve{channel === "web" ? " (web approver)" : " on mock phone"}
            </button>
            <button
              type="button"
              className="mfa-test-button mfa-test-button--secondary"
              onClick={() => decide("deny")}
              data-testid="mfa-pfciba-deny"
            >
              Deny{channel === "web" ? " (web approver)" : " on mock phone"}
            </button>
          </>
        )}
        {busy && (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--secondary"
            onClick={() => {
              stop();
              setPhase("idle");
            }}
          >
            Cancel
          </button>
        )}
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-pfciba-status">
          {CARD_STATUS_LABEL[status]}: {PHASE_LABEL[phase]}
        </span>
      </div>

      {detail && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
          {status === "passed" && <div className="mfa-test-card__success-badge">Success</div>}
          {status === "passed" ? (
            <div className="mfa-test-card__success-message">{detail}</div>
          ) : (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {detail}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MFATestPfCibaSection;
