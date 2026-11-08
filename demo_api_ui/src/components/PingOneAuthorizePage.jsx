import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import bffAxios from '../services/bffAxios';
import { consumeReplay } from '../services/inspectorReplay';
import AuthzTestPage from './AuthzTestPage';
import MockAuthzRulesPage from './MockAuthzRulesPage';
import ScopeAuditPage from './ScopeAuditPage';
import ScopeReferencePage from './ScopeReferencePage';
import SnapshotImport from '../pages/SnapshotImport';
import BulkDecisionPanel from './BulkDecisionPanel';
import SignInPrompt from './SignInPrompt';
import PingOneAuthorizeConsoleClean from './PingOneAuthorizeConsoleClean';
import InlineSpinner from './shared/InlineSpinner';
import { PingPage, SimBanner, PageFrame, Card, StatusChip } from './pingUi';
import './PingOneAuthorizePage.css';

// PingOne Authorize page: the console tab is the Authorize Inspector; the other
// ?tab= views are reached from its "More tools" links.
//
// Layout follows the Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P7 chip with the word, P9 buttons. It is a tab host and the
// inspector is wide (two columns, up to 100rem), so there is no P3 1100px frame around the console or the
// tools; the signed-out and loading states, which are plain messages, use P3 and P4. The inspector's own
// layout (P6) is shared with the MCP and Agent Gateway inspectors and stays as it is.
//
// P9, one primary per view state:
//   console (Mock or Real P1AZ) - Send. The Mock | Real P1AZ, Vertical, Decision type and call-filter toggles
//                                 are neutral selected states, not primaries; Resend / Edit are secondaries.
//   signed out                  - the Sign in button of SignInPrompt (page CSS puts it on the fixed Ping Red).
//   loading                     - none (nothing can be pressed).
//   More tools tabs             - the tool's own run button; this page adds only the secondary Back button.
//                                 Those tools are separate pages and are not converted here.

// What each More tools tab does with PingOne Authorize, for the banner. Checked against the BFF routes:
// bulk -> evaluate-endpoint-bulk (PingOne), guided -> test-evaluate (active engine), mock rules and snapshot
// import -> the mock authz server.
const TAB_NOTE = {
  bulk: ['info', 'Real', 'Bulk decisions send up to 20 requests to your PingOne Authorize decision endpoint in one call. The verdicts are PingOne\'s.'],
  guided: ['neutral', 'Engine-dependent', 'Guided scenarios run on the engine the backend is set to, the built-in simulated policy or PingOne Authorize. A scenario\'s Run live button forces a real PingOne Authorize call.'],
  mockRules: ['neutral', 'Mock', 'These rules belong to the built-in mock authorization engine only. Changing them does not touch PingOne Authorize.'],
  snapshot: ['neutral', 'Mock', 'A snapshot is imported into the mock authorization server. PingOne Authorize is not changed.'],
  scopes: ['neutral', 'Reference', 'Scope Audit and Scope Reference read scope data through the backend\'s admin API. Neither sends a decision request.'],
};

