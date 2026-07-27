import React, { useState, useEffect, useCallback } from 'react';
import { MdCheckCircle, MdCancel, MdWarning } from 'react-icons/md';
import bffAxios from '../services/bffAxios';
import JsonHighlight from './shared/JsonHighlight';

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------
const S = {
  root: { padding: '28px 32px', maxWidth: '960px', fontFamily: 'inherit' },
  title: { fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px' },
  subtitle: { fontSize: '13px', color: '#64748b', margin: '0 0 24px', lineHeight: 1.5 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' },
  cardHead: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid #f1f5f9', background: '#fafafa' },
  cardTitle: { fontSize: '14px', fontWeight: 700, color: '#0f172a', flex: 1 },
  cardPriority: { fontSize: '11px', color: '#94a3b8', fontWeight: 500 },
  cardBody: { padding: '14px 18px' },
  desc: { fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 0 14px' },
  sectionLabel: { fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '8px' },
  badge: (d) => ({
    display: 'inline-block', padding: '2px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '.04em',
    background: { PERMIT: '#dcfce7', DENY: '#fee2e2', INDETERMINATE: '#f3e8ff' }[d] || '#f1f5f9',
    color:      { PERMIT: '#166534', DENY: '#991b1b', INDETERMINATE: '#6b21a8' }[d] || '#374151',
  }),
  toolChip: (write) => ({ padding: '3px 9px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', background: write ? '#fff7ed' : '#f0fdf4', border: `1px solid ${write ? '#fed7aa' : '#bbf7d0'}`, color: write ? '#92400e' : '#166534' }),
  scopePill: { padding: '2px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, background: '#dbeafe', color: '#1e40af', fontFamily: 'monospace' },
  divider: { height: '1px', background: '#f1f5f9', margin: '12px 0' },
  testBox: { background: '#f8fafc', borderRadius: '7px', padding: '12px 14px', marginTop: '8px' },
  testLabel: { fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '10px' },
  row: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '8px' },
  fld: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '11px', fontWeight: 600, color: '#64748b' },
  inp: { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', fontFamily: 'inherit', background: '#fff', minWidth: '160px' },
  sel: { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', fontFamily: 'inherit', background: '#fff' },
  btn: { padding: '6px 14px', background: 'var(--brand-blue)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  linkBtn: { background: 'none', border: 'none', padding: '0', fontSize: '11px', color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline', marginTop: '6px' },
  metaBar: { display: 'flex', gap: '16px', padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '20px', flexWrap: 'wrap' },
  metaItem: { fontSize: '11px', color: '#64748b' },
  metaVal: { fontWeight: 700, color: '#1e293b', fontFamily: 'monospace' },
  vtabs: { display: 'flex', gap: '0', borderBottom: '2px solid #e2e8f0', marginBottom: '12px' },
  vtab: (active) => ({ padding: '6px 14px', border: 'none', background: 'none', fontSize: '12px', fontWeight: active ? 700 : 500, color: active ? 'var(--brand-blue)' : '#64748b', borderBottom: `2px solid ${active ? 'var(--brand-blue)' : 'transparent'}`, marginBottom: '-2px', cursor: 'pointer' }),
  toolRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 0', borderBottom: '1px solid #f8fafc' },
  pre: { margin: 0, padding: '10px', background: '#0f172a', color: '#e2e8f0', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace', overflowX: 'auto', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' },
  colLabel: { fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' },
};

// ---------------------------------------------------------------------------
// Shared micro-components
// ---------------------------------------------------------------------------
const ICON_STYLE = { verticalAlign: 'middle', marginRight: '4px' };
const DECISION_ICON = {
  PERMIT:        <MdCheckCircle style={{ ...ICON_STYLE, color: '#16a34a' }} />,
  DENY:          <MdCancel      style={{ ...ICON_STYLE, color: '#dc2626' }} />,
  INDETERMINATE: <MdWarning     style={{ ...ICON_STYLE, color: '#d97706' }} />,
};
function ErrIcon() {
  return <MdCancel style={{ ...ICON_STYLE, color: '#dc2626' }} />;
}
function WarnIcon() {
  return <MdWarning style={{ ...ICON_STYLE, color: '#d97706' }} />;
}

// ---------------------------------------------------------------------------
// Shared: decision result with request/response reveal
// ---------------------------------------------------------------------------
function DecisionResult({ result }) {
  const [showRaw, setShowRaw] = useState(false);
  const decision = result.decision || 'UNKNOWN';
  const icon = DECISION_ICON[decision] ?? null;
  const bgMap = { PERMIT: '#f0fdf4', DENY: '#fef2f2', INDETERMINATE: '#faf5ff' };
  const borderMap = { PERMIT: '#bbf7d0', DENY: '#fecaca', INDETERMINATE: '#e9d5ff' };

  const reqBody = result.parametersUsed ? { parameters: result.parametersUsed } : null;
  const respBody = { decision: result.decision, reason: result.reason, decision_id: result.decision_id, policy_version: result.policy_version };

  return (
    <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '7px', background: bgMap[decision] || '#f8fafc', border: `1px solid ${borderMap[decision] || '#e2e8f0'}` }}>
      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '3px' }}>
        {icon} {decision === 'INDETERMINATE' ? 'INDETERMINATE — HITL required' : decision}
      </div>
      {result.reason && <div style={{ fontSize: '11px', color: '#4b5563' }}>Reason: {result.reason}</div>}
      {result.decision_id && <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace' }}>Decision ID: {result.decision_id}</div>}
      {result.endpointUrl && <div style={{ fontSize: '10px', color: '#9ca3af' }}>Endpoint: {result.endpointUrl}</div>}
      <button style={S.linkBtn} onClick={() => setShowRaw(v => !v)}>
        {showRaw ? 'Hide' : 'Show'} request / response
      </button>
      {showRaw && (
        <div style={S.twoCol}>
          <div>
            <div style={S.colLabel}>Request → authz server</div>
            <pre style={S.pre} className="jh-dark"><JsonHighlight value={reqBody || {}} /></pre>
          </div>
          <div>
            <div style={S.colLabel}>Response ← authz server</div>
            <pre style={S.pre} className="jh-dark"><JsonHighlight value={respBody} /></pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule 1 — Tool Discovery
// ---------------------------------------------------------------------------
function ToolDiscoveryCard({ rule }) {
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardPriority}>Rule {rule.priority}</span>
        <span style={S.cardTitle}>{rule.name}</span>
        <span style={S.badge(rule.decision)}>{rule.decision}</span>
        <code style={{ fontSize: '11px', color: '#6b7280' }}>{rule.context}</code>
      </div>
      <div style={S.cardBody}>
        <p style={S.desc}>{rule.description}</p>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>No inputs — tool listing is unconditionally permitted.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule 2 — Actor Identity
// ---------------------------------------------------------------------------
function ActorIdentityCard({ rule }) {
  const [actClientId, setActClientId] = useState('');
  const [toolName, setToolName] = useState('get_my_accounts');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    setRunning(true); setResult(null); setErr(null);
    try {
      const res = await bffAxios.post('/api/authorize/test-evaluate-mcp', { toolName, actClientId: actClientId || undefined });
      setResult(res.data);
    } catch (e) { setErr(e.response?.data?.message || e.message); }
    finally { setRunning(false); }
  };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardPriority}>Rule {rule.priority}</span>
        <span style={S.cardTitle}>{rule.name}</span>
        <span style={S.badge(rule.decision)}>{rule.decision}</span>
        <code style={{ fontSize: '11px', color: '#6b7280' }}>{rule.context}</code>
      </div>
      <div style={S.cardBody}>
        <p style={S.desc}>{rule.description}</p>
        {rule.config.configured
          ? <div style={{ fontSize: '12px', marginBottom: '8px' }}><span style={{ color: '#6b7280', fontWeight: 600 }}>Authorized actor: </span><code style={{ fontFamily: 'monospace' }}>{rule.config.authorizedActorClientId}</code></div>
          : <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px' }}><WarnIcon />{rule.config.note}</div>
        }
        <div style={S.divider} />
        <div style={S.testBox}>
          <div style={S.testLabel}>Test this rule</div>
          <div style={S.row}>
            <div style={S.fld}><label style={S.lbl}>Tool name</label><input style={S.inp} value={toolName} onChange={e => setToolName(e.target.value)} /></div>
            <div style={S.fld}><label style={S.lbl}>act.sub override (leave blank = session actor)</label><input style={S.inp} value={actClientId} onChange={e => setActClientId(e.target.value)} placeholder="any-unknown-client-id" /></div>
            <button style={S.btn} onClick={run} disabled={running}>{running ? 'Testing…' : 'Run'}</button>
          </div>
          {err && <div style={{ color: '#dc2626', fontSize: '12px' }}><ErrIcon />{err}</div>}
          {result && <DecisionResult result={result} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule 3 — Scope Enforcement (with vertical grouping)
// ---------------------------------------------------------------------------
function ScopeEnforcementCard({ rule, mcpTools }) {
  const verticalGroups = rule.config.verticalGroups || {};
  const verticals = Object.keys(verticalGroups);
  const [activeVertical, setActiveVertical] = useState(verticals[0] || '');
  const [toolName, setToolName] = useState('');
  const [scopeOverride, setScopeOverride] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const currentGroup = verticalGroups[activeVertical] || {};
  const toolNames = Object.keys(currentGroup);

  // Reset tool selection when vertical changes
  const handleVertical = (v) => { setActiveVertical(v); setToolName(''); setResult(null); setErr(null); };

  const requiredScopes = currentGroup[toolName] || (rule.config.toolScopes || {})[toolName] || [];

  const run = async () => {
    setRunning(true); setResult(null); setErr(null);
    try {
      const res = await bffAxios.post('/api/authorize/test-evaluate-mcp', {
        toolName: toolName || toolNames[0],
        tokenScopes: scopeOverride || undefined,
      });
      setResult(res.data);
    } catch (e) { setErr(e.response?.data?.message || e.message); }
    finally { setRunning(false); }
  };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardPriority}>Rule {rule.priority}</span>
        <span style={S.cardTitle}>{rule.name}</span>
        <span style={S.badge(rule.decision)}>{rule.decision}</span>
        <code style={{ fontSize: '11px', color: '#6b7280' }}>{rule.context}</code>
      </div>
      <div style={S.cardBody}>
        <p style={S.desc}>{rule.description}</p>

        {/* Vertical selector tabs */}
        <div style={S.sectionLabel}>Tool scope requirements by vertical</div>
        <div style={S.vtabs}>
          {verticals.map(v => (
            <button key={v} style={S.vtab(v === activeVertical)} onClick={() => handleVertical(v)}>{v}</button>
          ))}
        </div>

        {/* Tool chips for active vertical */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {toolNames.map(name => (
            <div key={name} style={S.toolRow}>
              <span style={S.toolChip(currentGroup[name]?.includes('write'))}>{name}</span>
              <span style={{ flex: 1 }} />
              {(currentGroup[name] || []).map(s => <span key={s} style={S.scopePill}>{s}</span>)}
            </div>
          ))}
        </div>

        <div style={S.divider} />
        <div style={S.testBox}>
          <div style={S.testLabel}>Test scope enforcement</div>
          <div style={S.row}>
            <div style={S.fld}>
              <label style={S.lbl}>Tool {requiredScopes.length > 0 && `(requires: ${requiredScopes.join(', ')})`}</label>
              <select style={S.sel} value={toolName} onChange={e => setToolName(e.target.value)}>
                <option value="">— select a tool —</option>
                {toolNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={S.fld}>
              <label style={S.lbl}>Token scopes (blank = use session token)</label>
              <input style={S.inp} value={scopeOverride} onChange={e => setScopeOverride(e.target.value)} placeholder="e.g. read  (omit 'write' to test DENY)" />
            </div>
            <button style={S.btn} onClick={run} disabled={running || !toolName}>{running ? 'Testing…' : 'Run'}</button>
          </div>
          {err && <div style={{ color: '#dc2626', fontSize: '12px' }}><ErrIcon />{err}</div>}
          {result && <DecisionResult result={result} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule 4 — HITL Write Gate
// ---------------------------------------------------------------------------
function HitlGateCard({ rule }) {
  const [toolName, setToolName] = useState(rule.config.writeTools?.[0] || '');
  const [amount, setAmount] = useState('');
  const [hitlApproved, setHitlApproved] = useState(false);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    setRunning(true); setResult(null); setErr(null);
    try {
      const res = await bffAxios.post('/api/authorize/test-evaluate-mcp', {
        toolName, amount: amount ? parseFloat(amount) : undefined, hitlApproved,
      });
      setResult(res.data);
    } catch (e) { setErr(e.response?.data?.message || e.message); }
    finally { setRunning(false); }
  };

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardPriority}>Rule {rule.priority}</span>
        <span style={S.cardTitle}>{rule.name}</span>
        <span style={S.badge(rule.decision)}>{rule.decision}</span>
        <code style={{ fontSize: '11px', color: '#6b7280' }}>{rule.context}</code>
      </div>
      <div style={S.cardBody}>
        <p style={S.desc}>{rule.description}</p>
        <div style={{ fontSize: '12px', marginBottom: '8px' }}>
          <span style={{ color: '#6b7280', fontWeight: 600 }}>Threshold: </span>
          <code>${rule.config.thresholdUsd}</code>
        </div>
        <div style={S.sectionLabel}>Write tools gated by this rule</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
          {(rule.config.writeTools || []).map(n => <span key={n} style={S.toolChip(true)}>{n}</span>)}
        </div>
        {rule.config.note && <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{rule.config.note}</div>}
        <div style={S.divider} />
        <div style={S.testBox}>
          <div style={S.testLabel}>Test HITL gate</div>
          <div style={S.row}>
            <div style={S.fld}>
              <label style={S.lbl}>Write tool</label>
              <select style={S.sel} value={toolName} onChange={e => setToolName(e.target.value)}>
                {(rule.config.writeTools || []).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={S.fld}>
              <label style={S.lbl}>Amount (blank = unknown → always HITL)</label>
              <input style={S.inp} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`e.g. ${rule.config.thresholdUsd + 100}`} />
            </div>
            <div style={{ ...S.fld, justifyContent: 'flex-end' }}>
              <label style={{ ...S.lbl, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={hitlApproved} onChange={e => setHitlApproved(e.target.checked)} />
                HitlApproved (consent already given)
              </label>
            </div>
            <button style={S.btn} onClick={run} disabled={running || !toolName}>{running ? 'Testing…' : 'Run'}</button>
          </div>
          {err && <div style={{ color: '#dc2626', fontSize: '12px' }}><ErrIcon />{err}</div>}
          {result && <DecisionResult result={result} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin editor — pull / modify / push the editable knobs (drives live decisions)
// ---------------------------------------------------------------------------
const modTag = { display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047', textTransform: 'uppercase', letterSpacing: '.04em' };

function RulesEditor({ editable, onSaved }) {
  const clone = useCallback(() => JSON.parse(JSON.stringify(editable)), [editable]);
  const [draft, setDraft] = useState(clone);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  // Re-sync the draft whenever the server truth changes (after save/reset/reload).
  useEffect(() => { setDraft(clone()); setNotice(null); }, [clone]);

  const g = draft.global;
  const allowed = draft.allowedScopes || ['read', 'write', 'admin'];

  const setG = (k, v) => setDraft(d => ({ ...d, global: { ...d.global, [k]: { ...d.global[k], value: v } } }));
  const setToolScopes = (tool, scopes) => setDraft(d => ({ ...d, tools: { ...d.tools, [tool]: { ...d.tools[tool], requiredScopes: { ...d.tools[tool].requiredScopes, value: scopes } } } }));
  const setToolWrite = (tool, w) => setDraft(d => ({ ...d, tools: { ...d.tools, [tool]: { ...d.tools[tool], isWrite: { ...d.tools[tool].isWrite, value: w } } } }));

  const sameScopes = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');

  // Only changed fields are sent, so the persisted overlay stays sparse.
  const buildPatch = () => {
    const patch = {};
    const gp = {};
    if (Number(g.hitlThresholdUsd.value) !== editable.global.hitlThresholdUsd.value) gp.hitlThresholdUsd = Number(g.hitlThresholdUsd.value);
    if ((g.authorizedActorClientId.value || '') !== (editable.global.authorizedActorClientId.value || '')) gp.authorizedActorClientId = g.authorizedActorClientId.value || '';
    if (g.toolDiscoveryDecision.value !== editable.global.toolDiscoveryDecision.value) gp.toolDiscoveryDecision = g.toolDiscoveryDecision.value;
    if (Object.keys(gp).length) patch.global = gp;
    const tp = {};
    for (const [tool, f] of Object.entries(draft.tools)) {
      const base = editable.tools[tool];
      const e = {};
      if (!sameScopes(f.requiredScopes.value, base.requiredScopes.value)) e.requiredScopes = f.requiredScopes.value;
      if (!!f.isWrite.value !== base.isWrite.value) e.isWrite = !!f.isWrite.value;
      if (Object.keys(e).length) tp[tool] = e;
    }
    if (Object.keys(tp).length) patch.tools = tp;
    return patch;
  };

  const dirty = Object.keys(buildPatch()).length > 0;

  const save = async () => {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return;
    setSaving(true); setErr(null); setNotice(null);
    try {
      await bffAxios.put('/api/authorize/mock-authz-rules', patch);
      setNotice('Rules saved — live enforcement updated.');
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    setSaving(true); setErr(null); setNotice(null);
    try {
      await bffAxios.post('/api/authorize/mock-authz-rules/reset');
      setNotice('Reset to scope-topology.json + env defaults.');
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  const ScopeChip = ({ tool, scope }) => {
    const cur = draft.tools[tool].requiredScopes.value;
    const on = cur.includes(scope);
    return (
      <button
        type="button"
        onClick={() => setToolScopes(tool, on ? cur.filter(s => s !== scope) : [...cur, scope])}
        style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, fontFamily: 'monospace', cursor: 'pointer', border: `1px solid ${on ? '#1e40af' : '#cbd5e1'}`, background: on ? '#dbeafe' : '#fff', color: on ? '#1e40af' : '#94a3b8' }}
      >
        {scope}
      </button>
    );
  };

  return (
    <div style={{ ...S.card, borderColor: '#bfdbfe' }}>
      <div style={{ ...S.cardHead, background: '#eff6ff' }}>
        <span style={S.cardTitle}>Edit Rules (admin)</span>
        {dirty && <span style={{ fontSize: 11, color: '#854d0e', fontWeight: 600 }}>Unsaved changes</span>}
      </div>
      <div style={S.cardBody}>
        <p style={S.desc}>Changes are enforced immediately by the authorization server. Scope-to-tool overrides here apply at this PDP only and do not modify <code>scope-topology.json</code>.</p>
        {notice && <div style={{ padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, color: '#1e40af', fontSize: 12, marginBottom: 10 }}>{notice}</div>}
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={S.sectionLabel}>Global policy knobs</div>
        <div style={S.row}>
          <div style={S.fld}>
            <label style={S.lbl}>HITL threshold (USD){editable.global.hitlThresholdUsd.overridden && <span style={modTag}>mod</span>}</label>
            <input style={S.inp} type="number" value={g.hitlThresholdUsd.value} onChange={e => setG('hitlThresholdUsd', e.target.value)} />
          </div>
          <div style={S.fld}>
            <label style={S.lbl}>Authorized actor client ID{editable.global.authorizedActorClientId.overridden && <span style={modTag}>mod</span>}</label>
            <input style={S.inp} value={g.authorizedActorClientId.value} onChange={e => setG('authorizedActorClientId', e.target.value)} placeholder="(none)" />
          </div>
          <div style={S.fld}>
            <label style={S.lbl}>Tool discovery{editable.global.toolDiscoveryDecision.overridden && <span style={modTag}>mod</span>}</label>
            <select style={S.sel} value={g.toolDiscoveryDecision.value} onChange={e => setG('toolDiscoveryDecision', e.target.value)}>
              <option value="PERMIT">PERMIT</option>
              <option value="DENY">DENY</option>
            </select>
          </div>
        </div>

        <div style={S.divider} />
        <div style={S.sectionLabel}>Per-tool scopes &amp; write classification</div>
        <div style={{ maxHeight: 340, overflowY: 'auto', paddingRight: 6 }}>
          {Object.keys(draft.tools).map(tool => (
            <div key={tool} style={{ ...S.toolRow, gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, minWidth: 190 }}>
                {tool}
                {(editable.tools[tool].requiredScopes.overridden || editable.tools[tool].isWrite.overridden) && <span style={modTag}>mod</span>}
              </span>
              <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
                {allowed.map(s => <ScopeChip key={s} tool={tool} scope={s} />)}
              </span>
              <label style={{ ...S.lbl, display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={!!draft.tools[tool].isWrite.value} onChange={e => setToolWrite(tool, e.target.checked)} /> write
              </label>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button style={{ ...S.btn, opacity: (!dirty || saving) ? 0.6 : 1 }} onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save rules'}</button>
          <button style={{ ...S.btn, background: '#fff', color: '#475569', border: '1px solid #cbd5e1' }} onClick={reset} disabled={saving}>Reset to defaults</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function MockAuthzRulesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mcpTools, setMcpTools] = useState([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await bffAxios.get('/api/authorize/mock-authz-rules');
      setData(res.data);
    } catch (e) { setError(e.response?.data?.message || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/mcp/inspector/tools', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { tools: [] })
      .then(d => setMcpTools((d.tools || []).map(t => t.name)))
      .catch(() => {});
  }, []);

  if (loading) return <div style={{ padding: '40px', color: '#64748b', fontSize: '14px' }}>Loading rules…</div>;

  return (
    <div style={S.root}>
      <h2 style={S.title}>Mock Authorization Server — Live Rules</h2>
      <p style={S.subtitle}>
        Rules enforced by the built-in authorization server at <code style={{ fontSize: '12px' }}>localhost:9001</code>.
        Each card shows the real policy condition and lets you test it live — expand "Show request / response" to see the exact JSON exchanged.
      </p>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '13px', marginBottom: '20px' }}>
          <MdCancel style={{ color: '#991b1b', verticalAlign: 'middle', marginRight: '4px' }} />{error}
          <button onClick={load} style={{ marginLeft: '12px', padding: '3px 10px', background: '#991b1b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
        </div>
      )}

      {data && (
        <>
          <div style={S.metaBar}>
            <div style={S.metaItem}>Source <span style={S.metaVal}>{data.source}</span></div>
            <div style={S.metaItem}>Version <span style={S.metaVal}>{data.version}</span></div>
            <div style={S.metaItem}>Policy <span style={S.metaVal}>{data.policyId}</span></div>
            <div style={S.metaItem}>Decision endpoint <span style={S.metaVal}>{data.decisionPath}</span></div>
          </div>
          {data.editable && <RulesEditor editable={data.editable} onSaved={load} />}
          {(data.rules || []).map(rule => {
            if (rule.id === 'tool-discovery')   return <ToolDiscoveryCard   key={rule.id} rule={rule} />;
            if (rule.id === 'actor-identity')   return <ActorIdentityCard   key={rule.id} rule={rule} />;
            if (rule.id === 'scope-enforcement') return <ScopeEnforcementCard key={rule.id} rule={rule} mcpTools={mcpTools} />;
            if (rule.id === 'hitl-gate')        return <HitlGateCard        key={rule.id} rule={rule} />;
            return null;
          })}
        </>
      )}
    </div>
  );
}
