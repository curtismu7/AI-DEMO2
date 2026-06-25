/**
 * CimdSimPanel.js — Floating CIMD guide + interactive simulation panel
 *
 * A persistent floating button positioned directly below the CIBA Guide button
 * (top: 68px, right: floating edge). Opens a slide-in drawer with:
 *
 * Tabs:
 *   1. What is CIMD   — overview and key concepts
 *   2. CIMD vs DCR    — comparison with RFC 7591
 *   3. Doc format     — JSON document structure
 *   4. How AS uses it — step-by-step AS behaviour
 *   5. Flow diagram   — ASCII sequence diagram
 *   6. ▶ Simulate     — interactive animated walkthrough (NEW)
 *   7. PingOne        — PingOne status and setup guide
 *
 * Listens for window CustomEvent 'education-open-cimd' with optional
 * detail.tab to open to a specific tab (dispatched from BankingAgent).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './CimdSimPanel.css';

// ── Demo CIMD document (always available, uses current origin) ────────────────

function buildDemoDoc() {
  const host =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://banking-demo.example.com';
  return {
    client_id: `${host}/.well-known/oauth-client/acmecorp-banking-demo`,
    client_name: 'Acme Corp Banking App',
    application_type: 'web',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: ['https://acmecorp.example.com/callback'],
    post_logout_redirect_uris: ['https://acmecorp.example.com/logout'],
    token_endpoint_auth_method: 'client_secret_basic',
    scope: 'openid profile email',
    contacts: ['dev@acmecorp.example.com'],
  };
}

const DEMO_REDIRECT_URI = 'https://acmecorp.example.com/callback';
const DEMO_SCOPE        = 'openid profile email';
const DEMO_CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// ── Small shared sub-components ───────────────────────────────────────────────

function TabButton({ id, label, active, onClick }) {
  return (
    <button
      className={`cimd-tab${active ? ' cimd-tab--active' : ''}`}
      onClick={() => onClick(id)}
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  );
}

function CodeBlock({ children }) {
  return (
    <pre className="cimd-code">
      <code>{children}</code>
    </pre>
  );
}

// ── Tab content: What is CIMD ─────────────────────────────────────────────────

function WhatTab() {
  return (
    <>
      <p>
        <strong>OAuth Client ID Metadata Document (CIMD)</strong> is an IETF draft
        (
        <a
          href="https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/"
          target="_blank"
          rel="noopener noreferrer"
        >
          draft-ietf-oauth-client-id-metadata-document
        </a>
        ) that redefines what a <code>client_id</code> is. Instead of an opaque string
        like <code>abc123</code>, the <code>client_id</code> becomes a <strong>URL</strong>.
        When the authorization server receives that URL, it fetches the document at that URL
        to discover the client's metadata (redirect URIs, grant types, scopes, etc.).
      </p>

      <div className="cimd-callout">
        <strong>Core idea:</strong> The <code>client_id</code> IS the metadata document URL.
        The client controls the URL, so the client controls its own registration data.
      </div>

      <ul>
        <li>
          <code>client_id</code> is a URL, e.g.{' '}
          <code>https://app.example.com/.well-known/oauth-client/my-app</code>
        </li>
        <li>The AS fetches that URL and reads the metadata (<code>redirect_uris</code>, <code>grant_types</code>, etc.)</li>
        <li>The client self-describes by controlling the hosted document</li>
        <li>Eliminates out-of-band registration in AS implementations that support the draft</li>
        <li>Updates are instant: just update the hosted JSON file</li>
      </ul>

      <h3>What this demo does</h3>
      <p>
        This demo bridges the gap between the draft and PingOne. You fill in a
        CIMD-style form, the backend creates the OAuth application in PingOne via the
        Management API, then hosts the CIMD document at:
      </p>
      <CodeBlock>{'GET /.well-known/oauth-client/{pingone-app-id}'}</CodeBlock>
      <p>
        Use the <strong>▶ Simulate</strong> tab to watch the full AS-fetches-CIMD flow
        animated step by step.
      </p>

      <h3>Key references</h3>
      <ul>
        <li>
          <a
            href="https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/"
            target="_blank"
            rel="noopener noreferrer"
          >
            draft-ietf-oauth-client-id-metadata-document (IETF)
          </a>
        </li>
        <li>
          <a
            href="https://www.rfc-editor.org/rfc/rfc7591"
            target="_blank"
            rel="noopener noreferrer"
          >
            RFC 7591 — OAuth 2.0 Dynamic Client Registration
          </a>{' '}
          (compare &amp; contrast)
        </li>
      </ul>
    </>
  );
}

// ── Tab content: CIMD vs DCR ──────────────────────────────────────────────────

function VsDcrTab() {
  return (
    <>
      <p>
        Both CIMD and DCR (RFC 7591) aim to automate client registration, but they
        approach it from opposite angles:
      </p>
      <table className="cimd-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>DCR — RFC 7591</th>
            <th>CIMD — IETF draft</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>client_id type</strong></td>
            <td>Opaque string issued by the AS</td>
            <td>URL controlled by the client</td>
          </tr>
          <tr>
            <td><strong>Registration mechanism</strong></td>
            <td>Client POSTs to <code>/register</code></td>
            <td>AS fetches the <code>client_id</code> URL</td>
          </tr>
          <tr>
            <td><strong>Who controls metadata</strong></td>
            <td>AS stores and manages it</td>
            <td>Client hosts it (AS caches)</td>
          </tr>
          <tr>
            <td><strong>Updates</strong></td>
            <td>Client PUTs to registration endpoint</td>
            <td>Client updates the hosted document</td>
          </tr>
          <tr>
            <td><strong>Discovery</strong></td>
            <td>Registration URL in AS metadata</td>
            <td>Any HTTPS URL the client controls</td>
          </tr>
          <tr>
            <td><strong>AS support needed</strong></td>
            <td>Yes — must have a /register endpoint</td>
            <td>Yes — must support URL client_id lookups</td>
          </tr>
          <tr>
            <td><strong>Spec maturity</strong></td>
            <td>RFC (stable, widely deployed)</td>
            <td>IETF draft (evolving)</td>
          </tr>
          <tr>
            <td><strong>Client secret</strong></td>
            <td>Issued by AS, stored by client</td>
            <td>Same — never in the hosted document</td>
          </tr>
        </tbody>
      </table>

      <div className="cimd-callout cimd-callout--info">
        <strong>This demo uses DCR under the hood.</strong> The backend calls the PingOne
        Management API (DCR-style) to create the application, then presents a CIMD-style
        interface by hosting the metadata document. You get the CIMD experience without
        needing native AS support.
      </div>
    </>
  );
}

// ── Tab content: Document format ──────────────────────────────────────────────

function DocumentTab() {
  return (
    <>
      <p>
        A CIMD document is a JSON file served at the <code>client_id</code> URL. The
        schema follows the OAuth metadata fields from RFC 7591 with the addition that
        <code>client_id</code> is the document's own URL:
      </p>
      <CodeBlock>{`{
  "client_id": "https://app.example.com/.well-known/oauth-client/my-app",
  "client_name": "My Banking App",
  "application_type": "web",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "redirect_uris": ["https://app.example.com/callback"],
  "post_logout_redirect_uris": ["https://app.example.com/logout"],
  "token_endpoint_auth_method": "client_secret_basic",
  "scope": "openid profile email",
  "contacts": ["dev@example.com"],
  "logo_uri": "https://app.example.com/logo.png",
  "client_uri": "https://app.example.com",
  "policy_uri": "https://app.example.com/privacy",
  "tos_uri": "https://app.example.com/terms"
}`}</CodeBlock>

      <h3>Key fields</h3>
      <table className="cimd-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Description</th>
            <th>Required?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>client_id</code></td>
            <td>The canonical URL of this document — the client's identity</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td><code>redirect_uris</code></td>
            <td>Must be HTTPS (except localhost for development)</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td><code>grant_types</code></td>
            <td><code>authorization_code</code>, <code>client_credentials</code>, <code>refresh_token</code></td>
            <td>Yes</td>
          </tr>
          <tr>
            <td><code>token_endpoint_auth_method</code></td>
            <td><code>client_secret_basic</code>, <code>client_secret_post</code>, <code>private_key_jwt</code>, <code>none</code></td>
            <td>No (default: <code>client_secret_basic</code>)</td>
          </tr>
          <tr>
            <td><code>application_type</code></td>
            <td><code>web</code>, <code>native</code>, or <code>service</code></td>
            <td>No (default: <code>web</code>)</td>
          </tr>
        </tbody>
      </table>

      <div className="cimd-callout cimd-callout--warn">
        <strong>Security note:</strong> <code>client_secret</code> is <em>never</em> stored
        in or returned as part of the CIMD document. It is issued once at registration and
        stored only by the client.
      </div>

      <h3>HTTP headers for the endpoint</h3>
      <p>
        The endpoint serving the document should set these headers so the AS can cache it:
      </p>
      <CodeBlock>{`Content-Type: application/json
Cache-Control: public, max-age=3600
Access-Control-Allow-Origin: *`}</CodeBlock>
    </>
  );
}

// ── Tab content: How AS uses it ───────────────────────────────────────────────

function HowItWorksTab() {
  return (
    <>
      <p>
        When a CIMD-capable Authorization Server receives an authorization request
        where <code>client_id</code> is a URL:
      </p>
      <ol>
        <li>
          <strong>Detect URL client_id</strong> — AS checks whether the incoming <code>client_id</code>{' '}
          parameter starts with <code>https://</code>. If yes, treat as a CIMD lookup.
        </li>
        <li>
          <strong>Fetch the document</strong> — AS issues{' '}
          <code>GET {'{client_id_url}'}</code> with <code>Accept: application/json</code>.
        </li>
        <li>
          <strong>Validate metadata</strong> — AS verifies:
          <ul>
            <li>The requested <code>redirect_uri</code> is in <code>redirect_uris</code></li>
            <li>The requested <code>grant_type</code> is in <code>grant_types</code></li>
            <li>The requested <code>scope</code> is a subset of the document's <code>scope</code></li>
            <li>The <code>response_type</code> is in <code>response_types</code></li>
          </ul>
        </li>
        <li>
          <strong>Continue the flow</strong> — AS treats the client exactly as if it
          were a traditionally pre-registered client. PKCE, token exchange, and revocation
          all work the same way.
        </li>
        <li>
          <strong>Cache the document</strong> — AS may cache it using HTTP cache headers
          to avoid re-fetching on every request. This demo sets{' '}
          <code>Cache-Control: public, max-age=3600</code>.
        </li>
      </ol>

      <div className="cimd-callout cimd-callout--warn">
        <strong>Security model:</strong> The client proves ownership of the metadata by
        controlling the HTTPS URL. The AS must only accept <code>https://</code> URLs
        to prevent MITM attacks on the metadata document. Private-key authentication
        (<code>private_key_jwt</code>) provides the strongest cryptographic binding
        between client and metadata.
      </div>

      <div className="cimd-callout">
        <strong>PingOne status:</strong> PingOne does not yet natively fetch CIMD
        documents during authorization. This demo pre-registers via the Management API
        and hosts the document so you can observe the complete pattern. Use the{' '}
        <strong>▶ Simulate</strong> tab to walk through the AS-fetches-CIMD flow.
      </div>
    </>
  );
}

// ── Tab content: Flow diagram ─────────────────────────────────────────────────

function FlowTab() {
  return (
    <>
      <p>
        End-to-end CIMD registration and authorization flow in this demo:
      </p>
      <CodeBlock>{`┌─────────────────────────────────────────────────────────────────────┐
│              CIMD Registration + Authorization Flow                 │
└─────────────────────────────────────────────────────────────────────┘

  REGISTRATION (admin only — one time)
  ─────────────────────────────────────
  Admin Browser           Backend-for-Frontend (BFF) (this server)          PingOne Mgmt API
       │                        │                           │
       │  POST /api/clients/    │                           │
       │  register              │                           │
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
       │  { pingone_client_id,  │                           │
       │    client_secret,      │                           │
       │    cimd_url,           │                           │
       │    cimd_document }     │                           │
       │                        │                           │

  DOCUMENT SERVING  (GET /.well-known/oauth-client/:id)
  ─────────────────────────────────────────────────────
  Any caller               Backend-for-Frontend (BFF)
       │                    │
       │  GET /.well-known/ │
       │  oauth-client/{id} │
       │ ──────────────────►│
       │◄──────────────────┤
       │  CIMD JSON doc     │
       │  Cache-Control:    │
       │  public,max-age=   │
       │  3600              │

  AUTHORIZATION (CIMD-native AS flow — see Simulate tab)
  ─────────────────────────────────────────────────────────
  Client App              CIMD-capable AS         Backend-for-Frontend (BFF) CIMD endpoint
       │                        │                       │
       │  GET /authorize?       │                       │
       │  client_id=https://…   │                       │
       │ ──────────────────────►│                       │
       │                        │  GET /.well-known/    │
       │                        │  oauth-client/{id}    │
       │                        │ ─────────────────────►│
       │                        │◄─────────────────────┤
       │                        │  CIMD document        │
       │                        │  (validates redirect  │
       │                        │   grant_types, scope) │
       │◄──────────────────────┤                       │
       │  authorization code    │                       │
       │  (standard PKCE flow)  │                       │

  ⚠  PingOne does NOT yet do the AS → CIMD-endpoint fetch natively.
     This demo pre-registers via Management API and hosts the doc
     so you can observe both halves of the pattern.`}</CodeBlock>
    </>
  );
}

// ── Tab content: PingOne Setup ────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    num: '1',
    title: 'Log in as admin',
    detail: 'Sign in using the Admin login button. You need the admin scope — seeded admin credentials are in the env config or sample data.',
  },
  {
    num: '2',
    title: 'Navigate to Client Registration',
    detail: 'From the Admin Dashboard → Client Registration, or use the direct link in the nav menu. This page is admin-only.',
  },
  {
    num: '3',
    title: 'Fill in the metadata form',
    detail: 'Enter a client name, redirect URI(s), grant types, scopes, and optionally contact emails. This is the CIMD-style metadata that will become your client\'s identity.',
  },
  {
    num: '4',
    title: 'Submit — PingOne app is created',
    detail: 'The backend calls the PingOne Management API (POST /environments/{id}/applications) with your metadata. You receive the PingOne client_id, client_secret (shown once), and the CIMD document URL.',
  },
  {
    num: '5',
    title: 'Your CIMD document is live',
    detail: 'Fetch GET /.well-known/oauth-client/{pingone-app-id} — you get back the full CIMD JSON. This URL is your client_id for any CIMD-capable AS.',
  },
  {
    num: '6',
    title: 'Simulate the AS flow',
    detail: 'Come back to this panel → ▶ Simulate tab. Enter your PingOne app ID in the "optional real document" field and run the simulation to see your actual document flowing through the AS validation.',
  },
];

function SetupTab() {
  return (
    <>
      <div className="cimd-callout cimd-callout--warn">
        <strong>PingOne CIMD support status:</strong> PingOne does not yet natively perform
        the AS→CIMD-endpoint fetch during authorization. The demo bridges this gap: it
        pre-registers via the Management API and hosts the document itself, giving you the
        full operational experience of CIMD without native AS support.
      </div>

      <h3>Try the demo flow</h3>
      <ul className="cimd-setup-steps">
        {SETUP_STEPS.map(s => (
          <li key={s.num} className="cimd-setup-step">
            <div className="cimd-setup-step-num">{s.num}</div>
            <div className="cimd-setup-step-body">
              <strong>{s.title}</strong>
              <span>{s.detail}</span>
            </div>
          </li>
        ))}
      </ul>

      <h3>For a production CIMD-capable AS</h3>
      <p>
        When your AS natively supports CIMD, the process is even simpler — you just
        host the JSON document at any HTTPS URL you control, and pass that URL as
        <code>client_id</code> in authorization requests. No registration step needed.
      </p>

      <h3>Related specifications</h3>
      <ul>
        <li>
          <a
            href="https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/"
            target="_blank"
            rel="noopener noreferrer"
          >
            draft-ietf-oauth-client-id-metadata-document (IETF Datatracker)
          </a>
        </li>
        <li>
          <a
            href="https://www.rfc-editor.org/rfc/rfc7591"
            target="_blank"
            rel="noopener noreferrer"
          >
            RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol
          </a>
        </li>
        <li>
          <a
            href="https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---web-app.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            PingOne API — Create Application (Management API)
          </a>
        </li>
      </ul>
    </>
  );
}

// ── Simulation Tab ────────────────────────────────────────────────────────────

const SIM_STEP_LABELS = [
  '① Auth Request',
  '② URL Detection',
  '③ AS Fetches Doc',
  '④ Doc Received',
  '⑤ Validation',
  '⑥ Complete',
];

function SimulateTab() {
  const [simState,    setSimState]    = useState('idle');   // 'idle' | 'running' | 'done'
  const [simStep,     setSimStep]     = useState(0);         // 0–5
  const [cimdDoc,     setCimdDoc]     = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle');    // 'idle' | 'loading' | 'done'
  const [realClientId, setRealClientId] = useState('');
  const [usedRealDoc,  setUsedRealDoc]  = useState(false);
  const prefetchedDoc = useRef(null);

  const demoDoc       = buildDemoDoc();
  const displayDoc    = cimdDoc || demoDoc;
  const clientIdUrl   = displayDoc.client_id;
  const redirectUri   = displayDoc.redirect_uris?.[0]    || DEMO_REDIRECT_URI;
  const docScope      = displayDoc.scope                  || DEMO_SCOPE;
  const grantTypes    = displayDoc.grant_types            || ['authorization_code'];
  const authMethod    = displayDoc.token_endpoint_auth_method || 'client_secret_basic';

  const cimdHost = (() => {
    try { return new URL(clientIdUrl).hostname; }
    catch { return 'banking-demo.example.com'; }
  })();

  const cimdPath = clientIdUrl.split('/').pop() || 'acmecorp-banking-demo';

  const TOTAL_STEPS = SIM_STEP_LABELS.length - 1; // 0–5

  const startSimulation = useCallback(async () => {
    prefetchedDoc.current = null;
    let usedReal = false;

    if (realClientId.trim()) {
      try {
        const resp = await axios.get(
          `/.well-known/oauth-client/${realClientId.trim()}`,
          { withCredentials: false }
        );
        prefetchedDoc.current = resp.data;
        usedReal = true;
      } catch (_) {
        // Fall back to demo doc silently
      }
    }

    setCimdDoc(null);
    setUsedRealDoc(usedReal);
    setSimStep(0);
    setSimState('running');
    setFetchStatus('idle');
  }, [realClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextStep = useCallback(async () => {
    const next = simStep + 1;

    // Step 2 → 3: show spinner then reveal doc
    if (simStep === 2) {
      setFetchStatus('loading');
      // Brief async pause to show spinner (doc is already fetched)
      await new Promise(r => setTimeout(r, 900));
      setFetchStatus('done');
      const doc = prefetchedDoc.current || demoDoc;
      setCimdDoc(doc);
      setSimStep(3);
      return;
    }

    if (next >= TOTAL_STEPS) {
      setSimStep(TOTAL_STEPS);
      setSimState('done');
    } else {
      setSimStep(next);
    }
  }, [simStep, demoDoc, TOTAL_STEPS]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    prefetchedDoc.current = null;
    setSimState('idle');
    setSimStep(0);
    setFetchStatus('idle');
    setCimdDoc(null);
    setUsedRealDoc(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isFetching  = fetchStatus === 'loading';

  /* ── Render ── */
  return (
    <div className="cimd-sim">

      {/* ── Idle state ─────────────────────────────────────────────────────── */}
      {simState === 'idle' && (
        <>
          <p>
            This simulation animates the complete CIMD authorization flow step by step,
            showing exactly how an Authorization Server discovers and uses a Client ID
            Metadata Document without any out-of-band registration.
          </p>

          <div className="cimd-sim-what">
            <strong>What the simulation shows:</strong>
            <ol>
              <li>Browser sends an authorization request with a <strong>URL</strong> as the <code>client_id</code></li>
              <li>AS detects the HTTPS URL and decides to fetch the metadata document</li>
              <li>AS issues <code>GET {'{client_id_url}'}</code> to retrieve the document</li>
              <li>AS receives and parses the JSON metadata</li>
              <li>AS validates <code>redirect_uri</code>, <code>scope</code>, and <code>grant_type</code> against the document</li>
              <li>Authorization code is issued — no pre-registration needed!</li>
            </ol>
          </div>

          <div style={{
            marginTop: '16px',
            padding: '14px 16px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}>
            <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              Optional: use a real client you registered
            </p>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#374151' }}>
              Created a client via <strong>Admin → Client Registration</strong>?
              Enter its PingOne app ID to use your actual CIMD document in the simulation.
              Leave blank to use the built-in demo document.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="cimd-input"
                placeholder="PingOne app ID  (e.g. a3b2c1d0-ef45-…)"
                value={realClientId}
                onChange={e => setRealClientId(e.target.value)}
              />
            </div>
          </div>

          <button
            className="cimd-btn cimd-btn--primary cimd-sim-start"
            onClick={startSimulation}
          >
            ▶ Run Simulation
          </button>
        </>
      )}

      {/* ── Running / done state ──────────────────────────────────────────── */}
      {(simState === 'running' || simState === 'done') && (
        <div className="cimd-sim-steps">

          {/* Progress dots */}
          <div className="cimd-sim-progress" role="progressbar" aria-label="Simulation progress">
            {SIM_STEP_LABELS.map((label, i) => (
              <div
                key={i}
                className={`cimd-sim-dot${i < simStep ? ' done' : i === simStep ? ' active' : ''}`}
                title={label}
              />
            ))}
            <span className="cimd-sim-progress-label">
              {SIM_STEP_LABELS[Math.min(simStep, SIM_STEP_LABELS.length - 1)]}
            </span>
          </div>

          {/* ── Step 0: Authorization Request ── */}
          {simStep === 0 && (
            <div className="cimd-sim-step">
              <div className="cimd-sim-step-title">① Authorization Request</div>
              <p>
                The client begins a standard OAuth 2.0 Authorization Code flow with PKCE.
                The one difference from a traditional flow is the <code>client_id</code>{' '}
                — instead of an opaque string like <code>app_client_abc123</code>, it is a{' '}
                <strong>full HTTPS URL</strong> pointing to a metadata document the client
                hosts itself:
              </p>
              <CodeBlock>{`GET /authorize
  ?response_type=code
  &client_id=${clientIdUrl}
  &redirect_uri=${encodeURIComponent(redirectUri)}
  &scope=${encodeURIComponent(docScope)}
  &code_challenge=${DEMO_CODE_CHALLENGE}   ← PKCE: SHA-256 hash of a random verifier
  &code_challenge_method=S256
  &state=xyz789-secure-random-state         ← CSRF protection`}</CodeBlock>
              <div className="cimd-sim-hint">
                💡 <strong>The key CIMD innovation:</strong> <code>client_id</code> is a
                URL beginning with <code>https://</code>. This single change is how the AS
                knows to fetch client metadata dynamically instead of looking it up in a
                pre-registration database.
              </div>
              <div className="cimd-sim-hint" style={{ marginTop: '8px' }}>
                🔐 <strong>PKCE</strong> (<code>code_challenge</code> /{' '}
                <code>code_verifier</code>) protects against authorization code interception.
                Even if an attacker captures the code in the redirect, they cannot exchange
                it without the original random verifier — which never leaves the client.
              </div>
              <button
                className="cimd-btn cimd-btn--primary"
                onClick={nextStep}
                style={{ marginTop: '16px', width: '100%' }}
              >
                Next →
              </button>
            </div>
          )}

          {/* ── Step 1: AS detects URL client_id ── */}
          {simStep === 1 && (
            <div className="cimd-sim-step">
              <div className="cimd-sim-step-title">② AS Detects URL client_id</div>
              <p>
                The Authorization Server's first job is to resolve the client. With CIMD,
                the resolution logic branches on whether the <code>client_id</code> looks
                like a URL. This keeps the AS <strong>fully backward-compatible</strong> —
                opaque client IDs still work exactly as before:
              </p>
              <CodeBlock>{`// Authorization Server — client_id resolution (pseudocode)

const client_id = req.query.client_id;
// → "${clientIdUrl}"

if (client_id.startsWith('https://')) {
  // ── CIMD path ─────────────────────────────────────────────
  // No prior registration needed: go fetch the client's own
  // metadata document at the client_id URL.
  const doc = await fetchJSON(client_id);   // next step →
  return validateAuthorizeRequest(req, doc);
} else {
  // ── Classical path (unchanged) ───────────────────────────
  // Opaque client_id → look up in the local registration DB
  const client = await db.clients.findById(client_id);
  return validateAuthorizeRequest(req, client);
}`}</CodeBlock>
              <div className="cimd-check cimd-check--info" style={{ marginTop: '10px' }}>
                <span className="cimd-check-icon">🔍</span>
                <span>
                  Detected:{' '}
                  <code>
                    {clientIdUrl.length > 60
                      ? clientIdUrl.substring(0, 57) + '…'
                      : clientIdUrl}
                  </code>{' '}
                  starts with <code>https://</code>
                </span>
              </div>
              <div className="cimd-check cimd-check--info" style={{ marginTop: '6px' }}>
                <span className="cimd-check-icon">→</span>
                <span>Taking CIMD path — will fetch the metadata document next</span>
              </div>
              <div className="cimd-sim-hint" style={{ marginTop: '10px' }}>
                ⚡ <strong>Why no registration?</strong> Unlike OAuth Dynamic Client
                Registration (DCR), CIMD requires no admin approval, no client_secret
                bootstrapping, and no write access to the AS database. The AS simply
                trusts that whoever controls the HTTPS URL controls the client — the
                same model that secures the web itself (DNS + TLS).
              </div>
              <button
                className="cimd-btn cimd-btn--primary"
                onClick={nextStep}
                style={{ marginTop: '16px', width: '100%' }}
              >
                Next →
              </button>
            </div>
          )}

          {/* ── Step 2: AS fetches the document ── */}
          {simStep === 2 && (
            <div className="cimd-sim-step">
              <div className="cimd-sim-step-title">③ AS Fetches Metadata Document</div>
              <p>
                The AS makes a plain HTTPS GET request to the <code>client_id</code> URL.
                This is the heart of CIMD — the client's identity document is self-hosted
                at a well-known path under the client's own domain:
              </p>
              <CodeBlock>{`GET /.well-known/oauth-client/${cimdPath} HTTP/1.1
Host: ${cimdHost}              ← the client's own domain
Accept: application/json`}</CodeBlock>
              <div className="cimd-sim-hint">
                🔒 <strong>Security via HTTPS:</strong> TLS ensures the AS is talking to
                the real <code>{cimdHost}</code> — the same chain of trust that protects
                every HTTPS website. Only the domain owner can serve a response at this
                URL, so the AS can trust the content without any shared secret.
              </div>
              <div className="cimd-sim-hint" style={{ marginTop: '8px' }}>
                ⚡ <strong>Caching matters:</strong> The AS should honour{' '}
                <code>Cache-Control</code> headers in the response. A well-configured
                document with <code>max-age=3600</code> means the AS only fetches it once
                per hour, keeping latency negligible for subsequent authorizations.
              </div>
              <div className="cimd-fetch-status">
                {fetchStatus === 'loading' && (
                  <div className="cimd-fetch-spinner">
                    <div className="cimd-spinner" />
                    <span>
                      Fetching metadata document from{' '}
                      <strong>{cimdHost}</strong>…
                    </span>
                  </div>
                )}
              </div>
              <button
                className="cimd-btn cimd-btn--primary"
                onClick={nextStep}
                disabled={isFetching}
                style={{ marginTop: '16px', width: '100%' }}
              >
                {isFetching ? 'Fetching…' : 'Fetch Document →'}
              </button>
            </div>
          )}

          {/* ── Step 3: Document received ── */}
          {simStep >= 3 && simStep <= 3 && cimdDoc && (
            <div className="cimd-sim-step">
              <div className="cimd-sim-step-title">④ Metadata Document Received</div>
              <p>
                The AS receives a JSON document containing everything it needs to know
                about this client. There is no database lookup — <strong>the document
                IS the client registration</strong>. Let's look at what each field means:
              </p>
              <CodeBlock>{`HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=3600  ← AS may cache for 1 hour

${JSON.stringify(cimdDoc, null, 2)}`}</CodeBlock>
              <div className="cimd-sim-hint">
                📋 <strong>Key fields explained:</strong>
              </div>
              <div className="cimd-checks" style={{ marginTop: '6px' }}>
                <div className="cimd-check cimd-check--info">
                  <span className="cimd-check-icon">🆔</span>
                  <div>
                    <strong>client_id</strong> — must exactly match the URL the AS
                    fetched. Any mismatch is a security violation (DNS rebinding protection).
                  </div>
                </div>
                <div className="cimd-check cimd-check--info">
                  <span className="cimd-check-icon">↩</span>
                  <div>
                    <strong>redirect_uris</strong> — the exhaustive list of allowed
                    callback URLs. The AS will reject any <code>redirect_uri</code> not
                    in this list, preventing token theft via open redirect.
                  </div>
                </div>
                <div className="cimd-check cimd-check--info">
                  <span className="cimd-check-icon">🔑</span>
                  <div>
                    <strong>token_endpoint_auth_method</strong> — how the client will
                    authenticate at the token endpoint (e.g.{' '}
                    <code>client_secret_basic</code>, <code>private_key_jwt</code>).
                  </div>
                </div>
                <div className="cimd-check cimd-check--info">
                  <span className="cimd-check-icon">📦</span>
                  <div>
                    <strong>scope</strong> — the maximum scopes this client may ever
                    request. The AS will downscope any request that exceeds this.
                  </div>
                </div>
              </div>
              {usedRealDoc && (
                <div className="cimd-sim-hint" style={{ marginTop: '10px' }}>
                  ✅ Using your real document fetched from this backend
                </div>
              )}
              {!usedRealDoc && (
                <div className="cimd-sim-hint" style={{ marginTop: '10px' }}>
                  ℹ Using the built-in demo document — register a real client via{' '}
                  <strong>Admin → Client Registration</strong> and enter its app ID to
                  use your own.
                </div>
              )}
              <button
                className="cimd-btn cimd-btn--primary"
                onClick={nextStep}
                style={{ marginTop: '16px', width: '100%' }}
              >
                Next →
              </button>
            </div>
          )}

          {/* ── Step 4: Validation ── */}
          {simStep === 4 && cimdDoc && (
            <div className="cimd-sim-step">
              <div className="cimd-sim-step-title">⑤ AS Validates the Authorization Request</div>
              <p>
                With the document in hand, the AS validates every parameter from Step ①
                against what the document permits. Each check prevents a specific class of
                attack — a failure at any point causes the AS to return an error response
                and <strong>never issue an authorization code</strong>:
              </p>
              <div className="cimd-checks">
                <div className="cimd-check cimd-check--pass">
                  <span className="cimd-check-icon">✅</span>
                  <div>
                    <strong>redirect_uri matches</strong>
                    <span className="cimd-check-detail">
                      Requested: <code>{redirectUri}</code>
                    </span>
                    <span className="cimd-check-detail">
                      In document:{' '}
                      <code>{cimdDoc.redirect_uris?.[0] || redirectUri}</code>
                    </span>
                    <span className="cimd-check-detail" style={{ color: '#374151', fontStyle: 'italic' }}>
                      Prevents token theft — attacker cannot redirect the code to their own server
                    </span>
                  </div>
                </div>
                <div className="cimd-check cimd-check--pass">
                  <span className="cimd-check-icon">✅</span>
                  <div>
                    <strong>grant_type supported</strong>
                    <span className="cimd-check-detail">
                      <code>authorization_code</code> ∈{' '}
                      {JSON.stringify(grantTypes)}
                    </span>
                    <span className="cimd-check-detail" style={{ color: '#374151', fontStyle: 'italic' }}>
                      Prevents downgrade to implicit flow or other weaker grant types
                    </span>
                  </div>
                </div>
                <div className="cimd-check cimd-check--pass">
                  <span className="cimd-check-icon">✅</span>
                  <div>
                    <strong>scope allowed</strong>
                    <span className="cimd-check-detail">
                      Requested: <code>{docScope}</code>
                    </span>
                    <span className="cimd-check-detail">
                      Document max scope: <code>{cimdDoc.scope || docScope}</code>
                    </span>
                    <span className="cimd-check-detail" style={{ color: '#374151', fontStyle: 'italic' }}>
                      Prevents scope escalation — client cannot request more than it declared
                    </span>
                  </div>
                </div>
                <div className="cimd-check cimd-check--pass">
                  <span className="cimd-check-icon">✅</span>
                  <div>
                    <strong>token auth method known</strong>
                    <span className="cimd-check-detail">
                      <code>{authMethod}</code>
                    </span>
                    <span className="cimd-check-detail" style={{ color: '#374151', fontStyle: 'italic' }}>
                      AS knows how to authenticate this client at the token endpoint
                    </span>
                  </div>
                </div>
                <div className="cimd-check cimd-check--pass">
                  <span className="cimd-check-icon">✅</span>
                  <div>
                    <strong>response_type supported</strong>
                    <span className="cimd-check-detail">
                      <code>code</code> ∈{' '}
                      {JSON.stringify(cimdDoc.response_types || ['code'])}
                    </span>
                    <span className="cimd-check-detail" style={{ color: '#374151', fontStyle: 'italic' }}>
                      Confirms the client declared it supports Authorization Code flow
                    </span>
                  </div>
                </div>
              </div>
              <button
                className="cimd-btn cimd-btn--primary"
                onClick={nextStep}
                style={{ marginTop: '16px', width: '100%' }}
              >
                Next →
              </button>
            </div>
          )}

          {/* ── Step 5: Complete ── */}
          {simStep >= 5 && cimdDoc && (
            <div className="cimd-sim-step">
              <div className="cimd-sim-step-title">⑥ Authorization Proceeds ✓</div>
              <p>
                All five checks passed. The AS issues a short-lived <strong>authorization
                code</strong> and redirects the browser back to the client. This part of
                the flow is <em>identical</em> to a traditionally pre-registered client —
                CIMD only changes how the client was <em>identified</em>, not what happens
                after:{' '}
              </p>
              <CodeBlock>{`HTTP/1.1 302 Found
Location: ${redirectUri}
  ?code=SplxlOBeZQQYbYS6WxSbIA
  &state=xyz789-secure-random-state

// Client exchanges code for tokens:
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(${cimdPath}:client_secret)

grant_type=authorization_code
&code=SplxlOBeZQQYbYS6WxSbIA
&redirect_uri=${encodeURIComponent(redirectUri)}
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`}</CodeBlock>

              <div className="cimd-sim-hint">
                🔐 <strong>PKCE verification at token exchange:</strong> the client is
                required to send the original <code>code_verifier</code> (the raw random
                string whose hash was sent as <code>code_challenge</code> in Step ①).
                The AS hashes it and compares — if they don't match, the token request
                fails. This binds the code to the original client tab, preventing code
                interception attacks.
              </div>
              <div className="cimd-sim-done">
                <div className="cimd-sim-done-icon">🎉</div>
                <div>
                  <strong>CIMD flow complete!</strong>
                  <br />
                  No out-of-band registration required, no secrets bootstrapped out-of-band,
                  no admin approval needed. The AS discovered and validated the client
                  entirely from a JSON document the client hosted at its own HTTPS URL —
                  the same trust model the web has used for 30 years.
                </div>
              </div>
              <div className="cimd-checks" style={{ marginTop: '12px' }}>
                <div className="cimd-check cimd-check--info">
                  <span className="cimd-check-icon">🏦</span>
                  <div>
                    <strong>Why this matters for open banking</strong> — any regulated
                    third-party application can onboard to an AS simply by publishing a
                    compliant metadata document at a stable HTTPS URL. No manual enrollment
                    API calls, no waiting for approval, no shared secrets via email.
                  </div>
                </div>
                <div className="cimd-check cimd-check--info">
                  <span className="cimd-check-icon">🔄</span>
                  <div>
                    <strong>Instant rotation</strong> — to update scopes, redirect URIs,
                    or auth method, the client simply updates the JSON document. The next
                    authorization request picks up the new document automatically (subject
                    to <code>Cache-Control</code> TTL).
                  </div>
                </div>
              </div>

              <button
                className="cimd-btn cimd-btn--secondary"
                onClick={reset}
                style={{ marginTop: '16px', width: '100%' }}
              >
                ↩ Reset simulation
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Main CimdSimPanel component ───────────────────────────────────────────────

export default function CimdSimPanel() {
  const [open,      setOpen]      = useState(false);
  const [activeTab, setActiveTab] = useState('what');
  const [width,     setWidth]     = useState(740);
  const drawerWidth  = useRef(740);
  const isResizing   = useRef(false);

  // Listen for the 'education-open-cimd' event dispatched by BankingAgent / EducationBar
  useEffect(() => {
    function onEdu(e) {
      setOpen(true);
      if (e.detail?.tab) setActiveTab(e.detail.tab);
    }
    window.addEventListener('education-open-cimd', onEdu);
    return () => window.removeEventListener('education-open-cimd', onEdu);
  }, []);

  // ESC key closes the drawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Drag-to-resize left edge
  const onMouseDown = useCallback((e) => {
    isResizing.current = true;
    const startX = e.clientX;
    const startW = drawerWidth.current;

    function onMove(ev) {
      if (!isResizing.current) return;
      const newW = Math.min(
        Math.max(startW - (ev.clientX - startX), 360),
        window.innerWidth * 0.95
      );
      drawerWidth.current = newW;
      setWidth(newW);
    }
    function onUp() {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }, []);

  const TABS = [
    { id: 'what',         label: 'What is CIMD'  },
    { id: 'vs-dcr',       label: 'CIMD vs DCR'   },
    { id: 'document',     label: 'Doc format'    },
    { id: 'how-it-works', label: 'How AS uses it'},
    { id: 'flow',         label: 'Flow diagram'  },
    { id: 'simulate',     label: '▶ Simulate'   },
    { id: 'setup',        label: 'PingOne'       },
  ];

  return (
    <>
      {/* CIMD Simulator FAB removed — open via Learn menu, Banking Agent, or window event `education-open-cimd`. */}

      {/* ── Backdrop overlay ────────────────────────────────────────────────── */}
      {open && (
        <div className="cimd-overlay" onClick={() => setOpen(false)} />
      )}

      {/* ── Slide-in drawer ─────────────────────────────────────────────────── */}
      <div
        className={`cimd-drawer${open ? ' cimd-drawer--open' : ''}`}
        style={{ width: `min(${width}px, 96vw)` }}
        role="dialog"
        aria-modal="true"
        aria-label="CIMD Guide and Simulator"
        aria-hidden={!open}
      >
        <div className="cimd-resize-handle" onMouseDown={onMouseDown} />

        {/* Header */}
        <div className="cimd-header">
          <div>
            <h2 className="cimd-title">📄 Client ID Metadata Document</h2>
            <p className="cimd-subtitle">
              draft-ietf-oauth-client-id-metadata-document — the client_id is a URL
            </p>
          </div>
          <button
            className="cimd-close"
            onClick={() => setOpen(false)}
            aria-label="Close CIMD panel"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="cimd-tabs" role="tablist" aria-label="CIMD guide sections">
          {TABS.map(t => (
            <TabButton
              key={t.id}
              id={t.id}
              label={t.label}
              active={activeTab === t.id}
              onClick={setActiveTab}
            />
          ))}
        </div>

        {/* Body */}
        <div className="cimd-body" role="tabpanel">
          {activeTab === 'what'         && <WhatTab />}
          {activeTab === 'vs-dcr'       && <VsDcrTab />}
          {activeTab === 'document'     && <DocumentTab />}
          {activeTab === 'how-it-works' && <HowItWorksTab />}
          {activeTab === 'flow'         && <FlowTab />}
          {activeTab === 'simulate'     && <SimulateTab />}
          {activeTab === 'setup'        && <SetupTab />}
        </div>
      </div>
    </>
  );
}
