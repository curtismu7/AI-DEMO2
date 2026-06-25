// banking_api_ui/src/components/education/LoginFlowPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import {
  CibaVsLoginContent,
  LoginFlowPkceContent,
  LoginFlowSecurityContent,
} from './educationContent';
import { EduImplIntro, SNIP_USER_LOGIN_EXCHANGE } from './educationImplementationSnippets';

export default function LoginFlowPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What happens',
      content: (
        <>
          <h3>What happens when you click &quot;Sign In&quot;</h3>
          <p>
            Signing in uses a modern-day <strong>security handshake</strong> between this app and PingOne (our identity provider).
            Here&apos;s the full journey — in plain English:
          </p>
          <ol>
            <li>
              <strong>You click Sign In</strong> — the app generates a one-time secret code (a &quot;code verifier&quot;) and stores
              it on the server. This code is never sent anywhere yet — it&apos;s like writing down a secret word before a quiz.
            </li>
            <li>
              <strong>You&apos;re sent to PingOne</strong> — the app redirects your browser to PingOne&apos;s login page. Only
              a scrambled (hashed) version of the code is included in this redirect — the original stays on the server.
            </li>
            <li>
              <strong>You enter your credentials</strong> — PingOne shows the login form. You type your email, password, and
              MFA code if required. PingOne verifies it all.
            </li>
            <li>
              <strong>PingOne sends you back</strong> — after successful login, PingOne redirects you back to the app with a
              temporary, one-time <em>authorization code</em> (like a numbered ticket at a deli counter).
            </li>
            <li>
              <strong>The app redeems the ticket — server-side</strong> — the app takes that authorization code and the
              original secret word and exchanges them with PingOne for real security tokens. The browser never touches these tokens.
            </li>
            <li>
              <strong>Your session begins</strong> — the tokens are stored securely on the server, and your browser only
              receives a session cookie — like a wristband that says &quot;this person has already been verified.&quot;
            </li>
            <li>
              <strong>You land on your dashboard</strong> — every subsequent action uses that cookie. Your actual security
              tokens are never exposed to the browser.
            </li>
          </ol>
          <p style={{ color: "#374151", marginBottom: "1rem" }}>
            All client applications redirect to the <strong>same centralized PingOne sign-on UI</strong> — the app never renders its own login form. This means any change to authentication policy (new MFA requirement, new SSO provider, branding update) propagates automatically to every connected app without code changes.
          </p>
        </>
      ),
    },
    {
      id: 'ciba',
      label: 'Approve from your phone',
      content: <CibaVsLoginContent />,
    },
    {
      id: 'pkce',
      label: 'One-time code protection',
      content: <LoginFlowPkceContent />,
    },
    {
      id: 'tokens',
      label: 'What gets issued',
      content: (
        <>
          <h3>What&apos;s inside the security token</h3>
          <p>
            After login, PingOne issues an <strong>access token</strong> — a tamper-proof digital document
            (called a JWT) that proves who you are and what you&apos;re allowed to do. Here&apos;s what it contains:
          </p>
          <pre className="edu-code">{`{
  "sub": "who you are (your unique user ID at PingOne)",
  "aud": "which service this token is for",
  "scope": "what you're allowed to do: read accounts, etc.",
  "may_act": { ... },  // optional: which AI apps can act on your behalf
  "exp": 1234567890,   // when this token expires (Unix timestamp)
  "iss": "https://auth.pingone.com/..."  // issued by PingOne
}`}</pre>
          <ul>
            <li><strong>sub</strong> — your unique, stable user identifier.</li>
            <li><strong>aud</strong> — the specific service this token was issued for (it won&apos;t work anywhere else).</li>
            <li><strong>scope</strong> — the list of things this token allows: read balances, make transfers, etc.</li>
            <li><strong>may_act</strong> — an optional note saying which AI apps are pre-approved to act on your behalf.</li>
            <li><strong>exp</strong> — the expiry time. After this, the token stops working automatically.</li>
          </ul>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            Your browser <strong>never sees this token</strong>. It lives on the server; your browser only has a
            session cookie.
          </p>
        </>
      ),
    },
    {
      id: 'security',
      label: 'Security notes',
      content: <LoginFlowSecurityContent />,
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Redeeming the authorization code</h3>
          <EduImplIntro repoPath="banking_api_server/services/oauthUserService.js (and admin oauthService.js)">
            PingOne returns a <code>code</code> to the BFF callback; the server exchanges it with <code>code_verifier</code> (PKCE).
          </EduImplIntro>
          <pre className="edu-code">{SNIP_USER_LOGIN_EXCHANGE}</pre>
          <p style={{ color: "#374151", marginBottom: "1rem" }}>
            The redirect callback page (<code className="edu-code">/callback</code>) is intentionally minimal — static HTML with no JavaScript beyond the OAuth code exchange. Avoid rendering frameworks or lazy-loaded bundles on this page; delayed JavaScript execution can cause the auth code to expire before it&apos;s exchanged, producing silent login failures.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="How you sign in"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
