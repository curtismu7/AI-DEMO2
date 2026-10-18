// Authorize Inspector console tab, built on the shared inspector layout (Task 6).
import React, { useState, useCallback, useMemo, useRef } from 'react';
import { usePingOneAuthorizeConsole } from '../hooks/usePingOneAuthorizeConsole';
import InspectorLayout from './inspector/InspectorLayout';
import { ok, warn } from './inspector/inspectorCalls';
import { authorizeCallFromResult, authorizeCallFromRecent } from './inspector/authorizeCalls';

const RELATED = [
  { label: 'Bulk decisions', to: '/pingone-authorize?tab=bulk' },
  { label: 'Guided scenarios', to: '/pingone-authorize?tab=guided' },
  { label: 'Mock rules', to: '/pingone-authorize?tab=mockRules' },
  { label: 'Scopes', to: '/pingone-authorize?tab=scopes' },
  { label: 'Snapshot import', to: '/pingone-authorize?tab=snapshot' },
  { label: 'Policy decision trace', to: '/policy-decision-trace' },
];

const NODE_SUBS = {
  Browser: ['This page'],
  BFF: ['Builds the parameters', 'and calls PingOne'],
  PingOne: ['Issues the worker token'],
  'PingOne Authorize': ['Runs the policy tree', 'returns decision + statements'],
};

const PRESETS = [
  { value: 'transaction', label: 'Transaction' },
  { value: 'mcp', label: 'MCP tool' },
  { value: 'custom', label: 'Custom' },
];

const CALLS_NOTE = "Your decisions from this page, plus PingOne's recent-decisions log (the AI agent's decisions show up there).";
const LAST_RUN_KEY = 'policyDecisionTrace.lastRun';
const MAX_STORED_CHARS = 500_000;

// Lets the Policy Decision Trace page open on the last run.
function persistLastRun(policies, result) {
  if (!Array.isArray(policies) || policies.length === 0 || !result) return;
  try {
    const payload = JSON.stringify({ policies, result, savedAt: Date.now() });
    if (payload.length <= MAX_STORED_CHARS) localStorage.setItem(LAST_RUN_KEY, payload);
  } catch { /* storage unavailable */ }
}

const countKind = (nodes, kind) => nodes.reduce((n, p) => n + (p.kind === kind ? 1 : 0) + countKind(p.children || [], kind), 0);

