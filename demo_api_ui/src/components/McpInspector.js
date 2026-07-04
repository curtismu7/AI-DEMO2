// banking_api_ui/src/components/McpInspector.js
import React, { useState, useEffect, useCallback } from 'react';
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
import './DemoDataPage.css';
import './McpInspector.css';
import './PingOneMcpInspector.css';

/**
 * Coerce a text-input value to the schema-declared type so booleans/numbers/
 * objects reach the server typed, not stringly. Empty inputs are omitted.
 * (Same contract as the PingOne MCP Inspector, which this page mirrors.)
 */
const coerceParam = (raw, type) => {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
};

// Group banking tools into tabs by what they DO, derived from their required
// SCOPES rather than the tool name. Any tool whose scopes carry a write/manage/
// delete verb is a Write (so freeze_account, adjust_balance, delete_customer,
// update_contact_email, etc. leave the Read tab); the think tool is Reasoning;
// everything else is Read. Scope vocabularies differ by catalog source — the
// live MCP server returns flat scopes (write, admin:write) while the BFF's local
// catalog returns prefixed ones (transactions:write) — so we substring-match the
// verb instead of matching exact scope strings.
const isWriteScope = (s) => (/write|manage|delete/).test(s.toLowerCase());
const isWriteTool = (tool) => (tool.requiredScopes || []).some(isWriteScope);
const isReasoningTool = (tool) => {
  const n = tool.name.toLowerCase();
  return n.includes('think') || n.includes('reason');
};
const toolGroup = (tool) =>
  isReasoningTool(tool) ? 'reasoning' : isWriteTool(tool) ? 'write' : 'read';

// "Flavor" drives the chip's dot colour + badge — independent of the active tab
// so the read/write/sensitive signal stays visible even inside a single tab.
// Sensitive outranks read: a sensitive read still needs the louder treatment.
const isSensitiveTool = (tool) =>
  (tool.requiredScopes || []).some((s) => s.toLowerCase().includes('sensitive')) ||
  tool.name.toLowerCase().includes('sensitive');
const toolFlavor = (tool) =>
  isSensitiveTool(tool) ? 'sensitive' : toolGroup(tool);

// Sub-group a tab's tools by the resource they touch. Derivation blends the tool
// name and its scope prefixes so it works for both catalog vocabularies. Order of
// the checks is deliberate: customer-administration tools win over the plain
// account/transaction match so get_customer_accounts files under Admin, not
// Accounts.
const RESOURCE_META = {
  accounts:     { label: 'Accounts',                icon: '🏦' },
  transactions: { label: 'Transactions',            icon: '💸' },
  admin:        { label: 'Customer administration', icon: '🛡️' },
  directory:    { label: 'Directory / users',       icon: '👤' },
  vertical:     { label: 'Vertical demos',          icon: '🧩' },
  reasoning:    { label: 'Reasoning',               icon: '🧠' },
  other:        { label: 'Other',                   icon: '🔧' },
};
const RESOURCE_ORDER = ['accounts', 'transactions', 'admin', 'directory', 'vertical', 'reasoning', 'other'];
// Groups rendered collapsed by default. A broadly-scoped (e.g. admin) token
// surfaces many secondary tools, so only the self-service groups stay open — the
// rest fold away to keep the tab scannable instead of a wall of chips.
const COLLAPSED_RESOURCES = new Set(['admin', 'directory', 'vertical', 'other']);
const toolResource = (tool) => {
  const name = tool.name.toLowerCase();
  const scopes = (tool.requiredScopes || []).map((s) => s.toLowerCase());
  const hasPrefix = (p) => scopes.some((s) => s.startsWith(p));
  if (isReasoningTool(tool)) return 'reasoning';
  if (hasPrefix('admin:') || hasPrefix('users:') || name.includes('customer')) return 'admin';
  if (name.includes('transaction') || (/deposit|withdraw|transfer/).test(name) || hasPrefix('transactions')) return 'transactions';
  if (name.includes('account') || name.includes('balance') || hasPrefix('accounts')) return 'accounts';
  if (name.startsWith('show_')) return 'vertical';
  if (name.includes('user') || name.includes('email')) return 'directory';
  return 'other';
};
// Ordered [resourceKey, tools[]] pairs for a tab's tool list (empty groups dropped).
const groupByResource = (toolList) => {
  const buckets = {};
  for (const t of toolList) (buckets[toolResource(t)] ||= []).push(t);
  return RESOURCE_ORDER.filter((k) => buckets[k]?.length).map((k) => [k, buckets[k]]);
};

