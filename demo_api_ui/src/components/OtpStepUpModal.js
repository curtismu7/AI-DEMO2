import { useState, useRef, useEffect } from 'react';
import DraggableModal from './DraggableModal';
import { registerPasskey } from '../utils/passkeyCeremony';

/**
 * OtpStepUpModal — MFA OTP collection modal for HITL step-up challenges
 *
 * Modes:
 *   - "stub" (default): Simple OTP input -> onSubmit(otp) — original behavior
 *   - "p1mfa": PingOne MFA multi-step flow (device picker -> OTP/push/FIDO -> complete)
 *
 * Props (additions):
 *   userIdentity        — { name, email } of the signed-in user, shown so the
 *                         demo presenter knows who is being verified.
 *   onPasskeyRegistered — async callback fired after a passkey is registered;
 *                         must re-initiate the MFA challenge and resolve to the
 *                         fresh { daId, devices } so we can authenticate with the
 *                         new passkey immediately.
 */
export default function OtpStepUpModal({
  show, onSubmit, onCancel, contextLine = '',
  maskedContact,
  allowFido,
  mode = 'stub',
  daId, devices = [], onP1MfaComplete, onP1MfaError,
  userIdentity, onPasskeyRegistered, deliveryError,
}) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [showDemoCode, setShowDemoCode] = useState(false);
  const [registering, setRegistering] = useState(false);
  const inputRef = useRef(null);

  // P1MFA state machine
  const [p1Step, setP1Step] = useState('pick-device');
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [p1Error, setP1Error] = useState('');
  const pollRef = useRef(null);
  // Keep a ref to the current daId so startPushPolling always polls the live value.
  const daIdRef = useRef(daId);
  daIdRef.current = daId;

  // Which address the code was sent to (masked PingOne contact, else the
  // signed-in user's email). Answers "what email do I get the OTP from?".
  const otpContactLabel = maskedContact || userIdentity?.email || '';
  const hasFido = (devices || []).some((d) =>
    String(d?.type || '').toUpperCase().startsWith('FIDO2'),
  );
  // Demo OTP hint depends on the path: the stub path does not verify the code
  // (any 6 digits pass), the PingOne paths accept the 123123 test bypass.
  const demoCodeHint = mode === 'p1mfa'
    ? 'Demo bypass code: 123123 (or the real code from your device)'
    : 'Demo bypass code: 123123';

  const apiBase = process.env.REACT_APP_API_URL || '';

  // Auto-focus input when modal shows (stub mode)
  useEffect(() => {
    if (show && mode === 'stub' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [show, mode]);

  // Reset P1MFA state when modal opens. Even with no enrolled devices we land on
  // the picker so the "Register a passkey" CTA is reachable.
  useEffect(() => {
    if (show && mode === 'p1mfa') {
      setP1Step('pick-device');
      setSelectedDeviceId(null);
      setP1Error('');
      setOtp('');
    }
  }, [show, mode]);

  // Cleanup push polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Stub mode handlers

  const handleSubmit = () => {
    if (!otp.trim()) {
      setError('Enter the 6-digit code');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter 6 digits only');
      return;
    }
    onSubmit(otp);
    setOtp('');
    setError('');
  };

  const handleCancel = () => {
    setOtp('');
    setError('');
    if (pollRef.current) clearInterval(pollRef.current);
    onCancel();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (mode === 'stub') handleSubmit();
      else if (mode === 'p1mfa' && p1Step === 'otp') handleP1OtpSubmit();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  // Paste a code regardless of formatting (label/spaces). Avoids maxLength
  // truncating the clipboard text before non-digits are stripped.
  const handleOtpPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (text) {
      setOtp(text);
      if (error) setError('');
    }
  };

  // P1MFA handlers

  // daIdOverride lets the post-registration auto-authenticate use the freshly
  // issued challenge id before the daId prop has propagated.
  const handleSelectDevice = async (device, daIdOverride) => {
    const useDaId = daIdOverride || daId;
    setSelectedDeviceId(device.id);
    setP1Error('');
    try {
      const resp = await fetch(`${apiBase}/api/auth/mfa/challenge/${useDaId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.id }),
      });
      if (resp.status === 410) {
        setP1Step('error');
        setP1Error('MFA session expired — please try again');
        return;
      }
      if (!resp.ok) throw new Error(`Device selection failed: ${resp.status}`);
      const data = await resp.json();

      if (data.status === 'COMPLETED' && data.completed) {
        onP1MfaComplete?.();
        return;
      }

      switch (data.status) {
        case 'OTP_REQUIRED':
          setP1Step('otp');
          break;
        case 'PUSH_CONFIRMATION_REQUIRED':
          setP1Step('push');
          startPushPolling();
          break;
        case 'ASSERTION_REQUIRED':
          setP1Step('fido');
          handleFidoAssertion(useDaId);
          break;
        default:
          setP1Step('error');
          setP1Error(`Unexpected MFA status: ${data.status}`);
      }
    } catch (err) {
      console.error('[OtpStepUpModal] Device selection error:', err);
      setP1Step('error');
      setP1Error('Failed to select device. Please try again.');
    }
  };

  const handleP1OtpSubmit = async () => {
    if (!otp.trim()) {
      setError('Enter the 6-digit code');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter 6 digits only');
      return;
    }
    setError('');
    try {
      const resp = await fetch(`${apiBase}/api/auth/mfa/challenge/${daId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDeviceId, otp }),
      });
      if (resp.status === 410) {
        setP1Step('error');
        setP1Error('MFA session expired — please try again');
        return;
      }
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        setError(errData.message || 'Incorrect code. Please try again.');
        return;
      }
      const data = await resp.json();
      if (data.completed) {
        setOtp('');
        onP1MfaComplete?.();
      } else {
        setError('Verification not complete. Please try again.');
      }
    } catch (err) {
      console.error('[OtpStepUpModal] P1MFA OTP submit error:', err);
      setError('Verification failed. Please try again.');
    }
  };

  const startPushPolling = () => {
    // Clear any existing interval before starting a new one to prevent duplicate
    // polling loops and duplicate onP1MfaComplete callbacks.
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3000;
      if (elapsed >= 60000) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setP1Step('error');
        setP1Error('Push notification timed out. Try another method.');
        return;
      }
      try {
        // Use ref so a re-challenge updates the polled daId without restarting the interval.
        const resp = await fetch(`${apiBase}/api/auth/mfa/challenge/${daIdRef.current}/status`, {
          credentials: 'include',
        });
        // Non-ok (e.g. 410 expired) is terminal — stop polling and surface error.
        if (!resp.ok) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setP1Step('error');
          setP1Error('Push session expired or unavailable. Try another method.');
          return;
        }
        const data = await resp.json();
        if (data.completed) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          onP1MfaComplete?.();
        } else if (data.status === 'PUSH_CONFIRMATION_TIMED_OUT') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setP1Step('error');
          setP1Error('Push notification timed out. Try another method.');
        }
      } catch (err) {
        // Silently retry on network error
      }
    }, 3000);
  };

  const handleFidoAssertion = async (daIdOverride) => {
    const useDaId = daIdOverride || daId;
    // Decode base64url string -> Uint8Array for WebAuthn input fields.
    const b64ToBytes = (s) => {
      const p = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      return Uint8Array.from(atob(p + '='.repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0));
    };
    // Encode ArrayBuffer -> base64url (PingOne expects base64url, not standard base64).
    const bufToB64url = (buf) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    try {
      const statusResp = await fetch(`${apiBase}/api/auth/mfa/challenge/${useDaId}/status`, {
        credentials: 'include',
      });
      if (!statusResp.ok) throw new Error('Failed to get FIDO options');
      const statusData = await statusResp.json();
      const options = statusData.publicKeyCredentialRequestOptions;

      if (!options) throw new Error('No FIDO options available');

      // Decode challenge and allowCredentials ids from base64url -> Uint8Array.
      options.challenge = b64ToBytes(options.challenge);
      if (Array.isArray(options.allowCredentials)) {
        options.allowCredentials = options.allowCredentials.map((c) => ({ ...c, id: b64ToBytes(c.id) }));
      }

      const credential = await navigator.credentials.get({ publicKey: options });
      if (!credential) throw new Error('No credential returned');

      // Encode assertion fields as base64url (PingOne requirement).
      const assertion = {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bufToB64url(credential.response.authenticatorData),
          clientDataJSON: bufToB64url(credential.response.clientDataJSON),
          signature: bufToB64url(credential.response.signature),
        },
      };

      const resp = await fetch(`${apiBase}/api/auth/mfa/challenge/${useDaId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion }),
      });
      if (!resp.ok) throw new Error('FIDO verification failed');
      const result = await resp.json();
      if (result.completed) {
        onP1MfaComplete?.();
      } else {
        setP1Step('error');
        setP1Error('FIDO verification incomplete. Try another method.');
      }
    } catch (err) {
      console.error('[OtpStepUpModal] FIDO assertion error:', err);
      setP1Step('error');
      setP1Error('Passkey verification failed. Try another method.');
    }
  };

  // Register a passkey (real PingOne FIDO2 ceremony), then immediately
  // authenticate with it. Always runs through the p1mfa path — never the stub.
  const handleRegisterPasskey = async () => {
    if (!onPasskeyRegistered) return;
    setP1Error('');
    setError('');
    setRegistering(true);
    setP1Step('registering');
    try {
      await registerPasskey();
      // Re-initiate the MFA challenge so the new passkey appears as a device.
      const fresh = await onPasskeyRegistered();
      const freshDevices = fresh?.devices || [];
      const fido = freshDevices.find((d) =>
        String(d?.type || '').toUpperCase().startsWith('FIDO2'),
      );
      if (fresh?.daId && fido) {
        // Authenticate with the passkey we just registered.
        await handleSelectDevice(fido, fresh.daId);
      } else {
        setP1Step(freshDevices.length > 0 ? 'pick-device' : 'error');
        if (!freshDevices.length) setP1Error('Passkey registered but no device was returned. Please try again.');
      }
    } catch (err) {
      console.error('[OtpStepUpModal] Passkey registration error:', err);
      // WebAuthn errors (NotAllowedError, InvalidStateError, SecurityError) are
      // terse — prefer the name so the user/operator can act. Surface in BOTH
      // the p1mfa step AND the stub `error` slot so the button never just
      // silently reverts ("no silent fails").
      const detail = err?.name && err.name !== 'Error'
        ? `${err.name}: ${err.message || ''}`.trim()
        : (err?.message || String(err));
      // The rp.id failure is a config issue, not a user error — tell the admin
      // exactly how to fix it (PingOne's FIDO2 Relying Party ID must match this
      // host). This deployment auto-bootstraps it on api-server restart.
      const isRpId = /rp\.?id|relying party|registrable domain/i.test(detail);
      const host = (typeof window !== 'undefined' && window.location?.hostname) || 'this site';
      const msg = isRpId
        ? `Passkey isn't set up for this domain yet. PingOne's FIDO2 policy "Relying Party ID" must be "${host}". An admin can fix it in PingOne (MFA → FIDO Policy → Relying Party ID → Other → ${host}), or restart the API server to auto-configure it. (${detail})`
        : `Passkey registration failed — ${detail}`;
      setP1Step('error');
      setP1Error(msg);
      setError(msg);
    } finally {
      setRegistering(false);
    }
  };

  const handleBackToDevicePicker = () => {
    setP1Step('pick-device');
    setP1Error('');
    setOtp('');
    setError('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const deviceLabel = (type) => {
    switch (type?.toLowerCase()) {
      case 'email': return 'Email';
      case 'totp': return 'Authenticator App';
      case 'fido2': return 'Passkey';
      case 'push': return 'Mobile Push';
      default: return 'Device';
    }
  };

  // Shared header: who is being verified (name + email).
  const identityHeader = (userIdentity?.name || userIdentity?.email) ? (
    <div className="otp-step-up-modal__identity">
      <span className="otp-step-up-modal__identity-label">Verifying identity for</span>
      <span className="otp-step-up-modal__identity-name">
        {userIdentity.name || userIdentity.email}
      </span>
      {userIdentity.name && userIdentity.email && (
        <span className="otp-step-up-modal__identity-email">{userIdentity.email}</span>
      )}
    </div>
  ) : null;

  // Delivery failed — tell the user plainly instead of showing "a code was
  // sent to…" when no code went out ("no silent fails").
  const deliveryBanner = deliveryError ? (
    <div className="otp-step-up-modal__delivery-error" role="alert">
      <strong>We couldn&apos;t send your code.</strong> {deliveryError}
    </div>
  ) : null;

  // Demo-only reveal of the expected code, mode-aware (stub accepts any 6
  // digits; PingOne paths accept the 123123 test bypass).
  const demoCodeReveal = (
    <div className="otp-step-up-modal__demo">
      <button
        type="button"
        className="otp-step-up-modal__demo-link"
        onClick={() => setShowDemoCode((v) => !v)}
      >
        {showDemoCode ? 'Hide demo code' : 'Show demo code'}
      </button>
      {showDemoCode && (
        <div className="otp-step-up-modal__demo-box">{demoCodeHint}</div>
      )}
    </div>
  );

  // P1MFA mode

  if (mode === 'p1mfa') {
    const p1Footer = (
      <>
        {p1Step === 'otp' && (
          <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleP1OtpSubmit}>
            Verify
          </button>
        )}
        {(p1Step === 'error' || p1Step === 'push') && (
          <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleBackToDevicePicker}>
            Try another method
          </button>
        )}
        <button type="button" className="otp-step-up-modal__btn-cancel" onClick={handleCancel}>
          Cancel
        </button>
      </>
    );

    return (
      <DraggableModal
        isOpen={!!show}
        onClose={handleCancel}
        title="Verify Your Identity"
        footer={p1Footer}
        defaultWidth={440}
        defaultHeight={420}
        storageKey="otp-step-up-modal-p1mfa"
        zIndex={100080}
      >
        <div className="dm-scroll">
          {identityHeader}

          <p className="otp-step-up-modal__lead">
            {contextLine || 'Step-up authentication required to complete this action'}
          </p>

          {/* Device Picker */}
          {p1Step === 'pick-device' && (
            <div className="otp-step-up-modal__device-list">
              {devices.length > 0 ? (
                <p className="otp-step-up-modal__hint" style={{ marginBottom: 8 }}>Select a verification method:</p>
              ) : (
                <p className="otp-step-up-modal__hint" style={{ marginBottom: 8 }}>
                  No passkey is enrolled yet. Register one to verify with Touch ID, Face ID, or a security key.
                </p>
              )}
              {devices.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  className="otp-step-up-modal__device-item"
                  onClick={() => handleSelectDevice(device)}
                >
                  <span className="otp-step-up-modal__device-icon">{deviceLabel(device.type)}</span>
                  <span>{device.name || device.type || 'Unknown device'}</span>
                </button>
              ))}
              {!hasFido && onPasskeyRegistered && (
                <button
                  type="button"
                  className="otp-step-up-modal__device-item otp-step-up-modal__device-item--register"
                  onClick={handleRegisterPasskey}
                  disabled={registering}
                >
                  <span className="otp-step-up-modal__device-icon">Passkey</span>
                  <span>{registering ? 'Registering…' : 'Register a passkey'}</span>
                </button>
              )}
            </div>
          )}

          {/* Registering a passkey (WebAuthn create ceremony in progress) */}
          {p1Step === 'registering' && (
            <>
              <div className="push-waiting-spinner" style={{ margin: '16px auto' }}></div>
              <p style={{ textAlign: 'center', fontWeight: 500 }}>Registering your passkey…</p>
              <p className="otp-step-up-modal__hint">Approve with your device biometric or security key, then we&apos;ll verify automatically.</p>
            </>
          )}

          {/* OTP Input (P1MFA) */}
          {p1Step === 'otp' && (
            <>
              {deliveryBanner}
              {!deliveryError && otpContactLabel && (
                <div className="otp-step-up-modal__contact">A code was sent to {otpContactLabel}</div>
              )}
              <input
                ref={inputRef}
                type="text"
                className={`otp-step-up-modal__input ${error ? 'otp-step-up-modal__input--error' : ''}`}
                placeholder="000000"
                value={otp}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setOtp(digits);
                  if (error) setError('');
                }}
                onKeyDown={handleKeyDown}
                onPaste={handleOtpPaste}
                inputMode="numeric"
                aria-label="Verification code"
              />
              {error && <div className="otp-step-up-modal__error">{error}</div>}
              <p className="otp-step-up-modal__hint">Enter the code from your device</p>
              {demoCodeReveal}
            </>
          )}

          {/* Push Waiting */}
          {p1Step === 'push' && (
            <>
              <div className="push-waiting-spinner" style={{ margin: '16px auto' }}></div>
              <p style={{ textAlign: 'center', fontWeight: 500 }}>Push notification sent to your device</p>
              <p className="otp-step-up-modal__hint">Approve the notification on your phone</p>
            </>
          )}

          {/* FIDO Waiting */}
          {p1Step === 'fido' && (
            <>
              <p style={{ textAlign: 'center', fontWeight: 500, marginTop: 16 }}>Waiting for passkey verification…</p>
              <p className="otp-step-up-modal__hint">Use your device biometric or PIN</p>
            </>
          )}

          {/* Error */}
          {p1Step === 'error' && (
            <div className="otp-step-up-modal__error">{p1Error}</div>
          )}
        </div>
      </DraggableModal>
    );
  }

  // Stub mode rendering (original behavior)

  const stubFooter = (
    <>
      {allowFido && onPasskeyRegistered && (
        <button
          type="button"
          className="otp-step-up-modal__method-toggle"
          onClick={handleRegisterPasskey}
          disabled={registering}
        >
          {registering ? 'Setting up passkey…' : 'Register & use a passkey'}
        </button>
      )}
      <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSubmit}>
        Verify
      </button>
      <button type="button" className="otp-step-up-modal__btn-cancel" onClick={handleCancel}>
        Cancel
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={!!show}
      onClose={handleCancel}
      title="Verify Your Identity"
      footer={stubFooter}
      defaultWidth={440}
      defaultHeight={460}
      storageKey="otp-step-up-modal-stub"
      zIndex={100080}
    >
      <div className="dm-scroll">
        {identityHeader}

        <p className="otp-step-up-modal__lead">
          {contextLine || 'Step-up authentication required to complete this action'}
        </p>

        {deliveryBanner}
        {!deliveryError && otpContactLabel && (
          <div className="otp-step-up-modal__contact">A 6-digit code was sent to {otpContactLabel}</div>
        )}

        <input
          ref={inputRef}
          type="text"
          className={`otp-step-up-modal__input ${error ? 'otp-step-up-modal__input--error' : ''}`}
          placeholder="000000"
          value={otp}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
            setOtp(digits);
            if (error) setError('');
          }}
          onKeyDown={handleKeyDown}
          onPaste={handleOtpPaste}
          inputMode="numeric"
          aria-label="Verification code"
        />

        {error && <div className="otp-step-up-modal__error">{error}</div>}
        {demoCodeReveal}

        <div className="otp-step-up-modal__rfc-footer">
          <span className="otp-step-up-modal__rfc-label">
            <strong>RFC 9470</strong> — OAuth 2.0 Step-Up Authentication Challenge Protocol
          </span>
          <span className="otp-step-up-modal__rfc-detail">
            This resource requires a higher ACR than your current token provides.
            After verification, a new token with <code>acr: Multi_Factor</code> is issued — the agent retries automatically.
          </span>
          <span className="otp-step-up-modal__rfc-refs">
            RFC 9470 · RFC 6750 §3.1 (WWW-Authenticate) · RFC 8693 (token exchange)
          </span>
        </div>
      </div>
    </DraggableModal>
  );
}
