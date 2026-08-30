import React, { useState } from 'react';
import AgentGatewayInspectorClean from '../components/AgentGatewayInspectorClean';

export default function AgentGatewayCapabilitiesPage() {
  const [showCapabilities, setShowCapabilities] = useState(false);

  return showCapabilities ? (
    <AgentGatewayInspectorClean gatewayId="demo-mcp-gateway" />
  ) : (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--th-text)' }}>Agent Gateway Inspector</h1>
        <p style={{ fontSize: '14px', color: 'var(--th-text-body)', margin: '0 0 24px 0', lineHeight: 1.6 }}>
          Test and debug MCP tools via the Agent Gateway. Select tools, invoke them with custom parameters, and inspect the results in real-time.
        </p>
      </div>

      <button
        onClick={() => setShowCapabilities(true)}
        style={{
          padding: '12px 24px',
          background: '#1e3a5f',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontWeight: 600,
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        Open Inspector
      </button>
    </div>
  );
}
