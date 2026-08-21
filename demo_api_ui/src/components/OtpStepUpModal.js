import { useState, useRef, useEffect } from 'react';
import DraggableModal from './DraggableModal';
import { registerPasskey, normalizePublicKeyRequestOptions } from '../utils/passkeyCeremony';
import { normalizePhoneE164, describePasskeyRegistrationError } from '../utils/mfaEnrollment';

/**
 * Find an email OTP device from a PingOne MFA device list.
 * @param {Array} devices
 * @returns {object|null}
 */
function findEmailDevice(devices) {
  return (devices || []).find((d) => {
    const t = String(d?.type || '').toUpperCase();
    return t === 'EMAIL' || (t.includes('OTP') && t !== 'SMS' && !t.includes('SMS'));
  }) || null;
}

/**
 * Find an SMS OTP device from a PingOne MFA device list.
 * @param {Array} devices
 * @returns {object|null}
 */
function findSmsDevice(devices) {
  return (devices || []).find((d) => {
    const t = String(d?.type || '').toUpperCase();
    return t === 'SMS' || t === 'PHONE' || t === 'MOBILE_PHONE';
  }) || null;
}

/**
 * Mask a phone number for display (last 4 digits only).
 * @param {object|string|null} deviceOrPhone
 * @returns {string}
 */
function maskPhone(deviceOrPhone) {
  const raw = typeof deviceOrPhone === 'string'
    ? deviceOrPhone
    : (deviceOrPhone?.phone?.number || deviceOrPhone?.phone || deviceOrPhone?.nickname || deviceOrPhone?.name || '');
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length >= 4) return `***-***-${digits.slice(-4)}`;
  return raw ? String(raw) : '';
}

/**
 * Find a FIDO2 / passkey device from a PingOne MFA device list.
 * @param {Array} devices
 * @returns {object|null}
 */
function findFidoDevice(devices) {
  return (devices || []).find((d) =>
    String(d?.type || '').toUpperCase().startsWith('FIDO2'),
  ) || null;
}

/**
 * Extra enrolled methods (TOTP / push) shown below the always-on OTP + Passkey rows.
 * @param {Array} devices
 * @returns {Array}
 */
function findExtraDevices(devices) {
  return (devices || []).filter((d) => {
    const t = String(d?.type || '').toUpperCase();
    return t === 'TOTP' || t === 'PUSH' || t.includes('MOBILE');
  });
}

/**
 * Whether the browser can run WebAuthn passkey ceremonies.
 * @returns {boolean}
 */
function isPasskeySupported() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

/**
 * Professional method-choice table: always lists Email OTP + Passkey.
 * Optional extra enrolled devices appear as additional rows.
 */
