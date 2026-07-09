// AgentGatewayTester.jsx
//
// Setup -> "Gateway Tester" tab. Sends a single MCP tool call THROUGH the active
// gateway (Demo Agent Gateway or PingOne Agent Gateway, per ff_mcp_gateway_pinggateway)
// and shows the response, the gateway's authorize DECISION (PERMIT/DENY + reason) and
// audit trail, and the authorization RULES the gateway is applying. Lets you flip the
// active gateway and the authorize backend (simulated vs real) inline.
//
// Backend: GET /api/mcp-gateway/active, POST /api/mcp-gateway/test,
// GET /api/mcp/inspector/tools, GET /api/authorize/rules, PATCH /api/admin/feature-flags.

import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonHighlight from './shared/JsonHighlight';
import './McpGatewayConfig.css';

const GATEWAY_FLAG = 'ff_mcp_gateway_pinggateway';
const AUTHZ_FLAG = 'ff_authorize_simulated';
const MCP_SECURITY_GATEWAY_DOC =
  'https://docs.pingidentity.com/pinggateway/2026/mcp/index.html';

// Fallback when the live tools/list is gated (MFA step-up) or empty — the tool call
// itself mints the delegated token server-side, so these still work.
const FALLBACK_TOOLS = [
  { name: 'get_my_accounts', description: 'List all bank accounts with balances and status.' },
  { name: 'get_my_transactions', description: 'Retrieve transaction history for the authenticated user.' },
  { name: 'get_account_balance', description: 'Get current balance for a specific account by ID.' },
  { name: 'get_sensitive_account_details', description: 'Full account + routing number (sensitive:read + consent).' },
  { name: 'create_transfer', description: 'Transfer funds between accounts (write; may require HITL consent).' },
];

// Curated, human-ordered subset of the P1AZ decision `parameters` block to show
// in the inspector table. The full set stays in the raw audit-trail JSON below.
const P1AZ_ATTR_ROWS = [
  ['DecisionContext', 'Decision context'],
  ['ToolName', 'Tool'],
  ['ClientId', 'Subject (user)'],
  ['ActClientId', 'Acting agent'],
  ['ActChainDepth', 'Delegation depth'],
  ['TokenScopes', 'Token scopes'],
  ['TokenAudience', 'Resource audience'],
  ['TransactionAmount', 'Amount'],
  ['TransactionType', 'Transaction type'],
];

const METADATA_LABELS = {
  bff: 'BFF (API server)',
  mcp_olb: 'MCP OLB Server',
  mcp_gw: 'Demo Agent Gateway',
  mcp_invest: 'MCP Invest',
};

/** Render key RFC 9728 fields for one service in the metadata panel. */
function MetadataServiceRow({ serviceKey, data }) {
  const label = METADATA_LABELS[serviceKey] || serviceKey;
  const status = data?._status || 'unreachable';
  if (status !== 'ok') {
    return (
      <tr>
        <td className="mgc-env-key">{label}</td>
        <td className="mgc-env-val">
          <span className="mgc-badge mgc-badge--error">{status}</span>
          {data?._error ? ` — ${data._error}` : ''}
        </td>
      </tr>
    );
  }
  const resource = data.resource || '(missing)';
  const asList = Array.isArray(data.authorization_servers)
    ? data.authorization_servers.join(', ')
    : '(none)';
  return (
    <tr>
      <td className="mgc-env-key">{label}</td>
      <td className="mgc-env-val">
        <div><strong>resource:</strong> <code>{resource}</code></div>
        <div style={{ marginTop: 4 }}><strong>authorization_servers:</strong> <code>{asList}</code></div>
      </td>
    </tr>
  );
}

