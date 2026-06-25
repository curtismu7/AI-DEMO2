// banking_api_ui/src/components/education/Oidc21Panel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

function WhatChangedContent() {
  return (
    <>
      <h3>Key changes from OIDC Core 1.0 → OIDC 2.1</h3>
      <p>
        OpenID Connect 2.1 is a consolidation draft that tightens the security baseline of the original
        spec. It makes mandatory what was previously &ldquo;recommended&rdquo;, and removes the patterns
        that have proven insecure in practice.
      </p>

      <h4>1. PKCE is mandatory for all Authorization Code flows</h4>
      <p>
        In OIDC Core 1.0, PKCE (Proof Key for Code Exchange, RFC 7636) was optional — apps could omit
        it. OIDC 2.1 makes PKCE <strong>required</strong> for every Authorization Code flow. This closes
        the authorization code injection attack that was discovered in public client deployments.
      </p>

      <h4>2. Implicit flow removed</h4>
      <p>
        The <code className="edu-code">response_type=token</code> and{' '}
        <code className="edu-code">response_type=id_token</code> flows that return tokens directly in the
        URL fragment are <strong>no longer permitted</strong>. URL fragments land in browser history,
        referrer headers, and server logs. Tokens must only be returned via the back-channel code exchange.
      </p>

      <h4>3. Resource Indicators (RFC 8707) alignment</h4>
      <p>
        OIDC 2.1 aligns with Resource Indicators, making audience-scoped tokens the expected pattern.
        Access tokens should be bound to a specific resource (e.g., the MCP server) rather than issued
        as ambient bearer tokens valid for any service.
      </p>

      <h4>4. Refresh token rotation recommended</h4>
      <p>
        Refresh tokens should be rotated on each use. This ensures that if a refresh token is compromised,
        it can only be used once — the next legitimate use will detect the theft (double-use detection).
      </p>

      <h4>5. Nonce replay protection required</h4>
      <p>
        The Authorization Server <strong>must reject replayed nonces</strong>. In OIDC Core 1.0 this was
        recommended but not enforced. OIDC 2.1 makes it a hard requirement, closing CSRF-style replay
        attacks against the ID token.
      </p>

      <table className="edu-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.25rem' }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Feature</th>
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>OIDC Core 1.0</th>
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>OIDC 2.1</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['PKCE', 'Optional', 'Required'],
            ['Implicit flow', 'Allowed', 'Removed'],
            ['Resource indicators', 'Optional', 'Recommended'],
            ['Refresh rotation', 'Optional', 'Recommended'],
            ['Nonce replay protection', 'Recommended', 'Required'],
          ].map(([feature, v1, v21], i) => (
            <tr key={feature} style={{ background: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
              <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f1f5f9', fontWeight: 500 }}>{feature}</td>
              <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>{v1}</td>
              <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f1f5f9', color: '#b91c1c', fontWeight: 500 }}>{v21}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AgentsCareContent() {
  return (
    <>
      <h3>Why OIDC 2.1 matters for AI agent architectures</h3>
      <p>
        OIDC 2.1&rsquo;s changes are not just academic — each one closes a concrete attack surface that
        becomes more dangerous when <em>non-human agents</em> are in the auth loop.
      </p>

      <h4>Mandatory PKCE prevents code interception by rogue agents</h4>
      <p>
        In multi-agent or shared-host environments, a malicious agent could intercept authorization codes
        in transit. PKCE means the code is useless without the code verifier — which lives only in the
        legitimate BFF process memory.
      </p>

      <h4>No implicit flow — agents cannot receive tokens in URL fragments</h4>
      <p>
        If an agent received tokens in URL fragments (the old implicit flow), those tokens would appear
        in web server logs, referrer headers, and the agent&rsquo;s conversation history. With implicit
        flow removed, tokens are always exchanged server-side via the back-channel.
      </p>

      <h4>Resource indicators scope each token to one upstream</h4>
      <p>
        AI agents often call multiple upstream APIs (banking API, MCP server, memory stores). Resource
        Indicators (RFC 8707) ensure that each access token is audience-locked to exactly one resource.
        A compromised token for the MCP server cannot be used against the banking API.
      </p>

      <h4>Refresh rotation limits blast radius of a compromised agent session</h4>
      <p>
        If an agent&rsquo;s session is hijacked, refresh rotation ensures the attacker can only use the
        stolen refresh token once before the double-use detection fires. The legitimate session continues;
        the attacker is locked out.
      </p>

      <div
        style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '0.875rem 1rem',
          marginTop: '1.25rem',
        }}
      >
        <strong style={{ color: '#b91c1c' }}>This demo is OIDC 2.1-aligned:</strong>
        <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', color: '#374151' }}>
          <li>BFF holds all tokens — browser never receives a token</li>
          <li>PKCE always used (code_verifier stored in server session)</li>
          <li>Audience-scoped tokens issued per MCP exchange target</li>
          <li>Nonce generated and verified per login session</li>
        </ul>
      </div>
    </>
  );
}

function SpecLinksContent({ onOpenLoginFlow }) {
  return (
    <>
      <h3>Spec &amp; references</h3>
      <p>
        OIDC 2.1 is a consolidation draft — not yet final. This demo aligns to its security
        recommendations, which are stable and widely adopted even before final publication.
      </p>

      <h4>Primary spec</h4>
      <ul>
        <li>
          <a
            href="https://openid.net/specs/openid-connect-core-2_0.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#b91c1c' }}
          >
            OpenID Connect Core 2.0 (OIDC 2.1 working draft)
          </a>{' '}
          — openid.net
        </li>
        <li>
          <a
            href="https://openid.net/specs/openid-connect-core-1_0.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#b91c1c' }}
          >
            OpenID Connect Core 1.0
          </a>{' '}
          — for comparison
        </li>
      </ul>

      <h4>Referenced RFCs</h4>
      <ul>
        <li>
          <a href="https://datatracker.ietf.org/doc/html/rfc7636" target="_blank" rel="noopener noreferrer" style={{ color: '#b91c1c' }}>
            RFC 7636
          </a>{' '}
          — PKCE (Proof Key for Code Exchange)
        </li>
        <li>
          <a href="https://datatracker.ietf.org/doc/html/rfc8707" target="_blank" rel="noopener noreferrer" style={{ color: '#b91c1c' }}>
            RFC 8707
          </a>{' '}
          — Resource Indicators for OAuth 2.0
        </li>
        <li>
          <a href="https://datatracker.ietf.org/doc/html/rfc9700" target="_blank" rel="noopener noreferrer" style={{ color: '#b91c1c' }}>
            RFC 9700
          </a>{' '}
          — OAuth 2.0 Security Best Current Practice
        </li>
      </ul>

      <h4>In this demo</h4>
      <p>
        Login uses Authorization Code + PKCE. The BFF generates the{' '}
        <code className="edu-code">code_verifier</code>, stores it in the server session, and exchanges
        the authorization code for tokens entirely server-side.
      </p>
      {onOpenLoginFlow && (
        <button
          type="button"
          onClick={onOpenLoginFlow}
          style={{
            marginTop: '0.75rem',
            background: 'none',
            border: '1px solid #b91c1c',
            color: '#b91c1c',
            borderRadius: '6px',
            padding: '0.375rem 0.75rem',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Open Login flow panel →
        </button>
      )}
    </>
  );
}

export default function Oidc21Panel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const tabs = [
    {
      id: 'what',
      label: 'What changed',
      content: <WhatChangedContent />,
    },
    {
      id: 'agents',
      label: 'Why AI agents care',
      content: <AgentsCareContent />,
    },
    {
      id: 'spec',
      label: 'Spec & links',
      content: (
        <SpecLinksContent
          onOpenLoginFlow={() => {
            onClose();
            open(EDU.LOGIN_FLOW, 'what');
          }}
        />
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="OpenID Connect 2.1"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
