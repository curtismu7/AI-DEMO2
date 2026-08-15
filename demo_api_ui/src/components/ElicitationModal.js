import DraggableModal from './DraggableModal';
import './GatewayConsentModal.css';

/**
 * ElicitationModal
 *
 * Rendered for the ELICITATION obligation (AG-UI interrupt with
 * reason:'elicitation_required') — PingOne Authorize asking the agent to
 * confirm intent before proceeding. Distinct from GatewayConsentModal
 * (HITL): no human-in-the-loop dashboard approval, no OTP. Shares the same
 * interrupt/resume mechanism — onApprove/onDismiss wire to the same
 * handleAguiHitlApprove/handleAguiHitlDismiss AIAgent.js uses for HITL.
 *
 * Props:
 *   show           — boolean
 *   prompt         — string, the policy-supplied confirmation prompt
 *   toolName       — string
 *   elicitationId  — string
 *   expiresAt      — string (ISO date)
 *   onApprove      — callback on confirm
 *   onDismiss      — callback on cancel / escape
 */
export default function ElicitationModal({
  show,
  prompt,
  toolName,
  elicitationId,
  expiresAt,
  onApprove,
  onDismiss,
}) {
  const footer = (
    <>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onApprove?.()}
      >
        Confirm
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onDismiss?.()}
      >
        Cancel
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={!!show}
      onClose={onDismiss}
      title="Confirm Action"
      footer={footer}
      defaultWidth={380}
      defaultHeight={320}
      storageKey="elicitation-modal"
      zIndex={9995}
      backdropClose={false}
    >
      <div className="dm-scroll">
        <p style={{ marginTop: 4, fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.5 }}>
          {prompt || `Confirm ${toolName || 'this action'}?`}
        </p>
        {elicitationId && (
          <p className="gcm-challenge-id">Reference: {elicitationId}</p>
        )}
        {expiresAt && (
          <p className="gcm-expires">Expires: {new Date(expiresAt).toLocaleTimeString()}</p>
        )}
      </div>
    </DraggableModal>
  );
}
