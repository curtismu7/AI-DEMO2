import { useEffect, useRef, useState } from 'react';
import DraggableModal from './DraggableModal';
import ProtocolTrace from './ProtocolTrace';
import apiClient from '../services/apiClient';
import { Card, Section, StatusChip } from './pingUi';
import './ConsentMockPhoneFlow.css';

const POLL_MS = 2000;
const BASE = '/api/consent-mock-phone';
// The chip word per outcome (P7: a chip always carries a word). "mock" keeps it from reading as a real verdict.
const OUTCOME_CHIP = {
  approved: { tone: 'ok', word: 'Approved (mock)' },
  denied: { tone: 'danger', word: 'Denied (mock)' },
  expired: { tone: 'warn', word: 'Expired (mock)' },
};
const OUTCOME = {
  approved: 'Approved on the phone. In a real run PingOne would now issue tokens and the transaction would proceed.',
  denied: 'Denied on the phone. The transaction is blocked and no token is issued.',
  expired: 'Nobody answered in time. The request expired and the transaction is blocked.',
};

// /transaction-consent simulate mode: start a mock CIBA request through the BFF, show the push on the mock
// phone, poll like a real client would, and render what came back. Moves no money and issues no token.
//
// `pingUi` (opt-in, default false) is for the /transaction-consent page, which supplies its own banner, header and
// Ping UI frame: it drops this component's heading, renders the status as a Ping UI chip + sentence, and uses the
// shared button classes (they only style inside a .pu-page). Primary per state: "Open mock phone" while the phone
// is closed, "Pick another scenario" once answered or failed; Cancel is a secondary while pending.
//
// `embedded` is for pages that put the phone inside their own flow (the digital worker page): it drops the
// page heading. `onDecision(state)` is told once when the request ends as approved, denied or expired;
// `onError(err)` gets a failed start (a 401 means the visitor is not signed in). Both are optional.
export default function ConsentMockPhoneFlow({ scenario, onDone, embedded = false, pingUi = false, onDecision, onError }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [phoneClosed, setPhoneClosed] = useState(false);
  const started = useRef(false);
  const reported = useRef(false);
  // Held in a ref so a host re-render with fresh callbacks cannot restart the request.
  const callbacks = useRef({});
  callbacks.current = { onDecision, onError };
  const focusRef = useRef(null);
  const phoneRef = useRef(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    apiClient.post(`${BASE}/start`, scenario.snapshot)
      .then((r) => setView(r.data))
      .catch((e) => {
        setError(e?.response?.data?.message || 'Could not start the approval request.');
        callbacks.current.onError?.(e);
      });
  }, [scenario]);

  useEffect(() => {
    if (reported.current || !OUTCOME[view?.state]) return;
    reported.current = true;
    callbacks.current.onDecision?.(view.state);
  }, [view?.state]);

  const pending = view?.state === 'pending';

  // pingUi focus: the scenario button that started this run is gone and the phone's buttons unmount with the
  // answer, so focus is placed deliberately. The phone while it is open (the decision is made there, and the
  // modal does not take focus itself), otherwise the run region.
  useEffect(() => {
    if (!pingUi) return;
    (pending && !phoneClosed ? phoneRef.current : focusRef.current)?.focus();
  }, [pingUi, view?.state, pending, phoneClosed]);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      apiClient.get(`${BASE}/status`).then((r) => {
        // The request ended elsewhere (e.g. the mock phone answered): a stale 'could not answer' no longer applies.
        if (OUTCOME[r.data?.state]) setError('');
        setView(r.data);
      }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending]);

  // One answer at a time: a second press while the first is in flight is ignored, not sent as a duplicate.
  const answering = useRef(false);
  const answer = (decision) => {
    if (answering.current) return Promise.resolve();
    answering.current = true;
    setError('');
    return apiClient.post(`${BASE}/decision`, { decision })
      .then((r) => { setError(''); setView(r.data); })
      .catch(() => setError('The mock phone could not answer.'))
      .finally(() => { answering.current = false; });
  };

  const doneLabel = pending ? 'Cancel' : embedded ? 'Close' : 'Pick another scenario';
  const chip = OUTCOME_CHIP[view?.state];
  const cardTone = error ? 'danger' : chip?.tone ?? 'neutral';
  const reopen = (
    <button type="button" className={pingUi ? 'pu-btn pu-btn--primary' : undefined} onClick={() => setPhoneClosed(false)}>Open mock phone</button>
  );
  const body = (
    <>
      {error && (
        <p className="cmp__status is-error" role="alert">
          {pingUi && <StatusChip tone="danger">Failed</StatusChip>} {error}
        </p>
      )}
      {pending && (
        <p className="cmp__status" role="status" data-testid="consent-pending">
          {pingUi && <StatusChip tone="info">Waiting (mock)</StatusChip>}{' '}
          Waiting for {view.loginHint} to answer on their device (mock CIBA).
          {phoneClosed && reopen}
        </p>
      )}
      {OUTCOME[view?.state] && (
        <p className={`cmp__status ${view.state === 'approved' ? 'is-ok' : 'is-error'}`} role="status" data-testid="consent-outcome">
          {pingUi && <StatusChip tone={chip.tone}>{chip.word}</StatusChip>}{' '}
          {OUTCOME[view.state]}
        </p>
      )}
    </>
  );
  const done = (
    <button type="button" className={pingUi ? `pu-btn${pending ? '' : ' pu-btn--primary'}` : 'cmp__back'} onClick={onDone}>{doneLabel}</button>
  );

  return (
    <div className={pingUi ? 'cmp cmp--pu' : 'cmp'}>
      {!embedded && !pingUi && <h1 className="tc-simulate__title">Transaction Consent — Simulate</h1>}
      {!embedded && !pingUi && <p className="tc-simulate__subtitle">{scenario.label}</p>}
      {pingUi ? (
        <Section id="cmp-run-h" kicker="Mock request" title={scenario.label}>
          <div ref={focusRef} tabIndex={-1} role="group" aria-label="Mock approval request" className="cmp__focus" data-testid="consent-run">
            <Card tone={cardTone}>{body}</Card>
          </div>
        </Section>
      ) : body}
      {pingUi && <div className="pu-actions cmp__actions-row">{done}</div>}
      {view?.trace?.length > 0 && <ProtocolTrace steps={view.trace} explain={{}} />}
      {!pingUi && done}

      <DraggableModal isOpen={pending && !phoneClosed} onClose={() => setPhoneClosed(true)} title="Mock phone"
        defaultWidth={360} defaultHeight={640} storageKey="consent-mock-phone">
        <div ref={phoneRef} className="dm-scroll cmp__wrap" data-testid="consent-mock-phone"
          {...(pingUi ? { tabIndex: -1, role: 'group', 'aria-label': 'Mock phone lock screen' } : {})}>
          <div className="cmp__phone">
            <div className="cmp__screen">
              <div className="cmp__island" aria-hidden="true" />
              <div className="cmp__clock" aria-hidden="true"><span className="cmp__date">Lock screen</span><span className="cmp__time">9:41</span></div>
              <div className="cmp__card">
                <p className="cmp__app"><span className="cmp__icon" aria-hidden="true">P</span>PingOne MFA (mock)<span className="cmp__now">now</span></p>
                <h3>Approve this transaction?</h3>
                <p>{view?.description}</p>
                <p className="cmp__message">{view?.type} — ${Number(view?.amount).toLocaleString()}</p>
              </div>
              <div className="cmp__actions">
                <button type="button" className="cmp__approve" onClick={() => answer('approve')}>Approve on mock phone</button>
                <button type="button" className="cmp__deny" onClick={() => answer('deny')}>Deny on mock phone</button>
              </div>
              <div className="cmp__home" aria-hidden="true" />
            </div>
          </div>
        </div>
      </DraggableModal>
    </div>
  );
}
