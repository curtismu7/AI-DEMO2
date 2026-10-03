import React, { useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';
import DraggableModal from './DraggableModal';
import SignInBrand from './SignInBrand';

/** Sign-in-style modal: vertical logo and colours, same footer actions as the other app modals. */
function BrandedModal({ title, onClose, actions, children }) {
  return (
    <DraggableModal
      isOpen
      onClose={onClose}
      title={title}
      className="signin-modal pi-flow-signin"
      defaultWidth={440}
      defaultHeight={320}
      minHeight={240}
      footer={<div className="signin-modal__actions">{actions}</div>}
    >
      <div className="dm-scroll">
        <SignInBrand />
        <p className="signin-modal__text">{children}</p>
      </div>
    </DraggableModal>
  );
}

export default function AgentAccessCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHardModal, setShowHardModal] = useState(false);
  const [confirmSoft, setConfirmSoft] = useState(false);
  const [confirmHard, setConfirmHard] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const successTimerRef = useRef(null);

  useEffect(() => {
    bffAxios.get('/api/agent-authorization/status')
      .then(r => setStatus(r.data))
      .catch((err) => {
        console.error('Failed to fetch agent authorization status:', err);
        setStatus({ authorized: false, enforced: false });
      });
  }, []);

  useEffect(() => {
    return () => { if (successTimerRef.current) clearTimeout(successTimerRef.current); };
  }, []);

  const handleSoftRevoke = async () => {
    setError('');
    setBusy(true);
    try {
      await bffAxios.delete('/api/agent-authorization');
      setStatus(s => ({ ...s, authorized: false }));
      setConfirmSoft(false);
      setSuccess('Agent access revoked.');
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setConfirmSoft(false);
      setError('Failed to revoke access. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleHardRevoke = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await bffAxios.delete('/api/agent-authorization/hard');
      if (res.data.sessionClear) {
        setConfirmHard(false);
        setShowHardModal(true);
      }
    } catch (err) {
      setConfirmHard(false);
      setError('Failed to revoke access. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  const sectionStyle = { margin: '24px 0', padding: '20px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' };
  const titleStyle = { fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 12 };
  const emptyStyle = { fontSize: 13, color: '#6b7280' };
  const btnBase = { padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid' };
  const btnSecondary = { ...btnBase, background: '#f9fafb', color: '#374151', borderColor: '#d1d5db' };
  const btnDanger = { ...btnBase, background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' };

  return (
    <div style={sectionStyle}>
      <div style={titleStyle}>Agent Access</div>

      {showHardModal && (
        <BrandedModal
          title="Agent access revoked"
          onClose={() => { window.location.href = '/login?revoked=1'; }}
          actions={
            <button type="button" className="signin-prompt__btn" onClick={() => { window.location.href = '/login?revoked=1'; }}>
              Log in again
            </button>
          }
        >
          The AI agent can no longer act on your behalf. Your session has been cleared for security.
        </BrandedModal>
      )}

      {!status.authorized ? (
        <p style={emptyStyle}>No agent access is currently granted.</p>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
            AI agent access is <strong>active</strong>.
          </p>
          {success && <p style={{ fontSize: 13, color: '#15803d', marginBottom: 8 }}>{success}</p>}
          {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 8 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnSecondary} onClick={() => setConfirmSoft(true)}>Revoke</button>
            <button style={btnDanger} onClick={() => setConfirmHard(true)}>Revoke Immediately</button>
          </div>

          {confirmSoft && (
            <BrandedModal
              title="Revoke agent access"
              onClose={() => { if (!busy) setConfirmSoft(false); }}
              actions={
                <>
                  <button type="button" className="signin-prompt__btn" onClick={handleSoftRevoke} disabled={busy}>
                    {busy ? 'Revoking…' : 'Confirm Revoke'}
                  </button>
                  <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={() => setConfirmSoft(false)} disabled={busy}>
                    Cancel
                  </button>
                </>
              }
            >
              Remove agent access? The change takes effect on next login.
            </BrandedModal>
          )}

          {confirmHard && (
            <BrandedModal
              title="Revoke access immediately"
              onClose={() => { if (!busy) setConfirmHard(false); }}
              actions={
                <>
                  <button type="button" className="signin-prompt__btn" onClick={handleHardRevoke} disabled={busy}>
                    {busy ? 'Revoking…' : 'Confirm Revoke Immediately'}
                  </button>
                  <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={() => setConfirmHard(false)} disabled={busy}>
                    Cancel
                  </button>
                </>
              }
            >
              This will also invalidate your current session. You will need to log in again.
            </BrandedModal>
          )}
        </div>
      )}
    </div>
  );
}
