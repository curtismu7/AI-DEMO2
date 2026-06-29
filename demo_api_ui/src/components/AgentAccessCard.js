import React, { useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';

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
  const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const modalStyle = { background: '#fff', borderRadius: 10, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' };

  return (
    <div style={sectionStyle}>
      <div style={titleStyle}>Agent Access</div>

      {showHardModal && (
        <div style={overlayStyle}>
          <div style={modalStyle} role="dialog" aria-modal="true">
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Agent access revoked</div>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 20 }}>
              The AI agent can no longer act on your behalf. Your session has been cleared for security.
            </p>
            <button style={btnDanger} onClick={() => { window.location.href = '/login?revoked=1'; }}>
              Log in again
            </button>
          </div>
        </div>
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

          {!confirmSoft && !confirmHard && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnSecondary} onClick={() => setConfirmSoft(true)}>Revoke</button>
              <button style={btnDanger} onClick={() => setConfirmHard(true)}>Revoke Immediately</button>
            </div>
          )}

          {confirmSoft && (
            <div style={{ fontSize: 13 }}>
              <p style={{ marginBottom: 10, color: '#374151' }}>Remove agent access? The change takes effect on next login.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnSecondary} onClick={() => setConfirmSoft(false)} disabled={busy}>Cancel</button>
                <button style={btnDanger} onClick={handleSoftRevoke} disabled={busy}>
                  {busy ? 'Revoking…' : 'Confirm Revoke'}
                </button>
              </div>
            </div>
          )}

          {confirmHard && (
            <div style={{ fontSize: 13 }}>
              <p style={{ marginBottom: 10, color: '#374151' }}>This will also invalidate your current session. You will need to log in again.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnSecondary} onClick={() => setConfirmHard(false)} disabled={busy}>Cancel</button>
                <button style={btnDanger} onClick={handleHardRevoke} disabled={busy}>
                  {busy ? 'Revoking…' : 'Confirm Revoke Immediately'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