function MethodChoiceTable({
  otpContactLabel,
  smsContactLabel,
  smsEnrolled,
  hasFido,
  passkeySupported,
  registering,
  onChooseOtp,
  onChooseSms,
  onChoosePasskey,
  extraRows = [],
}) {
  const passkeyDetail = !passkeySupported
    ? 'Not available in this browser'
    : hasFido
      ? 'Use Touch ID, Face ID, or your security key'
      : 'Set up Touch ID, Face ID, or a security key';
  const passkeyCta = !passkeySupported
    ? 'Unavailable'
    : registering
      ? 'Working…'
      : hasFido
        ? 'Continue →'
        : 'Set up →';
  const smsDetail = smsEnrolled
    ? (smsContactLabel
      ? `Text a 6-digit code to ${smsContactLabel}`
      : 'Text a 6-digit code to your phone')
    : 'Set up SMS OTP on your phone (E.164)';
  const smsCta = smsEnrolled ? 'Continue →' : 'Set up →';

  return (
    <div className="otp-step-up-modal__method-table-wrap">
      <p className="otp-step-up-modal__hint otp-step-up-modal__method-intro">
        Choose how you want to verify your identity
      </p>
      <table className="otp-step-up-modal__method-table" role="table">
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Details</th>
            <th scope="col"><span className="otp-step-up-modal__sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr className="otp-step-up-modal__method-row">
            <td>
              <span className="otp-step-up-modal__method-name">
                <span className="otp-step-up-modal__method-badge" aria-hidden>OTP</span>
                Email code
              </span>
            </td>
            <td className="otp-step-up-modal__method-detail">
              {otpContactLabel
                ? `Send a 6-digit code to ${otpContactLabel}`
                : 'Send a 6-digit code to your email'}
            </td>
            <td>
              <button
                type="button"
                className="otp-step-up-modal__method-cta"
                onClick={onChooseOtp}
                data-testid="mfa-choose-otp"
              >
                Continue →
              </button>
            </td>
          </tr>
          <tr className={`otp-step-up-modal__method-row${smsEnrolled ? '' : ' otp-step-up-modal__method-row--setup'}`}>
            <td>
              <span className="otp-step-up-modal__method-name">
                <span className="otp-step-up-modal__method-badge otp-step-up-modal__method-badge--sms" aria-hidden>SMS</span>
                SMS code
              </span>
            </td>
            <td className="otp-step-up-modal__method-detail">{smsDetail}</td>
            <td>
              <button
                type="button"
                className="otp-step-up-modal__method-cta"
                onClick={onChooseSms}
                data-testid="mfa-choose-sms"
              >
                {smsCta}
              </button>
            </td>
          </tr>
          <tr className={`otp-step-up-modal__method-row${hasFido ? '' : ' otp-step-up-modal__method-row--setup'}`}>
            <td>
              <span className="otp-step-up-modal__method-name">
                <span className="otp-step-up-modal__method-badge otp-step-up-modal__method-badge--passkey" aria-hidden>KEY</span>
                Passkey
              </span>
            </td>
            <td className="otp-step-up-modal__method-detail">{passkeyDetail}</td>
            <td>
              <button
                type="button"
                className="otp-step-up-modal__method-cta"
                onClick={onChoosePasskey}
                disabled={!passkeySupported || registering}
                data-testid="mfa-choose-passkey"
              >
                {passkeyCta}
              </button>
            </td>
          </tr>
          {extraRows.map((row) => (
            <tr key={row.id} className="otp-step-up-modal__method-row">
              <td>
                <span className="otp-step-up-modal__method-name">
                  <span className="otp-step-up-modal__method-badge otp-step-up-modal__method-badge--extra" aria-hidden>
                    {row.badge}
                  </span>
                  {row.label}
                </span>
              </td>
              <td className="otp-step-up-modal__method-detail">{row.detail}</td>
              <td>
                <button
                  type="button"
                  className="otp-step-up-modal__method-cta"
                  onClick={row.onSelect}
                  data-testid={`mfa-choose-extra-${row.id}`}
                >
                  Continue →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * OtpStepUpModal — MFA collection modal for HITL step-up challenges.
 *
 * Modes:
 *   - "stub" (default): method choice table → OTP input | passkey setup
 *   - "p1mfa": method choice table → PingOne OTP / push / FIDO complete
 *
 * Always offers Email OTP, SMS OTP, and Passkey on the same screen as a choice table.
 * Existing OTP entry UI is preserved after the user selects Email or SMS code.
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
  const [stubStep, setStubStep] = useState('choose'); // 'choose' | 'otp' | 'sms-enroll-phone' | 'sms-enroll-otp'
  const [otpChannel, setOtpChannel] = useState('email'); // 'email' | 'sms'
  const [smsPhone, setSmsPhone] = useState('');
  const [smsEnrollDeviceId, setSmsEnrollDeviceId] = useState(null);
  const [smsBusy, setSmsBusy] = useState(false);
  const inputRef = useRef(null);

  // P1MFA state machine
  const [p1Step, setP1Step] = useState('pick-device');
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [p1Error, setP1Error] = useState('');
  const [otpResending, setOtpResending] = useState(false);
  const pollRef = useRef(null);
  // Keep a ref to the current daId so startPushPolling always polls the live value.
  const daIdRef = useRef(daId);
  daIdRef.current = daId;

  // Which address the code was sent to (masked PingOne contact, else the
  // signed-in user's email). Answers "what email do I get the OTP from?".
  const emailContactLabel = maskedContact || userIdentity?.email || '';
  const fidoEnrolled = !!findFidoDevice(devices);
  const emailDevice = findEmailDevice(devices);
  const smsDevice = findSmsDevice(devices);
  const smsEnrolled = !!smsDevice;
  const smsContactLabel = maskPhone(smsDevice) || maskPhone(userIdentity?.phone) || '';
  const otpContactLabel = otpChannel === 'sms'
    ? (smsContactLabel || 'your phone')
    : emailContactLabel;
  const passkeySupported = isPasskeySupported();
  // Demo OTP hint depends on the path: the stub path does not verify the code
  // (any 6 digits pass), the PingOne paths accept the 123123 test bypass.
  const demoCodeHint = mode === 'p1mfa'
    ? 'Demo bypass code: 123123 (or the real code from your device)'
    : 'Demo bypass code: 123123';

  const apiBase = process.env.REACT_APP_API_URL || '';

  // Auto-focus OTP input when the OTP step shows
  useEffect(() => {
    if (show && mode === 'stub' && stubStep === 'otp' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [show, mode, stubStep]);

  useEffect(() => {
    if (show && mode === 'p1mfa' && p1Step === 'otp' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [show, mode, p1Step]);

  // Reset to method choice when modal opens.
  useEffect(() => {
    if (!show) return;
    setStubStep('choose');
    setOtp('');
    setError('');
    setShowDemoCode(false);
    setOtpChannel('email');
    setSmsPhone(userIdentity?.phone ? String(userIdentity.phone) : '');
    setSmsEnrollDeviceId(null);
    setSmsBusy(false);
    if (mode === 'p1mfa') {
      setP1Step('pick-device');
      setSelectedDeviceId(null);
      setP1Error('');
    }
  }, [show, mode, userIdentity?.phone]);

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
    setStubStep('choose');
    if (pollRef.current) clearInterval(pollRef.current);
    onCancel();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (mode === 'stub' && stubStep === 'otp') handleSubmit();
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

  /** Re-select the same Email/SMS device so PingOne sends a fresh code. */
  const handleResendOtp = async () => {
    if (otpResending) return;
    if (mode === 'p1mfa' && selectedDeviceId) {
      const device = (devices || []).find((d) => d.id === selectedDeviceId);
      if (!device) {
        setError('Go back to Methods and choose Email or SMS again.');
        return;
      }
      setOtpResending(true);
      setError('');
      try {
        await handleSelectDevice(device);
        setOtp('');
      } finally {
        setOtpResending(false);
      }
      return;
    }
    setError('Go back to Methods and choose Email or SMS again to resend.');
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
      const rawOptions = statusData.publicKeyCredentialRequestOptions;

      if (!rawOptions) throw new Error('No FIDO options available');

      // PingOne returns these options as a JSON *string*, with challenge and
      // allowCredentials[].id as signed byte arrays (not base64url strings).
      // normalizePublicKeyRequestOptions parses + decodes both shapes; a
      // string-only decoder here threw before navigator.credentials.get() ever ran.
      const options = normalizePublicKeyRequestOptions(rawOptions);

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
      // A FIDO2 device on the ACCOUNT does not mean its credential exists on
      // THIS device — a passkey saved to a phone or another laptop lands here
      // too, and the browser reports the same NotAllowedError. Offer to
      // register one locally instead of dead-ending, regardless of fidoEnrolled.
      if ((err?.name === 'NotAllowedError' || err?.message?.includes('No credential')) && onPasskeyRegistered) {
        setP1Step('passkey-register-offer');
        setP1Error('');
        setOtp('');
      } else {
        setP1Step('error');
        setP1Error('Passkey verification failed. Try another method.');
      }
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
      const fido = findFidoDevice(freshDevices);
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
      const msg = describePasskeyRegistrationError(err);
      setP1Step('error');
      setP1Error(msg);
      setError(msg);
    } finally {
      setRegistering(false);
    }
  };

  const handleBackToMethodChoice = () => {
    setStubStep('choose');
    setP1Step('pick-device');
    setP1Error('');
    setOtp('');
    setError('');
    setOtpChannel('email');
    setSmsEnrollDeviceId(null);
    setSmsBusy(false);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  /**
   * Refresh MFA challenge devices after SMS enroll (reuses passkey refresh hook
   * when provided) so the new SMS device is selectable.
   */
  const refreshChallengeDevices = async () => {
    if (typeof onPasskeyRegistered === 'function') {
      return onPasskeyRegistered();
    }
    const resp = await fetch(`${apiBase}/api/auth/mfa/challenge`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) throw new Error(`MFA initiation failed: ${resp.status}`);
    const data = await resp.json();
    return { daId: data.daId, devices: data.devices || [] };
  };

  /** After SMS is enrolled, start a challenge and select the SMS device (sends OTP). */
  const startSmsChallengeWithFreshDevices = async () => {
    const fresh = await refreshChallengeDevices();
    const sms = findSmsDevice(fresh?.devices || []);
    if (!fresh?.daId || !sms) {
      throw new Error('SMS device enrolled but not returned by MFA challenge.');
    }
    setOtpChannel('sms');
    await handleSelectDevice(sms, fresh.daId);
  };

  /** User picked Email OTP from the choice table. */
  const handleChooseOtp = () => {
    setError('');
    setP1Error('');
    setOtpChannel('email');
    if (mode === 'stub') {
      setStubStep('otp');
      return;
    }
    if (emailDevice) {
      handleSelectDevice(emailDevice);
      return;
    }
    // No email device enrolled — fall through to the local OTP stub UI so the
    // demo can still collect a code (demo bypass 123123).
    setStubStep('otp');
    setP1Step('otp-stub');
  };

  /** Begin SMS enrollment (phone entry). */
  const beginSmsEnroll = () => {
    setOtpChannel('sms');
    setSmsEnrollDeviceId(null);
    setP1Step('sms-enroll-phone');
    setStubStep('sms-enroll-phone');
  };

  /** User picked SMS from the choice table — challenge enrolled device or enroll. */
  const handleChooseSms = () => {
    setError('');
    setP1Error('');
    setOtpChannel('sms');
    if (smsDevice && mode === 'p1mfa') {
      handleSelectDevice(smsDevice);
      return;
    }
    if (smsDevice && mode === 'stub') {
      // Stub mode with an enrolled SMS device still needs a real PingOne challenge.
      (async () => {
        try {
          setSmsBusy(true);
          await startSmsChallengeWithFreshDevices();
        } catch (err) {
          console.error('[OtpStepUpModal] SMS challenge error:', err);
          setP1Error(err?.message || 'Could not start SMS verification.');
          setP1Step('error');
        } finally {
          setSmsBusy(false);
        }
      })();
      return;
    }
    beginSmsEnroll();
  };

  /** POST /enroll/sms-init — PingOne texts an activation OTP. */
  const handleSmsEnrollInit = async () => {
    const phone = normalizePhoneE164(smsPhone);
    if (!phone || phone.length < 10) {
      setError('Enter a phone number in E.164 format, e.g. +15551234567');
      return;
    }
    setError('');
    setP1Error('');
    setSmsBusy(true);
    try {
      const resp = await fetch(`${apiBase}/api/auth/mfa/enroll/sms-init`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.message || data.error || `SMS enroll failed (${resp.status})`);
      }
      const status = String(data.status || '').toUpperCase();
      // Worker-token enroll can return ACTIVE immediately — skip activation OTP.
      if (status === 'ACTIVE' || status === 'ENABLED') {
        await startSmsChallengeWithFreshDevices();
        return;
      }
      if (!data.deviceId) throw new Error('SMS enroll did not return a deviceId');
      setSmsEnrollDeviceId(data.deviceId);
      setOtp('');
      setP1Step('sms-enroll-otp');
      setStubStep('sms-enroll-otp');
    } catch (err) {
      console.error('[OtpStepUpModal] SMS enroll init error:', err);
      setError(err?.message || 'Failed to start SMS enrollment');
      setP1Error(err?.message || 'Failed to start SMS enrollment');
    } finally {
      setSmsBusy(false);
    }
  };

  /** POST /enroll/sms-complete — activate device, then run step-up challenge. */
  const handleSmsEnrollComplete = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code from your SMS');
      return;
    }
    if (!smsEnrollDeviceId) {
      setError('SMS enrollment session missing — go back and try again');
      return;
    }
    setError('');
    setSmsBusy(true);
    try {
      const resp = await fetch(`${apiBase}/api/auth/mfa/enroll/sms-complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: smsEnrollDeviceId, otp }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.message || data.error || `SMS activate failed (${resp.status})`);
      }
      setOtp('');
      setSmsEnrollDeviceId(null);
      await startSmsChallengeWithFreshDevices();
    } catch (err) {
      console.error('[OtpStepUpModal] SMS enroll complete error:', err);
      setError(err?.message || 'Failed to activate SMS device');
    } finally {
      setSmsBusy(false);
    }
  };

  /** User picked Passkey from the choice table. */
  const handleChoosePasskey = () => {
    setError('');
    setP1Error('');
    if (!passkeySupported) return;
    const fido = findFidoDevice(devices);
    if (mode === 'p1mfa' && fido) {
      handleSelectDevice(fido);
      return;
    }
    // Enroll then authenticate (works for stub and p1mfa-without-passkey).
    handleRegisterPasskey();
  };

  const deviceLabel = (type) => {
    switch (type?.toLowerCase()) {
      case 'email': return 'Email';
      case 'totp': return 'Authenticator';
      case 'fido2': return 'Passkey';
      case 'push': return 'Push';
      default: return 'Device';
    }
  };

  const extraMethodRows = mode === 'p1mfa'
    ? findExtraDevices(devices).map((device) => ({
      id: device.id,
      badge: deviceLabel(device.type).slice(0, 4).toUpperCase(),
      label: deviceLabel(device.type),
      detail: device.name || `Use your enrolled ${deviceLabel(device.type).toLowerCase()} device`,
      onSelect: () => handleSelectDevice(device),
    }))
    : [];

  /**
   * Shown when the browser could not find a passkey for this site on THIS
   * device. The account may still have one registered elsewhere, so the way
   * out is to register a local passkey — not to give up on the method.
   */
  const passkeyRegisterOfferPanel = (
    <div className="otp-step-up-modal__passkey-offer">
      <p className="otp-step-up-modal__lead">
        No passkey for this site was found on this device.
      </p>
      <p className="otp-step-up-modal__lead">
        If your passkey is saved on another device, use the browser prompt to scan its
        QR code. Otherwise, register one here to verify with Touch ID, Face ID, or a
        security key on this device.
      </p>
      <div className="otp-step-up-modal__actions" style={{ flexDirection: 'column', gap: '0.75rem' }}>
        <button
          type="button"
          className="otp-step-up-modal__btn-primary"
          onClick={handleRegisterPasskey}
          disabled={registering}
          data-testid="mfa-register-passkey-here"
        >
          {registering ? 'Registering…' : 'Register a passkey on this device'}
        </button>
        <button
          type="button"
          className="otp-step-up-modal__btn-ghost"
          onClick={handleBackToMethodChoice}
          data-testid="mfa-passkey-offer-back"
        >
          ← Choose another method
        </button>
      </div>
    </div>
  );

  const methodTable = (
    <MethodChoiceTable
      otpContactLabel={emailContactLabel}
      smsContactLabel={smsContactLabel}
      smsEnrolled={smsEnrolled}
      hasFido={fidoEnrolled}
      passkeySupported={passkeySupported && (!!onPasskeyRegistered || fidoEnrolled || allowFido)}
      registering={registering || smsBusy}
      onChooseOtp={handleChooseOtp}
      onChooseSms={handleChooseSms}
      onChoosePasskey={handleChoosePasskey}
      extraRows={extraMethodRows}
    />
  );

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

  /** Shared OTP entry panel (stub + p1mfa after method choice). */
  const otpEntryPanel = (
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
      <p className="otp-step-up-modal__hint">
        Enter the 6-digit code from your {otpChannel === 'sms' ? 'text message' : 'email'}
      </p>
      {demoCodeReveal}
    </>
  );


  /** SMS enrollment panels (phone → activation OTP). */
  const smsEnrollPhonePanel = (
    <div className="otp-step-up-modal__sms-enroll" data-testid="mfa-sms-enroll-phone">
      <p className="otp-step-up-modal__hint" style={{ marginBottom: 8 }}>
        Enter the mobile number that should receive SMS codes (E.164).
      </p>
      <input
        type="tel"
        className={`otp-step-up-modal__input ${error ? 'otp-step-up-modal__input--error' : ''}`}
        placeholder="+15551234567"
        value={smsPhone}
        onChange={(e) => { setSmsPhone(e.target.value); if (error) setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSmsEnrollInit(); }}
        aria-label="Mobile phone number"
        autoFocus
      />
      {error && <div className="otp-step-up-modal__error">{error}</div>}
      <p className="otp-step-up-modal__hint">Example: +1 555 123 4567 — we&apos;ll text an activation code first.</p>
    </div>
  );

  const smsEnrollOtpPanel = (
    <div className="otp-step-up-modal__sms-enroll" data-testid="mfa-sms-enroll-otp">
      <div className="otp-step-up-modal__contact">
        Enter the activation code texted to {maskPhone(smsPhone) || 'your phone'}
      </div>
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
        onKeyDown={(e) => { if (e.key === 'Enter') handleSmsEnrollComplete(); }}
        onPaste={handleOtpPaste}
        inputMode="numeric"
        aria-label="SMS activation code"
      />
      {error && <div className="otp-step-up-modal__error">{error}</div>}
      <p className="otp-step-up-modal__hint">This activates SMS on your account, then we send the step-up code.</p>
      {demoCodeReveal}
    </div>
  );

  // P1MFA mode

  if (mode === 'p1mfa') {
    const showingOtp = p1Step === 'otp' || p1Step === 'otp-stub';
    const showingSmsEnroll = p1Step === 'sms-enroll-phone' || p1Step === 'sms-enroll-otp';
    const p1Footer = (
      <>
        {(showingOtp || showingSmsEnroll || p1Step === 'error' || p1Step === 'push' || p1Step === 'fido') && (
          <button type="button" className="otp-step-up-modal__btn-ghost" onClick={handleBackToMethodChoice}>
            ← Methods
          </button>
        )}
        {p1Step === 'sms-enroll-phone' && (
          <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSmsEnrollInit} disabled={smsBusy}>
            {smsBusy ? 'Sending…' : 'Send activation code'}
          </button>
        )}
        {p1Step === 'sms-enroll-otp' && (
          <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSmsEnrollComplete} disabled={smsBusy}>
            {smsBusy ? 'Activating…' : 'Activate SMS'}
          </button>
        )}
        {p1Step === 'otp' && (
          <>
            <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleP1OtpSubmit}>
              Verify
            </button>
            <button
              type="button"
              className="otp-step-up-modal__btn-ghost"
              onClick={handleResendOtp}
              disabled={otpResending}
              data-testid="otp-resend"
            >
              {otpResending ? 'Sending…' : 'Resend code'}
            </button>
          </>
        )}
        {p1Step === 'otp-stub' && (
          <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSubmit}>
            Verify
          </button>
        )}
        {(p1Step === 'error' || p1Step === 'push') && (
          <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleBackToMethodChoice}>
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
        className="otp-step-up-draggable"
        defaultWidth={840}
        defaultHeight={760}
        minWidth={360}
        minHeight={360}
        storageKey="otp-step-up-modal-p1mfa-v3"
        zIndex={100080}
      >
        <div className="dm-scroll">
          {identityHeader}

          <p className="otp-step-up-modal__lead">
            {contextLine || 'Step-up authentication required to complete this action'}
          </p>

          {p1Step === 'pick-device' && methodTable}
          {p1Step === 'passkey-register-offer' && passkeyRegisterOfferPanel}
          {p1Step === 'sms-enroll-phone' && smsEnrollPhonePanel}
          {p1Step === 'sms-enroll-otp' && smsEnrollOtpPanel}

          {/* Registering a passkey (WebAuthn create ceremony in progress) */}
          {p1Step === 'registering' && (
            <>
              <div className="push-waiting-spinner" style={{ margin: '16px auto' }}></div>
              <p style={{ textAlign: 'center', fontWeight: 500 }}>Registering your passkey…</p>
              <p className="otp-step-up-modal__hint">Approve with your device biometric or security key, then we&apos;ll verify automatically.</p>
            </>
          )}

          {showingOtp && otpEntryPanel}

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

  // Stub mode — method choice first, then existing OTP UI

  const stubShowRegistering = registering || p1Step === 'registering';
  const stubShowPasskeyError = p1Step === 'error' && !!p1Error;
  const stubShowPasskeyOffer = p1Step === 'passkey-register-offer';
  const stubSmsEnroll = stubStep === 'sms-enroll-phone' || stubStep === 'sms-enroll-otp' || p1Step === 'sms-enroll-phone' || p1Step === 'sms-enroll-otp';
  const showSmsPhone = stubStep === 'sms-enroll-phone' || p1Step === 'sms-enroll-phone';
  const showSmsOtp = stubStep === 'sms-enroll-otp' || p1Step === 'sms-enroll-otp';

  const stubFooter = (
    <>
      {(stubStep === 'otp' || stubSmsEnroll || stubShowPasskeyError) && (
        <button type="button" className="otp-step-up-modal__btn-ghost" onClick={handleBackToMethodChoice}>
          ← Methods
        </button>
      )}
      {showSmsPhone && (
        <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSmsEnrollInit} disabled={smsBusy}>
          {smsBusy ? 'Sending…' : 'Send activation code'}
        </button>
      )}
      {showSmsOtp && (
        <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSmsEnrollComplete} disabled={smsBusy}>
          {smsBusy ? 'Activating…' : 'Activate SMS'}
        </button>
      )}
      {stubStep === 'otp' && (
        <button type="button" className="otp-step-up-modal__btn-primary" onClick={handleSubmit}>
          Verify
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
        footer={stubFooter}
        className="otp-step-up-draggable"
        defaultWidth={460}
        defaultHeight={stubStep === 'choose' ? 400 : 480}
        minWidth={360}
        minHeight={320}
        storageKey="otp-step-up-modal-stub-v2"

      zIndex={100080}
    >
      <div className="dm-scroll">
        {identityHeader}

        <p className="otp-step-up-modal__lead">
          {contextLine || 'Step-up authentication required to complete this action'}
        </p>

        {stubStep === 'choose' && !stubShowRegistering && !stubShowPasskeyError && !stubShowPasskeyOffer && !stubSmsEnroll && methodTable}
        {stubShowPasskeyOffer && passkeyRegisterOfferPanel}
        {showSmsPhone && smsEnrollPhonePanel}
        {showSmsOtp && smsEnrollOtpPanel}

        {stubShowRegistering && (
          <>
            <div className="push-waiting-spinner" style={{ margin: '16px auto' }}></div>
            <p style={{ textAlign: 'center', fontWeight: 500 }}>Registering your passkey…</p>
            <p className="otp-step-up-modal__hint">Approve with your device biometric or security key, then we&apos;ll verify automatically.</p>
          </>
        )}

        {stubShowPasskeyError && (
          <div className="otp-step-up-modal__error">{p1Error}</div>
        )}

        {stubStep === 'otp' && (
          <>
            {otpEntryPanel}
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
          </>
        )}

        {error && stubStep === 'choose' && !stubShowPasskeyError && (
          <div className="otp-step-up-modal__error">{error}</div>
        )}
      </div>
    </DraggableModal>
  );
}
