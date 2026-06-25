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
  const [isLoading, setIsLoading] = useState(false);

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
      await onConfirm?.(agentId, reason);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setSelectedReason("misbehaving");
    setCustomReason("");
    onCancel?.();
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Stop Agent — Confirm"
      defaultWidth={480}
      defaultHeight={380}
      storageKey="kill-switch-modal"
      minWidth={360}
      minHeight={280}
      footer={
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
      }
    >
      <div className="dm-scroll">
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

        <div className="ksm-warning-note">
          <strong>This is permanent.</strong> Stopping this agent will
          immediately revoke all tokens and prevent any further operations.
          Audit trail will be preserved for investigation.
        </div>
      </div>
    </DraggableModal>
  );
}
