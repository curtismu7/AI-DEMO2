import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useVertical } from '../vertical/useVertical';
import PersonalAgentStudioPage from './PersonalAgentStudioPage';
// Still imported: the embedded studio (workload-agents__run, __status, __chain) is styled there, and
// DigitalWorkerPage and PersonalAgentClientWindow share that sheet. The page's own layout is in WorkloadAgentsLayout.css.
import './WorkloadAgentsPage.css';
import './WorkloadAgentsLayout.css';
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from '../components/pingUi';

// /workload-agents. Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md). Applied: P2 banner first (its state sentence comes from the session and the catalog
// load, never fixed text), P3 frame and two sections, P4 cards (one per scenario; the top edge stays the active
// vertical's accent), P5 kv (catalog action, run prompt), P7 chips with a word, P9 buttons.
// Skipped: P6 inspector and P8 diagram boxes (the page has neither; the token chain is the studio's own).
//
// P9 "exactly one primary per view", per state. The two "Run this demo" buttons are secondaries on purpose: the
// studio below owns the run's primary, and a card primary would make two.
//   Loading the catalog           -> none (nothing can run yet; the Run buttons are aria-disabled and say why)
//   Catalog failed to load        -> "Retry loading actions" (the studio is not mounted, the Run buttons stay inactive)
//   Vertical list failed only     -> the studio's "Run <action>"; Retry is a secondary
//   Loaded, idle / running / done -> the studio's "Run <action>" (aria-disabled while running, so focus stays)
//   Run needs MFA                 -> the studio's "Verify with MFA and run again" (Run steps down)
// The vertical picker is not a button. Page CSS keeps only the selected card's edge and the phone layout.
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
  const [listError, setListError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [reload, setReload] = useState(0);
  const [requestedRun, setRequestedRun] = useState({ id: null, nonce: 0 });
  const executionRef = useRef(null);
  // Retry unmounts itself when the load succeeds, which would drop keyboard focus to <body>: hand it to the selected card's Run button.
  const runButtons = useRef({});
  const retried = useRef(false);

  useEffect(() => {
    let live = true;
    setListError('');
    apiClient.get('/api/verticals/list').then(({ data }) => {
      if (live) setVerticals(Array.isArray(data) ? data.filter((item) => SUPPORTED_VERTICALS.has(item.id)) : []);
    }).catch(() => { if (live) setListError('Vertical choices could not be loaded.'); });
    return () => { live = false; };
  }, [reload]);

  useEffect(() => {
    let live = true;
    setCatalog({ vertical: null, cases: {} });
    setCatalogError('');
    Promise.all(SCENARIOS.map(({ id }) =>
      apiClient.get(`/api/use-cases/${id}?vertical=${encodeURIComponent(vertical)}`)
    )).then((responses) => {
      if (live) setCatalog({ vertical, cases: Object.fromEntries(responses.map(({ data }) => [data.useCase.id, data.useCase])) });
    }).catch(() => { if (live) { retried.current = false; setCatalogError('Actions could not be loaded for this vertical.'); } });
    return () => { live = false; };
  }, [vertical, reload]);

  const verticalName = verticals.find((item) => item.id === vertical)?.displayName || vertical;
  const cases = catalog.vertical === vertical ? catalog.cases : {};
  const selected = cases[selectedId];
  const error = catalogError || listError;
  const loading = !catalogError && catalog.vertical !== vertical;

  // Built here, not inside the tag: the pattern check reads a tag's attributes up to the first ">".
  const runButtonRef = (id) => (node) => { runButtons.current[id] = node; };

  useEffect(() => {
    if (retried.current && selected) {
      retried.current = false;
      runButtons.current[selectedId]?.focus();
    }
  }, [selected, selectedId]);

  function updateSelection(id, nextVertical = vertical) {
    if (nextVertical !== vertical) {
      setRequestedRun({ id: null, nonce: 0 });
      // Save the pick on the session too, so the rest of the app (branding,
      // agent) follows it instead of staying on the server's default.
      apiClient.post('/api/verticals/active', { id: nextVertical }).then(() => refetch?.()).catch(() => {});
    }
    navigate(`/workload-agents?useCase=${id}&vertical=${encodeURIComponent(nextVertical)}`);
  }

  // The banner's state sentence is read from what the page actually has: the catalog load and the session.
  const bannerState = catalogError
    ? 'The catalog action did not load, so nothing can run until it does. Use Retry loading actions.'
    : loading
      ? 'Loading the catalog actions for this vertical.'
      : user?.username
        ? 'Run sends the catalog prompt to this app\'s own server with your session, and the gates, tokens and token chain shown below are what that server returned for that run.'
        : 'Nobody is signed in on this page, so a run may be refused until you sign in. When one runs, the gates, tokens and token chain shown below are what this app\'s server returned for that run.';

  return (
    <PingPage className="wa-page">
      <SimBanner data-testid="wa-banner">
        <strong>SERVER RUN, SIMULATED CLIENT WINDOW</strong> —{' '}
        {/* A live region from first render, so a catalog failure or a finished load is announced. */}
        <span role="status" data-testid="wa-banner-state">{bannerState}</span>{' '}
        The scenario titles and prompts come from this app&apos;s use-case catalog for the chosen vertical. Open client window opens a
        look-alike client, not a real one.
      </SimBanner>
      <PageHeader eyebrow="Delegated workload identity" title="Choose what the agent does." summary={<>A registered workload agent acts for a signed-in customer. The customer stays <code>sub=user</code>; the agent appears as <code>act=agent</code>. The run below shows which gates the server reported for each delegated request.</>}
        actions={<label className="pu-label wa-vertical">Vertical
          <select className="pu-select" value={vertical} onChange={(event) => updateSelection(selectedId, event.target.value)}>
            {verticals.map(({ id, displayName }) => <option key={id} value={id}>{displayName || id}</option>)}
          </select>
        </label>} />

      <PageFrame>
        {/* Mounted from first render so an error arriving later is announced. */}
        <div role="alert" className="wa-alert" data-testid="wa-error">
          {error ? <p className="pu-status-line"><StatusChip tone="danger">Failed</StatusChip><span>{error}</span></p> : null}
        </div>
        {error ? (
          <div className="pu-actions">
            <button type="button" className={catalogError ? 'pu-btn pu-btn--primary' : 'pu-btn'} onClick={() => { retried.current = true; setReload((n) => n + 1); }}>Retry loading actions</button>
          </div>
        ) : null}

        <Section id="wa-choose" kicker="1 · Choose" title="Pick a scenario" lede="Each card is one catalog action for the chosen vertical. Run this demo selects it and starts the run below.">
          <CardGrid>
            {SCENARIOS.map(({ id, kind, cue, detail }) => {
              const uc = cases[id];
              const ready = Boolean(uc?.runPrompt);
              const isSelected = selectedId === id;
              const waitId = `wa-wait-${id}`;
              return (
                <Card key={id} className={`wa-choice${isSelected ? ' is-selected' : ''}`} data-testid={`wa-choice-${id}`} title={uc?.title || (id === 'UC38' ? 'MFA-gated protected action' : 'OBO customer-data read')}>
                  <p className="pu-status-line">
                    <span className="pu-mono">{id}</span>
                    <StatusChip>{kind}</StatusChip>
                    {isSelected ? <StatusChip tone="info">Selected</StatusChip> : null}
                  </p>
                  <p>{detail}</p>
                  <p className="wa-cue">{cue}</p>
                  <KvList items={[
                    { label: 'Catalog action', value: uc?.primaryTool || (catalogError ? 'Unavailable' : 'Loading…'), mono: true },
                    { label: 'Run prompt', value: uc?.runPrompt || (catalogError ? 'Unavailable' : 'Loading…') },
                  ]} />
                  <button
                    type="button"
                    className="pu-btn"
                    ref={runButtonRef(id)}
                    aria-disabled={ready ? undefined : 'true'}
                    aria-describedby={ready ? undefined : waitId}
                    onClick={ready ? () => {
                      updateSelection(id);
                      setRequestedRun((last) => ({ id, nonce: last.nonce + 1 }));
                      // The outcome, and the MFA button, render in the run panel below the fold.
                      executionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                    } : undefined}
                  >Run this demo: {id}</button>
                  {ready ? null : <p id={waitId} className="pu-note">{catalogError ? 'The catalog action did not load, so this cannot run.' : 'Waiting for the catalog action to load.'}</p>}
                </Card>
              );
            })}
          </CardGrid>
        </Section>

        <section ref={executionRef} className="wa-execution" aria-labelledby="wa-run-h">
          <p className="pu-kicker">2 · Run</p>
          <h2 id="wa-run-h" className="pu-h2">Selected run</h2>
          <p className="pu-status-line wa-execution__line">
            <StatusChip>{SCENARIOS.find((item) => item.id === selectedId).kind}</StatusChip>
            <span>{selectedId} · {verticalName} · {selected?.primaryTool || 'Loading action'} · {user?.username ? `signed in as ${user.username}` : 'not signed in'}</span>
          </p>
          <Card tone="neutral" className="wa-studio">
            {selected
              ? <PersonalAgentStudioPage key={`${vertical}:${selectedId}`} scenario={selected} vertical={vertical} runNonce={requestedRun.id === selected.id ? requestedRun.nonce : 0} />
              : <p className="pu-empty pu-note">{catalogError ? 'No run is available until the catalog action loads.' : 'The run panel appears when the catalog action has loaded.'}</p>}
          </Card>
        </section>
      </PageFrame>
    </PingPage>
  );
}
