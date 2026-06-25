import { useState } from 'react';
import DraggableModal from './DraggableModal';
import './RunServersModal.css';

export default function RunServersModal({ onClose }) {
  const [status, setStatus] = useState('confirm'); // confirm | starting | already_running | error

  async function handleConfirm() {
    setStatus('starting');
    try {
      const res = await fetch('/api/dev/run-servers', { method: 'POST', credentials: 'include' });
      if (res.status === 409) { setStatus('already_running'); return; }
      if (!res.ok) { setStatus('error'); return; }
      onClose();
    } catch (_) {
      setStatus('error');
    }
  }

  const footer = (
    <>
      {status === 'confirm' && (
        <button type="button" className="rsm-btn rsm-btn--primary" onClick={handleConfirm}>
          Yes, restart
        </button>
      )}
      <button type="button" className="rsm-btn rsm-btn--secondary dm-close-btn" onClick={onClose}>
        {status === 'confirm' ? 'Cancel' : 'Close'}
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen
      onClose={onClose}
      title="Run Servers"
      footer={footer}
      defaultWidth={420}
      defaultHeight={260}
      storageKey="run-servers-modal"
    >
      <div className="dm-scroll">
        {status === 'confirm' && (
          <>
            <p>This will stop and restart all banking demo servers.</p>
            <p className="rsm-note">
              A Terminal window will open. The browser will open automatically when the servers are ready.
            </p>
          </>
        )}
        {status === 'starting' && <p className="rsm-waiting">Opening Terminal…</p>}
        {status === 'already_running' && <p>Already starting, please wait.</p>}
        {status === 'error' && <p>Could not reach the server. Check the console.</p>}
      </div>
    </DraggableModal>
  );
}
