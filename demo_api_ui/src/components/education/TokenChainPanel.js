// banking_api_ui/src/components/education/TokenChainPanel.js
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTokenChainOptional } from '../../context/TokenChainContext';
import { useProofOfEnforcement } from '../../context/ProofOfEnforcementContext';
import './TokenChainPanel.css';

/**
 * Illustrative RFC 8693 token chain: User token → agent → MCP / transaction tokens → resource.
 * Rows expand to show decoded JWT-shaped examples; copy is demo-only (no live secrets in the browser).
 */
import { useAgentCCTokenPrefetch } from '../../hooks/useAgentCCTokenPrefetch';
const TOKEN_CHAIN_STEPS = [
  {
    id: 'banking-app',
    label: 'Banking Application Token',
    status: 'active',
    summary: 'User access token after Authorization Code + PKCE — stored in the Backend-for-Frontend (BFF) session (httpOnly cookie). Used for Banking REST calls.',
    payloadPreview: `{
  "sub": "user-uuid",
  "scope": "openid read write",
  "aud": "https://banking-api.example.com",
  "iss": "https://auth.pingone.com/...",
  "exp": 1710000000
}`,
    copySample: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    // Event IDs from the server that indicate this step is in progress / complete
    eventIds: ['user-token', 'user-token-introspection', 'user-token-refreshed', 'user-token-invalid'],
  },
  {
    id: 'agent',
    label: 'Agent Token',
    status: 'active',
    summary: 'Optional client-credentials or delegated token for the agent OAuth client when the agent reasoning service (demo_agent_service) acts with its own client_id (AGENT_OAUTH_CLIENT_ID).',
    payloadPreview: `{
  "sub": "agent-service",
  "scope": "ai_agent read",
  "aud": "https://mcp.example.com",
  "client_id": "agent-oauth-client"
}`,
    copySample: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    eventIds: ['agent-cc-token', 'agent-cc-token-verified', 'agent-actor-token-verified'],
  },
  {
    id: 'exchanged-mcp',
    label: 'Exchanged Token (MCPServer)',
    status: 'acquiring',
    summary: 'PingOne returns this after POST /as/token with grant_type=token-exchange (RFC 8693), subject_token=User token, audience=MCP resource.',
    payloadPreview: '— Issued when exchange completes —',
    eventIds: [
      'exchanged-token', 'exchanged-token-verified',
      'exchange-required', 'exchange-failed',
      'user-scopes-insufficient',
    ],
  },
  {
    id: 'mcp-server',
    label: 'MCPServer Token',
    status: 'acquiring',
    summary: 'Bearer token the MCP server accepts on WebSocket or HTTP for tools/list and tools/call.',
    payloadPreview: '— Same family as exchanged token; aud may match MCP resource URI (RFC 8707). —',
    eventIds: [
      'gw-introspection', 'gw-authorize', 'gw-mtls',
    ],
  },
  {
    id: 'resource',
    label: 'MCPServerExchangedToken-ToAccess-Resource',
    status: 'waiting',
    summary: 'Final token scoped to the resource server (Banking API) after gateway policy evaluation.',
    payloadPreview: '— Waiting on upstream policy / exchange completion in this demo. —',
    eventIds: ['resource-token', 'resource-token-verified'],
  },
];

// Build a lookup: event id → step id
const EVENT_TO_STEP = {};
for (const step of TOKEN_CHAIN_STEPS) {
  for (const eid of (step.eventIds || [])) {
    EVENT_TO_STEP[eid] = step.id;
  }
}

/**
 * Derive the "current phase" step id from live token chain events.
 * Returns the step id of the last event that maps to a known step, or null.
 */
function deriveActiveStepId(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  // Walk events in order; last known-step event wins
  let activeId = null;
  for (const ev of events) {
    const mapped = EVENT_TO_STEP[ev.id];
    if (mapped) activeId = mapped;
  }
  return activeId;
}

function StatusBadge({ status }) {
  if (status === 'active') {
    return <span className="token-chain-badge token-chain-badge--active">Active</span>;
  }
  if (status === 'acquiring') {
    return (
      <span className="token-chain-badge token-chain-badge--acquiring">
        <span className="token-chain-spinner" aria-hidden />
        Acquiring…
      </span>
    );
  }
  return <span className="token-chain-badge token-chain-badge--waiting">Waiting</span>;
}

