// banking_api_ui/src/components/education/CimdPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { EduImplIntro, SNIP_CIMD_WELL_KNOWN } from './educationImplementationSnippets';

export default function CimdPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What is CIMD',
      content: (
        <>
          <p>
            <strong>OAuth Client ID Metadata Document (CIMD)</strong> is an IETF draft
            (<a href="https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/" target="_blank" rel="noopener noreferrer">draft-ietf-oauth-client-id-metadata-document</a>)
            that redefines what a <code>client_id</code> is — instead of an opaque string, it becomes
            a <strong>URL</strong>. When the authorization server receives that URL as a
            <code>client_id</code>, it fetches the document at that URL to discover the client's
            registered metadata (redirect URIs, grant types, contact info, etc.).
          </p>
          <p>
            <strong>Why does this matter?</strong> Traditional OAuth requires out-of-band client
            registration before any flow can begin. With CIMD, a client can self-describe by hosting
            a JSON document — no pre-registration required if the AS supports the draft.
          </p>
          <ul>
            <li>The <code>client_id</code> is a URL — e.g. <code>https://app.example.com/.well-known/oauth-client/my-app</code></li>
            <li>The AS fetches that URL and reads the metadata (redirect_uris, grant_types, etc.)</li>
            <li>The client is effectively "self-registering" by controlling that URL</li>
            <li>Eliminates the need for a separate registration endpoint in many scenarios</li>
          </ul>
          <p>
            This demo implements a <strong>management interface</strong>: you fill in client metadata
            using a CIMD-style form, the backend creates the OAuth application in PingOne via the
            Management API, and then hosts the resulting CIMD document for you at:
          </p>
          <code style={{display:'block',padding:'8px',background:'var(--edu-code-bg,#0f172a)',color:'#e2e8f0',borderRadius:'4px',marginTop:'8px',fontFamily:'inherit'}}>
            {'/.well-known/oauth-client/{pingone-app-id}'}
          </code>
        </>
      ),
    },
    {
      id: 'vs-dcr',
      label: 'CIMD vs DCR',
      content: (
        <>
          <p>
            Two related but distinct standards both aim to automate client registration:
          </p>
          <table className="edu-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>DCR — RFC 7591</th>
                <th>CIMD — draft</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>client_id type</td>
                <td>Opaque string issued by AS</td>
                <td>URL controlled by the client</td>
              </tr>
              <tr>
                <td>Registration mechanism</td>
                <td>POST to /register endpoint</td>
                <td>AS fetches the client_id URL</td>
              </tr>
              <tr>
                <td>Who controls metadata</td>
                <td>AS stores and manages it</td>
                <td>Client hosts it (AS caches)</td>
              </tr>
              <tr>
                <td>Updates</td>
                <td>PUT/PATCH to registration endpoint</td>
                <td>Client updates the hosted document</td>
              </tr>
              <tr>
                <td>Discovery</td>
                <td>Registration endpoint in AS metadata</td>
                <td>Any URL the client controls</td>
              </tr>
              <tr>
                <td>Spec maturity</td>
                <td>RFC (stable)</td>
                <td>IETF draft (evolving)</td>
              </tr>
            </tbody>
          </table>
          <p>
            In practice, this demo <strong>uses DCR under the hood</strong> (PingOne Management API)
            while presenting a <strong>CIMD-style interface</strong> — you define the metadata,
            the system acts as if the AS is fetching a document you host.
          </p>
        </>
      ),
    },
    {
      id: 'document',
      label: 'Document format',
      content: (
        <>
          <p>
            A CIMD JSON document at <code>/.well-known/oauth-client/{'{id}'}</code> looks like this:
          </p>
          <pre style={{background:'var(--edu-code-bg,#0f172a)',color:'#e2e8f0',padding:'12px',borderRadius:'6px',overflow:'auto',fontSize:'13px',fontFamily:'inherit'}}>
{`{
  "client_id": "https://app.example.com/.well-known/oauth-client/abc123",
  "client_name": "My Banking App",
  "application_type": "web",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "redirect_uris": ["https://app.example.com/callback"],
  "post_logout_redirect_uris": ["https://app.example.com/logout"],
  "token_endpoint_auth_method": "client_secret_basic",
  "scope": "openid profile email",
  "contacts": ["dev@example.com"]
}`}
          </pre>
          <p>
            Key fields from the draft:
          </p>
          <ul>
            <li><strong>client_id</strong> — the canonical URL of this document (the identity of the client)</li>
            <li><strong>redirect_uris</strong> — must be HTTPS (except localhost for dev)</li>
            <li><strong>grant_types</strong> — authorization_code, client_credentials, refresh_token, etc.</li>
            <li><strong>token_endpoint_auth_method</strong> — how the client authenticates: <code>client_secret_basic</code>, <code>client_secret_post</code>, <code>private_key_jwt</code>, <code>none</code></li>
            <li><strong>application_type</strong> — <code>web</code> (default), <code>native</code>, <code>service</code></li>
          </ul>
          <p>
            The AS may add these during registration (not present in the hosted document):
          </p>
          <ul>
            <li><code>client_secret</code> — returned once at registration, never stored in the document</li>
            <li><code>client_id_issued_at</code> / <code>client_secret_expires_at</code></li>
          </ul>
        </>
      ),
    },
    {
      id: 'how-it-works',
      label: 'How AS uses it',
      content: (
        <>
          <p>
            When a CIMD-capable AS receives an authorization request with a URL as the
            <code>client_id</code>:
          </p>
          <ol>
            <li>
              <strong>Fetch the document</strong> — AS issues a GET request to the
              <code>client_id</code> URL (e.g. <code>https://app.example.com/.well-known/oauth-client/abc123</code>)
            </li>
            <li>
              <strong>Validate metadata</strong> — checks that the <code>redirect_uri</code>
              in the auth request matches one listed in the document
            </li>
            <li>
              <strong>Continue the flow</strong> — uses the document's grant types, scopes,
              and auth method as if the client had been pre-registered
            </li>
            <li>
              <strong>Cache</strong> — AS may cache the document using HTTP cache headers
              (our demo sets <code>Cache-Control: public, max-age=3600</code>)
            </li>
          </ol>
          <p>
            <strong>Security model:</strong> The client proves ownership of the metadata by controlling
            the URL. The AS must only accept HTTPS URLs to prevent MITM of the metadata document.
            Private-key authentication (<code>private_key_jwt</code>) provides the strongest
            cryptographic binding.
          </p>
          <p>
            <strong>PingOne note:</strong> PingOne does not yet natively support CIMD-style lookup.
            In this demo the backend pre-registers the client and hosts the document itself,
            giving you the operational experience of CIMD without AS-side support.
          </p>
        </>
      ),
    },
    {
      id: 'flow',
      label: 'Flow diagram',
      content: (
        <>
          <p>
            How client registration and a CIMD-style authorization request flows
            end-to-end in this demo:
          </p>
          <pre style={{background:'var(--edu-code-bg,#0f172a)',color:'#e2e8f0',padding:'16px',borderRadius:'6px',overflow:'auto',fontSize:'12px',lineHeight:'1.7',fontFamily:'inherit'}}>
{`┌─────────────────────────────────────────────────────────────────────┐
│              CIMD Registration + Authorization Flow                 │
└─────────────────────────────────────────────────────────────────────┘

  REGISTRATION (admin only — one time)
  ─────────────────────────────────────
  Admin Browser           Backend-for-Frontend (BFF) — this server          PingOne Mgmt API
       │                        │                           │
       │  POST /api/admin/      │                           │
       │  clients               │                           │
       │  { client_name,        │                           │
       │    redirect_uris,      │                           │
       │    grant_types, … }    │                           │
       │ ──────────────────────►│                           │
       │                        │  POST /environments/{id}/ │
       │                        │  applications             │
       │                        │ ─────────────────────────►│
       │                        │◄─────────────────────────┤
       │                        │  { id, client_secret }    │
       │                        │                           │
       │                        │  Build CIMD document      │
       │                        │  { client_id: URL,        │
       │                        │    redirect_uris, … }     │
       │                        │  Store in cimdStore Map   │
       │◄──────────────────────┤                           │
       │  { client_id,          │                           │
       │    client_secret,      │                           │
       │    cimd_url,           │                           │
       │    cimd_document }     │                           │
       │                        │                           │

  DOCUMENT SERVING (public, cacheable)
  ─────────────────────────────────────
  Any caller               Backend-for-Frontend (BFF)
       │                    │
       │  GET /.well-known/ │
       │  oauth-client/{id} │
       │ ──────────────────►│
       │◄──────────────────┤
       │  CIMD JSON doc     │
       │  Cache-Control:    │
       │  public, max-age=  │
       │  3600              │
       │                    │

  AUTHORIZATION (future / CIMD-native AS)
  ─────────────────────────────────────────
  Client App              CIMD-capable AS         Backend-for-Frontend (BFF) CIMD endpoint
       │                        │                       │
       │  GET /authorize?       │                       │
       │  client_id=https://…/  │                       │
       │  .well-known/oauth-    │                       │
       │  client/{id}           │                       │
       │ ──────────────────────►│                       │
       │                        │  GET /.well-known/    │
       │                        │  oauth-client/{id}    │
       │                        │ ─────────────────────►│
       │                        │◄─────────────────────┤
       │                        │  CIMD document        │
       │                        │  (validates redirect, │
       │                        │   grant_types, auth   │
       │                        │   method, scopes)     │
       │◄──────────────────────┤                       │
       │  Authorization code    │                       │
       │  (normal PKCE flow)    │                       │
       │                        │                       │

  ⚠  PingOne does NOT yet do the AS→CIMD-endpoint fetch natively.
     The demo pre-registers via Management API and hosts the doc
     so you can observe both halves of the pattern.`}
          </pre>
        </>
      ),
    },
    {
      id: 'try-it',
      label: 'Try it',
      content: (
        <>
          <p>
            Use the <strong>Client Registration</strong> page (admin only) to create an OAuth
            client in PingOne using the CIMD-style interface:
          </p>
          <ol>
            <li>Log in as an admin</li>
            <li>Navigate to <strong>Admin → Client Registration</strong></li>
            <li>Fill in the client metadata form</li>
            <li>Submit — the backend calls the PingOne Management API to create the app</li>
            <li>You receive the <code>client_id</code> (PingOne app ID), client secret, and the CIMD document URL</li>
            <li>
              Fetch the document directly:
              <code style={{display:'block',margin:'8px 0',padding:'6px 12px',background:'var(--edu-code-bg,#0f172a)',color:'#e2e8f0',borderRadius:'4px',fontFamily:'inherit'}}>
                {'GET /.well-known/oauth-client/{pingone-app-id}'}
              </code>
            </li>
          </ol>
          <p>
            The hosted CIMD document can then be used as the <code>client_id</code> in any OAuth
            Authorization Server that supports the draft.
          </p>
          <p>
            <strong>Relevant specs &amp; links:</strong>
          </p>
          <ul>
            <li>
              <a href="https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/" target="_blank" rel="noopener noreferrer">
                draft-ietf-oauth-client-id-metadata-document (IETF)
              </a>
            </li>
            <li>
              <a href="https://www.rfc-editor.org/rfc/rfc7591" target="_blank" rel="noopener noreferrer">
                RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol
              </a>
            </li>
            <li>
              <a href="https://openid.net/specs/openid-connect-registration-1_0.html" target="_blank" rel="noopener noreferrer">
                OpenID Connect Dynamic Client Registration 1.0
              </a>
            </li>
            <li>
              <a href="https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---web-app.html" target="_blank" rel="noopener noreferrer">
                PingOne API — Create Application
              </a>
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Serving the metadata URL</h3>
          <EduImplIntro repoPath="banking_api_server/routes/clientRegistration.js + server.js">
            Registration uses PingOne Management API; the hosted JSON is read from <code>cimdStore</code>.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_CIMD_WELL_KNOWN}</pre>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="OAuth Client ID Metadata Document (CIMD)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
