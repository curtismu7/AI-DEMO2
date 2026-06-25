import React from 'react';
import DraggableModal from './DraggableModal';
import { useExplainData } from '../hooks/useExplainData';
import { PING_PRODUCTS } from '../utils/pingProducts';
import './UseCaseExplainModal.css';

const PRODUCT_ORDER = ['idp', 'mfa', 'gw', 'authz'];

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

function AuthzRulesSection({ rules, loading }) {
  if (loading) {
    return <div className="ucem__live ucem__live--loading">Loading rules...</div>;
  }
  if (!rules || !Array.isArray(rules.rules) || rules.rules.length === 0) {
    return <div className="ucem__live ucem__live--empty">No policy data available for this tool.</div>;
  }
  return (
    <div className="ucem__live">
      {rules.rules.map((r) => (
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

export default function UseCaseExplainModal({ uc, open, onClose }) {
  const { rules, topology, loading } = useExplainData(open ? uc : null);

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
      footer={null}
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
            <AuthzRulesSection rules={rules} loading={loading} />
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
            <GatewaySection topology={topology} tool={uc.primaryTool} loading={loading} />
            <p className="ucem__live-note">
              Source: <code>/api/mcp/tool-topology</code>
            </p>
          </div>

      </div>
    </DraggableModal>
  );
}
