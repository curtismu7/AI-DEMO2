// banking_api_ui/src/components/PingOneSetupGuidePage.js
import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';

const REPO_ROOT = 'path/to/Banking';

/**
 * Full reference: PingOne objects, redirect URIs, repo scripts, and env vars needed for the demo.
 * For a shorter checklist, use /onboarding; for Vercel wizard + bootstrap UI, use /setup.
 */
export default function PingOneSetupGuidePage() {
  const copy = useCallback((text, label) => {
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard not available in this browser');
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${label}`),
      () => toast.error('Copy failed')
    );
  }, []);

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

  const btnStyle = {
    marginRight: '0.5rem',
    marginBottom: '0.5rem',
    padding: '0.45rem 0.85rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    borderRadius: '0.375rem',
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    cursor: 'pointer',
    color: '#1e293b',
  };

  const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' };
  const thtd = { border: '1px solid #e5e7eb', padding: '0.5rem 0.65rem', textAlign: 'left', verticalAlign: 'top' };
  const codeBlock = {
    display: 'block',
    margin: '0.5rem 0 0 0',
    padding: '0.65rem 0.75rem',
    background: '#f1f5f9',
    borderRadius: '6px',
    fontSize: '0.8125rem',
    overflow: 'auto',
    border: '1px solid #e2e8f0',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div style={headerStyle}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>PingOne setup reference</h1>
            <p style={{ fontSize: '0.875rem', opacity: 0.9, marginTop: '0.35rem', maxWidth: '46rem', lineHeight: 1.5 }}>
              Everything you need in PingOne, plus repository scripts and environment variables, so admin sign-in, customer sign-in, Management API automation, and optional PingOne Authorize features can work together.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link to="/" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem' }}>← Sign in</Link>
            <Link to="/onboarding" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem' }}>Setup checklist</Link>
            <Link to="/setup" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem' }}>Deployment setup</Link>
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
              Application Configuration
            </Link>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: '2rem 20px', maxWidth: '920px' }}>
        <div style={{ ...cardStyle, background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', color: 'var(--brand-navy)' }}>How to use this page</h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--brand-navy)', fontSize: '0.9375rem', lineHeight: 1.65 }}>
            <li><strong>/onboarding</strong> — short checklist (roles, hosted vs localhost).</li>
            <li><strong>/setup</strong> — copy-paste <code>npm run setup:vercel</code>, PingOne bootstrap plan from the API, and (as admin) probe / run bootstrap.</li>
            <li><strong>/config</strong> — enter or review PingOne environment, OAuth apps, and advanced options (localhost LMDB or deployment-managed).</li>
            <li>This page is the <strong>full map</strong>: PingOne objects, exact callback paths, scripts, and env var names.</li>
          </ul>
        </div>

        <div style={{ ...cardStyle, borderColor: '#c7d2fe', background: '#eef2ff' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', color: '#3730a3' }}>Where PingOne is called from (security)</h2>
          <p style={{ margin: 0, color: '#4338ca', fontSize: '0.9375rem', lineHeight: 1.65 }}>
            The browser talks only to this app&apos;s <strong>BFF</strong> (<code>/api/…</code>) with cookies or Bearer tokens — not to <code>api.pingone</code> or <code>auth.pingone</code> directly.
            OAuth login still <strong>redirects</strong> the user through PingOne&apos;s hosted pages; that cannot be routed through the MCP server.
            The <strong>MCP server</strong> uses PingOne for token introspection (and optional CIBA) before MCP tools call the Banking API.
            Management API and Authorize worker calls run on the BFF and are gated like other protected routes (admin session, scopes, or first-run config rules).
          </p>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>PingOne directory: what to create</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            The demo expects <strong>two</strong> browser OAuth applications (admin staff vs customer), optionally a <strong>Management API worker</strong> for automation, and optionally an <strong>Authorize worker</strong> for decision endpoints / advanced flows. Names can vary; redirect URIs and client IDs in config must match PingOne.
          </p>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thtd}>Item</th>
                <th style={thtd}>Purpose</th>
                <th style={thtd}>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={thtd}><strong>Environment</strong></td>
                <td style={thtd}>Tenant boundary for all API calls</td>
                <td style={thtd}>Set <code>PINGONE_ENVIRONMENT_ID</code> / Config “PingOne Environment ID”. Region defaults to <code>com</code> (<code>PINGONE_REGION</code>).</td>
              </tr>
              <tr>
                <td style={thtd}><strong>Admin OIDC app</strong></td>
                <td style={thtd}>Authorization Code — staff sign-in to <code>/admin</code></td>
                <td style={thtd}>Confidential web app; redirect URI must match the BFF callback below.</td>
              </tr>
              <tr>
                <td style={thtd}><strong>Customer OIDC app</strong></td>
                <td style={thtd}>Authorization Code — end users to <code>/dashboard</code></td>
                <td style={thtd}>Separate client from admin; own redirect URI.</td>
              </tr>
              <tr>
                <td style={thtd}><strong>Resource + scopes</strong></td>
                <td style={thtd}><code>*</code> style API access</td>
                <td style={thtd}>Create in PingOne and map scopes to the OIDC apps. Example list lives in <code>config/pingone-bootstrap.manifest.example.json</code> — still <strong>manual</strong> in PingOne today.</td>
              </tr>
              <tr>
                <td style={thtd}><strong>Management worker</strong></td>
                <td style={thtd}><code>client_credentials</code> for PingOne Management API</td>
                <td style={thtd}>Config keys <code>pingone_client_id</code> / <code>pingone_client_secret</code> or env <code>PINGONE_MANAGEMENT_CLIENT_ID</code> / <code>PINGONE_MANAGEMENT_CLIENT_SECRET</code>. Used for listing/creating apps, directory users (bootstrap), not browser login.</td>
              </tr>
              <tr>
                <td style={thtd}><strong>Authorize worker</strong></td>
                <td style={thtd}>PingOne Authorize, decision APIs</td>
                <td style={thtd}>Env <code>PINGONE_AUTHORIZE_WORKER_CLIENT_ID</code> / <code>PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET</code> (and related policy / endpoint IDs). Separate from Management worker unless you deliberately use one app with both roles.</td>
              </tr>
              <tr>
                <td style={thtd}><strong>Demo users</strong></td>
                <td style={thtd}><code>bankadmin</code>, <code>bankuser</code></td>
                <td style={thtd}>Optional: create in a population, or use <strong>Run PingOne bootstrap</strong> on <Link to="/setup">/setup</Link> (admin) after Management worker is configured.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Redirect URIs (replace with your public origin)</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            Register these on the <strong>correct</strong> PingOne application. Local dev often uses <code>http://localhost:PORT</code> or the HTTPS host from <code>./run-demo.sh</code> (see repo script comments).
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>Admin OAuth callback (BFF)</p>
          <code style={codeBlock}>{'{PUBLIC_URL}'}/api/auth/oauth/callback</code>
          <p style={{ margin: '1rem 0 0 0', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>Customer OAuth callback (BFF)</p>
          <code style={codeBlock}>{'{PUBLIC_URL}'}/api/auth/oauth/user/callback</code>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Scripts (run from repository root)</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            Commands are defined in the root <code>package.json</code> (parent of <code>banking_api_ui/</code>). <code>pingone:bootstrap</code> reads <code>banking_api_server/.env</code> when present.
          </p>
          <div style={{ marginBottom: '0.75rem' }}>
            <button type="button" style={btnStyle} onClick={() => copy('npm run pingone:bootstrap', 'npm run pingone:bootstrap')}>Copy: npm run pingone:bootstrap</button>
            <button type="button" style={btnStyle} onClick={() => copy('npm run pingone:bootstrap:probe', 'probe')}>Copy: npm run pingone:bootstrap:probe</button>
            <button type="button" style={btnStyle} onClick={() => copy('npm run setup:vercel', 'setup:vercel')}>Copy: npm run setup:vercel</button>
            <button type="button" style={btnStyle} onClick={() => copy('npm run setup:vercel:check', 'setup:vercel:check')}>Copy: npm run setup:vercel:check</button>
            <button type="button" style={btnStyle} onClick={() => copy(`cd ${REPO_ROOT}\n./run-demo.sh`, 'run-demo.sh')}>Copy: cd + ./run-demo.sh</button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#374151', fontSize: '0.875rem', lineHeight: 1.65 }}>
            <li><code>npm run pingone:bootstrap</code> — prints ordered steps from <code>config/pingone-bootstrap.manifest.example.json</code>.</li>
            <li><code>npm run pingone:bootstrap:probe</code> — same + tests Management API token (needs worker credentials in env/config).</li>
            <li><code>npm run setup:vercel</code> — interactive env wizard; see <code>.env.vercel.example</code> at repo root.</li>
            <li><code>./run-demo.sh</code> — local HTTPS stack (API/UI ports documented in the script); requires one-time hosts + certs per script header.</li>
            <li>Implementation file: <code>scripts/pingone-bootstrap.js</code>.</li>
          </ul>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>In-app tools (after the API is up)</h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#374151', fontSize: '0.875rem', lineHeight: 1.65 }}>
            <li><code>GET /api/setup/plan</code> — same bootstrap step list as the CLI manifest (used by <Link to="/setup">Deployment setup</Link>).</li>
            <li><code>GET /api/admin/setup/management-probe</code> — admin session; lists OIDC apps via Management API.</li>
            <li><code>POST /api/admin/setup/pingone-bootstrap-run</code> — admin session; optional <code>X-Setup-Master-Key</code> if <code>SETUP_MASTER_KEY</code> is set on the server.</li>
          </ul>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Environment variables (common names)</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            The server accepts several aliases per field (e.g. <code>PINGONE_ADMIN_CLIENT_ID</code> vs <code>PINGONE_CORE_CLIENT_ID</code>). See <code>banking_api_server/services/configStore.js</code> and <code>banking_api_server/.env.example</code> for the full list.
          </p>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thtd}>Area</th>
                <th style={thtd}>Variables (examples)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={thtd}>Environment + region</td>
                <td style={thtd}><code>PINGONE_ENVIRONMENT_ID</code>, <code>PINGONE_REGION</code></td>
              </tr>
              <tr>
                <td style={thtd}>Admin OAuth app</td>
                <td style={thtd}><code>PINGONE_CORE_CLIENT_ID</code>, <code>PINGONE_CORE_CLIENT_SECRET</code>, <code>PINGONE_CORE_REDIRECT_URI</code></td>
              </tr>
              <tr>
                <td style={thtd}>Customer OAuth app</td>
                <td style={thtd}><code>PINGONE_CORE_USER_CLIENT_ID</code>, <code>PINGONE_CORE_USER_CLIENT_SECRET</code>, <code>PINGONE_CORE_USER_REDIRECT_URI</code></td>
              </tr>
              <tr>
                <td style={thtd}>Management API worker</td>
                <td style={thtd}><code>PINGONE_MANAGEMENT_CLIENT_ID</code>, <code>PINGONE_MANAGEMENT_CLIENT_SECRET</code></td>
              </tr>
              <tr>
                <td style={thtd}>PingOne Authorize</td>
                <td style={thtd}><code>PINGONE_AUTHORIZE_WORKER_CLIENT_ID</code>, <code>PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET</code>, <code>PINGONE_AUTHORIZE_POLICY_ID</code>, decision endpoint IDs</td>
              </tr>
              <tr>
                <td style={thtd}>App URL</td>
                <td style={thtd}><code>PUBLIC_APP_URL</code> (hosted); session / cookie settings in <code>.env.example</code></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ ...cardStyle, borderColor: '#e9d5ff', background: '#faf5ff' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: '#5b21b6' }}>Repository docs (clone required)</h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#4c1d95', fontSize: '0.875rem', lineHeight: 1.65 }}>
            <li><code>config/pingone-bootstrap.manifest.example.json</code> — example app names and scope list.</li>
            <li><code>docs/PINGONE_AUTHORIZE_PLAN.md</code> — Authorize / decision flow notes.</li>
            <li><code>banking_mcp_server/docs/pingone-oauth-setup.md</code> — MCP server OAuth context.</li>
            <li><code>banking_api_server/PINGONE_AI_CORE_SETUP.md</code> — legacy-style OAuth walkthrough (verify port/URI examples match your deployment).</li>
          </ul>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <Link to="/setup" style={{ fontSize: '0.9375rem', color: 'var(--brand-navy)' }}>Open Deployment setup</Link>
          <Link to="/onboarding" style={{ fontSize: '0.9375rem', color: 'var(--brand-navy)' }}>Open Setup checklist</Link>
          <Link to="/" style={{ fontSize: '0.9375rem', color: 'var(--brand-navy)' }}>Return to sign in</Link>
        </div>
      </div>
    </div>
  );
}
