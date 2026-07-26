// banking_api_ui/src/components/UnifiedTokenFlowInspector.jsx
/**
 * Combined Agent Request Flow + OAuth Token Inspector panel
 * - Left side: Agent request flow (step-by-step trace)
 * - Right side: OAuth token inspector (claims, scopes, validity)
 * - Responsive: side-by-side on desktop, stacked on mobile
 * - Can toggle between floating (draggable) and fixed (inline) modes
 */
import React, { useState, useEffect, useCallback } from 'react';
import TokenCard from './TokenCard';
import TokenCardGrid from './TokenCardGrid';
import bffAxios from '../services/bffAxios';
import { fetchEnrichedUserInfo } from '../services/userInfoService';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { agentFlowDiagram } from '../services/agentFlowDiagramService';
import { useExchangeMode } from '../context/ExchangeModeContext';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { useGatewayLiveConfig } from '../hooks/useGatewayLiveConfig';
import TokenExchangeFlowDiagram from './TokenExchangeFlowDiagram';
import TokenFlowDiagram from './TokenFlowDiagram';
import { SecurityGuaranteeBanner } from './SecurityGuaranteeBanner';
import TokenExchangeModeSummary from './TokenExchangeModeSummary';
import TokenLegendModal from './TokenLegendModal';
import ScopeChangesCallout from './ScopeChangesCallout';
import StepDetailsSection from './StepDetailsSection';
import ClaimDetailsModal from './ClaimDetailsModal';
import TokenChainTraceRail from './TokenChainTraceRail';
import JsonHighlight from './shared/JsonHighlight';
import JsonColumnsView from './shared/JsonColumnsView';
import InspectorShell from './shared/InspectorShell';
import InspectorTabs from './shared/InspectorTabs';
import InspectorListItem from './shared/InspectorListItem';
import InspectorReplayBar from './shared/InspectorReplayBar';
import { buildAgentFlowTree } from '../utils/agentFlowTree';
import { STEP_DETAILS } from '../data/stepDetails';
import '../styles/TokenChainRedesign.css';
import './UnifiedTokenFlowInspector.css';

// ============================================================================
// CLAIM CONFIGURATION & UTILITIES
// ============================================================================

const CLAIM_GLOSSARY = {
  sub: 'Subject (RFC 7519 §4.1.2) — unique identifier of the authenticated user. The resource server uses sub to identify who the token represents.',
  iss: 'Issuer (RFC 7519 §4.1.1) — the PingOne authorization server URL that signed and issued this token. Relying parties MUST verify iss.',
  aud: 'Audience (RFC 7519 §4.1.3 · RFC 8707) — resource server(s) this token is scoped to. RFC 8707 Resource Indicators bind the token to a single audience, preventing reuse on other services.',
  exp: 'Expiration (RFC 7519 §4.1.4) — Unix epoch after which the token MUST be rejected. Short-lived tokens limit blast radius if intercepted.',
  iat: 'Issued At (RFC 7519 §4.1.6) — Unix epoch when the token was created by PingOne AS.',
  scope: 'Scope (RFC 6749 §3.3) — permissions granted to the bearer. Scope is space-delimited; resource servers MUST reject tokens missing a required scope. Token Exchange (RFC 8693) can only narrow scope, never expand it.',
  client_id: 'Client ID — the OAuth 2.0 application (RFC 6749 §2.2) that originally requested this token.',
  env: 'PingOne Environment ID — identifies the tenant/environment that issued the token.',
  org: 'PingOne Organization ID.',
  act: 'Actor (RFC 8693 §4.1) — identifies the party currently acting on behalf of the subject. Present on tokens issued via Token Exchange; proves delegation chain. Nested act = multi-hop delegation.',
  may_act: 'May Act (RFC 8693 §4.2) — claim on the SUBJECT token that pre-authorizes a named client_id to perform Token Exchange on the subject\'s behalf. Without may_act, the BFF cannot exchange this token.',
  acr: 'Authentication Context Class Reference (RFC 9470 · OpenID Core §2) — level of assurance. "Multi_Factor" means MFA was used. Resources that require step-up authentication reject tokens with a lower ACR.',
  amr: 'Authentication Methods References (OpenID Core §2) — how the user authenticated (e.g. pwd, otp, fido).',
  sid: 'Session ID — PingOne session identifier used for Single Sign-Out.',
  auth_time: 'Authentication Time (OpenID Core §2) — when the user last authenticated. Used to enforce max_age and step-up policies.',
  cnf: 'Confirmation (RFC 9449 §3 · RFC 7800) — JWK thumbprint (jkt) that binds this token to a DPoP key. The caller must sign a DPoP proof with the matching private key on every request, so a stolen bearer is useless to anyone else.',
  authorization_details: 'Rich Authorization Request (RFC 9396) — structured, intent-bound grant (e.g. {type, action, amount, payee}) carried instead of (or alongside) a broad scope. The gateway enforces that the actual tool-call parameters are a subset of what was authorized.',
};


function ScopesBadges({ scope, tokenLabel }) {
  if (!scope) return (
    <div className="utfi-no-scopes-callout">
      <span className="utfi-no-scopes-icon">⚠️</span>
      <div className="utfi-no-scopes-body">
        <span className="utfi-no-scopes-title">No scopes on this token</span>
        <span className="utfi-no-scopes-detail">
          This is your <strong>{tokenLabel || 'customer access token'}</strong> — the JWT stored server-side in the BFF session after PingOne login.
          RFC 6749 §3.3 — scopes are required for MCP tool calls.
          Sign out → sign in with the PingOne app that requests
          <code>read</code>, <code>write</code> scopes.
        </span>
      </div>
    </div>
  );
  const scopes = typeof scope === 'string' ? scope.split(' ') : scope;
  return (
    <div className="utfi-scopes">
      {scopes.map((s) => (
        <span key={s} className="utfi-scope-badge">{s}</span>
      ))}
    </div>
  );
}

