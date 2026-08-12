// banking_api_ui/src/components/education/RFC8693Panel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import RfcLink from '../shared/RfcLink';
import TokenAudienceChain from './TokenAudienceChain';

export default function RFC8693Panel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'overview',
      label: 'RFC 8693 Overview',
      content: (
        <>
          <h3>OAuth 2.0 Token Exchange (RFC 8693)</h3>
          <p>
            <RfcLink rfc="RFC_8693" /> defines an OAuth 2.0 extension that allows clients to obtain security tokens
            from authorization servers by presenting existing tokens. This enables delegation scenarios where
            one service can act on behalf of a user without sharing their original credentials.
          </p>
          
          <h4>Key Concepts</h4>
          <ul>
            <li><strong>Subject Token</strong> - The original token representing the user's identity</li>
            <li><strong>Actor Token</strong> - Optional token representing the service acting on behalf of the user</li>
            <li><strong>Issued Token</strong> - New token with narrowed scope/audience for the target service</li>
            <li><strong>Act Claim</strong> - JWT claim that records the delegation chain (who acted on behalf of whom)</li>
          </ul>

          <h4>Why Token Exchange?</h4>
          <ul>
            <li><strong>Audience Isolation</strong> - Tokens are scoped to specific resource servers</li>
            <li><strong>Scope Narrowing</strong> - Least privilege principle with minimal permissions</li>
            <li><strong>Delegation Audit Trail</strong> - Clear record of who acted on behalf of whom</li>
            <li><strong>Security Boundary</strong> - Original tokens never leave trusted boundaries</li>
          </ul>

          <h4>Use Cases in AI Demo</h4>
          <ul>
            <li><strong>MCP Server Access</strong> - Exchange user token for MCP-specific token</li>
            <li><strong>AI Agent Delegation</strong> - Agent acts on user's behalf with audit trail</li>
            <li><strong>Service-to-Service</strong> - Backend services call each other with user context</li>
          </ul>
        </>
      ),
    },
    {
      id: 'protocol',
      label: 'Protocol Details',
      content: (
        <>
          <h3>RFC 8693 Protocol Specification</h3>
          
          <h4>Grant Type</h4>
          <pre className="edu-code">{`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`}</pre>
          
          <h4>Request Parameters</h4>
          <table className="edu-table">
            <thead>
              <tr >
                <th >Parameter</th>
                <th >Required</th>
                <th >Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td ><code>grant_type</code></td>
                <td >Yes</td>
                <td >Must be the token-exchange URN</td>
              </tr>
              <tr>
                <td ><code>subject_token</code></td>
                <td >Yes</td>
                <td >The token being exchanged (user's access token)</td>
              </tr>
              <tr>
                <td ><code>subject_token_type</code></td>
                <td >Yes</td>
                <td >Type of subject token (usually <code>urn:ietf:params:oauth:token-type:access_token</code>)</td>
              </tr>
              <tr>
                <td ><code>actor_token</code></td>
                <td >No</td>
                <td >Optional token representing the acting service</td>
              </tr>
              <tr>
                <td ><code>actor_token_type</code></td>
                <td >No</td>
                <td >Type of actor token (if actor_token is provided)</td>
              </tr>
              <tr>
                <td ><code>audience</code></td>
                <td >No</td>
                <td >Target resource server URI</td>
              </tr>
              <tr>
                <td ><code>scope</code></td>
                <td >No</td>
                <td >Requested scopes for the issued token</td>
              </tr>
              <tr>
                <td ><code>requested_token_type</code></td>
                <td >No</td>
                <td >Type of token to issue (usually access_token)</td>
              </tr>
            </tbody>
          </table>

          <h4>Response Format</h4>
          <pre className="edu-code">{`HTTP/1.1 200 OK
Content-Type: application/json

{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "accounts:read transactions:read",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}`}</pre>
        </>
      ),
    },
    {
      id: 'act-claim',
      label: 'Act Claim Structure',
      content: (
        <>
          <h3>The Act Claim - Delegation Tracking</h3>
          <p>
            The <code>act</code> claim is the cornerstone of RFC 8693 delegation. It creates an audit trail 
            showing which service acted on behalf of which principal.
          </p>

          <h4>Act Claim Structure</h4>
          <pre className="edu-code">{`{
  "sub": "user-123",
  "aud": "https://mcp-server.example.com",
  "scope": "accounts:read",
  "act": {
    "sub": "agent-client-456"
  }
}`}</pre>

          <h4>Multi-Hop Delegation</h4>
          <p>
            RFC 8693 supports nested delegation through the <code>act.act</code> structure, enabling 
            complex delegation chains like User → Agent → Service.
          </p>
          <pre className="edu-code">{`{
  "sub": "user-123",
  "act": {
    "sub": "agent-client-456",
    "act": {
      "sub": "service-client-789"
    }
  }
}`}</pre>

          <h4>Canonical Form (RFC 8693 §4.1)</h4>
          <p>
            The RFC specifies that <code>act.sub</code> is the canonical way to identify the actor. 
            Implementations should prefer <code>act.sub</code> over <code>act.client_id</code> when available.
          </p>
          <pre className="edu-code">{`// Preferred (canonical form)
"act": {
  "sub": "agent-client-456"
}

// Alternative (if sub not available)
"act": {
  "client_id": "agent-client-456"
}`}</pre>

          <h4>PingOne: How act is gated during exchange</h4>
          <p>
            PingOne sets the <code>act</code> claim when the actor's credentials are valid and
            platform-level delegation policies authorize the exchange. The <code>act</code> claim
            is populated via an Advanced Expression on the custom resource's attribute:
          </p>
          <pre className="edu-code">{`(#root.context.requestData.actorToken.client_id != null)
  ? { "sub": #root.context.requestData.actorToken.client_id }
  : null`}</pre>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            If the actor token is absent or invalid, <code>act</code> is set to <code>null</code>. If the attribute is marked
            required, the exchange fails outright. This is why "act absent" appears in the Token Chain when
            the agent credentials are not properly configured.
          </p>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            For <code>client_credentials</code> grants (no user), the expression returns <code>"noActor"</code>
            instead of null so the grant still succeeds.
          </p>

          <h4>In this demo</h4>
          <ul>
            <li>Identify the AI Agent that initiated the request</li>
            <li>Enable PingOne Authorize policies to check actor identity</li>
            <li>Provide audit trails for compliance and debugging</li>
            <li>Support fine-grained access control based on actor permissions</li>
          </ul>
        </>
      ),
    },
    {
      id: 'hops',
      label: 'Exchange Hops',
      content: (
        <>
          <h3>JWT Payloads at Each Exchange Hop</h3>
          <p>
            The <strong>2-Token Exchange</strong> flow produces two distinct tokens — the original user token and the single BFF-exchanged token that travels through the gateway to the MCP Server unchanged.
            Each hop narrows the audience and adds (or preserves) the <code>act</code> delegation claim.
            Your live tokens appear in the Token Chain panel above. <RfcLink rfc="RFC_8693" />
          </p>

          <TokenAudienceChain />

          <h4>Hop 0 — User Token (from login)</h4>
          <p>What your browser session holds after OIDC login. Audience is the BFF resource server.</p>
          <pre className="edu-code">{`{
  "sub":   "user-abc123",
  "aud":   "olb-resource.ping.demo",
  "iss":   "https://auth.pingone.com/...",
  "scope": "read write",
  "iat":   1714000000,
  "exp":   1714003600
  // No "act" claim — this is the raw user token
}`}</pre>

          <h4>Hop 1 — GW Delegated Token (Exchange #1)</h4>
          <p>
            After Exchange #1: <code>subject_token</code> = User Token, <code>actor_token</code> = Agent CC token.
            Audience narrows to the Ping Agent Gateway. The <code>act</code> claim is added.
          </p>
          <pre className="edu-code">{`{
  "sub":   "user-abc123",           // preserved from Hop 0
  "aud":   "https://api.ping.demo",  // narrowed to gateway audience
  "iss":   "https://auth.pingone.com/...",
  "scope": "read write ai_agent",
  "act": {
    "sub": "agent1-client-id"       // who is acting on behalf of the user
  },
  "iat":   1714000005,
  "exp":   1714001805
}`}</pre>

          <h4>Hop 2 — MCP Server receives the same token (no re-exchange)</h4>
          <p>
            The Ping Agent Gateway forwards the Exchange #1 token <strong>unchanged</strong> to the MCP Server.
            No second RFC 8693 exchange occurs — the token issued by PingOne at Hop 1 is valid at
            both the gateway and the downstream MCP servers by design (<code>aud=mcp-gw</code> is accepted at both).
            The <code>act</code> claim is preserved end-to-end.
          </p>
          <pre className="edu-code">{`{
  "sub":   "user-abc123",             // still the human user
  "aud":   "mcp-gw",                  // same token forwarded — aud unchanged
  "iss":   "https://auth.pingone.com/...",
  "scope": "read write",
  "act": {
    "sub": "agent1-client-id"         // preserved from Hop 1
  },
  "iat":   1714000005,
  "exp":   1714001805
}`}</pre>

          <div className="edu-info-box">
            <strong>What changes hop-to-hop:</strong> Exchange #1 (at the BFF) narrows <code>aud</code> to
            <code>mcp-gw</code> and adds the <code>act</code> claim. After that, the token travels
            unchanged — the Ping Agent Gateway is a passthrough, not a second exchange point.
            <code>sub</code> always stays as the human user. <code>act.sub</code> is the audit trail
            proving the agent acted on the user's behalf.
          </div>
        </>
      ),
    },
    {
      id: 'security',
      label: 'Security Considerations',
      content: (
        <>
          <h3>RFC 8693 Security Best Practices</h3>
          
          <h4>Token Isolation</h4>
          <ul>
            <li><strong>Never Forward Subject Tokens</strong> - Original tokens stay within trusted boundaries</li>
            <li><strong>Audience Restriction</strong> - Issued tokens only valid for specific resource servers</li>
            <li><strong>Scope Minimization</strong> - Grant only necessary permissions for each exchange</li>
            <li><strong>Short Lifetime</strong> - Issued tokens should have minimal expiration times</li>
          </ul>

          <h4>Validation Requirements</h4>
          <ul>
            <li><strong>Subject Token Validation</strong> - Verify subject token is valid and not expired</li>
            <li><strong>Actor Token Validation</strong> - Verify actor token has permission to act</li>
            <li><strong>Policy Enforcement</strong> - Check platform-level delegation policies before allowing exchange</li>
            <li><strong>Audit Logging</strong> - Record all token exchanges for security monitoring</li>
          </ul>

          <h4>Common Attack Vectors</h4>
          <table className="edu-table">
            <thead>
              <tr >
                <th >Attack</th>
                <th >Mitigation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td >Token Replay</td>
                <td >Use short expiration times, unique token IDs</td>
              </tr>
              <tr>
                <td >Privilege Escalation</td>
                <td >Strict scope validation, policy enforcement</td>
              </tr>
              <tr>
                <td >Actor Impersonation</td>
                <td >Validate actor token permissions, may_act policies</td>
              </tr>
              <tr>
                <td >Cross-Tenant Access</td>
                <td >Audience validation, tenant isolation</td>
              </tr>
            </tbody>
          </table>

          <h4>AI Demo Security Measures</h4>
          <ul>
            <li><strong>JWKS Validation</strong> - All tokens validated against PingOne signing keys</li>
            <li><strong>Policy Integration</strong> - PingOne Authorize policies enforce delegation rules</li>
            <li><strong>Token Events</strong> - Comprehensive audit trail of all exchanges</li>
            <li><strong>Scope Catalog</strong> - Predefined scopes prevent scope injection attacks</li>
            <li><strong>Resource Validation</strong> - Audience matching prevents cross-resource access</li>
          </ul>
        </>
      ),
    },
    {
      id: 'examples',
      label: 'Real-World Examples',
      content: (
        <>
          <h3>RFC 8693 in AI Demo - Code Examples</h3>
          
          <h4>Simple Delegation (No Actor Token)</h4>
          <p>
            User token → MCP token without actor identification
          </p>
          <pre className="edu-code">{`// Request
POST /as/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=eyJhbGciOiJSUzI1NiIs...
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=https://mcp-server.example.com
&scope=accounts:read
&requested_token_type=urn:ietf:params:oauth:token-type:access_token

// Response (no act claim - user acts directly)
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "accounts:read"
}`}</pre>

          <h4>2-Token Exchange (Agent Delegation)</h4>
          <p>
            User token + Agent token → MCP token with actor identification (<RfcLink rfc="RFC_8693" section="§4" />)
          </p>
          <pre className="edu-code">{`// Request
POST /as/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=eyJhbGciOiJSUzI1NiIs...
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=eyJhbGciOiJSUzI1NiIs...
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=https://mcp-server.example.com
&scope=accounts:read
&requested_token_type=urn:ietf:params:oauth:token-type:access_token

// Response (with act claim - agent acts on behalf of user)
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer", 
  "expires_in": 3600,
  "scope": "accounts:read"
}

// Decoded issued token
{
  "sub": "user-123",
  "aud": "https://mcp-server.example.com",
  "scope": "accounts:read",
  "act": {
    "sub": "agent-client-456"
  }
}`}</pre>

          <h4>Implementation in AI Demo</h4>
          <pre className="edu-code">{`// From: demo_api_server/services/oauthService.js

// Simple exchange (1-exchange)
async performTokenExchange(subjectToken, audience, scopes) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: audience,
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    client_id: this.config.clientId,
  });
  // ... make request to PingOne
}

// 2-token exchange (subject + actor in a single RFC 8693 call)
async performTokenExchangeWithActor(subjectToken, actorToken, audience, scopes) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    actor_token: actorToken,
    actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: audience,
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    client_id: this.config.clientId,
  });
  // ... make request to PingOne
}`}</pre>
        </>
      ),
    },
    {
      id: 'troubleshooting',
      label: 'Troubleshooting',
      content: (
        <>
          <h3>Common RFC 8693 Issues and Solutions</h3>
          
          <h4>Error: invalid_grant</h4>
          <p><strong>Cause</strong>: Subject token is expired, invalid, or doesn't have required permissions</p>
          <p><strong>Solution</strong>: Refresh subject token before exchange, check token validity</p>
          
          <h4>Error: unauthorized_client</h4>
          <p><strong>Cause</strong>: Token Exchange grant not enabled on the OAuth client</p>
          <p><strong>Solution</strong>: Enable Token Exchange grant in PingOne application settings</p>
          
          <h4>Error: invalid_scope</h4>
          <p><strong>Cause</strong>: Requested scopes not available or include incompatible scopes</p>
          <p><strong>Solution</strong>: Remove openid scope, check resource server scope configuration</p>
          
          <h4>Error: invalid_audience</h4>
          <p><strong>Cause</strong>: Audience doesn't match any configured resource server</p>
          <p><strong>Solution</strong>: Verify audience URI matches resource server configuration</p>
          
          <h4>Error: may_act_denied</h4>
          <p><strong>Cause</strong>: Actor doesn't have permission to act on behalf of subject</p>
          <p><strong>Solution</strong>: Configure may_act policy in PingOne, check actor token permissions</p>

          <h4>Debugging Tips</h4>
          <ul>
            <li><strong>Check Token Claims</strong>: Use jwt.io to decode and verify token contents</li>
            <li><strong>Verify Policy</strong>: Ensure may_act policy allows the actor-client relationship</li>
            <li><strong>Audit Logs</strong>: Check PingOne logs for detailed error information</li>
            <li><strong>Token Events</strong>: Use AI Demo Token Chain panel for debugging</li>
          </ul>

          <h4>AI Demo Debug Features</h4>
          <ul>
            <li><strong>Token Events Panel</strong>: Shows complete token exchange flow with decoded claims</li>
            <li><strong>Live Token Inspection</strong>: Real-time token validation and claim analysis</li>
            <li><strong>Exchange Audit</strong>: Complete audit trail of all token exchanges</li>
            <li><strong>Policy Testing</strong>: Test PingOne Authorize policies in isolation</li>
          </ul>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="RFC 8693 Token Exchange"
      subtitle="OAuth 2.0 Token Exchange Standard"
      tabs={tabs}
      initialTabId={initialTabId || 'overview'}
    />
  );
}
