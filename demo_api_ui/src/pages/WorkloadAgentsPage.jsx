import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useVertical } from '../vertical/useVertical';
import PersonalAgentStudioPage from './PersonalAgentStudioPage';
import './WorkloadAgentsPage.css';

const SCENARIOS = [
  { id: 'UC38', kind: 'Protected write', cue: 'Choose this to demonstrate identity step-up before a workload agent makes a protected change.', detail: 'Customer MFA is checked before delegation. The registered agent then makes a protected change through the gateway and Authorize.' },
  { id: 'UC44', kind: 'Customer read', cue: 'Choose this to demonstrate who authorized the request, which workload agent acted, and what data it could access.', detail: 'The registered agent reads customer-owned data on behalf of the signed-in customer. The gateway and Authorize evaluate the delegated request.' },
];
const SUPPORTED_VERTICALS = new Set([
  'banking', 'healthcare', 'retail', 'walbuy', 'government',
  'university', 'workforce', 'sporting-goods', 'manufacturing', 'investment', 'airlines',
]);

export default function WorkloadAgentsPage({ user = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeId, refetch } = useVertical();
  const params = new URLSearchParams(location.search);
  // The active vertical can be one this page has no actions for (pingone-admin).
  const vertical = params.get('vertical') || (SUPPORTED_VERTICALS.has(activeId) ? activeId : 'sporting-goods');
  const selectedId = params.get('useCase') === 'UC44' ? 'UC44' : 'UC38';
  const [verticals, setVerticals] = useState([]);
  const [catalog, setCatalog] = useState({ vertical: null, cases: {} });
  const [error, setError] = useState('');
  const [requestedRun, setRequestedRun] = useState({ id: null, nonce: 0 });
  const executionRef = useRef(null);

  useEffect(() => {
    let live = true;
    apiClient.get('/api/verticals/list').then(({ data }) => {
      if (live) setVerticals(Array.isArray(data) ? data.filter((item) => SUPPORTED_VERTICALS.has(item.id)) : []);
    }).catch(() => { if (live) setError('Vertical choices could not be loaded.'); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setCatalog({ vertical: null, cases: {} });
    setError('');
    Promise.all(SCENARIOS.map(({ id }) =>
      apiClient.get(`/api/use-cases/${id}?vertical=${encodeURIComponent(vertical)}`)
    )).then((responses) => {
      if (live) setCatalog({ vertical, cases: Object.fromEntries(responses.map(({ data }) => [data.useCase.id, data.useCase])) });
    }).catch(() => { if (live) setError('Actions could not be loaded for this vertical.'); });
    return () => { live = false; };
  }, [vertical]);

  const verticalName = verticals.find((item) => item.id === vertical)?.displayName || vertical;
  const cases = catalog.vertical === vertical ? catalog.cases : {};
  const selected = cases[selectedId];

  function updateSelection(id, nextVertical = vertical) {
    if (nextVertical !== vertical) {
      setRequestedRun({ id: null, nonce: 0 });
      // Save the pick on the session too, so the rest of the app (branding,
      // agent) follows it instead of staying on the server's default.
      apiClient.post('/api/verticals/active', { id: nextVertical }).then(() => refetch?.()).catch(() => {});
    }
    navigate(`/workload-agents?useCase=${id}&vertical=${encodeURIComponent(nextVertical)}`);
  }

  return (
    <main className="workload-agents">
      <header className="workload-agents__intro">
        <div>
          <p className="workload-agents__kicker">Delegated workload identity</p>
          <h1>Choose what the agent does.</h1>
          <p>A registered workload agent acts for a signed-in customer. The customer stays <code>sub=user</code>; the agent appears as <code>act=agent</code>. The BFF, gateway, and Authorize enforce each delegated request.</p>
        </div>
        <label className="workload-agents__vertical">Vertical
          <select value={vertical} onChange={(event) => updateSelection(selectedId, event.target.value)}>
            {verticals.map(({ id, displayName }) => <option key={id} value={id}>{displayName || id}</option>)}
          </select>
        </label>
      </header>

      {error && <p role="alert" className="workload-agents__error">{error}</p>}
      <div className="workload-agents__choices">
        {SCENARIOS.map(({ id, kind, cue, detail }) => {
          const uc = cases[id];
          return <article key={id} className={`workload-agents__choice ${selectedId === id ? 'is-selected' : ''}`}>
            <div className="workload-agents__choice-head"><span>{id}</span><span>{kind}</span></div>
            <h2>{uc?.title || (id === 'UC38' ? 'MFA-gated protected action' : 'OBO customer-data read')}</h2>
            <p>{detail}</p>
            <p className="workload-agents__cue">{cue}</p>
            <dl className="workload-agents__action"><div><dt>Catalog action</dt><dd>{uc?.primaryTool || 'Loading…'}</dd></div><div><dt>Run prompt</dt><dd>{uc?.runPrompt || 'Loading…'}</dd></div></dl>
            <button type="button" disabled={!uc?.runPrompt} onClick={() => {
              updateSelection(id);
              setRequestedRun((last) => ({ id, nonce: last.nonce + 1 }));
              // The outcome, and the MFA button, render in the run panel below the fold.
              executionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
            }}>Run this demo: {id}</button>
          </article>;
        })}
      </div>

      <section ref={executionRef} className="workload-agents__execution" aria-label="Selected workload agent run">
        <div className="workload-agents__execution-head"><div><h2>Selected run</h2><p>{selectedId} · {verticalName} · {selected?.primaryTool || 'Loading action'} · {user?.username ? `signed in as ${user.username}` : 'not signed in'}</p></div><p>{selectedId === 'UC38' ? 'MFA-protected write' : 'OBO customer-data read'}</p></div>
        {selected && <PersonalAgentStudioPage key={`${vertical}:${selectedId}`} scenario={selected} vertical={vertical} runNonce={requestedRun.id === selected.id ? requestedRun.nonce : 0} />}
      </section>
    </main>
  );
}
