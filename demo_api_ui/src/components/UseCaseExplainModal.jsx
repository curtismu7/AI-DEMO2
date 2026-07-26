import React from 'react';
import DraggableModal from './DraggableModal';
import { useExplainData } from '../hooks/useExplainData';
import { PING_PRODUCTS } from '../utils/pingProducts';
import { isA2aUseCase, extractA2aFacts } from '../utils/a2aFacts';
import './UseCaseExplainModal.css';

const PRODUCT_ORDER = ['idp', 'mfa', 'gw', 'authz'];

/** Shown for A2A UCs when live /rules is unavailable — mirrors decision.js A2A gates. */
const A2A_FALLBACK_RULES = {
  rules: [
    {
      id: 'a2a-delegation-required',
      name: 'A2A delegation required',
      description:
        'a2aDelegated tools (e.g. get_portfolio_summary) are DENIED unless ActChainDepth >= 2 (specialist nested under generalist).',
    },
    {
      id: 'a2a-nested-generalist',
      name: 'Nested generalist identity',
      description:
        'When depth >= 2, NestedActClientId must match the registered AI Agent (generalist). Mismatch → invalid_a2a_generalist DENY.',
    },
    {
      id: 'a2a-scope-enforcement',
      name: 'Specialist scope enforcement',
      description:
        'At depth 2 the specialist token must still carry the tool scopes (e.g. invest:read); missing scope → DENY.',
    },
  ],
};

