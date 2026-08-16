// demo_api_ui/src/components/McpInspectorPage.jsx
// Consolidates McpInspector.js (AI Demo MCP), PingOneMcpInspector.js
// (PingOne MCP), and ApiExplorerPanel.js (API Calls) behind one
// InspectorShell instance with a source switcher. Each source's logic is
// a straight adaptation of its original file — see the design spec
// (docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md)
// and this plan's own Architecture section for why these aren't unified
// into shared logic. The three original files are untouched by this page
// — McpInspector.js and ApiExplorerPanel.js are still separately embedded
// in McpGatewayConfig.jsx and DevToolsDashboard.jsx respectively.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { consumeReplay } from '../services/inspectorReplay';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import JsonHighlight from './shared/JsonHighlight';
import JsonFormView from './shared/JsonFormView';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
import InspectorListItem from './shared/InspectorListItem';
import './shared/InspectorShell.css';
import './ApiExplorerPanel.css';

const SOURCES = [
  { key: 'banking', label: 'AI Demo MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
  { key: 'custom', label: 'Custom Server' },
  { key: 'protocol', label: 'Protocol' },
];

// ---------------------------------------------------------------------------
// AI Demo MCP source — adapted from McpInspector.js's default-profile path.
// The profile picker / "+ Add server" / PingOne-admin-login additions from
// that file are intentionally not carried over (see plan scope correction 1).
// ---------------------------------------------------------------------------

const coerceParam = (raw, type) => {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
};

const isWriteScope = (s) => /write|manage|delete/.test(String(s).toLowerCase());
const isWriteTool = (tool) => (tool.requiredScopes || []).some(isWriteScope);
const isReasoningTool = (tool) => {
  const n = (tool.name || '').toLowerCase();
  return n.includes('think') || n.includes('reason');
};
const isSensitiveTool = (tool) =>
  (tool.requiredScopes || []).some((s) => String(s).toLowerCase().includes('sensitive')) ||
  (tool.name || '').toLowerCase().includes('sensitive');

const bankingToolDot = (tool) => {
  if (isSensitiveTool(tool)) return 'sensitive';
  if (isWriteTool(tool)) return 'write';
  return 'default';
};

const bankingToolBadges = (tool) => {
  if (isSensitiveTool(tool)) return ['sensitive'];
  if (isWriteTool(tool)) return ['write'];
  return [];
};

const BANKING_RESOURCE_META = {
  accounts: { label: 'Accounts' },
  transactions: { label: 'Transactions' },
  admin: { label: 'Customer Admin' },
  directory: { label: 'Directory / Users' },
  vertical: { label: 'Vertical Demos' },
  reasoning: { label: 'Reasoning' },
  other: { label: 'Other' },
};
const BANKING_RESOURCE_ORDER = [
  'accounts', 'transactions', 'admin', 'directory', 'vertical', 'reasoning', 'other',
];

const bankingToolResource = (tool) => {
  const name = (tool.name || '').toLowerCase();
  const scopes = (tool.requiredScopes || []).map((s) => String(s).toLowerCase());
  const hasPrefix = (p) => scopes.some((s) => s.startsWith(p));
  if (isReasoningTool(tool)) return 'reasoning';
  if (hasPrefix('admin:') || hasPrefix('users:') || name.includes('customer')) return 'admin';
  if (name.includes('transaction') || /deposit|withdraw|transfer/.test(name) || hasPrefix('transactions')) {
    return 'transactions';
  }
  if (name.includes('account') || name.includes('balance') || hasPrefix('accounts')) return 'accounts';
  if (name.startsWith('show_')) return 'vertical';
  if (name.includes('user') || name.includes('email')) return 'directory';
  return 'other';
};

const groupBankingTools = (toolList) => {
  const buckets = {};
  for (const t of toolList) (buckets[bankingToolResource(t)] ||= []).push(t);
  return BANKING_RESOURCE_ORDER.filter((k) => buckets[k]?.length).map((k) => ({
    key: k,
    label: BANKING_RESOURCE_META[k].label,
    tools: buckets[k],
  }));
};

const isDavinciTool = (name) => name.includes('Davinci') || name.includes('davinci');

const pingoneGroupKey = (name) => {
  if (isDavinciTool(name)) return 'DaVinci';
  if (name.includes('Environment')) return 'Environments';
  if (name.includes('Application')) return 'Applications';
  if (name.includes('User')) return 'Users';
  if (name.includes('Population')) return 'Populations';
  return 'Other';
};

// Within large PingOne groups, divide tools into Read vs Write subgroups
const pingoneSubgroupKey = (name) => {
  const lower = name.toLowerCase();
  if (/^(get|list|read|check|find|search|fetch)/.test(lower)) return 'Read';
  return 'Write';
};

const PINGONE_SUBGROUP_ORDER = ['Read', 'Write'];

const PINGONE_GROUP_ORDER = ['Environments', 'Users', 'Applications', 'Populations', 'DaVinci', 'Other'];

const pingoneToolDot = (name) => {
  const lower = name.toLowerCase();
  if (lower.startsWith('create') || lower.startsWith('update') || lower.startsWith('delete') || lower.startsWith('manage')) return 'write';
  return 'default';
};

const POLL_MS = 30000;

const apiMethodBadgeClass = (m) => `aep-method-badge aep-method-badge--${(m || 'GET').toUpperCase()}`;

const truncateUrl = (url, maxLen = 28) => {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '…';
};

const BANKING_STATIC_TOOLS = [
  {
    name: 'get_my_accounts',
    description: 'List all bank accounts with balances and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['accounts:read'],
  },
  {
    name: 'get_account_balance',
    description: 'Get current balance for a specific account by ID.',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
    requiredScopes: ['accounts:read'],
  },
  {
    name: 'get_my_transactions',
    description: 'Retrieve transaction history for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['transactions:read'],
  },
  {
    name: 'get_sensitive_account_details',
    description: 'Retrieve full account number and routing number (requires sensitive:read + consent).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['sensitive:read'],
  },
  {
    name: 'create_deposit',
    description: 'Deposit funds into an account. Amounts over $500 require HITL consent.',
    inputSchema: {
      type: 'object',
      properties: {
        to_account_id: { type: 'string' },
        amount: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['to_account_id', 'amount'],
    },
    requiredScopes: ['transactions:write'],
  },
  {
    name: 'create_withdrawal',
    description: 'Withdraw funds from an account. Amounts over $500 require HITL consent.',
    inputSchema: {
      type: 'object',
      properties: {
        from_account_id: { type: 'string' },
        amount: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['from_account_id', 'amount'],
    },
    requiredScopes: ['transactions:write'],
  },
  {
    name: 'create_transfer',
    description: 'Transfer money between accounts. Amounts over $500 require HITL consent.',
    inputSchema: {
      type: 'object',
      properties: {
        from_account_id: { type: 'string' },
        to_account_id: { type: 'string' },
        amount: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['from_account_id', 'to_account_id', 'amount'],
    },
    requiredScopes: ['transactions:write'],
  },
  {
    name: 'query_user_by_email',
    description: 'Check if a user exists by email address (public, no auth required).',
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    requiredScopes: [],
  },
  {
    name: 'sequential_think',
    description: 'Reason step-by-step through a complex banking question or decision.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, context: { type: 'string' } },
      required: ['query'],
    },
    requiredScopes: [],
  },
];

function useBankingSource() {
  const [tools, setTools] = useState([]);
  const [toolsSourceInfo, setToolsSourceInfo] = useState(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [formError, setFormError] = useState(null);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outputTab, setOutputTab] = useState('response');
  const [mcpHistory, setMcpHistory] = useState(getCalls);
  // Optional MCP spec: notifications/progress opt-in. No tool in this demo
  // emits one today (see the Protocol tab's Sampling/Roots note for the same
  // "built ahead of a producer" pattern) — attaching the token still lets the
  // Inspector show a real interim frame if one ever arrives (see
  // mcpWebSocketClient.js's frameSink.notifications capture), an honest empty
  // result otherwise.
  const [progressEnabled, setProgressEnabled] = useState(false);
  // Computed once, synchronously, before any effect runs: a Token Chain replay
  // handoff (?replay=<id>) races the tool-catalog GET below — if the catalog
  // resolves after the replay has selected/invoked a tool, its reset would
  // wipe the replayed selection and result right back to "Select a tool".
  const hasPendingReplayRef = useRef(
    typeof window !== 'undefined' && /[?&]replay=/.test(window.location.search),
  );

  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  const refreshTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/tools');
      setTools(data.tools || []);
      setToolsSourceInfo(
        data._source === 'local_catalog'
          ? { local: true, reason: data._localCatalogReason || '' }
          : data._source === 'mcp_server'
            ? { local: false }
            : null,
      );
      if (!hasPendingReplayRef.current) {
        setSelectedTool(null);
        setLastInvoke(null);
        setLastTiming(null);
        setFormError(null);
        setNeedsLogin(false);
      }
    } catch (e) {
      notifyError(formatAxiosError(e, 'BFF unreachable - showing static tool catalog'));
      setTools(BANKING_STATIC_TOOLS);
      setToolsSourceInfo({ local: true, reason: 'bff_unreachable' });
    } finally {
      setLoadingTools(false);
    }
  }, []);

  useEffect(() => { refreshTools(); }, [refreshTools]);

  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter((t) => (t.name || '').toLowerCase().includes(searchQ) || (t.description || '').toLowerCase().includes(searchQ))
      : tools;
    return groupBankingTools(filtered);
  }, [tools, toolSearch]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
    setNeedsLogin(false);
    setOutputTab('response');
  };

  const handleInvoke = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter((key) => !String(paramValues[key] ?? '').trim());
    if (missing.length > 0) {
      setFormError(`Required: ${missing.join(', ')}`);
      return;
    }
    setFormError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setBusy(true);
    const t0 = Date.now();
    try {
      const meta = progressEnabled
        ? { progressToken: `progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
        : undefined;
      const { data } = await apiClient.post('/api/mcp/inspector/invoke', {
        tool: selectedTool.name,
        params,
        ...(meta ? { meta } : {}),
      });
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setNeedsLogin(false);
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      const errBody = e.response?.data || { error: 'invoke_failed', message: formatAxiosError(e, 'Invoke failed') };
      appendMcpCall(selectedTool.name, e.response?.status ?? 0, ms, null, formatAxiosError(e, 'Invoke failed'));
      // Always put something in the response pane — toast-only made Execute look like a no-op.
      setLastInvoke(errBody.frames ? errBody : errBody);
      setLastTiming({ ms, error: true, reason: formatAxiosError(e, 'Invoke failed') });
      if (e.response?.status === 401) {
        setNeedsLogin(true);
      } else {
        setNeedsLogin(false);
        notifyError(formatAxiosError(e, 'Invoke failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues, progressEnabled]);

  const clearForm = () => {
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
  };

  // Replay from the Token Chain TraceRail (?replay=<id>): select the tool this
  // run actually attempted, load its real arguments, and invoke it. Two
  // effects, not one — handleInvoke closes over selectedTool/paramValues, so
  // the call has to wait for the commit that applied them (same pattern as
  // AgentGatewayTester's gateway-tool replay).
  const [pendingReplay, setPendingReplay] = useState(null);
  const [replayArmed, setReplayArmed] = useState(false);
  const replayConsumed = useRef(false);
  // Mount-only, and reads location directly rather than via useSearchParams:
  // consumeReplay is one-shot, so re-running on a param change would find
  // nothing and could only clobber an in-flight replay.
  useEffect(() => {
    if (replayConsumed.current) return;
    replayConsumed.current = true;
    const r = consumeReplay(window.location.search);
    if (r && r.target === 'mcp' && r.tool) setPendingReplay(r);
  }, []);
  useEffect(() => {
    if (!pendingReplay) return;
    // Prefer the catalog entry (carries the schema for the form header); fall
    // back to a bare name so a tool missing from the list still replays.
    const tool = tools.find((t) => t.name === pendingReplay.tool) || { name: pendingReplay.tool };
    const values = {};
    for (const [key, value] of Object.entries(pendingReplay.arguments || {})) {
      values[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    setSelectedTool(tool);
    setParamValues(values);
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
    setNeedsLogin(false);
    setOutputTab('response');
    setPendingReplay(null);
    setReplayArmed(true);
  }, [pendingReplay, tools]);
  useEffect(() => {
    if (!replayArmed || !selectedTool) return;
    setReplayArmed(false);
    handleInvoke();
  }, [replayArmed, selectedTool, handleInvoke]);

  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response' || outputTab === 'form') {
      if (lastInvoke) return lastInvoke;
      if (lastTiming?.error) return { error: true, message: lastTiming.reason || 'Invoke failed' };
      return null;
    }
    if (outputTab === 'request') {
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);

  const isConnected = !toolsSourceInfo?.local;
  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return {
    statusOn: isConnected,
    statusText: isConnected ? `Connected - ${tools.length} tools` : `Local catalog - ${tools.length} tools`,
    banner: toolsSourceInfo?.local ? (
      <div style={{ background: '#fff7ed', color: '#9a3412', padding: '8px 20px', fontSize: 12 }}>
        <strong>Local catalog.</strong>{' '}
        {toolsSourceInfo.reason === 'no_mcp_bearer_cookie_only_or_missing_token'
          ? 'Sign out and sign in again so the BFF has a real OAuth access token — cookie-only sessions cannot reach the live MCP server.'
          : toolsSourceInfo.reason === 'token_resolve_failed_delegation_chain_broken'
          ? 'Token exchange failed (delegation chain). The MCP server resource URI or actor client may not be configured — execute still runs against the local handler when you are signed in.'
          : `Discovery fell back in-process (${toolsSourceInfo.reason || 'unknown'}). Execute still runs against the local handler when you are signed in.`}
      </div>
    ) : null,
    actions: (
      <button className="inspector-shell-topbar__btn" onClick={refreshTools} disabled={loadingTools}>
        {loadingTools ? 'Loading...' : 'Refresh'}
      </button>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header"><span>Tools ({tools.length})</span></div>
        <div className="inspector-shell-tree-search">
          <input
            type="search"
            placeholder="Filter tools..."
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="inspector-shell-tree-body">
          {groupedTools.map((group) => (
            <div key={group.key}>
              <div className="inspector-shell-tree-group__label">{group.label} ({group.tools.length})</div>
              {group.tools.map((t) => (
                <InspectorListItem
                  key={t.name}
                  label={t.name}
                  active={selectedTool?.name === t.name}
                  dot={bankingToolDot(t)}
                  badges={bankingToolBadges(t)}
                  onClick={() => selectTool(t)}
                />
              ))}
            </div>
          ))}
          {groupedTools.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
              {tools.length === 0 ? 'No tools loaded.' : `No tools match "${toolSearch}".`}
            </div>
          )}
        </div>
        {mcpHistory.length > 0 && (
          <div className="inspector-shell-tree-footer" style={{ borderTop: '1px solid #cbd5e1', padding: '8px 12px', fontSize: 11, color: '#64748b', maxHeight: 140, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>History ({mcpHistory.length})</div>
            {mcpHistory.slice(-10).reverse().map((entry) => {
              const ok = entry.status >= 200 && entry.status < 300;
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
                  <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: 11 }}>{entry.tool}</span>
                  {entry.duration != null && <span style={{ marginLeft: 'auto', color: '#64748b' }}>{entry.duration}ms</span>}
                </div>
              );
            })}
          </div>
        )}
      </>
    ),
    middle: (
      <>
        {needsLogin && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong>Sign in required.</strong> This tools/call needs a valid BFF session.
            <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={navigateToCustomerOAuthLogin}>
              Log in
            </button>
          </div>
        )}
        {selectedTool ? (
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
              {selectedTool.description && <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>}
            </div>
            <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
              <button className="inspector-shell-btn-call" onClick={handleInvoke} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', marginLeft: 12 }}>
                <input
                  type="checkbox"
                  checked={progressEnabled}
                  onChange={(e) => setProgressEnabled(e.target.checked)}
                />
                Attach progress token
              </label>
            </div>
            {progressEnabled && (
              <div style={{ padding: '4px 20px 8px', fontSize: 11, color: '#64748b' }}>
                No tool in this demo currently emits <code>notifications/progress</code> yet — built ahead of a
                producer, same as Prompts/Sampling. Cancellation (<code>notifications/cancelled</code>) is covered
                by <code>demo_mcp_gateway/tests/gateway-http-progress-cancellation.test.js</code> and the
                WS-transport cancellation tests, not exercised from this Inspector.
              </div>
            )}
            <div className="inspector-shell-form-body">
              {Object.entries(schemaProps).map(([key, schema]) => (
                <div className="inspector-shell-field" key={key}>
                  <label>
                    {key}{requiredParams.has(key) && <span className="req"> *</span>}
                    <span className="type">{schema?.type || ''}</span>
                  </label>
                  <input
                    type="text"
                    placeholder={schema?.description || schema?.type || 'value'}
                    value={paramValues[key] ?? ''}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
              {Object.keys(schemaProps).length === 0 && (
                <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
              )}
            </div>
            <div className="inspector-shell-form-actions">
              <button className="inspector-shell-btn-call" onClick={handleInvoke} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
              {formError && <span className="inspector-shell-form-error">{formError}</span>}
            </div>
          </>
        ) : (
          <div className="inspector-shell-form-empty">Select a tool from the tree to inspect and invoke it.</div>
        )}
      </>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request' },
            { key: 'history', label: `History (${mcpHistory.length})` },
            { key: 'form', label: 'Form' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              {outputTab === 'form' ? (
                <JsonFormView value={outputContent} />
              ) : (
                <pre className="inspector-shell-output-code">
                  <JsonHighlight value={outputContent} deep />
                </pre>
              )}
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}</span>
              <span><strong>Duration:</strong> {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}</span>
              <span><strong>Transport:</strong> WebSocket JSON-RPC</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">
            {selectedTool ? 'Click Execute to call the tool and see the response here.' : 'Select a tool and execute it to see results.'}
          </div>
        )}
      </>
    ),
  };
}

function usePingOneSource() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [calling, setCalling] = useState(false);
  const [lastCall, setLastCall] = useState(null);
  const [formError, setFormError] = useState(null);
  const [outputTab, setOutputTab] = useState('response');
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const [authRequired, setAuthRequired] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setAuthRequired(false);
    try {
      const res = await apiClient.get('/api/mcp/inspector/pingone-tools');
      setData(res.data);
    } catch (e) {
      if (e.response?.status === 401) {
        setAuthRequired(true);
        setData({ enabled: false, tools: [], reason: 'Sign in required to query the PingOne MCP server.', _source: 'unauthenticated' });
      } else {
        notifyError(formatAxiosError(e, 'Failed to query the PingOne MCP server'));
        setData({ enabled: false, tools: [], reason: formatAxiosError(e, 'Failed to query the PingOne MCP server'), error: true, _source: 'client_error' });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabled = data?.enabled;
  const tools = data?.tools || [];

  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter((t) => t.name.toLowerCase().includes(searchQ) || (t.description || '').toLowerCase().includes(searchQ))
      : tools;
    const groups = {};
    for (const t of filtered) {
      const g = pingoneGroupKey(t.name);
      if (!groups[g]) groups[g] = {};
      const sg = pingoneSubgroupKey(t.name);
      if (!groups[g][sg]) groups[g][sg] = [];
      groups[g][sg].push(t);
    }
    return PINGONE_GROUP_ORDER.filter((g) => groups[g] && Object.keys(groups[g]).length).map((g) => ({
      label: g,
      subgroups: PINGONE_SUBGROUP_ORDER
        .filter((sg) => groups[g][sg]?.length)
        .map((sg) => ({ label: sg, tools: groups[g][sg] })),
      total: Object.values(groups[g]).reduce((n, arr) => n + arr.length, 0),
    }));
  }, [tools, toolSearch]);

  const toggleGroup = useCallback((label) => {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }, []);

  const toggleLiveQuery = useCallback(async () => {
    setToggling(true);
    try {
      await apiClient.patch('/api/admin/feature-flags', { updates: { mcp_inspector_pingone_live: !enabled } });
      await refresh();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to toggle live querying'));
    } finally {
      setToggling(false);
    }
  }, [enabled, refresh]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    const defaults = data?.paramDefaults || {};
    const props = tool.inputSchema?.properties || {};
    const seeded = {};
    for (const key of Object.keys(props)) { if (defaults[key]) seeded[key] = defaults[key]; }
    setParamValues(seeded);
    setFormError(null);
    setLastCall(null);
    setOutputTab('response');
  };

  const callTool = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter((k) => !(paramValues[k] ?? '').trim());
    if (missing.length > 0) {
      setFormError(`Required: ${missing.join(', ')}`);
      return;
    }
    setFormError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setCalling(true);
    try {
      const res = await apiClient.post('/api/mcp/inspector/pingone-invoke', { tool: selectedTool.name, params });
      setLastCall(res.data);
      setOutputTab('response');
    } catch (e) {
      notifyError(formatAxiosError(e, 'tools/call failed'));
      setLastCall(null);
    } finally {
      setCalling(false);
    }
  }, [selectedTool, paramValues]);

  const clearForm = () => { setParamValues({}); setFormError(null); setLastCall(null); };

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return {
    statusOn: !!enabled,
    statusText: enabled ? `Connected — ${tools.length} tools` : 'Disconnected',
    banner: (!enabled || data?.error || authRequired) ? (
      <div style={{ background: '#fff7ed', color: '#9a3412', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          <strong>{authRequired ? 'Sign in required.' : enabled ? 'PingOne MCP error.' : 'Live query is off.'}</strong>{' '}
          {data?.reason || (authRequired
            ? 'Log in, then use Live: ON (admin) if tools stay empty.'
            : 'Turn Live: ON to load tools from the hosted PingOne MCP server.')}
        </span>
        {authRequired && (
          <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={navigateToCustomerOAuthLogin}>
            Log in
          </button>
        )}
      </div>
    ) : null,
    actions: (
      <>
        <button className="inspector-shell-topbar__btn" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <button
          className={`inspector-shell-topbar__btn${enabled ? ' inspector-shell-topbar__btn--active' : ''}`}
          onClick={toggleLiveQuery}
          disabled={toggling}
        >
          {toggling ? 'Switching…' : enabled ? 'Live: ON' : 'Live: OFF'}
        </button>
      </>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header"><span>Tools ({tools.length})</span></div>
        <div className="inspector-shell-tree-search">
          <input
            type="search"
            placeholder="Filter tools…"
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="inspector-shell-tree-body">
          {groupedTools.map((group) => {
            const isCollapsed = !!collapsedGroups[group.label];
            const hasSubs = group.subgroups.length > 1;
            return (
              <div key={group.label}>
                <div
                  className="inspector-shell-tree-group__label"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleGroup(group.label)}
                >
                  <span style={{ marginRight: 6, opacity: 0.6, fontSize: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
                  {group.label} ({group.total})
                </div>
                {!isCollapsed && group.subgroups.map((sg) => (
                  <div key={sg.label}>
                    {hasSubs && (
                      <div style={{ padding: '2px 16px 2px 24px', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        {sg.label}
                      </div>
                    )}
                    {sg.tools.map((t) => (
                      <InspectorListItem
                        key={t.name}
                        label={t.name}
                        active={selectedTool?.name === t.name}
                        dot={pingoneToolDot(t.name)}
                        badges={pingoneToolDot(t.name) === 'write' ? ['write'] : []}
                        onClick={() => selectTool(t)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
          {groupedTools.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
              {tools.length === 0
                ? (enabled ? 'No tools returned from PingOne MCP.' : 'No tools loaded — turn Live: ON or sign in.')
                : `No tools match "${toolSearch}".`}
            </div>
          )}
        </div>
      </>
    ),
    middle: selectedTool ? (
      <>
        <div className="inspector-shell-form-header">
          <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
          {selectedTool.description && <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>}
        </div>
        <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
          <button className="inspector-shell-btn-call" onClick={callTool} disabled={calling || !enabled}>{calling ? 'Calling…' : 'Execute'}</button>
          <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
        </div>
        <div className="inspector-shell-form-body">
          {Object.entries(schemaProps).map(([key, schema]) => (
            <div className="inspector-shell-field" key={key}>
              <label>
                {key}{requiredParams.has(key) && <span className="req"> *</span>}
                <span className="type">{schema?.type || ''}</span>
              </label>
              <input
                type="text"
                placeholder={schema?.description || schema?.type || 'value'}
                value={paramValues[key] ?? ''}
                onChange={(e) => setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
          {Object.keys(schemaProps).length === 0 && (
            <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
          )}
        </div>
        <div className="inspector-shell-form-actions">
          <button className="inspector-shell-btn-call" onClick={callTool} disabled={calling || !enabled}>{calling ? 'Calling…' : 'Execute'}</button>
          <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
          {formError && <span className="inspector-shell-form-error">{formError}</span>}
        </div>
      </>
    ) : (
      <div className="inspector-shell-form-empty">Select a tool from the tree to inspect and invoke it.</div>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[{ key: 'response', label: 'Response' }, { key: 'request', label: 'Request' }, { key: 'form', label: 'Form' }]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {lastCall ? (
          <>
            <div className="inspector-shell-output-body">
              {outputTab === 'form' ? (
                <JsonFormView value={lastCall.response} />
              ) : (
                <pre className="inspector-shell-output-code">
                  <JsonHighlight value={outputTab === 'response' ? lastCall.response : lastCall.request} deep />
                </pre>
              )}
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {lastCall.error ? 'Error' : '200 OK'}</span>
              <span><strong>Duration:</strong> {lastCall.timingsMs?.roundTrip ?? '?'}ms</span>
              <span><strong>Transport:</strong> HTTP/SSE</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">
            {selectedTool ? 'Click Execute to call the tool and see the response here.' : 'Select a tool and execute it to see results.'}
          </div>
        )}
      </>
    ),
  };
}

function useApiCallsSource() {
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState(null);
  const [outputTab, setOutputTab] = useState('response');
  const [search, setSearch] = useState('');
  const liveRef = useRef(live);
  liveRef.current = live;

  const fetchCalls = useCallback(async () => {
    if (!liveRef.current) return;
    try {
      const res = await fetch('/api/api-calls?limit=100', { credentials: 'include' });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const data = await res.json();
      setCalls(data.calls || []);
      setStats(data.stats || null);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchCalls();
    const id = setInterval(fetchCalls, POLL_MS);
    return () => clearInterval(id);
  }, [fetchCalls]);

  const handleClear = () => {
    fetch('/api/api-calls', { method: 'DELETE', credentials: 'include' })
      .then(() => { setCalls([]); setSelected(null); setStats(null); });
  };

  const reversed = [...calls].reverse();
  const filteredCalls = search.trim()
    ? reversed.filter((c) => (c.url || '').toLowerCase().includes(search.trim().toLowerCase()) || (c.method || '').toLowerCase().includes(search.trim().toLowerCase()))
    : reversed;

  const selectedCall = selected;
  const status = selectedCall?.response?.status;
  const duration = selectedCall?.durationMs ?? selectedCall?.duration;

  return {
    statusOn: live,
    statusText: `${calls.length} calls ${live ? '- Live' : '- Paused'}`,
    actions: (
      <>
        {error && <span className="aep-topbar-error">{error}</span>}
        <button className={`inspector-shell-topbar__btn${live ? ' inspector-shell-topbar__btn--active' : ''}`} onClick={() => setLive((v) => !v)}>{live ? 'Pause' : 'Live'}</button>
        <button className="inspector-shell-topbar__btn" onClick={handleClear}>Clear</button>
      </>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header">
          <span>Calls ({calls.length})</span>
          {stats && <span style={{ fontSize: 9, color: '#64748b' }}>{stats.success ?? stats.successful}ok / {stats.errors ?? stats.failed}err</span>}
        </div>
        <div className="inspector-shell-tree-search">
          <input type="search" placeholder="Filter calls..." value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        </div>
        <div className="inspector-shell-tree-body">
          {filteredCalls.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
              {calls.length === 0 ? 'No API calls yet. Use the AI agent or test pages to generate calls.' : `No calls match "${search}".`}
            </div>
          ) : filteredCalls.map((call) => (
            <button
              type="button"
              key={call.id}
              className={`inspector-shell-tree-item${selected?.id === call.id ? ' inspector-shell-tree-item--active' : ''}`}
              onClick={() => { setSelected((prev) => (prev?.id === call.id ? null : call)); setOutputTab('response'); }}
            >
              <span className={`inspector-shell-tree-item__dot${!call.success ? ' inspector-shell-tree-item__dot--sensitive' : ''}`} />
              <span className={apiMethodBadgeClass(call.method)}>{(call.method || 'GET').toUpperCase()}</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{truncateUrl(call.url)}</span>
              {call.response?.status != null && (
                <span className={`aep-tree-status ${call.response.status >= 200 && call.response.status < 300 ? 'aep-tree-status--ok' : 'aep-tree-status--err'}`}>
                  {call.response.status}
                </span>
              )}
              {(call.durationMs ?? call.duration) != null && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#64748b' }}>{call.durationMs ?? call.duration}ms</span>}
            </button>
          ))}
        </div>
        {stats && (
          <div className="aep-tree-footer">
            <div className="aep-tree-footer__stat">Total: <strong>{stats.total}</strong></div>
            <div className="aep-tree-footer__stat">Success: <strong className="aep-tree-footer__ok">{stats.success ?? stats.successful}</strong></div>
            <div className="aep-tree-footer__stat">Errors: <strong className="aep-tree-footer__err">{stats.errors ?? stats.failed}</strong></div>
            {(stats.avgDurationMs ?? stats.averageDuration) != null && (
              <div className="aep-tree-footer__stat">Avg: <strong>{Math.round(stats.avgDurationMs ?? stats.averageDuration)}ms</strong></div>
            )}
          </div>
        )}
      </>
    ),
    middle: selectedCall ? (
      <>
        <div className="inspector-shell-form-header">
          <div className="inspector-shell-form-header__name">{(selectedCall.method || 'GET').toUpperCase()} Request</div>
          <div className="inspector-shell-form-header__desc">Inspect the selected API call details</div>
        </div>
        <div className="inspector-shell-form-body">
          <div className="inspector-shell-field"><label>URL</label><input type="text" value={selectedCall.url || ''} readOnly /></div>
          <div className="inspector-shell-field"><label>Method</label><input type="text" value={(selectedCall.method || 'GET').toUpperCase()} readOnly /></div>
          <div className="inspector-shell-field"><label>Status Code</label><input type="text" value={status != null ? String(status) : 'N/A'} readOnly /></div>
          <div className="inspector-shell-field"><label>Duration</label><input type="text" value={duration != null ? `${duration}ms` : 'N/A'} readOnly /></div>
          {selectedCall.request?.body && (
            <div className="inspector-shell-field">
              <label>Request Body</label>
              <textarea
                rows={6}
                readOnly
                value={typeof selectedCall.request.body === 'string'
                  ? selectedCall.request.body
                  : JSON.stringify(selectedCall.request.body, null, 2)}
              />
            </div>
          )}
        </div>
      </>
    ) : (
      <div className="inspector-shell-form-empty">Select an API call from the list to inspect its details.</div>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response Body' },
            { key: 'request', label: 'Request Body' },
            { key: 'headers', label: 'Headers' },
            { key: 'form', label: 'Form' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {selectedCall ? (
          <>
            <div className="inspector-shell-output-body">
              {outputTab === 'form' ? (
                selectedCall.response?.body ? <JsonFormView value={selectedCall.response.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>
              ) : (
                <pre className="inspector-shell-output-code">
                  {outputTab === 'response' && (selectedCall.response?.body ? <JsonHighlight value={selectedCall.response.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No response body captured</span>)}
                  {outputTab === 'request' && (selectedCall.request?.body ? <JsonHighlight value={selectedCall.request.body} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No request body</span>)}
                  {outputTab === 'headers' && (selectedCall.request?.headers && Object.keys(selectedCall.request.headers).length > 0 ? <JsonHighlight value={selectedCall.request.headers} /> : <span style={{ color: '#64748b', fontStyle: 'italic' }}>No headers captured</span>)}
                </pre>
              )}
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {status != null ? status : 'N/A'}</span>
              <span><strong>Duration:</strong> {duration != null ? `${duration}ms` : 'N/A'}</span>
              <span><strong>Transport:</strong> HTTP</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">Select an API call to view its response, request body, and headers.</div>
        )}
      </>
    ),
  };
}

function useCustomServerSource() {
  const [tools, setTools] = useState([]);
  const [toolsSourceInfo, setToolsSourceInfo] = useState(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [formError, setFormError] = useState(null);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [stepUpMethod, setStepUpMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [outputTab, setOutputTab] = useState('response');
  const [mcpHistory, setMcpHistory] = useState(getCalls);

  const [profiles, setProfiles] = useState([]);
  const [defaultProfileId, setDefaultProfileId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileError, setProfileError] = useState(null);
  const [pingoneAdminLoginUrl, setPingoneAdminLoginUrl] = useState(null);
  const [pingoneAdminError, setPingoneAdminError] = useState(null);
  const [showAddServer, setShowAddServer] = useState(false);
  const [addProfileError, setAddProfileError] = useState(null);
  const [newProfile, setNewProfile] = useState({
    label: '',
    transport: 'http',
    url: '',
    authHeader: 'Authorization',
    authValue: '',
    command: '',
    argsText: '',
    envText: '',
  });

  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  // Surface a failed PingOne admin login (routes/mcpPingOneAdminAuth.js
  // redirects back to ?source=custom&pingone_admin_error=... on state
  // mismatch / token exchange failure).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('pingone_admin_error');
    if (err) {
      setPingoneAdminError(err);
      params.delete('pingone_admin_error');
      const qs = params.toString();
      window.history.replaceState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/profiles');
      setProfiles(data.profiles || []);
      setDefaultProfileId(data.defaultProfileId || '');
      setSelectedProfileId((prev) => prev || data.defaultProfileId || '');
    } catch {
      // Non-fatal: the default banking profile still works via the query-less path.
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const refreshTools = useCallback(async () => {
    setLoadingTools(true);
    setProfileError(null);
    setPingoneAdminLoginUrl(null);
    const isNonDefaultProfile = selectedProfileId && selectedProfileId !== defaultProfileId;
    try {
      const qs = isNonDefaultProfile ? `?profile=${encodeURIComponent(selectedProfileId)}` : '';
      const { data } = await apiClient.get(`/api/mcp/inspector/tools${qs}`);
      setTools(data.tools || []);
      setToolsSourceInfo(
        data._source === 'local_catalog'
          ? { local: true, reason: data._localCatalogReason || '' }
          : data._source === 'mcp_server'
            ? { local: false }
            : null,
      );
      if (data._source === 'profile_error') {
        setProfileError(data.reason || 'Failed to reach this MCP server.');
      }
      if (data.pingone_admin_login_required) {
        setPingoneAdminLoginUrl(data.loginUrl || '/api/mcp/inspector/pingone-admin/login');
      }
      setMfaRequired(!!data.mfa_required);
      setStepUpMethod(data.step_up_method || '');
      setSelectedTool(null);
      setLastInvoke(null);
      setLastTiming(null);
      setFormError(null);
      setNeedsLogin(false);
    } catch (e) {
      setMfaRequired(false);
      if (isNonDefaultProfile) {
        setTools([]);
        setToolsSourceInfo(null);
        setProfileError(formatAxiosError(e, 'Failed to reach this MCP server'));
      } else {
        notifyError(formatAxiosError(e, 'BFF unreachable - showing static tool catalog'));
        setTools(BANKING_STATIC_TOOLS);
        setToolsSourceInfo({ local: true, reason: 'bff_unreachable' });
      }
    } finally {
      setLoadingTools(false);
    }
  }, [selectedProfileId, defaultProfileId]);

  useEffect(() => { refreshTools(); }, [refreshTools]);

  const handleAddProfile = useCallback(async () => {
    setAddProfileError(null);
    const { label, transport, url, authHeader, authValue, command, argsText, envText } = newProfile;
    const body = { label: label.trim(), transport };
    if (transport === 'stdio') {
      if (!command.trim()) {
        setAddProfileError('Command is required.');
        return;
      }
      body.command = command.trim();
      body.args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      if (envText.trim()) {
        body.env = {};
        for (const pair of envText.split(',')) {
          const [k, ...rest] = pair.split('=');
          if (k && k.trim()) body.env[k.trim()] = rest.join('=').trim();
        }
      }
    } else {
      if (!url.trim()) {
        setAddProfileError('Server URL is required.');
        return;
      }
      body.url = url.trim();
      if (authHeader.trim() && authValue.trim()) {
        body.authHeader = authHeader.trim();
        body.authValue = authValue.trim();
      }
    }
    try {
      const { data } = await apiClient.post('/api/mcp/inspector/profiles', body);
      await loadProfiles();
      setSelectedProfileId(data.profile.id);
      setShowAddServer(false);
      setNewProfile({
        label: '',
        transport: 'http',
        url: '',
        authHeader: 'Authorization',
        authValue: '',
        command: '',
        argsText: '',
        envText: '',
      });
    } catch (e) {
      setAddProfileError(formatAxiosError(e, 'Failed to add server'));
    }
  }, [newProfile, loadProfiles]);

  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter((t) => (t.name || '').toLowerCase().includes(searchQ) || (t.description || '').toLowerCase().includes(searchQ))
      : tools;
    return groupBankingTools(filtered);
  }, [tools, toolSearch]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
    setNeedsLogin(false);
    setOutputTab('response');
  };

  const handleInvoke = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter((key) => !String(paramValues[key] ?? '').trim());
    if (missing.length > 0) {
      setFormError(`Required: ${missing.join(', ')}`);
      return;
    }
    setFormError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setBusy(true);
    const t0 = Date.now();
    try {
      const isNonDefaultProfile = selectedProfileId && selectedProfileId !== defaultProfileId;
      const { data } = await apiClient.post('/api/mcp/inspector/invoke', {
        tool: selectedTool.name,
        params,
        ...(isNonDefaultProfile ? { profile: selectedProfileId } : {}),
      });
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setNeedsLogin(false);
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      const errBody = e.response?.data || { error: 'invoke_failed', message: formatAxiosError(e, 'Invoke failed') };
      appendMcpCall(selectedTool.name, e.response?.status ?? 0, ms, null, formatAxiosError(e, 'Invoke failed'));
      setLastInvoke(errBody);
      setLastTiming({ ms, error: true, reason: formatAxiosError(e, 'Invoke failed') });
      if (e.response?.data?.error === 'pingone_admin_login_required') {
        setPingoneAdminLoginUrl(e.response.data.loginUrl || '/api/mcp/inspector/pingone-admin/login');
      } else if (e.response?.status === 401) {
        setNeedsLogin(true);
      } else {
        setNeedsLogin(false);
        notifyError(formatAxiosError(e, 'Invoke failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues, selectedProfileId, defaultProfileId]);

  const clearForm = () => {
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
  };

  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response' || outputTab === 'form') {
      if (lastInvoke?.frames?.response) return lastInvoke.frames.response;
      if (lastInvoke) return lastInvoke;
      if (lastTiming?.error) return { error: true, message: lastTiming.reason || 'Invoke failed' };
      return null;
    }
    if (outputTab === 'request') {
      if (lastInvoke?.frames?.request) return lastInvoke.frames.request;
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool?.name, arguments: paramValues } };
    }
    if (outputTab === 'history') return mcpHistory;
    return null;
  }, [outputTab, lastInvoke, lastTiming, selectedTool, paramValues, mcpHistory]);

  const isConnected = !toolsSourceInfo?.local;
  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return {
    statusOn: isConnected,
    statusText: isConnected ? `Connected - ${tools.length} tools` : `Local catalog - ${tools.length} tools`,
    actions: (
      <>
        <select
          className="inspector-shell-topbar__btn"
          value={selectedProfileId}
          onChange={(e) => setSelectedProfileId(e.target.value)}
          title="MCP server to inspect"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}{p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <button className="inspector-shell-topbar__btn" onClick={() => setShowAddServer((v) => !v)}>
          + Add server
        </button>
        <button className="inspector-shell-topbar__btn" onClick={refreshTools} disabled={loadingTools}>
          {loadingTools ? 'Loading...' : 'Refresh'}
        </button>
      </>
    ),
    banner: (
      <>
        {showAddServer && (
          <div style={{ background: '#f8fafc', padding: '12px 20px', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid #cbd5e1' }}>
            <input
              placeholder="Label (e.g. Brave Search)"
              value={newProfile.label}
              onChange={(e) => setNewProfile((p) => ({ ...p, label: e.target.value }))}
            />
            <select
              value={newProfile.transport}
              onChange={(e) => setNewProfile((p) => ({ ...p, transport: e.target.value }))}
            >
              <option value="http">HTTP</option>
              <option value="websocket">WebSocket</option>
              <option value="stdio">stdio (local command)</option>
            </select>
            {newProfile.transport !== 'stdio' ? (
              <>
                <input
                  placeholder="Server URL"
                  value={newProfile.url}
                  onChange={(e) => setNewProfile((p) => ({ ...p, url: e.target.value }))}
                  style={{ minWidth: 220 }}
                />
                <input
                  placeholder="Auth header (e.g. Authorization)"
                  value={newProfile.authHeader}
                  onChange={(e) => setNewProfile((p) => ({ ...p, authHeader: e.target.value }))}
                />
                <input
                  placeholder="Auth value (e.g. Bearer xxx)"
                  type="password"
                  value={newProfile.authValue}
                  onChange={(e) => setNewProfile((p) => ({ ...p, authValue: e.target.value }))}
                />
              </>
            ) : (
              <>
                <input
                  placeholder="Command (e.g. npx)"
                  value={newProfile.command}
                  onChange={(e) => setNewProfile((p) => ({ ...p, command: e.target.value }))}
                />
                <input
                  placeholder="Args (space-separated, e.g. -y @brave/brave-search-mcp-server --transport stdio)"
                  value={newProfile.argsText}
                  onChange={(e) => setNewProfile((p) => ({ ...p, argsText: e.target.value }))}
                  style={{ minWidth: 320 }}
                />
                <input
                  placeholder="Env (KEY=value, comma-separated, e.g. BRAVE_API_KEY=xxx)"
                  value={newProfile.envText}
                  onChange={(e) => setNewProfile((p) => ({ ...p, envText: e.target.value }))}
                  style={{ minWidth: 260 }}
                />
              </>
            )}
            <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={handleAddProfile}>
              Save
            </button>
            {addProfileError && <span style={{ color: '#991b1b' }}>{addProfileError}</span>}
          </div>
        )}
        {pingoneAdminError && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12 }}>
            <strong>PingOne admin sign-in failed.</strong> {pingoneAdminError}
          </div>
        )}
        {pingoneAdminLoginUrl && (
          <div style={{ background: '#eff6ff', color: '#1e40af', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong>PingOne admin sign-in required.</strong>{' '}
            This profile calls the hosted PingOne MCP server with your PingOne admin roles, not a stored secret.
            <button
              className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active"
              onClick={() => { window.location.href = pingoneAdminLoginUrl; }}
            >
              Sign in as PingOne admin
            </button>
          </div>
        )}
        {profileError && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12 }}>
            <strong>Could not reach this MCP server.</strong> {profileError}
          </div>
        )}
        {mfaRequired && (
          <div style={{ background: '#eff6ff', color: '#1e40af', padding: '8px 20px', fontSize: 12 }}>
            <strong>Step-up verification required.</strong>{' '}
            This session needs MFA step-up{stepUpMethod ? ` (${stepUpMethod})` : ''} before tools/list can run.
            Complete step-up verification, then refresh.
          </div>
        )}
        {needsLogin && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong>Sign in required.</strong> This tools/call needs a valid BFF session.
            <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={navigateToCustomerOAuthLogin}>
              Log in
            </button>
          </div>
        )}
      </>
    ),
    left: (
      <>
        <div className="inspector-shell-tree-header"><span>Tools ({tools.length})</span></div>
        <div className="inspector-shell-tree-search">
          <input
            type="search"
            placeholder="Filter tools..."
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="inspector-shell-tree-body">
          {groupedTools.map((group) => (
            <div key={group.key}>
              <div className="inspector-shell-tree-group__label">{group.label} ({group.tools.length})</div>
              {group.tools.map((t) => (
                <InspectorListItem
                  key={t.name}
                  label={t.name}
                  active={selectedTool?.name === t.name}
                  dot={bankingToolDot(t)}
                  badges={bankingToolBadges(t)}
                  onClick={() => selectTool(t)}
                />
              ))}
            </div>
          ))}
          {groupedTools.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
              {tools.length === 0 ? 'No tools loaded.' : `No tools match "${toolSearch}".`}
            </div>
          )}
        </div>
        {mcpHistory.length > 0 && (
          <div className="inspector-shell-tree-footer" style={{ borderTop: '1px solid #cbd5e1', padding: '8px 12px', fontSize: 11, color: '#64748b', maxHeight: 140, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>History ({mcpHistory.length})</div>
            {mcpHistory.slice(-10).reverse().map((entry) => {
              const ok = entry.status >= 200 && entry.status < 300;
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
                  <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: 11 }}>{entry.tool}</span>
                  {entry.duration != null && <span style={{ marginLeft: 'auto', color: '#64748b' }}>{entry.duration}ms</span>}
                </div>
              );
            })}
          </div>
        )}
      </>
    ),
    middle: selectedTool ? (
      <>
        <div className="inspector-shell-form-header">
          <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
          {selectedTool.description && <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>}
          {selectedTool.requiredScopes?.length > 0 && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, fontFamily: 'monospace' }}>
              Scopes: {selectedTool.requiredScopes.join(', ')}
            </div>
          )}
        </div>
        <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
          <button className="inspector-shell-btn-call" onClick={handleInvoke} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
          <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
        </div>
        <div className="inspector-shell-form-body">
          {Object.entries(schemaProps).map(([key, schema]) => (
            <div className="inspector-shell-field" key={key}>
              <label>
                {key}{requiredParams.has(key) && <span className="req"> *</span>}
                <span className="type">{schema?.type || ''}</span>
              </label>
              <input
                type="text"
                placeholder={schema?.description || schema?.type || 'value'}
                value={paramValues[key] ?? ''}
                onChange={(e) => setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
          {Object.keys(schemaProps).length === 0 && (
            <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
          )}
        </div>
        <div className="inspector-shell-form-actions">
          <button className="inspector-shell-btn-call" onClick={handleInvoke} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
          <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
          {formError && <span className="inspector-shell-form-error">{formError}</span>}
        </div>
      </>
    ) : (
      <div className="inspector-shell-form-empty">Select a tool from the tree to inspect and invoke it.</div>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request JSON-RPC' },
            { key: 'history', label: `History (${mcpHistory.length})` },
            { key: 'form', label: 'Form' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              {outputTab === 'form' ? (
                <JsonFormView value={outputContent} />
              ) : (
                <pre className="inspector-shell-output-code">
                  <JsonHighlight value={outputContent} deep />
                </pre>
              )}
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}</span>
              <span><strong>Duration:</strong> {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}</span>
              <span><strong>Transport:</strong> WebSocket JSON-RPC</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">
            {selectedTool ? 'Click Execute to call the tool and see the response here.' : 'Select a tool and execute it to see results.'}
          </div>
        )}
      </>
    ),
  };
}

// ---------------------------------------------------------------------------
// Protocol source — testers for the MCP methods that are not tools/call:
// Resources, Prompts, Completion, Logging. All are clean request→response
// JSON-RPC calls served only behind the MCP gateway (POST /api/mcp/inspector/rpc
// — see demo_api_server/routes/mcpInspector.js). Sampling and Roots are
// server→client capabilities (the MCP server asks the BFF, never the
// reverse) and Cancellation has no cross-request BFF state to reuse from a
// second click — both get a read-only info note here instead of an Execute
// control that would misrepresent the protocol direction.
// ---------------------------------------------------------------------------

const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

const PROTOCOL_METHOD_GROUPS = [
  {
    key: 'resources',
    label: 'Resources',
    methods: [
      { method: 'resources/list', fields: [] },
      { method: 'resources/templates/list', fields: [] },
      {
        method: 'resources/read',
        fields: [{ key: 'uri', label: 'uri', type: 'text', required: true, placeholder: 'banking://accounts' }],
      },
    ],
  },
  {
    key: 'prompts',
    label: 'Prompts',
    methods: [
      { method: 'prompts/list', fields: [] },
      {
        method: 'prompts/get',
        fields: [
          { key: 'name', label: 'name', type: 'text', required: true, placeholder: 'summarize_airline_booking' },
          { key: 'arguments', label: 'arguments', type: 'json', required: false, placeholder: '{ "bookingId": "ABC123" }' },
        ],
      },
    ],
  },
  {
    key: 'completion',
    label: 'Completion',
    methods: [
      {
        method: 'completion/complete',
        fields: [
          { key: 'ref', label: 'ref', type: 'json', required: true, placeholder: '{ "type": "ref/prompt", "name": "summarize_airline_booking" }' },
          { key: 'argument', label: 'argument', type: 'json', required: true, placeholder: '{ "name": "bookingId", "value": "AB" }' },
        ],
      },
    ],
  },
  {
    key: 'logging',
    label: 'Logging',
    methods: [
      {
        method: 'logging/setLevel',
        fields: [{ key: 'level', label: 'level', type: 'enum', required: true, options: LOG_LEVELS, default: 'info' }],
      },
    ],
  },
];

function buildProtocolParams(selectedMethod, fieldValues) {
  const params = {};
  for (const f of selectedMethod.fields) {
    const raw = fieldValues[f.key];
    const trimmed = String(raw ?? '').trim();
    if (f.required && !trimmed) throw new Error(`Required: ${f.label}`);
    if (!trimmed) continue;
    if (f.type === 'json') {
      try {
        params[f.key] = JSON.parse(raw);
      } catch {
        throw new Error(`${f.label} must be valid JSON`);
      }
    } else {
      params[f.key] = raw;
    }
  }
  return params;
}

function useProtocolSource() {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [formError, setFormError] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outputTab, setOutputTab] = useState('response');

  const selectMethod = (m) => {
    setSelectedMethod(m);
    const defaults = {};
    for (const f of m.fields) if (f.type === 'enum' && f.default) defaults[f.key] = f.default;
    setFieldValues(defaults);
    setFormError(null);
    setLastResult(null);
    setLastTiming(null);
    setNeedsLogin(false);
    setOutputTab('response');
  };

  const handleExecute = useCallback(async () => {
    if (!selectedMethod) return;
    let params;
    try {
      params = buildProtocolParams(selectedMethod, fieldValues);
    } catch (err) {
      setFormError(err.message);
      return;
    }
    setFormError(null);
    setBusy(true);
    const t0 = Date.now();
    try {
      const { data } = await apiClient.post('/api/mcp/inspector/rpc', { method: selectedMethod.method, params });
      const ms = Date.now() - t0;
      setLastResult(data);
      setLastTiming({ ms, error: false });
      setNeedsLogin(false);
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      const errBody = e.response?.data || { error: 'rpc_failed', message: formatAxiosError(e, 'RPC failed') };
      setLastResult(errBody);
      setLastTiming({ ms, error: true, reason: formatAxiosError(e, 'RPC failed') });
      if (e.response?.status === 401) {
        setNeedsLogin(true);
      } else {
        setNeedsLogin(false);
        notifyError(formatAxiosError(e, 'RPC failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [selectedMethod, fieldValues]);

  const clearForm = () => {
    setFieldValues({});
    setFormError(null);
    setLastResult(null);
    setLastTiming(null);
  };

  const outputContent = useMemo(() => {
    if (!lastResult && !lastTiming) return null;
    if (outputTab === 'response') {
      if (lastResult) return lastResult;
      if (lastTiming?.error) return { error: true, message: lastTiming.reason || 'RPC failed' };
      return null;
    }
    if (outputTab === 'request') {
      let params = {};
      try {
        params = selectedMethod ? buildProtocolParams(selectedMethod, fieldValues) : {};
      } catch {
        params = fieldValues;
      }
      return { jsonrpc: '2.0', id: 1, method: selectedMethod?.method, params };
    }
    return null;
  }, [outputTab, lastResult, lastTiming, selectedMethod, fieldValues]);

  return {
    statusOn: true,
    statusText: 'Resources / Prompts / Completion / Logging — via MCP Gateway',
    left: (
      <>
        <div className="inspector-shell-tree-header"><span>Protocol Methods</span></div>
        <div className="inspector-shell-tree-body">
          {PROTOCOL_METHOD_GROUPS.map((group) => (
            <div key={group.key}>
              <div className="inspector-shell-tree-group__label">{group.label}</div>
              {group.methods.map((m) => (
                <InspectorListItem
                  key={m.method}
                  label={m.method}
                  active={selectedMethod?.method === m.method}
                  onClick={() => selectMethod(m)}
                />
              ))}
            </div>
          ))}
        </div>
        <div
          className="inspector-shell-tree-footer"
          style={{ borderTop: '1px solid #cbd5e1', padding: '10px 12px', fontSize: 11, color: '#64748b' }}
        >
          <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Sampling &amp; Roots
          </div>
          <div>
            Sampling (<code>sampling/createMessage</code>) and Roots (<code>roots/list</code>) are server-initiated
            capabilities — the MCP server asks the BFF, never the reverse — so there is no Execute control for them
            here; a button would misrepresent the protocol direction. They already run automatically whenever an MCP
            server issues the request (see <code>mcpWebSocketClient.js</code>) and are covered by real tests in
            {' '}<code>demo_api_server/src/__tests__/mcpWebSocketClient.samplingRoots.test.js</code>.
          </div>
        </div>
      </>
    ),
    middle: (
      <>
        {needsLogin && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: '8px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong>Sign in required.</strong> This call needs a valid BFF session.
            <button className="inspector-shell-topbar__btn inspector-shell-topbar__btn--active" onClick={navigateToCustomerOAuthLogin}>
              Log in
            </button>
          </div>
        )}
        {selectedMethod ? (
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">{selectedMethod.method}</div>
            </div>
            <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
              <button className="inspector-shell-btn-call" onClick={handleExecute} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
            </div>
            <div className="inspector-shell-form-body">
              {selectedMethod.fields.map((f) => (
                <div className="inspector-shell-field" key={f.key}>
                  <label>
                    {f.label}{f.required && <span className="req"> *</span>}
                    <span className="type">{f.type}</span>
                  </label>
                  {f.type === 'enum' ? (
                    <select
                      value={fieldValues[f.key] ?? f.default ?? ''}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    >
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'json' ? (
                    <textarea
                      rows={4}
                      placeholder={f.placeholder}
                      value={fieldValues[f.key] ?? ''}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      value={fieldValues[f.key] ?? ''}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              {selectedMethod.fields.length === 0 && (
                <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
              )}
            </div>
            <div className="inspector-shell-form-actions">
              <button className="inspector-shell-btn-call" onClick={handleExecute} disabled={busy}>{busy ? 'Calling...' : 'Execute'}</button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
              {formError && <span className="inspector-shell-form-error">{formError}</span>}
            </div>
          </>
        ) : (
          <div className="inspector-shell-form-empty">Select a Resources / Prompts / Completion / Logging method from the tree.</div>
        )}
      </>
    ),
    right: (
      <>
        <InspectorTabs
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'request', label: 'Request' },
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code">
                <JsonHighlight value={outputContent} deep />
              </pre>
            </div>
            <div className="inspector-shell-output-footer">
              <span><strong>Status:</strong> {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}</span>
              <span><strong>Duration:</strong> {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}</span>
              <span><strong>Transport:</strong> WebSocket JSON-RPC (via MCP Gateway)</span>
            </div>
          </>
        ) : (
          <div className="inspector-shell-output-empty">
            {selectedMethod ? 'Click Execute to call the method and see the response here.' : 'Select a method and execute it to see results.'}
          </div>
        )}
      </>
    ),
  };
}

export default function McpInspectorPage() {
  const [searchParams] = useSearchParams();
  const requestedSource = searchParams.get('source');
  // Vertical IDs from the agent (retail, healthcare, government, …) are not
  // source keys — map them to banking (AI Demo MCP) since that server handles
  // all verticals. Only fall back to pingone when no source is given.
  const initialSource = SOURCES.some((s) => s.key === requestedSource)
    ? requestedSource
    : requestedSource
      ? 'banking'
      : 'pingone';
  const [activeSource, setActiveSource] = useState(initialSource);
  const banking = useBankingSource();
  const pingone = usePingOneSource();
  const api = useApiCallsSource();
  const custom = useCustomServerSource();
  const protocol = useProtocolSource();
  const current =
    activeSource === 'pingone' ? pingone
      : activeSource === 'api' ? api
      : activeSource === 'custom' ? custom
      : activeSource === 'protocol' ? protocol
      : banking;

  return (
    <InspectorShell
      title="MCP Inspector"
      statusOn={current.statusOn}
      statusText={current.statusText}
      actions={current.actions}
      banner={current.banner}
      left={
        <>
          <div className="source-switcher">
            {SOURCES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`src-pill${activeSource === s.key ? ' src-pill--active' : ''}`}
                onClick={() => setActiveSource(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {current.left}
        </>
      }
      middle={current.middle}
      right={current.right}
    />
  );
}
