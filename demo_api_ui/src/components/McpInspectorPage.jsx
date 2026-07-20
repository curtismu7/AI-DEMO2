// demo_api_ui/src/components/McpInspectorPage.jsx
// Consolidates McpInspector.js (Banking MCP), PingOneMcpInspector.js
// (PingOne MCP), and ApiExplorerPanel.js (API Calls) behind one
// InspectorShell instance with a source switcher. Each source's logic is
// a straight adaptation of its original file — see the design spec
// (docs/superpowers/specs/2026-07-19-inspector-shell-template-design.md)
// and this plan's own Architecture section for why these aren't unified
// into shared logic. The three original files are untouched by this page
// — McpInspector.js and ApiExplorerPanel.js are still separately embedded
// in McpGatewayConfig.jsx and DevToolsDashboard.jsx respectively.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
import InspectorListItem from './shared/InspectorListItem';
import './shared/InspectorShell.css';

const SOURCES = [
  { key: 'banking', label: 'Banking MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
];

// ---------------------------------------------------------------------------
// Banking MCP source — adapted from McpInspector.js's default-profile path.
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
      setSelectedTool(null);
      setLastInvoke(null);
      setLastTiming(null);
      setFormError(null);
      setNeedsLogin(false);
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
      const { data } = await apiClient.post('/api/mcp/inspector/invoke', { tool: selectedTool.name, params });
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setNeedsLogin(false);
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, e.response?.status ?? 0, ms, null, formatAxiosError(e, 'Invoke failed'));
      setLastInvoke(e.response?.data?.frames ? e.response.data : null);
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
  }, [selectedTool, paramValues]);

  const clearForm = () => {
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
  };

  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response') return lastInvoke ?? null;
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
          ]}
          activeKey={outputTab}
          onChange={setOutputTab}
        />
        {outputContent ? (
          <>
            <div className="inspector-shell-output-body">
              <pre className="inspector-shell-output-code"><JsonHighlight value={outputContent} deep /></pre>
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

export default function McpInspectorPage() {
  const [activeSource, setActiveSource] = useState('banking');
  const banking = useBankingSource();
  const current = banking; // Steps in Tasks 2-3 add pingone/api and select based on activeSource.

  return (
    <InspectorShell
      title="MCP Inspector"
      statusOn={current.statusOn}
      statusText={current.statusText}
      actions={current.actions}
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
