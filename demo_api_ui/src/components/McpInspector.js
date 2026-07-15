// banking_api_ui/src/components/McpInspector.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import JsonHighlight from './shared/JsonHighlight';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import PageNav from './PageNav';
import '../styles/appShellPages.css';
import './McpInspector.css';
import './PingOneMcpInspector.css';

/**
 * Demo MCP Inspector — same UX as PingOne MCP Inspector, pointed at the demo
 * banking MCP server (WebSocket JSON-RPC via the BFF host proxy).
 */

/** Collapsible page section backed by <details> (no extra state to manage). */
const Section = ({ title, hint, status, defaultOpen = true, children }) => (
  <details className="p1mcp-section" open={defaultOpen}>
    <summary>
      <span className="p1mcp-section__title">{title}</span>
      {status && (
        <span className={`p1mcp-section__status p1mcp-section__status--${status}`}>
          {status === 'ok' ? '✓ received' : status === 'error' ? 'error' : status}
        </span>
      )}
      {hint && <span className="p1mcp-section__hint">{hint}</span>}
    </summary>
    <div className="p1mcp-section__body">{children}</div>
  </details>
);

/**
 * Coerce a text-input value to the schema-declared type so booleans/numbers/
 * objects reach the server typed, not stringly. Empty inputs are omitted.
 */
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

// Group banking tools into tabs by required scopes / name (same rules as before).
const isWriteScope = (s) => /write|manage|delete/.test(String(s).toLowerCase());
const isWriteTool = (tool) => (tool.requiredScopes || []).some(isWriteScope);
const isReasoningTool = (tool) => {
  const n = (tool.name || '').toLowerCase();
  return n.includes('think') || n.includes('reason');
};
const toolGroup = (tool) =>
  isReasoningTool(tool) ? 'reasoning' : isWriteTool(tool) ? 'write' : 'read';

const isSensitiveTool = (tool) =>
  (tool.requiredScopes || []).some((s) => String(s).toLowerCase().includes('sensitive')) ||
  (tool.name || '').toLowerCase().includes('sensitive');
const toolFlavor = (tool) => (isSensitiveTool(tool) ? 'sensitive' : toolGroup(tool));
const FLAVOR_BADGE = { write: 'WRITE', sensitive: 'SENSITIVE' };

const TABS = [
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
  { id: 'reasoning', label: 'Reasoning' },
];

const RESOURCE_META = {
  accounts: { label: 'Accounts' },
  transactions: { label: 'Transactions' },
  admin: { label: 'Customer administration' },
  directory: { label: 'Directory / users' },
  vertical: { label: 'Vertical demos' },
  reasoning: { label: 'Reasoning' },
  other: { label: 'Other' },
};
const RESOURCE_ORDER = [
  'accounts',
  'transactions',
  'admin',
  'directory',
  'vertical',
  'reasoning',
  'other',
];
const COLLAPSED_RESOURCES = new Set(['admin', 'directory', 'vertical', 'other']);

const toolResource = (tool) => {
  const name = (tool.name || '').toLowerCase();
  const scopes = (tool.requiredScopes || []).map((s) => String(s).toLowerCase());
  const hasPrefix = (p) => scopes.some((s) => s.startsWith(p));
  if (isReasoningTool(tool)) return 'reasoning';
  if (hasPrefix('admin:') || hasPrefix('users:') || name.includes('customer')) return 'admin';
  if (
    name.includes('transaction') ||
    /deposit|withdraw|transfer/.test(name) ||
    hasPrefix('transactions')
  ) {
    return 'transactions';
  }
  if (name.includes('account') || name.includes('balance') || hasPrefix('accounts')) {
    return 'accounts';
  }
  if (name.startsWith('show_')) return 'vertical';
  if (name.includes('user') || name.includes('email')) return 'directory';
  return 'other';
};

const groupByResource = (toolList) => {
  const buckets = {};
  for (const t of toolList) (buckets[toolResource(t)] ||= []).push(t);
  return RESOURCE_ORDER.filter((k) => buckets[k]?.length).map((k) => [k, buckets[k]]);
};

const STATIC_LOCAL_TOOLS = [
  {
    name: 'get_my_accounts',
    description: 'List all bank accounts with balances and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['accounts:read'],
  },
  {
    name: 'get_account_balance',
    description: 'Get current balance for a specific account by ID.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' } },
      required: ['account_id'],
    },
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

