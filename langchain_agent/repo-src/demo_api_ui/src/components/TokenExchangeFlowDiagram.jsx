// banking_api_ui/src/components/TokenExchangeFlowDiagram.jsx
import React, { useState } from 'react';
import { useEducationUIOptional } from '../context/EducationUIContext';
import './TokenExchangeFlowDiagram.css';

const VALID_MODES = ['single', 'double'];

const ACTOR_Y  = 12;
const BOX_W    = 110;
const BOX_H    = 56;
const BOX_RX   = 8;
const ARROW_Y  = ACTOR_Y + BOX_H / 2;
const DROP_Y   = ACTOR_Y + BOX_H + 14;
const LABEL_Y1 = DROP_Y + 16;
const LABEL_Y2 = DROP_Y + 30;
const SVG_H    = 124;
const VIEW_W   = 920;

const ACTORS = {
  single: [
    { id: 'user',    label: 'User',             sub: 'Browser',                 cls: 'user'    },
    { id: 'bff',     label: 'BFF',              sub: 'Backend',                 cls: 'bff'     },
    { id: 'pingone', label: 'PingOne',           sub: 'Demo User App',           cls: 'pingone' },
    { id: 'mcp',     label: 'MCP Server',        sub: 'Tool Server',             cls: 'mcp'     },
  ],
  double: [
    { id: 'user',    label: 'User',             sub: 'Browser',                 cls: 'user'    },
    { id: 'agent',   label: 'AI Agent',         sub: 'Demo AI Agent App \u{1F916}', cls: 'agent' },
    { id: 'bff',     label: 'BFF',              sub: 'Backend',                 cls: 'bff'     },
    { id: 'pingone', label: 'PingOne',           sub: 'Demo Token Exchanger App', cls: 'pingone' },
    { id: 'mcp',     label: 'MCP Server',        sub: 'Tool Server',             cls: 'mcp'     },
  ],
};

const ARROWS = {
  single: [
    { from: 'user', to: 'bff', label: 'User Token', rfc: 'OIDC Auth Code + PKCE', tokenType: 'user', step: 1, edu: 'login-flow', tooltip: 'User authenticates via OIDC Auth Code + PKCE. Browser receives a user token with a may_act claim that pre-authorises future delegation to an agent.' },
    { from: 'bff', to: 'pingone', label: 'Exchange', rfc: 'RFC 8693 \u00a72.1', tokenType: 'user', step: 2, edu: 'token-exchange', tooltip: 'RFC 8693 \u00a72.1: BFF calls PingOne /token with subject_token (user token), requesting a narrowed MCP token. This is the 1-exchange (subject-only) path.' },
    { from: 'pingone', to: 'mcp', label: 'MCP Token', rfc: 'RFC 8693 \u00a72.1 response', tokenType: 'mcp', step: 3, edu: 'token-exchange', tooltip: 'PingOne validates may_act and issues an MCP token: sub=user_id, aud=mcp-gw. No act claim \u2014 subject-only, least-privilege delegation. The gateway forwards this token unchanged to the MCP server.' },
  ],
  double: [
    { from: 'user', to: 'agent', label: 'User Token', rfc: 'OIDC Auth Code + PKCE', tokenType: 'user', step: 1, edu: 'may-act', tooltip: "User authenticates. User token includes may_act claim explicitly granting delegation rights to the AI Agent's client_id." },
    { from: 'agent', to: 'bff', label: 'Actor Token', rfc: 'RFC 8693 \u00a74 actor', tokenType: 'agent', step: 2, edu: 'token-exchange', tooltip: 'AI Agent obtains its own actor_token via client credentials, then forwards both the user token (subject) and actor_token (actor) to the BFF for chained exchange.' },
    { from: 'bff', to: 'pingone', label: 'Exchange', rfc: 'RFC 8693 \u00a74', tokenType: 'agent', step: 3, edu: 'token-exchange', tooltip: 'RFC 8693 \u00a74: BFF sends subject_token + actor_token to PingOne. PingOne validates may_act and builds a delegation chain tracking user to agent.' },
    { from: 'pingone', to: 'mcp', label: 'MCP Token', rfc: 'RFC 8693 nested act', tokenType: 'mcp', step: 4, edu: 'token-exchange', tooltip: 'PingOne issues MCP token with full delegation chain: sub=user_id, act={ client_id: agent_id }. Agent accountability is preserved end-to-end.' },
  ],
};

function computeLayout(actors) {
  const count = actors.length;
  const gapX  = (VIEW_W - count * BOX_W) / (count + 1);
  return actors.map((a, i) => {
    const x = gapX + i * (BOX_W + gapX);
    return { ...a, x, cx: x + BOX_W / 2 };
  });
}

