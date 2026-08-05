// banking_api_ui/src/components/education/PingOneAuthorizePanel.js
import { useCallback, useState, useEffect } from 'react';
import { getDecisions as getLiveDecisions, subscribe as subscribeLiveDecisions } from '../../services/authorizeDecisionStore';
import EducationDrawer from '../shared/EducationDrawer';
import JsonHighlight from '../shared/JsonHighlight';
import { EduImplIntro, SNIP_AUTHORIZE_GATE } from './educationImplementationSnippets';

// ─── Recent Decisions viewer (Phase 3) ───────────────────────────────────────

/** Formats ISO timestamp to a readable short string. */
const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
};

/** Decision badge — coloured pill for PERMIT / DENY / INDETERMINATE. */
function DecisionBadge({ decision }) {
  const colours = {
    PERMIT:        { background: '#dcfce7', color: '#15803d', border: '#86efac' },
    DENY:          { background: '#fee2e2', color: '#b91c1c', border: '#fca5a5' },
    INDETERMINATE: { background: '#fef9c3', color: '#854d0e', border: '#fde047' },
  };
  const style = colours[(decision || '').toUpperCase()] || colours.INDETERMINATE;
  return (
    <span style={{
      ...style,
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: '0.75rem',
      fontWeight: 700,
      border: `1px solid ${style.border}`,
      display: 'inline-block',
    }}>
      {decision || 'INDETERMINATE'}
    </span>
  );
}

/** Normalizes PingOne vs simulated decision rows for list display. */
function decisionRowMeta(d) {
  const params = d.request?.parameters || d.parameters || {};
  const type = params.TransactionType || d.type || 'evaluation';
  const amount = params.Amount;
  const time = d.createdAt || d.timestamp || d.recordedAt;
  return { type, amount, time, decision: d.decision || d.status };
}

