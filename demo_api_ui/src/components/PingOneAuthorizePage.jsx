import React, { useState, useEffect, useCallback, useMemo } from 'react';
import bffAxios from '../services/bffAxios';
import PolicyDecisionTree from './PolicyDecisionTree';
import JsonHighlight from './shared/JsonHighlight';
import './McpInspector.css';
import './PingOneMcpInspector.css';

/** Collapsible trace section — same pattern as PingOne MCP Inspector. */
const Section = ({ title, hint, status, defaultOpen = true, children }) => (
  <details className="p1mcp-section" open={defaultOpen}>
    <summary>
      <span className="p1mcp-section__title">{title}</span>
      {status && (
        <span className={`p1mcp-section__status p1mcp-section__status--${status}`}>
          {status === 'ok' ? '✓ received' : status === 'error' ? '✗ error' : status}
        </span>
      )}
      {hint && <span className="p1mcp-section__hint">{hint}</span>}
    </summary>
    <div className="p1mcp-section__body">{children}</div>
  </details>
);

// ---------------------------------------------------------------------------
// PingOne Authorize — Live Policy Console
//
// Admin tool for sending REAL decision requests to ANY decision endpoint in the
// configured PingOne environment, inspecting the verbatim verdict, and viewing
// recent decisions. This console always calls live PingOne Authorize; it does
// NOT change the app-wide enforcement engine (ff_authorize_simulated).
// ---------------------------------------------------------------------------

