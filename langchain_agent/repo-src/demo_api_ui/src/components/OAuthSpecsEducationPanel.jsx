import React, { useState } from 'react';
import './OAuthSpecsEducationPanel.css';

/**
 * Interactive Education Panel: OAuth Standards & Agent Authorization
 * 
 * Displays RFC compliance, implementation status, and feature flag information
 * for OAuth 2.0, OpenID Connect, and Transaction Tokens (draft).
 */

const SPECS = [
  {
    id: 'rfc8693',
    name: 'RFC 8693 — Token Exchange',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'OAuth 2.0 Token Exchange for delegation. Primary mechanism for exchanging user tokens for agent-scoped MCP tokens.',
    details: (
      <>
        <h4>Overview</h4>
        <p>
          RFC 8693 allows a client (BFF) to exchange tokens on behalf of a user for narrowly-scoped tokens usable by a third party (MCP agent).
        </p>
        <h4>Grant Type</h4>
        <code>grant_type = urn:ietf:params:oauth:grant-type:token-exchange</code>
        
        <h4>Implementation Paths</h4>
        <ul>
          <li><strong>1-Exchange:</strong> User token → MCP token (no delegation)</li>
          <li><strong>2-Exchange:</strong> User + Actor → MCP token with <code>act</code> claim</li>
        </ul>

        <h4>Key Claims</h4>
        <ul>
          <li><code>sub</code> — Subject (user ID)</li>
          <li><code>aud</code> — Audience (MCP server URI)</li>
          <li><code>act</code> — Actor (optional, agent ID in 2-exchange)</li>
          <li><code>may_act</code> — Permission to force actor identity</li>
        </ul>

        <h4>Demo Entry Points</h4>
        <ul>
          <li><strong>Admin → Token Chain:</strong> Watch live 2-exchange as agent makes tool call</li>
          <li><strong>Admin → Token Inspect:</strong> Paste MCP token, see <code>act</code> claim</li>
          <li><strong>OAuth Log:</strong> See <code>/token</code> requests with exchange parameters</li>
        </ul>

        <h4>Compliance</h4>
        <p>
          ✅ <strong>Full Compliance.</strong> Both exchange paths implemented. Delegation via <code>act</code> claim per spec.
        </p>
      </>
    ),
  },
  {
    id: 'transaction-tokens',
    name: 'Transaction Tokens For Agents (Draft)',
    status: 'draft',
    implemented: true,
    optional: true,
    featureFlag: 'ff_oauth_transaction_tokens',
    description: 'Optional extension to RFC 8693 with transaction binding, ephemeral attestation, and agent context. Feature flag: TOKEN_EXCHANGE_MODE=transaction-tokens',
    details: (
      <>
        <h4>Overview</h4>
        <p>
          Transaction Tokens extend RFC 8693 with <strong>transaction ID binding</strong>, <strong>ephemeral agent attestation</strong>, 
          and explicit <strong>scope binding</strong>. Designed for agent-to-agent calls requiring transaction context.
        </p>

        <h4>What's New vs. RFC 8693</h4>
        <table className="oauthspec-comparison">
          <thead>
            <tr>
              <th>Aspect</th>
              <th>RFC 8693</th>
              <th>Transaction Tokens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Transaction Binding</td>
              <td>No</td>
              <td>✅ <code>txn_id</code> in exchange</td>
            </tr>
            <tr>
              <td>Scope Binding</td>
              <td>Audience only</td>
              <td>✅ <code>scope: read:txn-{'{txn_id}'}</code></td>
            </tr>
            <tr>
              <td>Agent Attestation</td>
              <td>Static client secret</td>
              <td>✅ Ephemeral assertion + nonce</td>
            </tr>
            <tr>
              <td>Per-Transaction Revocation</td>
              <td>No</td>
              <td>✅ Revoke entire transaction</td>
            </tr>
            <tr>
              <td>Audit Trail</td>
              <td>Implicit</td>
              <td>✅ Explicit transaction record</td>
            </tr>
          </tbody>
        </table>

        <h4>Exchange Flow</h4>
        <code className="oauthspec-code">
          1. POST /api/agent-txn/start → txn_id generated<br/>
          2. BFF calls POST /token with txn_id + scope binding<br/>
          3. PingOne issues token with txn_id claim<br/>
          4. MCP server validates txn_id matches header<br/>
          5. Tool executes with transaction context<br/>
          6. Optional: POST /api/agent-txn/{'{txn_id}'}/revoke → invalidates all tokens
        </code>

        <h4>Feature Flag Status</h4>
        <div className="oauthspec-flag">
          <p><strong>Default:</strong> OFF (RFC 8693 used)</p>
          <p><strong>Enable:</strong> Set <code>TOKEN_EXCHANGE_MODE=transaction-tokens</code> in .env</p>
          <p><strong>Fallback:</strong> If server rejects draft, auto-retry with RFC 8693 (when <code>TOKEN_EXCHANGE_AUTO_FALLBACK=true</code>)</p>
        </div>

        <h4>Demo Entry Points (When Enabled)</h4>
        <ul>
          <li><strong>Settings → OAuth Mode:</strong> Shows "Active: Transaction Tokens"</li>
          <li><strong>Admin → Token Chain:</strong> Note <code>txn_id</code> in scope and JWT claims</li>
          <li><strong>Admin → Audit Log:</strong> Filter by <code>event_type: agent_txn_*</code></li>
        </ul>

        <h4>Status</h4>
        <p>
          🔄 <strong>Implemented as Opt-In.</strong> Implementation matches draft-06 (April 2026 snapshot).
          Draft status means spec may evolve; automatic fallback ensures stability.
        </p>
      </>
    ),
  },
  {
    id: 'rfc6749',
    name: 'RFC 6749 — OAuth 2.0 Base',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'Foundation for all OAuth 2.0 flows. Implements Authorization Code, Client Credentials, Refresh Token, and Token Exchange (RFC 8693) grant types.',
    details: (
      <>
        <h4>Overview</h4>
        <p>RFC 6749 is the base OAuth 2.0 specification defining grant types, client authentication, and token issuance.</p>
        
        <h4>Implemented Grant Types</h4>
        <ul>
          <li><strong>Authorization Code:</strong> User login (with PKCE)</li>
          <li><strong>Client Credentials:</strong> Agent actor token (internal)</li>
          <li><strong>Refresh Token:</strong> Silent session renewal</li>
          <li><strong>Token Exchange (RFC 8693):</strong> Agent delegation</li>
          <li><strong>CIBA (OpenID extension):</strong> Step-up authentication</li>
        </ul>

        <h4>Demo Entry Points</h4>
        <ul>
          <li><strong>OAuth Log:</strong> See grant types in use as you login and make agent calls</li>
        </ul>

        <h4>Compliance</h4>
        <p>✅ <strong>Full Compliance</strong> for implemented grant types.</p>
      </>
    ),
  },
  {
    id: 'rfc7636',
    name: 'RFC 7636 — PKCE',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'Proof Key for Code Exchange. Prevents authorization code interception attacks.',
    details: (
      <>
        <h4>Overview</h4>
        <p>
          PKCE adds a <code>code_verifier</code> secret and <code>code_challenge</code> hash to the authorization code flow,
          preventing malicious apps from stealing authorization codes.
        </p>

        <h4>Implementation</h4>
        <ul>
          <li><code>code_verifier:</code> Random 64-byte hex string</li>
          <li><code>code_challenge:</code> base64url(sha256(verifier))</li>
          <li><code>code_challenge_method:</code> S256 (SHA-256)</li>
          <li><strong>Storage:</strong> Server-side only (session + PKCE HMAC cookie for Vercel)</li>
        </ul>

        <h4>Demo Entry Points</h4>
        <ul>
          <li><strong>OAuth Log:</strong> Login → see <code>code_challenge</code> in redirect, <code>code_verifier</code> in token request</li>
        </ul>

        <h4>Compliance</h4>
        <p>✅ <strong>Full Compliance</strong>. S256 enforced; never falls back to plain code.</p>
      </>
    ),
  },
  {
    id: 'oidc-core',
    name: 'OpenID Connect Core',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'Authentication layer on top of OAuth 2.0. Provides id_token validation and userinfo endpoint.',
    details: (
      <>
        <h4>Overview</h4>
        <p>OpenID Connect extends OAuth 2.0 with authentication guarantees via <code>id_token</code> (signed JWT) and userinfo endpoint.</p>

        <h4>Implementation</h4>
        <ul>
          <li><code>id_token</code> validation: Signature (RS256 via JWKS), <code>iss</code>, <code>aud</code>, <code>exp</code>, <code>nonce</code></li>
          <li>JWKS cached from PingOne</li>
          <li><code>sub</code> used as canonical user ID</li>
        </ul>

        <h4>Demo Entry Points</h4>
        <ul>
          <li><strong>Token Chain:</strong> Expand login event → see <code>id_token</code> with claims</li>
        </ul>

        <h4>Compliance</h4>
        <p>✅ <strong>Full Compliance</strong>. All required validations implemented.</p>
      </>
    ),
  },
  {
    id: 'oidc-ciba',
    name: 'OpenID CIBA',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'Client-Initiated Backchannel Authentication. Used for step-up authentication on high-value actions.',
    details: (
      <>
        <h4>Overview</h4>
        <p>
          CIBA enables a client to initiate authentication on a backchannel (e.g., email OTP, push notification)
          while keeping the user on the original device/browser. Used for step-up MFA on transfers >$500.
        </p>

        <h4>Implementation (Poll Mode)</h4>
        <ul>
          <li><strong>Step 1:</strong> BFF → PingOne: <code>POST /bc-authorize</code> with user and high-value transaction hint</li>
          <li><strong>Step 2:</strong> PingOne sends OTP to user's email</li>
          <li><strong>Step 3:</strong> User approves or denies in email</li>
          <li><strong>Step 4:</strong> BFF polls: <code>POST /token grant_type=...backchannel_authentication_request</code></li>
          <li><strong>Step 5:</strong> User approves → BFF gets elevated token</li>
        </ul>

        <h4>Demo Entry Points</h4>
        <ul>
          <li><strong>Banking Agent:</strong> Ask to transfer >$500 → CIBA email sent → approve → transfer proceeds</li>
        </ul>

        <h4>Compliance</h4>
        <p>✅ <strong>Full Compliance</strong> (poll mode). Push mode not implemented.</p>
      </>
    ),
  },
  {
    id: 'rfc9126',
    name: 'RFC 9126 — PAR',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'Pushed Authorization Requests. Confidential request parameters via back-channel.',
    details: (
      <>
        <h4>Overview</h4>
        <p>
          PAR allows clients to POST authorization parameters to a back-channel endpoint first,
          then redirect the browser with only <code>request_uri</code>. Prevents eavesdropping on sensitive parameters.
        </p>

        <h4>Implementation</h4>
        <ul>
          <li>Flag: <code>use_par=true</code> in config</li>
          <li>BFF calls: <code>POST /as/par</code> with full auth request</li>
          <li>PingOne returns: <code>request_uri</code> + expiry</li>
          <li>Browser redirect: <code>?client_id=...&request_uri=...</code> only</li>
        </ul>

        <h4>Demo Entry Points</h4>
        <ul>
          <li><strong>Config:</strong> Enable <code>use_par=true</code> → login → OAuth Log shows <code>POST /par</code></li>
        </ul>

        <h4>Compliance</h4>
        <p>✅ <strong>Full Compliance</strong>.</p>
      </>
    ),
  },
  {
    id: 'rfc9700',
    name: 'RFC 9700 — Security BCP',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'OAuth 2.0 Security Best Current Practice. Applied controls: state/nonce, PKCE, exact redirect URI, token confidentiality.',
    details: (
      <>
        <h4>Key Controls Applied</h4>
        <ul>
          <li>✅ <code>state</code> parameter (CSRF prevention)</li>
          <li>✅ <code>nonce</code> in OpenID Connect (replay prevention)</li>
          <li>✅ PKCE (code interception prevention)</li>
          <li>✅ Exact redirect URI matching (auth code injection prevention)</li>
          <li>✅ Short-lived auth codes (enforced by PingOne)</li>
          <li>✅ Token confidentiality (BFF custodian, never in browser)</li>
        </ul>

        <h4>Compliance</h4>
        <p>✅ <strong>Full Compliance</strong> with applicable controls.</p>
      </>
    ),
  },
  {
    id: 'rfc8707',
    name: 'RFC 8707 — Resource Indicators',
    status: 'stable',
    implemented: true,
    optional: false,
    featureFlag: null,
    description: 'Partial. Audience parameter used in token exchange; resource parameter not used in initial /authorize.',
    details: (
      <>
        <h4>Overview</h4>
        <p>
          Resource Indicators allow a client to specify which resource server(s) the token is intended for,
          enabling PingOne to issue narrowly-scoped tokens by default.
        </p>

        <h4>Implementation</h4>
        <ul>
          <li><strong>In exchange:</strong> <code>audience = &lt;mcp_resource_uri&gt;</code></li>
          <li><strong>In /authorize:</strong> <code>resource</code> parameter not used (PingOne uses app configuration)</li>
        </ul>

        <h4>Compliance</h4>
        <p>⚠️ <strong>Partial Compliance</strong>. audience in exchange is full; resource in /authorize omitted by design.</p>
      </>
    ),
  },
];

