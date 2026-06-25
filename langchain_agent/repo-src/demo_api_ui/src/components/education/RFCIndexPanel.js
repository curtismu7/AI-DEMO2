// banking_api_ui/src/components/education/RFCIndexPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';
import { EduImplIntro, SNIP_RFC_INDEX } from './educationImplementationSnippets';

const ROWS = [
  { rfc: 'RFC 6749', name: 'OAuth 2.0 Authorization Framework', app: 'Authorization Code flow', href: 'https://datatracker.ietf.org/doc/html/rfc6749', panel: EDU.LOGIN_FLOW, tab: 'what' },
  { rfc: 'RFC 7636', name: 'PKCE', app: 'code_challenge / code_verifier on login', href: 'https://datatracker.ietf.org/doc/html/rfc7636', panel: EDU.LOGIN_FLOW, tab: 'pkce' },
  { rfc: 'RFC 7519', name: 'JWT', app: 'User token, MCP token, …', href: 'https://datatracker.ietf.org/doc/html/rfc7519', panel: EDU.LOGIN_FLOW, tab: 'tokens' },
  { rfc: 'RFC 7517', name: 'JWK', app: 'JWKS for Banking API validation', href: 'https://datatracker.ietf.org/doc/html/rfc7517', panel: EDU.INTROSPECTION, tab: 'vsjwks' },
  { rfc: 'RFC 7662', name: 'Token Introspection', app: 'MCP validates MCP token', href: 'https://datatracker.ietf.org/doc/html/rfc7662', panel: EDU.INTROSPECTION, tab: 'why' },
  { rfc: 'RFC 8693', name: 'Token Exchange', app: 'Backend-for-Frontend (BFF) User token→MCP token', href: 'https://datatracker.ietf.org/doc/html/rfc8693', panel: EDU.TOKEN_EXCHANGE, tab: 'after' },
  { rfc: 'RFC 8707', name: 'Resource Indicators', app: 'Bind aud to RS URL', href: 'https://datatracker.ietf.org/doc/html/rfc8707', panel: EDU.AGENT_GATEWAY, tab: 'rfc8707' },
  { rfc: 'RFC 9449', name: 'DPoP', app: 'Optional egress binding', href: 'https://datatracker.ietf.org/doc/html/rfc9449', panel: EDU.AGENT_GATEWAY, tab: 'overview' },
  { rfc: 'RFC 9728', name: 'OAuth for MCP', app: 'MCP AS discovery', href: 'https://datatracker.ietf.org/doc/html/rfc9728', panel: EDU.AGENT_GATEWAY, tab: 'rfc9728' },
  { rfc: 'RFC 7523', name: 'JWT Client Auth', app: 'client_assertion in exchange', href: 'https://datatracker.ietf.org/doc/html/rfc7523', panel: EDU.JWT_CLIENT_AUTH, tab: 'what' },
  { rfc: 'RFC 9126', name: 'Pushed Authorization Requests (PAR)', app: 'Server-to-server auth request before browser redirect', href: 'https://datatracker.ietf.org/doc/html/rfc9126', panel: EDU.PAR, tab: 'what' },
  { rfc: 'RFC 9396', name: 'Rich Authorization Requests (RAR)', app: 'Structured authorization_details for fine-grained consent', href: 'https://datatracker.ietf.org/doc/html/rfc9396', panel: EDU.RAR, tab: 'what' },
  { rfc: 'RFC 9700', name: 'OAuth 2.0 Security Best Current Practice', app: 'Security baseline — PKCE required, implicit flow banned, redirect URI exact match', href: 'https://datatracker.ietf.org/doc/html/rfc9700', panel: null, tab: null },
  { rfc: 'OIDC Core 1.0', name: 'OpenID Connect', app: 'openid scope, /userinfo', href: 'https://openid.net/specs/openid-connect-core-1_0.html', panel: EDU.LOGIN_FLOW, tab: 'what' },
  { rfc: 'OIDC CIBA', name: 'Backchannel Auth', app: 'bc-authorize, poll /token; OOB email or push', href: 'https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html', panel: null, tab: null, ciba: true },
  { rfc: 'Pattern', name: 'Computer Use Agent (CUA)', app: 'Screenshot -> analyze -> act loop vs structured MCP tool-use', href: 'https://en.wikipedia.org/wiki/Intelligent_agent', panel: EDU.CUA, tab: 'what' },
  { rfc: 'Pattern', name: 'Human-in-the-loop (HITL)', app: 'High-value consent; agent lockout if declined', href: 'https://en.wikipedia.org/wiki/Human-in-the-loop', panel: EDU.HUMAN_IN_LOOP, tab: 'what' },
];

export default function RFCIndexPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const handleOpenPanel = (row) => {
    if (row.ciba) {
      window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } }));
      onClose();
      return;
    }
    if (row.panel) {
      open(row.panel, row.tab);
    }
  };

  const content = (
    <>
      <p style={{ marginTop: 0 }}>Click a row to open the related education panel. Spec links open in a new tab.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '0.4rem' }}>RFC / spec</th>
            <th style={{ padding: '0.4rem' }}>Name</th>
            <th style={{ padding: '0.4rem' }}>In this app</th>
            <th style={{ padding: '0.4rem' }}>Link</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.rfc} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              <td style={{ padding: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => handleOpenPanel(row)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--brand-navy)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                    font: 'inherit',
                  }}
                >
                  {row.rfc}
                </button>
              </td>
              <td style={{ padding: '0.4rem' }}>{row.name}</td>
              <td style={{ padding: '0.4rem' }}>{row.app}</td>
              <td style={{ padding: '0.4rem' }}>
                <a href={row.href} target="_blank" rel="noopener noreferrer">spec</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const implTab = (
    <>
      <h3 style={{ marginTop: 0 }}>What this panel does in code</h3>
      <EduImplIntro repoPath="banking_api_ui/src/components/education/RFCIndexPanel.js">
        Rows dispatch <code>open(panel, tab)</code> or the CIBA window event — they do not implement OAuth by themselves.
      </EduImplIntro>
      <pre className="edu-code">{SNIP_RFC_INDEX}</pre>
    </>
  );

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="RFC & spec index"
      tabs={[
        { id: 'index', label: 'Index', content },
        { id: 'inrepo', label: 'This panel', content: implTab },
      ]}
      initialTabId={initialTabId || 'index'}
    />
  );
}