/**
 * Demo MCP Inspector: live tools/list + tools/call via the BFF MCP Host proxy.
 * Layout mirrors PingOneMcpInspector; traffic goes to the banking MCP server.
 */
const McpInspector = ({ user, onLogout }) => {
  const { open } = useEducationUI();
  const [tools, setTools] = useState([]);
  const [toolsSourceInfo, setToolsSourceInfo] = useState(null);
  const [toolsFrames, setToolsFrames] = useState(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [activeTab, setActiveTab] = useState('read');
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [formError, setFormError] = useState(null);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
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
      setToolsFrames(data.frames || null);
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
      notifyError(formatAxiosError(e, 'BFF unreachable — showing static tool catalog'));
      setTools(STATIC_LOCAL_TOOLS);
      setToolsFrames(null);
      setToolsSourceInfo({ local: true, reason: 'bff_unreachable' });
    } finally {
      setLoadingTools(false);
    }
  }, []);

  useEffect(() => {
    refreshTools();
  }, [refreshTools]);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setSelectedTool(null);
    setLastInvoke(null);
    setLastTiming(null);
    setFormError(null);
    setNeedsLogin(false);
  };

  const handleSelectTool = (t) => {
    setSelectedTool(t);
    setParamValues({});
    setFormError(null);
    setLastInvoke(null);
    setLastTiming(null);
    setNeedsLogin(false);
  };

  const handleInvoke = async () => {
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
      const { data } = await apiClient.post('/api/mcp/inspector/invoke', {
        tool: selectedTool.name,
        params,
      });
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setNeedsLogin(false);
    } catch (e) {
      const ms = Date.now() - t0;
      appendMcpCall(
        selectedTool.name,
        e.response?.status ?? 0,
        ms,
        null,
        formatAxiosError(e, 'Invoke failed'),
      );
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
  };

  const groupedTools = useMemo(() => {
    const buckets = { read: [], write: [], reasoning: [] };
    for (const t of tools) buckets[toolGroup(t)].push(t);
    return buckets;
  }, [tools]);

  const tabTools = groupedTools[activeTab] || [];
  const searchQuery = toolSearch.trim().toLowerCase();
  const visibleTools = searchQuery
    ? tabTools.filter((t) => {
        const name = (t.name || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        return name.includes(searchQuery) || desc.includes(searchQuery);
      })
    : tabTools;

  const tabCounts = {
    read: groupedTools.read.length,
    write: groupedTools.write.length,
    reasoning: groupedTools.reasoning.length,
  };
  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  const callButton = selectedTool ? (
    <button
      type="button"
      className="mcp-inspector__btn"
      onClick={handleInvoke}
      disabled={busy}
      title={`Invoke ${selectedTool.name} via the Backend-for-Frontend (BFF)`}
    >
      {busy ? 'Calling…' : `Call ${selectedTool.name}`}
    </button>
  ) : null;

  return (
    <div className="mcp-inspector-page app-page-shell">
      <PageNav user={user} onLogout={onLogout} title="Demo MCP Inspector" />
      <header className="app-page-shell__hero">
        <div className="app-page-shell__hero-top">
          <div>
            <h1 className="app-page-shell__title">Demo MCP Inspector</h1>
            <div className="app-page-shell__lead">
              Calls the demo <strong>banking MCP server</strong> over WebSocket JSON-RPC through the
              Backend-for-Frontend (BFF) and returns its <code>tools/list</code>. Click a tool chip
              below to invoke it (same layout as the PingOne MCP Inspector).
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="mcp-inspector__btn"
              onClick={() => open(EDU.MCP_PROTOCOL, 'what')}
            >
              What is MCP?
            </button>
            <button
              type="button"
              className="mcp-inspector__btn"
              onClick={refreshTools}
              disabled={loadingTools}
            >
              {loadingTools ? 'Querying…' : 'Refresh tools/list'}
            </button>
            <Link
              className="mcp-inspector__btn"
              style={{ textDecoration: 'none' }}
              to="/pingone-mcp-inspector"
              title="Hosted PingOne MCP Inspector"
            >
              PingOne MCP Inspector
            </Link>
          </div>
        </div>
      </header>

      {toolsSourceInfo?.local && (
        <section className="mcp-inspector__notice mcp-inspector__notice--warn">
          <strong>Showing static / local catalog.</strong>{' '}
          {toolsSourceInfo.reason
            ? `(${toolsSourceInfo.reason}) `
            : ''}
          Start the stack and sign in so the BFF can reach the banking MCP server, then refresh.
        </section>
      )}

      {needsLogin && (
        <section className="mcp-inspector__notice mcp-inspector__notice--error">
          <strong>Sign in required.</strong> This tools/call needs a valid BFF session.{' '}
          <button
            type="button"
            className="mcp-inspector__btn mcp-inspector__btn--primary"
            onClick={navigateToCustomerOAuthLogin}
          >
            Log in
          </button>
        </section>
      )}

      <Section
        title={`Tools (${tools.length})`}
        hint="Click a chip to inspect and invoke a tool"
        status={tools.length ? 'ok' : undefined}
      >
        {tools.length === 0 && !loadingTools ? (
          <p className="mcp-inspector__muted">No tools returned yet — sign in and refresh.</p>
        ) : (
          <>
            <div className="p1mcp-tabs" role="tablist">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={activeTab === tab.id}
                  className={`p1mcp-tab ${activeTab === tab.id ? 'p1mcp-tab--active' : ''}`}
                  onClick={() => switchTab(tab.id)}
                >
                  {tab.label}
                  <span className="p1mcp-tab__count">{tabCounts[tab.id]}</span>
                </button>
              ))}
            </div>

            {callButton && <div className="p1mcp-chips-callbar">{callButton}</div>}

            <div className="p1mcp-tool-search">
              <label htmlFor="mcp-tool-search" className="p1mcp-tool-search__label">
                Search tools
              </label>
              <input
                id="mcp-tool-search"
                type="search"
                className="p1mcp-tool-search__input"
                placeholder="Filter by name or description…"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {searchQuery && (
                <span className="p1mcp-tool-search__count" aria-live="polite">
                  {visibleTools.length} of {tabTools.length}
                </span>
              )}
            </div>

            {visibleTools.length === 0 ? (
              <p className="mcp-inspector__muted">
                {searchQuery
                  ? `No tools match "${toolSearch.trim()}".`
                  : `No ${activeTab} tools in the catalog.`}
              </p>
            ) : (
              groupByResource(visibleTools).map(([resKey, resTools]) => {
                const meta = RESOURCE_META[resKey];
                return (
                  <details
                    className="p1mcp-chip-group"
                    key={resKey}
                    open={!!searchQuery || !COLLAPSED_RESOURCES.has(resKey)}
                  >
                    <summary className="p1mcp-chip-group__head">
                      <span className="p1mcp-chip-group__label">{meta.label}</span>
                      <span className="p1mcp-chip-group__count">{resTools.length}</span>
                    </summary>
                    <div className="p1mcp-chips">
                      {resTools.map((t) => {
                        const flavor = toolFlavor(t);
                        const badge = FLAVOR_BADGE[flavor];
                        return (
                          <button
                            key={t.name}
                            type="button"
                            className={`p1mcp-chip p1mcp-chip--${flavor} ${
                              selectedTool?.name === t.name ? 'p1mcp-chip--active' : ''
                            }`}
                            title={t.description || t.name}
                            onClick={() => handleSelectTool(t)}
                          >
                            <i className="p1mcp-chip__dot" aria-hidden="true" />
                            {t.name}
                            {badge && <span className="p1mcp-chip__badge">{badge}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </details>
                );
              })
            )}

            {selectedTool && (
              <div className="p1mcp-tool-card">
                <div className="p1mcp-tool-card__name">{selectedTool.name}</div>
                {selectedTool.description && (
                  <p className="p1mcp-tool-card__desc">{selectedTool.description}</p>
                )}
                {selectedTool.requiredScopes?.length > 0 && (
                  <p className="mcp-inspector__scopes">
                    Required scopes: <code>{selectedTool.requiredScopes.join(', ')}</code>
                  </p>
                )}

                {Object.keys(schemaProps).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {Object.entries(schemaProps).map(([key, schema]) => (
                      <div className="p1mcp-param-row" key={key}>
                        <label htmlFor={`mcp-param-${key}`}>
                          {key}
                          {requiredParams.has(key) && <span className="p1mcp-required"> *</span>}
                        </label>
                        <input
                          id={`mcp-param-${key}`}
                          type="text"
                          placeholder={schema?.description || schema?.type || 'value'}
                          value={paramValues[key] ?? ''}
                          onChange={(e) =>
                            setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                        />
                        <span className="p1mcp-param-type">{schema?.type || ''}</span>
                      </div>
                    ))}
                  </div>
                )}

                {callButton}
                {formError && (
                  <div className="p1mcp-call-status p1mcp-call-status--error">{formError}</div>
                )}

                {(lastTiming || lastInvoke) && (
                  <>
                    {lastTiming && (
                      <div
                        className={`p1mcp-call-status ${
                          lastTiming.error ? 'p1mcp-call-status--error' : ''
                        }`}
                      >
                        {lastTiming.error
                          ? lastTiming.reason
                          : `Completed in ${lastTiming.ms} ms`}
                      </div>
                    )}
                    {lastInvoke?.frames?.request && (
                      <Section
                        title="Call request"
                        hint="JSON-RPC tools/call sent over WebSocket"
                        status="ok"
                        defaultOpen
                      >
                        <pre className="mcp-inspector__code jh-dark">
                          <JsonHighlight value={lastInvoke.frames.request} deep />
                        </pre>
                      </Section>
                    )}
                    {lastInvoke?.frames?.response && (
                      <Section
                        title="Call response"
                        status={lastTiming?.error ? 'error' : 'ok'}
                        defaultOpen
                      >
                        <pre className="mcp-inspector__code jh-dark">
                          <JsonHighlight value={lastInvoke.frames.response} deep />
                        </pre>
                      </Section>
                    )}
                    {lastInvoke?.tokenEvents?.length > 0 && (
                      <Section
                        title={`Token exchange (${lastInvoke.tokenEvents.length} events)`}
                        hint="user token → RFC 8693 → MCP token"
                        defaultOpen={false}
                      >
                        <pre className="mcp-inspector__code jh-dark">
                          <JsonHighlight value={lastInvoke.tokenEvents} deep />
                        </pre>
                      </Section>
                    )}
                    {lastInvoke && !lastInvoke.frames && (
                      <Section title="Full response body" defaultOpen>
                        <pre className="mcp-inspector__pre jh-dark">
                          <JsonHighlight value={lastInvoke} deep />
                        </pre>
                      </Section>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title={`Session MCP call history (${mcpHistory.length})`}
        hint="Calls from this page and the Banking Agent"
        defaultOpen={false}
      >
        {mcpHistory.length === 0 ? (
          <p className="mcp-inspector__muted">No MCP tool calls yet this session.</p>
        ) : (
          <ol className="mcp-history__list">
            {mcpHistory.map((entry) => {
              const ok = entry.status >= 200 && entry.status < 300;
              const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
              return (
                <li
                  key={entry.id}
                  className={`mcp-history__item${ok ? ' mcp-history__item--ok' : ' mcp-history__item--err'}`}
                >
                  <span className="mcp-history__status-dot" aria-hidden="true" />
                  <div className="mcp-history__item-body">
                    <span className="mcp-history__tool">{entry.tool}</span>
                    {ts && <span className="mcp-history__time">{ts}</span>}
                    <span
                      className={`mcp-history__badge${ok ? ' mcp-history__badge--ok' : ' mcp-history__badge--err'}`}
                    >
                      {ok ? `${entry.status} OK` : `${entry.status || 'ERR'}`}
                    </span>
                    {entry.duration != null && (
                      <span className="mcp-history__duration">{entry.duration} ms</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section
        title="Discovery request"
        hint="JSON-RPC tools/list sent by the BFF over WebSocket"
        status={toolsFrames?.request ? 'ok' : undefined}
        defaultOpen={false}
      >
        <pre className="mcp-inspector__code jh-dark">
          <JsonHighlight
            value={
              toolsFrames?.request || {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {},
              }
            }
            deep
          />
        </pre>
      </Section>

      <Section
        title="Discovery response"
        status={toolsFrames?.response ? (toolsSourceInfo?.local ? 'error' : 'ok') : undefined}
        defaultOpen={false}
      >
        {toolsFrames?.response ? (
          <pre className="mcp-inspector__code jh-dark">
            <JsonHighlight value={toolsFrames.response} deep />
          </pre>
        ) : (
          <p className="mcp-inspector__muted">No live tools/list response yet — refresh after signing in.</p>
        )}
      </Section>
    </div>
  );
};

export default McpInspector;
