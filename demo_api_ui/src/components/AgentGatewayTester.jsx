// AgentGatewayTester.jsx
// InspectorShell three-column layout - sends MCP tool calls through the
// active gateway and shows response, authorize decision, audit trail.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonHighlight from './shared/JsonHighlight';
import JsonFormView from './shared/JsonFormView';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';

const GATEWAY_FLAG = 'ff_mcp_gateway_pinggateway';
const AUTHZ_FLAG = 'ff_authorize_simulated';

const FALLBACK_TOOLS = [
  {
    name: 'get_my_accounts',
    description: 'List all bank accounts with balances and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_transactions',
    description: 'Retrieve transaction history for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_account_balance',
    description: 'Get current balance for a specific account by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
        },
      },
      required: ['account_id'],
    },
  },
  {
    name: 'get_sensitive_account_details',
    description: 'Full account + routing number (sensitive:read + consent).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_transfer',
    description: 'Transfer funds between accounts (write; may require HITL consent).',
    inputSchema: {
      type: 'object',
      properties: {
        from_account_id: {
          type: 'string',
          description: 'Source account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
        },
        to_account_id: {
          type: 'string',
          description: 'Destination account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
        },
        amount: { type: 'number', description: 'Amount to transfer (minimum $0.01)' },
      },
      required: ['from_account_id', 'to_account_id', 'amount'],
    },
  },
];

const ARG_PLACEHOLDER_BY_TYPE = {
  string: '',
  number: 0,
  integer: 0,
  boolean: false,
  array: [],
  object: {},
};

/** Template args for a tool's required inputSchema properties (e.g. {"account_id": ""}); '{}' when none. */
const buildArgsTemplate = (tool) => {
  const required = tool?.inputSchema?.required || [];
  if (!required.length) return '{}';
  const template = {};
  for (const key of required) {
    const propType = tool.inputSchema.properties?.[key]?.type;
    template[key] = propType in ARG_PLACEHOLDER_BY_TYPE ? ARG_PLACEHOLDER_BY_TYPE[propType] : '';
  }
  return JSON.stringify(template, null, 2);
};

const TOOL_GROUPS = {
  Accounts: ['get_my_accounts', 'get_account_balance', 'get_sensitive_account_details'],
  Transactions: ['get_my_transactions'],
  Transfers: ['create_transfer'],
};

const groupKey = (name) => {
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (tools.includes(name)) return group;
  }
  return 'Other';
};

const toolDotClass = (name) => {
  const lower = name.toLowerCase();
  if (lower.includes('sensitive')) return 'inspector-shell-tree-item__dot--sensitive';
  if (lower.startsWith('create') || lower.includes('transfer')) return 'inspector-shell-tree-item__dot--write';
  return '';
};

const PRESETS = [
  { id: 'uc18-throttle', label: 'UC18 throttling (Demo Gateway)' },
  { id: 'real-throttle-ig', label: 'UC18 throttling (Real IG)' },
  { id: 'real-policy', label: 'Real IG policy (simulated authz)' },
];

