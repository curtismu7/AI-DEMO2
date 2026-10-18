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

// PingOne Authorize page: the console tab is the Authorize Inspector; the other
// ?tab= views are reached from its "More tools" links.
const S = {
  root: { padding: '28px 32px', width: '100%', maxWidth: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  tabs: { display: 'flex', gap: '6px', marginBottom: '14px', alignItems: 'center' },
  tab: (active) => ({
    padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#fca5a5' : '#e2e8f0'}`,
    background: active ? '#fee2e2' : '#f8fafc',
    color: active ? '#3730a3' : '#334155',
  }),
  back: { background: 'none', border: 0, padding: 0, marginBottom: '14px', color: 'var(--th-text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
};

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

  // Set while a Token Chain replay is staged; see clearPendingTest below.
  const replayPendingRef = useRef(false);
  // The replay has been evaluated: release the clear guard so ordinary endpoint switches reset the panel again.
  const onRan = useCallback(() => { replayPendingRef.current = false; }, []);

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
    <div style={tab === 'console' ? { ...S.root, padding: 0 } : S.root}>
      {tab !== 'console' && (
        <button type="button" style={S.back} onClick={() => setTab('console')}>← Back to Authorize Inspector</button>
      )}

      {tab === 'bulk' && <BulkDecisionPanel />}

      {tab === 'guided' && <AuthzTestPage />}

      {tab === 'mockRules' && <MockAuthzRulesPage />}

      {tab === 'snapshot' && <SnapshotImport />}

      {tab === 'scopes' && (
        <div>
          <div style={S.tabs}>
            <span style={S.tab(scopesSubTab === 'audit')} onClick={() => setScopesSubTab('audit')}>Scope Audit</span>
            <span style={S.tab(scopesSubTab === 'reference')} onClick={() => setScopesSubTab('reference')}>Scope Reference</span>
          </div>
          {scopesSubTab === 'audit' ? <ScopeAuditPage /> : <ScopeReferencePage />}
        </div>
      )}

      {tab === 'console' && (needsLogin ? (
        <div style={{ padding: '40px' }}>
          <SignInPrompt message="The PingOne Authorize Inspector needs a signed-in session." />
        </div>
      ) : loading ? (
        <div style={{ padding: '40px', color: '#64748b', fontSize: '14px' }}><InlineSpinner label="Loading PingOne Authorize configuration…" /></div>
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
        />
      ))}
    </div>
  );
}
