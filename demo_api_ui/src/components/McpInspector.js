// demo_api_ui/src/components/McpInspector.js
// Dark IDE three-column layout (Mock B) -- matches PingOneMcpInspector.js pattern.
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
import './PingOneMcpInspector.css';

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

// Tool classification helpers
const isWriteScope = (s) => /write|manage|delete/.test(String(s).toLowerCase());
const isWriteTool = (tool) => (tool.requiredScopes || []).some(isWriteScope);
const isReasoningTool = (tool) => {
  const n = (tool.name || '').toLowerCase();
  return n.includes('think') || n.includes('reason');
};
const isSensitiveTool = (tool) =>
  (tool.requiredScopes || []).some((s) => String(s).toLowerCase().includes('sensitive')) ||
  (tool.name || '').toLowerCase().includes('sensitive');

/** Determine dot color class: green=read, amber=write, red=sensitive */
const toolDotClass = (tool) => {
  if (isSensitiveTool(tool)) return 'p1mcp-tree-item__dot--sensitive';
  if (isWriteTool(tool)) return 'p1mcp-tree-item__dot--write';
  return '';
};

/** Badge for write/sensitive tools in the tree */
const toolBadge = (tool) => {
  if (isSensitiveTool(tool)) return { cls: 'p1mcp-tree-item__badge--sensitive', text: 'S' };
  if (isWriteTool(tool)) return { cls: 'p1mcp-tree-item__badge--write', text: 'W' };
  return null;
};

// Resource grouping logic (from existing code)
const RESOURCE_META = {
  accounts: { label: 'Accounts' },
  transactions: { label: 'Transactions' },
  admin: { label: 'Customer Admin' },
  directory: { label: 'Directory / Users' },
  vertical: { label: 'Vertical Demos' },
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
  return RESOURCE_ORDER.filter((k) => buckets[k]?.length).map((k) => ({
    key: k,
    label: RESOURCE_META[k].label,
    tools: buckets[k],
  }));
};

// Static fallback tools (when BFF is unreachable)
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
 * Generic MCP Inspector: live tools/list + tools/call against a selectable MCP
 * server profile (defaults to this app's own banking MCP server via the BFF
 * MCP Host proxy; see services/mcpProfileStore.js for other profiles).
 * Dark IDE three-column layout matching PingOneMcpInspector.
 */
