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
  const mcpAudit = resp?.gwAuditTrail?.mcpAudit || null;
  const decision = resp?.decision || az?.decision || null;
  // Stable fallback object so JsonHighlight doesn't receive a new reference every render.
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
            Send an MCP tool call through the active gateway and inspect the response, the
            authorize decision, and the rules the gateway applied.
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

              {az && (az.attributes || az.decisionId || az.engine) && (
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
              {resp.gateway?.usePingGateway && !resp.gwAuditTrail && (
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