const FLAVOR_BADGE = { write: 'WRITE', sensitive: '🔒 SENSITIVE' };

const TABS = [
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
  { id: 'reasoning', label: 'Reasoning' },
];

// Static fallback — shown when BFF is unreachable (server down, cold start, etc.)
const STATIC_LOCAL_TOOLS = [
  { name: 'get_my_accounts',            description: 'List all bank accounts with balances and status.',            inputSchema: { type:'object', properties:{}, required:[] } },
  { name: 'get_account_balance',         description: 'Get current balance for a specific account by ID.',          inputSchema: { type:'object', properties:{ account_id:{type:'string'} }, required:['account_id'] } },
  { name: 'get_my_transactions',         description: 'Retrieve transaction history for the authenticated user.',   inputSchema: { type:'object', properties:{}, required:[] } },
  { name: 'get_sensitive_account_details', description: 'Retrieve full account number and routing number (requires sensitive:read + consent).', inputSchema: { type:'object', properties:{}, required:[] } },
  { name: 'create_deposit',              description: 'Deposit funds into an account. Amounts over $500 require HITL consent.', inputSchema: { type:'object', properties:{ to_account_id:{type:'string'}, amount:{type:'number'}, description:{type:'string'} }, required:['to_account_id','amount'] } },
  { name: 'create_withdrawal',           description: 'Withdraw funds from an account. Amounts over $500 require HITL consent.', inputSchema: { type:'object', properties:{ from_account_id:{type:'string'}, amount:{type:'number'}, description:{type:'string'} }, required:['from_account_id','amount'] } },
  { name: 'create_transfer',             description: 'Transfer money between accounts. Amounts over $500 require HITL consent.', inputSchema: { type:'object', properties:{ from_account_id:{type:'string'}, to_account_id:{type:'string'}, amount:{type:'number'}, description:{type:'string'} }, required:['from_account_id','to_account_id','amount'] } },
  { name: 'query_user_by_email',         description: 'Check if a user exists by email address (public, no auth required).', inputSchema: { type:'object', properties:{ email:{type:'string'} }, required:['email'] } },
  { name: 'sequential_think',            description: 'Reason step-by-step through a complex banking question or decision.', inputSchema: { type:'object', properties:{ query:{type:'string'}, context:{type:'string'} }, required:['query'] } },
];

/**
 * Demo MCP Inspector: live tools/list + tools/call via the Backend-for-Frontend (BFF) MCP Host proxy.
 * Complements LangChain MCP Host JSON at REACT_APP_LANGCHAIN_INSPECTOR_URL (default :8890/inspector/mcp-host).
 */