export default function TokenChainPanel() {
  const [archOpen, setArchOpen] = useState(true);
  const [chainOpen, setChainOpen] = useState(true);
  const [mcpTrailOpen, setMcpTrailOpen] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedToolId, setExpandedToolId] = useState(null);
  const [copyFlash, setCopyFlash] = useState(null);
  const tokenChain = useTokenChainOptional();
  useAgentCCTokenPrefetch();
  const mcpToolCalls = tokenChain?.mcpToolCalls || [];
  const resolvedIdentity = tokenChain?.resolvedIdentity ?? null;
  const liveEvents = tokenChain?.events || [];
  const { verdict } = useProofOfEnforcement();

  // Derive active step from live events
  const activeStepId = useMemo(() => deriveActiveStepId(liveEvents), [liveEvents]);

  // Refs for each step row — used to scroll the active one into view
  const stepRefs = useRef({});

  // Scroll active step into view whenever it changes
  useEffect(() => {
    if (!activeStepId) return;
    const el = stepRefs.current[activeStepId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeStepId]);

  // Build live-aware steps — replace "user-uuid" with real sub when session identity is available
  const liveSub = resolvedIdentity?.currentUser?.sub;
  const liveName = resolvedIdentity?.currentUser?.name || resolvedIdentity?.currentUser?.email || '';
  const steps = TOKEN_CHAIN_STEPS.map((step) => {
    if (step.id !== 'banking-app' || !liveSub) return step;
    return {
      ...step,
      payloadPreview: `{
  "sub": "${liveSub}",${liveName ? `\n  "name": "${liveName}",` : ''}
  "scope": "openid read write",
  "aud": "https://banking-api.example.com",
  "iss": "https://auth.pingone.com/...",
  "exp": 1710000000
}`,
    };
  });

  const handleToggleRow = useCallback((id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleCopy = useCallback((id, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyFlash(id);
      setTimeout(() => setCopyFlash(null), 1600);
    });
  }, []);

  return (
    <div className="token-chain-root">
      <div className="token-chain-acc">
        <button
          type="button"
          className="token-chain-acc-head"
          onClick={() => setArchOpen((o) => !o)}
          aria-expanded={archOpen}
        >
          <span className="token-chain-acc-icon" aria-hidden>📖</span>
          <span>Architecture Overview — RFC 8693 Token Exchange</span>
          <span className="token-chain-chev" aria-hidden>{archOpen ? '▾' : '▸'}</span>
        </button>
        {archOpen && (
          <div className="token-chain-acc-body token-chain-acc-body--muted">
            Browser SPA → Banking Backend-for-Frontend (BFF) (session, <strong>User token</strong>) → optional agent delegation →{' '}
            <strong>RFC 8693</strong> token exchange at PingOne → <strong>MCP token</strong> (delegated) →{' '}
            MCP server and Banking API as resource server. Tokens stay on the server; this chain is a
            teaching view of how they relate.
          </div>
        )}
      </div>

      <div className="token-chain-card">
        <button
          type="button"
          className="token-chain-card-head"
          onClick={() => setChainOpen((o) => !o)}
          aria-expanded={chainOpen}
        >
          <div>
            <div className="token-chain-card-title">Token Chain</div>
            <div className="token-chain-card-sub">Acquiring tokens along the Backend-for-Frontend (BFF) → MCP → resource path</div>
          </div>
          <span className="token-chain-chev" aria-hidden>{chainOpen ? '▾' : '▸'}</span>
        </button>

        {chainOpen && (
          <ul className="token-chain-list">
            {steps.map((step) => {
              const expanded = expandedId === step.id;
              const showCopy = step.status === 'active' && step.copySample;
              const isActive = activeStepId === step.id;

              return (
                <li
                  key={step.id}
                  ref={(el) => { stepRefs.current[step.id] = el; }}
                  className={`token-chain-item${isActive ? ' token-chain-item--current' : ''}`}
                >
                  {isActive && (
                    <div className="token-chain-current-bar" aria-label="Current phase" />
                  )}
                  <div className="token-chain-row">
                    <button
                      type="button"
                      className="token-chain-expand"
                      onClick={() => handleToggleRow(step.id)}
                      aria-expanded={expanded}
                      aria-label={expanded ? 'Collapse token details' : 'Expand token details'}
                    >
                      {expanded ? '▾' : '▸'}
                    </button>
                    <span className={`token-chain-label${isActive ? ' token-chain-label--current' : ''}`}>
                      {isActive && <span className="token-chain-live-dot" aria-hidden />}
                      {step.label}
                    </span>
                    <StatusBadge status={step.status} />
                    {showCopy ? (
                      <button
                        type="button"
                        className="token-chain-copy"
                        title="Copy sample token prefix (illustrative)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(step.id, step.copySample);
                        }}
                        aria-label="Copy sample token"
                      >
                        {copyFlash === step.id ? '✓' : '⎘'}
                      </button>
                    ) : (
                      <span style={{ width: '1.85rem', flexShrink: 0 }} aria-hidden />
                    )}
                  </div>
                  {expanded && (
                    <div className="token-chain-detail">
                      <p style={{ margin: 0 }}>{step.summary}</p>
                      <pre>{step.payloadPreview}</pre>
                      <p className="token-chain-hint">
                        Click the row again to collapse. Live access tokens are not stored in the
                        browser in this app.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {verdict && (
        <div className="token-chain-card">
          <div className="token-chain-card-head" style={{ cursor: 'default' }}>
            <div>
              <div className="token-chain-card-title">
                {verdict.title} <span className="token-chain-badge">{verdict.useCaseId.toUpperCase()}</span>
              </div>
              <div className="token-chain-card-sub">
                {verdict.matchedSteps.length} / {verdict.matchedSteps.length + verdict.missingSteps.length} steps matched
                {(verdict.state === 'verified' || verdict.state === 'denied-as-expected') ? ' ✅' : ' ⚠️'}
              </div>
            </div>
          </div>
          <ul className="token-chain-list">
            {verdict.matchedSteps.map((step) => (
              <li key={step} className="token-chain-item">
                <div className="token-chain-row">
                  <span className="token-chain-label">✅ {step}</span>
                </div>
              </li>
            ))}
            {verdict.missingSteps.map((step) => (
              <li key={step} className="token-chain-item">
                <div className="token-chain-row">
                  <span className="token-chain-label">⚠️ {step} (not yet observed)</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* MCP Delegation Trail */}
      <div className="token-chain-card">
        <button
          type="button"
          className="token-chain-card-head"
          onClick={() => setMcpTrailOpen((o) => !o)}
          aria-expanded={mcpTrailOpen}
        >
          <div>
            <div className="token-chain-card-title">MCP Tool Calls — session total ({mcpToolCalls.length})</div>
            <div className="token-chain-card-sub">All tools invoked with your token this session (chips, agent, Academy) — not just the last prompt</div>
          </div>
          <span className="token-chain-chev" aria-hidden>{mcpTrailOpen ? '▾' : '▸'}</span>
        </button>

        {mcpTrailOpen && (
          <div style={{ padding: '12px 16px' }}>
            {mcpToolCalls.length === 0 ? (
              <p style={{ color: '#374151', fontStyle: 'italic', margin: 0 }}>No MCP tool calls in this session</p>
            ) : (
              <ul className="token-chain-list" style={{ gap: '8px' }}>
                {mcpToolCalls.map((tc) => {
                  const isExpanded = expandedToolId === tc.id;
                  return (
                    <li key={tc.id} className="token-chain-item" style={{ borderLeft: `3px solid ${tc.status === 'success' ? '#28a745' : '#dc3545'}` }}>
                      <div
                        className="token-chain-row"
                        onClick={() => setExpandedToolId(isExpanded ? null : tc.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <span style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 3, fontSize: '0.8em', fontWeight: 600 }}>
                          #{tc.chainIndex}
                        </span>
                        <span style={{ fontWeight: 600, color: '#0066cc', flex: 1 }}>{tc.toolName}</span>
                        <span style={{
                          fontWeight: 'bold',
                          color: tc.status === 'success' ? '#28a745' : '#dc3545',
                          width: 20, textAlign: 'center'
                        }}>
                          {tc.status === 'success' ? '✓' : '✗'}
                        </span>
                        <span style={{ color: '#666', fontSize: '0.85em' }}>{tc.duration}ms</span>
                        {tc.isDelegated && (
                          <span title="Called with delegated token" style={{ fontSize: '1.1em' }}>🔀</span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#374151', marginTop: 2, paddingLeft: 28 }}>
                        {new Date(tc.timestamp).toLocaleTimeString()}
                      </div>
                      {isExpanded && (
                        <div className="token-chain-detail" style={{ marginTop: 8, fontSize: '0.85em' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#666' }}>Timestamp:</span>
                            <span>{new Date(tc.timestamp).toLocaleString()}</span>
                            <span style={{ fontWeight: 600, color: '#666' }}>CallIndex:</span>
                            <span>{tc.chainIndex}</span>
                            <span style={{ fontWeight: 600, color: '#666' }}>Scopes:</span>
                            <span>{(tc.scopes || []).join(', ') || 'none'}</span>
                            <span style={{ fontWeight: 600, color: '#666' }}>Delegation:</span>
                            <span>{tc.isDelegated ? '✓ Token exchanged for MCP agent' : 'Direct user token'}</span>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