const S = {
  root: { padding: '28px 32px', maxWidth: '1000px', fontFamily: 'inherit' },
  header: { marginBottom: '20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px' },
  subtitle: { fontSize: '13px', color: '#64748b', margin: 0, lineHeight: 1.5 },
  liveBadge: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 11px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '.04em', background: '#dcfce7', color: '#166534' },
  liveDot: { width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 0 3px rgba(22,163,74,.18)' },
  refreshBtn: { padding: '5px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', color: '#475569', cursor: 'pointer' },

  metaStrip: { display: 'flex', flexWrap: 'wrap', gap: '22px', padding: '12px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '16px', fontSize: '12px' },
  metaK: { fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '3px' },
  metaV: { fontSize: '13px', fontWeight: 600, color: '#1e293b', fontFamily: 'monospace' },
  engineNote: { width: '100%', marginTop: '6px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', color: '#64748b', fontSize: '12px', lineHeight: 1.5 },

  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' },
  cardHead: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid #f1f5f9', background: '#fafafa' },
  cardTitle: { fontSize: '14px', fontWeight: 700, color: '#0f172a', flex: 1 },
  cardHint: { fontSize: '12px', color: '#94a3b8' },
  cardBody: { padding: '16px 18px' },

  fld: { display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '4px' },
  input: { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', background: '#fff', width: '100%', boxSizing: 'border-box' },
  select: { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', background: '#fff', width: '100%', boxSizing: 'border-box' },

  epDetail: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: '10px', marginTop: '14px' },
  epItem: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px' },
  epVal: { fontSize: '13px', fontWeight: 600, color: '#1e293b', fontFamily: 'monospace', wordBreak: 'break-all' },
  recOff: { color: '#b45309', fontWeight: 700 },
  recOn: { color: '#166534', fontWeight: 700 },
  btnAmber: { marginLeft: '10px', padding: '5px 11px', background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' },

  tabs: { display: 'flex', gap: '6px', marginBottom: '14px', alignItems: 'center' },
  tab: (active) => ({
    padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#c7d2fe' : '#e2e8f0'}`,
    background: active ? '#eef2ff' : '#f8fafc',
    color: active ? '#3730a3' : '#64748b',
  }),
  presetPill: { marginLeft: 'auto', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '20px', padding: '2px 9px' },

  formRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', alignItems: 'end' },
  fieldGroup: { display: 'flex', flexDirection: 'column' },
  evalBtn: { padding: '9px 18px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
  formFoot: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' },

  resultBox: (decision) => ({
    border: `1px solid ${{ PERMIT: '#bbf7d0', DENY: '#fecaca', INDETERMINATE: '#e9d5ff', STEP_UP: '#fde68a', CONSENT: '#bbf7d0' }[decision] || '#e2e8f0'}`,
    background: { PERMIT: '#f0fdf4', DENY: '#fef2f2', INDETERMINATE: '#faf5ff', STEP_UP: '#fffbeb', CONSENT: '#f0fdf4' }[decision] || '#f8fafc',
    borderRadius: '8px', padding: '14px 16px',
  }),
  resultDecision: (decision) => ({
    fontSize: '15px', fontWeight: 800,
    color: { PERMIT: '#166534', DENY: '#991b1b', INDETERMINATE: '#6b21a8', STEP_UP: '#854d0e', CONSENT: '#166534' }[decision] || '#374151',
  }),
  resultSub: { fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', marginBottom: '10px' },
  oblig: { display: 'flex', gap: '18px', fontSize: '12px', color: '#475569', marginBottom: '12px' },
  jsonGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  jsonLabel: { fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '5px' },
  pre: { margin: 0, padding: '11px', background: '#0f172a', color: '#e2e8f0', borderRadius: '7px', fontSize: '11.5px', fontFamily: 'monospace', overflowX: 'auto', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-all' },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '4px' },
  th: { textAlign: 'left', padding: '7px 10px', fontWeight: 700, color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '2px solid #f1f5f9' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f8fafc', verticalAlign: 'top', color: '#1e293b' },
  tdMono: { padding: '8px 10px', borderBottom: '1px solid #f8fafc', fontFamily: 'monospace', fontSize: '11px', color: '#1e293b' },
  dBadge: (d) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
    background: { PERMIT: '#dcfce7', DENY: '#fee2e2', INDETERMINATE: '#f3e8ff', STEP_UP: '#fef9c3' }[d] || '#f3f4f6',
    color: { PERMIT: '#166534', DENY: '#991b1b', INDETERMINATE: '#6b21a8', STEP_UP: '#854d0e' }[d] || '#374151',
  }),
  empty: { padding: '18px', textAlign: 'center', color: '#64748b', fontSize: '13px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px' },
  warning: { padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', color: '#92400e', fontSize: '13px', marginBottom: '16px' },
  error: { padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '13px', marginBottom: '16px' },
  iconBtn: { background: 'none', border: 'none', padding: 0, fontSize: '11px', color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline', marginTop: '8px' },

  tabHelp: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '11px 14px', marginBottom: '14px', fontSize: '12.5px', color: '#475569', lineHeight: 1.55 },
  tabHelpTitle: { fontWeight: 700, color: '#0f172a', marginRight: '6px' },

  // Authorization policy tree
  polTree: { display: 'flex', flexDirection: 'column', gap: '10px' },
  polNode: (kind) => ({
    border: '1px solid #e2e8f0',
    borderLeft: `3px solid ${{ POLICY_SET: '#6366f1', POLICY: '#0ea5e9', RULE: '#cbd5e1' }[kind] || '#cbd5e1'}`,
    borderRadius: '8px', padding: '10px 12px', background: '#fff',
  }),
  polHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  polKind: (kind) => ({
    fontSize: '9.5px', fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
    padding: '2px 7px', borderRadius: '5px',
    background: { POLICY_SET: '#eef2ff', POLICY: '#e0f2fe', RULE: '#f1f5f9' }[kind] || '#f1f5f9',
    color: { POLICY_SET: '#3730a3', POLICY: '#0369a1', RULE: '#475569' }[kind] || '#475569',
  }),
  polName: { fontSize: '13px', fontWeight: 700, color: '#0f172a' },
  polMeta: { fontSize: '10.5px', fontFamily: 'monospace', color: '#94a3b8' },
  polDesc: { fontSize: '12px', color: '#64748b', lineHeight: 1.5, margin: '6px 0 0' },
  polChildren: { marginTop: '10px', marginLeft: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  polEffect: (effect) => ({
    fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px',
    background: /DENY/.test(effect || '') ? '#fee2e2' : '#dcfce7',
    color: /DENY/.test(effect || '') ? '#991b1b' : '#166534',
  }),
  polDisabled: { fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: '#f3f4f6', color: '#6b7280' },
};

const TX_TYPES = ['transfer', 'withdrawal', 'deposit'];

// Per-tab explanation of what each preset sends to the decision endpoint.
const TAB_HELP = {
  transaction: {
    title: 'Transaction',
    body: 'Sends the parameters a banking transaction produces — Amount, TransactionType, UserId, and (optionally) Acr — to the selected decision endpoint. Use this to test the Transaction Authorization policy: the amount thresholds that trigger DENY or step-up MFA. This mirrors what the BFF sends on a real transfer/withdrawal/deposit.',
  },
  mcp: {
    title: 'MCP First Tool',
    body: "Sends the parameters of an AI agent's first MCP tool call — DecisionContext=McpFirstTool, ToolName, TokenAudience, ActClientId (the delegated actor), McpResourceUri, and HitlApproved — to test the MCP Delegation policy. Use this to see how token audience, actor-chain, and HITL-consent rules gate a tool invocation.",
  },
  custom: {
    title: 'Custom parameters',
    body: "Send an arbitrary set of Trust Framework attributes (name → value) to the endpoint. Use this to probe a policy with attribute combinations the two presets above don't cover, or to evaluate a non-Super-Banking endpoint. Each row maps to one attribute defined in the PingOne Authorize Trust Framework.",
  },
};

function formatTs(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// Map a normalized response to a single display decision token.
function displayDecision(r) {
  if (!r) return null;
  if (r.stepUpRequired) return 'STEP_UP';
  if (r.consentRequired || r.hitlRequired) return 'CONSENT';
  return r.decision;
}

const DECISION_ICON = { PERMIT: '✅', DENY: '❌', INDETERMINATE: '⚠️', STEP_UP: '⚠️', CONSENT: '⚠️' };

/** Normalize the PingOne Authorize HTTP call for the trace panel. */
function authorizeRequestPayload(result, endpointId, parameters) {
  if (result?.pingoneRequest) return result.pingoneRequest;
  return {
    method: 'POST',
    url: `/v1/environments/{envId}/decisionEndpoints/${endpointId || '{endpointId}'}`,
    contentType: 'application/json',
    body: { parameters },
  };
}

function authorizeResponsePayload(result) {
  return result?.pingoneResponse || result?.raw || null;
}

function endpointLabel(ep) {
  return `${ep.name || '(unnamed)'} — ${ep.id}`;
}

function DecisionRow({ d, idx }) {
  // PingOne recent-decision items nest the verdict under decisionResponse and
  // stamp the time as requestedAt. The request parameters (Amount/Type/Acr) are
  // not returned in the recent-decisions summary, so those columns show "—".
  const decision = d.decisionResponse?.decision || d.decision || d.result?.decision || '?';
  return (
    <tr>
      <td style={S.td}>{idx + 1}</td>
      <td style={S.td}><span style={S.dBadge(decision)}>{decision}</span></td>
      <td style={S.td}>{d.request?.parameters?.Amount ?? d.parameters?.Amount ?? '—'}</td>
      <td style={S.td}>{d.request?.parameters?.TransactionType ?? d.parameters?.TransactionType ?? d.request?.parameters?.ToolName ?? '—'}</td>
      <td style={S.td}>{d.request?.parameters?.Acr ?? d.parameters?.Acr ?? '—'}</td>
      <td style={S.tdMono}>{d.id || d.decisionId || '—'}</td>
      <td style={S.td}>{formatTs(d.requestedAt || d.createdAt || d.timestamp)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Evaluate panel — preset-driven parameter builders, all routed through the
// generic /api/authorize/evaluate-endpoint against the selected endpoint.
// ---------------------------------------------------------------------------
function EvaluatePanel({ endpointId, autoPreset, policies }) {
  const [preset, setPreset] = useState(autoPreset);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [lastTrace, setLastTrace] = useState(null);

  // Transaction preset fields
  const [amount, setAmount] = useState('5000');
  const [txType, setTxType] = useState('transfer');
  const [acr, setAcr] = useState('');
  const [userId, setUserId] = useState('demoUser');

  // MCP preset fields
  const [toolName, setToolName] = useState('transfer');
  const [tokenAudience, setTokenAudience] = useState('mcpgateway.ping.demo');
  // Defaults mirror what the real PingGateway sends to the cloud "MCP First Tool" policy
  // (p1az-decision.groovy), so the panel evaluates to PERMIT out of the box. The policy
  // needs BOTH: a valid delegated actor (act.sub = the AI Agent / PINGONE_AI_AGENT_CLIENT_ID;
  // blank -> mcp-invalid-actor) AND TokenAudience === McpResourceUri (the gateway sends the
  // same gatewayResourceUri for both; a URL here -> mcp-invalid-audience). Keep these two
  // in sync with tokenAudience above.
  const [actClientId, setActClientId] = useState('d21c5124-8ac5-43d1-81f2-31a7ec649b96');
  const [mcpResourceUri, setMcpResourceUri] = useState('mcpgateway.ping.demo');
  const [hitlApproved, setHitlApproved] = useState(false);

  // Custom preset rows
  const [customRows, setCustomRows] = useState([
    { key: 'DecisionContext', value: 'McpToolCall' },
    { key: '', value: '' },
  ]);

  // When the endpoint changes, reset to its auto-detected preset and clear result.
  useEffect(() => { setPreset(autoPreset); setResult(null); setErr(null); setLastTrace(null); }, [endpointId, autoPreset]);

  // Pre-fill the MCP First Tool fields from config (the real delegated actor +
  // the expected resource URI for the active exchange mode) so a default Evaluate
  // mirrors the real pipeline (a PERMIT) instead of the blank-actor / mismatched-
  // audience defaults that always DENY. Fields remain fully editable. One-shot on
  // mount; failures leave the static fallbacks in place.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bffAxios.get('/api/authorize/mcp-console-defaults');
        if (cancelled || !res.data) return;
        const d = res.data;
        if (d.actClientId) setActClientId(d.actClientId);
        if (d.tokenAudience) setTokenAudience(d.tokenAudience);
        if (d.mcpResourceUri) setMcpResourceUri(d.mcpResourceUri);
      } catch { /* keep static fallbacks */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const buildParameters = () => {
    const ts = new Date().toISOString();
    if (preset === 'transaction') {
      return {
        Amount: Number(amount) || 0,
        TransactionType: txType,
        UserId: userId,
        ...(acr ? { Acr: acr } : {}),
        Timestamp: ts,
      };
    }
    if (preset === 'mcp') {
      return {
        DecisionContext: 'McpFirstTool',
        UserId: userId,
        ToolName: toolName,
        TokenAudience: tokenAudience,
        ActClientId: actClientId,
        McpResourceUri: mcpResourceUri,
        ...(hitlApproved ? { HitlApproved: true } : {}),
        Timestamp: ts,
      };
    }
    // custom
    const params = {};
    customRows.forEach(({ key, value }) => {
      const k = String(key || '').trim();
      if (k) params[k] = value;
    });
    return params;
  };

  const run = async () => {
    setRunning(true); setResult(null); setErr(null); setLastTrace(null);
    const parameters = buildParameters();
    const started = Date.now();
    try {
      const res = await bffAxios.post('/api/authorize/evaluate-endpoint', {
        endpointId,
        parameters,
      });
      const elapsed = Date.now() - started;
      setResult(res.data);
      setLastTrace({
        request: authorizeRequestPayload(res.data, endpointId, parameters),
        response: authorizeResponsePayload(res.data),
        timingsMs: elapsed,
        error: false,
      });
    } catch (e) {
      const elapsed = Date.now() - started;
      const message = e.response?.data?.message || e.response?.data?.error || e.message;
      setErr(message);
      setLastTrace({
        request: authorizeRequestPayload(null, endpointId, parameters),
        response: e.response?.data || { error: message },
        timingsMs: elapsed,
        error: true,
      });
    } finally { setRunning(false); }
  };

  const setRow = (i, field, val) => {
    setCustomRows(rows => {
      const next = rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r);
      // keep one trailing empty row for easy appends
      const last = next[next.length - 1];
      if (last && (last.key || last.value)) next.push({ key: '', value: '' });
      return next;
    });
  };
  const removeRow = (i) => setCustomRows(rows => rows.filter((_, idx) => idx !== i));

  const decision = displayDecision(result);
  const presetLabel = { transaction: 'Transaction', mcp: 'MCP First Tool', custom: 'Custom' }[preset];

  return (
    <div>
      <div style={S.tabs}>
        <span style={S.tab(preset === 'transaction')} onClick={() => setPreset('transaction')}>Transaction</span>
        <span style={S.tab(preset === 'mcp')} onClick={() => setPreset('mcp')}>MCP First Tool</span>
        <span style={S.tab(preset === 'custom')} onClick={() => setPreset('custom')}>Custom parameters</span>
        <span style={S.presetPill}>preset: {presetLabel}</span>
      </div>

      {TAB_HELP[preset] && (
        <div style={S.tabHelp}>
          <span style={S.tabHelpTitle}>{TAB_HELP[preset].title}:</span>
          {TAB_HELP[preset].body}
        </div>
      )}

      {preset === 'transaction' && (
        <div style={S.formRow}>
          <div style={S.fieldGroup}><label style={S.fld}>Amount (USD)</label>
            <input style={S.input} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" /></div>
          <div style={S.fieldGroup}><label style={S.fld}>Transaction type</label>
            <select style={S.select} value={txType} onChange={e => setTxType(e.target.value)}>
              {TX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div style={S.fieldGroup}><label style={S.fld}>ACR (auth context)</label>
            <select style={S.select} value={acr} onChange={e => setAcr(e.target.value)}>
              <option value="">(none)</option><option value="MFA">MFA</option><option value="Single">Single</option>
            </select></div>
          <div style={S.fieldGroup}><label style={S.fld}>User ID</label>
            <input style={S.input} type="text" value={userId} onChange={e => setUserId(e.target.value)} /></div>
        </div>
      )}

      {preset === 'mcp' && (
        <>
          <div style={S.formRow}>
            <div style={S.fieldGroup}><label style={S.fld}>Tool name</label>
              <input style={S.input} type="text" value={toolName} onChange={e => setToolName(e.target.value)} /></div>
            <div style={S.fieldGroup}><label style={S.fld}>Token audience</label>
              <input style={S.input} type="text" value={tokenAudience} onChange={e => setTokenAudience(e.target.value)} /></div>
            <div style={S.fieldGroup}><label style={S.fld}>Act client id</label>
              <input style={S.input} type="text" value={actClientId} onChange={e => setActClientId(e.target.value)} placeholder="act.client_id" /></div>
            <div style={S.fieldGroup}><label style={S.fld}>User ID</label>
              <input style={S.input} type="text" value={userId} onChange={e => setUserId(e.target.value)} /></div>
          </div>
          <div style={{ ...S.formRow, gridTemplateColumns: '1fr 2fr 1fr', marginTop: '12px' }}>
            <div style={S.fieldGroup}><label style={S.fld}>HitlApproved</label>
              <select style={S.select} value={hitlApproved ? 'true' : 'false'} onChange={e => setHitlApproved(e.target.value === 'true')}>
                <option value="false">false</option><option value="true">true</option>
              </select></div>
            <div style={S.fieldGroup}><label style={S.fld}>MCP resource URI</label>
              <input style={S.input} type="text" value={mcpResourceUri} onChange={e => setMcpResourceUri(e.target.value)} /></div>
            <div />
          </div>
        </>
      )}

      {preset === 'custom' && (
        <table style={S.table}>
          <thead><tr>
            <th style={{ ...S.th, width: '42%' }}>Parameter (Trust Framework attribute)</th>
            <th style={S.th}>Value</th>
            <th style={{ ...S.th, width: '44px' }}></th>
          </tr></thead>
          <tbody>
            {customRows.map((r, i) => (
              <tr key={i}>
                <td style={S.td}><input style={S.input} type="text" value={r.key} placeholder="add attribute…" onChange={e => setRow(i, 'key', e.target.value)} /></td>
                <td style={S.td}><input style={S.input} type="text" value={r.value} placeholder="value…" onChange={e => setRow(i, 'value', e.target.value)} /></td>
                <td style={S.td}>
                  {(r.key || r.value) ? (
                    <button style={{ ...S.iconBtn, marginTop: 0, color: '#dc2626' }} onClick={() => removeRow(i)}>remove</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={S.formFoot}>
        <button style={S.evalBtn} onClick={run} disabled={running || !endpointId}>{running ? 'Evaluating…' : 'Evaluate (live)'}</button>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '10px' }}>❌ {err}</div>}

      {result && (
        <div style={{ ...S.resultBox(decision), marginTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={S.resultDecision(decision)}>{DECISION_ICON[decision] || '?'} {decision}</span>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>engine: {result.engine}</span>
          </div>
          <div style={S.resultSub}>
            {result.decisionId ? `Decision ID ${result.decisionId} · ` : ''}path: {result.path || '—'}
          </div>
          <div style={S.oblig}>
            <div>Step-up: <b>{result.stepUpRequired ? 'yes' : 'no'}</b></div>
            <div>Consent / HITL: <b>{(result.consentRequired || result.hitlRequired) ? 'yes' : 'no'}</b></div>
          </div>
        </div>
      )}

      {lastTrace && (
        <>
          <div className={`p1mcp-call-status ${lastTrace.error ? 'p1mcp-call-status--error' : ''}`} style={{ marginTop: '12px' }}>
            {lastTrace.error
              ? 'PingOne Authorize call failed'
              : `Completed in ${lastTrace.timingsMs ?? '?'} ms`}
          </div>
          <Section
            title="Authorize request"
            hint="POST decisionEndpoints — BFF → PingOne Authorize"
            status="ok"
            defaultOpen
          >
            <pre className="mcp-inspector__code jh-dark">
              <JsonHighlight value={lastTrace.request} deep />
            </pre>
          </Section>
          <Section
            title="Authorize response"
            status={lastTrace.error ? 'error' : 'ok'}
            defaultOpen
          >
            {lastTrace.response ? (
              <pre className="mcp-inspector__code jh-dark">
                <JsonHighlight value={lastTrace.response} deep />
              </pre>
            ) : (
              <p className="mcp-inspector__muted">No response body returned.</p>
            )}
          </Section>
        </>
      )}

      {result && <PolicyDecisionTree policies={policies} result={result} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Authorization policy tree — one recursive node (Policy Set → Policy → Rule)
// ---------------------------------------------------------------------------
function PolicyNode({ node }) {
  if (!node) return null;
  const kindLabel = { POLICY_SET: 'Policy Set', POLICY: 'Policy', RULE: 'Rule' }[node.kind] || node.kind;
  return (
    <div style={S.polNode(node.kind)}>
      <div style={S.polHead}>
        <span style={S.polKind(node.kind)}>{kindLabel}</span>
        <span style={S.polName}>{node.name}</span>
        {node.algorithm && <span style={S.polMeta}>{node.algorithm}</span>}
        {node.effect && <span style={S.polEffect(node.effect)}>{node.effect.replace(/_/g, ' ')}</span>}
        {!node.enabled && <span style={S.polDisabled}>disabled</span>}
      </div>
      {node.description && <p style={S.polDesc}>{node.description}</p>}
      {node.children?.length > 0 && (
        <div style={S.polChildren}>
          {node.children.map((c) => <PolicyNode key={c.id} node={c} />)}
        </div>
      )}
    </div>
  );
}

// Read-only listing of the live PingOne Authorize policy tree. This is what the
// decision endpoints actually enforce — distinct from the endpoints themselves.
// The tree is fetched once at the page level and passed in via `state` so the
// Evaluate panel's decision-trace diagram can reuse it without a second fetch.
function PoliciesCard({ state }) {
  const ruleCount = (nodes) => nodes.reduce((n, p) => n + (p.kind === 'RULE' ? 1 : 0) + ruleCount(p.children || []), 0);

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Authorization Policies</span>
        <span style={S.cardHint}>
          {state.loading ? 'loading…' : `${state.policies.length} policy set${state.policies.length !== 1 ? 's' : ''} · ${ruleCount(state.policies)} rules`}
        </span>
      </div>
      <div style={S.cardBody}>
        <p style={{ ...S.subtitle, marginBottom: '12px' }}>
          The live policy tree from PingOne Authorize. Each decision endpoint above evaluates a published version of this tree —
          a decision endpoint is the HTTP entry point, while these policies and rules are the logic it runs.
        </p>
        {state.loading ? (
          <div style={S.empty}>Loading policies…</div>
        ) : state.error ? (
          <div style={{ ...S.empty, color: '#b45309', borderColor: '#fde68a', background: '#fffbeb' }}>⚠️ {state.error}</div>
        ) : state.policies.length === 0 ? (
          <div style={S.empty}>{state.note || 'No authorization policies found in this environment.'}</div>
        ) : (
          <>
            {/* A note alongside a tree means the tree came from a fallback
                source (e.g. the repo snapshot) — show it above, don't hide the tree. */}
            {state.note ? <div style={{ ...S.empty, marginBottom: '10px' }}>{state.note}</div> : null}
            <div style={S.polTree}>
              {state.policies.map((p) => <PolicyNode key={p.id} node={p} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PingOneAuthorizePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [recent, setRecent] = useState({ decisions: [], error: null, loading: false });
  const [enabling, setEnabling] = useState(false);
  // Live policy tree — fetched once and shared by the read-only PoliciesCard and
  // the Evaluate panel's decision-trace diagram (avoids a duplicate fetch).
  const [policiesState, setPoliciesState] = useState({ policies: [], loading: true, error: null, note: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bffAxios.get('/api/authorize/pingone-policies');
        if (!cancelled) setPoliciesState({ policies: res.data?.policies || [], loading: false, error: null, note: res.data?.note || null });
      } catch (e) {
        if (!cancelled) setPoliciesState({ policies: [], loading: false, error: e.response?.data?.message || e.response?.data?.error || e.message, note: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await bffAxios.get('/api/authorize/pingone-live-policy');
      setData(res.data);
      // Default selection: configured transaction endpoint, else first endpoint.
      const eps = res.data?.endpoints || [];
      setSelectedId(prev => {
        if (prev && eps.some(e => e.id === prev)) return prev;
        return res.data?.transactionEndpointId || eps[0]?.id || '';
      });
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const endpoints = data?.endpoints || [];
  const selected = useMemo(() => endpoints.find(e => e.id === selectedId) || null, [endpoints, selectedId]);
  const recordingOn = !!selected?.recordRecentRequests;

  // Auto preset: match configured transaction / MCP endpoints, else custom.
  const autoPreset = useMemo(() => {
    if (selectedId && selectedId === data?.transactionEndpointId) return 'transaction';
    if (selectedId && selectedId === data?.mcpEndpointId) return 'mcp';
    return 'custom';
  }, [selectedId, data]);

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

  const enableRecording = async () => {
    if (!selectedId) return;
    setEnabling(true);
    try {
      const res = await bffAxios.post(`/api/authorize/endpoints/${encodeURIComponent(selectedId)}/recording`, { enabled: true });
      const on = res.data?.recordRecentRequests !== false;
      // Patch just this endpoint's flag from the response. Flipping recordingOn
      // (derived from data) triggers the recent-decisions effect to refetch — no
      // need to reload the whole policy summary or fetch recent decisions twice.
      setData(d => d ? { ...d, endpoints: (d.endpoints || []).map(e => e.id === selectedId ? { ...e, recordRecentRequests: on } : e) } : d);
    } catch (e) {
      setRecent(r => ({ ...r, error: e.response?.data?.message || e.message }));
    } finally { setEnabling(false); }
  };

  if (loading) return <div style={{ padding: '40px', color: '#64748b', fontSize: '14px' }}>Loading PingOne Authorize configuration…</div>;

  const notConfigured = !data?.workerConfigured;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div>
          <h2 style={S.title}>PingOne Authorize — Live Policy Console</h2>
          <p style={S.subtitle}>Select a decision endpoint, send a real decision request, and inspect the live verdict.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={S.liveBadge}><span style={S.liveDot} /> LIVE · calls real PingOne</span>
          <button style={S.refreshBtn} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {error && <div style={S.error}>❌ {error}</div>}

      {notConfigured ? (
        <div style={S.warning}>
          ⚠️ PingOne Authorize worker credentials are not configured. Set{' '}
          <code>PINGONE_WORKER_CLIENT_ID</code> + <code>PINGONE_WORKER_CLIENT_SECRET</code> in{' '}
          <code>.env</code>, or go to <strong>App Configuration → PingOne Setup</strong> and enter{' '}
          <code>authorize_worker_client_id</code> / <code>authorize_worker_client_secret</code>.
          {data?.note && <div style={{ marginTop: '6px', fontSize: '12px' }}>{data.note}</div>}
        </div>
      ) : (
        <div style={S.metaStrip}>
          <div><div style={S.metaK}>Environment</div><div style={S.metaV}>{data?.environmentId || '—'}</div></div>
          <div><div style={S.metaK}>Region</div><div style={S.metaV}>{data?.region || 'com'}</div></div>
          <div><div style={S.metaK}>Worker app</div><div style={S.metaV}>configured ✅</div></div>
          <div style={S.engineNote}>
            This console always calls PingOne Authorize live. The app-wide enforcement engine is currently
            <strong> {data?.activeEngine || 'unknown'}</strong> — running tests here does <strong>not</strong> change how real transactions are gated.
          </div>
        </div>
      )}

      {/* Decision endpoint picker */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Decision Endpoint</span>
          <span style={S.cardHint}>{endpoints.length} in environment</span>
        </div>
        <div style={S.cardBody}>
          {endpoints.length === 0 ? (
            <div style={S.empty}>No decision endpoints found in this environment.</div>
          ) : (
            <>
              <label style={S.fld}>Endpoint</label>
              <select style={{ ...S.select, fontWeight: 600 }} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                {endpoints.map(ep => <option key={ep.id} value={ep.id}>{endpointLabel(ep)}</option>)}
              </select>
              {selected && (
                <div style={S.epDetail}>
                  <div style={S.epItem}>
                    <div style={S.metaK}>Endpoint ID</div>
                    <div style={S.epVal}>{selected.id}</div>
                  </div>
                  {selected.description && (
                    <div style={S.epItem}>
                      <div style={S.metaK}>Description</div>
                      <div style={{ ...S.epVal, fontFamily: 'inherit', fontWeight: 500, color: '#475569' }}>{selected.description}</div>
                    </div>
                  )}
                  <div style={S.epItem}>
                    <div style={S.metaK}>Recent-decision recording</div>
                    <div style={S.epVal}>
                      {recordingOn
                        ? <span style={S.recOn}>✅ on</span>
                        : <>
                            <span style={S.recOff}>⚠️ off</span>
                            <button style={S.btnAmber} onClick={enableRecording} disabled={enabling}>
                              {enabling ? 'Enabling…' : 'Enable recording'}
                            </button>
                          </>}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Authorization policies (read-only tree) */}
      <PoliciesCard state={policiesState} />

      {/* Evaluate */}
      <div style={S.card}>
        <div style={S.cardHead}><span style={S.cardTitle}>Evaluate</span></div>
        <div style={S.cardBody}>
          {selectedId
            ? <EvaluatePanel endpointId={selectedId} autoPreset={autoPreset} policies={policiesState.policies} />
            : <div style={S.empty}>Select a decision endpoint to evaluate.</div>}
        </div>
      </div>

      {/* Recent decisions */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Recent Decisions</span>
          <span style={S.cardHint}>{selected?.name ? `${selected.name} · ` : ''}{recent.decisions.length} loaded</span>
        </div>
        <div style={S.cardBody}>
          {!recordingOn ? (
            <div style={S.empty}>
              Recording is off for this endpoint. Click <strong>Enable recording</strong> above to start capturing the last 20 decisions (24-hour window).
            </div>
          ) : recent.loading ? (
            <div style={S.empty}>Loading recent decisions…</div>
          ) : recent.error ? (
            <div style={{ ...S.empty, color: '#b45309', borderColor: '#fde68a', background: '#fffbeb' }}>⚠️ {recent.error}</div>
          ) : recent.decisions.length === 0 ? (
            <div style={S.empty}>No recent decisions yet. Run an evaluation above to populate this list.</div>
          ) : (
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>#</th><th style={S.th}>Decision</th><th style={S.th}>Amount</th>
                <th style={S.th}>Type</th><th style={S.th}>ACR</th><th style={S.th}>Decision ID</th><th style={S.th}>Time</th>
              </tr></thead>
              <tbody>{recent.decisions.map((d, i) => <DecisionRow key={i} d={d} idx={i} />)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
