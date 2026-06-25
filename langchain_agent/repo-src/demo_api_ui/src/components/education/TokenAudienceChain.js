import React from 'react';
import RfcLink from '../shared/RfcLink';

const NODE_STYLE = {
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '8px 12px',
  background: '#1e293b',
  color: '#f1f5f9',
  fontSize: '0.78rem',
  minWidth: 130,
  textAlign: 'center',
};

const CLAIM_STYLE = {
  fontSize: '0.68rem',
  color: '#374151',
  marginTop: 4,
  fontFamily: 'inherit',
};

const ARROW_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '0 8px',
  color: '#374151',
  fontSize: '0.68rem',
  fontFamily: 'inherit',
  flexShrink: 0,
};

function ExchangeArrow({ label }) {
  return (
    <div style={ARROW_STYLE}>
      <span style={{ fontSize: '1rem', color: '#475569' }}>→</span>
      <span style={{ whiteSpace: 'nowrap' }}>
        <RfcLink rfc="RFC_8693" label={label} />
      </span>
    </div>
  );
}

/**
 * Visual token audience chain diagram (CSS only, no external lib).
 * Shows: User Token → GW Token → Backend Token with aud values.
 */
export default function TokenAudienceChain({ compact = false }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, padding: '12px 0', minWidth: 'max-content' }}>

        {/* Hop 0 — User Token */}
        <div style={NODE_STYLE}>
          <div style={{ fontWeight: 600, color: '#7dd3fc' }}>User Token</div>
          <div style={CLAIM_STYLE}>sub: user-abc</div>
          <div style={CLAIM_STYLE}>aud: olb-resource.ping.demo</div>
          {!compact && <div style={CLAIM_STYLE}>scope: read write</div>}
        </div>

        <ExchangeArrow label="Exchange #1" />

        {/* Hop 1 — GW Token */}
        <div style={NODE_STYLE}>
          <div style={{ fontWeight: 600, color: '#86efac' }}>GW Token</div>
          <div style={CLAIM_STYLE}>sub: user-abc</div>
          <div style={CLAIM_STYLE}>aud: mcpgateway.ping.demo</div>
          <div style={{ ...CLAIM_STYLE, color: '#fbbf24' }}>act: &#123;sub: agent1&#125;</div>
        </div>

        <ExchangeArrow label="Exchange #2" />

        {/* Hop 2 — Backend Token */}
        <div style={NODE_STYLE}>
          <div style={{ fontWeight: 600, color: '#f9a8d4' }}>Backend Token</div>
          <div style={CLAIM_STYLE}>sub: user-abc</div>
          <div style={CLAIM_STYLE}>aud: mcpgateway.ping.demo</div>
          <div style={{ ...CLAIM_STYLE, color: '#fbbf24' }}>act: &#123;sub: agent1&#125;</div>
        </div>

      </div>

      <div style={{ fontSize: '0.72rem', color: '#374151', marginTop: 6, fontFamily: 'inherit' }}>
        sub preserved throughout &nbsp;·&nbsp; act added at Exchange #1, preserved at #2 &nbsp;·&nbsp; aud narrows each hop
      </div>
    </div>
  );
}
