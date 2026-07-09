// banking_api_ui/src/components/education/RFCIndexPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

// status: IETF/OpenID maturity of the spec. Draft rows are specs the demo
// tracks that are NOT yet ratified (active Internet-Drafts / consolidation drafts).
const STD = 'Proposed Standard'; // IETF standards-track, published RFC
const BCP = 'Best Current Practice'; // IETF BCP-series RFC
const FINAL = 'Final'; // OpenID Foundation approved final spec
const LIVING = 'Living spec'; // versioned, continuously revised (MCP)
const DRAFT = 'IETF Draft'; // active Internet-Draft, not yet an RFC
const CONSOLIDATION = 'Draft'; // consolidation/working draft (OIDC 2.1)
const PATTERN = 'Pattern'; // industry design pattern, not a spec

const ROWS = [
  { rfc: 'RFC 6749', name: 'OAuth 2.0 Authorization Framework', app: 'Authorization Code flow', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc6749', panel: EDU.LOGIN_FLOW, tab: 'what' },
  { rfc: 'RFC 6750', name: 'OAuth 2.0 Bearer Token Usage', app: 'Authorization: Bearer on every API call', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc6750', panel: EDU.INTROSPECTION, tab: 'why' },
  { rfc: 'RFC 7636', name: 'PKCE', app: 'code_challenge / code_verifier on login', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7636', panel: EDU.LOGIN_FLOW, tab: 'pkce' },
  { rfc: 'RFC 7515', name: 'JSON Web Signature (JWS)', app: 'Signatures on every JWT (user, MCP, actor)', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7515', panel: EDU.INTROSPECTION, tab: 'vsjwks' },
  { rfc: 'RFC 7517', name: 'JSON Web Key (JWK)', app: 'JWKS for Banking API validation', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7517', panel: EDU.INTROSPECTION, tab: 'vsjwks' },
  { rfc: 'RFC 7519', name: 'JSON Web Token (JWT)', app: 'User token, MCP token, actor token', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7519', panel: EDU.LOGIN_FLOW, tab: 'tokens' },
  { rfc: 'RFC 7523', name: 'JWT Bearer / Client Auth', app: 'client_assertion (private_key_jwt) in exchange', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7523', panel: EDU.JWT_CLIENT_AUTH, tab: 'what' },
  { rfc: 'RFC 7591', name: 'Dynamic Client Registration (DCR)', app: 'Programmatic client onboarding (contrast: CIMD)', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7591', panel: null, tab: null },
  { rfc: 'RFC 7662', name: 'Token Introspection', app: 'MCP validates MCP token', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc7662', panel: EDU.INTROSPECTION, tab: 'why' },
  { rfc: 'RFC 8693', name: 'Token Exchange', app: 'BFF User token → MCP token', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc8693', panel: EDU.TOKEN_EXCHANGE, tab: 'after' },
  { rfc: 'RFC 8707', name: 'Resource Indicators', app: 'Bind aud to RS URL', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc8707', panel: EDU.AGENT_GATEWAY, tab: 'rfc8707' },
  { rfc: 'RFC 9126', name: 'Pushed Authorization Requests (PAR)', app: 'Server-to-server auth request before browser redirect', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc9126', panel: EDU.PAR, tab: 'what' },
  { rfc: 'RFC 9396', name: 'Rich Authorization Requests (RAR)', app: 'Structured authorization_details for fine-grained consent', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc9396', panel: EDU.RAR, tab: 'what' },
  { rfc: 'RFC 9449', name: 'DPoP', app: 'Optional egress binding (sender-constrained tokens)', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc9449', panel: EDU.AGENT_GATEWAY, tab: 'overview' },
  { rfc: 'RFC 9470', name: 'Step-Up Authentication Challenge', app: 'High-value step-up MFA (acr / max_age)', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc9470', panel: EDU.STEP_UP, tab: 'what' },
  { rfc: 'RFC 9700', name: 'OAuth 2.0 Security Best Current Practice', app: 'Security baseline — PKCE required, implicit flow banned, redirect URI exact match', status: BCP, href: 'https://datatracker.ietf.org/doc/html/rfc9700', panel: null, tab: null },
  { rfc: 'RFC 9728', name: 'Protected Resource Metadata (OAuth for MCP)', app: 'MCP AS discovery', status: STD, href: 'https://datatracker.ietf.org/doc/html/rfc9728', panel: EDU.AGENT_GATEWAY, tab: 'rfc9728' },
  { rfc: 'OIDC Core 1.0', name: 'OpenID Connect', app: 'openid scope, /userinfo', status: FINAL, href: 'https://openid.net/specs/openid-connect-core-1_0.html', panel: EDU.LOGIN_FLOW, tab: 'what' },
  { rfc: 'OIDC CIBA', name: 'Client-Initiated Backchannel Auth', app: 'bc-authorize, poll /token; OOB email or push', status: FINAL, href: 'https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html', panel: null, tab: null, ciba: true },
  { rfc: 'MCP 2025-11-25', name: 'Model Context Protocol', app: 'Structured agent tool-use protocol', status: LIVING, href: 'https://spec.modelcontextprotocol.io/specification/2025-11-25/', panel: EDU.MCP_PROTOCOL, tab: 'what' },
  { rfc: 'MCP Ext', name: 'Enterprise-Managed Authorization', app: 'IdP-centralized MCP access; ID-JAG exchange', status: LIVING, href: 'https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization', panel: EDU.ENTERPRISE_MANAGED_AUTH, tab: 'overview' },
  // ── Not yet ratified — active drafts the demo tracks ─────────────────────────
  { rfc: 'OIDC 2.1', name: 'OpenID Connect 2.1 (consolidation)', app: 'Security baseline: PKCE required, no implicit flow', status: CONSOLIDATION, href: 'https://openid.net/specs/', panel: EDU.OIDC_21, tab: 'what' },
  { rfc: 'ID-JAG', name: 'Identity Assertion Authorization Grant (Cross-App Access)', app: 'Cross-app access grant (contrast: RFC 8693)', status: DRAFT, href: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/', panel: EDU.ID_JAG, tab: 'overview' },
  { rfc: 'Identity Chaining', name: 'Identity Chaining Across Trust Domains', app: 'Delegation across trust boundaries', status: DRAFT, href: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/', panel: EDU.IETF_STANDARDS, tab: 'identity-chaining' },
  { rfc: 'RFC 7523bis', name: 'JWT Bearer Profiles (update to RFC 7523)', app: 'private_key_jwt improvements + CIBA support', status: DRAFT, href: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc7523bis/', panel: EDU.IETF_STANDARDS, tab: 'rfc7523bis' },
  { rfc: 'CIMD', name: 'Client ID Metadata Document', app: 'client_id as a metadata URL (no pre-registration)', status: DRAFT, href: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/', panel: null, tab: null, cimd: true },
  // ── Design patterns (not specs) ──────────────────────────────────────────────
  { rfc: 'Pattern', name: 'Computer Use Agent (CUA)', app: 'Screenshot -> analyze -> act loop vs structured MCP tool-use', status: PATTERN, href: 'https://en.wikipedia.org/wiki/Intelligent_agent', panel: EDU.CUA, tab: 'what' },
  { rfc: 'Pattern', name: 'Human-in-the-loop (HITL)', app: 'High-value consent; agent lockout if declined', status: PATTERN, href: 'https://en.wikipedia.org/wiki/Human-in-the-loop', panel: EDU.HUMAN_IN_LOOP, tab: 'what' },
];

// Colour the status pill by maturity: standards-track = green, BCP/final/living = indigo,
// draft (not yet ratified) = amber, design pattern = grey.
function statusStyle(status) {
  const base = {
    display: 'inline-block',
    padding: '0.08rem 0.4rem',
    borderRadius: '999px',
    fontSize: '0.68rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    border: '1px solid transparent',
  };
  if (status === DRAFT || status === CONSOLIDATION) {
    return { ...base, background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' };
  }
  if (status === STD) {
    return { ...base, background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' };
  }
  if (status === PATTERN) {
    return { ...base, background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' };
  }
  // BCP, Final, Living
  return { ...base, background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' };
}

export default function RFCIndexPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const handleOpenPanel = (row) => {
    if (row.ciba) {
      window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } }));
      onClose();
      return;
    }
    if (row.cimd) {
      window.dispatchEvent(new CustomEvent('education-open-cimd', { detail: { tab: 'what' } }));
      onClose();
      return;
    }
    if (row.panel) {
      open(row.panel, row.tab);
    }
  };

  const isLinked = (row) => Boolean(row.ciba || row.cimd || row.panel);

  const content = (
    <>
      <p style={{ marginTop: 0 }}>
        Every OAuth, OIDC and MCP standard this demo relies on, including specs not yet ratified
        (see the Status column). Click a linked row to open its education panel. Spec links open in
        a new tab.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '0.4rem' }}>RFC / spec</th>
            <th style={{ padding: '0.4rem' }}>Name</th>
            <th style={{ padding: '0.4rem' }}>Status</th>
            <th style={{ padding: '0.4rem' }}>In this app</th>
            <th style={{ padding: '0.4rem' }}>Link</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={`${row.rfc}-${row.name}`} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
              <td style={{ padding: '0.4rem' }}>
                {isLinked(row) ? (
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
                      textAlign: 'left',
                    }}
                  >
                    {row.rfc}
                  </button>
                ) : (
                  <span>{row.rfc}</span>
                )}
              </td>
              <td style={{ padding: '0.4rem' }}>{row.name}</td>
              <td style={{ padding: '0.4rem' }}>
                <span style={statusStyle(row.status)}>{row.status}</span>
              </td>
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

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="RFC & spec index"
      tabs={[{ id: 'index', label: 'Index', content }]}
      initialTabId={initialTabId || 'index'}
    />
  );
}
