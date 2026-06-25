// banking_api_ui/src/components/education/JwtClientAuthPanel.js
// Education drawer — JWT-based client authentication (RFC 7521 / private_key_jwt)
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import RfcLink from '../shared/RfcLink';
import { EduImplIntro, SNIP_JWT_CLIENT_AUTH_MOCK } from './educationImplementationSnippets';

const Code = ({ children }) => (
  <code style={{
    display: 'block', background: 'var(--code-bg, #f1f5f9)', borderRadius: 6,
    padding: '0.75rem 1rem', fontFamily: 'inherit', fontSize: '0.78rem',
    whiteSpace: 'pre', overflowX: 'auto', margin: '0.5rem 0',
  }}>{children}</code>
);

export default function JwtClientAuthPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What is it',
      content: (
        <>
          <p>
            <strong>JWT-based client authentication</strong> — <RfcLink rfc="RFC_7521" section="§4.2" /> — lets
            an OAuth client prove its identity to the authorization server using a <em>signed JWT</em> instead of
            a shared secret (<code>client_secret</code>). This is also called
            <strong>private_key_jwt</strong> (for asymmetric keys) or
            <strong>client_secret_jwt</strong> (for HMAC).
          </p>
          <p>
            Instead of sending <code>client_id + client_secret</code>, the client generates a JWT
            assertion, signs it with its private key, and sends it as
            <code>client_assertion_type + client_assertion</code> to the token endpoint:
          </p>
          <Code>{`POST /as/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=SplxlOBeZQQYbYS6WxSbIA
&redirect_uri=https://app.example.com/callback
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=eyJhbGciOiJSUzI1NiIsImtpZCI6Im15LWtleSJ9.eyJpc3MiOiJjbGllbn…`}</Code>
        </>
      ),
    },
    {
      id: 'assertion',
      label: 'JWT assertion structure',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>Required claims in the client assertion JWT (<RfcLink rfc="RFC_7521" section="§4.2" />)</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem' }}>Claim</th>
                <th style={{ padding: '0.4rem' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['iss', 'client_id — the issuer is the client itself'],
                ['sub', 'client_id — same as iss for client authentication'],
                ['aud', 'Token endpoint URL of the AS (e.g. https://auth.pingone.com/{envId}/as/token)'],
                ['jti', 'Unique ID — prevents replay (AS must track and reject reuse)'],
                ['exp', 'Expiry — short-lived, typically now + 60–120 seconds'],
                ['iat', 'Issued at time'],
              ].map(([claim, value]) => (
                <tr key={claim} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <td style={{ padding: '0.4rem' }}><code>{claim}</code></td>
                  <td style={{ padding: '0.4rem' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '0.75rem' }}>Example decoded header + payload:</p>
          <Code>{`// Header
{ "alg": "RS256", "kid": "my-signing-key-2026" }

// Payload
{
  "iss": "my-bff-client-id",
  "sub": "my-bff-client-id",
  "aud": "https://auth.pingone.com/env-123/as/token",
  "jti": "a87fec1a-3b9d-4c2e-a12f-7bcd9ef01234",
  "iat": 1711617600,
  "exp": 1711617720
}`}</Code>
        </>
      ),
    },
    {
      id: 'vs-secret',
      label: 'vs client_secret',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>private_key_jwt vs client_secret_basic</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem' }}>Property</th>
                <th style={{ padding: '0.4rem' }}>client_secret_basic</th>
                <th style={{ padding: '0.4rem' }}>private_key_jwt</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Secret type', 'Shared secret (both sides store it)', 'Asymmetric keypair (AS only stores public key)'],
                ['Compromise impact', 'Secret leaked → attacker can impersonate client forever', 'Private key stays on client; rotating is easy'],
                ['Rotation', 'Must coordinate with AS; downtime risk', 'Rotate via JWKS URI; zero downtime'],
                ['Non-repudiation', 'None — AS and client both know the secret', 'Clear: only the client holds the private key'],
                ['Replay protection', 'None built-in', 'jti + exp prevent replay'],
                ['Required by FAPI 2.0?', 'No (not allowed for confidential clients)', 'Yes — mandatory for FAPI 2.0 profiles'],
              ].map(([prop, a, b]) => (
                <tr key={prop} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <td style={{ padding: '0.4rem', fontWeight: 600 }}>{prop}</td>
                  <td style={{ padding: '0.4rem' }}>{a}</td>
                  <td style={{ padding: '0.4rem' }}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: 'token-exchange',
      label: 'In token exchange',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>RFC 7523 in RFC 8693 Token Exchange</h4>
          <p>
            In this demo, the <strong>Backend-for-Frontend (BFF)</strong> performs an
            RFC 8693 token exchange to mint an MCP token. The BFF authenticates itself to the
            PingOne token endpoint using <code>private_key_jwt</code> — proving it is the
            authorised actor (<code>act</code>) delivering the delegation chain:
          </p>
          <Code>{`POST /as/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<user-access-token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=banking_mcp_server
&scope=read
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=<signed-jwt>`}</Code>
          <p>
            The resulting MCP token carries both <code>sub</code> (the end-user) and
            <code>act.client_id</code> (the BFF), proving the delegation chain without
            transmitting any long-lived shared secret.
          </p>
        </>
      ),
    },
    {
      id: 'pingone',
      label: 'PingOne setup',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>Enabling private_key_jwt in PingOne</h4>
          <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.8, fontSize: '0.88rem' }}>
            <li>
              In the PingOne admin console, open your <strong>Application → Configuration</strong>.
            </li>
            <li>
              Under <em>Token Endpoint Authentication Method</em>, select
              <strong>private_key_jwt</strong> or <strong>client_secret_jwt</strong>.
            </li>
            <li>
              For <code>private_key_jwt</code>: provide your client's JWKS URI or upload the
              public key. PingOne will fetch the JWKS to verify incoming assertion signatures.
            </li>
            <li>
              Set the <strong>Token Endpoint Authentication Signing Algorithm</strong>
              (RS256, RS384, ES256, PS256 …). Must match your signing key type.
            </li>
            <li>
              In your BFF: generate a signed JWT with the required claims (see "JWT assertion
              structure" tab) and include it as <code>client_assertion</code> on every token
              endpoint call.
            </li>
          </ol>
          <p>
            PingOne's metadata document advertises supported methods under
            <code>token_endpoint_auth_methods_supported</code> in
            <code>/.well-known/openid-configuration</code>.
          </p>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>JWT client auth in Super Banking</h3>
          <EduImplIntro mock>
            Token and exchange calls in this demo use <code>client_id</code> + <code>client_secret</code> (or public client + PKCE for users). Below is what a <code>private_key_jwt</code> upgrade would look like at <code>/as/token</code>.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_JWT_CLIENT_AUTH_MOCK}</pre>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="JWT client authentication — private_key_jwt (RFC 7523)"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(660px, 100vw)"
    />
  );
}
