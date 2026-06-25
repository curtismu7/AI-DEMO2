/**
 * ScopeNarrowingVisualization
 * Static educational section showing how OAuth scopes narrow at each token exchange hop.
 * Designed to be embedded in PingOneTestPage or used standalone.
 */
import React, { useState } from 'react';

const stages = [
  {
    label: 'User Login',
    badge: 'Full user permissions',
    color: '#3b82f6',
    bgColor: '#dbeafe',
    borderColor: '#93c5fd',
    scopes: [
      { name: 'openid', kept: true },
      { name: 'profile', kept: false },
      { name: 'email', kept: false },
      { name: 'accounts:read', kept: true },
      { name: 'accounts:write', kept: false },
      { name: 'transfers', kept: true },
      { name: 'admin', kept: false },
    ],
  },
  {
    label: 'Agent Exchange',
    badge: 'Agent-scoped subset',
    color: '#10b981',
    bgColor: '#d1fae5',
    borderColor: '#6ee7b7',
    scopes: [
      { name: 'openid', kept: true },
      { name: 'accounts:read', kept: true },
      { name: 'transfers', kept: false },
    ],
  },
  {
    label: 'MCP Tool Call',
    badge: 'Single tool scope',
    color: '#f59e0b',
    bgColor: '#fef3c7',
    borderColor: '#fbbf24',
    scopes: [
      { name: 'accounts:read', kept: true },
    ],
  },
];

const containerStyle = {
  margin: '24px 0',
  padding: '24px',
  background: '#f9fafb',
  borderRadius: '8px',
  border: '1px solid #e5e7eb',
};

const titleStyle = {
  fontSize: '18px',
  fontWeight: 700,
  margin: '0 0 6px',
  color: '#1f2937',
};

const subtitleStyle = {
  fontSize: '14px',
  color: '#374151',
  margin: '0 0 20px',
  lineHeight: '1.5',
};

const pipelineStyle = {
  display: 'flex',
  gap: '0',
  alignItems: 'flex-start',
  overflowX: 'auto',
  padding: '8px 0',
};

const stageStyle = (color, bgColor, borderColor) => ({
  flex: '1',
  minWidth: '200px',
  background: bgColor,
  border: `2px solid ${borderColor}`,
  borderRadius: '8px',
  padding: '16px',
});

const stageLabelStyle = (color) => ({
  fontSize: '14px',
  fontWeight: 700,
  color: color,
  margin: '0 0 4px',
});

const badgeStyle = (color) => ({
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'white',
  background: color,
  padding: '2px 8px',
  borderRadius: '10px',
  marginBottom: '12px',
});

const scopePillStyle = (kept) => ({
  display: 'inline-block',
  fontSize: '12px',
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: '12px',
  margin: '3px 4px 3px 0',
  background: kept ? '#e0f2fe' : '#f3f4f6',
  color: kept ? '#0369a1' : '#9ca3af',
  textDecoration: kept ? 'none' : 'line-through',
  border: kept ? '1px solid #7dd3fc' : '1px solid #d1d5db',
});

const arrowStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '60px',
  padding: '0 4px',
};

const arrowLineStyle = {
  fontSize: '20px',
  color: '#374151',
  lineHeight: '1',
};

const arrowLabelStyle = {
  fontSize: '9px',
  fontWeight: 600,
  color: '#374151',
  textAlign: 'center',
  marginTop: '4px',
  lineHeight: '1.2',
};

const explanationStyle = {
  marginTop: '16px',
  padding: '16px',
  background: 'white',
  borderRadius: '6px',
  border: '1px solid #e5e7eb',
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#374151',
};

const vaultContainerStyle = {
  margin: '24px 0',
  padding: '20px',
  background: '#fef3c7',
  border: '2px solid #fbbf24',
  borderRadius: '8px',
};

const vaultTitleStyle = {
  fontSize: '16px',
  fontWeight: 700,
  color: '#92400e',
  margin: '0 0 8px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const vaultBadgeStyle = {
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 700,
  color: '#92400e',
  background: '#fde68a',
  padding: '2px 8px',
  borderRadius: '10px',
};

const vaultTextStyle = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#78350f',
  margin: '0 0 8px',
};

export default function ScopeNarrowingVisualization() {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      {/* Scope Narrowing Section */}
      <div style={containerStyle}>
        <h3 style={titleStyle}>Scope Narrowing — Least Privilege</h3>
        <p style={subtitleStyle}>
          At each token exchange hop, permissions are progressively restricted. Strikethrough scopes were dropped.
        </p>

        <div style={pipelineStyle}>
          {stages.map((stage, idx) => (
            <React.Fragment key={stage.label}>
              <div style={stageStyle(stage.color, stage.bgColor, stage.borderColor)}>
                <div style={stageLabelStyle(stage.color)}>{stage.label}</div>
                <span style={badgeStyle(stage.color)}>{stage.badge}</span>
                <div>
                  {stage.scopes.map((scope) => (
                    <span key={scope.name} style={scopePillStyle(scope.kept)}>
                      {scope.name}
                    </span>
                  ))}
                </div>
              </div>
              {idx < stages.length - 1 && (
                <div style={arrowStyle}>
                  <span style={arrowLineStyle}>→</span>
                  <span style={arrowLabelStyle}>
                    {idx === 0 ? 'Exchange narrows scope' : 'Restricted per tool'}
                  </span>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={explanationStyle}>
          <strong>Principle of Least Privilege:</strong> At each token exchange hop, the scope is restricted
          to only what is needed. The user&apos;s full permissions ({stages[0].scopes.length} scopes) are
          progressively narrowed — the agent only receives scopes relevant to its task
          ({stages[1].scopes.length} scopes), and the MCP tool call gets the minimum scope for that specific
          operation ({stages[2].scopes.length} scope). This prevents overpermissioning and limits blast radius
          if any token is compromised.
          <br /><br />
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: '13px', padding: 0 }}
            type="button"
          >
            {showDetails ? '▼ Hide details' : '▶ Show exchange details'}
          </button>
          {showDetails && (
            <div style={{ marginTop: '12px', fontSize: '13px', color: '#4b5563' }}>
              <p><strong>Hop 1 (User → Agent):</strong> The user logs in with broad permissions (admin, write, transfers).
                When the BFF performs token exchange for the agent, it requests only the scopes the agent needs:
                openid, accounts:read, and transfers. Admin and write scopes are dropped.</p>
              <p style={{ marginTop: '8px' }}><strong>Hop 2 (Agent → MCP Tool):</strong> When
                the agent invokes a specific MCP tool (e.g., get_accounts), the scope is further narrowed to just
                accounts:read. The tool cannot access transfers or any other scope.</p>
            </div>
          )}
        </div>
      </div>

      {/* Last Mile Vault Section */}
      <div style={vaultContainerStyle}>
        <div style={vaultTitleStyle}>
          🔒 Last Mile Security — Tool Credential Management
          <span style={vaultBadgeStyle}>Concept</span>
        </div>
        <p style={vaultTextStyle}>
          In a production agentic system, the MCP server should <strong>not</strong> store persistent
          credentials for backend tools. Instead, a secure vault (e.g., HashiCorp Vault, AWS Secrets Manager)
          provides temporary, scoped credentials for each tool call. This ensures that even if the MCP server
          is compromised, tool credentials are not exposed.
        </p>
        <p style={{ ...vaultTextStyle, fontStyle: 'italic', opacity: 0.8 }}>
          This demo currently propagates OAuth tokens to the tool. A vault integration is a planned future enhancement.
        </p>
      </div>
    </>
  );
}
