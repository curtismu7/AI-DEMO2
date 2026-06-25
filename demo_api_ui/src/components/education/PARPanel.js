// banking_api_ui/src/components/education/PARPanel.js
// Education drawer — Pushed Authorization Requests (RFC 9126)
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { EduImplIntro, SNIP_PAR_MOCK } from './educationImplementationSnippets';

const Code = ({ children }) => (
  <code style={{
    display: 'block', background: 'var(--code-bg, #f1f5f9)', borderRadius: 6,
    padding: '0.75rem 1rem', fontFamily: 'inherit', fontSize: '0.78rem',
    whiteSpace: 'pre', overflowX: 'auto', margin: '0.5rem 0',
  }}>{children}</code>
);

export default function PARPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What is PAR',
      content: (
        <>
          <p>
            <strong>Pushed Authorization Requests (PAR)</strong> — RFC 9126 — flip the normal OAuth
            authorization-code flow so the request parameters are sent <em>directly from the server
            to the authorization server</em> before the browser redirect happens.
          </p>
          <p>
            In a classic flow the browser carries all parameters in the URL:
          </p>
          <Code>{`GET /as/authorize
  ?client_id=myapp
  &response_type=code
  &scope=openid read
  &code_challenge=…
  &state=…`}</Code>
          <p>
            With PAR, the client first POSTs these to a dedicated server-side endpoint:
          </p>
          <Code>{`POST /as/par
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <client credentials>

client_id=myapp&response_type=code&scope=openid read
  &code_challenge=…&state=…`}</Code>
          <p>
            The AS returns a <strong>request_uri</strong> — a short-lived opaque reference:
          </p>
          <Code>{`HTTP/1.1 201 Created
{
  "request_uri": "urn:ietf:params:oauth:request_uri:6esc_11ACC5bwc014ltc14eY",
  "expires_in": 90
}`}</Code>
          <p>
            The browser only ever sees the tiny reference — not the full parameter set:
          </p>
          <Code>{`GET /as/authorize
  ?client_id=myapp
  &request_uri=urn:ietf:params:oauth:request_uri:6esc_11ACC5bwc014ltc14eY`}</Code>
        </>
      ),
    },
    {
      id: 'why',
      label: 'Security benefits',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>Why PAR matters</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem' }}>Risk mitigated</th>
                <th style={{ padding: '0.4rem' }}>How PAR helps</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Parameter tampering', 'Request is registered server-to-server before the browser sees it — the browser can\'t modify parameters.'],
                ['Long URLs leaking in logs', 'Browser URL bar and server logs only show the opaque request_uri, not scopes, PKCE, state, etc.'],
                ['Mix-up / phishing attacks', 'Client authenticates to the PAR endpoint; AS verifies the client_id before the redirect ever happens.'],
                ['Open redirect abuse', 'AS can validate redirect_uri at push time, not just at callback — stricter window.'],
                ['Replay attacks', 'request_uri is one-time-use and short-lived (typically 60–90 seconds).'],
              ].map(([risk, help]) => (
                <tr key={risk} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <td style={{ padding: '0.4rem', fontWeight: 600 }}>{risk}</td>
                  <td style={{ padding: '0.4rem' }}>{help}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '0.75rem' }}>
            PAR is <strong>recommended for high-security deployments</strong> (banking, healthcare, government)
            and is required when using <strong>Pushed Authorization Requests + JARM</strong> or
            combining with <strong>DPoP</strong> (RFC 9449) for sender-constrained tokens.
          </p>
        </>
      ),
    },
    {
      id: 'flow',
      label: 'Full flow',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>PAR + PKCE end-to-end sequence</h4>
          <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.7, fontSize: '0.88rem' }}>
            <li>Client generates <code>code_verifier</code> + <code>code_challenge</code> (PKCE).</li>
            <li>Client POSTs all parameters to <code>POST /as/par</code>, authenticating with its
                credentials (<code>client_secret_basic</code> or <code>private_key_jwt</code>).
            </li>
            <li>AS validates the client, stores the request, returns <code>request_uri</code>.</li>
            <li>Browser is redirected to <code>GET /as/authorize?client_id=…&amp;request_uri=…</code> only.</li>
            <li>User authenticates at PingOne.</li>
            <li>AS redirects back with <code>code</code>.</li>
            <li>Backend exchanges <code>code + code_verifier</code> for tokens at <code>POST /as/token</code>.</li>
          </ol>
          <p>
            Steps 1–3 are invisible to the browser; the URL bar only ever shows the 60-character
            <code>request_uri</code> reference.
          </p>
        </>
      ),
    },
    {
      id: 'pingone',
      label: 'PingOne setup',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>Enabling PAR in PingOne</h4>
          <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.8, fontSize: '0.88rem' }}>
            <li>
              In the PingOne admin console, open your <strong>Application → OAuth settings</strong>.
            </li>
            <li>
              Enable <strong>"Pushed Authorization Requests (PAR)"</strong> under Advanced settings.
              PingOne exposes the PAR endpoint at:
              <Code>{`POST https://auth.pingone.com/{envId}/as/par`}</Code>
            </li>
            <li>
              Optionally set <strong>Require PAR</strong> to reject direct authorize requests
              (no <code>request_uri</code> → 400).
            </li>
            <li>
              Update your BFF to call <code>/as/par</code> before building the redirect URL.
              Use the returned <code>request_uri</code> as the sole query parameter alongside
              <code>client_id</code>.
            </li>
          </ol>
          <p>
            The PAR endpoint URL is advertised in the AS metadata discovery document at
            <code>/.well-known/openid-configuration</code> under the key
            <code>pushed_authorization_request_endpoint</code>.
          </p>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>PAR in Super Banking</h3>
          <EduImplIntro mock>
            Sign-in here uses Authorization Code + PKCE without pushing parameters via PAR first. The snippet shows the pattern you would add on the BFF before redirecting the browser.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_PAR_MOCK}</pre>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Pushed Authorization Requests — PAR (RFC 9126)"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(640px, 100vw)"
    />
  );
}