function PolicyList({ nodes }) {
  return (
    <ul className="insp-browse">
      {nodes.map((n, i) => (
        <li key={n.id ?? i}>
          <strong>{n.name}</strong>{n.effect ? ` · ${n.effect}` : ''}{n.enabled === false ? ' · disabled' : ''}
          {n.children?.length > 0 && <PolicyList nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export default function PingOneAuthorizeConsoleClean({
  endpointId, endpoints = [], onEndpointChange, simulated,
  policiesState, pendingTest, onClearPendingTest,
  recent = [], onIncludeRecent, onRan,
}) {
  const [records, setRecords] = useState([]);
  const [pickedId, setPickedId] = useState(null);
  const [includeRecent, setIncludeRecent] = useState(false);
  const policies = policiesState.policies;

  // Latest policies for persistLastRun without re-creating onEvaluated (the hook re-runs pending tests when it changes).
  const policiesRef = useRef(policies);
  policiesRef.current = policies;

  const onEvaluated = useCallback((e) => {
    setRecords((rs) => [{ ...e, at: Date.now() }, ...rs]);
    setPickedId(null);
    onRan?.();
    if (e.result) persistLastRun(policiesRef.current, e.result);
  }, [onRan]);

  const h = usePingOneAuthorizeConsole({
    endpointId, autoPreset: 'transaction', policiesState, pendingTest, onClearPendingTest, onEvaluated,
  });

  const calls = useMemo(() => {
    const mine = records.map((r) => authorizeCallFromResult({ ...r, policies }));
    if (!includeRecent) return mine;
    const seen = new Set(mine.map((c) => c.corr).filter(Boolean));
    const logged = recent.filter((d) => !seen.has(d.id)).map(authorizeCallFromRecent);
    return [...mine, ...logged].sort((a, b) => (b.at || 0) - (a.at || 0));
  }, [records, policies, includeRecent, recent]);

  const selectedId = pickedId ?? calls[0]?.id ?? null;

  const onResend = useCallback((call) => { h.runParameters(call.input.parameters); }, [h]);
  const onEdit = useCallback((call) => {
    const { preset, parameters: p } = call.input || {};
    if (!preset) return;
    h.setPreset(preset);
    if (preset === 'transaction') {
      h.setAmount(String(p.Amount ?? ''));
      h.setTxType(p.TransactionType ?? 'transfer');
      h.setAcr(p.Acr ?? '');
      if (p.UserId !== undefined) h.setUserId(p.UserId);
    } else if (preset === 'mcp') {
      h.setToolName(p.ToolName ?? '');
      h.setTokenAudience(p.TokenAudience ?? '');
      h.setActClientId(p.ActClientId ?? '');
      h.setMcpResourceUri(p.McpResourceUri ?? '');
      h.setHitlApproved(!!p.HitlApproved);
      if (p.UserId !== undefined) h.setUserId(p.UserId);
    } else {
      h.setCustomRows([...Object.entries(p).map(([key, value]) => ({ key, value: String(value) })), { key: '', value: '' }]);
    }
  }, [h]);

  const toggleRecent = (on) => { setIncludeRecent(on); onIncludeRecent?.(on); };

  const field = (label, value, set) => (
    <label className="insp-field"><span>{label}</span><input type="text" value={value} onChange={(e) => set(e.target.value)} /></label>
  );

  const send = (
    <div className="insp-send-body">
      <div className="insp-send-row">
        <div className="insp-seg" role="group" aria-label="Decision type">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" aria-pressed={h.preset === p.value} onClick={() => h.setPreset(p.value)}>{p.label}</button>
          ))}
        </div>
        {h.preset === 'transaction' && (
          <>
            {field('Amount', h.amount, h.setAmount)}
            <label className="insp-field">
              <span>Type</span>
              <select value={h.txType} onChange={(e) => h.setTxType(e.target.value)}>
                <option value="transfer">transfer</option>
                <option value="withdrawal">withdrawal</option>
                <option value="deposit">deposit</option>
              </select>
            </label>
            {field('ACR', h.acr, h.setAcr)}
          </>
        )}
        {h.preset === 'mcp' && (
          <>
            {field('Tool name', h.toolName, h.setToolName)}
            {field('Token audience', h.tokenAudience, h.setTokenAudience)}
            {field('Act client ID', h.actClientId, h.setActClientId)}
            {field('MCP resource URI', h.mcpResourceUri, h.setMcpResourceUri)}
            <label className="insp-field">
              <span>HITL approved</span>
              <input type="checkbox" checked={h.hitlApproved} onChange={(e) => h.setHitlApproved(e.target.checked)} />
            </label>
          </>
        )}
        {h.preset === 'custom' && h.customRows.map((row, i) => (
          <React.Fragment key={i}>
            <label className="insp-field"><span>Key</span><input type="text" value={row.key} onChange={(e) => h.setRow(i, 'key', e.target.value)} /></label>
            <label className="insp-field"><span>Value</span><input type="text" value={row.value} onChange={(e) => h.setRow(i, 'value', e.target.value)} /></label>
            {row.key && <button type="button" className="insp-btn ghost" onClick={() => h.removeRow(i)}>Remove</button>}
          </React.Fragment>
        ))}
        {h.preset !== 'custom' && field('User ID', h.userId, h.setUserId)}
        <button type="button" className="insp-btn" onClick={h.run} disabled={h.running || !endpointId}>{h.running ? 'Sending…' : 'Send'}</button>
      </div>
      <details>
        <summary>{`Policies on this endpoint · ${countKind(policies, 'POLICY')} policies, ${countKind(policies, 'RULE')} rules`}</summary>
        {policiesState.error && <p className="insp-err">{policiesState.error}</p>}
        <PolicyList nodes={policies} />
      </details>
    </div>
  );

  const callsToggle = (
    <label className="insp-calls-toggle">
      <input type="checkbox" checked={includeRecent} onChange={(e) => toggleRecent(e.target.checked)} />
      {' '}Include PingOne&apos;s recent decisions
    </label>
  );

  return (
    <InspectorLayout
      eyebrow="PingOne Authorize · Inspector"
      title="Authorize Inspector"
      lede="Every decision PingOne Authorize made for this demo: the parameters sent, the verdict and statements returned, the token used, and the API calls behind it."
      related={RELATED}
      mode={simulated === false ? ok('Live') : warn('Simulated')}
      source={{
        label: 'Endpoint',
        value: endpointId,
        options: endpoints.map((e) => ({ value: e.id, label: e.name || e.id })),
        onChange: (v) => { setPickedId(null); onEndpointChange?.(v); },
      }}
      send={send}
      calls={calls}
      callsNote={CALLS_NOTE}
      callsToggle={callsToggle}
      selectedId={selectedId}
      onSelect={setPickedId}
      onResend={onResend}
      onEdit={onEdit}
      nodeSubs={NODE_SUBS}
    />
  );
}