function ClaimRow({ label, value, glossary }) {
  if (value === undefined || value === null) return null;
  const isObject = typeof value === 'object';
  return (
    <div className="utfi-claim-row">
      <span
        className="utfi-claim-key"
        title={glossary || ''}
        style={{ cursor: glossary ? 'help' : 'default', borderBottom: glossary ? '1px dotted #94a3b8' : 'none' }}
      >
        {label}
      </span>
      <span className="utfi-claim-value">{isObject ? <JsonHighlight value={value} /> : String(value)}</span>
    </div>
  );
}

function hasAnyField(data) {
  if (!data) return false;
  return Object.values(data).some((v) => v !== undefined && v !== null);
}

// Tool -> gateway route category, mirroring the five routes documented in
// GatewayRoutingDiagram.jsx (itself sourced from demo_mcp_gateway/src/router.ts,
// the real routing source of truth). Only two of the five categories are a
// real RFC 8693 audience exchange to a WebSocket backend (OLB, Investments);
// the other three use a different credential/audience shape entirely — see
// getUtfiRouteCategory below. Any tool not listed here (including "no tool
// called yet") falls through to OLB, the majority-case route — this matches
// router.ts's own default ("existing OLB tools ... and unknown tools -> OLB").
const UTFI_INVEST_TOOLS = new Set(['get_portfolio_summary', 'get_investment_balance']);
const UTFI_API_KEY_TOOLS = new Set(['show_mortgage', 'show_health_record', 'show_permit']);
const UTFI_BANKING_RESOURCE_TOOLS = new Set([
  'user_profile_card', // "Dual-token" route
  'demo_show_accounts', // "Banking-data" route
  'demo_show_transactions', // "Banking-data" route
]);

const UTFI_NO_EXCHANGE_NOTE =
  'No RFC 8693 exchange — this tool uses an API-key credential (X-API-Key), not a bearer-token audience swap.';

// Categorizes a tool name into one of the four backend-audience-out shapes
// used by the Token Transform tab. Returns null when no tool has been
// called yet this session (caller renders the default-to-OLB caveat).
function getUtfiRouteCategory(toolName) {
  if (!toolName) return null;
  if (UTFI_INVEST_TOOLS.has(toolName)) return 'invest';
  if (UTFI_API_KEY_TOOLS.has(toolName)) return 'api_key';
  if (UTFI_BANKING_RESOURCE_TOOLS.has(toolName)) return 'banking_resource';
  return 'olb';
}

// A token-chain event's audience claim can show up under different field
// names depending on which producer built it (session-preview stub events
// carry `claims.aud`; live token-chain rows carry a flat `audience`; a few
// call sites also pass through `decoded.payload.aud` / `tokenAud` / `aud`).
// Check them in order so whichever shape the current event has, the real
// value surfaces instead of silently rendering nothing.
function getEventAudience(event) {
  if (!event) return undefined;
  const aud =
    event.claims?.aud ??
    event.decoded?.payload?.aud ??
    event.audience ??
    event.tokenAud ??
    event.aud;
  return Array.isArray(aud) ? aud.join(', ') : aud;
}

// ============================================================================
// LEFT/MIDDLE/RIGHT: FLOW & TOKENS TAB — hybrid tree via InspectorShell
// ============================================================================

function nodeFieldRows(node) {
  if (node.kind === 'token') {
    const t = node.data;
    return [
      ['Type', t.tokenType ? t.tokenType.replace(/_/g, ' ') : 'token'],
      ['Minted', t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '—'],
      ...(t.tokenSub ? [['Subject', `${String(t.tokenSub).slice(0, 16)}…`]] : []),
      ...(t.tokenAct ? [['Actor (act)', `${String(t.tokenAct).slice(0, 16)}…`]] : []),
    ];
  }
  const s = node.data;
  return [['Status', s.status], ...(s.detail ? [['Detail', s.detail]] : [])];
}

const UTFI_PATH_LABELS = {
  oauth_bearer: 'OAUTH BEARER PATH',
  api_key: 'API-KEY PATH',
  dual_token: 'ACCESS + ID-TOKEN PATH',
};
const UTFI_PATH_COLORS = {
  oauth_bearer: { bg: '#dbeafe', border: '#004687', text: '#004687' },
  api_key: { bg: '#fef9c3', border: '#ca8a04', text: '#713f12' },
  dual_token: { bg: '#ccfbf1', border: '#0d9488', text: '#0d9488' },
};

const RIGHT_TABS = [
  { key: 'claims', label: 'Claims' },
  { key: 'exchange', label: 'Token Exchange' },
  { key: 'diagram', label: 'Diagram' },
  { key: 'raw', label: 'Raw' },
  { key: 'columns', label: 'Columns' },
  { key: 'glossary', label: 'Glossary' },
];

