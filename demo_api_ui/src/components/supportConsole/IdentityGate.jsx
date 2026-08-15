import React, { useCallback, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifyError, notifySuccess } from '../../utils/appToast';
import './IdentityGate.css';

// Shows whether THIS customer has been verified in THIS operator session, and
// starts the challenge. The server refuses unverified writes regardless of what
// this renders — the strip exists so the operator learns that before clicking,
// not so the client decides it.
export default function IdentityGate({ vertical, customer, verified, onVerified }) {
  const [sending, setSending] = useState(false);

  const sendCode = useCallback(async () => {
    if (!customer) return;
    setSending(true);
    try {
      const { data } = await bffAxios.post(
        `/api/admin/${vertical}/verify/initiate`,
        { customerId: customer.id },
      );
      notifySuccess('Customer verified.');
      onVerified(data.expiresAt);
    } catch (err) {
      const status = err?.response?.status;
      notifyError(
        status === 401
          ? 'Session expired — please sign in again.'
          : err?.response?.data?.error || 'Verification failed.',
      );
    } finally {
      setSending(false);
    }
  }, [vertical, customer, onVerified]);

  if (!customer) return null;

  return (
    <div className="idgate" data-testid="identity-gate" data-verified={String(!!verified)}>
      <span className={`idgate__badge idgate__badge--${verified ? 'ok' : 'warn'}`}>
        {verified ? '✅ Identity verified' : '⚠️ Not verified'}
      </span>
      <span className="idgate__text">
        {verified
          ? `${customer.name} confirmed it is them. Writes are enabled for this session.`
          : `Read-only until ${customer.name} confirms it is them. Writes are disabled.`}
      </span>
      {!verified && (
        <button type="button" className="idgate__btn" onClick={sendCode} disabled={sending}>
          {sending ? 'Sending…' : 'Send one-time code'}
        </button>
      )}
    </div>
  );
}
