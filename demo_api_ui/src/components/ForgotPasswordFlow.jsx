import { useState } from 'react';
import DraggableModal from './DraggableModal';
import OtpStepUpModal from './OtpStepUpModal';
import './SecurityCenter.css';

/**
 * Forgot password. Needs no session: the BFF runs the MFA challenge and sets the
 * new password with its worker token (routes/mfa.js /forgot-password/*), and an
 * existing sign-in is never touched.
 */
export default function ForgotPasswordFlow({ initialUsername = '' }) {
  const [step, setStep] = useState('idle'); // idle | mfa | set | done
  const [mfa, setMfa] = useState({ daId: null, devices: [] });
  const [username, setUsername] = useState(initialUsername);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function post(path, body) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/mfa/forgot-password/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Password reset failed.');
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const data = await post('start', { username: username.trim() });
    if (data) {
      setMfa({ daId: data.daId, devices: data.devices || [] });
      setStep('mfa');
    }
  }

  async function finish() {
    if (await post('complete', { newPassword })) {
      setStep('done');
      setNewPassword('');
    }
  }

  return (
    <div>
      {step === 'done' && <p>✅ Password reset. Use the new password next time you sign in.</p>}
      {error && <p className="sc-error-inline" style={{ margin: '0 0 0.5rem' }}>{error}</p>}
      {(step === 'idle' || step === 'mfa') && (
        <>
          <input
            type="text"
            className="rename-input"
            style={{ display: 'block', width: '100%', maxWidth: 260, boxSizing: 'border-box', marginBottom: '0.5rem' }}
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={busy}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={start} disabled={busy || !username.trim()}>
            {busy ? 'Starting...' : 'Forgot password? Verify with MFA'}
          </button>
        </>
      )}
      {step === 'set' && (
        <>
          <p className="sc-hint" style={{ margin: '0 0 0.5rem' }}>✓ MFA verified. Choose a new password.</p>
          <input
            type="password"
            className="rename-input"
            style={{ display: 'block', width: '100%', maxWidth: 260, boxSizing: 'border-box' }}
            placeholder="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: '0.5rem' }}
            onClick={finish}
            disabled={busy || !newPassword}
          >
            {busy ? 'Resetting...' : 'Reset password'}
          </button>
        </>
      )}
      <OtpStepUpModal
        show={step === 'mfa'}
        mode="p1mfa"
        contextLine="Verify it is you to reset your password."
        daId={mfa.daId}
        devices={mfa.devices}
        onP1MfaComplete={() => setStep('set')}
        onP1MfaError={(msg) => { setError(msg || 'MFA failed.'); setStep('idle'); }}
        onCancel={() => setStep('idle')}
        onSubmit={() => {}}
        userIdentity={{ name: username }}
      />
    </div>
  );
}

/** "Forgot password?" for the signed-out sign-in surfaces: opens the flow in a modal. */
export function ForgotPasswordLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={() => setOpen(true)}>
        Forgot password?
      </button>
      {open && (
        <DraggableModal
          isOpen
          onClose={() => setOpen(false)}
          title="Reset your password"
          defaultWidth={460}
          defaultHeight={260}
          minHeight={150}
        >
          <div className="dm-scroll">
            <ForgotPasswordFlow />
          </div>
        </DraggableModal>
      )}
    </>
  );
}
