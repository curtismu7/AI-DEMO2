// banking_api_ui/src/components/education/FlowDiagramsPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function FlowDiagramsPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'overview',
      label: 'Diagram Overview',
      content: (
        <>
          <h3>Super Banking Flow Diagrams</h3>
          <p>
            The Super Banking demo includes comprehensive draw.io flow diagrams with RFC annotations that visualize the complete authentication and authorization flows. These diagrams provide detailed technical documentation for developers and security architects.
          </p>
          
          <h4>Available Diagrams</h4>
          <ul>
            <li><strong>MFA deviceAuthentication Flow</strong> - Complete MFA authentication sequence</li>
            <li><strong>User Consent Flow</strong> - High-value transaction approval process</li>
            <li><strong>Agent Request Flow</strong> - End-to-end agent request processing</li>
            <li><strong>Token Exchange Flow</strong> - RFC 8693 token exchange patterns</li>
            <li><strong>CIBA Flow</strong> - Backchannel authentication sequence</li>
          </ul>

          <h4>Technical Features</h4>
          <ul>
            <li><strong>RFC Annotations</strong> - All major RFC references included</li>
            <li><strong>Security Notes</strong> - Security best practices highlighted</li>
            <li><strong>Error Handling</strong> - Error scenarios and recovery paths</li>
            <li><strong>Configuration</strong> - Required settings and parameters</li>
          </ul>

          <div style={{ marginTop: '16px', padding: '12px', background: '#e3f2fd', border: '1px solid #bbdefb', borderRadius: '6px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#1565c0' }}>📂 File Locations</h5>
            <p style={{ margin: '0', fontSize: '0.85rem', color: '#424242' }}>
              All diagrams are located in the <code>docs/</code> directory with <code>.drawio</code> extension.
              Open them in <a href="https://app.diagrams.net" target="_blank" rel="noopener noreferrer">draw.io</a> for editing.
            </p>
          </div>
        </>
      ),
    },
    {
      id: 'mfa-flow',
      label: 'MFA deviceAuthentication',
      content: (
        <>
          <h3>MFA deviceAuthentication Flow</h3>
          <p>
            <strong>File:</strong> <code>docs/Super-Banking-MFA-DeviceAuthentication-Flow.drawio</code>
          </p>
          
          <h4>Flow Overview</h4>
          <p>
            This diagram illustrates the complete MFA deviceAuthentication flow used in the Super Banking demo when sensitive operations require step-up authentication. The flow supports OTP, Push notifications, and FIDO2/WebAuthn methods.
          </p>

          <h4>Key Components</h4>
          <ul>
            <li><strong>AI Agent</strong> - Initiates sensitive operation requiring MFA</li>
            <li><strong>BFF</strong> - Evaluates ACR and orchestrates MFA flow</li>
            <li><strong>PingOne</strong> - deviceAuthentications API provider</li>
            <li><strong>User</strong> - Interacts with MFA UI</li>
            <li><strong>User Device</strong> - Provides authentication factor</li>
          </ul>

          <h4>RFC References</h4>
          <ul>
            <li><strong>OAuth 2.0 Security Best Practices</strong> - draft-08</li>
            <li><strong>PingOne deviceAuthentications API</strong> - Direct API integration</li>
            <li><strong>RFC 8707</strong> - Resource Indicators</li>
          </ul>

          <h4>Security Highlights</h4>
          <ul>
            <li>User access token never leaves BFF</li>
            <li>Device authentication uses policy-based MFA</li>
            <li>Supports multiple MFA methods</li>
            <li>ACR elevated from password to Multi_factor</li>
          </ul>

          <div style={{ marginTop: '16px', padding: '12px', background: '#f3e5f5', border: '1px solid #ce93d8', borderRadius: '6px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#7b1fa2' }}>🔧 Implementation</h5>
            <p style={{ margin: '0', fontSize: '0.85rem', color: '#424242' }}>
              See <code>banking_api_server/services/mfaService.js</code> for the complete implementation
              of the deviceAuthentication API calls and flow orchestration.
            </p>
          </div>
        </>
      ),
    },
    {
      id: 'consent-flow',
      label: 'User Consent Flow',
      content: (
        <>
          <h3>User Consent Flow</h3>
          <p>
            <strong>File:</strong> <code>docs/Super-Banking-User-Consent-Flow.drawio</code>
          </p>
          
          <h4>Flow Overview</h4>
          <p>
            This diagram shows the human-in-the-loop consent flow for high-value transactions that require mandatory human approval before execution. This is separate from MFA and provides an additional layer of security.
          </p>

          <h4>Key Components</h4>
          <ul>
            <li><strong>AI Agent</strong> - Requests high-value transaction</li>
            <li><strong>BFF</strong> - Evaluates transaction risk and orchestrates consent</li>
            <li><strong>Consent Service</strong> - Manages consent requests and approvals</li>
            <li><strong>User</strong> - Initiates approval request</li>
            <li><strong>Human Approver</strong> - Reviews and approves/rejects transaction</li>
          </ul>

          <h4>RFC References</h4>
          <ul>
            <li><strong>RFC 9396</strong> - Rich Authorization Requests</li>
            <li><strong>RFC 9396</strong> - Transaction Binding</li>
            <li><strong>UMA 2.0</strong> - User-Managed Access</li>
          </ul>

          <h4>Security & Compliance</h4>
          <ul>
            <li>Transaction binding prevents replay attacks</li>
            <li>Human approval creates audit trail</li>
            <li>Separation of duties enforced</li>
            <li>Configurable approval thresholds</li>
          </ul>

          <h4>Configuration</h4>
          <ul>
            <li><strong>CONSENT_THRESHOLD</strong> - Default: $5000</li>
            <li><strong>APPROVAL_TIMEOUT</strong> - Default: 24h</li>
            <li><strong>REQUIRED_APPROVERS</strong> - Role-based</li>
            <li><strong>NOTIFICATION_CHANNELS</strong> - Email, SMS</li>
          </ul>

          <div style={{ marginTop: '16px', padding: '12px', background: '#e8f5e8', border: '1px solid #a5d6a7', borderRadius: '6px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#2e7d32' }}>📋 Implementation</h5>
            <p style={{ margin: '0', fontSize: '0.85rem', color: '#424242' }}>
              See <code>banking_api_server/services/humanInLoopService.js</code> for the consent service
              implementation and approval workflow management.
            </p>
          </div>
        </>
      ),
    },
    {
      id: 'agent-flow',
      label: 'Agent Request Flow',
      content: (
        <>
          <h3>Agent Request Flow</h3>
          <p>
            <strong>File:</strong> <code>docs/Super-Banking-Agent-Request-Flow.drawio</code>
          </p>
          
          <h4>Flow Overview</h4>
          <p>
            This comprehensive diagram shows the complete end-to-end flow from user request to agent response, including all OAuth 2.0 token exchanges, API calls, and security validations. This is the master flow diagram for the entire system.
          </p>

          <h4>Key Components</h4>
          <ul>
            <li><strong>User</strong> - React SPA interface</li>
            <li><strong>BFF</strong> - Backend-for-Frontend orchestrator</li>
            <li><strong>AI Agent</strong> - LangChain-based agent with tool calling</li>
            <li><strong>MCP Server</strong> - Model Context Protocol server</li>
            <li><strong>Banking API</strong> - Resource server with business logic</li>
            <li><strong>PingOne</strong> - OAuth 2.0 authorization server</li>
          </ul>

          <h4>RFC References</h4>
          <ul>
            <li><strong>RFC 6749</strong> - OAuth 2.0 Framework</li>
            <li><strong>RFC 7636</strong> - PKCE for public clients</li>
            <li><strong>RFC 8693</strong> - Token Exchange delegation</li>
            <li><strong>RFC 8707</strong> - Resource indicators</li>
            <li><strong>RFC 9728</strong> - Auth Server discovery</li>
            <li><strong>RFC 7519</strong> - JWT token format</li>
          </ul>

          <h4>Security Architecture</h4>
          <ul>
            <li>User tokens never leave BFF</li>
            <li>Token exchange narrows scope and audience</li>
            <li>MCP token only valid for MCP server</li>
            <li>Banking API validates audience and scopes</li>
            <li>Complete audit trail with act claims</li>
          </ul>

          <h4>Token Flow Summary</h4>
          <ul>
            <li><strong>User Token</strong> - Broad audience, many scopes</li>
            <li><strong>MCP Token</strong> - MCP audience, tool scopes</li>
            <li><strong>Banking API</strong> - Validates MCP token only</li>
            <li><strong>No raw tokens</strong> - Exposed to browser</li>
            <li><strong>Each hop</strong> - Narrows token privileges</li>
          </ul>

          <div style={{ marginTop: '16px', padding: '12px', background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: '6px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#ef6c00' }}>🔄 Key Flows</h5>
            <p style={{ margin: '0', fontSize: '0.85rem', color: '#424242' }}>
              This diagram combines multiple flows: User login → Agent request → Token exchange → 
              MCP tool call → Banking API → Response. Each step includes detailed RFC compliance notes.
            </p>
          </div>
        </>
      ),
    },
    {
      id: 'rfc-compliance',
      label: 'RFC Compliance',
      content: (
        <>
          <h3>RFC Compliance Matrix</h3>
          <p>
            All flow diagrams include comprehensive RFC annotations to ensure standards compliance and provide technical reference for implementation.
          </p>

          <h4>OAuth 2.0 Core Standards</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>RFC</th>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Title</th>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Usage</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 6749</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>OAuth 2.0 Framework</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Core authorization framework</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 7636</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>PKCE</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Public client authentication</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 8693</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Token Exchange</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Delegation and token narrowing</td>
              </tr>
            </tbody>
          </table>

          <h4>Security and Resource Standards</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>RFC</th>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Title</th>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Usage</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 8707</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Resource Indicators</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Audience binding</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 7519</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>JWT</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Token format and validation</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 7523</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>JWT Client Auth</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Machine-to-machine auth</td>
              </tr>
            </tbody>
          </table>

          <h4>Advanced Standards</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>RFC</th>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Title</th>
                <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Usage</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 9396</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Rich Authorization Requests</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Transaction binding</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>RFC 9728</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>AS Discovery</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Dynamic endpoint discovery</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>UMA 2.0</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>User-Managed Access</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>Consent management</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: '16px', padding: '12px', background: '#e1f5fe', border: '1px solid #81d4fa', borderRadius: '6px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#0277bd' }}>📚 Reference Implementation</h5>
            <p style={{ margin: '0', fontSize: '0.85rem', color: '#424242' }}>
              The Super Banking demo serves as a reference implementation for these RFC standards,
              with complete code examples and best practices documented throughout the codebase.
            </p>
          </div>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Flow Diagrams"
      subtitle="Technical Architecture with RFC Annotations"
      tabs={tabs}
      initialTabId={initialTabId || 'overview'}
    />
  );
}
