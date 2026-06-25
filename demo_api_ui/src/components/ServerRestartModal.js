/**
 * ServerRestartModal.js
 * 
 * Modal component displayed when the server is restarting (504 error detected).
 * Shows spinner, attempt counter, and retry/dismiss buttons.
 * 
 * Usage: Mount globally in App.js, no props needed
 * State is managed by bankingRestartNotificationService hook
 */

import { useRestartModal } from '../services/bankingRestartNotificationService';
import DraggableModal from './DraggableModal';
import './ServerRestartModal.css';

export default function ServerRestartModal() {
  const { isVisible, attemptCount, maxAttempts, retryNow, closeModal } =
    useRestartModal();

  const footer = (
    <>
      <button
        type="button"
        className="dm-close-btn"
        style={{ background: '#2563eb', borderColor: '#1d4ed8', color: '#fff' }}
        onClick={retryNow}
        aria-label="Retry connection immediately"
      >
        Retry Now
      </button>
      <button
        type="button"
        className="dm-close-btn"
        onClick={closeModal}
        aria-label="Dismiss this notification (retries continue in background)"
      >
        Dismiss
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={isVisible}
      onClose={closeModal}
      title="Server is restarting"
      footer={footer}
      defaultWidth={420}
      defaultHeight={240}
      zIndex={9999}
      storageKey={null}
    >
      <div className="dm-scroll" style={{ textAlign: 'center' }}>
        <div className="restart-spinner" aria-label="Loading" aria-hidden="true" />
        <p className="restart-message">
          The server is temporarily unavailable. Reconnecting...
        </p>
        <p className="attempt-counter">
          Attempt {attemptCount} of {maxAttempts}
        </p>
      </div>
    </DraggableModal>
  );
}
