import React, { useCallback, useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { StatusChip } from './pingUi';
import './VerifyCard.css';

const ACTIVE_TRANSACTION_KEY = 'pingone.verify.activeTransactionId';
const LAST_TRANSACTION_KEY = 'pingone.verify.lastTransactionId';
const CSRF_HEADER = { 'x-pingone-verify-csrf': '1' };
const POLL_DELAYS_MS = [1500, 2500, 4000, 6000, 8000, 10000, 15000, 30000];
const TERMINAL = new Set(['SUCCESS', 'FAIL', 'APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'UNKNOWN', 'EXPIRED']);

function isTerminal(status) {
  return TERMINAL.has(String(status || '').toUpperCase());
}

const NOT_PROOFING = ['APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'UNKNOWN'];

/** The word and tone for the Ping UI chip, from what the BFF reported. Used only when `ping` is set. */
function pingState(availability, transactionId, transaction) {
  if (transaction) {
    if (transaction.status === 'SUCCESS') return { tone: 'ok', word: 'Verified' };
    if (transaction.status === 'FAIL') return { tone: 'danger', word: 'Not verified' };
    if (transaction.status === 'EXPIRED') return { tone: 'warn', word: 'Expired' };
    if (NOT_PROOFING.includes(transaction.status)) return { tone: 'neutral', word: 'Not confirmed' };
    return { tone: 'info', word: 'In progress' };
  }
  if (!availability) return { tone: 'neutral', word: 'Checking' };
  if (availability.error) return { tone: 'warn', word: 'Unavailable' };
  if (!availability.enabled) return { tone: 'neutral', word: 'Disabled' };
  if (!availability.available) return { tone: 'neutral', word: 'Not eligible' };
  if (transactionId) return { tone: 'info', word: 'Checking' };
  return { tone: 'info', word: 'Ready' };
}

/**
 * `ping` opts into the Ping UI Standard look (shared primitives, docs/ping-ui-primitives.md): a pu-card with a
 * word-bearing status chip, pu-btn buttons (Verify identity and Start a new verification are each the only action
 * in their state, so each is the one primary), aria-disabled while a start is in flight so keyboard focus stays on
 * the button, and focus handed to the new primary after "Start a new verification". It must sit inside a PingPage.
 * Off by default: Profile and every other caller render exactly as before.
 */
export default function VerifyCard({ compact = false, showDisabled = false, ping = false }) {
  const [availability, setAvailability] = useState(null);
  const [transactionId, setTransactionId] = useState(null);
  const [transaction, setTransaction] = useState(null);
  const [starting, setStarting] = useState(false);
  const [statusError, setStatusError] = useState('');
  const pollTimer = useRef(null);
  const startRef = useRef(null);
  const refocusStart = useRef(false);

  const loadAvailability = useCallback(async () => {
    try {
      const { data } = await bffAxios.get('/api/verify/availability');
      setAvailability(data);
    } catch {
      setAvailability({ enabled: false, available: false, error: true });
    }
  }, []);

  useEffect(() => {
    loadAvailability();
    const params = new URLSearchParams(window.location.search);
    const activeId = window.sessionStorage.getItem(ACTIVE_TRANSACTION_KEY);
    const id = activeId || (compact ? window.sessionStorage.getItem(LAST_TRANSACTION_KEY) : null);
    if (params.get('verify') === 'return') {
      params.delete('verify');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    if (id) setTransactionId(id);
    return undefined;
  }, [compact, loadAvailability]);

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
          window.sessionStorage.setItem(LAST_TRANSACTION_KEY, transactionId);
          return;
        }
      } catch (error) {
        if (disposed) return;
        const responseStatus = Number(error?.response?.status);
        if (responseStatus >= 400 && responseStatus < 500 && ![408, 429].includes(responseStatus)) {
          if (responseStatus === 404) {
            window.sessionStorage.removeItem(ACTIVE_TRANSACTION_KEY);
            window.sessionStorage.removeItem(LAST_TRANSACTION_KEY);
            setTransaction(null);
            setTransactionId(null);
            setStatusError('This verification request is no longer available. Start a new verification.');
          } else {
            setStatusError('We could not check this verification status. Sign in again and reload this page.');
          }
          return;
        }
        setStatusError('We could not check the verification status. We will try again automatically.');
      }

      const delay = POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
      attempt = Math.min(attempt + 1, POLL_DELAYS_MS.length - 1);
      pollTimer.current = window.setTimeout(poll, delay);
    };

    poll();
    return () => {
      disposed = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [transactionId]);

  useEffect(() => {
    if (refocusStart.current && startRef.current) {
      refocusStart.current = false;
      startRef.current.focus();
    }
  });

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    setStatusError('');
    try {
      const { data } = await bffAxios.post('/api/verify/transactions', {}, { headers: CSRF_HEADER });
      if (!data?.id || !data?.webVerificationUrl) throw new Error('Invalid verification response');
      window.sessionStorage.setItem(ACTIVE_TRANSACTION_KEY, data.id);
      window.sessionStorage.removeItem(LAST_TRANSACTION_KEY);
      window.location.assign(data.webVerificationUrl);
    } catch {
      setStatusError('We could not start identity verification. Please try again later.');
      setStarting(false);
    }
  };

  if (!availability?.enabled && !showDisabled && !compact) return null;

  const state = ping ? pingState(availability, transactionId, transaction) : null;
  const msg = ping ? 'pu-note' : 'up-verify-card__message';
  const startNew = () => {
    refocusStart.current = ping;
    setTransaction(null);
    setTransactionId(null);
  };

  return (
    <section
      className={ping ? `pu-card pu-card--${state.tone === 'info' ? 'live' : state.tone} pvr-verify-card` : `up-card up-verify-card${compact ? ' up-verify-card--compact' : ''}`}
      aria-labelledby="up-verify-title"
    >
      {ping ? (
        <>
          <h3 className="pu-h3" id="up-verify-title">Identity verification</h3>
          <p className="pu-status-line" role="status"><StatusChip tone={state.tone}>{state.word}</StatusChip></p>
        </>
      ) : (
        <div className="up-card__header">
          <span className="up-card__title" id="up-verify-title">Identity verification</span>
        </div>
      )}
      {!availability && (
        <p className={msg} aria-live="polite">Checking PingOne Verify availability…</p>
      )}
      {availability?.error && (
        <p className={msg}>We could not check PingOne Verify availability. Sign in and try again.</p>
      )}
      {availability && !availability.error && !availability.enabled && (
        <p className={msg}>PingOne Verify is disabled for this environment.</p>
      )}
      {availability?.enabled && !availability.available && (
        <p className={msg}>Identity verification is not available for this account or environment.</p>
      )}
      {availability?.available && !transaction && !transactionId && (
        <>
          <p className={msg}>Verify your identity through PingOne's hosted verification experience.</p>
          {!compact && (
            <button
              type="button"
              ref={startRef}
              className={ping ? 'pu-btn pu-btn--primary' : 'up-btn up-btn--edit'}
              onClick={handleStart}
              disabled={ping ? undefined : starting}
              aria-disabled={ping && starting ? 'true' : undefined}
            >
              {starting ? 'Starting verification…' : 'Verify identity'}
            </button>
          )}
          {compact && <p className={msg}>No verification is in progress. Start one from the product page.</p>}
        </>
      )}
      {availability?.available && !transaction && transactionId && (
        <p className={msg} aria-live="polite">Checking your existing verification status with PingOne…</p>
      )}
      {transaction && (
        <div aria-live="polite">
          <p className={ping ? msg : `up-verify-card__status up-verify-card__status--${String(transaction.status || '').toLowerCase()}`}>
            {transaction.status === 'SUCCESS' && 'Identity verification complete.'}
            {transaction.status === 'FAIL' && 'Identity verification was not successful.'}
            {transaction.status === 'EXPIRED' && 'This verification request expired.'}
            {!isTerminal(transaction.status) && `Verification status: ${transaction.status || 'pending'}.`}
            {['APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'UNKNOWN'].includes(transaction.status) && ' This status does not complete automated identity proofing.'}
          </p>
          {!isTerminal(transaction.status) && (
            <p className={msg}>Checking with PingOne… This page will update when the transaction finishes.</p>
          )}
          {transaction.status === 'SUCCESS' && !transaction.canEnrollRecognize && (
            <p className={msg}>Recognize enrollment will be available after its tenant setup and result-validation contract are confirmed.</p>
          )}
        </div>
      )}
      {statusError && <p className={ping ? 'pu-note pvr-error' : 'up-verify-card__error'} role="alert">{statusError}</p>}
      {!compact && transaction && isTerminal(transaction.status) && transaction.status !== 'SUCCESS' && availability?.available && (
        <button
          type="button"
          className={ping ? 'pu-btn pu-btn--primary' : 'up-btn up-btn--secondary'}
          onClick={startNew}
        >
          Start a new verification
        </button>
      )}
      {compact && <a className="up-verify-card__link" href="/ping-products/verify-recognize">Open PingOne Verify &amp; Recognize</a>}
    </section>
  );
}
