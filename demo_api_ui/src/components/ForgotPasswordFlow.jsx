import { useState } from 'react';
import DraggableModal from './DraggableModal';
import OtpStepUpModal from './OtpStepUpModal';
import SignInBrand from './SignInBrand';
import './SecurityCenter.css';

/**
 * Forgot password. Needs no session: the BFF runs the MFA challenge and sets the
 * new password with its worker token (routes/mfa.js /forgot-password/*), and an
 * existing sign-in is never touched.
 */
function useForgotPassword(initialUsername = '') {
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

  return { step, setStep, mfa, username, setUsername, newPassword, setNewPassword, busy, error, setError, start, finish };
}

/** Username / new-password form, in the sign-in modal's field styling. */
function ResetFields({ fp }) {
  const { step, username, setUsername, newPassword, setNewPassword, busy, error, start, finish } = fp;
  return (
    <form
      className="pi-flow-signin__form"
      onSubmit={(e) => { e.preventDefault(); if (step === 'set') finish(); else if (step === 'idle') start(); }}
    >
      {step === 'done' ? (
        <div className="pi-flow-signin__done" role="status">
          <span className="pi-flow-signin__done-icon" aria-hidden>✓</span>
          <h3 className="pi-flow-signin__done-title">Password reset</h3>
          <p className="signin-modal__text">You can now sign in with your new password.</p>
        </div>
      ) : step === 'set' ? (
        <>
          <p className="signin-modal__text">✓ MFA verified. Choose a new password.</p>
          <label className="pi-flow-signin__label" htmlFor="forgot-new-password">New password</label>
          <input
            id="forgot-new-password"
            className="pi-flow-signin__input"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <p className="signin-modal__text">Enter your username. We will verify it is you with MFA.</p>
          <label className="pi-flow-signin__label" htmlFor="forgot-username">Username</label>
          <input
            id="forgot-username"
            className="pi-flow-signin__input"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={busy}
          />
        </>
      )}
      {error ? <p className="signin-modal__text" role="alert">❌ {error}</p> : null}
    </form>
  );
}

function ResetMfaModal({ fp }) {
  const email = fp.mfa.devices.find(d => String(d.type || '').toUpperCase() === 'EMAIL')?.email;
  return (
    <OtpStepUpModal
      show={fp.step === 'mfa'}
      mode="p1mfa"
      compact
      enrolledOnly
      brand={<SignInBrand />}
      contextLine="Verify it is you to reset your password."
      daId={fp.mfa.daId}
      devices={fp.mfa.devices}
      maskedContact={email}
      onP1MfaComplete={() => fp.setStep('set')}
      onP1MfaError={(msg) => { fp.setError(msg || 'MFA failed.'); fp.setStep('idle'); }}
      onCancel={() => fp.setStep('idle')}
      onSubmit={() => {}}
      userIdentity={{ name: fp.username }}
    />
  );
}

function primaryAction(fp) {
  if (fp.step === 'set') {
    return { label: fp.busy ? 'Resetting' : 'Reset password', onClick: fp.finish, disabled: fp.busy || !fp.newPassword };
  }
  return { label: fp.busy ? 'Starting' : 'Verify with MFA', onClick: fp.start, disabled: fp.busy || !fp.username.trim() };
}

/** Inline, for the Password tab of a signed-in user. */
export default function ForgotPasswordFlow({ initialUsername = '' }) {
  const fp = useForgotPassword(initialUsername);
  const action = primaryAction(fp);
  return (
    <div>
      <ResetFields fp={fp} />
      {fp.step !== 'done' && (
        <button type="button" className="btn btn-primary btn-sm" onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </button>
      )}
      <ResetMfaModal fp={fp} />
    </div>
  );
}

/** "Forgot password?" for the signed-out sign-in surfaces: a sign-in-styled modal. */
export function ForgotPasswordLink() {
  const [open, setOpen] = useState(false);
  const fp = useForgotPassword();
  const action = primaryAction(fp);
  const close = () => { setOpen(false); fp.setStep('idle'); fp.setError(null); };
  return (
    <>
      <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={() => setOpen(true)}>
        Forgot password?
      </button>
      {open && (
        <DraggableModal
          key={fp.step === 'done' ? 'done' : 'form'}
          isOpen
          onClose={close}
          title="Reset your password"
          className="signin-modal pi-flow-signin"
          defaultWidth={460}
          defaultHeight={fp.step === 'done' ? 340 : 440}
          minHeight={fp.step === 'done' ? 280 : 360}
          footer={
            <div className="signin-modal__actions">
              {fp.step === 'done' ? (
                <button type="button" className="signin-prompt__btn" onClick={close}>
                  Back to sign in
                </button>
              ) : (
                <>
                  <button type="button" className="signin-prompt__btn" onClick={action.onClick} disabled={action.disabled}>
                    {action.label}
                  </button>
                  <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={close}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          }
        >
          <div className="dm-scroll">
            <SignInBrand />
            <ResetFields fp={fp} />
          </div>
        </DraggableModal>
      )}
      <ResetMfaModal fp={fp} />
    </>
  );
}