const NOT_IMPLEMENTED = [
  {
    id: 'rfc8705',
    name: 'RFC 8705 — mTLS',
    reason: 'Not in scope. PingOne mTLS requires certificate provisioning.',
  },
  {
    id: 'rfc9449',
    name: 'RFC 9449 — DPoP',
    reason: 'Not in scope. Client-side key management complexity.',
  },
];

export default function OAuthSpecsEducationPanel() {
  const [activeTab, setActiveTab] = useState('rfc8693');
  const spec = SPECS.find(s => s.id === activeTab) || SPECS[0];

  const statusBadge = {
    stable: { label: 'RFC (Stable)', className: 'oauthspec-badge-stable' },
    draft: { label: 'Draft', className: 'oauthspec-badge-draft' },
  }[spec.status];

  return (
    <div className="oauthspec-container">
      <div className="oauthspec-header">
        <h2>OAuth 2.0 & Agent Authorization Standards</h2>
        <p className="oauthspec-subtitle">
          Interactive education guide. Learn about implemented standards, feature flags, and demo entry points.
        </p>
      </div>

      <div className="oauthspec-tabs">
        <div className="oauthspec-tab-nav">
          {SPECS.map(s => (
            <button
              key={s.id}
              className={`oauthspec-tab-btn ${activeTab === s.id ? 'active' : ''} ${s.optional ? 'optional' : ''}`}
              onClick={() => setActiveTab(s.id)}
              title={s.optional ? `Optional: ${s.featureFlag}` : 'Always implemented'}
            >
              <span className="oauthspec-tab-label">{s.name.split(' — ')[0]}</span>
              {s.optional && <span className="oauthspec-optional-indicator">🚩</span>}
            </button>
          ))}
        </div>

        <div className="oauthspec-tab-content">
          <div className="oauthspec-header-row">
            <h3>{spec.name}</h3>
            <div className="oauthspec-badges">
              <span className={`oauthspec-badge ${statusBadge.className}`}>{statusBadge.label}</span>
              {spec.implemented && (
                <span className="oauthspec-badge oauthspec-badge-implemented">✅ Implemented</span>
              )}
              {spec.optional && (
                <span className="oauthspec-badge oauthspec-badge-optional">🚩 Optional (Feature Flag)</span>
              )}
            </div>
          </div>

          <p className="oauthspec-description">{spec.description}</p>

          {spec.optional && spec.featureFlag && (
            <div className="oauthspec-feature-flag-alert">
              <strong>Feature Flag:</strong> <code>{spec.featureFlag}</code>
              <br/>
              <strong>Enable:</strong> Set <code>TOKEN_EXCHANGE_MODE=transaction-tokens</code> in .env
              <br/>
              <strong>Status:</strong> Off by default. Can enable for testing/evaluation.
            </div>
          )}

          <div className="oauthspec-details">
            {spec.details}
          </div>
        </div>
      </div>

      <div className="oauthspec-not-implemented">
        <h4>Not Implemented (Out of Scope)</h4>
        <ul>
          {NOT_IMPLEMENTED.map(ni => (
            <li key={ni.id}>
              <strong>{ni.name}:</strong> {ni.reason}
            </li>
          ))}
        </ul>
      </div>

      <div className="oauthspec-footer">
        <p>
          <strong>Last Updated:</strong> April 2026 | <strong>Reference:</strong> <a href="docs/RFC-STANDARDS.md" target="_blank" rel="noopener noreferrer">RFC-STANDARDS.md</a>
        </p>
      </div>
    </div>
  );
}
