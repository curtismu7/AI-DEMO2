// banking_api_ui/src/components/McpTrafficPage.js
/**
 * MCP Tool Tester — unified MCP inspection and invocation page.
 *
 * Combines the best of:
 *   WebMcpPanel   → smart param builders, SSE discovery phases, pipeline events, gate notices
 *   McpInspector  → session call history (mcpCallStore)
 *
 * Real-time token chain traffic lives in TokenChainTraceRail — that is intentionally
 * separate and is NOT touched here.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listMcpToolsWithStream,
  callMcpTool,
  openMcpToolStream,
} from '../services/webMcpClient';
import {
  getCalls,
  subscribe as subscribeMcpCalls,
  appendMcpCall,
} from '../services/mcpCallStore';
import {
  ACCOUNT_ID_KEYS,
  DESCRIPTION_SUGGESTIONS,
  QUERY_SUGGESTIONS,
} from '../constants/mcpFieldKeys';
import AdminTokenNotice from './AdminTokenNotice';
import McpParamSelect from './McpParamSelect';
import McpParamToggle from './McpParamToggle';
import McpParamSuggest from './McpParamSuggest';
import McpParamText from './McpParamText';

const uuid = () =>
  (typeof window !== 'undefined' && window.crypto?.randomUUID?.()) ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const HITL_TOOLS = new Set(['create_deposit', 'create_withdrawal', 'create_transfer']);
const STEPUP_TOOLS = new Set(['get_sensitive_account_details']);

const PHASE_ICON = { active: '○', success: '●', error: '✕' };
const PHASE_COLOR = { active: '#3b82f6', success: '#16a34a', error: '#dc2626' };

function GateNotice({ kind, children }) {
  const isHitl = kind === 'hitl';
  return (
    <div style={{
      display: 'flex', gap: '10px', padding: '10px 14px', borderRadius: '8px',
      marginBottom: '12px',
      border: `1px solid ${isHitl ? '#fde68a' : '#c7d2fe'}`,
      background: isHitl ? '#fffbeb' : '#eef2ff',
    }}>
      <span>⚠️</span>
      <p style={{ margin: 0, fontSize: '0.82rem', color: isHitl ? '#92400e' : '#3730a3', lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  );
}

function interpretResult(result) {
  if (!result) return null;
  if (result.error === 'hitl_required' || result.hitl)
    return {
      kind: 'hitl',
      msg: 'Human-in-the-Loop consent required. Use the AI agent on the dashboard to complete this action through the consent screen.',
    };
  if (result.error === 'step_up_required' || result.step_up_required)
    return {
      kind: 'stepup',
      msg: 'Step-up MFA verification required. Complete a step-up challenge via the AI agent on the dashboard first.',
    };
  if (result.success === true || result.result?.success === true)
    return { kind: 'success' };
  if (result.error)
    return { kind: 'error', msg: result.message || result.error };
  return null;
}

function extractAccountOptions(toolName, result) {
  try {
    const raw = result?.text ?? result?.result?.text ?? null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (toolName === 'get_my_accounts') {
      const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
      if (!Array.isArray(accounts)) return null;
      return accounts.map((a) => ({
        value: a.id,
        label: `${a.accountType ? a.accountType.charAt(0).toUpperCase() + a.accountType.slice(1) : 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
      }));
    }
  } catch { /* silent */ }
  return null;
}

/**
 * @param {{ embedded?: boolean }} [props]
 * `embedded` — rendered inside Agent Gateway Inspector (definite-height host).
 */
