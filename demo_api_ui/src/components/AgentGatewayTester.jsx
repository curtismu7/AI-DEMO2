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

// Fallback when the live tools/list is gated (MFA step-up) or empty — the tool call
// itself mints the delegated token server-side, so these still work.
const FALLBACK_TOOLS = [
  { name: 'get_my_accounts', description: 'List all bank accounts with balances and status.' },
  { name: 'get_my_transactions', description: 'Retrieve transaction history for the authenticated user.' },
  { name: 'get_account_balance', description: 'Get current balance for a specific account by ID.' },
  { name: 'get_sensitive_account_details', description: 'Full account + routing number (sensitive:read + consent).' },
  { name: 'create_transfer', description: 'Transfer funds between accounts (write; may require HITL consent).' },
];

export default function AgentGatewayTester() {
  const [tools, setTools] = useState(FALLBACK_TOOLS);
  const [toolsSource, setToolsSource] = useState('static');
  const [tool, setTool] = useState(FALLBACK_TOOLS[0].name);
  const [argsText, setArgsText] = useState('{}');
  const [sending, setSending] = useState(false);
  const [resp, setResp] = useState(null);
  const [rules, setRules] = useState(null);
  const [active, setActive] = useState(null); // authoritative gateway state
  const [toggling, setToggling] = useState('');

  const fetchActive = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp-gateway/active');
      setActive(data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to load active gateway state'));
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

  useEffect(() => { fetchActive(); fetchTools(); fetchRules(); }, [fetchActive, fetchTools, fetchRules]);

  const toggleFlag = useCallback(async (id, current) => {
    setToggling(id);
    try {
      await apiClient.patch('/api/admin/feature-flags', { updates: { [id]: !current } });
      await fetchActive();
      await fetchRules();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to toggle flag'));
    } finally {
      setToggling('');
    }
  }, [fetchActive, fetchRules]);

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

  const usePing = active?.usePingGateway;
  const simulated = active?.simulated;
  const az = resp?.gwAuditTrail?.authorize || null;
  const decision = resp?.decision || az?.decision || null;
  // Stable fallback object so JsonHighlight doesn't receive a new reference every render.
  const resultValue = resp?.result ?? resp?.rpcData ?? (resp ? { error: resp.error, message: resp.message } : null);

  return (
    <div className="mgc-root">
      <div className="mgc-header">
        <div>
          <h2 className="mgc-title">Agent Gateway Tester</h2>
          <p className="mgc-subtitle">
            Send an MCP tool call through the active gateway and inspect the response, the
            authorize decision, and the rules the gateway applied.
          </p>
        </div>
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
                  <span className={resp.ok ? 'mgc-badge mgc-badge--live' : 'mgc-badge mgc-badge--error'}>
                    {resp.ok ? 'SUCCESS' : (resp.error || 'ERROR')}
                  </span>
                </div>
                <div className="mgc-info-item">
                  <span className="mgc-info-label">Via</span>
                  <code>{resp.gateway?.name} ({resp.gateway?.url})</code>
                </div>
                {decision && (
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
              </div>

              {(az?.reason || resp.message) && (
                <div className={`mgc-alert ${resp.ok ? 'mgc-alert--info' : 'mgc-alert--error'}`} style={{ marginTop: 10 }}>
                  {az?.reason || resp.message}
                </div>
              )}

              {resp.gwAuditTrail && (
                <div style={{ marginTop: 10 }}>
                  <div className="mgc-field-label">Gateway audit trail</div>
                  <div className="mgc-code-block">
                    <pre className="mgc-pre mgc-pre--code jh-dark"><JsonHighlight value={resp.gwAuditTrail} /></pre>
                  </div>
                </div>
              )}
              {resp.gateway?.usePingGateway && !resp.gwAuditTrail && (
                <p className="mgc-field-hint">
                  PingGateway (IG) does not emit the X-Gw-Audit-Trail header the Demo Agent Gateway
                  does, so on the PingOne path the decision shows as the gateway's response (e.g. a
                  403 access_denied) rather than a full audit trail.
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