export default function AgentGatewayTester() {
  const [tools, setTools] = useState(FALLBACK_TOOLS);
  const [toolsSource, setToolsSource] = useState('static');
  const [selectedTool, setSelectedTool] = useState(null);
  const [argsText, setArgsText] = useState('{}');
  const [sending, setSending] = useState(false);
  const [resp, setResp] = useState(null);
  const [rules, setRules] = useState(null);
  const [active, setActive] = useState(null);
  const [toggling, setToggling] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [rateStatus, setRateStatus] = useState(null);
  const [uc18Busy, setUc18Busy] = useState(false);
  const [presetBusy, setPresetBusy] = useState('');
  const [bursting, setBursting] = useState(false);
  const [burstResp, setBurstResp] = useState(null);
  const [toolSearch, setToolSearch] = useState('');
  const [outputTab, setOutputTab] = useState('result');
  const [treeSection, setTreeSection] = useState('tools');

  const fetchActive = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp-gateway/active');
      setActive(data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to load active gateway state'));
    }
  }, []);

  const fetchRateStatus = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp-gateway/rate-limit-status');
      setRateStatus(data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to load rate-limit status'));
    }
  }, []);

  const fetchTools = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/tools');
      const list = data.tools || [];
      if (list.length) {
        setTools(list);
        setToolsSource(data._source || 'live');
      } else {
        setTools(FALLBACK_TOOLS);
        setToolsSource(data.mfa_required ? 'static (live list is MFA-gated)' : 'static');
      }
    } catch {
      setTools(FALLBACK_TOOLS);
      setToolsSource('static (BFF unreachable)');
    }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/authorize/rules');
      setRules(data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to load authorize rules'));
    }
  }, []);

  const fetchMetadata = useCallback(async () => {
    setMetadataLoading(true);
    try {
      const { data } = await apiClient.get('/api/rfc9728/all');
      setMetadata(data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to fetch RFC 9728 metadata'));
    } finally {
      setMetadataLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActive();
    fetchTools();
    fetchRules();
    fetchRateStatus();
  }, [fetchActive, fetchTools, fetchRules, fetchRateStatus]);

  const toggleFlag = useCallback(async (id, current) => {
    setToggling(id);
    try {
      await apiClient.patch('/api/admin/feature-flags', { updates: { [id]: !current } });
      await fetchActive();
      await fetchRules();
      await fetchRateStatus();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to toggle flag'));
    } finally {
      setToggling('');
    }
  }, [fetchActive, fetchRules, fetchRateStatus]);

  const toggleUc18Demo = useCallback(async () => {
    const enable = !(rateStatus?.aligned);
    setUc18Busy(true);
    try {
      await apiClient.post('/api/mcp-gateway/uc18-demo', { enable });
      await fetchRateStatus();
      await fetchActive();
    } catch (e) {
      notifyError(formatAxiosError(e, enable ? 'Failed to enable UC18 demo mode' : 'Failed to disable UC18 demo mode'));
    } finally {
      setUc18Busy(false);
    }
  }, [rateStatus, fetchRateStatus, fetchActive]);

  const runPreset = useCallback(async (preset) => {
    setPresetBusy(preset);
    try {
      const { data } = await apiClient.post('/api/mcp-gateway/demo-presets', { preset });
      await fetchActive();
      await fetchRateStatus();
      await fetchRules();
      if (data.hint) {
        setBurstResp({ summary: data.hint, results: [] });
      } else {
        setBurstResp(null);
      }
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to apply demo preset'));
    } finally {
      setPresetBusy('');
    }
  }, [fetchActive, fetchRateStatus, fetchRules]);

  const send = useCallback(async () => {
    if (!selectedTool) return;
    let args;
    try {
      args = argsText.trim() ? JSON.parse(argsText) : {};
    } catch {
      setResp({ clientError: 'Arguments must be valid JSON.' });
      return;
    }
    setSending(true);
    setResp(null);
    try {
      const { data } = await apiClient.post('/api/mcp-gateway/test', { tool: selectedTool.name, args });
      setResp(data);
      setOutputTab('result');
    } catch (e) {
      setResp({ clientError: formatAxiosError(e, 'Request failed') });
    } finally {
      setSending(false);
    }
  }, [selectedTool, argsText]);

  const runBurst = useCallback(async () => {
    if (!selectedTool) return;
    let args;
    try {
      args = argsText.trim() ? JSON.parse(argsText) : {};
    } catch {
      setBurstResp({ clientError: 'Arguments must be valid JSON.' });
      return;
    }
    setBursting(true);
    setBurstResp(null);
    try {
      const { data } = await apiClient.post('/api/mcp-gateway/test/burst', {
        tool: selectedTool.name,
        args,
        count: 5,
      });
      setBurstResp(data);
    } catch (e) {
      setBurstResp({ clientError: formatAxiosError(e, 'Burst test failed') });
    } finally {
      setBursting(false);
    }
  }, [selectedTool, argsText]);

  const usePing = active?.usePingGateway;
  const simulated = active?.simulated;
  const az = resp?.gwAuditTrail?.authorize || null;
  const mcpAudit = resp?.gwAuditTrail?.mcpAudit || null;
  const decision = resp?.decision || az?.decision || null;
  const isRateLimited = resp?.rateLimited || resp?.error === 'rate_limited' || resp?.httpStatus === 429;
  const resultValue = resp?.result ?? resp?.rpcData ?? (resp ? { error: resp.error, message: resp.message } : null);

  // Tool tree grouping with search
  const groupedTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    const filtered = q
      ? tools.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
      : tools;
    const groups = {};
    for (const t of filtered) {
      const g = groupKey(t.name);
      if (!groups[g]) groups[g] = [];
      groups[g].push(t);
    }
    const order = ['Accounts', 'Transactions', 'Transfers', 'Other'];
    return order.filter(g => groups[g]?.length).map(g => ({ label: g, tools: groups[g] }));
  }, [tools, toolSearch]);

  const selectTool = (t) => {
    setSelectedTool(t);
    setArgsText(buildArgsTemplate(t));
    setResp(null);
    setOutputTab('result');
  };

  const clearForm = () => {
    setArgsText('{}');
    setResp(null);
    setBurstResp(null);
    setOutputTab('result');
  };

  return (
    <InspectorShell
      title="Agent Gateway Tester"
      statusOn={!!active}
      statusText={active ? `${active.name} | Authz: ${active.authzBackend}` : 'Loading...'}
      fullHeight={false}
      actions={
        <>
          <button
            className="inspector-shell-topbar__btn"
            onClick={() => { fetchActive(); fetchTools(); fetchRules(); fetchRateStatus(); }}
          >
            Refresh
          </button>
          <button
            className="inspector-shell-topbar__btn"
            disabled={toggling === GATEWAY_FLAG || !active}
            onClick={() => toggleFlag(GATEWAY_FLAG, usePing)}
          >
            {toggling === GATEWAY_FLAG ? 'Switching...' : `Switch to ${usePing ? 'Demo' : 'PingOne'} GW`}
          </button>
          <button
            className="inspector-shell-topbar__btn"
            disabled={toggling === AUTHZ_FLAG || !active}
            onClick={() => toggleFlag(AUTHZ_FLAG, simulated)}
          >
            {toggling === AUTHZ_FLAG ? 'Switching...' : `Authz: ${simulated ? 'simulated' : 'real'}`}
          </button>
        </>
      }
      left={
        <>
          <div className="inspector-shell-tree-header">
            <span>
              <button
                className={`inspector-shell-topbar__btn ${treeSection === 'tools' ? 'inspector-shell-topbar__btn--active' : ''}`}
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => setTreeSection('tools')}
              >Tools</button>
              {' '}
              <button
                className={`inspector-shell-topbar__btn ${treeSection === 'config' ? 'inspector-shell-topbar__btn--active' : ''}`}
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => setTreeSection('config')}
              >Config</button>
            </span>
          </div>
          {treeSection === 'tools' && (
            <>
              <div className="inspector-shell-tree-search">
                <input
                  type="search"
                  placeholder="Filter tools..."
                  value={toolSearch}
                  onChange={e => setToolSearch(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="inspector-shell-tree-body">
                {groupedTools.map(group => (
                  <div className="inspector-shell-tree-group" key={group.label}>
                    <div className="inspector-shell-tree-group__label">{group.label} ({group.tools.length})</div>
                    {group.tools.map(t => (
                      <div
                        key={t.name}
                        className={`inspector-shell-tree-item ${selectedTool?.name === t.name ? 'inspector-shell-tree-item--active' : ''}`}
                        onClick={() => selectTool(t)}
                      >
                        <span className={`inspector-shell-tree-item__dot ${toolDotClass(t.name)}`} />
                        <span>{t.name}</span>
                        {toolDotClass(t.name).includes('write') && (
                          <span className="inspector-shell-tree-item__badge inspector-shell-tree-item__badge--write">W</span>
                        )}
                        {toolDotClass(t.name).includes('sensitive') && (
                          <span className="inspector-shell-tree-item__badge inspector-shell-tree-item__badge--sensitive">S</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {groupedTools.length === 0 && (
                  <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
                    {tools.length === 0 ? 'No tools loaded.' : `No tools match "${toolSearch}".`}
                  </div>
                )}
                <div style={{ padding: '8px 16px', fontSize: 10, color: '#475569' }}>
                  Source: {toolsSource}
                </div>
              </div>
            </>
          )}
          {treeSection === 'config' && (
            <div className="inspector-shell-tree-body">
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Gateway</div>
                <div className="inspector-shell-tree-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, cursor: 'default' }}>
                  <span style={{ fontSize: 11, color: '#475569' }}>Active: {active?.name || '...'}</span>
                  {active?.url && <code style={{ fontSize: 10, color: '#64748b' }}>{active.url}</code>}
                </div>
              </div>
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Rate Limiting (UC18)</div>
                {rateStatus && (
                  <>
                    <div className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 11 }}>
                      <span className="inspector-shell-tree-item__dot" style={{ background: rateStatus.aligned ? '#22c55e' : '#ef4444' }} />
                      <span>Layer: {rateStatus.rateLimitLayer || 'off'}</span>
                    </div>
                    <div className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 11 }}>
                      <span className="inspector-shell-tree-item__dot" style={{ background: rateStatus.bffFlag ? '#22c55e' : '#64748b' }} />
                      <span>BFF flag: {rateStatus.bffFlag ? 'ON' : 'OFF'}</span>
                    </div>
                    <div className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 11 }}>
                      <span className="inspector-shell-tree-item__dot" style={{ background: rateStatus.aligned ? '#22c55e' : '#f59e0b' }} />
                      <span>Aligned: {rateStatus.aligned ? 'YES' : 'NO'}</span>
                    </div>
                  </>
                )}
                <div
                  className="inspector-shell-tree-item"
                  onClick={toggleUc18Demo}
                  style={{ color: uc18Busy ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#3b82f6' }} />
                  <span>{uc18Busy ? 'Updating...' : (rateStatus?.aligned ? 'Disable UC18' : 'Enable UC18')}</span>
                </div>
                <div
                  className="inspector-shell-tree-item"
                  onClick={() => !bursting && selectedTool && rateStatus?.aligned && runBurst()}
                  style={{ color: (!selectedTool || !rateStatus?.aligned || bursting) ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#f59e0b' }} />
                  <span>{bursting ? 'Running...' : 'Burst test (5 calls)'}</span>
                </div>
              </div>
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">Demo Presets</div>
                {PRESETS.map(p => (
                  <div
                    key={p.id}
                    className="inspector-shell-tree-item"
                    onClick={() => !presetBusy && runPreset(p.id)}
                    style={{ color: presetBusy ? '#475569' : '#3b82f6', fontSize: 11 }}
                  >
                    <span className="inspector-shell-tree-item__dot" style={{ background: '#8b5cf6' }} />
                    <span>{presetBusy === p.id ? 'Applying...' : p.label}</span>
                  </div>
                ))}
              </div>
              <div className="inspector-shell-tree-group">
                <div className="inspector-shell-tree-group__label">RFC 9728 Metadata</div>
                <div
                  className="inspector-shell-tree-item"
                  onClick={() => !metadataLoading && fetchMetadata()}
                  style={{ color: metadataLoading ? '#475569' : '#3b82f6', fontSize: 11 }}
                >
                  <span className="inspector-shell-tree-item__dot" style={{ background: '#06b6d4' }} />
                  <span>{metadataLoading ? 'Fetching...' : 'Fetch live metadata'}</span>
                </div>
                {metadata && Object.entries(metadata).map(([key, data]) => (
                  <div key={key} className="inspector-shell-tree-item" style={{ cursor: 'default', fontSize: 10 }}>
                    <span className="inspector-shell-tree-item__dot" style={{ background: data?._status === 'ok' ? '#22c55e' : '#ef4444' }} />
                    <span>{key}: {data?._status || 'unknown'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      }
      middle={
        selectedTool ? (
          <>
            <div className="inspector-shell-form-header">
              <div className="inspector-shell-form-header__name">{selectedTool.name}</div>
              {selectedTool.description && (
                <div className="inspector-shell-form-header__desc">{selectedTool.description}</div>
              )}
            </div>
            <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
              <button className="inspector-shell-btn-call" onClick={send} disabled={sending}>
                {sending ? 'Sending...' : 'Execute'}
              </button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
            </div>
            <div className="inspector-shell-form-body">
              <div className="inspector-shell-field">
                <label>
                  Arguments (JSON)
                  <span className="type">object</span>
                </label>
                <textarea
                  value={argsText}
                  onChange={e => setArgsText(e.target.value)}
                  placeholder='{}'
                  spellCheck={false}
                  rows={6}
                  style={{ fontFamily: "'SF Mono', monospace" }}
                />
              </div>
              {active && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
                  <div>Gateway: <strong style={{ color: '#334155' }}>{active.name}</strong></div>
                  <div>Authorize: <strong style={{ color: '#334155' }}>{active.authzBackend}</strong></div>
                  {active.url && <div>URL: <code style={{ fontSize: 10 }}>{active.url}</code></div>}
                </div>
              )}
            </div>
            <div className="inspector-shell-form-actions">
              <button className="inspector-shell-btn-call" onClick={send} disabled={sending}>
                {sending ? 'Sending...' : 'Execute'}
              </button>
              <button className="inspector-shell-btn-clear" onClick={clearForm}>Clear</button>
              {rateStatus?.aligned && (
                <button
                  className="inspector-shell-btn-clear"
                  onClick={runBurst}
                  disabled={bursting}
                  style={{ marginLeft: 'auto' }}
                >
                  {bursting ? 'Burst...' : 'Burst x5'}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="inspector-shell-form-empty">
            Select a tool from the tree to send through the Agent Gateway.
          </div>
        )
      }
      right={
        <>
          <InspectorTabs
            tabs={[
              { key: 'result', label: 'Result' },
              { key: 'audit', label: 'Audit Trail' },
              { key: 'authorize', label: 'Authorize Decision' },
              { key: 'mcpAudit', label: 'McpAudit (5W1H)' },
              { key: 'form', label: 'Form' },
            ]}
            activeKey={outputTab}
            onChange={setOutputTab}
          />
          {resp ? (
            <>
              <div className="inspector-shell-output-body">
                <pre className="inspector-shell-output-code">
                  {outputTab === 'result' && <JsonHighlight value={resultValue} />}
                  {outputTab === 'form' && <JsonFormView value={resultValue} />}
                  {outputTab === 'audit' && (
                    <JsonHighlight value={resp.gwAuditTrail || { note: 'No audit trail on this response.' }} />
                  )}
                  {outputTab === 'authorize' && (
                    <>
                      {az ? (
                        <div style={{ padding: '0 0 16px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'SF Mono', monospace" }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>P1AZ Field</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {az.decision && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>Decision</td>
                                  <td style={{ padding: '5px 10px', color: az.decision === 'PERMIT' ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{az.decision}</td>
                                </tr>
                              )}
                              {az.toolName && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>ToolName</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.toolName}</td>
                                </tr>
                              )}
                              {az.clientId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>ClientId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.clientId}</td>
                                </tr>
                              )}
                              {az.actClientId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>ActClientId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.actClientId}</td>
                                </tr>
                              )}
                              {az.userId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>UserId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.userId}</td>
                                </tr>
                              )}
                              {az.scopes && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>Scopes</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{Array.isArray(az.scopes) ? az.scopes.join(', ') : String(az.scopes)}</td>
                                </tr>
                              )}
                              {az.riskLevel && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>RiskLevel</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.riskLevel}</td>
                                </tr>
                              )}
                              {az.policyId && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>PolicyId</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.policyId}</td>
                                </tr>
                              )}
                              {az.reason && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#64748b' }}>Reason</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{az.reason}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div style={{ marginTop: 12, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
                            <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raw JSON</div>
                            <JsonHighlight value={az} />
                          </div>
                        </div>
                      ) : (
                        <JsonHighlight value={{ note: 'No authorize decision on this response.' }} />
                      )}
                    </>
                  )}
                  {outputTab === 'mcpAudit' && (
                    <>
                      {mcpAudit ? (
                        <div style={{ padding: '0 0 16px' }}>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                            <strong style={{ color: '#1e293b' }}>McpAuditFilter 5W1H</strong> - Structured audit event capturing Who, What, When, Where, Why, and How.
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'SF Mono', monospace" }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>5W1H</th>
                                <th style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600 }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {mcpAudit.who && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>Who</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.who === 'object' ? JSON.stringify(mcpAudit.who) : mcpAudit.who}</td>
                                </tr>
                              )}
                              {mcpAudit.what && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>What</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.what === 'object' ? JSON.stringify(mcpAudit.what) : mcpAudit.what}</td>
                                </tr>
                              )}
                              {mcpAudit.when && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>When</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.when === 'object' ? JSON.stringify(mcpAudit.when) : mcpAudit.when}</td>
                                </tr>
                              )}
                              {mcpAudit.where && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>Where</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.where === 'object' ? JSON.stringify(mcpAudit.where) : mcpAudit.where}</td>
                                </tr>
                              )}
                              {mcpAudit.why && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>Why</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.why === 'object' ? JSON.stringify(mcpAudit.why) : mcpAudit.why}</td>
                                </tr>
                              )}
                              {mcpAudit.how && (
                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '5px 10px', color: '#d97706', fontWeight: 600 }}>How</td>
                                  <td style={{ padding: '5px 10px', color: '#1e293b' }}>{typeof mcpAudit.how === 'object' ? JSON.stringify(mcpAudit.how) : mcpAudit.how}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div style={{ marginTop: 12, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
                            <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raw JSON</div>
                            <JsonHighlight value={mcpAudit} />
                          </div>
                        </div>
                      ) : (
                        <JsonHighlight value={{ note: 'No McpAudit event. Ensure McpAuditFilter is active in PingGateway.' }} />
                      )}
                    </>
                  )}
                </pre>
              </div>
              <div className="inspector-shell-output-footer">
                <span>
                  <strong>Status:</strong>{' '}
                  {resp.clientError
                    ? 'Error'
                    : isRateLimited
                      ? '429 Rate Limited'
                      : resp.ok
                        ? '200 OK'
                        : `Error: ${resp.error || 'unknown'}`}
                </span>
                <span><strong>Duration:</strong> {resp.durationMs ?? '?'}ms</span>
                <span><strong>Decision:</strong> {decision || 'N/A'}</span>
                <span><strong>Gateway:</strong> {resp.gateway?.name || active?.name || '?'}</span>
              </div>
            </>
          ) : burstResp ? (
            <>
              <div className="inspector-shell-output-body">
                <pre className="inspector-shell-output-code">
                  <JsonHighlight value={burstResp} />
                </pre>
              </div>
              <div className="inspector-shell-output-footer">
                <span><strong>Burst test:</strong> {burstResp.summary || `${(burstResp.results || []).length} calls`}</span>
              </div>
            </>
          ) : (
            <div className="inspector-shell-output-empty">
              {selectedTool
                ? 'Click Execute to send through the gateway and see results here.'
                : 'Select a tool, then execute it to see results.'}
            </div>
          )}
        </>
      }
    />
  );
}