function FlowTokensPanel({ onOpenClaimsModal }) {
  const [snap, setSnap] = useState(() => agentFlowDiagram.getState());
  const [tokenChain, setTokenChain] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const [activeRightTab, setActiveRightTab] = useState('claims');
  const [showFlowDiagram, setShowFlowDiagram] = useState(false);
  const { mode } = useExchangeMode();
  const tokenChainCtx = useTokenChainOptional();

  const loadTokenChain = useCallback(async () => {
    try {
      const res = await fetch('/api/token-chain/current', { credentials: 'include', _silent: true });
      if (res.ok) {
        const data = await res.json();
        setTokenChain(data.currentTokens || []);
      }
    } catch (err) {
      console.error('Failed to load token chain:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = agentFlowDiagram.subscribe(setSnap);
    return unsub;
  }, []);

  useEffect(() => {
    if (snap.visible) loadTokenChain();
  }, [snap.visible, loadTokenChain]);

  useEffect(() => {
    const onAgentResult = () => {
      if (agentFlowDiagram.getState().visible) loadTokenChain();
    };
    window.addEventListener('banking-agent-result', onAgentResult);
    return () => window.removeEventListener('banking-agent-result', onAgentResult);
  }, [loadTokenChain]);

  useEffect(() => {
    if (!snap.visible) return undefined;
    const id = setInterval(loadTokenChain, 10000);
    return () => clearInterval(id);
  }, [snap.visible, loadTokenChain]);

  const { steps, hint, toolName } = snap;
  const tree = buildAgentFlowTree(steps, tokenChain);
  const flatNodes = tree.flatMap((g) => g.nodes);
  const selectedNode =
    flatNodes.find((n) => n.id === selectedNodeId) || flatNodes[flatNodes.length - 1] || null;

  const selectNode = useCallback((node) => {
    setSelectedNodeId(node.id);
    setSelectedToken(node.kind === 'token' ? node.data : null);
  }, []);

  const selectedIndex = flatNodes.findIndex((n) => n.id === selectedNode?.id);
  const goPrev = () => { if (selectedIndex > 0) selectNode(flatNodes[selectedIndex - 1]); };
  const goNext = () => {
    if (selectedIndex >= 0 && selectedIndex < flatNodes.length - 1) selectNode(flatNodes[selectedIndex + 1]);
  };
  const handleClear = () => {
    agentFlowDiagram.reset();
    setSelectedNodeId(null);
    setSelectedToken(null);
  };

  const deniedCount = steps.filter((s) => s.status === 'error').length;
  const utfiCredentialPath = tokenChainCtx?.events?.[0]?.credentialPath || 'oauth_bearer';
  const utfiPathLabel = UTFI_PATH_LABELS[utfiCredentialPath] || UTFI_PATH_LABELS.oauth_bearer;
  const utfiPathColor = UTFI_PATH_COLORS[utfiCredentialPath] || UTFI_PATH_COLORS.oauth_bearer;

  const left = (
    <div className="inspector-shell-tree-body">
      {tree.length === 0 && (
        <div className="utfi-empty-state">
          <p className="utfi-empty-msg">{hint || 'Ready for agent requests…'}</p>
        </div>
      )}
      {tree.map((group) => (
        <div key={group.key}>
          <div className="inspector-shell-tree-group__label">{group.label} ({group.nodes.length})</div>
          {group.nodes.map((node) => (
            <InspectorListItem
              key={node.id}
              label={node.label}
              kind={node.kind}
              dot={node.status === 'error' ? 'sensitive' : 'default'}
              active={selectedNode?.id === node.id}
              onClick={() => selectNode(node)}
            />
          ))}
        </div>
      ))}
    </div>
  );

  const middle = selectedNode ? (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">{selectedNode.label}</div>
      </div>
      <div className="inspector-shell-form-body">
        {nodeFieldRows(selectedNode).map(([k, v]) => (
          <div className="inspector-shell-field" key={k}>
            <label>{k}</label>
            <div>{v}</div>
          </div>
        ))}
      </div>
    </>
  ) : (
    <div className="inspector-shell-form-empty">Select a step or token on the left to inspect it.</div>
  );

  const right = (
    <>
      <InspectorTabs tabs={RIGHT_TABS} activeKey={activeRightTab} onChange={setActiveRightTab} />
      <div className="inspector-shell-output-body">
        <div style={{ display: activeRightTab === 'claims' || activeRightTab === 'exchange' ? 'block' : 'none' }}>
          <OAuthInspectorSection
            activeTab={activeRightTab}
            selectedToken={selectedToken}
            onOpenClaimsModal={onOpenClaimsModal}
          />
        </div>
        {activeRightTab === 'diagram' && (
          <>
            <TokenFlowDiagram />
            {steps.length > 0 && (
              <div className="utfi-flow-section">
                <div className="utfi-flow-section-header">
                  <span>{mode === 'double' ? '2-Exchange Flow (RFC 8693 §4)' : '1-Exchange Flow (RFC 8693 §2.1)'}</span>
                  <button
                    type="button"
                    className="utfi-btn utfi-btn-sm"
                    onClick={() => setShowFlowDiagram(!showFlowDiagram)}
                    aria-pressed={showFlowDiagram}
                  >
                    {showFlowDiagram ? '▼' : '▶'}
                  </button>
                </div>
                {showFlowDiagram && (
                  <div className="utfi-flow-diagram">
                    <TokenExchangeFlowDiagram phase={snap.phase} steps={steps} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {activeRightTab === 'raw' && (
          <pre className="inspector-shell-output-code">
            {selectedNode ? <JsonHighlight value={selectedNode.data} /> : 'Nothing selected yet.'}
          </pre>
        )}
        {activeRightTab === 'columns' && (
          <JsonColumnsView value={selectedNode ? selectedNode.data : null} />
        )}
        {activeRightTab === 'glossary' && (
          <div className="utfi-detailed-steps-list">
            {STEP_DETAILS.map((step) => (
              <StepDetailsSection key={step.id} step={step} />
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="utfi-agent-flow-section">
      <SecurityGuaranteeBanner />
      {tokenChainCtx?.events?.length > 0 && (
        <div
          style={{
            margin: '4px 0 6px',
            padding: '4px 10px',
            borderRadius: 5,
            background: utfiPathColor.bg,
            borderLeft: `3px solid ${utfiPathColor.border}`,
            fontSize: '0.71rem',
            fontWeight: 700,
            color: utfiPathColor.text,
            letterSpacing: 0.3,
          }}
        >
          {utfiPathLabel}
          {utfiCredentialPath === 'oauth_bearer' && (
            <span style={{ fontWeight: 400, marginLeft: 6, color: '#334155' }}>
              — RFC 8693 exchange, banking_resource_server /accounts /transactions
            </span>
          )}
          {utfiCredentialPath === 'api_key' && (
            <span style={{ fontWeight: 400, marginLeft: 6, color: '#334155' }}>
              — X-API-Key swap, no backend call
            </span>
          )}
          {utfiCredentialPath === 'dual_token' && (
            <span style={{ fontWeight: 400, marginLeft: 6, color: '#334155' }}>
              — user bearer validated + id_token decoded at banking_resource_server /identity
            </span>
          )}
        </div>
      )}
      <InspectorReplayBar
        stepCount={steps.length}
        deniedCount={deniedCount}
        tokenCount={tokenChain.length}
        onPrev={goPrev}
        onNext={goNext}
        onClear={handleClear}
        clearDisabled={steps.length === 0 && tokenChain.length === 0}
      />
      <InspectorShell
        title="Agent Request Flow"
        statusText={toolName || 'No tool call yet this session'}
        fullHeight="fill"
        left={left}
        middle={middle}
        right={right}
      />
    </div>
  );
}

// ============================================================================
// RIGHT: OAUTH TOKEN INSPECTOR SECTION
// ============================================================================

function OAuthInspectorSection({ selectedToken, onOpenClaimsModal, activeTab }) {
  const [userStatus, setUserStatus] = useState(null);
  const [tokenClaims, setTokenClaims] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrichedInfo, setEnrichedInfo] = useState(null);
  const [enrichedLoading, setEnrichedLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    identity: true,
    authorization: true,
    validity: true,
    provider: true,
    account: true,
    rawJson: false,
    tokenExchange: true,
    tokenGrid: true,
  });

  // Token exchange details state
  const [tokenExchangeEvents, setTokenExchangeEvents] = useState([]);
  const [displayedTokenId, setDisplayedTokenId] = useState(null);

  // Token Card Grid state
  const [gridInspectedTokenType, setGridInspectedTokenType] = useState(null);
  const [gridInspectedTokenData, setGridInspectedTokenData] = useState(null);

  const handleGridInspect = useCallback((type, tokenData) => {
    setGridInspectedTokenType(type);
    setGridInspectedTokenData(tokenData);
    onOpenClaimsModal?.(type);
  }, [onOpenClaimsModal]);

  // Refetch token data whenever auth state changes or agent actions complete
  const fetchTokenData = useCallback(async (skipLoading = false) => {
    if (!skipLoading) setLoading(true);

    try {
      const statusRes = await bffAxios.get('/api/auth/oauth/user/status');
      setUserStatus(statusRes.data);
      setError(null);

      if (!statusRes.data.authenticated) {
        setError('no_session');
        setTokenClaims(null);
        setEnrichedInfo(null);
        setLoading(false);
        return;
      }

      const previewRes = await bffAxios.get('/api/tokens/session-preview');
      const events = previewRes.data?.tokenEvents || [];
      const userTokenEvent = events.find(
        (e) => e.decoded && (e.id === 'user-token' || e.label?.toLowerCase().includes('user'))
      );
      setTokenClaims(userTokenEvent?.decoded || null);
      setTokenExchangeEvents(events);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('OAuthInspectorSection fetch error:', err.message);
      setError('fetch_failed');
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTokenData();
  }, [fetchTokenData]);

  // When selectedToken changes, update the displayed token claims
  useEffect(() => {
    if (selectedToken) {
      // Use decoded data directly from the selected token if available
      if (selectedToken.decoded) {
        setTokenClaims(selectedToken.decoded);
        setDisplayedTokenId(selectedToken.id);
      } else {
        // If token doesn't have decoded data but has raw fields, construct claims
        // Extract all token-related fields (they might use different naming conventions)
        const constructedPayload = {
          sub: selectedToken.tokenSub,
          act: selectedToken.tokenAct,
          scope: selectedToken.tokenScope || selectedToken.scope,
          aud: selectedToken.tokenAud || selectedToken.aud,
          iat: selectedToken.tokenIat || selectedToken.iat,
          exp: selectedToken.tokenExp || selectedToken.exp,
          client_id: selectedToken.client_id,
          env: selectedToken.env,
          iss: selectedToken.iss,
          may_act: selectedToken.may_act,
          acr: selectedToken.acr,
        };
        // Filter out undefined/null values
        const payload = Object.fromEntries(
          Object.entries(constructedPayload).filter(([_, v]) => v !== undefined && v !== null)
        );
        setTokenClaims({ payload });
        setDisplayedTokenId(selectedToken.id);
      }
    } else if (displayedTokenId && tokenExchangeEvents.length > 0) {
      // If no token selected, revert to user token
      const userTokenEvent = tokenExchangeEvents.find(
        (e) => e.decoded && (e.id === 'user-token' || e.label?.toLowerCase().includes('user'))
      );
      setTokenClaims(userTokenEvent?.decoded || null);
      setDisplayedTokenId(null);
    }
  }, [selectedToken, tokenExchangeEvents, displayedTokenId]);

  useEffect(() => {
    if (!userStatus?.authenticated) return;
    let cancelled = false;
    setEnrichedLoading(true);
    fetchEnrichedUserInfo()
      .then((result) => { if (!cancelled) setEnrichedInfo(result); })
      .finally(() => { if (!cancelled) setEnrichedLoading(false); });
    return () => { cancelled = true; };
  }, [userStatus?.authenticated]);

  // Refetch token data when user authenticates (login)
  useEffect(() => {
    const handleAuth = () => {
      fetchTokenData(true); // skipLoading = true for faster UX
    };
    window.addEventListener('userAuthenticated', handleAuth);
    return () => window.removeEventListener('userAuthenticated', handleAuth);
  }, [fetchTokenData]);

  // Refetch token data when agent action completes (token exchange, etc.)
  useEffect(() => {
    const handleAgentResult = () => {
      fetchTokenData(true); // skipLoading = true for faster UX
    };
    window.addEventListener('banking-agent-result', handleAgentResult);
    return () => window.removeEventListener('banking-agent-result', handleAgentResult);
  }, [fetchTokenData]);

  // Periodically refetch to catch token refreshes and expiry updates (every 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      if (userStatus?.authenticated) {
        fetchTokenData(true); // skipLoading = true for background refresh
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [userStatus?.authenticated, fetchTokenData]);

  // Clear state when user logs out
  useEffect(() => {
    const handleLogout = () => {
      setUserStatus(null);
      setTokenClaims(null);
      setEnrichedInfo(null);
      setError('no_session');
      setLoading(false);
    };
    window.addEventListener('userLoggedOut', handleLogout);
    return () => window.removeEventListener('userLoggedOut', handleLogout);
  }, []);

  const expTs = tokenClaims?.payload?.exp;

  useEffect(() => {
    setIsExpired(expTs ? (expTs * 1000 < Date.now()) : false);
  }, [expTs]);

  // Capture token exchange events from agent actions
  useEffect(() => {
    const handleAgentResult = (e) => {
      const detail = e.detail || {};
      if (detail.tokenEvents && Array.isArray(detail.tokenEvents)) {
        setTokenExchangeEvents(prev => {
          const merged = [...(prev || []), ...detail.tokenEvents];
          // Keep last 20 events
          return merged.slice(-20);
        });
      }
    };
    window.addEventListener('banking-agent-token-events', handleAgentResult);
    return () => window.removeEventListener('banking-agent-token-events', handleAgentResult);
  }, []);

  // Also listen for generic agent result and extract token events from response
  useEffect(() => {
    const handleAgentResult = () => {
      // Fetch latest token events from session preview
      bffAxios.get('/api/tokens/session-preview')
        .then(res => {
          if (res.data?.tokenEvents) {
            setTokenExchangeEvents(res.data.tokenEvents);
          }
        })
        .catch(() => {});
    };
    window.addEventListener('banking-agent-result', handleAgentResult);
    return () => window.removeEventListener('banking-agent-result', handleAgentResult);
  }, []);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const renderSection = (key, title, icon, content) => (
    <div className="utfi-card" key={key}>
      <div className="utfi-card-header" onClick={() => toggleSection(key)}>
        <div className="utfi-card-title">
          <span className="utfi-section-icon">{icon}</span>
          {title}
        </div>
        <span className="utfi-toggle-icon">{expandedSections[key] ? '▼' : '▶'}</span>
      </div>
      {expandedSections[key] && (
        <div className="utfi-card-content">
          {content}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="utfi-inspector-section">
        <div className="utfi-section-header">
          <span className="utfi-section-icon">🔑</span>
          <h3>OAuth Token Inspector</h3>
        </div>
        <div className="utfi-loading">Loading token information…</div>
      </div>
    );
  }

  if (error === 'no_session') {
    return (
      <div className="utfi-inspector-section">
        <div className="utfi-section-header">
          <span className="utfi-section-icon">🔑</span>
          <h3>OAuth Token Inspector</h3>
        </div>
        <div className="utfi-card utfi-card--error">
          <div className="utfi-error-content">
            <div className="utfi-error-icon">🔒</div>
            <div>
              <h4>No Active OAuth Session</h4>
              <p>Sign in with PingOne OAuth to view your token information.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error === 'fetch_failed') {
    return (
      <div className="utfi-inspector-section">
        <div className="utfi-section-header">
          <span className="utfi-section-icon">🔑</span>
          <h3>OAuth Token Inspector</h3>
        </div>
        <div className="utfi-card utfi-card--error">
          <div className="utfi-error-content">
            <div className="utfi-error-icon">⚠️</div>
            <div>
              <h4>Failed to Load Token Data</h4>
              <p>Could not retrieve token information from the server. Please try again.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const payload = tokenClaims?.payload || {};
  const user = userStatus?.user;

  return (
    <div className="utfi-inspector-section">
      <div className="utfi-section-header">
        <span className="utfi-section-icon">🔑</span>
        <h3>OAuth Token Inspector</h3>
        <div className="utfi-status-badges">
          {displayedTokenId && (
            <span className="utfi-badge utfi-badge--info">Selected: {displayedTokenId}</span>
          )}
          {isExpired ? (
            <span className="utfi-badge utfi-badge--expired">⚠ Expired</span>
          ) : (
            <span className="utfi-badge utfi-badge--active">✓ Active</span>
          )}
          {userStatus?.oauthProvider && (
            <span className="utfi-badge utfi-badge--provider">{userStatus.oauthProvider}</span>
          )}
        </div>
      </div>

      <div className="utfi-sections">
        <div style={{ display: activeTab === 'exchange' ? 'none' : undefined }}>
          {renderSection('tokenGrid', 'Token Overview', '📊', (
            <TokenCardGrid
              userToken={tokenExchangeEvents.find((e) => e.id === 'user-token' || e.label?.toLowerCase().includes('user'))?.decoded || null}
              agentToken={tokenExchangeEvents.find((e) => e.label?.toLowerCase().includes('agent') || e.id?.toLowerCase().includes('agent'))?.decoded || null}
              mcpToken={tokenExchangeEvents.find((e) => e.label?.toLowerCase().includes('mcp') || e.id?.toLowerCase().includes('mcp') || e.label?.toLowerCase().includes('resource'))?.decoded || null}
              onInspectToken={handleGridInspect}
            />
          ))}

          <TokenCard decoded={tokenClaims} title="OAuth Token" defaultExpanded showHeader showIdentity showScopes showRaw />

          {renderSection('identity', 'Identity & Profile', '👤', (
            <>
              <ClaimRow label="Username" value={user?.username} />
              <ClaimRow label="Email" value={user?.email} />
              <ClaimRow label="Name" value={user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null} />
              <ClaimRow label="Subject (sub)" value={payload.sub} glossary={CLAIM_GLOSSARY.sub} />
            </>
          ))}

          {renderSection('authorization', 'Authorization', '🔑', (
            <>
              <div className="utfi-claim-row">
                <span className="utfi-claim-key" title={CLAIM_GLOSSARY.scope} style={{ cursor: 'help', borderBottom: '1px dotted #94a3b8' }}>
                  Scopes
                </span>
                <ScopesBadges scope={payload.scope} tokenLabel={displayedTokenId || 'customer access token (BFF session)'} />
              </div>
              {!payload.scope && (
                <div className="utfi-rfc-inline-hint">RFC 6749 §3.3 — the <strong>customer access token</strong> (stored server-side in the BFF session after PingOne login) has no scope claim in its JWT payload. MCP tool calls require scoped tokens. Sign out and sign in with the PingOne <em>customer</em> app configured to request <code>read</code> / <code>write</code> scopes.</div>
              )}
              <ClaimRow label="Audience (aud)" value={Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud} glossary={CLAIM_GLOSSARY.aud} />
              <ClaimRow label="Client ID" value={payload.client_id} glossary={CLAIM_GLOSSARY.client_id} />
              {payload.may_act && (
                <>
                  <ClaimRow label="may_act" value={payload.may_act} glossary={CLAIM_GLOSSARY.may_act} />
                  <div className="utfi-rfc-inline-hint utfi-rfc-inline-hint--good">✅ RFC 8693 §4.2 — may_act present. The BFF (client_id above) is pre-authorized to call Token Exchange on this user&apos;s behalf and obtain a delegated MCP token.</div>
                </>
              )}
              {!payload.may_act && payload.sub && (
                <div className="utfi-rfc-inline-hint">⚠️ RFC 8693 §4.2 — may_act absent. Token Exchange will fall back to subject-only mode (no act claim in MCP token, weaker delegation proof). Enable may_act in PingOne for full delegation.</div>
              )}
              {payload.act && (
                <div className="utfi-act-chain">
                  <span className="utfi-act-chain-label" title={CLAIM_GLOSSARY.act}>Actor chain (act) — RFC 8693 §4.1</span>
                  <code className="utfi-act-chain-value">{typeof payload.act === 'object' ? <JsonHighlight value={payload.act} /> : payload.act}</code>
                  <div className="utfi-rfc-inline-hint utfi-rfc-inline-hint--good">✅ act claim present — BFF identity is cryptographically bound in this token. MCP server can verify the delegation chain without trusting the caller.</div>
                </div>
              )}
              {payload.scope && (
                <div className="utfi-rfc-inline-hint utfi-rfc-inline-hint--info">RFC 6749 §3.3 · RFC 8693 §2.1 — Token Exchange can only narrow these scopes. The MCP token will carry a subset of what you see here.</div>
              )}
            </>
          ))}

          {(enrichedLoading || enrichedInfo?.error || hasAnyField(enrichedInfo?.data)) && renderSection('account', 'Account Information', '📋', (
            <>
              {enrichedLoading && <div className="utfi-muted">Loading PingOne profile…</div>}
              {enrichedInfo?.error && <div className="utfi-muted">⚠ {enrichedInfo.error}</div>}
              {enrichedInfo?.data && hasAnyField(enrichedInfo.data) && (
                <>
                  <ClaimRow label="Email" value={enrichedInfo.data.email} />
                  <ClaimRow label="Email Verified" value={enrichedInfo.data.email_verified != null ? String(enrichedInfo.data.email_verified) : null} />
                  <ClaimRow label="Phone" value={enrichedInfo.data.phone_number || enrichedInfo.data.phone} />
                </>
              )}
            </>
          ))}
        </div>

        <div style={{ display: activeTab === 'exchange' ? undefined : 'none' }}>
          {renderSection('tokenExchange', 'Token Exchange & Scopes', '🔄', (
            <>
              <TokenExchangeModeSummary
                tokens={[
                  { type: 'User', name: 'customer access token', issuedBy: 'PingOne AS', rfc8693Role: 'subject token' },
                  { type: 'Agent', name: 'BFF-delegated MCP token', issuedBy: 'PingOne AS (via RFC 8693)', rfc8693Role: 'delegated token' },
                  { type: 'MCP', name: 'resource-scoped access token', issuedBy: 'PingOne AS (RFC 8693 + 8707)', rfc8693Role: 'narrowed resource token' },
                ]}
              />
              <ScopeChangesCallout />
              <div className="utfi-token-exchange-events">
                {tokenExchangeEvents.length === 0 ? (
                  <div className="utfi-exchange-empty">
                    <p className="utfi-exchange-desc">Perform a banking action (transfer, deposit, etc.) to see token exchanges and scopes in real-time</p>
                    <div className="utfi-exchange-rfc-primer">
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 8693 §3.1</span> Subject token in → MCP access token out, scope narrowed, <code>act</code> claim added</div>
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 8707</span> <code>resource</code> parameter binds the new token to a single audience</div>
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 6749 §3.3</span> Exchange cannot grant scopes the user token doesn&apos;t already have</div>
                      <div className="utfi-exchange-primer-row"><span className="utfi-primer-rfc">RFC 9470</span> Step-up: if ACR is insufficient, the server challenges before exchange</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="utfi-exchange-desc">Real-time token lifecycle — scopes and claims as tokens are exchanged</p>
                    <div className="utfi-exchange-timeline">
                      {tokenExchangeEvents.map((evt, idx) => (
                        <div key={idx} className="utfi-exchange-event">
                          <div className="utfi-event-header">
                            <span className="utfi-event-time">{evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : 'N/A'}</span>
                            <span className={`utfi-event-status utfi-event-status--${evt.status || 'info'}`}>{evt.label || evt.id || 'Event'}</span>
                          </div>
                          <div className="utfi-event-details">
                            {(evt.explanation || evt.message) && (
                              <div className="utfi-event-message">{evt.explanation || evt.message}</div>
                            )}
                            {evt.exchangeRequest && (
                              <div className="utfi-event-json-block">
                                <div className="utfi-event-label">Exchange request</div>
                                <pre className="utfi-event-pre"><JsonHighlight value={evt.exchangeRequest} /></pre>
                              </div>
                            )}
                            {evt.decoded?.payload && (
                              <div className="utfi-event-claims">
                                {evt.decoded.payload.scope && (
                                  <div className="utfi-event-row">
                                    <span className="utfi-event-label">Scopes:</span>
                                    <div className="utfi-scopes-inline">
                                      {typeof evt.decoded.payload.scope === 'string'
                                        ? evt.decoded.payload.scope.split(' ').map((s, i) => <span key={i} className="utfi-scope-badge">{s}</span>)
                                        : <span className="utfi-scope-badge">{evt.decoded.payload.scope}</span>}
                                    </div>
                                  </div>
                                )}
                                {evt.decoded.payload.aud && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Audience (aud):</span><code className="utfi-event-value">{evt.decoded.payload.aud}</code></div>
                                )}
                                {evt.decoded.payload.act && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Actor (act):</span><code className="utfi-event-value"><JsonHighlight value={evt.decoded.payload.act} /></code></div>
                                )}
                                {evt.decoded.payload.may_act && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">May Act:</span><code className="utfi-event-value">✓ Delegation authorized</code></div>
                                )}
                                {evt.decoded.payload.sub && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Subject:</span><code className="utfi-event-value">{evt.decoded.payload.sub.slice(0, 16)}…</code></div>
                                )}
                                {evt.decoded.payload.acr && (
                                  <div className="utfi-event-row"><span className="utfi-event-label">Auth Level (acr):</span><span className="utfi-event-value">{evt.decoded.payload.acr}</span></div>
                                )}
                              </div>
                            )}
                            {!evt.decoded?.payload && evt.claims && (
                              <>
                                <div className="utfi-event-claims">
                                  {evt.claims.scope && (
                                    <div className="utfi-event-row">
                                      <span className="utfi-event-label">Scopes:</span>
                                      <div className="utfi-scopes-inline">
                                        {String(evt.claims.scope).split(' ').filter(Boolean).map((s) => (
                                          <span key={s} className="utfi-scope-badge">{s}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {evt.claims.aud && (
                                    <div className="utfi-event-row">
                                      <span className="utfi-event-label">Audience (aud):</span>
                                      <code className="utfi-event-value">
                                        {Array.isArray(evt.claims.aud) ? evt.claims.aud.join(' ') : String(evt.claims.aud)}
                                      </code>
                                    </div>
                                  )}
                                  {evt.exchangeRequest?.audience && !evt.claims.aud && (
                                    <div className="utfi-event-row">
                                      <span className="utfi-event-label">Requested aud:</span>
                                      <code className="utfi-event-value">{String(evt.exchangeRequest.audience)}</code>
                                    </div>
                                  )}
                                </div>
                                <div className="utfi-event-json-block">
                                  <div className="utfi-event-label">Token claims</div>
                                  <pre className="utfi-event-pre"><JsonHighlight value={evt.claims} /></pre>
                                </div>
                              </>
                            )}
                            {evt.error || evt.pingoneError ? (
                              <div className="utfi-event-message utfi-event-message--error">
                                {String(evt.pingoneError || evt.error)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN UNIFIED COMPONENT
// ============================================================================

export default function UnifiedTokenFlowInspector({ floatingByDefault = false, showToggle = true, showClose }) {
  const [isFloating, setIsFloating] = useState(floatingByDefault);
  // showClose defaults true; hide when showToggle=false (embedded in tab — tab is the dismiss)
  const effectiveShowClose = showClose !== false && showToggle !== false;
  const [snap, setSnap] = useState(() => agentFlowDiagram.getState());
  const [visible, setVisible] = useState(true);
  const [showLegendModal, setShowLegendModal] = useState(false);
  const [showClaimsModal, setShowClaimsModal] = useState(false);
  const [selectedTokenType, setSelectedTokenType] = useState(null);
  const [activeTab, setActiveTab] = useState('flow'); // 'flow', 'chain', or 'transform'

  // Token Transform tab data — gateway-audience-in vs backend-audience-out.
  const tokenChainCtx = useTokenChainOptional();
  const { data: gatewayLiveConfig } = useGatewayLiveConfig();
  const gwConfig = gatewayLiveConfig?.config || null;
  const lastTokenEvent = tokenChainCtx?.events?.length
    ? tokenChainCtx.events[tokenChainCtx.events.length - 1]
    : null;
  const lastInboundAud =
    getEventAudience(lastTokenEvent) || 'No token exchanged yet — run an agent action to populate this.';
  const utfiRouteCategory = getUtfiRouteCategory(snap.toolName);
  const lastRoutedBackendUri =
    utfiRouteCategory === 'api_key'
      ? UTFI_NO_EXCHANGE_NOTE
      : gwConfig
        ? (utfiRouteCategory === 'invest'
            ? gwConfig.mcpInvestResourceUri
            : utfiRouteCategory === 'banking_resource'
              ? gwConfig.bankingResourceServerResourceUri
              : gwConfig.mcpOlbResourceUri) || 'Not configured — push a gateway config first'
        : 'Gateway config not loaded — see Agent Gateway Configuration';

  const { pos, size, handleDragStart } = useDraggablePanel(
    () => ({
      x: Math.max(16, window.innerWidth - 900),
      y: Math.max(72, (window.innerHeight - 600) / 2),
    }),
    { w: 860, h: 560 }
  );

  useEffect(() => {
    const unsub = agentFlowDiagram.subscribe(setSnap);
    return unsub;
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setVisible(true);
      agentFlowDiagram.open();
      if (!agentFlowDiagram.getState().steps?.length) {
        agentFlowDiagram.reset();
      }
    };
    window.addEventListener('agent-flow-diagram-open', onOpen);
    return () => window.removeEventListener('agent-flow-diagram-open', onOpen);
  }, []);

  const handleClose = useCallback(() => {
    if (isFloating) {
      agentFlowDiagram.close();
    }
    setVisible(false);
    // If opened as a standalone pop-out (/agent), try to close the window
    // (Note: window.close() only works for windows opened by JavaScript, but won't harm)
    try {
      if (window.name === 'BankingAgent' && window.opener) {
        window.close();
      }
    } catch (e) {
      // Silently ignore if close is not allowed (security restriction)
    }
  }, [isFloating]);

  const handleEsc = useCallback((e) => {
    if (e.key === 'Escape' && effectiveShowClose) {
      handleClose();
    }
  }, [handleClose, effectiveShowClose]);

  const openClaimsModal = useCallback((tokenType) => {
    setSelectedTokenType(tokenType);
    setShowClaimsModal(true);
  }, []);

  const closeClaimsModal = useCallback(() => {
    setShowClaimsModal(false);
    setSelectedTokenType(null);
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  if (!visible) return null;

  const content = (
    <div className={`utfi-container ${isFloating ? 'utfi-floating' : 'utfi-fixed'}`}>
      <div className="utfi-header" onPointerDown={isFloating ? handleDragStart : undefined}>
        <div className="utfi-header-content">
          <h2 className="utfi-title">🔐 Agent & Token Flow Inspector</h2>
          <p className="utfi-subtitle">Real-time visibility into agent execution and OAuth token lifecycle</p>
        </div>
        <div className="utfi-header-actions">
          <button
            type="button"
            className="utfi-btn utfi-btn-primary"
            onClick={() => setShowLegendModal(true)}
            title="Show token legend"
            aria-label="Token Legend"
          >
            📋 Token Legend
          </button>
          {showToggle && (
            <button
              className="utfi-btn utfi-btn-primary"
              onClick={() => setIsFloating(!isFloating)}
              title={isFloating ? 'Dock panel' : 'Float panel'}
              aria-label={isFloating ? 'Dock' : 'Float'}
            >
              {isFloating ? '📌' : '⛓'}
            </button>
          )}
          {effectiveShowClose && (
            <button
              className="utfi-btn utfi-btn-close"
              onClick={handleClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="utfi-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'flow'}
          className={`utfi-tab${activeTab === 'flow' ? ' utfi-tab--active' : ''}`}
          onClick={() => setActiveTab('flow')}
        >
          Flow & Tokens
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chain'}
          className={`utfi-tab${activeTab === 'chain' ? ' utfi-tab--active' : ''}`}
          onClick={() => setActiveTab('chain')}
        >
          Token Chain
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'transform'}
          className={`utfi-tab${activeTab === 'transform' ? ' utfi-tab--active' : ''}`}
          onClick={() => setActiveTab('transform')}
        >
          Token Transform
        </button>
      </div>

      {activeTab === 'flow' ? (
        <FlowTokensPanel onOpenClaimsModal={openClaimsModal} />
      ) : activeTab === 'chain' ? (
        <div className="utfi-chain-view">
          <TokenChainTraceRail />
        </div>
      ) : (
        <div className="utfi-transform-view">
          <p className="utfi-rfc-inline-hint">
            What the gateway accepts on the way in vs. the audience it exchanges for on the way out to the
            routed backend (RFC 8693 · RFC 8707). {gwConfig && !snap.toolName && (
              <>No tool call yet this session — defaulting to the Online Banking backend (majority-case route).</>
            )}
          </p>
          <ClaimRow label="gateway-audience-in (aud)" value={lastInboundAud} glossary={CLAIM_GLOSSARY.aud} />
          <ClaimRow label="backend-audience-out" value={lastRoutedBackendUri} glossary={CLAIM_GLOSSARY.aud} />
        </div>
      )}

      <ClaimDetailsModal isOpen={showClaimsModal} tokenType={selectedTokenType} onClose={closeClaimsModal} />
      <TokenLegendModal isOpen={showLegendModal} onClose={() => setShowLegendModal(false)} />
    </div>
  );

  if (isFloating) {
    return (
      <>
        {snap.visible ? createPortal(
          <div
            className="utfi-floating-wrapper"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              width: size.w,
              height: size.h,
              zIndex: 10000,
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="utfi-title"
          >
            {content}
          </div>,
          document.body
        ) : null}
      </>
    );
  }

  return content;
}
