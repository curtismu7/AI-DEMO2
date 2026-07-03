import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function TransactionTokensPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what-why',
      label: 'What & Why',
      content: (
        <>
          <h3>The problem</h3>
          <p>
            The MCP gateway forwards a bearer token to the MCP server. That token is bound to a
            user identity but carries no context about <em>which tool was called</em>, in{' '}
            <em>which session</em>, for <em>what purpose</em>. A token captured from the
            gateway&rarr;server leg could be replayed in a different tool call.
          </p>
          <p>
            Additionally, the TX token&apos;s audience (<code>ping.demo</code>) covers the
            gateway and both MCP servers. A client with a valid TX token could bypass the
            gateway&apos;s PingOne Authorization Server check entirely by calling an MCP server directly.
          </p>
          <h3>The solution</h3>
          <p>
            <strong>Transaction Tokens (TraT)</strong> cryptographically bind each tool call to
            its originating context. <strong>mTLS</strong> between the gateway and MCP servers
            closes the bypass gap — MCP servers only accept connections from the gateway.
          </p>
        </>
      ),
    },
    {
      id: 'how-it-works',
      label: 'How It Works',
      content: (
        <>
          <h3>Flow</h3>
          <ol>
            <li>BFF performs RFC 8693 exchange (user + agent) &rarr; TX token (<code>aud: ping.demo</code>)</li>
            <li>BFF builds TraT context: <code>reqctx</code>, <code>purp</code>, <code>azd</code>, <code>rctx</code></li>
            <li>BFF attaches <code>X-TraT-Context</code> header (simulation) or TX token carries claims natively</li>
            <li>Gateway evaluates TX token + TraT claims via PingOne Authorize &rarr; PERMIT</li>
            <li>Gateway forwards TX token + TraT header to MCP server over mTLS-authenticated WebSocket</li>
            <li>MCP server verifies gateway client cert &rarr; executes tool</li>
          </ol>
        </>
      ),
    },
    {
      id: 'claims',
      label: 'Claims',
      content: (
        <>
          <h3>TraT Claims</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Claim</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px' }}><code>reqctx</code></td>
                <td style={{ padding: '4px 8px' }}>object</td>
                <td style={{ padding: '4px 8px' }}>Request context — tool, session_id, correlation_id</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px' }}><code>purp</code></td>
                <td style={{ padding: '4px 8px' }}>string</td>
                <td style={{ padding: '4px 8px' }}>Purpose of the transaction (e.g. <code>banking:mcp:tool_call</code>)</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px' }}><code>azd</code></td>
                <td style={{ padding: '4px 8px' }}>object</td>
                <td style={{ padding: '4px 8px' }}>Authorized delegation chain (sub, act, gateway)</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px' }}><code>rctx</code></td>
                <td style={{ padding: '4px 8px' }}>object</td>
                <td style={{ padding: '4px 8px' }}>Requester context (ip, user_agent, timestamp)</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px' }}><code>trat_sim</code></td>
                <td style={{ padding: '4px 8px' }}>boolean</td>
                <td style={{ padding: '4px 8px' }}>Present when BFF-simulated; absent when PingOne-native</td>
              </tr>
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: 'mtls',
      label: 'mTLS',
      content: (
        <>
          <h3>Why mTLS?</h3>
          <p>
            The TX token&apos;s audience is <code>ping.demo</code> — intentionally broad so it
            works at both the gateway and downstream MCP servers. Without an additional
            enforcement mechanism, a client with a valid TX token could call an MCP server
            directly, bypassing the gateway&apos;s PingOne Authorization Server check.
          </p>
          <h3>How it works in this demo</h3>
          <p>
            The gateway generates a self-signed client certificate at startup (<code>selfsigned</code>{' '}
            package, in-memory). When <code>MCP_MTLS_ENABLED=true</code>:
          </p>
          <ul>
            <li>Gateway writes its client cert to <code>MCP_MTLS_GATEWAY_CERT_PATH</code> (default: <code>/tmp/gw-client.crt</code>)</li>
            <li>MCP servers start as HTTPS servers with <code>requestCert: true</code> and pin the gateway cert</li>
            <li>Connections without the gateway cert are rejected at the TLS handshake — no application code runs</li>
          </ul>
          <p>
            The Token Chain shows <strong>mTLS active</strong> when enforced, <strong>mTLS disabled</strong> when not.
          </p>
        </>
      ),
    },
    {
      id: 'draft-status',
      label: 'Draft Status',
      content: (
        <>
          <h3>IETF Draft Status</h3>
          <p><strong>Spec:</strong> <code>draft-araut-oauth-transaction-tokens-for-agents</code> (agent-specific extension)</p>
          <p><strong>Base spec:</strong> <code>draft-ietf-oauth-transaction-tokens</code> (WG-adopted)</p>
          <p><strong>Working Group:</strong> OAUTH</p>
          <p><strong>Maturity:</strong> Individual draft — agent extension is pre-WG adoption as of May 2026</p>
          <p>
            PingOne native TraT support is pending. This demo simulates TraT using{' '}
            <code>X-TraT-Context</code> headers and <code>trat_sim: true</code>.
          </p>
        </>
      ),
    },
    {
      id: 'this-demo',
      label: 'This Demo',
      content: (
        <>
          <h3>This demo</h3>
          <p>
            <strong>Simulation mode</strong> (<code>trat_sim: true</code>): the BFF builds the
            TraT context and injects it as an <code>X-TraT-Context</code> header. PingOne does
            not yet natively emit TraT claims — the header is the shim.
          </p>
          <p>
            <strong>Native mode</strong> (future): PingOne emits <code>reqctx</code>,{' '}
            <code>purp</code>, <code>azd</code>, <code>rctx</code> directly in the TX token. No
            header needed.
          </p>
          <h3>How to enable</h3>
          <ol>
            <li>Set <code>ff_trat_mode=true</code> in the Config UI</li>
            <li>Run <code>npm run pingone:setup:trat</code> to provision PingOne token policy claims</li>
            <li>Set <code>MCP_MTLS_ENABLED=true</code> in gateway + MCP server env vars to enforce mTLS</li>
          </ol>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Transaction Tokens (TraT)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
