import DraggableModal from "./DraggableModal";
import "./KillSwitchConfirmModal.css";

// Entry gate shown when the user clicks the "Agent Kill Switch" side-nav item.
// Reuses the Stop-Agent confirm modal's look, but it does NOT stop anything —
// confirming just navigates into the control-plane console.
export default function ControlPlaneIntroModal({ isOpen, onConfirm, onCancel }) {
  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onCancel}
      title="Enter Agent Kill Switch"
      defaultWidth={480}
      defaultHeight={360}
      storageKey="control-plane-intro-modal"
      minWidth={360}
      minHeight={260}
      footer={
        <>
          <button className="dm-close-btn" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="ksm-confirm-btn" onClick={onConfirm} type="button">
            Enter Console
          </button>
        </>
      }
    >
      <div className="dm-scroll">
        <div className="ksm-instructions">
          <p className="ksm-instructions-lead">
            The Agent Kill Switch is where you <strong>govern, authorize, audit,
            and shut down</strong> AI agents across every platform — your live
            agent plus connected platforms like ChatGPT, Copilot, Glean, and
            others. Stopping an agent here revokes its identity at Ping, so
            access dies everywhere at once.
          </p>
        </div>

        <div className="ksm-warning-note">
          <strong>This is the live stop &amp; govern console.</strong> Entering
          does not stop anything — but actions taken here (Stop, Stop across all
          platforms) immediately revoke tokens and are logged to the audit
          trail.
        </div>
      </div>
    </DraggableModal>
  );
}
