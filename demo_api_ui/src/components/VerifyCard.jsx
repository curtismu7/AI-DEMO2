import React, { useCallback, useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';
import './VerifyCard.css';

const ACTIVE_TRANSACTION_KEY = 'pingone.verify.activeTransactionId';
const CSRF_HEADER = { 'x-pingone-verify-csrf': '1' };
const POLL_DELAYS_MS = [1500, 2500, 4000, 6000, 8000, 10000, 12000, 15000];
const TERMINAL = new Set(['SUCCESS', 'FAIL', 'APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'UNKNOWN', 'EXPIRED']);

function isTerminal(status) {
  return TERMINAL.has(String(status || '').toUpperCase());
}

export default function VerifyCard() {
  const [availability, setAvailability] = useState(null);
  const [transactionId, setTransactionId] = useState(null);
  const [transaction, setTransaction] = useState(null);
  const [starting, setStarting] = useState(false);
  const [statusError, setStatusError] = useState('');
  const pollTimer = useRef(null);

  const loadAvailability = useCallback(async () => {
    try {
      const { data } = await bffAxios.get('/api/verify/availability');
      setAvailability(data);
    } catch {
      setAvailability({ enabled: false, available: false });
    }
  }, []);

  useEffect(() => {
    loadAvailability();
    const params = new URLSearchParams(window.location.search);
    const id = window.sessionStorage.getItem(ACTIVE_TRANSACTION_KEY);
    if (params.get('verify') === 'return') {
      params.delete('verify');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    if (id) setTransactionId(id);
    return undefined;
  }, [loadAvailability]);

  useEffect(() => {
    if (!transactionId) return undefined;
    let disposed = false;
    let attempt = 0;

    const poll = async () => {
      if (disposed) return;
      try {
        const { data } = await bffAxios.get(`/api/verify/transactions/${encodeURIComponent(transactionId)}`);
        if (disposed) return;
        setTransaction(data);
        setStatusError('');
        if (isTerminal(data.status)) {
          window.sessionStorage.removeItem(ACTIVE_TRANSACTION_KEY);
          return;
        }
      } catch {
        if (!disposed) setStatusError('We could not check the verification status. Try again in a moment.');
      }

      if (attempt >= POLL_DELAYS_MS.length) return;
      const delay = POLL_DELAYS_MS[attempt++];
      pollTimer.current = window.setTimeout(poll, delay);
    };

    poll();
    return () => {
      disposed = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [transactionId]);

  const handleStart = async () => {
    setStarting(true);
    setStatusError('');
    try {
      const { data } = await bffAxios.post('/api/verify/transactions', {}, { headers: CSRF_HEADER });
      if (!data?.id || !data?.webVerificationUrl) throw new Error('Invalid verification response');
      window.sessionStorage.setItem(ACTIVE_TRANSACTION_KEY, data.id);
      window.location.assign(data.webVerificationUrl);
    } catch {
      setStatusError('We could not start identity verification. Please try again later.');
      setStarting(false);
    }
  };

  if (!availability?.enabled) return null;

  return (
    <section className="up-card up-verify-card" aria-labelledby="up-verify-title">
      <div className="up-card__header">
        <span className="up-card__title" id="up-verify-title">Identity verification</span>
      </div>
      {!availability.available && (
        <p className="up-verify-card__message">Identity verification is not available for this account or environment.</p>
      )}
      {availability.available && !transaction && !transactionId && (
        <>
          <p className="up-verify-card__message">Verify your identity through PingOne's hosted verification experience.</p>
          <button type="button" className="up-btn up-btn--edit" onClick={handleStart} disabled={starting}>
            {starting ? 'Starting verification…' : 'Verify identity'}
          </button>
        </>
      )}
      {availability.available && !transaction && transactionId && (
        <p className="up-verify-card__message" aria-live="polite">Checking your existing verification status with PingOne…</p>
      )}
      {availability.available && transaction && (
        <div aria-live="polite">
          <p className={`up-verify-card__status up-verify-card__status--${String(transaction.status || '').toLowerCase()}`}>
            {transaction.status === 'SUCCESS' && 'Identity verification complete.'}
            {transaction.status === 'FAIL' && 'Identity verification was not successful.'}
            {transaction.status === 'EXPIRED' && 'This verification request expired.'}
            {!isTerminal(transaction.status) && `Verification status: ${transaction.status || 'pending'}.`}
            {['APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'UNKNOWN'].includes(transaction.status) && ' This status does not complete automated identity proofing.'}
          </p>
          {!isTerminal(transaction.status) && (
            <p className="up-verify-card__message">Checking with PingOne… This page will update when the transaction finishes.</p>
          )}
          {transaction.status === 'SUCCESS' && !transaction.canEnrollRecognize && (
            <p className="up-verify-card__message">Recognize enrollment will be available after its tenant setup and result-validation contract are confirmed.</p>
          )}
        </div>
      )}
      {statusError && <p className="up-verify-card__error" role="alert">{statusError}</p>}
      {transaction && isTerminal(transaction.status) && transaction.status !== 'SUCCESS' && availability.available && (
        <button type="button" className="up-btn up-btn--secondary" onClick={() => { setTransaction(null); setTransactionId(null); }}>
          Start a new verification
        </button>
      )}
    </section>
  );
}
