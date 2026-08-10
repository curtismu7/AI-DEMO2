import { useEffect, useRef, useState } from "react";
import { resolveApiBaseUrl } from "../utils/resolveApiBaseUrl";
import DraggableModal from "./DraggableModal";
import "./KillSwitchConfirmModal.css";

export default function KillSwitchConfirmModal({
  isOpen,
  agentId,
  onConfirm,
  onCancel,
  initialScope = "instance",
}) {
  const [selectedReason, setSelectedReason] = useState("misbehaving");
  const [customReason, setCustomReason] = useState("");
  const [scope, setScope] = useState(initialScope);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [liveSteps, setLiveSteps] = useState([]);
  const esRef = useRef(null);

  // Re-seed scope from the trigger that opened the modal (e.g. roster's
  // "Stop this instance" vs "Stop entire agent" buttons) each time it opens.
  useEffect(() => {
    if (isOpen) setScope(initialScope);
  }, [isOpen, initialScope]);

  useEffect(() => () => esRef.current?.close(), []);

  // Open the SSE stream just before the POST so each kill-switch step
  // (token_revocation, enforcement_flag, ...) renders as it runs instead of
  // only after the whole call resolves. A step arriving after the POST
  // response is still applied to result.steps below.
  const openStepStream = () => {
    esRef.current?.close();
    const base = resolveApiBaseUrl();
    const es = new EventSource(`${base}/api/admin/agent/${agentId}/kill-switch/events`, {
      withCredentials: true,
    });
    es.onmessage = (e) => {
      let evt;
      try { evt = JSON.parse(e.data); } catch { return; }
      if (evt.type !== "step" || evt.agentId !== agentId || !evt.step) return;
      setLiveSteps((prev) => {
        const i = prev.findIndex((s) => s.key === evt.step.key);
        if (i === -1) return [...prev, evt.step];
        const next = [...prev];
        next[i] = evt.step;
        return next;
      });
    };
    esRef.current = es;
  };

  const handleConfirm = async () => {
    setIsLoading(true);
    setLiveSteps([]);
    openStepStream();
    try {
      const reason =
        selectedReason === "other"
          ? customReason || "Custom reason"
          : selectedReason
              .split("_")
              .join(" ")
              .replace(/\b\w/g, (l) => l.toUpperCase());
      const data = await onConfirm?.(agentId, reason, scope);
      if (data && Array.isArray(data.steps)) {
        setResult(data);
      } else {
        handleCancel();
      }
    } finally {
      esRef.current?.close();
      esRef.current = null;
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    esRef.current?.close();
    esRef.current = null;
    setSelectedReason("misbehaving");
    setCustomReason("");
    setScope(initialScope);
    setResult(null);
    setLiveSteps([]);
    onCancel?.();
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={handleCancel}
      title={result ? "Stop Agent — Result" : isLoading ? "Stop Agent — Running" : "Stop Agent — Confirm"}
      defaultWidth={480}
      defaultHeight={460}
      storageKey="kill-switch-modal"
      minWidth={360}
      minHeight={280}
      footer={
        result ? (
          <button
            className="ksm-confirm-btn"
            onClick={handleCancel}
            type="button"
          >
            Done
          </button>
        ) : (
          <>
            <button
              className="dm-close-btn"
              onClick={handleCancel}
              disabled={isLoading}
              type="button"
            >
              Cancel
            </button>
            <button
              className="ksm-confirm-btn"
              onClick={handleConfirm}
              disabled={isLoading}
              type="button"
            >
              {isLoading ? "Stopping..." : "Confirm Stop Agent"}
            </button>
          </>
        )
      }
    >
      <div className="dm-scroll">
        {result ? (
          <>
            <div className={`ksm-result-scope ksm-result-scope--${result.scope}`}>
              {result.scope === "instance"
                ? "Stopped this instance only — the agent's PingOne application stayed enabled, so other users of this agent are unaffected."
                : "Stopped the entire agent identity — the PingOne application was disabled, blocking new tokens for every user of this agent client."}
            </div>
            <p className="ksm-result-mechanism">
              Enforcement point: the agent's next request to{" "}
              <code>/api/agent/*</code> — <code>agentRateLimit</code> checks
              the revocation flag set below before that call is allowed
              through.
            </p>
            <ul className="ksm-result-list">
              {(result.steps || []).map((step) => (
                <li
                  key={step.key}
                  className={`ksm-result-step ${step.skipped ? "ksm-result-step--skipped" : "ksm-result-step--ran"}`}
                >
                  <span className="ksm-result-badge">
                    {step.skipped ? "Skipped" : "Done"}
                  </span>
                  <div className="ksm-result-text">
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : isLoading ? (
          <>
            <p className="ksm-result-mechanism">
              Streaming each step as it runs at PingOne — a step already
              done stays done even if a later one fails.
            </p>
            <ul className="ksm-result-list">
              {liveSteps.map((step) => (
                <li
                  key={step.key}
                  className={`ksm-result-step ${step.skipped ? "ksm-result-step--skipped" : "ksm-result-step--ran"}`}
                >
                  <span className="ksm-result-badge">
                    {step.skipped ? "Skipped" : "Done"}
                  </span>
                  <div className="ksm-result-text">
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="ksm-instructions">
              <p className="ksm-instructions-lead">
                PingOne revokes the agent's OAuth token now (RFC 7009) and its
                state is frozen for forensics. A call already in flight when
                you confirm will still finish — the block takes effect on the
                agent's <strong>next</strong> tool call, rejected by the
                request-time revocation check. This action{" "}
                <strong>cannot be undone</strong>.
              </p>
            </div>

            <div className="ksm-field">
              <label htmlFor="kill-reason" className="ksm-label">
                Reason for stopping:
              </label>
              <select
                id="kill-reason"
                className="ksm-select"
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                disabled={isLoading}
              >
                <option value="misbehaving">
                  Misbehaving (unexpected behavior)
                </option>
                <option value="rate_limit">Rate limit violations</option>
                <option value="suspicious">Suspicious activity detected</option>
                <option value="manual_safety">Manual safety check</option>
                <option value="other">Other (specify below)</option>
              </select>
            </div>

            {selectedReason === "other" && (
              <div className="ksm-field">
                <input
                  type="text"
                  className="ksm-text-input"
                  placeholder="Describe reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  disabled={isLoading}
                  maxLength="200"
                />
              </div>
            )}

            <div className="ksm-field">
              <span className="ksm-label">Stop scope:</span>
              <div className="ksm-scope-options">
                <label
                  className={`ksm-scope-option${scope === "instance" ? " ksm-scope-option--selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="kill-scope"
                    value="instance"
                    checked={scope === "instance"}
                    onChange={() => setScope("instance")}
                    disabled={isLoading}
                  />
                  <span className="ksm-scope-copy">
                    <span className="ksm-scope-title">
                      This instance only (recommended)
                    </span>
                    <span className="ksm-scope-desc">
                      Revokes this agent's token and session. The agent's
                      PingOne application stays enabled — other users of this
                      agent keep working.
                    </span>
                  </span>
                </label>
                <label
                  className={`ksm-scope-option${scope === "full" ? " ksm-scope-option--selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="kill-scope"
                    value="full"
                    checked={scope === "full"}
                    onChange={() => setScope("full")}
                    disabled={isLoading}
                  />
                  <span className="ksm-scope-copy">
                    <span className="ksm-scope-title">
                      This agent's entire identity
                    </span>
                    <span className="ksm-scope-desc">
                      Also disables the agent's PingOne application, blocking
                      new tokens for every user of this client. Use only if
                      the client itself is compromised.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="ksm-warning-note">
              <strong>This is permanent.</strong> Stopping this agent will
              immediately revoke all tokens and prevent any further operations.
              Audit trail will be preserved for investigation.
            </div>
          </>
        )}
      </div>
    </DraggableModal>
  );
}
