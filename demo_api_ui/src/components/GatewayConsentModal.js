import { useState } from 'react';
import DraggableModal from './DraggableModal';
import FidoStepUpModal from './FidoStepUpModal';
import './GatewayConsentModal.css';

/**
 * GatewayConsentModal
 *
 * Rendered for HITL interrupts (AG-UI path) and gateway hitl_required responses.
 *
 * Props:
 *   show           — boolean
 *   challengeId    — string
 *   challengeType  — 'consent' | 'step_up'
 *   expiresAt      — string (ISO date)
 *   onApprove      — callback on consent approval (caller handles OTP flow)
 *   onDismiss      — callback on cancel / escape
 */
export default function GatewayConsentModal({
  show,
  challengeId,
  challengeType,
  expiresAt,
  onApprove,
  onDismiss,
}) {
  const [agreed, setAgreed] = useState(false);
  const isStepUp = challengeType === 'step_up';

  // step_up delegates entirely to FidoStepUpModal
  if (isStepUp) {
    return (
      <FidoStepUpModal
        show={!!show}
        contextLine="The agent requires identity verification to continue."
        onSubmit={() => onApprove?.()}
        onCancel={() => onDismiss?.()}
      />
    );
  }

  const footer = (
    <>
      <button
        type="button"
        className="gcm-btn-approve"
        disabled={!agreed}
        onClick={() => onApprove?.()}
      >
        Agree &amp; Continue
      </button>
      <button
        type="button"
        className="gcm-btn-cancel"
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
      title="Action Requires Your Approval"
      footer={footer}
      defaultWidth={420}
      defaultHeight={380}
      storageKey="gateway-consent-modal"
      zIndex={9995}
      backdropClose={false}
    >
      <div className="dm-scroll">
        <span className="gcm-hitl-badge">Human-in-the-Loop — <strong>manual approval required</strong></span>
        <p style={{ marginTop: 12, fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.5 }}>
          The agent is requesting permission to proceed. Review the details before approving.
        </p>
        {challengeId && (
          <p className="gcm-challenge-id">Challenge ID: {challengeId}</p>
        )}
        {expiresAt && (
          <p className="gcm-expires">Expires: {new Date(expiresAt).toLocaleTimeString()}</p>
        )}
        <ul style={{ fontSize: '0.85rem', color: '#374151', paddingLeft: '1.2em', margin: '10px 0' }}>
          <li>A one-time verification code will be sent to your registered contact</li>
          <li>This approval is recorded in the audit trail</li>
        </ul>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: '0.85rem', color: '#1e293b', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <span>I have reviewed the details above and consent to this agent action</span>
        </label>
      </div>
    </DraggableModal>
  );
}
