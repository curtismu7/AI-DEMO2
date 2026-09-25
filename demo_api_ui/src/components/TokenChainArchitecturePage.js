/**
 * TokenChainArchitecturePage.js — /architecture/token-chain
 *
 * Interactive token chain diagram showing all servers, authentication,
 * authorization, token exchange, and MCP gateway flow — rendered as a React
 * Flow canvas (TokenChainFlowDiagram) replacing the previous Mermaid render.
 * Zoom/pan is built into React Flow; click a node for its details.
 */
import React, { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Controls } from '@xyflow/react';
import TokenChainFlowDiagram from './TokenChainFlowDiagram';
import './TokenChainArchitecturePage.css';

const CARDS = [
  { color: '#2E5090', title: '🔐 Authentication', body: <>PingOne issues human token with <code>may_act: agent1</code> delegation claim</> },
  { color: '#3b5998', title: 'Agent', body: 'Gets own token (client creds), routes to LLM for tool selection' },
  { color: '#28a745', title: 'Token Exchange', body: 'Combines human + agent tokens into single TX token for MCP calls' },
  { color: '#f57c00', title: 'Gateway', body: 'Routes tool calls, enforces authorization checks, handles introspection' },
  { color: '#dc3545', title: '✅ Authorization', body: 'PingAuthorize evaluates policies based on scopes, audience, ACR, transaction details' },
  { color: '#6f42c1', title: 'MCP Servers', body: 'Tool providers, validate tokens, forward to resources with optional exchange' },
  { color: '#17a2b8', title: 'Resources', body: 'Backend APIs behind MCP servers, may do token exchange for API keys' },
  // Yellow (#ffc107) is too light for title text on either page background,
  // so unlike the others this card's heading tracks the theme instead of
  // its own accent -- the border still matches the diagram's Safety group.
  { color: '#ffc107', titleColor: 'themed', title: 'HITL/CIBA', body: 'Step-up flow for high-risk actions (transfers), requires Multi-Factor ACR' },
];

function CanvasWithControls({ onNodeClick }) {
  return (
    <div className="tca-canvas-frame">
      <ReactFlowProvider>
        <TokenChainFlowDiagram onClickNode={onNodeClick} />
        <Controls position="top-right" showInteractive={false} />
      </ReactFlowProvider>
    </div>
  );
}

export default function TokenChainArchitecturePage({ user }) {
  const [selected, setSelected] = useState(null);
  // selected = { group, label, sub, id, detail: { role, mockToken, tokenNote } }
  const info = selected?.detail;

  return (
    <div className="tca-page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1>Token Chain Architecture</h1>
          <p className="tca-subtitle">
            Complete flow: PingOne auth → Agent → Token Exchange → Agent Gateway → Authorization → Resource Servers
          </p>
        </div>
      </div>

      <div className="tca-diagram-frame">
        <p className="tca-zoom-hint">
          Scroll to zoom · Drag to pan · Click a node for its role and the (mock) token it carries
        </p>
        <CanvasWithControls onNodeClick={(node) => setSelected(node)} />
      </div>

      {info && (
        <div className="tca-node-detail" role="status">
          <div className="tca-node-detail-head">
            <strong>{selected.label}</strong>
            <span className="tca-node-detail-group">· {selected.group} · {selected.id}</span>
            <button
              type="button"
              className="tca-node-detail-close"
              onClick={() => setSelected(null)}
              aria-label="Close node detail"
            >
              ✕
            </button>
          </div>
          <p className="tca-node-detail-role">{info.role}</p>
          {info.mockToken ? (
            <>
              <p className="tca-node-detail-note">
                {info.mockToken.note} — decoded claims (MOCK, teaching values only):
              </p>
              <pre className="tca-node-detail-json">
                {JSON.stringify(info.mockToken.claims, null, 2)}
              </pre>
            </>
          ) : (
            <p className="tca-node-detail-note">{info.tokenNote}</p>
          )}
        </div>
      )}

      {/* Card accents match the flow graph's group colors above by design —
          a matched legend, so they stay literal regardless of theme. */}
      <div className="tca-cards">
        {CARDS.map(({ color, titleColor, title, body }) => (
          <div key={title} className="tca-card" style={{ borderLeft: `4px solid ${color}` }}>
            <div
              className="tca-card-title"
              style={titleColor === 'themed' ? undefined : { color }}
            >
              {title}
            </div>
            <div>{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