/** Live recent decisions — user picks PingOne vs simulated via select; plus engine status. */
function RecentDecisionsViewer() {
  const [decisions, setDecisions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [source, setSource] = useState('pingone');
  const [evalStatus, setEvalStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);

  // AG-UI Step 6 — live decisions pushed from authorizeDecisionStore
  const [liveDecisions, setLiveDecisions] = useState(() => getLiveDecisions());
  useEffect(() => {
    setLiveDecisions(getLiveDecisions()); // sync on mount
    return subscribeLiveDecisions(setLiveDecisions);
  }, []);

  const handleFetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/authorize/evaluation-status', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setEvalStatus(await res.json());
    } catch (err) {
      setStatusError(err.message);
      setEvalStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDecisions(null);
    setExpanded(null);
    const url =
      source === 'simulated'
        ? '/api/authorize/simulated-recent-decisions?limit=10'
        : '/api/authorize/recent-decisions?limit=10';
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDecisions(data.decisions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  return (
    <div>
      <div
        style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          fontSize: '0.82rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <strong>Authorization engine</strong>
          <button
            type="button"
            onClick={handleFetchStatus}
            disabled={statusLoading}
            style={{
              background: '#475569',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: 'pointer',
              opacity: statusLoading ? 0.65 : 1,
            }}
          >
            {statusLoading ? 'Loading…' : 'Refresh status'}
          </button>
        </div>
        {statusError && (
          <div style={{ color: '#b91c1c', marginBottom: 6 }}>{statusError}</div>
        )}
        {evalStatus && (
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            <dt style={{ color: '#374151' }}>activeEngine</dt>
            <dd style={{ margin: 0, fontFamily: 'inherit' }}>{evalStatus.activeEngine}</dd>
            <dt style={{ color: '#374151' }}>authorize enabled</dt>
            <dd style={{ margin: 0 }}>{String(evalStatus.authorizeEnabledConfig)}</dd>
            <dt style={{ color: '#374151' }}>simulated mode</dt>
            <dd style={{ margin: 0 }}>{String(evalStatus.simulatedMode)}</dd>
            <dt style={{ color: '#374151' }}>PingOne configured</dt>
            <dd style={{ margin: 0 }}>{String(evalStatus.pingoneConfigured)}</dd>
            {evalStatus.mcpFirstToolGateEnabled !== undefined && (
              <>
                <dt style={{ color: '#374151' }}>MCP first-tool gate</dt>
                <dd style={{ margin: 0 }}>{String(evalStatus.mcpFirstToolGateEnabled)}</dd>
                <dt style={{ color: '#374151' }}>MCP decision endpoint set</dt>
                <dd style={{ margin: 0 }}>{String(evalStatus.mcpFirstToolDecisionEndpointConfigured)}</dd>
                <dt style={{ color: '#374151' }}>MCP gate live ready</dt>
                <dd style={{ margin: 0 }}>{String(evalStatus.mcpFirstToolPingOneReady)}</dd>
                <dt style={{ color: '#374151' }}>MCP gate would run (simulated)</dt>
                <dd style={{ margin: 0 }}>{String(evalStatus.mcpFirstToolWouldRunSimulated)}</dd>
                <dt style={{ color: '#374151' }}>MCP gate would run (live)</dt>
                <dd style={{ margin: 0 }}>{String(evalStatus.mcpFirstToolWouldRunLive)}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      <p style={{ fontSize: '0.85rem', lineHeight: 1.55 }}>
        Choose which decision history to load. <strong>PingOne</strong> needs{' '}
        <code>recordRecentRequests: true</code> on the endpoint (last 10, 24h window).{' '}
        <strong>Simulated</strong> reads the in-memory ring buffer on the BFF (no PingOne call).
      </p>
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <label
          htmlFor="pingone-authorize-recent-source"
          style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#334155', marginBottom: 6 }}
        >
          Recent decisions source
        </label>
        <select
          id="pingone-authorize-recent-source"
          value={source}
          onChange={(e) => {
            const v = e.target.value === 'simulated' ? 'simulated' : 'pingone';
            setSource(v);
            setDecisions(null);
            setError(null);
            setExpanded(null);
          }}
          style={{
            maxWidth: '100%',
            width: 'min(100%, 22rem)',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            fontSize: '0.88rem',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          <option value="pingone">PingOne Authorize (live API)</option>
          <option value="simulated">Simulated Authorize (education / in-memory)</option>
        </select>
      </div>
      <button
        type="button"
        onClick={handleFetch}
        disabled={loading}
        style={{
          background: 'var(--brand-navy)', color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 18px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
          opacity: loading ? 0.65 : 1,
        }}
      >
        {loading ? 'Loading…' : '↻ Fetch recent decisions'}
      </button>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fee2e2', borderRadius: 8, color: '#b91c1c', fontSize: '0.82rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* AG-UI Step 6 — live decisions pushed via STATE_DELTA (no polling needed) */}
      {liveDecisions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155' }}>
              Live (AG-UI)
            </span>
            <span style={{
              background: '#dcfce7', color: '#15803d', border: '1px solid #86efac',
              borderRadius: 10, padding: '1px 8px', fontSize: '0.72rem', fontWeight: 600,
            }}>
              {liveDecisions.length} decision{liveDecisions.length !== 1 ? 's' : ''}
            </span>
          </div>
          {liveDecisions.map((d, i) => (
            <div
              key={d.id || i}
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 12px', background: '#f0fdf4',
              }}>
                <DecisionBadge decision={d.decision} />
                <span style={{ fontSize: '0.8rem', color: '#374151', flex: 1 }}>
                  {d.policyId || 'policy evaluation'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {fmtTime(d.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {decisions && decisions.length === 0 && (
        <p style={{ color: '#374151', marginTop: 12, fontSize: '0.85rem' }}>
          No recent decisions found. Make a transfer or withdrawal with PingOne Authorize enabled,
          then come back here.
        </p>
      )}

      {decisions && decisions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {decisions.map((d, i) => {
            const row = decisionRowMeta(d);
            return (
            <div
              key={d.id || d.decisionId || i}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: '#f9fafb', cursor: 'pointer',
                  width: '100%', border: 'none', textAlign: 'left',
                }}
                onClick={() => setExpanded(expanded === i ? null : i)}
              >
                <DecisionBadge decision={row.decision} />
                <span style={{ fontSize: '0.8rem', color: '#374151', flex: 1 }}>
                  {row.type}
                  {row.amount != null && ` — $${row.amount}`}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#374151' }}>{fmtTime(row.time)}</span>
                <span style={{ color: '#374151', fontSize: '0.8rem' }}>{expanded === i ? '▲' : '▼'}</span>
              </button>
              {expanded === i && (
                <pre className="jh-dark" style={{
                  margin: 0, padding: '10px 14px',
                  background: '#1e1e2e', color: '#cdd6f4',
                  fontSize: '0.72rem', overflowX: 'auto', lineHeight: 1.5,
                }}>
                  <JsonHighlight value={d} />
                </pre>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Policy diagram (AI / MCP reference architecture) ───────────────────────

/**
 * Renders an inline SVG describing layered authorization: token claims and policy
 * checks (SUB, AUD, act, nested act) before an action is allowed.
 */
function AuthorizePolicyEducationDiagram() {
  return (
    <figure style={{ margin: '12px 0 4px' }}>
      <svg
        viewBox="0 0 420 432"
        role="img"
        aria-labelledby="p1z-authz-diagram-title"
        style={{
          width: '100%',
          maxWidth: 420,
          height: 'auto',
          display: 'block',
          borderRadius: 10,
          border: '1px solid #cbd5e1',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
        }}
      >
        <title id="p1z-authz-diagram-title">
          Authorization policy: verify subject in directory, audience for resource, and delegation chain before permit or deny
        </title>
        <defs>
          <marker id="authzArrowDown" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#475569" />
          </marker>
        </defs>

        {/* Token strip */}
        <rect x="70" y="12" width="280" height="48" rx="8" fill="#1e293b" stroke="#0f172a" strokeWidth="1" />
        <text x="210" y="34" textAnchor="middle" fill="#f8fafc" fontSize="13" fontFamily="system-ui, Segoe UI, sans-serif" fontWeight="600">
          Access token
        </text>
        <text x="210" y="50" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="inherit">
          validated (JWKS / introspection)
        </text>

        <line x1="210" y1="60" x2="210" y2="78" stroke="#64748b" strokeWidth="2" markerEnd="url(#authzArrowDown)" />

        {/* Policy bracket */}
        <rect x="24" y="82" width="372" height="246" rx="10" fill="#fff" stroke="#94a3b8" strokeWidth="1.5" />
        <text x="40" y="106" fill="#0f172a" fontSize="14" fontFamily="system-ui, Segoe UI, sans-serif" fontWeight="700">
          Policy
        </text>
        <text x="40" y="124" fill="#64748b" fontSize="10" fontFamily="system-ui, sans-serif">
          PingOne Authorize + app / MCP enforcement
        </text>

        {/* Check rows */}
        <g fontFamily="system-ui, Segoe UI, sans-serif">
          <rect x="36" y="136" width="348" height="42" rx="6" fill="#eff6ff" stroke="#93c5fd" />
          <text x="48" y="156" fill="var(--brand-navy)" fontSize="11" fontWeight="600">1. SUB — user in IdP directory</text>
          <text x="48" y="170" fill="#475569" fontSize="9">Subject exists / eligible (PingOne user store; sent as UserId to Authorize)</text>

          <rect x="36" y="184" width="348" height="42" rx="6" fill="#f0fdf4" stroke="#86efac" />
          <text x="48" y="204" fill="#14532d" fontSize="11" fontWeight="600">2. AUD — audience = resource URL</text>
          <text x="48" y="218" fill="#475569" fontSize="9">Token was minted for this API or MCP resource (prevents wrong-audience replay)</text>

          <rect x="36" y="232" width="348" height="42" rx="6" fill="#faf5ff" stroke="#d8b4fe" />
          <text x="48" y="252" fill="#581c87" fontSize="11" fontWeight="600">3. act — delegation (MCP / exchange layer)</text>
          <text x="48" y="266" fill="#475569" fontSize="9">Who performed token exchange on behalf of sub (e.g. act.client_id, act.sub)</text>

          <rect x="36" y="280" width="348" height="40" rx="6" fill="#fff7ed" stroke="#fdba74" />
          <text x="48" y="300" fill="#9a3412" fontSize="11" fontWeight="600">4. act.act — nested actor (e.g. upstream agent)</text>
          <text x="48" y="314" fill="#475569" fontSize="9">Optional second hop — multi-hop delegation must match allow-lists</text>
        </g>

        <line x1="210" y1="328" x2="210" y2="346" stroke="#64748b" strokeWidth="2" markerEnd="url(#authzArrowDown)" />

        <rect x="95" y="350" width="230" height="44" rx="8" fill="#0d9488" stroke="#0f766e" strokeWidth="1" />
        <text x="210" y="372" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="system-ui, sans-serif" fontWeight="700">
          PERMIT · DENY · obligations
        </text>
        <text x="210" y="386" textAnchor="middle" fill="#ccfbf1" fontSize="9" fontFamily="system-ui, sans-serif">
          (e.g. step-up MFA, audit record)
        </text>
      </svg>
      <figcaption style={{ fontSize: '0.78rem', color: '#374151', marginTop: 10, lineHeight: 1.5 }}>
        Super Banking maps these ideas to <strong>Trust Framework parameters</strong> for PingOne Authorize (transactions and optional MCP first-tool
        gate) and to <strong>token validation</strong> on the Banking API and MCP server. The diagram is a mental model — configure attribute names
        in PingOne to match what the BFF sends.
      </figcaption>
    </figure>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function PingOneAuthorizePanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    // ── What it does ────────────────────────────────────────────────────────
    {
      id: 'what',
      label: 'What it does',
      content: (
        <>
          <p>
            <strong>PingOne Authorize</strong> is a cloud-based, fine-grained authorization
            service. Instead of embedding "if amount &gt; $X deny" logic in your app, you
            define policies in PingOne and the BFF asks PingOne whether the action is
            permitted — in real time, for every transaction.
          </p>
          <p>
            In Super Banking, PingOne Authorize gates every <strong>transfer</strong> and{' '}
            <strong>withdrawal</strong> for non-admin users. The response is one of:
          </p>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <li><strong>PERMIT</strong> — transaction proceeds</li>
            <li><strong>DENY</strong> — transaction is blocked (403)</li>
            <li><strong>INDETERMINATE</strong> — policy could not decide (treated as deny)</li>
            <li><strong>Step-up obligation</strong> — policy permits but requires MFA first (428 + CIBA flow)</li>
          </ul>
          <p style={{ background: '#eff6ff', padding: '10px 14px', borderRadius: 8, fontSize: '0.88rem', border: '1px solid #bfdbfe' }}>
            <strong>Education mode:</strong> Admin → <strong>Feature Flags</strong> → enable <strong>Transaction authorization</strong> and{' '}
            <strong>Simulated Authorize (education)</strong>. The BFF runs a small in-process policy (no PingOne API) that returns the same
            status codes and fields as live Authorize, including <code>authorize_engine: &quot;simulated&quot;</code> on 403/428. Turn simulation{' '}
            <strong>off</strong> and configure a decision endpoint (or policy ID) + worker app to use real PingOne Authorize.
          </p>
          <p>
            Official docs:{' '}
            <a href="https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html" target="_blank" rel="noopener noreferrer">
              Authorization using PingOne Authorize
            </a>{' '}·{' '}
            <a href="https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints.html" target="_blank" rel="noopener noreferrer">
              Decision Endpoints API
            </a>
          </p>
          <h4 style={{ color: "#1e293b", marginBottom: "0.5rem", marginTop: "1.5rem" }}>Policy example</h4>
          <p style={{ color: "#374151", marginBottom: "0.75rem" }}>
            A customer on the basic tier requests an upgrade to Platinum. PingOne Authorize evaluates: <code className="edu-code">tool=upgrade_tier</code>, <code className="edu-code">targetField=tier</code>, <code className="edu-code">targetValue=Platinum</code>, <code className="edu-code">customerTier=basic</code> → <strong>DENY</strong>. The policy returns a denial with the matched rule visible in the Recent Decisions view. The agent receives the denial and can explain to the user why the upgrade isn't available.
          </p>
          <p style={{ color: "#374151", marginBottom: "0.75rem" }}>
            The policy logic lives centrally in PingOne Authorize — not in the agent, the MCP server, or the gateway. Any of those components changing doesn't affect the policy. New tools automatically get evaluated against the same rules without code changes.
          </p>
        </>
      ),
    },

    // ── Flow ────────────────────────────────────────────────────────────────
    {
      id: 'flow',
      label: 'Request flow',
      content: (
        <>
          <h3>What happens on every transfer</h3>
          <pre className="edu-code">{`1. Customer initiates transfer ($500)
   POST /api/transactions  { type: "transfer", amount: 500 }

2. BFF checks configStore: authorize_enabled = "true"
   If ff_authorize_real = "false" → in-process simulatedAuthorizeService (no PingOne call)
   Else selects API path:
     • authorize_decision_endpoint_id set → Decision Endpoints API (Phase 2)
     • authorize_policy_id set            → Legacy PDP API (Phase 1 fallback)

3. BFF obtains worker token (client_credentials)   [skipped when simulated]
   POST {issuer}/as/token
     client_id=<worker_app>  client_secret=<secret>

4. BFF calls PingOne Authorize (Phase 2 path):
   POST /v1/environments/{envId}/decisionEndpoints/{endpointId}
   {
     "parameters": {
       "Amount": 500,
       "TransactionType": "transfer",
       "UserId": "user-abc123",
       "Acr": "MFA",
       "Timestamp": "2026-03-27T10:00:00Z"
     }
   }

5. PingOne evaluates against your policy + Trust Framework attributes

6. Response:
   { "decision": "PERMIT" }          → transaction executes
   { "decision": "DENY" }            → 403 transaction_denied
   obligation: STEP_UP               → 428 step_up_required → CIBA flow`}</pre>

          <h3>Phase 1 vs Phase 2 API path</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: 8 }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>Phase</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>URL</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>Config field</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}>Phase 2</td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'inherit', fontSize: '0.75rem' }}>/decisionEndpoints/{'{endpointId}'}</td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}><code>authorize_decision_endpoint_id</code></td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', color: '#15803d', fontWeight: 700 }}>✅ Preferred</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}>Phase 1</td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'inherit', fontSize: '0.75rem' }}>/governance/policyDecisionPoints/{'{policyId}'}/evaluate</td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}><code>authorize_policy_id</code></td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', color: '#b45309' }}>⚠️ Legacy fallback</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}>Phase 2 — MCP</td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'inherit', fontSize: '0.75rem' }}>/decisionEndpoints/{'{endpointId}'}</td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}><code>authorize_mcp_decision_endpoint_id</code></td>
                <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', color: '#0369a1' }}>Optional — first MCP tool</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: 8 }}>
            The BFF picks Phase 2 if <code>authorize_decision_endpoint_id</code> is set; falls back
            to Phase 1 otherwise. Both paths return <code>{'{ decision, stepUpRequired, raw }'}</code>
            so no other code changes.
          </p>
          <h3 style={{ marginTop: '1.25rem' }}>MCP first tool (BankingAgent)</h3>
          <p style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
            Feature flag <code>ff_authorize_mcp_first_tool</code> (Admin → Feature Flags) runs Authorize once per session on{' '}
            <code>POST /api/mcp/tool</code> when a delegated MCP access token is used. Live PingOne requires{' '}
            <strong>Application Configuration</strong> → <code>authorize_mcp_decision_endpoint_id</code> (or env{' '}
            <code>PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID</code>) pointing at a <strong>separate</strong> decision endpoint
            whose policy understands Trust Framework parameters including <code>DecisionContext: McpFirstTool</code>,{' '}
            <code>ToolName</code>, <code>TokenAudience</code>, <code>ActClientId</code>, <code>NestedActClientId</code>,{' '}
            <code>McpResourceUri</code>. With <strong>Simulated Authorize</strong> on, the same flag uses in-process rules;
            optional <code>SIMULATED_MCP_DENY_TOOLS</code> can force DENY per tool name. <strong>Refresh status</strong> on the
            Recent Decisions tab surfaces <code>mcpFirstTool*</code> fields from <code>/api/authorize/evaluation-status</code>.
          </p>
        </>
      ),
    },

    // ── Why + diagram + security (AI / MCP policy model) ─────────────────────
    {
      id: 'policy-mcp',
      label: 'Why & security (AI/MCP)',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Why authorization is layered</h3>
          <p style={{ fontSize: '0.88rem', lineHeight: 1.65 }}>
            <strong>Authentication</strong> proves who signed in (OAuth, OIDC). <strong>Authorization</strong> decides whether that identity — and
            any <strong>delegation chain</strong> (AI agent, MCP, token exchange) — is allowed to perform a specific action. Architecture diagrams
            often show a <strong>Policy</strong> step that checks not only the user (<strong>sub</strong>) but also <strong>aud</strong> (which
            resource the token is for) and <strong>act</strong> / <strong>act.act</strong> (who is acting on whose behalf). That keeps
            high-value rules in <strong>PingOne Authorize</strong> and cryptographic checks at the <strong>resource servers</strong>, instead of
            scattering one-off <code>if</code> statements in every service.
          </p>

          <AuthorizePolicyEducationDiagram />

          <h3>What each check is for</h3>
          <ul style={{ paddingLeft: 20, lineHeight: 1.75, fontSize: '0.86rem' }}>
            <li>
              <strong>SUB (directory)</strong> — Tie the request to a real user in PingOne. Stolen or synthetic subjects should fail policy or
              directory-backed rules.
            </li>
            <li>
              <strong>AUD (audience)</strong> — Ensure the token was issued for <em>this</em> resource (Banking API or MCP URI). Stops tokens from
              one API being replayed against another.
            </li>
            <li>
              <strong>act</strong> — After RFC 8693 token exchange, the token carries <em>who exchanged it</em> (e.g. BFF or MCP-related actor).
              Policies can allow-list trusted exchangers.
            </li>
            <li>
              <strong>Nested act</strong> — If PingOne issues multi-hop delegation, <strong>act.act</strong> identifies the upstream agent; policies
              can require that only approved agents appear in the chain.
            </li>
          </ul>

          <h3>Security properties</h3>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              fontSize: '0.84rem',
              lineHeight: 1.65,
            }}
          >
            <p style={{ margin: '0 0 10px' }}>
              <strong>Defense in depth.</strong> OAuth correctness (signature, expiry, <code>aud</code>, introspection) is enforced at the
              Banking API and MCP server. PingOne Authorize adds <strong>central policy</strong> (permit/deny/step-up) using <strong>Trust Framework
              parameters</strong> derived from the same facts — IAM teams can change rules without redeploying every microservice.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <strong>Least privilege.</strong> Scopes limit what a token can do; <code>aud</code> limits where it can be used; <strong>may_act</strong>{' '}
              / <strong>act</strong> limit who may exchange or act on behalf of the user.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <strong>Operational risk.</strong> If Authorize is misconfigured or unreachable, <strong>fail-open</strong> behavior can weaken
              security — keep <code>ff_authorize_fail_open</code> aligned with your risk appetite in production. Worker credentials for Authorize
              belong on the <strong>BFF</strong>, not in the browser.
            </p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#374151' }}>
              Reference: PingOne Authorize overview —{' '}
              <a href="https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html" target="_blank" rel="noopener noreferrer">
                docs
              </a>
              . In-repo parameter mapping: <code>docs/PINGONE_AUTHORIZE_PLAN.md</code> (Policy checklist table).
            </p>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', marginTop: 12, marginBottom: 0 }}>
            <strong>Next:</strong> open the <strong>Configure MCP (PingOne &amp; env)</strong> tab for the step-by-step PingOne policy parameters, BFF
            flags, and MCP host environment variables.
          </p>
        </>
      ),
    },

    // ── MCP: PingOne policies + BFF + MCP host env (operator checklist) ───────
    {
      id: 'mcp-config',
      label: 'Configure MCP (PingOne & env)',
      content: (
        <>
          <p style={{ marginTop: 0, fontSize: '0.88rem', lineHeight: 1.6 }}>
            Use this checklist to align <strong>PingOne Authorize</strong>, the <strong>BFF</strong>, and the <strong>MCP server</strong> so the MCP
            first-tool path matches your architecture diagram (subject, audience, delegation chain).
          </p>

          <h3>1. PingOne Authorize — MCP decision endpoint policy</h3>
          <p style={{ fontSize: '0.84rem', lineHeight: 1.6 }}>
            Create a <strong>dedicated decision endpoint</strong> for MCP (separate from transaction banking rules). In the policy / Trust Framework,
            define attributes that match the parameters the BFF sends so you can write rules on the same facts as your diagram.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginTop: 8 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e2e8f0' }}>Parameter</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e2e8f0' }}>Role in policy</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['DecisionContext', 'Must include McpFirstTool — branch MCP vs transaction policies'],
                ['UserId', 'PingOne subject (sub); directory / eligibility rules'],
                ['TokenAudience', 'JWT aud (resource audience); match expected MCP/BFF resource'],
                ['McpResourceUri', 'Expected MCP resource URI from config (align with MCP_SERVER_RESOURCE_URI)'],
                ['ActClientId', 'From act.client_id on the MCP access token — allow-list exchangers / MCP layer'],
                ['NestedActClientId', 'From nested act.act when present — upstream agent allow-list'],
                ['ToolName', 'First tool name (optional finer rules per tool)'],
                ['Acr', 'End-user ACR when available (step-up)'],
              ].map(([param, role]) => (
                <tr key={param}>
                  <td style={{ padding: '6px 8px', border: '1px solid #e2e8f0', fontFamily: 'inherit', fontWeight: 600 }}>{param}</td>
                  <td style={{ padding: '6px 8px', border: '1px solid #e2e8f0', color: '#334155' }}>{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.78rem', color: '#374151', marginTop: 8 }}>
            Worker app credentials for calling the decision API are the same pattern as transaction Authorize (see <strong>PingOne setup</strong> tab).
          </p>

          <h3>2. Runtime — turn the MCP Authorize path on (BFF)</h3>
          <ul style={{ paddingLeft: 20, lineHeight: 1.75, fontSize: '0.84rem' }}>
            <li>
              <strong>Feature flag:</strong> <code>ff_authorize_mcp_first_tool</code> → <strong>Enabled</strong> (Admin → Feature Flags). Gates{' '}
              <code>POST /api/mcp/tool</code> once per session when a delegated MCP access token is present.
            </li>
            <li>
              <strong>Config:</strong> <code>authorize_mcp_decision_endpoint_id</code> (or env{' '}
              <code>PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID</code>) → ID of the MCP decision endpoint from step 1. Without this (and without
              simulated Authorize), live PingOne evaluation is skipped.
            </li>
            <li>
              <strong>Education:</strong> With <strong>Simulated Authorize</strong>, you can exercise the gate without PingOne; use{' '}
              <strong>Refresh status</strong> on Recent Decisions to see <code>mcpFirstTool*</code> fields.
            </li>
          </ul>

          <h3>3. MCP host — environment variables</h3>
          <p style={{ fontSize: '0.84rem', lineHeight: 1.6 }}>
            Set these on the machine that runs <code>demo_mcp_server</code> (Railway, Render, Fly, etc.), not on the Vercel static UI.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginTop: 8 }}>
            <thead>
              <tr style={{ background: '#ecfdf5' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #bbf7d0' }}>Variable</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #bbf7d0' }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['MCP_SERVER_RESOURCE_URI', 'Required for strict audience: introspected token aud must include this URI (diagram: resource URL).'],
                ['MCP_EXPECTED_ACT_SUB', 'Optional — if set, token must have act.sub equal to this value (diagram: MCP identity as URI).'],
                ['MCP_EXPECTED_ACT_CLIENT_ID', 'Optional — if set, act.client_id must match (PingOne often omits act.sub; use this for MCP/BFF client id).'],
                ['MCP_EXPECTED_ACT_ACT_SUB', 'Optional — if set, act.act.sub must match (nested agent URI).'],
                ['BFF_CLIENT_ID + REQUIRE_MAY_ACT=true', 'Optional — require may_act.client_id to match BFF after exchange.'],
              ].map(([v, p]) => (
                <tr key={v}>
                  <td style={{ padding: '6px 8px', border: '1px solid #d1fae5', fontFamily: 'inherit', fontWeight: 600, verticalAlign: 'top' }}>{v}</td>
                  <td style={{ padding: '6px 8px', border: '1px solid #d1fae5', color: '#334155', verticalAlign: 'top' }}>{p}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #fde68a',
              background: '#fffbeb',
              fontSize: '0.82rem',
              lineHeight: 1.55,
            }}
          >
            <strong>act.sub vs act.client_id</strong> — PingOne may issue <code>act.client_id</code> without <code>act.sub</code>. Authorize policies
            should use <strong>ActClientId</strong> (and <strong>NestedActClientId</strong>) from the BFF parameters to allow-list actors. On the MCP
            server, set <strong>either</strong> <code>MCP_EXPECTED_ACT_SUB</code> (URI-style identity) <strong>or</strong>{' '}
            <code>MCP_EXPECTED_ACT_CLIENT_ID</code> (match the exchanger’s client id), or <strong>both</strong> when your tokens include both claims.
          </div>

          <p style={{ fontSize: '0.78rem', color: '#374151', marginTop: 12, marginBottom: 0 }}>
            Long-form reference: <code>docs/PINGONE_AUTHORIZE_PLAN.md</code> (Policy checklist + operational summary).
          </p>
        </>
      ),
    },

    // ── PingOne setup ────────────────────────────────────────────────────────
    {
      id: 'setup',
      label: 'PingOne setup',
      content: (
        <>
          <h3>Prerequisites in PingOne Authorize</h3>
          <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
            <li>
              <strong>Create a policy</strong> in PingOne Authorize with your rules (e.g.
              "deny payments &gt; $10,000", "require MFA for transfers &gt; $500").
              See the{' '}
              <a href="https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html" target="_blank" rel="noopener noreferrer">
                PingOne Authorize overview tutorials
              </a>.
            </li>
            <li>
              <strong>Create a Decision Endpoint</strong> in{' '}
              <em>Authorization → Decision Endpoints</em>. Copy the <strong>Endpoint ID</strong>.
              Enable <code>recordRecentRequests</code> on the <em>Test</em> endpoint for debugging.
            </li>
            <li>
              <strong>Define Trust Framework attributes</strong> that match the parameter names
              the BFF sends: <code>Amount</code>, <code>TransactionType</code>,{' '}
              <code>UserId</code>, <code>Acr</code>, <code>Timestamp</code>.
            </li>
            <li>
              <strong>Create a Worker application</strong> in PingOne (type: Worker, grant:
              client_credentials). Grant it the <em>PingOne Authorize Evaluator</em> role
              (or equivalent). Copy the Client ID and Secret.
            </li>
          </ol>

          <h3>Super Banking config fields</h3>
          <p>Set these in <strong>Admin → Config → PingOne Authorize</strong>:</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>Field</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', border: '1px solid #e5e7eb' }}>Where to get it</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Enable PingOne Authorize', 'Set to Enabled'],
                ['Decision Endpoint ID', 'PingOne → Authorization → Decision Endpoints → (endpoint) → ID'],
                ['Worker App Client ID', 'PingOne → Applications → (worker app) → Client ID'],
                ['Worker App Client Secret', 'PingOne → Applications → (worker app) → Client Secret'],
              ].map(([field, source]) => (
                <tr key={field}>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontWeight: 600 }}>{field}</td>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', color: '#4b5563' }}>{source}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: 10 }}>
            Or set <code>PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID</code>,{' '}
            <code>PINGONE_AUTHORIZE_WORKER_CLIENT_ID</code>, and{' '}
            <code>PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET</code> as environment variables.
          </p>
        </>
      ),
    },

    // ── Trust Framework attributes ────────────────────────────────────────
    {
      id: 'attributes',
      label: 'Trust Framework',
      content: (
        <>
          <p>
            PingOne Authorize evaluates policies using <strong>attributes</strong> defined in the
            Trust Framework. The BFF sends these as <code>parameters</code> in the decision request.
            Create matching attribute definitions in{' '}
            <em>Authorization → Trust Framework → Attributes</em>.
          </p>

          <pre className="edu-code">{`// Decision request body (Phase 2)
POST /v1/environments/{envId}/decisionEndpoints/{endpointId}
{
  "parameters": {
    "Amount":          500,            // Number — transaction amount
    "TransactionType": "transfer",     // String — "transfer" | "withdrawal"
    "UserId":          "user-abc123",  // String — PingOne subject ID
    "Acr":             "MFA",          // String — ACR from user token
    "Timestamp":       "2026-03-27T10:00:00Z"
  }
}`}</pre>

          <h3>Example policy rules</h3>
          <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
            <li>
              <strong>Deny high value:</strong>{' '}
              <code>Amount &gt; 10000 → DENY</code>
            </li>
            <li>
              <strong>Step-up MFA:</strong>{' '}
              <code>Amount &gt; 500 AND Acr != "MFA" → obligation: STEP_UP</code>
            </li>
            <li>
              <strong>Permit routine:</strong>{' '}
              <code>Amount ≤ 500 → PERMIT</code>
            </li>
          </ul>

          <p>
            See the tutorial:{' '}
            <a href="https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_tutorial_decision_requests_and_recent_decisions.html" target="_blank" rel="noopener noreferrer">
              Making decision requests and examining recent decisions
            </a>.
          </p>
        </>
      ),
    },

    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>MCP first-tool gate (optional)</h3>
          <EduImplIntro repoPath="demo_api_server/services/mcpToolAuthorizationService.js">
            Transactions use a separate path in <code>routes/transactions.js</code>; this snippet is the MCP mirror when <code>ff_authorize_mcp_first_tool</code> is on.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_AUTHORIZE_GATE}</pre>
        </>
      ),
    },

    // ── Recent decisions ─────────────────────────────────────────────────
    {
      id: 'recent',
      label: 'Recent Decisions',
      content: (
        <>
          <p style={{ color: "#374151", marginBottom: "1rem" }}>
            The PingOne Authorize console Recent Decisions view shows which rule fired, the full input parameters evaluated, and the decision output — useful for diagnosing unexpected PERMIT or DENY results during a demo.
          </p>
          <RecentDecisionsViewer />
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="PingOne Authorize — Policy-Based Authorization"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
