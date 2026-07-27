import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import bffAxios from '../services/bffAxios';
import { consumeReplay } from '../services/inspectorReplay';
import JsonHighlight from './shared/JsonHighlight';
import JsonFormView from './shared/JsonFormView';
import AuthzTestPage from './AuthzTestPage';
import MockAuthzRulesPage from './MockAuthzRulesPage';
import ScopeAuditPage from './ScopeAuditPage';
import ScopeReferencePage from './ScopeReferencePage';
import SnapshotImport from '../pages/SnapshotImport';
import InspectorShell from './shared/InspectorShell';
import PacEditorLaunch from './PacEditorLaunch';
import InspectorTabs from './shared/InspectorTabs';
import { explainAuthorizeResult, displayDecision as explainDisplayDecision } from '../utils/authorizeResultExplain';
import './McpInspector.css';
import './PingOneMcpInspector.css';
import './PingOneAuthorizePage.css';

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
  root: { padding: '28px 32px', width: '100%', maxWidth: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
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
  reopenTrace: {
    marginTop: '12px', padding: '9px 14px', background: '#1e3a5f', border: 'none',
    borderRadius: '7px', fontSize: '12px', fontWeight: 700, color: '#fff', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '8px',
  },

  policyUsed: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,.06)' },
  policyUsedLabel: { fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' },
  policyUsedName: { fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' },
  policyUsedDesc: { fontSize: '12px', color: '#475569', lineHeight: 1.5, marginBottom: '8px' },
  ruleUsedName: { fontSize: '12px', fontWeight: 600, color: '#1e40af', marginBottom: '4px' },

  explainBox: { marginTop: '10px', padding: '12px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#334155', lineHeight: 1.55 },
  explainHeadline: { fontWeight: 700, color: '#0f172a', marginBottom: '8px' },
  explainRule: { fontSize: '12px', color: '#475569', marginBottom: '8px' },
  explainList: { margin: '0 0 8px 18px', padding: 0 },
  explainApi: { fontSize: '11px', fontFamily: 'monospace', color: '#64748b', wordBreak: 'break-all', marginTop: '6px' },

  tabHelp: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '11px 14px', marginBottom: '14px', fontSize: '12.5px', color: '#475569', lineHeight: 1.55 },
  tabHelpTitle: { fontWeight: 700, color: '#0f172a', marginRight: '6px' },

  // Authorization policy tree
  polTree: { display: 'flex', flexDirection: 'column', gap: '10px' },
  polNode: (kind) => ({
    border: '1px solid #e2e8f0',
    borderLeft: `3px solid ${{ POLICY_SET: '#6366f1', POLICY: '#0ea5e9', RULE: '#cbd5e1' }[kind] || '#cbd5e1'}`,
    borderRadius: '8px', padding: '10px 12px', background: '#fff',
  }),
  polHeadRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  polHeadBtn: {
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1,
    background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', textAlign: 'left',
  },
  polChevron: { fontSize: '10px', color: '#94a3b8', width: '10px', flexShrink: 0 },
  polKind: (kind) => ({
    fontSize: '9.5px', fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
    padding: '2px 7px', borderRadius: '5px',
    background: { POLICY_SET: '#eef2ff', POLICY: '#e0f2fe', RULE: '#f1f5f9' }[kind] || '#f1f5f9',
    color: { POLICY_SET: '#3730a3', POLICY: '#0369a1', RULE: '#475569' }[kind] || '#475569',
  }),
  polName: { fontSize: '13px', fontWeight: 700, color: '#0f172a' },
  polMeta: { fontSize: '10.5px', fontFamily: 'monospace', color: '#94a3b8' },
  polInfoIcon: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '15px', height: '15px', borderRadius: '50%', border: '1px solid #94a3b8',
    fontSize: '10px', fontWeight: 700, fontStyle: 'italic', color: '#64748b',
    cursor: 'help', flexShrink: 0,
  },
  polChildren: { marginTop: '10px', marginLeft: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  polEffect: (effect) => ({
    fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px',
    background: /DENY/.test(effect || '') ? '#fee2e2' : '#dcfce7',
    color: /DENY/.test(effect || '') ? '#991b1b' : '#166534',
  }),
  polDisabled: { fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: '#f3f4f6', color: '#6b7280' },
  polTestActions: { display: 'flex', gap: '10px', marginTop: '6px' },
  polTestBtn: { background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 600, color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline' },
  polSearchWrap: { padding: '8px 12px 0' },
  polSearch: {
    padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px',
    fontFamily: 'inherit', background: '#fff', width: '100%', boxSizing: 'border-box',
  },
  polSearchMeta: { fontSize: '11px', color: '#94a3b8', marginTop: '6px' },
  polNodeMatch: {
    border: '1px solid #c7d2fe',
    borderLeft: '3px solid #4f46e5',
    borderRadius: '8px', padding: '10px 12px', background: '#eef2ff',
  },
  pendingLabel: { fontSize: '11px', fontWeight: 700, color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '6px', padding: '4px 10px', marginBottom: '10px', display: 'inline-block' },
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

/** Recursively counts RULE nodes in a policy tree (used by the left-column header count). */
function ruleCount(nodes) {
  return nodes.reduce((n, p) => n + (p.kind === 'RULE' ? 1 : 0) + ruleCount(p.children || []), 0);
}

/** True when a policy node's name or description contains the query (case-insensitive). */
export function policyNodeMatches(node, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !node) return false;
  const name = String(node.name || '').toLowerCase();
  const desc = String(node.description || '').toLowerCase();
  return name.includes(q) || desc.includes(q);
}

/**
 * Prune the policy tree to nodes that match `query` (name/description) or have a
 * matching descendant. Empty query returns the original tree. A matching node
 * keeps its full subtree so nested rules stay usable (Trigger / Avoid). Ancestors
 * of a deeper match are kept so the path to a hit stays visible.
 */
export function filterPolicyTree(nodes, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return nodes || [];
  const walk = (node) => {
    if (policyNodeMatches(node, q)) return node;
    const kids = (node.children || []).map(walk).filter(Boolean);
    if (kids.length === 0) return null;
    return { ...node, children: kids };
  };
  return (nodes || []).map(walk).filter(Boolean);
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
export function EvaluatePanel({ endpointId, autoPreset, policiesState, pendingTest, onClearPendingTest, onEvaluated, onTestRule }) {
  const navigate = useNavigate();
  const { policies, loading: policiesLoading, error: policiesError, note: policiesNote } = policiesState;
  const [outputTab, setOutputTab] = useState('decision');
  const [preset, setPreset] = useState(autoPreset);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [lastTrace, setLastTrace] = useState(null);
  const [lastParameters, setLastParameters] = useState(null);
  const [policyQuery, setPolicyQuery] = useState('');

  const filteredPolicies = useMemo(
    () => filterPolicyTree(policies, policyQuery),
    [policies, policyQuery],
  );
  const queryActive = Boolean(String(policyQuery || '').trim());

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
  useEffect(() => {
    setPreset(autoPreset);
    setResult(null);
    setErr(null);
    setLastTrace(null);
    setLastParameters(null);
    onClearPendingTest?.();
  }, [endpointId, autoPreset, onClearPendingTest]);

  // Apply a rule-generated test case (from the Authorization Policies tree):
  // switch to its preset and populate that preset's fields. Never auto-runs —
  // the user still clicks "Evaluate (live)".
  useEffect(() => {
    if (!pendingTest) return;
    setPreset(pendingTest.preset);
    setResult(null);
    setErr(null);
    const p = pendingTest.parameters;
    if (pendingTest.preset === 'transaction') {
      if (p.Amount !== undefined) setAmount(String(p.Amount));
      if (p.TransactionType !== undefined) setTxType(p.TransactionType);
      if (p.Acr !== undefined) setAcr(p.Acr);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else if (pendingTest.preset === 'mcp') {
      if (p.ToolName !== undefined) setToolName(p.ToolName);
      if (p.TokenAudience !== undefined) setTokenAudience(p.TokenAudience);
      if (p.ActClientId !== undefined) setActClientId(p.ActClientId);
      if (p.McpResourceUri !== undefined) setMcpResourceUri(p.McpResourceUri);
      if (p.HitlApproved !== undefined) setHitlApproved(!!p.HitlApproved);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else {
      const rows = Object.entries(p).map(([key, value]) => ({ key, value: String(value) }));
      rows.push({ key: '', value: '' });
      setCustomRows(rows);
    }
  }, [pendingTest]);

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

  // Explicit-parameters form so a replay can evaluate the exact payload it was
  // handed without waiting for the prefill setState round-trip.
  const runParameters = async (parameters) => {
    setRunning(true); setResult(null); setErr(null); setLastTrace(null); setLastParameters(null); setOutputTab('decision');
    const started = Date.now();
    try {
      const res = await bffAxios.post('/api/authorize/evaluate-endpoint', {
        endpointId,
        parameters,
      });
      const elapsed = Date.now() - started;
      setLastParameters(parameters);
      setResult({ ...res.data, elapsedMs: elapsed });
      setLastTrace({
        request: authorizeRequestPayload(res.data, endpointId, parameters),
        response: authorizeResponsePayload(res.data),
        timingsMs: elapsed,
        error: false,
      });
      onEvaluated?.({
        preset,
        decision: displayDecision(res.data),
        engine: res.data.engine,
        stepUpRequired: !!res.data.stepUpRequired,
        decisionId: res.data.decisionId,
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

  const run = () => runParameters(buildParameters());

  // A replayed step arrives with autoRun — evaluate immediately so the learner
  // lands on the decision, not on a form they still have to submit. Read-only:
  // an Authorize evaluation has no side effects.
  useEffect(() => {
    if (!pendingTest?.autoRun || !endpointId) return;
    runParameters(pendingTest.parameters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTest, endpointId]);

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
  const explanation = useMemo(
    () => (result && lastParameters
      ? explainAuthorizeResult({ parameters: lastParameters, result, preset, policies })
      : null),
    [result, lastParameters, preset, policies],
  );
  const presetLabel = { transaction: 'Transaction', mcp: 'MCP First Tool', custom: 'Custom' }[preset];

  return (
    <InspectorShell
      title="P1AZ Inspector"
      actions={<PacEditorLaunch />}
      statusOn={!!endpointId}
      statusText={endpointId ? undefined : 'Select a decision endpoint above'}
      fullHeight={false}
      left={
          <>
            <div className="inspector-shell-tree-header">
              <span>Authorization Policies</span>
              <span>{policiesLoading ? 'loading…' : `${ruleCount(queryActive ? filteredPolicies : policies)} rule${ruleCount(queryActive ? filteredPolicies : policies) !== 1 ? 's' : ''}`}</span>
            </div>
            {!policiesLoading && !policiesError && policies.length > 0 && (
              <div style={S.polSearchWrap}>
                <input
                  type="search"
                  style={S.polSearch}
                  value={policyQuery}
                  onChange={(e) => setPolicyQuery(e.target.value)}
                  placeholder="Search policies (name or description)…"
                  aria-label="Search authorization policies"
                />
                {queryActive && (
                  <div style={S.polSearchMeta}>
                    {filteredPolicies.length === 0
                      ? 'No matching policies'
                      : `Showing matches for “${String(policyQuery).trim()}”`}
                  </div>
                )}
              </div>
            )}
            <div className="inspector-shell-tree-body">
              {policiesLoading ? (
                <div style={{ padding: '20px 16px', color: '#64748b', fontSize: '13px' }}>Loading policies…</div>
              ) : policiesError ? (
                <div style={{ padding: '20px 16px', color: '#b45309', fontSize: '13px' }}>⚠️ {policiesError}</div>
              ) : policies.length === 0 ? (
                <div style={{ padding: '20px 16px', color: '#64748b', fontSize: '13px' }}>
                  {policiesNote || 'No authorization policies found in this environment.'}
                </div>
              ) : filteredPolicies.length === 0 ? (
                <div style={{ padding: '20px 16px', color: '#64748b', fontSize: '13px' }}>
                  No policies match “{String(policyQuery).trim()}”.
                </div>
              ) : (
                <div style={{ padding: '8px 12px' }}>
                  {policiesNote && (
                    <div style={{ marginBottom: '10px', fontSize: '12px', color: '#64748b' }}>{policiesNote}</div>
                  )}
                  <div style={S.polTree}>
                    {filteredPolicies.map((p) => (
                      <PolicyNode key={p.id} node={p} onTestRule={onTestRule} query={policyQuery} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        }
        middle={
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">Evaluate</div>
              <div className="inspector-shell-form-header__desc">Send a real decision request to the selected endpoint.</div>
            </div>
            <div className="inspector-shell-form-body">
              {pendingTest && (
                <div style={S.pendingLabel}>Testing: {pendingTest.ruleName} — {pendingTest.case}</div>
              )}
              <div style={S.tabs}>
                <span style={S.tab(preset === 'transaction')} onClick={() => { setPreset('transaction'); onClearPendingTest?.(); }}>Transaction</span>
                <span style={S.tab(preset === 'mcp')} onClick={() => { setPreset('mcp'); onClearPendingTest?.(); }}>MCP First Tool</span>
                <span style={S.tab(preset === 'custom')} onClick={() => { setPreset('custom'); onClearPendingTest?.(); }}>Custom parameters</span>
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
            </div>
            <div className="inspector-shell-form-actions">
              <button style={S.evalBtn} onClick={run} disabled={running || !endpointId}>{running ? 'Evaluating…' : 'Evaluate (live)'}</button>
              {err && <span style={{ color: '#dc2626', fontSize: '12px', marginLeft: '8px' }}>❌ {err}</span>}
            </div>
          </>
        }
        right={
          <>
            <InspectorTabs
              tabs={[
                { key: 'decision', label: 'Decision' },
                { key: 'response', label: 'Response' },
                { key: 'request', label: 'Request' },
                { key: 'form', label: 'Form' },
              ]}
              activeKey={outputTab}
              onChange={setOutputTab}
            />
            <div className="inspector-shell-output-body">
              {outputTab === 'decision' && (
                result ? (
                  <div style={S.resultBox(decision)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={S.resultDecision(decision)}>{DECISION_ICON[decision] || '?'} {decision}</span>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>engine: {result.engine}</span>
                    </div>
                    <div style={S.resultSub}>
                      {result.decisionId ? `Decision ID ${result.decisionId} · ` : ''}path: {result.path || '—'}
                    </div>
                    {explanation?.policyName && (
                      <div style={S.policyUsed}>
                        <div style={S.policyUsedLabel}>Policy evaluated</div>
                        <div style={S.policyUsedName}>{explanation.policyName}</div>
                        {explanation.policyDescription && (
                          <div style={S.policyUsedDesc}>{explanation.policyDescription}</div>
                        )}
                        {explanation.ruleName && (
                          <>
                            <div style={S.policyUsedLabel}>Rule that applied</div>
                            <div style={S.ruleUsedName}>{explanation.ruleName}</div>
                            {explanation.ruleDescription && (
                              <div style={S.policyUsedDesc}>{explanation.ruleDescription}</div>
                            )}
                          </>
                        )}
                        {explanation.combiningAlgorithm && (
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            Combining algorithm: {explanation.combiningAlgorithm.replace(/([A-Z])/g, ' $1').trim()}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={S.oblig}>
                      <div>Step-up: <b>{result.stepUpRequired ? 'yes' : 'no'}</b></div>
                      <div>Consent / HITL: <b>{(result.consentRequired || result.hitlRequired) ? 'yes' : 'no'}</b></div>
                    </div>
                    {explanation && (
                      <div style={S.explainBox}>
                        <div style={S.explainHeadline}>{explanation.headline}</div>
                        {explanation.ruleLikely && !explanation.ruleName && (
                          <div style={S.explainRule}>
                            Likely rule: <strong>{explanation.ruleLikely}</strong>
                          </div>
                        )}
                        {explanation.reasons.length > 0 && (
                          <ul style={S.explainList}>
                            {explanation.reasons.map((line) => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                        {explanation.thresholds?.length > 0 && preset === 'transaction' && (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            Policy thresholds: {explanation.thresholds.join(' · ')}
                          </div>
                        )}
                        {explanation.apiSummary && (
                          <div style={S.explainApi}>
                            API: {explanation.apiSummary}
                            {result.decisionId ? ` · decisionId ${result.decisionId}` : ''}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      style={S.reopenTrace}
                      onClick={() => navigate('/policy-decision-trace', { state: { policies, result } })}
                    >
                      Open policy decision trace
                    </button>
                  </div>
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the decision.</div>
                )
              )}
              {outputTab === 'response' && (
                lastTrace ? (
                  lastTrace.response ? (
                    <pre className="mcp-inspector__code jh-dark">
                      <JsonHighlight value={lastTrace.response} deep />
                    </pre>
                  ) : (
                    <p className="mcp-inspector__muted">No response body returned.</p>
                  )
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the response.</div>
                )
              )}
              {outputTab === 'request' && (
                lastTrace ? (
                  <pre className="mcp-inspector__code jh-dark">
                    <JsonHighlight value={lastTrace.request} deep />
                  </pre>
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the request.</div>
                )
              )}
              {outputTab === 'form' && (
                lastTrace?.response ? (
                  <JsonFormView value={lastTrace.response} />
                ) : (
                  <div className="inspector-shell-output-empty">Run an evaluation to see the response as a form.</div>
                )
              )}
            </div>
          </>
        }
      />
  );
}

// ---------------------------------------------------------------------------
// Authorization policy tree — one recursive node (Policy Set → Policy → Rule)
// ---------------------------------------------------------------------------
function PolicyNode({ node, onTestRule, query }) {
  const [expanded, setExpanded] = useState(false);
  if (!node) return null;
  const kindLabel = { POLICY_SET: 'Policy Set', POLICY: 'Policy', RULE: 'Rule' }[node.kind] || node.kind;
  const matched = policyNodeMatches(node, query);
  const hasChildren = node.children?.length > 0;
  // A query already pruned the tree to matches + their ancestors, so force
  // subtrees open while searching regardless of the toggle state.
  const showChildren = hasChildren && (!!query || expanded);
  return (
    <div style={matched ? S.polNodeMatch : S.polNode(node.kind)} data-policy-match={matched ? 'true' : undefined}>
      <div style={S.polHeadRow}>
        <button
          type="button"
          style={{ ...S.polHeadBtn, cursor: hasChildren ? 'pointer' : 'default' }}
          onClick={hasChildren ? () => setExpanded((e) => !e) : undefined}
        >
          {hasChildren && <span style={S.polChevron}>{showChildren ? '▾' : '▸'}</span>}
          <span style={S.polKind(node.kind)}>{kindLabel}</span>
          <span style={S.polName}>{node.name}</span>
          {node.algorithm && <span style={S.polMeta}>{node.algorithm}</span>}
          {node.effect && <span style={S.polEffect(node.effect)}>{node.effect.replace(/_/g, ' ')}</span>}
          {!node.enabled && <span style={S.polDisabled}>disabled</span>}
        </button>
        {node.description && <span style={S.polInfoIcon} title={node.description}>i</span>}
      </div>
      {node.kind === 'RULE' && node.testCases && (
        <div style={S.polTestActions}>
          <button style={S.polTestBtn} onClick={() => onTestRule({ ruleName: node.name, case: 'trigger', ...node.testCases.trigger })}>Trigger →</button>
          <button style={S.polTestBtn} onClick={() => onTestRule({ ruleName: node.name, case: 'avoid', ...node.testCases.avoid })}>Avoid →</button>
        </div>
      )}
      {showChildren && (
        <div style={S.polChildren}>
          {node.children.map((c) => <PolicyNode key={c.id} node={c} onTestRule={onTestRule} query={query} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PingOneAuthorizePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ['console', 'guided', 'snapshot', 'mockRules', 'scopes'];
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'console';
  const setTab = useCallback((next) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'console') p.delete('tab'); else p.set('tab', next);
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const [scopesSubTab, setScopesSubTab] = useState('audit');

  // Client-side ring buffer of this session's ad-hoc Evaluate calls (Console tab).
  const [runHistory, setRunHistory] = useState([]);
  // Set while a Token Chain replay is staged; see clearPendingTest below.
  const replayPendingRef = useRef(false);
  const pushRunHistory = useCallback((entry) => {
    // The replay has been evaluated — release the clear guard so ordinary
    // endpoint switches reset the panel again.
    replayPendingRef.current = false;
    setRunHistory((h) => [entry, ...h].slice(0, 8));
  }, []);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [recent, setRecent] = useState({ decisions: [], error: null, loading: false });
  const [enabling, setEnabling] = useState(false);
  const [pendingTest, setPendingTest] = useState(null);
  // Live policy tree — fetched once and passed into EvaluatePanel, which renders
  // it in the left-column tree and reuses it for the decision-trace diagram.
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

  const handleTestRule = useCallback((testCase) => {
    setPendingTest(testCase);
    document.getElementById('evaluate-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // A replay hand-off has to survive EvaluatePanel's endpoint-change reset:
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
  // EvaluatePanel also clears pendingTest on every endpointId change, so an
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

  const notConfigured = !data?.workerConfigured;

  return (
    <div style={S.root}>
      <div style={S.tabs}>
        <span style={S.tab(tab === 'console')} onClick={() => setTab('console')}>Live / Simulated Console</span>
        <span style={S.tab(tab === 'guided')} onClick={() => setTab('guided')}>Guided Scenarios &amp; Learn</span>
        <span style={S.tab(tab === 'mockRules')} onClick={() => setTab('mockRules')}>Mock Authz Rules</span>
        <span style={S.tab(tab === 'scopes')} onClick={() => setTab('scopes')}>Scopes &amp; Resources</span>
        <span style={S.tab(tab === 'snapshot')} onClick={() => setTab('snapshot')}>Snapshot Import</span>
      </div>

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

      {tab === 'console' && (loading ? (
        <div style={{ padding: '40px', color: '#64748b', fontSize: '14px' }}>Loading PingOne Authorize configuration…</div>
      ) : (
        <>
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

      {/* Evaluate — policy tree, form, and result all live inside one InspectorShell */}
      {selectedId
        ? <div className="p1az-evaluate-shell"><EvaluatePanel endpointId={selectedId} autoPreset={autoPreset} policiesState={policiesState} pendingTest={pendingTest} onClearPendingTest={clearPendingTest} onEvaluated={pushRunHistory} onTestRule={handleTestRule} /></div>
        : <div style={S.card}><div style={S.cardBody}><div style={S.empty}>Select a decision endpoint to evaluate.</div></div></div>}

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

      {/* Run history — this session's ad-hoc Evaluate calls (any endpoint/preset) */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Run History</span>
          <span style={S.cardHint}>this session · {runHistory.length} loaded</span>
        </div>
        <div style={S.cardBody}>
          {runHistory.length === 0 ? (
            <div style={S.empty}>No evaluations run yet this session.</div>
          ) : (
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>#</th><th style={S.th}>Preset</th><th style={S.th}>Decision</th>
                <th style={S.th}>Engine</th><th style={S.th}>Step-up</th><th style={S.th}>Decision ID</th>
              </tr></thead>
              <tbody>
                {runHistory.map((h, i) => (
                  <tr key={i}>
                    <td style={S.td}>{i + 1}</td>
                    <td style={S.td}>{{ transaction: 'Transaction', mcp: 'MCP First Tool', custom: 'Custom' }[h.preset] || h.preset}</td>
                    <td style={S.td}><span style={S.dBadge(h.decision)}>{h.decision || '?'}</span></td>
                    <td style={S.td}>{h.engine}</td>
                    <td style={S.td}>{String(h.stepUpRequired)}</td>
                    <td style={S.tdMono}>{h.decisionId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
        </>
      ))}
    </div>
  );
}