export default function McpTrafficPage({ embedded = false } = {}) {
  const [tools, setTools] = useState([]);
  const [discoveryPhases, setDiscoveryPhases] = useState([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsError, setToolsError] = useState(null);

  const [selectedTool, setSelectedTool] = useState(null);
  const [params, setParams] = useState({});
  const [calling, setCalling] = useState(false);
  const [streamEvents, setStreamEvents] = useState([]);
  const [result, setResult] = useState(null);
  const [callError, setCallError] = useState(null);

  const [accountOptions, setAccountOptions] = useState([]);
  const [accountsRestricted, setAccountsRestricted] = useState(false);
  const [mcpHistory, setMcpHistory] = useState(getCalls);

  const accountsFetched = useRef(false);
  const disconnectRef = useRef(null);
  const streamLogRef = useRef(null);

  useEffect(() => subscribeMcpCalls(setMcpHistory), []);


  useEffect(() => () => { if (disconnectRef.current) disconnectRef.current(); }, []);

  // Load tools on mount using SSE to show discovery progress
  useEffect(() => {
    setLoadingTools(true);
    setDiscoveryPhases([]);
    const traceId = uuid();
    const controller = new AbortController();
    let cancelled = false;

    const onPhase = (phase) => {
      if (cancelled) return;
      setDiscoveryPhases((prev) => {
        const next = [...prev];
        const idx = next.findIndex((p) => p.phase === phase.phase);
        if (idx >= 0) next[idx] = phase;
        else next.push(phase);
        return next;
      });
    };

    listMcpToolsWithStream(traceId, onPhase, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setTools(data.tools || []);
        // Same MFA gate as /pingone-mcp-inspector — empty tools with no banner looks "blank".
        if (data?.mfa_required) {
          const method = data.step_up_method ? ` (${data.step_up_method})` : '';
          setToolsError(
            `Step-up verification required${method} before MCP tools can be listed. Complete step-up via the AI agent, then reopen this tab.`,
          );
        } else {
          setToolsError(null);
        }
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return;
        setToolsError('Could not load MCP tools — check that the MCP server is running.');
      })
      .finally(() => { if (!cancelled) setLoadingTools(false); });

    return () => { cancelled = true; controller.abort(); };
  }, []);

  const ensureAccountOptions = useCallback(async () => {
    if (accountsFetched.current) return;
    accountsFetched.current = true;
    try {
      const res = await fetch(`${process.env.REACT_APP_API_BASE || ''}/api/accounts/my`, {
        credentials: 'include',
      });
      if (res.status === 403) { setAccountsRestricted(true); return; }
      if (!res.ok) return;
      const data = await res.json();
      const accounts = data.accounts || data || [];
      setAccountOptions(
        accounts.map((a) => ({
          value: a.id,
          label: `${a.accountType ? a.accountType.charAt(0).toUpperCase() + a.accountType.slice(1) : 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
        }))
      );
    } catch { /* best-effort */ }
  }, []);

  const selectTool = useCallback((tool) => {
    setSelectedTool(tool);
    setParams({});
    setResult(null);
    setStreamEvents([]);
    setCallError(null);
    const hasAccountParam = Object.keys(tool?.inputSchema?.properties || {}).some((k) =>
      ACCOUNT_ID_KEYS.has(k)
    );
    if (hasAccountParam) ensureAccountOptions();
  }, [ensureAccountOptions]);

  const handleParamChange = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const callTool = useCallback(async () => {
    if (!selectedTool) return;
    setCalling(true);
    setResult(null);
    setStreamEvents([]);
    setCallError(null);

    const traceId = uuid();
    if (disconnectRef.current) disconnectRef.current();
    disconnectRef.current = openMcpToolStream(traceId, (data) => {
      setStreamEvents((prev) => [...prev, { key: `${traceId}-${prev.length}`, data }]);
      requestAnimationFrame(() => {
        if (streamLogRef.current)
          streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
      });
    });

    const t0 = Date.now();
    try {
      const res = await callMcpTool(selectedTool.name, params, traceId);
      setResult(res);
      appendMcpCall(selectedTool.name, 200, Date.now() - t0, res);
      const extracted = extractAccountOptions(selectedTool.name, res);
      if (extracted) { setAccountOptions(extracted); accountsFetched.current = true; }
    } catch (err) {
      const msg = err.message || 'Tool call failed';
      setCallError(msg);
      appendMcpCall(selectedTool.name, err.status ?? 0, Date.now() - t0, null, msg);
    } finally {
      setCalling(false);
    }
  }, [selectedTool, params]);

  const getDropdownOptions = (key) => {
    if (key === 'account_id' || key === 'from_account_id') return accountOptions;
    if (key === 'to_account_id')
      return accountOptions.filter((o) => !params.from_account_id || o.value !== params.from_account_id);
    if (key === 'account_type')
      return [
        { value: 'checking', label: 'Checking' },
        { value: 'savings', label: 'Savings' },
        { value: 'loan', label: 'Loan' },
        { value: 'credit', label: 'Credit' },
      ];
    if (key === 'limit')
      return [
        { value: '5', label: '5' }, { value: '10', label: '10' },
        { value: '20', label: '20' }, { value: '50', label: '50' },
      ];
    return null;
  };

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredFields = selectedTool?.inputSchema?.required || [];
  const descSuggestions = DESCRIPTION_SUGGESTIONS[selectedTool?.name] || [];
  const toolResult = result?.result ?? result;
  const interpretation = interpretResult(toolResult);

  return (
    <div
      data-testid="mcp-traffic-page"
      data-embedded={embedded ? 'true' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        // Standalone route has no definite parent height; embedded host supplies one.
        minHeight: embedded ? 0 : '400px',
        overflowY: 'auto',
      }}
    >

      {/* Page header — omit title when embedded (tab label is already "MCP Tool Tester") */}
      <div style={{ padding: embedded ? '8px 24px 12px' : '16px 24px 12px', borderBottom: '1px solid var(--border-light,#e2e8f0)', flexShrink: 0 }}>
        {!embedded && (
          <h1 style={{ margin: '0 0 4px', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary,#1e293b)' }}>
            MCP Tool Tester
          </h1>
        )}
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted,#64748b)' }}>
          Discover and invoke MCP tools directly through the BFF pipeline — no agent required.
          Real-time token chain traffic lives in the Token Chain panel.
        </p>
      </div>

      {accountsRestricted && <AdminTokenNotice />}

      {/* Discovery loading state */}
      {loadingTools && (
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border-light,#e2e8f0)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: discoveryPhases.length > 0 ? '12px' : 0 }}>
            <span style={{
              display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
              border: '2px solid #3b82f6', borderTopColor: 'transparent',
              animation: 'mtp-spin 0.8s linear infinite', flexShrink: 0,
            }} />
            <span style={{ fontSize: '0.85rem', color: '#374151' }}>
              Connecting — verifying token, opening WebSocket to MCP server…
            </span>
          </div>
          {discoveryPhases.length > 0 && (
            <ol style={{ margin: 0, padding: '0 0 0 4px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {discoveryPhases.map((p) => (
                <li key={p.phase} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: '0.8rem', fontWeight: 700, minWidth: '12px', marginTop: '1px',
                    color: PHASE_COLOR[p.status] || PHASE_COLOR.active,
                  }}>
                    {PHASE_ICON[p.status] || PHASE_ICON.active}
                  </span>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>{p.label}</div>
                    {p.technical && (
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'inherit' }}>{p.technical}</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Error loading tools */}
      {!loadingTools && toolsError && (
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-light,#e2e8f0)', flexShrink: 0 }}>
          {discoveryPhases.length > 0 && (
            <ol style={{ margin: '0 0 10px', padding: '0 0 0 4px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {discoveryPhases.map((p) => (
                <li key={p.phase} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: PHASE_COLOR[p.status] || PHASE_COLOR.active }}>
                    {PHASE_ICON[p.status] || PHASE_ICON.active}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: '#1e293b' }}>{p.label}</span>
                </li>
              ))}
            </ol>
          )}
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fee2e2', color: '#991b1b', fontSize: '0.85rem' }}>
            ⚠️ {toolsError}
          </div>
        </div>
      )}

      {/* Idle empty — avoid a blank panel when discovery returns no tools */}
      {!loadingTools && !toolsError && tools.length === 0 && (
        <div style={{ padding: '24px', fontSize: '0.9rem', color: '#64748b' }}>
          No MCP tools loaded. Confirm the MCP server is running, then refresh this tab.
        </div>
      )}

      {/* Two-panel main area — only shown once tools are loaded */}
      {tools.length > 0 && (
        <div style={{ display: 'flex', flex: 1, minHeight: embedded ? 0 : 420, overflow: 'hidden' }}>

          {/* Left panel: tool list + history */}
          <div style={{
            width: '260px', flexShrink: 0,
            borderRight: '1px solid var(--border-light,#e2e8f0)',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>

            {/* Tool list */}
            <div style={{ padding: '12px 10px', borderBottom: '1px solid var(--border-light,#e2e8f0)' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: '8px', padding: '0 2px' }}>
                Available Tools ({tools.length})
              </div>
              {tools.map((tool) => {
                const isHitl = HITL_TOOLS.has(tool.name);
                const isStepUp = STEPUP_TOOLS.has(tool.name);
                const isSelected = selectedTool?.name === tool.name;
                return (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => selectTool(tool)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                      borderRadius: '6px', border: isSelected ? '1px solid #93c5fd' : '1px solid transparent',
                      cursor: 'pointer', marginBottom: '3px',
                      background: isSelected ? '#eff6ff' : 'transparent',
                    }}
                  >
                    <div style={{
                      fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
                      color: isSelected ? '#1d4ed8' : '#1e293b',
                    }}>{tool.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', lineHeight: 1.3 }}>
                      {tool.description?.length > 70 ? `${tool.description.slice(0, 70)}…` : tool.description}
                    </div>
                    {isHitl && (
                      <span style={{
                        display: 'inline-block', marginTop: '4px', padding: '1px 6px', borderRadius: '4px',
                        fontSize: '0.63rem', fontWeight: 700,
                        background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a',
                      }}>Requires consent</span>
                    )}
                    {isStepUp && (
                      <span style={{
                        display: 'inline-block', marginTop: '4px', padding: '1px 6px', borderRadius: '4px',
                        fontSize: '0.63rem', fontWeight: 700,
                        background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe',
                      }}>Requires step-up</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Session call history */}
            <div style={{ padding: '12px 10px', flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: '8px', padding: '0 2px' }}>
                History ({mcpHistory.length})
              </div>
              {mcpHistory.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.77rem', color: '#94a3b8', lineHeight: 1.4, padding: '0 2px' }}>
                  No calls yet this session.
                </p>
              ) : (
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {[...mcpHistory].reverse().map((entry) => {
                    const ok = entry.status >= 200 && entry.status < 300;
                    const ts = entry.timestamp
                      ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '';
                    return (
                      <li key={entry.id} style={{
                        padding: '6px 8px', borderRadius: '5px',
                        background: ok ? '#f0fdf4' : '#fef2f2',
                        border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
                        display: 'flex', gap: '7px', alignItems: 'flex-start',
                      }}>
                        <span style={{ fontSize: '0.7rem', color: ok ? '#16a34a' : '#dc2626', flexShrink: 0, marginTop: '1px' }}>
                          {ok ? '✅' : '❌'}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '0.77rem', fontWeight: 600, color: '#1e293b', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.tool}
                          </div>
                          <div style={{ fontSize: '0.69rem', color: '#64748b' }}>
                            {ts}{entry.duration != null ? ` · ${entry.duration}ms` : ''}
                          </div>
                          {entry.errorMsg && (
                            <div style={{ fontSize: '0.69rem', color: '#dc2626', marginTop: '2px', wordBreak: 'break-word' }}>
                              {entry.errorMsg}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

          {/* Right panel: form + result */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {!selectedTool ? (
              <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '1.8rem', marginBottom: '12px', opacity: 0.5 }}>←</div>
                <div style={{ fontSize: '0.88rem', color: '#64748b' }}>
                  Select a tool to inspect its schema, fill in parameters, and call it live through the MCP pipeline.
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '2px', fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', fontFamily: 'inherit' }}>
                  {selectedTool.name}
                </div>
                <div style={{ marginBottom: '16px', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
                  {selectedTool.description}
                </div>

                {HITL_TOOLS.has(selectedTool.name) && (
                  <GateNotice kind="hitl">
                    {selectedTool.name === 'create_transfer'
                      ? 'Transfers always require explicit human approval — the MCP server enforces this regardless of amount.'
                      : 'Deposits and withdrawals above the configured threshold require human approval.'}
                    {' '}You can still call this tool here to see exactly what the server returns.
                  </GateNotice>
                )}
                {STEPUP_TOOLS.has(selectedTool.name) && (
                  <GateNotice kind="stepup">
                    This tool requires elevated authentication. Complete a step-up challenge via the AI agent on the dashboard first.
                    You can still call it here to see the server response.
                  </GateNotice>
                )}

                {/* Parameters */}
                {Object.keys(schemaProps).length > 0 && (
                  <div style={{
                    marginBottom: '16px', padding: '14px 16px', background: '#f8fafc',
                    borderRadius: '8px', border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '12px' }}>
                      Parameters
                    </div>
                    {Object.entries(schemaProps).map(([key, schema]) => {
                      const isRequired = requiredFields.includes(key);
                      const hint = schema.description || '';
                      const dropdownOptions = getDropdownOptions(key);
                      const isToggle = key === 'freeze' || key === 'confirm' || schema.type === 'boolean';
                      const isSuggest = key === 'description' && descSuggestions.length > 0;
                      const isQuery = key === 'query';

                      if (isToggle)
                        return <McpParamToggle key={key} paramKey={key} label={key} value={params[key] || ''} onChange={(v) => handleParamChange(key, v)} hint={hint} />;
                      if (dropdownOptions)
                        return <McpParamSelect key={key} paramKey={key} label={key} options={dropdownOptions} value={params[key] || ''} onChange={(v) => handleParamChange(key, v)} required={isRequired} hint={hint} />;
                      if (isSuggest)
                        return <McpParamSuggest key={key} paramKey={key} label={key} suggestions={descSuggestions} value={params[key] || ''} onChange={(v) => handleParamChange(key, v)} placeholder={schema.type || ''} hint={hint} />;
                      if (isQuery)
                        return <McpParamSuggest key={key} paramKey={key} label={key} suggestions={QUERY_SUGGESTIONS} value={params[key] || ''} onChange={(v) => handleParamChange(key, v)} placeholder={schema.type || ''} hint={hint} />;

                      const isDate = schema.format === 'date' || (schema.type === 'string' && /date$/i.test(key));
                      const isNumber = schema.type === 'number' || schema.type === 'integer';
                      return (
                        <McpParamText
                          key={key} paramKey={key} label={key}
                          value={params[key] || ''} onChange={(v) => handleParamChange(key, v)}
                          placeholder={schema.type || ''} hint={hint} required={isRequired}
                          inputType={isDate ? 'date' : isNumber ? 'number' : 'text'}
                          step={schema.type === 'integer' ? '1' : isNumber ? 'any' : undefined}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Call button */}
                <button
                  type="button"
                  onClick={callTool}
                  disabled={calling}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '9px 22px', borderRadius: '6px', border: 'none',
                    background: calling ? '#93c5fd' : '#3b82f6', color: '#fff',
                    fontWeight: 700, fontSize: '0.88rem', cursor: calling ? 'wait' : 'pointer',
                    marginBottom: '16px',
                  }}
                >
                  {calling && (
                    <span style={{
                      display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                      animation: 'mtp-spin 0.8s linear infinite',
                    }} />
                  )}
                  {calling ? 'Calling…' : 'Call Tool'}
                </button>

                {/* Pipeline events */}
                {streamEvents.length > 0 && (
                  <div ref={streamLogRef} style={{
                    marginBottom: '16px', padding: '10px 12px', borderRadius: '6px',
                    background: '#f8fafc', border: '1px solid #e2e8f0',
                    maxHeight: '180px', overflowY: 'auto',
                  }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '8px' }}>
                      Pipeline Events
                    </div>
                    {streamEvents.map((item) => (
                      <pre key={item.key} style={{
                        margin: '0 0 4px', padding: '4px 8px', borderRadius: '4px',
                        background: '#fff', border: '1px solid #e2e8f0',
                        fontSize: '0.72rem', color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>{JSON.stringify(item.data, null, 2)}</pre>
                    ))}
                  </div>
                )}

                {/* Result */}
                {result && (
                  <div>
                    {interpretation && (
                      interpretation.kind === 'success' ? (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '10px 14px', borderRadius: '6px',
                          background: '#f0fdf4', border: '1px solid #bbf7d0',
                          marginBottom: '10px', fontSize: '0.85rem', color: '#15803d', fontWeight: 600,
                        }}>
                          ✅ Tool executed successfully
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex', gap: '10px', padding: '10px 14px', borderRadius: '6px',
                          marginBottom: '10px',
                          background: interpretation.kind === 'error' ? '#fef2f2' : '#fffbeb',
                          border: `1px solid ${interpretation.kind === 'error' ? '#fecaca' : '#fde68a'}`,
                        }}>
                          <span>{interpretation.kind === 'error' ? '❌' : '⚠️'}</span>
                          <p style={{
                            margin: 0, fontSize: '0.82rem', lineHeight: 1.5,
                            color: interpretation.kind === 'error' ? '#991b1b' : '#92400e',
                          }}>{interpretation.msg}</p>
                        </div>
                      )
                    )}
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '6px' }}>
                      Server Response
                    </div>
                    <pre style={{
                      margin: 0, padding: '12px', borderRadius: '6px',
                      background: '#f8fafc', border: '1px solid #e2e8f0',
                      fontSize: '0.78rem', lineHeight: 1.6, color: '#1e293b',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: '420px', overflowY: 'auto',
                    }}>{JSON.stringify(result, null, 2)}</pre>
                  </div>
                )}

                {/* Call error */}
                {callError && !result && (
                  <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', fontSize: '0.85rem', color: '#991b1b' }}>
                    ❌ {callError}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <style>{'@keyframes mtp-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