const McpInspector = ({ user, onLogout }) => {
  const { open } = useEducationUI();
  const [context, setContext] = useState(null);
  const [tools, setTools] = useState([]);
  const [toolsSourceInfo, setToolsSourceInfo] = useState(null);
  // Exact JSON-RPC tools/list frames from the live path (null on fallback).
  const [toolsFrames, setToolsFrames] = useState(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [activeTab, setActiveTab] = useState('read');
  const [selectedTool, setSelectedTool] = useState(null);
  // Per-parameter form values keyed by schema property name (mirrors PingOne).
  const [paramValues, setParamValues] = useState({});
  // Client-side required-param message; blocks the call before any network.
  const [formError, setFormError] = useState(null);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  // Proxy through the BFF so the browser can use HTTPS.
  // The BFF fetches from http://localhost:8890 server-side where TLS is not needed.
  const langchainInspector =
    process.env.REACT_APP_LANGCHAIN_INSPECTOR_URL ||
    '/api/mcp/inspector/langchain-host';

  const dashboardPath = user?.role === 'admin' ? '/admin' : '/dashboard';

  // Dedicated MCP call history — updated synchronously by bankingAgentService + Invoke button
  const [mcpHistory, setMcpHistory] = useState(getCalls);

  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/context');
      setContext(data);
    } catch (e) {
      console.error(e);
      notifyError(formatAxiosError(e, 'Failed to load inspector context'));
    }
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
            : null
      );
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
    loadContext();
    refreshTools();
  }, [loadContext, refreshTools]);

  const switchTab = tabId => {
    setActiveTab(tabId);
    setSelectedTool(null);
    setLastInvoke(null);
    setLastTiming(null);
    setFormError(null);
    setNeedsLogin(false);
  };

  const handleSelectTool = t => {
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
    const missing = required.filter(key => !String(paramValues[key] ?? '').trim());
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
      appendMcpCall(selectedTool.name, e.response?.status ?? 0, ms, null, formatAxiosError(e, 'Invoke failed'));
      // A JSON-RPC-level failure still carries the real frames + token chain
      // in the error body — render them instead of dropping the result panel.
      setLastInvoke(e.response?.data?.frames ? e.response.data : null);
      setLastTiming({ ms, error: true, reason: formatAxiosError(e, 'Invoke failed') });
      // A 401 means the BFF holds no valid user session — prompt a login instead
      // of just surfacing the raw "Authentication required" error.
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

  // Group the live catalog into tabs; unknown tools fall into Read.
  const groupedTools = { read: [], write: [], reasoning: [] };
  for (const t of tools) groupedTools[toolGroup(t)].push(t);
  const visibleTools = groupedTools[activeTab] || [];
  const tabCounts = {
    read: groupedTools.read.length,
    write: groupedTools.write.length,
    reasoning: groupedTools.reasoning.length,
  };
  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return (
    <div className="mcp-inspector-page app-page-shell">
      <header className="app-page-shell__hero">
        <div className="app-page-shell__hero-top">
          <div>
            <h1 className="app-page-shell__title">Demo MCP Inspector</h1>
            <div className="app-page-shell__lead">
              This page exercises the <strong>Backend-for-Frontend (BFF)</strong> MCP host (session + optional token exchange). The same MCP server and
              Banking API are also used by the <strong>LangChain</strong> MCP host — compare both below.
            </div>
          </div>
          <div className="app-page-shell__actions">
            <Link to={dashboardPath} className="app-page-shell__btn app-page-shell__btn--solid">
              ← Dashboard
            </Link>
            {onLogout && (
              <button type="button" className="app-page-shell__btn" onClick={onLogout}>
                Log out
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="app-page-shell__body">
        <PageNav user={user} onLogout={onLogout} title="Demo MCP Inspector" />

        <div className="app-page-toolbar app-page-toolbar--start mcp-inspector__edu-toolbar">
          <button type="button" className="app-page-toolbar-btn" onClick={() => open(EDU.MCP_PROTOCOL, 'what')}>
            What is MCP?
          </button>
          <button type="button" className="app-page-toolbar-btn" onClick={() => open(EDU.TOKEN_EXCHANGE, 'why')}>
            Token exchange
          </button>
          <button type="button" className="app-page-toolbar-btn" onClick={() => open(EDU.INTROSPECTION, 'why')}>
            Introspection
          </button>
          <button type="button" className="app-page-toolbar-btn" onClick={() => open(EDU.AGENT_GATEWAY, 'overview')}>
            Agent Gateway
          </button>
        </div>

        <div className="mcp-inspector">
          <section className="app-page-card demo-data-section mcp-history">
            <div className="mcp-history__header">
              <h2 className="mcp-history__title">Session MCP call history</h2>
              <span className="mcp-history__count">{mcpHistory.length} call{mcpHistory.length !== 1 ? 's' : ''}</span>
            </div>
            {mcpHistory.length === 0 ? (
              <p className="mcp-inspector__muted mcp-history__empty">
                No MCP tool calls yet this session. Use the AI Agent or the <em>Invoke</em> panel below to make a <code>tools/call</code>.
              </p>
            ) : (
              <ol className="mcp-history__list">
                {mcpHistory.map(entry => {
                  const ok = entry.status >= 200 && entry.status < 300;
                  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
                  // Extract a short summary from the result (content array → text, or message)
                  const resultText = (() => {
                    const r = entry.result;
                    if (!r) return entry.errorMsg || null;
                    const content = typeof r === 'object'
                      ? (r.content?.[0]?.text || r.message || null)
                      : (typeof r === 'string' ? r : null);
                    if (typeof content === 'string') return content.length > 120 ? content.slice(0, 120) + '…' : content;
                    return null;
                  })();
                  return (
                    <li key={entry.id} className={`mcp-history__item${ok ? ' mcp-history__item--ok' : ' mcp-history__item--err'}`}>
                      <span className="mcp-history__status-dot" aria-hidden="true" />
                      <div className="mcp-history__item-body">
                        <span className="mcp-history__tool">{entry.tool}</span>
                        {ts && <span className="mcp-history__time">{ts}</span>}
                        <span className={`mcp-history__badge${ok ? ' mcp-history__badge--ok' : ' mcp-history__badge--err'}`}>
                          {ok ? `${entry.status} OK` : `${entry.status || 'ERR'}`}
                        </span>
                        {entry.duration != null && (
                          <span className="mcp-history__duration">{entry.duration} ms</span>
                        )}
                        {resultText && <p className="mcp-history__result">{resultText}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="app-page-card demo-data-section">
            <h2>How MCP tools work (this demo)</h2>
            <p className="demo-data-hint mcp-inspector__hint-tight">
              Use the education buttons above for deep dives: <strong>MCP protocol</strong>, <strong>token exchange</strong>,
              <strong>introspection</strong>, and <strong>Agent Gateway</strong>. Short version: the Backend-for-Frontend (BFF) holds your session and may
              RFC 8693 exchange before <code>tools/call</code>; the MCP server calls the Banking API with Bearer tokens.
            </p>
          </section>

          {context?.mcpHosts && (
            <section className="app-page-card demo-data-section">
              <h2 className="mcp-inspector__h2-tight">Two MCP hosts — one MCP server — one protected Banking API</h2>
              <p className="demo-data-hint mcp-inspector__hint-mb">
                Demo best practice: show <strong>human</strong> access (Backend-for-Frontend (BFF)) and <strong>agent</strong> access (LangChain) without
                bypassing PingOne, scopes, or MCP.
              </p>
              <div className="mcp-inspector__host-grid">
                <article className="mcp-inspector__host-card mcp-inspector__host-card--bff">
                  <h3>{context.mcpHosts.bff?.title}</h3>
                  <dl className="mcp-inspector__dl">
                    <dt>Audience</dt>
                    <dd>{context.mcpHosts.bff?.audience}</dd>
                    <dt>PingOne / OAuth</dt>
                    <dd>{context.mcpHosts.bff?.pingOneOAuth}</dd>
                    <dt>Token exchange</dt>
                    <dd>{context.mcpHosts.bff?.tokenExchange}</dd>
                    <dt>MCP client</dt>
                    <dd>{context.mcpHosts.bff?.mcpClientTransport}</dd>
                    <dt>Best for the demo</dt>
                    <dd className="mcp-inspector__dd-highlight">{context.mcpHosts.bff?.bestForShowing}</dd>
                  </dl>
                  {context.flow?.length > 0 && (
                    <>
                      <h4 className="mcp-inspector__h4">Backend-for-Frontend (BFF) flow (this inspector)</h4>
                      <ul className="mcp-inspector__flow mcp-inspector__flow--tight">
                        {context.flow.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                      <p className="mcp-inspector__meta">
                        Token exchange here: <strong>{context.tokenExchangeEnabled ? 'enabled' : 'disabled'}</strong> · MCP:{' '}
                        <strong>{context.mcpProtocolVersion}</strong>
                      </p>
                    </>
                  )}
                </article>
                <article className="mcp-inspector__host-card mcp-inspector__host-card--agent">
                  <h3>{context.mcpHosts.langchain?.title}</h3>
                  <dl className="mcp-inspector__dl">
                    <dt>Audience</dt>
                    <dd>{context.mcpHosts.langchain?.audience}</dd>
                    <dt>PingOne / OAuth</dt>
                    <dd>{context.mcpHosts.langchain?.pingOneOAuth}</dd>
                    <dt>Token exchange</dt>
                    <dd>{context.mcpHosts.langchain?.tokenExchange}</dd>
                    <dt>MCP client</dt>
                    <dd>{context.mcpHosts.langchain?.mcpClientTransport}</dd>
                    <dt>Best for the demo</dt>
                    <dd className="mcp-inspector__dd-highlight">{context.mcpHosts.langchain?.bestForShowing}</dd>
                  </dl>
                  <a
                    className="mcp-inspector__btn mcp-inspector__btn--primary mcp-inspector__btn--block"
                    href={langchainInspector}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open LangChain host JSON ({langchainInspector})
                  </a>
                  <p className="mcp-inspector__muted mcp-inspector__hint-tight">
                    This URL is served only by the Python <strong>langchain_agent</strong> process (health HTTP server), not the
                    Banking UI or Backend-for-Frontend (BFF). From repo root: <code>cd langchain_agent && python -m src.main</code> — then wait until
                    startup finishes so the inspector snapshot is populated. If the port differs, set{' '}
                    <code>HEALTH_HTTP_PORT</code> in <code>langchain_agent/.env</code> to override the upstream port the BFF uses. The BFF proxies over HTTPS — the browser never connects directly to port 8081.
                  </p>
                </article>
              </div>
              {context.mcpHosts.shared && (
                <div className="mcp-inspector__shared-strip">
                  <strong>Shared</strong>
                  <p>{context.mcpHosts.shared.mcpServer}</p>
                  <p>{context.mcpHosts.shared.bankingApi}</p>
                </div>
              )}
            </section>
          )}

          <section className="app-page-card demo-data-section">
            <div className="mcp-inspector__row">
              <h2>Live tool catalog</h2>
              <button type="button" className="mcp-inspector__btn" onClick={refreshTools} disabled={loadingTools}>
                {loadingTools ? 'Refreshing…' : 'Refresh tools/list'}
              </button>
            </div>
            <details className="mcp-inspector__request" open={!toolsFrames}>
              <summary className="mcp-inspector__muted">
                {toolsFrames
                  ? 'tools/list request frame (exactly as sent by the BFF over WebSocket)'
                  : 'tools/list request (JSON-RPC sent by the BFF over WebSocket)'}
              </summary>
              <pre className="mcp-inspector__code jh-dark">
                <JsonHighlight value={toolsFrames?.request || { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }} deep />
              </pre>
            </details>
            {toolsFrames?.response && (
              <details className="mcp-inspector__request">
                <summary className="mcp-inspector__muted">tools/list response frame (exactly as received)</summary>
                <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={toolsFrames.response} deep /></pre>
              </details>
            )}
            {toolsSourceInfo?.local && (
              <p className="mcp-inspector__muted mcp-inspector__muted--block">
                Showing the <strong>static</strong> tool catalog — the API server or MCP server is not reachable right now. Start the server with <code>./run-demo.sh</code> and click Refresh. Invoke uses the local in-process handler. For a live <code>tools/list</code> from <code>banking_mcp_server</code>, sign in so the BFF holds a real OAuth token.
                {toolsSourceInfo.reason ? (
                  <>
                    {' '}
                    <span className="mcp-inspector__muted">({toolsSourceInfo.reason})</span>
                  </>
                ) : null}
              </p>
            )}
            {tools.length === 0 && !loadingTools ? (
              <p className="mcp-inspector__muted">No tools returned (is MCP server up?)</p>
            ) : (
              <>
                <div className="p1mcp-tabs" role="tablist">
                  {TABS.map(tab => (
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

                {visibleTools.length === 0 ? (
                  <p className="mcp-inspector__muted">No {activeTab} tools in the catalog.</p>
                ) : (
                  groupByResource(visibleTools).map(([resKey, resTools]) => {
                    const meta = RESOURCE_META[resKey];
                    return (
                      <details
                        className="p1mcp-chip-group"
                        key={resKey}
                        open={!COLLAPSED_RESOURCES.has(resKey)}
                      >
                        <summary className="p1mcp-chip-group__head">
                          <span aria-hidden="true">{meta.icon}</span>
                          {meta.label}
                          <span className="p1mcp-chip-group__count">{resTools.length}</span>
                        </summary>
                        <div className="p1mcp-chips">
                          {resTools.map(t => {
                            const flavor = toolFlavor(t);
                            const badge = FLAVOR_BADGE[flavor];
                            return (
                              <button
                                key={t.name}
                                type="button"
                                className={`p1mcp-chip p1mcp-chip--${flavor} ${selectedTool?.name === t.name ? 'p1mcp-chip--active' : ''}`}
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
                              onChange={e =>
                                setParamValues(prev => ({ ...prev, [key]: e.target.value }))
                              }
                            />
                            <span className="p1mcp-param-type">{schema?.type || ''}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      className="mcp-inspector__btn mcp-inspector__btn--primary"
                      onClick={handleInvoke}
                      disabled={busy}
                      title={`Invoke ${selectedTool.name} via the Backend-for-Frontend (BFF)`}
                    >
                      {busy ? 'Calling…' : `Call ${selectedTool.name}`}
                    </button>
                    {formError && (
                      <div className="p1mcp-call-status p1mcp-call-status--error">{formError}</div>
                    )}
                    {lastTiming && (
                      <div className={`p1mcp-call-status ${lastTiming.error ? 'p1mcp-call-status--error' : ''}`}>
                        {lastTiming.error ? lastTiming.reason : `Completed in ${lastTiming.ms} ms`}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {needsLogin && (
            <section className="app-page-card demo-data-section">
              <h2>Authentication required</h2>
              <p className="mcp-inspector__muted mcp-inspector__muted--block">
                This <code>tools/call</code> needs a signed-in user — the Backend-for-Frontend (BFF) has no valid
                session, so it cannot exchange a token for the MCP server. Log in and run the call again.
              </p>
              <button
                type="button"
                className="mcp-inspector__btn mcp-inspector__btn--primary"
                onClick={navigateToCustomerOAuthLogin}
              >
                Log in
              </button>
            </section>
          )}

          {lastInvoke && (
            <section className="app-page-card demo-data-section">
              <h2>Last result</h2>
              {lastInvoke.error && (
                <p className="mcp-inspector__scopes" style={{ color: '#b91c1c' }}>
                  {lastInvoke.message || lastInvoke.error}
                </p>
              )}
              {lastInvoke._localFallback && (
                <p className="mcp-inspector__muted mcp-inspector__muted--block">
                  Handled by the local in-process handler — the MCP server was unreachable, so no
                  wire frames exist for this call.
                </p>
              )}
              {lastInvoke.frames?.request && (
                <details className="mcp-inspector__request" open>
                  <summary className="mcp-inspector__muted">tools/call request frame (exactly as sent over WebSocket)</summary>
                  <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={lastInvoke.frames.request} deep /></pre>
                </details>
              )}
              {lastInvoke.frames?.response && (
                <details className="mcp-inspector__request" open>
                  <summary className="mcp-inspector__muted">tools/call response frame (exactly as received)</summary>
                  <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={lastInvoke.frames.response} deep /></pre>
                </details>
              )}
              {lastInvoke.tokenEvents?.length > 0 && (
                <details className="mcp-inspector__request">
                  <summary className="mcp-inspector__muted">
                    Token exchange chain ({lastInvoke.tokenEvents.length} events — user token → RFC 8693 exchange → MCP token)
                  </summary>
                  <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={lastInvoke.tokenEvents} deep /></pre>
                </details>
              )}
              <details className="mcp-inspector__request" open={!lastInvoke.frames}>
                <summary className="mcp-inspector__muted">Full response body</summary>
                <pre className="mcp-inspector__pre jh-dark"><JsonHighlight value={lastInvoke} deep /></pre>
              </details>
            </section>
          )}

          <section className="app-page-card demo-data-section app-page-card--muted">
            <h2>LangChain chat (separate from MCP WebSocket)</h2>
            <p className="mcp-inspector__muted mcp-inspector__muted--block">
              User messages go to the agent over the chat WebSocket (typically port {context?.langchain_chat_websocket_port || '…'}).
              The agent then calls MCP tools over its own MCP client connection — same server as the Backend-for-Frontend (BFF), different host process.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default McpInspector;
