import React, { useCallback, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifySuccess } from '../../utils/appToast';
import './IdentityGate.css';

// Verifies the CUSTOMER by having them complete a real sign-on: the BFF
// drives PingOne (pi.flow) with the customer's credentials and the flow
// stops at the customer's own OTP device. The operator enters the code the
// customer reads out. On success the BFF holds the customer's token
// server-side; this component only ever sees masked contacts and expiry.
export default function IdentityGate({ vertical, customer, verified, onVerified }) {
  const [phase, setPhase] = useState('idle'); // idle | otp
  const [maskedContact, setMaskedContact] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const initiate = useCallback(async () => {
    if (!customer) return;
    setBusy(true); setError('');
    try {
      const { data } = await bffAxios.post(`/api/admin/${vertical}/verify/initiate`, { customerId: customer.id });
      setMaskedContact(data.maskedContact || "the customer's registered device");
      setPhase('otp');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Could not start the customer sign-on.');
    } finally { setBusy(false); }
  }, [vertical, customer]);

  const submitOtp = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const { data } = await bffAxios.post(`/api/admin/${vertical}/verify/otp`, { otp });
      notifySuccess('Customer verified.');
      onVerified(data.expiresAt);
      setPhase('idle');
    } catch (err) {
      setError(err?.response?.data?.message || 'Verification failed.');
      // invalid_otp (401) leaves the flow alive server-side — keep the input
      // open so the operator can retry. Anything else (expired flow, BFF
      // failure) ends it; back to idle so Verify customer can start a new one.
      if (err?.response?.status !== 401) setPhase('idle');
    } finally { setBusy(false); }
  }, [vertical, otp, onVerified]);

  if (!customer) return null;

  return (
    <div className="idgate" data-testid="identity-gate" data-verified={String(!!verified)}>
      <span className={`idgate__badge idgate__badge--${verified ? 'ok' : 'warn'}`}>
        {verified ? '✅ Identity verified' : '⚠️ Not verified'}
      </span>
      <span className="idgate__text">
        {verified
          ? `${customer.name} completed a real sign-on (pi.flow + OTP). Writes run under a delegated token.`
          : `${customer.name} must complete a real sign-on before writes are enabled.`}
      </span>
      {!verified && phase === 'idle' && (
        <button type="button" className="idgate__btn" onClick={initiate} disabled={busy}>
          {busy ? 'Starting…' : 'Verify customer'}
        </button>
      )}
      {!verified && phase === 'otp' && (
        <span className="idgate__otp">
          <label htmlFor="idgate-otp">One-time code sent to {maskedContact}</label>
          <input id="idgate-otp" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          <button type="button" className="idgate__btn" onClick={submitOtp} disabled={busy || !otp.trim()}>
            {busy ? 'Checking…' : 'Submit code'}
          </button>
        </span>
      )}
      {error && <span className="idgate__error" role="alert">{error}</span>}
    </div>
  );
}