const McpInspector = ({ user, onLogout }) => {
  const { open } = useEducationUI();
  const [tools, setTools] = useState([]);
  const [toolsSourceInfo, setToolsSourceInfo] = useState(null);
  const [toolsFrames, setToolsFrames] = useState(null);
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

  // Server picker: which MCP server this page is inspecting. Defaults to this
  // app's own banking MCP server (existing behavior, untouched) until the
  // profile list loads; switching profiles re-runs discovery against a
  // different server (mcpTransports/* on the BFF).
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

  // Surface a failed PingOne admin login (routes/mcpPingOneAdminAuth.js redirects
  // back here with ?pingone_admin_error=... on state mismatch / token exchange failure).
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

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const refreshTools = useCallback(async () => {
    setLoadingTools(true);
    setProfileError(null);
    setPingoneAdminLoginUrl(null);
    const isNonDefaultProfile = selectedProfileId && selectedProfileId !== defaultProfileId;
    try {
      const qs = isNonDefaultProfile ? `?profile=${encodeURIComponent(selectedProfileId)}` : '';
      const { data } = await apiClient.get(`/api/mcp/inspector/tools${qs}`);
      setTools(data.tools || []);
      setToolsFrames(data.frames || null);
      setToolsSourceInfo(
        data._source === 'local_catalog'
          ? { local: true, reason: data._localCatalogReason || '' }
          : data._source === 'mcp_server'
            ? { local: false }
            : null,
      );
      setMfaRequired(!!data.mfa_required);
      setStepUpMethod(data.step_up_method || '');
      if (data._source === 'profile_error') {
        setProfileError(data.reason || 'Failed to reach this MCP server.');
      }
      if (data.pingone_admin_login_required) {
        setPingoneAdminLoginUrl(data.loginUrl || '/api/mcp/inspector/pingone-admin/login');
      }
      setSelectedTool(null);
      setLastInvoke(null);
      setLastTiming(null);
      setFormError(null);
      setNeedsLogin(false);
    } catch (e) {
      if (isNonDefaultProfile) {
        setTools([]);
        setToolsFrames(null);
        setToolsSourceInfo(null);
        setProfileError(formatAxiosError(e, 'Failed to reach this MCP server'));
      } else {
        notifyError(formatAxiosError(e, 'BFF unreachable - showing static tool catalog'));
        setTools(STATIC_LOCAL_TOOLS);
        setToolsFrames(null);
        setToolsSourceInfo({ local: true, reason: 'bff_unreachable' });
      }
      setMfaRequired(false);
    } finally {
      setLoadingTools(false);
    }
  }, [selectedProfileId, defaultProfileId]);

  useEffect(() => {
    refreshTools();
  }, [refreshTools]);

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

  // Group tools for the tree sidebar
  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter(
          (t) =>
            (t.name || '').toLowerCase().includes(searchQ) ||
            (t.description || '').toLowerCase().includes(searchQ),
        )
      : tools;
    return groupByResource(filtered);
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
      appendMcpCall(
        selectedTool.name,
        e.response?.status ?? 0,
        ms,
        null,
        formatAxiosError(e, 'Invoke failed'),
      );
      setLastInvoke(e.response?.data?.frames ? e.response.data : null);
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

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  // Determine what to show in the output panel
  const outputContent = useMemo(() => {
    if (!lastInvoke && !lastTiming) return null;
    if (outputTab === 'response') {
      if (lastInvoke?.frames?.response) return lastInvoke.frames.response;
      if (lastInvoke) return lastInvoke;
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

  return (
    <div className="mcp-inspector-page">
      <PageNav user={user} onLogout={onLogout} title="Generic MCP Inspector" />

      <div className="p1mcp-page">
        {/* Top bar */}
        <div className="p1mcp-topbar">
          <span className={`p1mcp-topbar__dot ${isConnected ? '' : 'p1mcp-topbar__dot--off'}`} />
          <h1>Generic MCP Inspector</h1>
          <select
            className="p1mcp-topbar__btn"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            title="MCP server to inspect"
            style={{ marginLeft: 8 }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <span className="p1mcp-topbar__status">
            {isConnected ? `Connected - ${tools.length} tools` : `Local catalog - ${tools.length} tools`}
          </span>
          <div className="p1mcp-topbar__right">
            <button
              className="p1mcp-topbar__btn"
              onClick={() => open(EDU.MCP_PROTOCOL, 'what')}
            >
              What is MCP?
            </button>
            <Link
              className="p1mcp-topbar__btn"
              style={{ textDecoration: 'none' }}
              to="/pingone-mcp-inspector"
              title="PingOne MCP Inspector"
            >
              PingOne Inspector
            </Link>
            <button
              className="p1mcp-topbar__btn"
              onClick={() => setShowAddServer((v) => !v)}
            >
              + Add server
            </button>
            <button
              className="p1mcp-topbar__btn"
              onClick={refreshTools}
              disabled={loadingTools}
            >
              {loadingTools ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

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
            <button className="p1mcp-topbar__btn p1mcp-topbar__btn--active" onClick={handleAddProfile}>
              Save
            </button>
            {addProfileError && <span style={{ color: '#991b1b' }}>{addProfileError}</span>}
          </div>
        )}

        {/* Notices */}
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
              className="p1mcp-topbar__btn p1mcp-topbar__btn--active"
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
        {toolsSourceInfo?.local && (
          <div style={{ background: '#fffbeb', color: '#92400e', padding: '8px 20px', fontSize: 12 }}>
            <strong>Showing static / local catalog.</strong>{' '}
            {toolsSourceInfo.reason ? `(${toolsSourceInfo.reason}) ` : ''}
            Start the stack and sign in so the BFF can reach the banking MCP server, then refresh.
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
            <button
              className="p1mcp-topbar__btn p1mcp-topbar__btn--active"
              onClick={navigateToCustomerOAuthLogin}
            >
              Log in
            </button>
          </div>
        )}

        {/* Three-column grid */}
        <div className="p1mcp-grid p1mcp-grid--with-pagenav">
          {/* Column 1: Tree */}
          <div className="p1mcp-col-tree">
            <div className="p1mcp-tree-header">
              <span>Tools ({tools.length})</span>
            </div>
            <div className="p1mcp-tree-search" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="search"
                placeholder="Filter tools..."
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                spellCheck={false}
                style={{ flex: 1 }}
              />
              <span
                title="Type to filter the tool list by name or description. Matching is case-insensitive and updates as you type."
                style={{
                  cursor: 'help',
                  fontSize: 12,
                  width: 16,
                  height: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: '1px solid currentColor',
                  opacity: 0.6,
                  flexShrink: 0,
                }}
              >
                i
              </span>
            </div>
            <div className="p1mcp-tree-body">
              {groupedTools.map((group) => (
                <div className="p1mcp-tree-group" key={group.key}>
                  <div className="p1mcp-tree-group__label">
                    {group.label} ({group.tools.length})
                  </div>
                  {group.tools.map((t) => {
                    const badge = toolBadge(t);
                    return (
                      <div
                        key={t.name}
                        className={`p1mcp-tree-item ${selectedTool?.name === t.name ? 'p1mcp-tree-item--active' : ''}`}
                        onClick={() => selectTool(t)}
                      >
                        <span className={`p1mcp-tree-item__dot ${toolDotClass(t)}`} />
                        <span>{t.name}</span>
                        {badge && (
                          <span className={`p1mcp-tree-item__badge ${badge.cls}`}>{badge.text}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {groupedTools.length === 0 && (
                <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
                  {tools.length === 0
                    ? 'No tools loaded.'
                    : `No tools match "${toolSearch}".`}
                </div>
              )}
            </div>
            {/* MCP call history in tree footer */}
            {mcpHistory.length > 0 && (
              <div className="p1mcp-tree-footer" style={{ borderTop: '1px solid #cbd5e1', padding: '8px 12px', fontSize: 11, color: '#64748b', maxHeight: 140, overflowY: 'auto' }}>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  History ({mcpHistory.length})
                </div>
                {mcpHistory.slice(-10).reverse().map((entry) => {
                  const ok = entry.status >= 200 && entry.status < 300;
                  return (
                    <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
                      <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: 11 }}>{entry.tool}</span>
                      {entry.duration != null && (
                        <span style={{ marginLeft: 'auto', color: '#64748b' }}>{entry.duration}ms</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Column 2: Form */}
          <div className="p1mcp-col-form">
            {selectedTool ? (
              <>
                <div className="p1mcp-form-header">
                  <div className="p1mcp-form-header__name">{selectedTool.name}</div>
                  {selectedTool.description && (
                    <div className="p1mcp-form-header__desc">{selectedTool.description}</div>
                  )}
                  {selectedTool.requiredScopes?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, fontFamily: 'monospace' }}>
                      Scopes: {selectedTool.requiredScopes.join(', ')}
                    </div>
                  )}
                </div>
                <div className="p1mcp-form-actions p1mcp-form-actions--top">
                <button className="p1mcp-btn-call" onClick={handleInvoke} disabled={busy}>
                  {busy ? 'Calling...' : 'Execute'}
                </button>
                <button className="p1mcp-btn-clear" onClick={clearForm}>Clear</button>
              </div>
              <div className="p1mcp-form-body">
                  {Object.entries(schemaProps).map(([key, schema]) => (
                    <div className="p1mcp-field" key={key}>
                      <label>
                        {key}
                        {requiredParams.has(key) && <span className="req"> *</span>}
                        <span className="type">{schema?.type || ''}</span>
                      </label>
                      <input
                        type="text"
                        placeholder={schema?.description || schema?.type || 'value'}
                        value={paramValues[key] ?? ''}
                        onChange={(e) =>
                          setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                  {Object.keys(schemaProps).length === 0 && (
                    <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
                  )}
                </div>
                <div className="p1mcp-form-actions">
                  <button className="p1mcp-btn-call" onClick={handleInvoke} disabled={busy}>
                    {busy ? 'Calling...' : 'Execute'}
                  </button>
                  <button className="p1mcp-btn-clear" onClick={clearForm}>Clear</button>
                  {formError && <span className="p1mcp-form-error">{formError}</span>}
                </div>
              </>
            ) : (
              <div className="p1mcp-form-empty">
                Select a tool from the tree to inspect and invoke it.
              </div>
            )}
          </div>

          {/* Column 3: Output */}
          <div className="p1mcp-col-output">
            <div className="p1mcp-output-tabs">
              <button
                className={`p1mcp-output-tab ${outputTab === 'response' ? 'p1mcp-output-tab--active' : ''}`}
                onClick={() => setOutputTab('response')}
              >Response</button>
              <button
                className={`p1mcp-output-tab ${outputTab === 'request' ? 'p1mcp-output-tab--active' : ''}`}
                onClick={() => setOutputTab('request')}
              >Request JSON-RPC</button>
              <button
                className={`p1mcp-output-tab ${outputTab === 'history' ? 'p1mcp-output-tab--active' : ''}`}
                onClick={() => setOutputTab('history')}
              >History ({mcpHistory.length})</button>
            </div>
            {outputContent ? (
              <>
                <div className="p1mcp-output-body">
                  <pre className="p1mcp-output-code">
                    <JsonHighlight value={outputContent} deep />
                  </pre>
                </div>
                <div className="p1mcp-output-footer">
                  <span>
                    <strong>Status:</strong>{' '}
                    {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}
                  </span>
                  <span>
                    <strong>Duration:</strong>{' '}
                    {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}
                  </span>
                  <span>
                    <strong>Transport:</strong> WebSocket JSON-RPC
                  </span>
                </div>
              </>
            ) : (
              <div className="p1mcp-output-empty">
                {selectedTool
                  ? 'Click Execute to call the tool and see the response here.'
                  : 'Select a tool and execute it to see results.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpInspector;