export default function AgentGatewayTester() {
  const [tools, setTools] = useState(FALLBACK_TOOLS);
  const [toolsSource, setToolsSource] = useState('static');
  const [tool, setTool] = useState(FALLBACK_TOOLS[0].name);
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
        if (!list.find((t) => t.name === tool)) setTool(list[0].name);
      } else {
        setTools(FALLBACK_TOOLS);
        setToolsSource(data.mfa_required ? 'static (live list is MFA-gated)' : 'static');
      }
    } catch {
      setTools(FALLBACK_TOOLS);
      setToolsSource('static (BFF unreachable)');
    }
  }, [tool]);

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
      const { data } = await apiClient.post('/api/mcp-gateway/test', { tool, args });
      setResp(data);
    } catch (e) {
      setResp({ clientError: formatAxiosError(e, 'Request failed') });
    } finally {
      setSending(false);
    }
  }, [tool, argsText]);

  const runBurst = useCallback(async () => {
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
        tool,
        args,
        count: 5,
      });
      setBurstResp(data);
    } catch (e) {
      setBurstResp({ clientError: formatAxiosError(e, 'Burst test failed') });
    } finally {
      setBursting(false);
    }
  }, [tool, argsText]);

  const usePing = active?.usePingGateway;
  const simulated = active?.simulated;
  const az = resp?.gwAuditTrail?.authorize || null;
  const mcpAudit = resp?.gwAuditTrail?.mcpAudit || null;
  const decision = resp?.decision || az?.decision || null;
  const isRateLimited = resp?.rateLimited || resp?.error === 'rate_limited' || resp?.httpStatus === 429;
  const resultValue = resp?.result ?? resp?.rpcData ?? (resp ? { error: resp.error, message: resp.message } : null);
  const mcpWhenLabel = mcpAudit?.when
    ? new Date(typeof mcpAudit.when === 'number' ? mcpAudit.when : Number(mcpAudit.when)).toISOString()
    : null;

  return (
    <div className="mgc-root">
      <div className="mgc-header">
        <div>
          <h2 className="mgc-title">Agent Gateway Tester</h2>
          <p className="mgc-subtitle">
            Send an MCP tool call through the active gateway and inspect protected-resource
            metadata (RFC 9728), rate limiting (UC18), authorize decisions, and audit trails.
          </p>
          <p className="mgc-subtitle" style={{ marginTop: 6 }}>
            Official Ping docs:{' '}
            <a href={MCP_SECURITY_GATEWAY_DOC} target="_blank" rel="noopener noreferrer">
              MCP security gateway | PingGateway 2026
            </a>
            {' '}— audit MCP requests and actors, throttle, OAuth RS controls, fine-grained
            Authorize, and token transformation.
          </p>
        </div>
      </div>

      {/* What McpAuditFilter records — visible before any request so demos can point at it */}
      <div className="mgc-section">
        <h4 style={{ marginTop: 0 }}>McpAuditFilter — who / what / when / where / how</h4>
        <p className="mgc-field-hint">
          Real PingOne Agent Gateway runs <code>McpAuditFilter</code> on every MCP route. It emits
          MCP-specific audit events for <em>who called which tool, where, and with what result</em>,
          writes them to <code>audit/mcp.audit.json</code>, and mirrors the same payload on{' '}
          <code>X-Gw-Audit-Trail.mcpAudit</code> (shown below after you send a request; also on Token Chain).
        </p>
        <table className="mgc-env-table">
          <tbody>
            <tr><td className="mgc-env-key">Who</td><td className="mgc-env-val">User <code>sub</code> + acting agent (<code>act.sub</code> / client) and delegation depth</td></tr>
            <tr><td className="mgc-env-key">What</td><td className="mgc-env-val">MCP method (e.g. <code>tools/call</code>) and tool name</td></tr>
            <tr><td className="mgc-env-key">When</td><td className="mgc-env-val">Event timestamp (latency also via Prometheus <code>ig_mcp_*</code> metrics)</td></tr>
            <tr><td className="mgc-env-key">Where</td><td className="mgc-env-val">Gateway resource / route and target MCP service</td></tr>
            <tr><td className="mgc-env-key">How / result</td><td className="mgc-env-val">Forwarded vs blocked; Authorize PERMIT / DENY / INDETERMINATE</td></tr>
          </tbody>
        </table>
        <p className="mgc-field-hint" style={{ marginTop: 8 }}>
          Switch to <strong>Real PingOne Agent Gateway</strong> below, send a tool call, then expand the live
          5W1H table in the response. Docs:{' '}
          <a href={MCP_SECURITY_GATEWAY_DOC} target="_blank" rel="noopener noreferrer">
            MCP security gateway
          </a>
          {' · '}
          <a href="https://docs.pingidentity.com/pinggateway/2026/reference/McpAuditFilter.html" target="_blank" rel="noopener noreferrer">
            McpAuditFilter
          </a>
        </p>
      </div>

      {/* Active gateway + authz backend, with inline toggles */}
      <div className="mgc-section">
        <div className="mgc-info-grid">
          <div className="mgc-info-item">
            <span className="mgc-info-label">Active gateway</span>
            <span className={usePing ? 'mgc-badge mgc-badge--pingone-mode' : 'mgc-badge mgc-badge--mock'}>
              {active ? active.name : 'loading...'}
            </span>
            {active?.url && <code style={{ fontSize: 12 }}>{active.url}</code>}
            <button type="button" className="mgc-push-btn" style={{ marginTop: 8 }}
              disabled={toggling === GATEWAY_FLAG || !active}
              onClick={() => toggleFlag(GATEWAY_FLAG, usePing)}>
              {toggling === GATEWAY_FLAG ? 'Switching...' : `Switch to ${usePing ? 'Demo' : 'PingOne'} Agent Gateway`}
            </button>
          </div>
          <div className="mgc-info-item">
            <span className="mgc-info-label">Authorize backend</span>
            <span className={simulated ? 'mgc-badge mgc-badge--mock' : 'mgc-badge mgc-badge--live'}>
              {active ? active.authzBackend : 'loading...'}
            </span>
            <button type="button" className="mgc-push-btn" style={{ marginTop: 8 }}
              disabled={toggling === AUTHZ_FLAG || !active}
              onClick={() => toggleFlag(AUTHZ_FLAG, simulated)}>
              {toggling === AUTHZ_FLAG ? 'Switching...' : `Use ${simulated ? 'real PingOne' : 'simulated'} authorize`}
            </button>
          </div>
        </div>
      </div>

      {/* Demo presets */}
      <div className="mgc-section">
        <h4>Demo presets</h4>
        <p className="mgc-field-hint">
          One-click setup for presenter flows. Open this page at{' '}
          <code>https://api.ping.demo:4000/setup?tab=mcp-gateway&amp;subtab=tester</code>
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="mgc-push-btn" disabled={!!presetBusy}
            onClick={() => runPreset('uc18-throttle')}>
            {presetBusy === 'uc18-throttle' ? 'Applying...' : 'UC18 throttling (Demo Gateway)'}
          </button>
          <button type="button" className="mgc-push-btn" disabled={!!presetBusy}
            onClick={() => runPreset('real-throttle-ig')}>
            {presetBusy === 'real-throttle-ig' ? 'Applying...' : 'UC18 throttling (Real IG)'}
          </button>
          <button type="button" className="mgc-push-btn" disabled={!!presetBusy}
            onClick={() => runPreset('real-policy')}>
            {presetBusy === 'real-policy' ? 'Applying...' : 'Real IG policy (simulated authz)'}
          </button>
        </div>
      </div>

      <div className="mgc-section" id="rfc9728-metadata">
        <h4>Protected resource metadata (RFC 9728)</h4>
        <p className="mgc-field-hint">
          Each MCP hop publishes <code>/.well-known/oauth-protected-resource</code>. The gateway
          owns its own metadata — the <code>resource</code> URI is the gateway audience (RFC 8707),
          not the upstream MCP server.
        </p>
        <button type="button" className="mgc-push-btn" onClick={fetchMetadata} disabled={metadataLoading}>
          {metadataLoading ? 'Fetching metadata...' : 'Fetch live metadata'}
        </button>
        {metadata && (
          <table className="mgc-env-table" style={{ marginTop: 10 }}>
            <tbody>
              {Object.entries(metadata).map(([key, data]) => (
                <MetadataServiceRow key={key} serviceKey={key} data={data} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* UC18 rate limiting */}
      <div className="mgc-section" id="uc18">
        <h4>Rate limiting (UC18)</h4>
        <p className="mgc-field-hint">
          Throttled requests return HTTP 429 <strong>before</strong> PingOne Authorize runs —
          protecting P1AZ API quota. Demo Agent Gateway limits in-process; PingOne Agent Gateway
          limits in PingGateway (<code>uc18-rate-limit.groovy</code>) when this flag is on.
        </p>
        {rateStatus && (
          <table className="mgc-env-table">
            <tbody>
              <tr>
                <td className="mgc-env-key">Active layer</td>
                <td className="mgc-env-val">{rateStatus.rateLimitLayer || 'off'}</td>
              </tr>
              <tr>
                <td className="mgc-env-key">BFF flag (ff_mcp_rate_limit)</td>
                <td className="mgc-env-val">{rateStatus.bffFlag ? 'ON' : 'OFF'}</td>
              </tr>
              {rateStatus.usePingGateway && (
                <tr>
                  <td className="mgc-env-key">PingGateway UC18 filter</td>
                  <td className="mgc-env-val">
                    {rateStatus.bffEnabled
                      ? `ON — ${rateStatus.bffMaxRequests} calls / ${rateStatus.bffWindowMs}ms (via X-UC18-Rate-Limit)`
                      : 'OFF'}
                  </td>
                </tr>
              )}
              {!rateStatus.usePingGateway && (
                <tr>
                  <td className="mgc-env-key">Gateway rate limit</td>
                  <td className="mgc-env-val">
                    {rateStatus.gatewayEnabled
                      ? `ON — ${rateStatus.maxRequests} calls / ${rateStatus.windowMs}ms`
                      : 'OFF'}
                  </td>
                </tr>
              )}
              <tr>
                <td className="mgc-env-key">Aligned</td>
                <td className="mgc-env-val">
                  <span className={rateStatus.aligned ? 'mgc-badge mgc-badge--live' : 'mgc-badge mgc-badge--error'}>
                    {rateStatus.aligned ? 'YES' : 'NO'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="mgc-push-btn" onClick={toggleUc18Demo}
            disabled={uc18Busy}>
            {uc18Busy
              ? 'Updating...'
              : (rateStatus?.aligned ? 'Disable UC18 demo mode' : 'Enable UC18 demo mode')}
          </button>
          <button type="button" className="mgc-push-btn" onClick={runBurst}
            disabled={bursting || !tool || !rateStatus?.aligned}>
            {bursting ? 'Running burst...' : 'Burst test (5 calls)'}
          </button>
        </div>
        {burstResp && !burstResp.clientError && (
          <div style={{ marginTop: 10 }}>
            <div className="mgc-field-label">{burstResp.summary}</div>
            <table className="mgc-env-table">
              <tbody>
                {(burstResp.results || []).map((r) => (
                  <tr key={r.index}>
                    <td className="mgc-env-key">Call {r.index}</td>
                    <td className="mgc-env-val">
                      <span className={r.ok ? 'mgc-badge mgc-badge--live' : 'mgc-badge mgc-badge--error'}>
                        {r.ok ? 'SUCCESS' : (r.rateLimited
                          ? `RATE LIMITED (429${r.rateLimitLayer ? ` @ ${r.rateLimitLayer}` : ''})`
                          : (r.error || 'ERROR'))}
                      </span>
                      {r.retryAfterMs ? ` — retry after ${r.retryAfterMs}ms` : ''}
                      <code style={{ marginLeft: 8 }}>{r.durationMs}ms</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {burstResp?.clientError && (
          <div className="mgc-alert mgc-alert--error" style={{ marginTop: 10 }}>{burstResp.clientError}</div>
        )}
      </div>

      {/* Request composer */}
      <div className="mgc-section">
        <h4>Send a request</h4>
        <label className="mgc-field">
          <span className="mgc-field-label">MCP tool</span>
          <select className="mgc-input" value={tool} onChange={(e) => setTool(e.target.value)}>
            {tools.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <span className="mgc-field-hint">
            {tools.find((t) => t.name === tool)?.description || 'Pick a tool to call through the gateway.'}
            {` — tool list source: ${toolsSource}`}
          </span>
        </label>
        <label className="mgc-field">
          <span className="mgc-field-label">Arguments (JSON)</span>
          <textarea className="mgc-input" rows={4} value={argsText}
            onChange={(e) => setArgsText(e.target.value)} placeholder='{}' spellCheck={false}
            style={{ fontFamily: 'monospace' }} />
        </label>
        <button type="button" className="mgc-push-btn" onClick={send} disabled={sending || !tool}>
          {sending ? 'Sending through gateway...' : 'Send through Agent Gateway'}
        </button>
      </div>

      {/* Response */}
      {resp && (
        <div className="mgc-section">
          <h4>Response</h4>
          {resp.clientError ? (
            <div className="mgc-alert mgc-alert--error">{String(resp.clientError)}</div>
          ) : (
            <>
              <div className="mgc-info-grid">
                <div className="mgc-info-item">
                  <span className="mgc-info-label">Outcome</span>
                  <span className={
                    resp.ok
                      ? 'mgc-badge mgc-badge--live'
                      : isRateLimited
                        ? 'mgc-badge mgc-badge--mock'
                        : 'mgc-badge mgc-badge--error'
                  }>
                    {resp.ok ? 'SUCCESS' : (isRateLimited ? 'RATE LIMITED (429)' : (resp.error || 'ERROR'))}
                  </span>
                </div>
                <div className="mgc-info-item">
                  <span className="mgc-info-label">Via</span>
                  <code>{resp.gateway?.name} ({resp.gateway?.url})</code>
                </div>
                {decision && !isRateLimited && (
                  <div className="mgc-info-item">
                    <span className="mgc-info-label">Authorize decision</span>
                    <span className={decision === 'PERMIT' ? 'mgc-badge mgc-badge--live' : 'mgc-badge mgc-badge--error'}>
                      {decision}
                    </span>
                  </div>
                )}
                <div className="mgc-info-item">
                  <span className="mgc-info-label">Duration</span>
                  <code>{resp.durationMs}ms</code>
                </div>
                {resp.retryAfterMs > 0 && (
                  <div className="mgc-info-item">
                    <span className="mgc-info-label">Retry after</span>
                    <code>{resp.retryAfterMs}ms</code>
                  </div>
                )}
              </div>

              {isRateLimited && (
                <div className="mgc-alert mgc-alert--info" style={{ marginTop: 10 }}>
                  Throttled ({resp.rateLimitLayer === 'ig' ? 'PingGateway' : resp.rateLimitLayer === 'bff' ? 'BFF edge' : 'gateway'}, UC18) —
                  no PingOne Authorize decision was made.
                  {resp.retryAfterMs ? ` Retry after ${resp.retryAfterMs}ms.` : ''}
                </div>
              )}

              {(az?.reason || resp.message) && (
                <div className={`mgc-alert ${resp.ok ? 'mgc-alert--info' : 'mgc-alert--error'}`} style={{ marginTop: 10 }}>
                  {az?.reason || resp.message}
                </div>
              )}

              {az && !isRateLimited && (az.attributes || az.decisionId || az.engine) && (
                <div className="mgc-section" style={{ marginTop: 12 }}>
                  <h4 style={{ marginTop: 0 }}>PingOne Authorize decision</h4>
                  <p className="mgc-field-hint">
                    Fine-grained ABAC layered on top of the gateway's coarse OAuth scope check.
                    In production this is the pre-built <code>PingOneApiAccessManagementFilter</code>;
                    this demo gateway emulates it by calling the P1AZ decision endpoint
                    (<code>{'POST /governance/pap/alpha/policy/{workerId}/decision'}</code>).
                  </p>
                  <table className="mgc-env-table">
                    <tbody>
                      <tr><td className="mgc-env-key">Decision</td><td className="mgc-env-val">{az.decision}</td></tr>
                      {az.engine && <tr><td className="mgc-env-key">Engine</td><td className="mgc-env-val">{az.engine}</td></tr>}
                      {az.decisionId && <tr><td className="mgc-env-key">Decision ID</td><td className="mgc-env-val"><code>{az.decisionId}</code></td></tr>}
                      {az.policyVersion && <tr><td className="mgc-env-key">Policy version</td><td className="mgc-env-val"><code>{az.policyVersion}</code></td></tr>}
                      {az.traceId && <tr><td className="mgc-env-key">Trace ID</td><td className="mgc-env-val"><code>{az.traceId}</code></td></tr>}
                    </tbody>
                  </table>
                  {az.attributes && (
                    <>
                      <div className="mgc-field-label" style={{ marginTop: 10 }}>Attributes evaluated by policy</div>
                      <table className="mgc-env-table">
                        <tbody>
                          {P1AZ_ATTR_ROWS
                            .filter(([key]) => az.attributes[key] !== undefined && az.attributes[key] !== '')
                            .map(([key, label]) => (
                              <tr key={key}>
                                <td className="mgc-env-key">{label}</td>
                                <td className="mgc-env-val"><code>{az.attributes[key]}</code></td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {mcpAudit && (
                <div className="mgc-section" style={{ marginTop: 12 }}>
                  <h4 style={{ marginTop: 0 }}>Live McpAuditFilter event (5W1H)</h4>
                  <p className="mgc-field-hint">
                    From <code>X-Gw-Audit-Trail.mcpAudit</code> on this response — the same story
                    PingGateway writes to <code>audit/mcp.audit.json</code>.
                  </p>
                  <table className="mgc-env-table">
                    <tbody>
                      <tr>
                        <td className="mgc-env-key">Who</td>
                        <td className="mgc-env-val">
                          user <code>{mcpAudit.who?.userSub || '—'}</code>
                          {mcpAudit.who?.agentSub ? (
                            <> via agent <code>{mcpAudit.who.agentSub}</code></>
                          ) : null}
                          {mcpAudit.who?.actDepth != null ? (
                            <> (depth {String(mcpAudit.who.actDepth)})</>
                          ) : null}
                        </td>
                      </tr>
                      <tr>
                        <td className="mgc-env-key">What</td>
                        <td className="mgc-env-val">
                          <code>{mcpAudit.what?.mcpMethod || '—'}</code>
                          {mcpAudit.what?.tool ? <> → <code>{mcpAudit.what.tool}</code></> : null}
                        </td>
                      </tr>
                      {mcpWhenLabel && (
                        <tr>
                          <td className="mgc-env-key">When</td>
                          <td className="mgc-env-val"><code>{mcpWhenLabel}</code></td>
                        </tr>
                      )}
                      <tr>
                        <td className="mgc-env-key">Where</td>
                        <td className="mgc-env-val">
                          <code>{mcpAudit.where?.resourceId || mcpAudit.where?.routePath || '—'}</code>
                          {mcpAudit.where?.vertical ? <> ({mcpAudit.where.vertical})</> : null}
                        </td>
                      </tr>
                      <tr>
                        <td className="mgc-env-key">How</td>
                        <td className="mgc-env-val">
                          <span className={
                            mcpAudit.how?.decision === 'PERMIT' || mcpAudit.how?.result === 'forwarded'
                              ? 'mgc-badge mgc-badge--live'
                              : 'mgc-badge mgc-badge--error'
                          }>
                            {mcpAudit.how?.decision || '—'}
                          </span>
                          {mcpAudit.how?.result ? ` → ${mcpAudit.how.result}` : ''}
                          {mcpAudit.how?.backend ? ` (${mcpAudit.how.backend})` : ''}
                        </td>
                      </tr>
                      {mcpAudit.eventName && (
                        <tr>
                          <td className="mgc-env-key">Event</td>
                          <td className="mgc-env-val"><code>{mcpAudit.eventName}</code></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="mgc-field-label" style={{ marginTop: 10 }}>mcpAudit (JSON)</div>
                  <div className="mgc-code-block">
                    <pre className="mgc-pre mgc-pre--code jh-dark"><JsonHighlight value={mcpAudit} /></pre>
                  </div>
                </div>
              )}
              {resp.gateway?.usePingGateway && resp.gwAuditTrail && !mcpAudit && (
                <p className="mgc-field-hint" style={{ marginTop: 10 }}>
                  Gateway returned an audit trail but no <code>mcpAudit</code> block. Restart PingGateway
                  after enabling <code>McpAuditFilter</code> so <code>p1az-decision.groovy</code> emits the
                  5W1H payload on <code>X-Gw-Audit-Trail</code>.
                </p>
              )}

              {resp.gwAuditTrail && (
                <div style={{ marginTop: 10 }}>
                  <div className="mgc-field-label">Full gateway audit trail</div>
                  <div className="mgc-code-block">
                    <pre className="mgc-pre mgc-pre--code jh-dark"><JsonHighlight value={resp.gwAuditTrail} /></pre>
                  </div>
                </div>
              )}
              {resp.gateway?.usePingGateway && !resp.gwAuditTrail && !isRateLimited && (
                <p className="mgc-field-hint">
                  No X-Gw-Audit-Trail on this response. PingGateway (IG) emits it on both PERMIT and
                  DENY from its authorize filter, so an absent trail means the request was rejected
                  before that filter ran (e.g. a 401 at token introspection). See the Gateway Logs tab
                  for the raw decision.
                </p>
              )}

              <div style={{ marginTop: 10 }}>
                <div className="mgc-field-label">Result</div>
                <div className="mgc-code-block">
                  <pre className="mgc-pre mgc-pre--code jh-dark">
                    <JsonHighlight value={resultValue} />
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Rules the gateway applies */}
      <div className="mgc-section">
        <h4>Rules applied by the gateway</h4>
        <p className="mgc-field-hint">
          Both gateways evaluate the same authorization rules (the simulated authorize backend,
          or real PingOne Authorize). These are the rules in effect right now.
        </p>
        {!rules ? (
          <div className="mgc-loading">Loading rules...</div>
        ) : (
          <table className="mgc-env-table">
            <tbody>
              <tr><td className="mgc-env-key">Engine</td><td className="mgc-env-val">{rules.activeEngine || (simulated ? 'simulated' : 'pingone')}</td></tr>
              <tr><td className="mgc-env-key">Confirm threshold (HITL)</td><td className="mgc-env-val">${rules.simulated?.confirmAmount}</td></tr>
              <tr><td className="mgc-env-key">Step-up threshold</td><td className="mgc-env-val">${rules.simulated?.stepUpAmount}</td></tr>
              <tr><td className="mgc-env-key">Deny threshold</td><td className="mgc-env-val">${rules.simulated?.denyAmount}</td></tr>
              <tr><td className="mgc-env-key">Denied MCP tools</td><td className="mgc-env-val">{(rules.simulated?.mcpDenyTools || []).join(', ') || '(none)'}</td></tr>
              <tr><td className="mgc-env-key">HITL MCP tools</td><td className="mgc-env-val">{(rules.simulated?.mcpHitlTools || []).join(', ') || '(none)'}</td></tr>
              <tr><td className="mgc-env-key">MCP first-tool gate</td><td className="mgc-env-val">{rules.flags?.ff_authorize_mcp_first_tool ? 'ON' : 'OFF'}</td></tr>
            </tbody>
          </table>
        )}
        <div className="mgc-code-block" style={{ marginTop: 10 }}>
          <pre className="mgc-pre mgc-pre--code jh-dark">{rules ? <JsonHighlight value={rules} /> : ''}</pre>
        </div>
      </div>
    </div>
  );
}
