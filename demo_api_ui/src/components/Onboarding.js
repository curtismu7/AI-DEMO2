import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Public onboarding checklist: what to prepare in PingOne and what to enter on /config.
 */
export default function Onboarding() {
  const headerStyle = {
    background: 'linear-gradient(to bottom, var(--brand-navy) 0%, var(--brand-navy) 100%)',
    color: 'white',
    padding: '1rem 0',
    boxShadow: '0 2px 4px rgba(0,0,0,.15)',
  };

  const cardStyle = {
    background: 'white',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    padding: '1.25rem 1.5rem',
    marginBottom: '1.25rem',
  };

  const olStyle = { margin: '0.5rem 0 0 0', paddingLeft: '1.25rem', color: '#374151', lineHeight: 1.6 };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div style={headerStyle}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Welcome — setup checklist</h1>
            <p style={{ fontSize: '0.875rem', opacity: 0.9, marginTop: '0.35rem', maxWidth: '42rem' }}>
              Configure PingOne OAuth before users can sign in. Review this page first, then enter values on the Application Configuration page.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link to="/" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem' }}>← Sign in</Link>
            <Link to="/setup/pingone" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem' }}>
              PingOne reference
            </Link>
            <Link
              to="/config"
              style={{
                display: 'inline-block',
                background: 'white',
                color: 'var(--brand-navy)',
                fontWeight: 600,
                fontSize: '0.875rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                textDecoration: 'none',
              }}
            >
              Open Application Configuration
            </Link>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: '2rem 20px', maxWidth: '800px' }}>
        <div style={{ ...cardStyle, background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', color: 'var(--brand-navy)' }}>What you need</h2>
          <p style={{ margin: 0, color: 'var(--brand-navy)', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            This demo uses <strong>PingOne AI IAM Core</strong> with <strong>two separate OAuth clients</strong> everywhere: one PingOne application for <em>Admin</em> sign-in and one for <em>Customer</em> (end-user) sign-in — same on Vercel, Replit, and localhost. On <strong>hosted</strong> deployments, those client IDs and secrets (and worker tokens) may be <strong>pre-configured on the server</strong> — visitors do not type them in the UI. On <strong>localhost</strong>, you enter both apps in Application Configuration (LMDB). Until the API is configured, sign-in may redirect to the configuration page.
          </p>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Admin vs customer — where you land</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            The two buttons on the login page are <strong>not</strong> the same. Each starts a different OAuth flow against a <strong>different PingOne client</strong> (admin OIDC app vs end-user OIDC app). On every platform you must register the matching redirect URI in each PingOne app. Hosted: credentials live in env/KV/secrets; local: you set both apps in Application Configuration.
          </p>
          <ul style={{ ...olStyle, listStyle: 'disc' }}>
            <li><strong>Admin sign-in</strong> — Opens the <em>admin</em> OAuth client. After success you are sent to the <strong>Admin Dashboard</strong> (<code>/admin</code>): activity logs, all users and accounts, security settings, app configuration, MCP Inspector. New demo users from this flow are stored with an <strong>admin</strong> role unless they already existed.</li>
            <li><strong>Customer sign-in</strong> — Opens the <em>end-user</em> OAuth client. After success you go to the <strong>personal dashboard</strong> (<code>/dashboard</code>) with your own accounts and transactions. New users get a <strong>customer</strong> role and sample data.</li>
            <li><strong>AI Agent</strong> (robot button) — This is <em>not</em> a third sign-in. When you are signed in, agent actions call the API using <strong>your current session</strong> (same person as the main app). When signed out, the agent only helps you start Admin or Customer sign-in (or open reference docs). Open the <strong>CIBA guide → Sign-in &amp; roles</strong> tab for the full picture.</li>
          </ul>
        </div>

        <div style={{ ...cardStyle, borderColor: '#a7f3d0', background: '#f0fdf4' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: '#166534' }}>Hosted demo (Vercel, Replit, …)</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#166534', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            <strong>Vercel:</strong> run the env wizard from the repo root — open the{' '}
            <Link to="/setup" style={{ color: '#15803d', fontWeight: 600 }}>Deployment setup</Link>{' '}
            page for copy-paste commands (<code>npm run setup:vercel</code>).
          </p>
          <ol style={olStyle}>
            <li>
              <strong>Always two PingOne applications</strong> — admin staff app and end-user app — each with its own client ID (and secret if confidential). Deployment env vars supply both (e.g. <code>PINGONE_ADMIN_*</code> and <code>PINGONE_USER_*</code>); Authorize worker, environment ID, etc. are <strong>stored on the backend</strong> — not typed in by visitors.
            </li>
            <li>The <strong>sign-in page</strong> offers <strong>Admin sign-in</strong> and <strong>Customer sign-in</strong> — two separate OAuth flows backed by those two clients.</li>
            <li><Link to="/config">Application Configuration</Link> shows <strong>reference</strong> redirect URIs and explains what is deployment-managed; it does not ask for client secrets.</li>
            <li>Operators change credentials via the host&apos;s environment variables / KV (or secrets), not through the public UI.</li>
          </ol>
        </div>

        <div style={{ ...cardStyle, borderColor: '#fed7aa', background: '#fffbeb' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: '#9a3412' }}>Replit</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#78350f', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            If you deploy this repo on <strong>Replit</strong>, use <strong>Secrets</strong> (lock icon in the sidebar) for sensitive values. Put PingOne redirect URIs in PingOne exactly as they appear on{' '}
            <Link to="/config">Application Configuration</Link> for your public origin.
          </p>
          <ol style={olStyle}>
            <li>
              Set <code>PUBLIC_APP_URL</code> to your stable HTTPS URL (no trailing slash), e.g. your published Repl or{' '}
              <code>*.replit.dev</code> host. Replit may also expose <code>REPLIT_DEV_DOMAIN</code>; the API uses these for OAuth callback URLs.
            </li>
            <li>
              Optional: <code>REPLIT_MANAGED_OAUTH=true</code> when OAuth credentials should be <strong>deployment-managed only</strong> (Config page shows reference text, like this public demo). You still need <strong>both</strong> admin and user clients in Secrets — see <code>banking_api_server/.env.example</code>.
            </li>
            <li>
              Optional: <code>REPLIT_CONFIG_PASSWORD_MODE=true</code> plus <code>ADMIN_CONFIG_PASSWORD</code> in Secrets if you need the config password gate when sessions are flaky.
            </li>
            <li>
              For multi-instance or long-lived sessions: <code>REDIS_URL</code> and/or Upstash (<code>KV_REST_API_URL</code> / <code>KV_REST_API_TOKEN</code>) as in the server <code>.env.example</code>.
            </li>
            <li>
              If the browser and API run on different origins, set <code>CORS_ORIGIN</code> to your UI origin.
            </li>
            <li>
              The embedded Replit preview can show extra CSP or console noise — test in a normal browser tab on your <code>*.replit.dev</code> URL when debugging OAuth.
            </li>
          </ol>
        </div>

        <div style={{ ...cardStyle, borderColor: '#e9d5ff', background: '#faf5ff' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: 'var(--brand-navy)' }}>Localhost (development)</h2>
          <ol style={olStyle}>
            <li>Create <strong>two</strong> PingOne OIDC web apps — one for admin sign-in and one for customers — the same two-client model as hosted deployments.</li>
            <li>The configuration page shows <strong>Admin OAuth App</strong> and <strong>End-User OAuth App</strong> separately so each client ID, secret, and redirect URI maps to the correct PingOne app.</li>
            <li>Each redirect URI must match its PingOne app exactly.</li>
            <li>Settings are stored in LMDB on the machine running the API server.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Application Configuration</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem' }}>
            <strong>Localhost:</strong> Open <Link to="/config">Application Configuration</Link> and complete PingOne Environment, Admin + End-User OAuth apps, Session &amp; Roles, optional Authorize, Advanced. Use <strong>Test PingOne Connection</strong>, then <strong>Save</strong>.
          </p>
          <p style={{ margin: '0.75rem 0 0 0', color: '#4b5563', fontSize: '0.9375rem' }}>
            <strong>Hosted:</strong> The same page is mostly <strong>reference</strong> — <strong>both</strong> admin and customer OAuth clients are pre-deployed on the server. You may still see optional settings depending on KV vs read-only mode.
          </p>
          <p style={{ margin: '0.75rem 0 0 0', color: '#4b5563', fontSize: '0.9375rem' }}>
            On that page, expand <strong>MCP Inspector setup</strong> to generate env snippets and commands. For how token exchange works (PingOne <code>/token</code>, HTTP status, responses), open the floating <strong>CIBA guide</strong> → <strong>Token exchange</strong>.
          </p>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Deployments (hosted / read-only)</h2>
          <ul style={{ ...olStyle, listStyle: 'disc' }}>
            <li>If the server shows <strong>read-only mode</strong>, settings must be supplied via environment variables or cloud KV — follow the banner on the configuration page.</li>
            <li>On some hosts, after the first save, updates may require <code>ADMIN_CONFIG_PASSWORD</code> as described on the configuration page.</li>
          </ul>
        </div>

        <div style={{ ...cardStyle, borderColor: '#fbcfe8', background: '#fdf2f8' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: '#9f1239' }}>PingOne Privilege (SE)</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#831843', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            Running the shared Privilege demo? Use the SE presenter hub for VM setup and the Request Access script.
          </p>
          <Link to="/privilege-demo" style={{ fontWeight: 600, color: '#9f1239', fontSize: '0.9375rem' }}>
            Open Privilege SE Demo Hub
          </Link>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginTop: '1.5rem' }}>
          <Link
            to="/config"
            className="btn btn-primary"
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Go to Application Configuration
          </Link>
          <Link to="/" style={{ fontSize: '0.9375rem', color: 'var(--brand-navy)' }}>Return to sign in</Link>
        </div>
      </div>
    </div>
  );
}
