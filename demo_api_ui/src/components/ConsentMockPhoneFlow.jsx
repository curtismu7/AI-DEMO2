import { useEffect, useRef, useState } from 'react';
import DraggableModal from './DraggableModal';
import ProtocolTrace from './ProtocolTrace';
import apiClient from '../services/apiClient';
import './ConsentMockPhoneFlow.css';

const POLL_MS = 2000;
const BASE = '/api/consent-mock-phone';
const OUTCOME = {
  approved: 'Approved on the phone. In a real run PingOne would now issue tokens and the transaction would proceed.',
  denied: 'Denied on the phone. The transaction is blocked and no token is issued.',
  expired: 'Nobody answered in time. The request expired and the transaction is blocked.',
};

// /transaction-consent simulate mode: start a mock CIBA request through the BFF, show the push on the mock
// phone, poll like a real client would, and render what came back. Moves no money and issues no token.
export default function ConsentMockPhoneFlow({ scenario, onDone }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [phoneClosed, setPhoneClosed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    apiClient.post(`${BASE}/start`, scenario.snapshot)
      .then((r) => setView(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'Could not start the approval request.'));
  }, [scenario]);

  const pending = view?.state === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      apiClient.get(`${BASE}/status`).then((r) => setView(r.data)).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending]);

  const answer = (decision) => apiClient.post(`${BASE}/decision`, { decision })
    .then((r) => setView(r.data))
    .catch(() => setError('The mock phone could not answer.'));

  return (
    <div className="cmp">
      <h1 className="tc-simulate__title">Transaction Consent — Simulate</h1>
      <p className="tc-simulate__subtitle">{scenario.label}</p>
      {error && <p className="cmp__status is-error" role="alert">{error}</p>}
      {pending && (
        <p className="cmp__status" role="status" data-testid="consent-pending">
          Waiting for {view.loginHint} to answer on their device (mock CIBA).
          {phoneClosed && <button type="button" onClick={() => setPhoneClosed(false)}>Open mock phone</button>}
        </p>
      )}
      {OUTCOME[view?.state] && (
        <p className={`cmp__status ${view.state === 'approved' ? 'is-ok' : 'is-error'}`} role="status" data-testid="consent-outcome">
          {OUTCOME[view.state]}
        </p>
      )}
      {view?.trace?.length > 0 && <ProtocolTrace steps={view.trace} explain={{}} />}
      <button type="button" className="cmp__back" onClick={onDone}>{pending ? 'Cancel' : 'Pick another scenario'}</button>

      <DraggableModal isOpen={pending && !phoneClosed} onClose={() => setPhoneClosed(true)} title="Mock phone"
        defaultWidth={360} defaultHeight={640} storageKey="consent-mock-phone">
        <div className="dm-scroll cmp__wrap" data-testid="consent-mock-phone">
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