function PingDot() {
  return (
    <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

function SectionHead({ num, children }) {
  return (
    <h3 className="ucem__sec-h">
      <span className="ucem__sec-num">{num}</span>
      {children}
    </h3>
  );
}

function AuthzRulesSection({ rules, loading, a2a }) {
  if (loading) {
    return <div className="ucem__live ucem__live--loading">Loading rules...</div>;
  }
  const live = rules && Array.isArray(rules.rules) && rules.rules.length > 0 ? rules : null;
  const fallback = a2a ? A2A_FALLBACK_RULES : null;
  const display = live || fallback;
  if (!display) {
    return <div className="ucem__live ucem__live--empty">No policy data available for this tool.</div>;
  }
  return (
    <div className="ucem__live">
      {!live && a2a && (
        <div className="ucem__live-rule">
          <em>Live /rules unreachable — showing A2A policy gates enforced by the mock Authorize decision path.</em>
        </div>
      )}
      {display.rules.map((r) => (
        <div key={r.id} className="ucem__live-rule">
          <span className="ucem__live-k">Rule</span>{' '}
          <strong>{r.name}</strong>
          {r.description ? ` — ${r.description}` : ''}
        </div>
      ))}
    </div>
  );
}

function GatewaySection({ topology, tool, loading }) {
  if (loading) {
    return <div className="ucem__live ucem__live--loading">Loading gateway config...</div>;
  }
  if (!tool || !topology || !topology.found) {
    return <div className="ucem__live ucem__live--empty">No gateway route data for this tool.</div>;
  }
  return (
    <div className="ucem__live">
      <div>
        <span className="ucem__live-k">route</span>{' '}
        POST /mcp{' '}
        <span className="ucem__live-k">tool=</span>{tool}{' '}
        <span className="ucem__live-k">requiredScopes=</span>[{(topology.requiredScopes || []).join(', ')}]
      </div>
      {topology.challengeType && (
        <div>
          <span className="ucem__live-k">challengeType=</span>{topology.challengeType}
        </div>
      )}
      {topology.requiresAgentMediation && (
        <div>
          <span className="ucem__live-k">requiresAgentMediation=</span>true
        </div>
      )}
      {topology.a2aDelegated && (
        <div>
          <span className="ucem__live-k">a2aDelegated=</span>true
        </div>
      )}
    </div>
  );
}

function A2aFactRow({ k, v }) {
  return (
    <div className="ucem__live-rule">
      <span className="ucem__live-k">{k}</span>
      <span>{v || <em>—</em>}</span>
    </div>
  );
}

function A2aSection({ tokenEvents }) {
  const f = extractA2aFacts(tokenEvents);
  return (
    <>
      <p>
        Two agents act on the user&apos;s behalf. A <strong>generalist</strong> agent hands a
        narrow, sensitive read to a <strong>specialist</strong> agent. PingOne mints a nested
        RFC 8693 act chain — <code>act:&#123; specialist, act:&#123; generalist &#125; &#125;</code>,
        subject still the user — across two exchanges: Exchange&nbsp;#1 (user → generalist),
        Exchange&nbsp;#2 (generalist → specialist, nested). PingOne Authorize then decides over
        the chain: it PERMITs the depth-2 delegation and DENIEs the generalist acting alone.
      </p>
      {f.present ? (
        <div className="ucem__live">
          <A2aFactRow k="specialist" v={f.specialist} />
          <A2aFactRow k="tool" v={f.tool} />
          <A2aFactRow k="act chain" v={f.actChain ? f.actChain.join(' → ') : null} />
          <A2aFactRow k="act depth" v={f.actChainDepth != null ? String(f.actChainDepth) : null} />
          <A2aFactRow k="exchange #1 aud" v={f.intermediateAud} />
          <A2aFactRow k="exchange #2 aud" v={f.gatewayAud} />
          <A2aFactRow k="scope" v={f.scope} />
        </div>
      ) : (
        <div className="ucem__live ucem__live--empty">
          Run this step to see the live delegation values (audiences, scopes, act chain).
        </div>
      )}
    </>
  );
}

export default function UseCaseExplainModal({ uc, open, onClose, a2aTokenEvents = [] }) {
  const a2a = isA2aUseCase(uc);
  const facts = a2a ? extractA2aFacts(a2aTokenEvents) : null;
  // Prefer the live specialist tool from token events over a stale catalog primaryTool
  // (e.g. delegate_to_specialist has no gateway topology row).
  const topologyTool = (facts && facts.tool) || uc?.primaryTool || null;
  const explainUc = uc && topologyTool && topologyTool !== uc.primaryTool
    ? { ...uc, primaryTool: topologyTool }
    : uc;
  const { rules, topology, loading } = useExplainData(open ? explainUc : null);

  if (!open || !uc) return null;

  const trackLabel = uc.track
    ? uc.track.charAt(0).toUpperCase() + uc.track.slice(1)
    : '';

  const title = `${uc.id} — ${uc.title}`;

  return (
    <DraggableModal
      isOpen={open}
      onClose={onClose}
      title={title}
      footer={
        <button type="button" className="dm-close-btn" onClick={onClose}>
          Done
        </button>
      }
      defaultWidth={620}
      defaultHeight={680}
      storageKey="ucem-explain-modal"
    >
      <div className="ucem__body dm-scroll">

          <div className="ucem__head ucem__head--inline">
            <span className="ucem__id">{uc.id}</span>
            <h2 className="ucem__title">{uc.title}</h2>
            {trackLabel && <span className="ucem__track">{trackLabel}</span>}
          </div>

          <div className="ucem__sec">
            <SectionHead num={1}>What this is</SectionHead>
            <p>{uc.whatLong || uc.buyerStory}</p>
          </div>

          <div className="ucem__sec">
            <SectionHead num={2}>How we stop it</SectionHead>
            <p>{uc.pingOneSolution}</p>
          </div>

          {a2a && (
            <div className="ucem__sec">
              <SectionHead num="A2A">Agent-to-Agent delegation</SectionHead>
              <A2aSection tokenEvents={a2aTokenEvents} />
            </div>
          )}

          <div className="ucem__sec">
            <SectionHead num={3}>Ping products and how they are used</SectionHead>
            {PRODUCT_ORDER
              .filter((pid) => uc.productRoles && uc.productRoles[pid])
              .map((pid) => {
                const prod = PING_PRODUCTS[pid];
                return (
                  <div key={pid} className="ucem__prod-row">
                    <span className={`ucem__pp ucem__pp--${pid}`}>
                      <PingDot />
                      {prod.label}
                    </span>
                    <span>{uc.productRoles[pid]}</span>
                  </div>
                );
              })}
            {(!uc.productRoles || PRODUCT_ORDER.filter((pid) => uc.productRoles[pid]).length === 0) && (
              <div className="ucem__live ucem__live--empty">No product roles defined for this use case.</div>
            )}
          </div>

          <div className="ucem__sec">
            <SectionHead num={4}>Business value</SectionHead>
            <div className="ucem__value-card">
              <p>{uc.businessValue || uc.buyerStory}</p>
            </div>
          </div>

          <div className="ucem__sec">
            <SectionHead num={5}>
              <span className="ucem__pp ucem__pp--authz">
                <PingDot />
                PingOne Authorize
              </span>
              {' '}rules in play
            </SectionHead>
            <AuthzRulesSection rules={rules} loading={loading} a2a={a2a} />
            <p className="ucem__live-note">
              Source: <code>/api/authorize/mock-authz-rules</code>
            </p>
          </div>

          <div className="ucem__sec">
            <SectionHead num={6}>
              <span className="ucem__pp ucem__pp--gw">
                <PingDot />
                PingGateway
              </span>
              {' '}routes and checks
            </SectionHead>
            <GatewaySection topology={topology} tool={topologyTool} loading={loading} />
            <p className="ucem__live-note">
              Source: <code>/api/mcp/tool-topology</code>
            </p>
          </div>

      </div>
    </DraggableModal>
  );
}