function ModeBanner({ tab, signedOut, loading, engine, loadFailed, noEndpoint }) {
  let chip; let text;
  if (tab !== 'console') {
    const [tone, word, body] = TAB_NOTE[tab];
    chip = <StatusChip tone={tone}>{word}</StatusChip>;
    text = body;
  } else if (signedOut) {
    chip = <StatusChip tone="warn">Signed out</StatusChip>;
    text = 'Nothing has been sent. The Authorize Inspector needs a signed-in session to read your PingOne Authorize configuration.';
  } else if (loading) {
    chip = <StatusChip tone="neutral">Loading</StatusChip>;
    text = 'Reading the PingOne Authorize configuration. The inspector opens in Mock.';
  } else if (engine === 'live' && loadFailed) {
    chip = <StatusChip tone="warn">Real P1AZ unavailable</StatusChip>;
    text = 'The PingOne Authorize configuration could not be read, so Send is unavailable in Real P1AZ and nothing is sent to PingOne. Switch to Mock to keep going.';
  } else if (engine === 'live' && noEndpoint) {
    chip = <StatusChip tone="warn">No endpoint configured</StatusChip>;
    text = 'No PingOne Authorize decision endpoint is configured here, so Send is unavailable in Real P1AZ and nothing is sent to PingOne. Add the worker credentials and an endpoint, or switch to Mock to keep going.';
  } else if (engine === 'live') {
    chip = <StatusChip tone="info">Real P1AZ</StatusChip>;
    text = 'Each Send goes to the PingOne Authorize decision endpoint you pick, and the verdict is PingOne\'s. Calls made in Mock stay in the list, marked Mock.';
  } else {
    chip = <StatusChip tone="neutral">Mock</StatusChip>;
    text = 'Simulated. Decisions come from this app\'s built-in mock policy: PingOne Authorize is not called and a verdict here is not PingOne\'s. Switch to Real P1AZ under Send a call to send to PingOne.';
  }
  return (
    <SimBanner data-testid="p1az-banner">
      <span className="p1az-banner-line">{chip}<span>{text}</span></span>
    </SimBanner>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PingOneAuthorizePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ['console', 'bulk', 'guided', 'snapshot', 'mockRules', 'scopes'];
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'console';
  const setTab = useCallback((next) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'console') p.delete('tab'); else p.set('tab', next);
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const [scopesSubTab, setScopesSubTab] = useState('audit');
  // The engine the console is on, reported by the console so the banner can say which one answers.
  const [engine, setEngine] = useState('mock');

  // Set while a Token Chain replay is staged; see clearPendingTest below.
  const replayPendingRef = useRef(false);
  // The replay has been evaluated: release the clear guard so ordinary endpoint switches reset the panel again.
  // Also drops the staged replay so a remounted console (More tools round trip) cannot re-fire it.
  const onRan = useCallback(() => { replayPendingRef.current = false; setPendingTest(null); }, []);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [recent, setRecent] = useState({ decisions: [], error: null, loading: false });
  const [pendingTest, setPendingTest] = useState(null);
  // Decisions made on the console, kept here so they survive the ?tab= round trip.
  const [records, setRecords] = useState([]);
  // Live policy tree: fetched once, shown read-only in the console and used for the decision-trace diagram.
  const [policiesState, setPoliciesState] = useState({ policies: [], loading: true, error: null, note: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // _noAuthBanner: a 401 here is answered inline by the SignInPrompt below
        // (setNeedsLogin), so the global SignInModal interrupt must stay out of it.
        const res = await bffAxios.get('/api/authorize/pingone-policies', { _noAuthBanner: true });
        if (!cancelled) setPoliciesState({ policies: res.data?.policies || [], loading: false, error: null, note: res.data?.note || null });
      } catch (e) {
        if (cancelled) return;
        if (e.response?.status === 401) setNeedsLogin(true);
        setPoliciesState({ policies: [], loading: false, error: e.response?.data?.message || e.response?.data?.error || e.message, note: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // _noAuthBanner: same as above — this 401 renders the inline prompt, not the modal.
      const res = await bffAxios.get('/api/authorize/pingone-live-policy', { _noAuthBanner: true });
      setData(res.data);
      // Default selection: configured transaction endpoint, else first endpoint.
      const eps = res.data?.endpoints || [];
      setSelectedId(prev => {
        if (prev && eps.some(e => e.id === prev)) return prev;
        return res.data?.transactionEndpointId || eps[0]?.id || '';
      });
    } catch (e) {
      if (e.response?.status === 401) {
        setNeedsLogin(true);
      } else {
        setError(e.response?.data?.message || e.message);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A replay hand-off has to survive the console's endpoint-change reset:
  // that effect fires again once the endpoint list settles (autoPreset changes
  // a commit later than selectedId) and would clear the pendingTest we just
  // staged, leaving the panel on its default preset with nothing evaluated.
  const clearPendingTest = useCallback(() => {
    if (replayPendingRef.current) return;
    setPendingTest(null);
  }, []);

  // Replay handoff from the Token Chain TraceRail (?replay=<id>): re-issue this
  // run's actual decision request in the Evaluate console.
  //
  // Deliberately consumed only once `selectedId` is set, and handed straight to
  // pendingTest in the same pass. consumeReplay is one-shot, so reading it on
  // mount and parking it in state loses the payload entirely if the route
  // remounts before the endpoint list arrives — which is what happens here.
  // The console hook also clears pendingTest on every endpointId change, so an
  // earlier hand-off would be discarded anyway.
  const replayConsumed = useRef(false);
  useEffect(() => {
    if (replayConsumed.current || !selectedId) return;
    const r = consumeReplay(searchParams);
    if (!r) return;
    replayConsumed.current = true;
    if (r.target !== 'p1az') return;
    replayPendingRef.current = true;
    setTab('console');
    setPendingTest({
      preset: 'custom',
      parameters: r.parameters || {},
      ruleName: 'Token Chain replay',
      case: 'the request this run actually sent',
      autoRun: true,
    });
  }, [selectedId, searchParams, setTab]);

  const endpoints = data?.endpoints || [];
  const selected = useMemo(() => endpoints.find(e => e.id === selectedId) || null, [endpoints, selectedId]);
  const recordingOn = !!selected?.recordRecentRequests;

  // Fetch recent decisions when an endpoint with recording on is selected.
  const loadRecent = useCallback(async (epId, on) => {
    if (!epId || !on) { setRecent({ decisions: [], error: null, loading: false }); return; }
    setRecent({ decisions: [], error: null, loading: true });
    try {
      const res = await bffAxios.get(`/api/authorize/recent-decisions?endpointId=${encodeURIComponent(epId)}&limit=10`);
      setRecent({ decisions: res.data?.decisions || [], error: null, loading: false });
    } catch (e) {
      setRecent({ decisions: [], error: e.response?.data?.message || e.message, loading: false });
    }
  }, []);

  useEffect(() => { loadRecent(selectedId, recordingOn); }, [selectedId, recordingOn, loadRecent]);

  // Turning on "recent decisions" also turns on recording for the endpoint, which triggers the refetch above.
  const includeRecent = async (on) => {
    if (!on || !selectedId || recordingOn) return;
    try {
      const res = await bffAxios.post(`/api/authorize/endpoints/${encodeURIComponent(selectedId)}/recording`, { enabled: true });
      const flag = res.data?.recordRecentRequests !== false;
      setData(d => d ? { ...d, endpoints: (d.endpoints || []).map(e => e.id === selectedId ? { ...e, recordRecentRequests: flag } : e) } : d);
    } catch (e) {
      setRecent(r => ({ ...r, error: e.response?.data?.message || e.message }));
    }
  };

  return (
    <PingPage className="p1az-page">
      <ModeBanner tab={tab} signedOut={needsLogin} loading={loading} engine={engine} loadFailed={!!error} noEndpoint={!error && endpoints.length === 0} />

      {tab !== 'console' && (
        <div className="p1az-body">
          <button type="button" className="pu-btn p1az-back" onClick={() => setTab('console')}>← Back to Authorize Inspector</button>

          {tab === 'bulk' && <BulkDecisionPanel />}

          {tab === 'guided' && <AuthzTestPage />}

          {tab === 'mockRules' && <MockAuthzRulesPage />}

          {tab === 'snapshot' && <SnapshotImport />}

          {tab === 'scopes' && (
            <div>
              <div className="p1az-subtabs" role="group" aria-label="Scope views">
                <button type="button" className="pu-btn" aria-pressed={scopesSubTab === 'audit'} onClick={() => setScopesSubTab('audit')}>Scope Audit</button>
                <button type="button" className="pu-btn" aria-pressed={scopesSubTab === 'reference'} onClick={() => setScopesSubTab('reference')}>Scope Reference</button>
              </div>
              {scopesSubTab === 'audit' ? <ScopeAuditPage /> : <ScopeReferencePage />}
            </div>
          )}
        </div>
      )}

      {tab === 'console' && (needsLogin ? (
        <PageFrame>
          <SignInPrompt message="The PingOne Authorize Inspector needs a signed-in session." />
        </PageFrame>
      ) : loading ? (
        <PageFrame>
          <Card tone="neutral">
            <InlineSpinner label="Loading PingOne Authorize configuration…" />
          </Card>
        </PageFrame>
      ) : (
        <PingOneAuthorizeConsoleClean
          endpointId={selectedId}
          endpoints={endpoints}
          onEndpointChange={setSelectedId}
          loadState={loading ? 'loading' : error ? 'error' : 'live'}
          records={records}
          setRecords={setRecords}
          policiesState={policiesState}
          pendingTest={pendingTest}
          onClearPendingTest={clearPendingTest}
          onRan={onRan}
          recent={recent.decisions}
          onIncludeRecent={includeRecent}
          onModeChange={setEngine}
          buttonClassName="pu-btn pu-btn--primary"
        />
      ))}
    </PingPage>
  );
}