export default function TokenExchangeFlowDiagram({ mode = 'single', className = '', onEducation }) {
  const [hoveredStep, setHoveredStep] = useState(null);
  const edu = useEducationUIOptional();

  const safeMode = VALID_MODES.includes(mode) ? mode : 'single';
  if (mode !== safeMode) {
    console.warn(`TokenExchangeFlowDiagram: invalid mode "${mode}", defaulting to "single"`);
  }

  const actors   = ACTORS[safeMode];
  const arrows   = ARROWS[safeMode];
  const layout   = computeLayout(actors);
  const actorMap = Object.fromEntries(layout.map(a => [a.id, a]));

  function openEducation(panelId) {
    if (typeof onEducation === 'function') {
      onEducation(panelId);
    } else if (edu && edu.open) {
      edu.open(panelId);
    } else {
      window.dispatchEvent(new CustomEvent('open-education', { detail: { panel: panelId } }));
    }
  }

  const hoveredArrow = arrows.find(a => a.step === hoveredStep);

  return (
    <div className={`tefd-root${safeMode === 'double' ? ' tefd-root--double' : ''}${className ? ` ${className}` : ''}`}>
      <svg
        className="tefd-svg"
        viewBox={`0 0 ${VIEW_W} ${SVG_H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={safeMode === 'double' ? 'RFC 8693 2-exchange flow diagram' : 'RFC 8693 1-exchange flow diagram'}
      >
        <title>{safeMode === 'double' ? 'RFC 8693 2-Exchange: User to AI Agent to BFF to PingOne to MCP Server' : 'RFC 8693 1-Exchange: User to BFF to PingOne to MCP Server'}</title>
        <defs>
          {['user', 'agent', 'mcp'].map(type => (
            <marker key={type} id={`tefd-arrow-${type}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={`tefd-arrowhead tefd-arrowhead--${type}`} />
            </marker>
          ))}
        </defs>
        {layout.map(actor => (
          <g key={actor.id} className={`tefd-actor tefd-actor--${actor.cls}`}>
            <rect x={actor.x} y={ACTOR_Y} width={BOX_W} height={BOX_H} rx={BOX_RX} className={`tefd-box tefd-box--${actor.cls}`} />
            <text x={actor.cx} y={ACTOR_Y + 23} textAnchor="middle" className="tefd-actor-name">{actor.label}</text>
            <text x={actor.cx} y={ACTOR_Y + 39} textAnchor="middle" className="tefd-actor-sub">{actor.sub}</text>
          </g>
        ))}
        {arrows.map(arrow => {
          const from   = actorMap[arrow.from];
          const to     = actorMap[arrow.to];
          const x1     = from.x + BOX_W + 2;
          const x2     = to.x - 2;
          const midX   = (x1 + x2) / 2;
          const active = hoveredStep === arrow.step;
          return (
            <g key={arrow.step} className={`tefd-arrow-group${active ? ' tefd-arrow-group--active' : ''}`} onMouseEnter={() => setHoveredStep(arrow.step)} onMouseLeave={() => setHoveredStep(null)} onClick={() => openEducation(arrow.edu)} role="button" tabIndex={0} aria-label={`Step ${arrow.step}: ${arrow.label}`} onKeyDown={e => e.key === 'Enter' && openEducation(arrow.edu)} style={{ cursor: 'pointer' }}>
              <line x1={x1} y1={ARROW_Y} x2={x2} y2={ARROW_Y} className={`tefd-arrow-line tefd-arrow-line--${arrow.tokenType}`} markerEnd={`url(#tefd-arrow-${arrow.tokenType})`} />
              <circle cx={midX} cy={ARROW_Y} r={10} className={`tefd-step-circle tefd-step-circle--${arrow.tokenType}`} />
              <text x={midX} y={ARROW_Y + 4} textAnchor="middle" className="tefd-step-num">{arrow.step}</text>
              <line x1={midX} y1={ARROW_Y + 11} x2={midX} y2={DROP_Y} className="tefd-drop-line" />
              <text x={midX} y={LABEL_Y1} textAnchor="middle" className={`tefd-conn-label tefd-conn-label--${arrow.tokenType}`}>{arrow.label}</text>
              <text x={midX} y={LABEL_Y2} textAnchor="middle" className="tefd-conn-rfc">{arrow.rfc}</text>
            </g>
          );
        })}
      </svg>
      {hoveredArrow && (
        <div className="tefd-tooltip" role="tooltip">
          <strong className="tefd-tooltip-title">Step {hoveredArrow.step}: {hoveredArrow.label}</strong>
          <p className="tefd-tooltip-text">{hoveredArrow.tooltip}</p>
          <button className="tefd-tooltip-btn" onClick={() => openEducation(hoveredArrow.edu)}>Learn more</button>
        </div>
      )}
      <div className="tefd-education-buttons" role="group" aria-label="Learn more about token exchange">
        <button className="tefd-btn tefd-btn--primary" onClick={() => openEducation('token-exchange')}>Token Exchange (RFC 8693)</button>
        {safeMode === 'double' && (
          <button className="tefd-btn tefd-btn--secondary" onClick={() => openEducation('may-act')}>may_act &amp; act Claims</button>
        )}
        <button className="tefd-btn tefd-btn--secondary" onClick={() => openEducation('mcp-protocol')}>MCP Protocol</button>
      </div>

      {/* Phase 266 R2: Gateway credential-disposition branches */}
      <div
        className="tefd-path-branches"
        style={{
          marginTop: 12,
          padding: '10px 14px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          fontSize: '0.74rem',
          color: '#334155',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: '0.76rem', color: '#1e293b' }}>
          Gateway credential dispositions (Phase 266)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 700, color: '#ca8a04', minWidth: 120 }}>API-KEY PATH (A):</span>
            <span>Swap — X-API-Key (last4: ****) — terminates at Gateway (no backend call)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 700, color: '#0d9488', minWidth: 120 }}>DUAL-TOKEN (B):</span>
            <span>Forward — Bearer + id_token — banking_resource_server /identity (RFC 8693 annotated)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 700, color: '#004687', minWidth: 120 }}>OAUTH BEARER (C):</span>
            <span>RFC 8693 exchange — Bearer (new aud) — banking_resource_server /accounts /transactions</span>
          </div>
        </div>
        <div style={{ marginTop: 6, color: '#64748b', fontStyle: 'italic' }}>
          Paths B and C both reach the same banking_resource_server backend at different routes.
        </div>
      </div>
    </div>
  );
}
