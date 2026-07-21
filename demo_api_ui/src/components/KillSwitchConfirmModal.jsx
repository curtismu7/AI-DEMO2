import { useState } from "react";
import DraggableModal from "./DraggableModal";
import "./KillSwitchConfirmModal.css";

export default function KillSwitchConfirmModal({
  isOpen,
  agentId,
  onConfirm,
  onCancel,
}) {
  const [selectedReason, setSelectedReason] = useState("misbehaving");
  const [customReason, setCustomReason] = useState("");
  const [scope, setScope] = useState("instance");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleConfirm = async () => {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setSelectedReason("misbehaving");
    setCustomReason("");
    setScope("instance");
    setResult(null);
    onCancel?.();
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={handleCancel}
      title={result ? "Stop Agent — Result" : "Stop Agent — Confirm"}
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
        ) : (
          <>
            <div className="ksm-instructions">
              <p className="ksm-instructions-lead">
                This will immediately revoke the agent's OAuth token and freeze its
                state for forensics. The agent cannot make any further API calls.
                This action <strong>cannot be undone</strong>.
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
