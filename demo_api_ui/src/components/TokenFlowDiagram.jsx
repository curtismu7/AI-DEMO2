/**
 * TokenFlowDiagram.jsx
 * Displays RFC 8693 token exchange flow with claim progression across 3 token exchanges
 */
import React from 'react';

function Highlight({ children }) {
  return <span className="utfi-highlighted">{children}</span>;
}

export default function TokenFlowDiagram() {
  return (
    <div className="utfi-flow-diagram-container">
      <div className="utfi-flow-diagram">
        <div className="utfi-flow-title">2-Exchange Flow (RFC 8693 §4)</div>
        {/* Line breaks and spacing for readability */}
        <div className="utfi-flow-line"></div>

        <div className="utfi-flow-row">
          <span>User Token (BFF)</span>
          <span className="utfi-flow-sep">───</span>
          <span className="utfi-rfc-label">RFC 8693.1</span>
          <span className="utfi-flow-arrow">→</span>
          <span>Agent Token</span>
          <span className="utfi-flow-sep">───</span>
          <span className="utfi-rfc-label">RFC 8693.2</span>
          <span className="utfi-flow-arrow">→</span>
          <span>MCP Token</span>
        </div>

        <div className="utfi-flow-line"></div>

        <div className="utfi-flow-claims">
          <div className="utfi-claim-column">
            <span className="utfi-claim-num">①</span>
            <span>sub: user-123</span>
          </div>
          <div className="utfi-claim-spacer"></div>

          <div className="utfi-claim-column">
            <span className="utfi-claim-num">①</span>
            <span>act: agent-001</span>
          </div>
          <div className="utfi-claim-spacer"></div>

          <div className="utfi-claim-column">
            <span className="utfi-claim-num">①</span>
            <span>act: [agent-001, user-123]</span>
          </div>
        </div>

        <div className="utfi-flow-claims">
          <div className="utfi-claim-column">
            <span className="utfi-claim-num">②</span>
            <span>scope: read write</span>
          </div>
          <div className="utfi-claim-spacer"></div>

          <div className="utfi-claim-column">
            <span className="utfi-claim-num">②</span>
            <span>scope: read write</span>
          </div>
          <div className="utfi-claim-spacer"></div>

          <div className="utfi-claim-column">
            <span className="utfi-claim-num">②</span>
            <span>
              scope: read{' '}
              <Highlight>narrowed</Highlight>
            </span>
          </div>
        </div>

        <div className="utfi-flow-claims">
          <div className="utfi-claim-column">
            <span className="utfi-claim-num">③</span>
            <span>aud: banking-api</span>
          </div>
          <div className="utfi-claim-spacer"></div>

          <div className="utfi-claim-column">
            <span className="utfi-claim-num">③</span>
            <span>aud: banking-api</span>
          </div>
          <div className="utfi-claim-spacer"></div>

          <div className="utfi-claim-column">
            <span className="utfi-claim-num">③</span>
            <span>
              aud: mcp-server{' '}
              <Highlight>bound</Highlight>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
