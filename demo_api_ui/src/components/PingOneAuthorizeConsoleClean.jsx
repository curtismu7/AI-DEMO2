// Authorize Inspector console tab, built on the shared inspector layout (Task 6).
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePingOneAuthorizeConsole } from '../hooks/usePingOneAuthorizeConsole';
import InspectorLayout from './inspector/InspectorLayout';
import { useInspectorVertical } from './inspector/useInspectorVertical';
import { ok, err, idle } from './inspector/inspectorCalls';
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
// The diagram follows the selected call, not the engine toggle: a Mock call never reaches PingOne.
const MOCK_NODE_SUBS = {
  ...NODE_SUBS,
  BFF: ['Builds the parameters', 'and answers itself'],
  'built-in mock policy': ['Simulated, not PingOne', 'PingOne is not called'],
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

// What the live region says once a call finishes. A Mock verdict is never announced as PingOne's.
function announcementFor(e) {
  if (e.error) return `The decision request failed: ${e.error}`;
  const mock = e.result?.engine === 'simulated';
  const verdict = e.decision ?? 'no verdict';
  return mock
    ? `Mock decision: ${verdict}. Simulated by the built-in policy; PingOne was not called.`
    : `PingOne Authorize decision: ${verdict}.`;
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
  endpointId, endpoints = [], onEndpointChange, loadState = 'live',
  policiesState, pendingTest, onClearPendingTest,
  recent = [], recentError = null, onIncludeRecent, onRan,
  // Lifted to the page so calls survive a trip to the "More tools" tabs.
  records, setRecords,
  // Mock is the default; tests and callers can open the console on 'live'.
  defaultMode,
  // The host page's mode banner follows the engine picked here.
  onModeChange,
  // Class for the Send button; the host passes the shared Ping UI primary. Omitted: the inspector's own button.
  buttonClassName = 'insp-btn',
}) {
  const [pickedId, setPickedId] = useState(null);
  const [includeRecent, setIncludeRecent] = useState(false);
  const [announce, setAnnounce] = useState('');
  const policies = policiesState.policies;

  // Latest policies for persistLastRun without re-creating onEvaluated (the hook re-runs pending tests when it changes).
  const policiesRef = useRef(policies);
  policiesRef.current = policies;

  const onEvaluated = useCallback((e) => {
    setRecords((rs) => [{ ...e, at: Date.now() }, ...rs]);
    setPickedId(null);
    setAnnounce(announcementFor(e));
    onRan?.();
    if (e.result) persistLastRun(policiesRef.current, e.result);
  }, [onRan, setRecords]);

  // A vertical change loads its MCP tool, transaction type and amount; Transaction is offered only where the vertical sends one.
  const { vertical, field: verticalField } = useInspectorVertical((v) => {
    h.setToolName(v.authorize.toolName);
    h.setAmount(String(v.authorize.amount));
    h.setTxType(v.authorize.txTypes[0] ?? 'transfer');
    if (!v.authorize.txTypes.length && h.preset === 'transaction') h.setPreset('mcp');
  });
  const txTypes = vertical.authorize.txTypes;

  const h = usePingOneAuthorizeConsole({
    endpointId, autoPreset: txTypes.length ? 'transaction' : 'mcp',
    defaultToolName: vertical.authorize.toolName, defaultAmount: String(vertical.authorize.amount),
    pendingTest, onClearPendingTest, onEvaluated, defaultMode,
  });
  useEffect(() => { onModeChange?.(h.mode); }, [h.mode, onModeChange]);
  // An edited call keeps its own preset and type even when this vertical has neither.
  const presets = PRESETS.filter((p) => p.value !== 'transaction' || txTypes.length || h.preset === 'transaction');
  const typeOptions = txTypes.includes(h.txType) ? txTypes : [...txTypes, h.txType];

  const calls = useMemo(() => {
    const mine = records.map((r) => authorizeCallFromResult({ ...r, policies }));
    if (!includeRecent) return mine;
    const seen = new Set(mine.map((c) => c.corr).filter(Boolean));
    const logged = recent.filter((d) => !seen.has(d.id)).map(authorizeCallFromRecent);
    return [...mine, ...logged].sort((a, b) => (b.at || 0) - (a.at || 0));
  }, [records, policies, includeRecent, recent]);

  const selectedId = pickedId ?? calls[0]?.id ?? null;
  const selectedCall = calls.find((c) => c.id === selectedId);

  const onResend = useCallback((call) => { h.runParameters(call.input.parameters, call.input.preset); }, [h]);
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

  // A failed read or recording toggle: the box must not stay ticked as if the decisions were included.
  useEffect(() => { if (recentError) setIncludeRecent(false); }, [recentError]);

  const toggleRecent = (on) => { setIncludeRecent(on); onIncludeRecent?.(on); };

  const field = (label, value, set) => (
    <label className="insp-field"><span>{label}</span><input type="text" value={value} onChange={(e) => set(e.target.value)} /></label>
  );

  // Real P1AZ needs an endpoint. Say why Send is unavailable: in the page, to screen readers, and on a press.
  const noRealEndpoint = h.mode === 'live' && !endpointId;
  const blockedReason = !noRealEndpoint ? null
    : loadState === 'error'
      ? 'Send is unavailable in Real P1AZ: the PingOne Authorize configuration could not be read, so nothing can be sent to PingOne. Switch to Mock to send.'
      : 'Send is unavailable in Real P1AZ: no PingOne Authorize decision endpoint is configured, so nothing can be sent to PingOne. Switch to Mock to send.';
  const sendBlocked = h.running || noRealEndpoint;
  // Live region: in-flight, then the result, so a screen reader hears it without hunting for the Calls pane.
  const status = h.running ? 'Sending the decision request…' : announce;
  const onSend = () => {
    if (h.running) return;
    if (blockedReason) { setAnnounce(blockedReason); return; }
    h.run();
  };
  const send = (
    <div className="insp-send-body">
      <div className="insp-send-row">
        <div className="insp-seg" role="group" aria-label="Engine">
          <button type="button" aria-pressed={h.mode === 'mock'} onClick={() => h.setMode('mock')} title="Built-in simulated engine, no PingOne call">Mock</button>
          <button type="button" aria-pressed={h.mode === 'live'} onClick={() => h.setMode('live')} title="Send to PingOne Authorize">Real P1AZ</button>
        </div>
        {verticalField}
        <div className="insp-seg" role="group" aria-label="Decision type">
          {presets.map((p) => (
            <button key={p.value} type="button" aria-pressed={h.preset === p.value} onClick={() => h.setPreset(p.value)}>{p.label}</button>
          ))}
        </div>
        {h.preset === 'transaction' && (
          <>
            {field('Amount', h.amount, h.setAmount)}
            <label className="insp-field">
              <span>Type</span>
              <select value={h.txType} onChange={(e) => h.setTxType(e.target.value)}>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
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
        {/* aria-disabled, not disabled: a disabled Send drops keyboard focus to the page body the moment it is pressed. */}
        <button type="button" className={buttonClassName} onClick={onSend} aria-disabled={sendBlocked || undefined} aria-describedby={blockedReason ? 'p1az-send-reason' : undefined}>{h.running ? 'Sending…' : 'Send'}</button>
      </div>
      {blockedReason && <p id="p1az-send-reason" className="insp-hint p1az-send-reason">{blockedReason}</p>}
      <p className="p1az-sr" role="status" aria-live="polite" aria-atomic="true" data-testid="p1az-status">{status}</p>
      <details>
        <summary>{`Policies on this endpoint · ${countKind(policies, 'POLICY')} policies, ${countKind(policies, 'RULE')} rules`}</summary>
        {policiesState.error && <p className="insp-err">{policiesState.error}</p>}
        <PolicyList nodes={policies} />
      </details>
    </div>
  );

  const callsToggle = (
    <>
      <label className="insp-calls-toggle">
        <input type="checkbox" checked={includeRecent} onChange={(e) => toggleRecent(e.target.checked)} />
        {' '}Include PingOne&apos;s recent decisions
      </label>
      {recentError ? (
        <p className="insp-err" role="alert" data-testid="p1az-recent-error">
          <span className="insp-chip err">Could not read</span>
          {' '}PingOne&apos;s recent decisions: {recentError}. Tick the box to try again.
        </p>
      ) : null}
    </>
  );

  return (
    <InspectorLayout
      eyebrow="PingOne Authorize · Inspector"
      title="Authorize Inspector"
      lede="Every decision for this demo: the parameters sent, the verdict and statements returned, the token used, and the API calls behind it. Mock (the default) answers from a built-in policy with no PingOne call; Real P1AZ sends to PingOne Authorize."
      related={RELATED}
      mode={h.mode === 'mock' ? ok('Mock') : loadState === 'loading' ? idle('Loading') : loadState === 'error' ? err('Unavailable') : !endpointId ? idle('No endpoint') : ok('Real P1AZ')}
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
      nodeSubs={selectedCall?.mock ? MOCK_NODE_SUBS : NODE_SUBS}
    />
  );
}
