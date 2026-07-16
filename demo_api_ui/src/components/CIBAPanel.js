/**
 * CIBAPanel.js — Floating CIBA (Client-Initiated Backchannel Authentication) panel
 *
 * A persistent floating button in the bottom-right corner that opens a
 * slide-in drawer explaining CIBA and letting the user trigger / monitor
 * a live CIBA authentication flow.
 *
 * Tabs:
 *   1. What is CIBA  — explainer with sequence diagram
 *   2. Sign-in & roles — admin vs customer, where each lands, banking agent vs login
 *   3. Try It        — initiate a live CIBA request and watch it poll
 *   4. How This App Uses It — MCP agent flow, step-up transactions
 *   5. PingOne Setup — what needs to be configured in the admin console
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { notifyError } from '../utils/appToast';
import './CIBAPanel.css';
import {
  CibaWhatContent,
  CibaFullStackContent,
  TokenExchangeContent,
} from './education/educationContent';
import { EduImplIntro, SNIP_CIBA_INITIATE } from './education/educationImplementationSnippets';

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------

const MCP_FLOW = `
Without CIBA (current):
  Chat UI → MCP server needs tokens
  → Server returns a URL in chat text
  → User must manually open URL in browser
  → User authenticates, returns to chat
  ⚠  Breaks chat flow, awkward redirect

With CIBA:
  Chat UI → MCP server needs tokens
  → Server sends bc-authorize to PingOne
  → PingOne delivers approval (email link or push — your DaVinci config)
  → User approves out-of-band — never leaves chat
  → Tokens arrive at server silently
  ✅  Fluid, in-context, no redirect needed
`;

const STEP_UP_FLOW = `
High-value transaction (amount > threshold):

Without CIBA:
  User clicks Transfer $500
  → Server redirects browser to PingOne
  → User authenticates, gets redirected back
  → Page reload, context lost

With CIBA:
  User clicks Transfer $500
  → UI shows "Check your email or device" overlay (wording depends on PingOne)
  → PingOne sends approval (email or push per your setup)
  → User approves out-of-band
  → Transfer executes immediately
  ✅  No redirect, no page reload
`;

const PINGONE_STEPS = [
  {
    step: '1',
    title: 'Enable CIBA Grant Type',
    detail: 'PingOne Admin → Applications → (your app) → Grant Types → enable "urn:openid:params:grant-type:ciba"',
  },
  {
    step: '2',
    title: 'Set Token Delivery Mode',
    detail: 'In the CIBA section: Token Delivery Mode = "Poll" (simplest). Set Auth Request Expiry = 300s.',
  },
  {
    step: '3',
    title: 'Email-only CIBA = no MFA push required',
    detail:
      'In DaVinci, configure the CIBA flow to send an approval email (notification template with approve link). Users confirm in their inbox — you do not need PingOne MFA push or a registered authenticator app for that path.',
  },
  {
    step: '4',
    title: 'Optional — push approval instead of email',
    detail:
      'If your DaVinci flow delivers CIBA via push to a device, enable Push Notification in your MFA policy and register PingOne / MS Authenticator (or your IdP’s device MFA). Email vs push is chosen in PingOne, not in this app.',
  },
  {
    step: '5',
    title: 'Set CIBA_ENABLED=true',
    detail: 'In your .env or hosted environment variables (Replit Secrets, Vercel, etc.), add: CIBA_ENABLED=true',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({ id, label, active, onClick }) {
  return (
    <button
      className={`ciba-tab${active ? ' ciba-tab--active' : ''}`}
      onClick={() => onClick(id)}
    >
      {label}
    </button>
  );
}

function CodeBlock({ children }) {
  return (
    <pre className="ciba-code">
      <code>{children}</code>
    </pre>
  );
}

function StatusBadge({ status }) {
  const map = {
    idle:     { color: '#374151', label: 'Idle' },
    loading:  { color: 'var(--brand-navy)', label: 'Initiating…' },
    pending:  { color: '#d97706', label: '⏳ Waiting for approval' },
    approved: { color: '#16a34a', label: '✅ Approved' },
    denied:   { color: '#dc2626', label: '❌ Denied' },
    error:    { color: '#dc2626', label: '⚠ Error' },
    expired:  { color: '#374151', label: 'Expired' },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{ color: s.color, fontWeight: 600, fontSize: '0.9rem' }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// "Try It" tab — live CIBA demo
// ---------------------------------------------------------------------------

function TryItTab({ cibaStatus }) {
  const [emailHint, setEmailHint]   = useState('');
  const [scope, setScope]           = useState('openid profile email');
  const [message, setMessage]       = useState('Banking App - Demo Authentication');
  const [acrValues, setAcrValues]   = useState('');
  const [status, setStatus]         = useState('idle'); // idle|loading|pending|approved|denied|error|expired
  const [authReqId, setAuthReqId]   = useState(null);
  const [pollLog, setPollLog]       = useState([]);
  const [expiresAt, setExpiresAt]   = useState(null);
  const [timeLeft, setTimeLeft]     = useState(null);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  const log = (msg) => setPollLog((prev) => [`${new Date().toLocaleTimeString()} — ${msg}`, ...prev].slice(0, 20));

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
  }, []);

  const cancel = useCallback(async () => {
    stopPolling();
    if (authReqId) {
      try { await axios.post(`/api/auth/ciba/cancel/${authReqId}`); } catch (_) {}
    }
    setStatus('idle');
    setAuthReqId(null);
    setPollLog([]);
    setExpiresAt(null);
    setTimeLeft(null);
  }, [authReqId, stopPolling]);

  // Poll effect
  useEffect(() => {
    if (status !== 'pending' || !authReqId) return;
    let cancelled = false;
    pollRef.current = setInterval(async () => {
      if (cancelled) return;
      try {
        const { data } = await axios.get(`/api/auth/ciba/poll/${authReqId}`);
        if (cancelled) return;
        log(`poll → ${data.status}${data.slow_down ? ' (slow_down)' : ''}`);
        if (data.status === 'approved') {
          stopPolling();
          setStatus('approved');
        }
      } catch (err) {
        if (cancelled) return;
        const s = err.response?.data?.status;
        if (s === 'denied') {
          stopPolling();
          setStatus('denied');
          notifyError(err.response?.data?.message || 'User denied the request');
          log('denied by user');
        } else if (err.response?.status === 410) {
          stopPolling();
          setStatus('expired');
          log('request expired');
        } else {
          log(`poll error: ${err.message}`);
        }
      }
    }, 5000);
    return () => { cancelled = true; stopPolling(); };
  }, [status, authReqId, stopPolling]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left === 0) {
        stopPolling();
        setStatus('expired');
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [expiresAt, stopPolling]);

  const initiate = async () => {
    if (!cibaStatus?.enabled) return;
    setStatus('loading');
    setPollLog([]);
    setAuthReqId(null);
    log('initiating CIBA request…');
    try {
      const { data } = await axios.post('/api/auth/ciba/initiate', {
        login_hint: emailHint || undefined,
        scope,
        binding_message: message,
        acr_values: acrValues || undefined,
      });
      setAuthReqId(data.auth_req_id);
      setExpiresAt(Date.now() + data.expires_in * 1000);
      setStatus('pending');
      log(`auth_req_id: ${data.auth_req_id.slice(0, 12)}…  expires in ${data.expires_in}s`);
      log(`CIBA requested for: ${data.login_hint_display}`);
    } catch (err) {
      setStatus('error');
      const d = err.response?.data;
      notifyError(d?.message || d?.error || err.message);
      log(`error: ${d?.message || err.message}`);
    }
  };

  if (!cibaStatus?.enabled) {
    return (
      <div className="ciba-tab-content">
        <div className="ciba-notice ciba-notice--warning">
          <strong>CIBA is not enabled.</strong> Set <code>CIBA_ENABLED=true</code> and
          configure PingOne (see the Setup tab) to try a live demo.
        </div>
        <p style={{ fontSize: '0.85rem', color: '#374151', marginTop: '1rem' }}>
          Once enabled, this tab lets you initiate a live CIBA request (approval is by email or push
          depending on your PingOne / DaVinci setup) and watch the polling loop in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="ciba-tab-content">
      <p className="ciba-section-desc">
        <strong>What you are exercising:</strong> <code>POST /api/auth/ciba/initiate</code> starts a CIBA request at PingOne
        (backchannel). The server returns an <code>auth_req_id</code>. This UI then calls{' '}
        <code>GET /api/auth/ciba/poll/:authReqId</code> until PingOne issues tokens (approved) or returns denied / expired.
        Tokens are written to the <strong>Backend-for-Frontend (BFF) session</strong> — they are not returned to the browser.
      </p>
      <p className="ciba-section-desc">
        Initiate a live CIBA request. PingOne will deliver the approval step by <strong>email</strong> or{' '}
        <strong>push</strong> depending on how you configured DaVinci — this app only sends{' '}
        <code>login_hint</code> and <code>binding_message</code>.
      </p>

      {/* Form */}
      {status === 'idle' || status === 'error' ? (
        <div className="ciba-form">
          <label className="ciba-label">
            User email (login_hint)
            <input
              className="ciba-input"
              type="email"
              value={emailHint}
              onChange={(e) => setEmailHint(e.target.value)}
              placeholder="Defaults to currently logged-in user's email"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
            />
          </label>
          <label className="ciba-label">
            Scopes
            <input
              className="ciba-input"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="openid profile email"
            />
          </label>
          <label className="ciba-label">
            Binding message (shown in email or on device push)
            <input
              className="ciba-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label className="ciba-label">
            ACR values (step-up, optional)
            <input
              className="ciba-input"
              value={acrValues}
              onChange={(e) => setAcrValues(e.target.value)}
              placeholder="e.g. Multi_factor"
            />
          </label>
          <button className="ciba-btn ciba-btn--primary" onClick={initiate}>
            Start CIBA request
          </button>
        </div>
      ) : (
        <div className="ciba-live">
          <div className="ciba-live-status">
            <StatusBadge status={status} />
            {timeLeft !== null && status === 'pending' && (
              <span className="ciba-timer">Expires in {timeLeft}s</span>
            )}
          </div>

          {status === 'pending' && (
            <div className="ciba-notice ciba-notice--info">
              Complete approval where PingOne sent it — <strong>email inbox</strong> or <strong>device push</strong> (your PingOne setup).<br />
              This panel polls <code>/api/auth/ciba/poll/{authReqId?.slice(0,12)}…</code> every 5 seconds.
            </div>
          )}

          {status === 'approved' && (
            <div className="ciba-notice ciba-notice--success">
              ✅ User approved! Tokens stored server-side in the Backend-for-Frontend (BFF) session.
              They are never sent to this browser.
            </div>
          )}

          {/* Poll log */}
          <div className="ciba-poll-log">
            <div className="ciba-poll-log-title">Poll log</div>
            {pollLog.map((line, i) => (
              <div key={i} className="ciba-poll-line">{line}</div>
            ))}
          </div>

          <button className="ciba-btn ciba-btn--secondary" onClick={cancel}>
            Cancel / Reset
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CIBAPanel component
// ---------------------------------------------------------------------------

export default function CIBAPanel() {
  const [open, setOpen]           = useState(false);
  const [activeTab, setActiveTab] = useState('what');
  const [cibaStatus, setCibaStatus] = useState(null);
  // Resizable drawer width — persisted in localStorage
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('cibaDrawerWidth'), 10);
    return saved > 300 ? saved : 840;
  });
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, startWidth: 0 });

  // Fetch CIBA enabled status once
  useEffect(() => {
    axios.get('/api/auth/ciba/status')
      .then(({ data }) => setCibaStatus(data))
      .catch(() => setCibaStatus({ enabled: false }));
  }, []);

  const tabs = [
    { id: 'what',      label: 'What is CIBA' },
    { id: 'roles',     label: 'Sign-in & roles' },
    { id: 'fullstack', label: 'Full stack' },
    { id: 'tokenx',    label: 'Token exchange' },
    { id: 'vslogin',   label: 'vs Login Flow' },
    { id: 'tryit',     label: 'Try It' },
    { id: 'appflow',   label: 'App Flows' },
    { id: 'setup',     label: 'PingOne Setup' },
    { id: 'bffcode',   label: 'BFF code' },
  ];

  useEffect(() => {
    const valid = new Set(['what', 'roles', 'fullstack', 'tokenx', 'vslogin', 'tryit', 'appflow', 'setup', 'bffcode']);
    const onEdu = (e) => {
      setOpen(true);
      const t = e.detail?.tab;
      setActiveTab(valid.has(t) ? t : 'what');
    };
    window.addEventListener('education-open-ciba', onEdu);
    return () => window.removeEventListener('education-open-ciba', onEdu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // ── Resize drag (left edge handle) ────────────────────────────────────────
  const handleResizeMouseDown = useCallback((e) => {
    isResizingRef.current = true;
    resizeStartRef.current = { x: e.clientX, startWidth: drawerWidth };
    e.preventDefault();
  }, [drawerWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current) return;
      // Dragging left = larger, dragging right = smaller
      const delta = resizeStartRef.current.x - e.clientX;
      const newWidth = Math.max(380, Math.min(window.innerWidth * 0.9, resizeStartRef.current.startWidth + delta));
      setDrawerWidth(newWidth);
    };
    const onUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        // Persist across page loads
        localStorage.setItem('cibaDrawerWidth', String(Math.round(drawerWidth)));
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, [drawerWidth]);

  return (
    <>
      {/* CIBA guide FAB removed — open via Learn menu, Banking Agent, or window event `education-open-ciba`. */}

      {/* Drawer overlay */}
      {open && (
        <div className="ciba-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {/* Drawer */}
      <div
        className={`ciba-drawer${open ? ' ciba-drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="CIBA Panel"
        // The drawer is always mounted (only the click-overlay is gated by `open`);
        // hide it from the a11y tree when closed so the off-screen drawer isn't
        // announced as an open dialog. Mirrors CimdSimPanel.
        aria-hidden={!open}
        style={{ width: `min(${drawerWidth}px, 96vw)` }}
      >
        {/* Left-edge resize handle */}
        <div
          className="ciba-resize-handle"
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize"
        />
        {/* Header */}
        <div className="ciba-header">
          <div>
            <h2 className="ciba-title">
              Backchannel Authentication
              {cibaStatus?.enabled
                ? <span className="ciba-badge ciba-badge--on">Enabled</span>
                : <span className="ciba-badge ciba-badge--off">Disabled</span>}
            </h2>
            <p className="ciba-subtitle">
              OIDC CIBA plus OAuth tokens, Backend-for-Frontend (BFF) session, MCP, and RFC 8693 token exchange — open <strong>Full stack</strong> for the map and <strong>Token exchange</strong> for before/after <code>/token</code>, statuses, and responses.
            </p>
          </div>
          <button className="ciba-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="ciba-tabs">
          {tabs.map((t) => (
            <TabButton key={t.id} id={t.id} label={t.label} active={activeTab === t.id} onClick={setActiveTab} />
          ))}
        </div>

        {/* Tab content */}
          <div className="ciba-body">

          {/* ── Full stack (platform map) ── */}
          {activeTab === 'fullstack' && (
            <div className="ciba-tab-content">
              <CibaFullStackContent />
            </div>
          )}

          {/* ── Token exchange (RFC 8693) — before/after token, HTTP, responses ── */}
          {activeTab === 'tokenx' && (
            <div className="ciba-tab-content">
              <TokenExchangeContent />
            </div>
          )}

          {activeTab === 'vslogin' && (
            <div className="ciba-tab-content">
              <h3 className="ciba-section-title">CIBA vs Authorization Code (login flow)</h3>
              <div className="ciba-cards" style={{ marginBottom: '1rem' }}>
                <div className="ciba-card">
                  <div className="ciba-card-icon">CIBA</div>
                  <div>
                    <strong>CIBA</strong><br />
                    No browser redirect to PingOne for the approval step. User gets out-of-band approval (email or push per your PingOne config); server polls{' '}
                    <code>POST /token</code> with <code>grant_type=ciba</code>. Good for agents and step-up without breaking chat.
                  </div>
                </div>
                <div className="ciba-card">
                  <div className="ciba-card-icon">🔐</div>
                  <div>
                    <strong>Authorization Code + PKCE</strong><br />
                    Full browser redirect to PingOne login page, then redirect back with <code>code</code>. Immediate session establishment;
                    standard for SPAs with Backend-for-Frontend (BFF). See <strong>Learn → Login Flow</strong> in the top bar.
                  </div>
                </div>
              </div>
              <p className="ciba-section-desc">
                Both are OAuth-family flows at PingOne; this app can use CIBA when enabled for high-value actions and uses Authorization Code for sign-in.
              </p>
            </div>
          )}

          {/* ── Sign-in, admin vs customer, banking agent ── */}
          {activeTab === 'roles' && (
            <div className="ciba-tab-content">
              <h3 className="ciba-section-title">Two different OAuth sign-ins</h3>
              <p className="ciba-section-desc">
                Each button on the login page starts a <em>different</em> authorization flow using a <strong>different PingOne OAuth client</strong> (admin app vs end-user app) — <strong>two clients on every platform</strong>. On <strong>hosted</strong> deployments, both client IDs and secrets are <strong>pre-configured on the server</strong> — visitors do not type them in Application Configuration. On <strong>localhost</strong>, you configure both apps in the Config UI (LMDB).
              </p>
              <div className="ciba-cards" style={{ marginBottom: '1rem' }}>
                <div className="ciba-card">
                  <div className="ciba-card-icon">Admin</div>
                  <div>
                    <strong>Admin sign-in</strong> — <code>GET /api/auth/oauth/login</code><br />
                    Uses the <strong>admin</strong> PingOne application (admin redirect URI). After PingOne returns, the browser is redirected to the <strong>Admin Dashboard</strong> at <code>/admin</code> (or <code>FRONTEND_ADMIN_URL</code> if set). In this demo, <strong>new</strong> users created through this flow get the <strong>admin</strong> role in the local user store.
                  </div>
                </div>
                <div className="ciba-card">
                  <div className="ciba-card-icon">User</div>
                  <div>
                    <strong>Customer sign-in</strong> — <code>GET /api/auth/oauth/user/login</code><br />
                    Uses the <strong>end-user</strong> PingOne application (customer redirect URI). New users get the <strong>customer</strong> role and sample accounts, and land at <code>/dashboard</code>. Existing users keep their stored role — if you previously signed in via Admin sign-in (which sets <code>role: admin</code> in the demo store), the customer flow will also route you to <code>/admin</code>. To ensure a fresh customer session, log out fully before switching flows.
                  </div>
                </div>
              </div>

              <h3 className="ciba-section-title">What admins can do that customers cannot</h3>
              <ul className="ciba-flow-list">
                <li><strong>Admin</strong> (<code>role === &apos;admin&apos;</code>): Activity logs, manage users, view <em>all</em> accounts and transactions, Security Settings (thresholds / PingOne Authorize integration), Application Configuration link, full MCP Inspector. Routed to <code>/admin</code> and admin-only routes.</li>
                <li><strong>Customer</strong> (<code>role === &apos;customer&apos;</code>): Personal dashboard only — own accounts, deposits, transfers, withdrawals within normal policy; MCP Inspector in read-oriented use; no tenant-wide admin screens.</li>
              </ul>
              <p className="ciba-section-desc" style={{ fontSize: '0.85rem', color: '#374151' }}>
                The UI loads the signed-in user from <code>GET /api/auth/oauth/status</code> (admin PingOne app), <code>GET /api/auth/oauth/user/status</code> (end-user app), and <code>GET /api/auth/session</code> (basic auth). The post-login redirect depends on the user's <strong>stored role</strong> — a user whose record has <code>role: admin</code> is routed to <code>/admin</code> regardless of which OAuth app was used for sign-in.
              </p>

              <h3 className="ciba-section-title">AI Agent (robot button) vs signing in</h3>
              <p className="ciba-section-desc">
                The <strong>AI Agent</strong> panel is <em>not</em> a third identity. It does not log you in by itself. When you <strong>are</strong> signed in, the Agent calls <code>POST /api/mcp/tool</code>; the API server attaches your <strong>current session&apos;s OAuth access token</strong> and forwards MCP tool calls <strong>as you</strong>. So the Agent is the same user as the browser session — just a different UI (MCP tools) on top of the same Backend-for-Frontend (BFF) session cookie.
              </p>
              <p className="ciba-section-desc">
                When you are <strong>not</strong> signed in, the Agent only offers Configure and the two login buttons — it cannot run tools until a session exists.
              </p>
              <div className="ciba-notice ciba-notice--info">
                <strong>How we know who you are:</strong> the server reads <code>req.session.user</code> for the human. For MCP tool calls, the Backend-for-Frontend (BFF) can optionally issue a <strong>delegated token</strong> where the <strong>agent OAuth client</strong> is the actor and you remain the subject (RFC 8693 with <code>actor_token</code> + <code>subject_token</code>) — configure <code>USE_AGENT_ACTOR_FOR_MCP</code>, <code>AGENT_OAUTH_CLIENT_*</code>, and optional PingOne directory provisioning via <code>/api/agent/identity/bootstrap</code>. That is “on behalf of,” not impersonation.
              </div>
            </div>
          )}

          {/* ── What is CIBA ── */}
          {activeTab === 'what' && (
            <div className="ciba-tab-content">
              <CibaWhatContent />
            </div>
          )}

          {/* ── Try It ── */}
          {activeTab === 'tryit' && <TryItTab cibaStatus={cibaStatus} />}

          {/* ── App Flows ── */}
          {activeTab === 'appflow' && (
            <div className="ciba-tab-content">
              <h3 className="ciba-section-title">MCP / AI Agent authentication</h3>
              <p className="ciba-section-desc">
                When the AI agent needs user tokens to call the backend API,
                CIBA replaces the awkward "open this URL in your browser" redirect.
                The <strong>Full stack</strong> tab shows how MCP tools, token exchange, and REST APIs connect; here we focus on why CIBA helps chat and agent flows.
              </p>
              <CodeBlock>{MCP_FLOW}</CodeBlock>

              <h3 className="ciba-section-title">Step-up auth for high-value transactions</h3>
              <p className="ciba-section-desc">
                Transactions above <strong>STEP_UP_AMOUNT_THRESHOLD</strong> (default $250) require
                additional authentication. CIBA makes this seamless.
              </p>
              <CodeBlock>{STEP_UP_FLOW}</CodeBlock>

              <h3 className="ciba-section-title">API endpoints (this server)</h3>
              <div className="ciba-endpoint-table">
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--post">POST</span>
                  <code>/api/auth/ciba/initiate</code>
                  <span className="ciba-endpoint-desc">Start CIBA (PingOne delivers approval by email or push)</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--get">GET</span>
                  <code>/api/auth/ciba/poll/:authReqId</code>
                  <span className="ciba-endpoint-desc">Check approval status — returns pending / approved / denied</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--get">GET</span>
                  <code>/api/auth/ciba/status</code>
                  <span className="ciba-endpoint-desc">Returns whether CIBA is enabled and the delivery mode</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--post">POST</span>
                  <code>/api/auth/ciba/cancel/:id</code>
                  <span className="ciba-endpoint-desc">Cancel a pending request</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--post">POST</span>
                  <code>/api/auth/ciba/notify</code>
                  <span className="ciba-endpoint-desc">Ping-mode callback from PingOne (user approved out-of-band)</span>
                </div>
              </div>
            </div>
          )}

          {/* ── PingOne Setup ── */}
          {activeTab === 'setup' && (
            <div className="ciba-tab-content">
              <p className="ciba-section-desc">
                These steps are done in the <strong>PingOne Admin Console</strong> — no code changes.
              </p>
              <div className="ciba-setup-steps">
                {PINGONE_STEPS.map((s) => (
                  <div key={s.step} className="ciba-setup-step">
                    <div className="ciba-setup-num">{s.step}</div>
                    <div>
                      <strong>{s.title}</strong>
                      <p>{s.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="ciba-section-title">Environment variables</h3>
              <CodeBlock>{`CIBA_ENABLED=true
CIBA_TOKEN_DELIVERY_MODE=poll
CIBA_BINDING_MESSAGE=Banking App Authentication
CIBA_POLL_INTERVAL_MS=5000
CIBA_AUTH_REQUEST_EXPIRY=300`}</CodeBlock>

              <div className="ciba-notice ciba-notice--info" style={{ marginTop: '1rem' }}>
                <strong>Azure AD users?</strong> If PingOne federates to Azure AD, <code>login_hint</code> (email)
                still resolves the user. For <strong>email-only</strong> CIBA, no extra device is required. For a{' '}
                <strong>push</strong> path, users may already have Microsoft Authenticator via Azure AD — depends on your IdP and DaVinci flow.
              </div>
            </div>
          )}

          {activeTab === 'bffcode' && (
            <div className="ciba-tab-content">
              <h3 className="ciba-section-title">CIBA routes in the Banking API</h3>
              <p className="ciba-section-desc">
                The floating panel&apos;s <strong>Try It</strong> tab calls these endpoints; tokens stay in the BFF session.
              </p>
              <EduImplIntro repoPath="banking_api_server/routes/ciba.js + services/cibaService.js">
                Initiate requires an authenticated session with a <code>login_hint</code> (email).
              </EduImplIntro>
              <pre className="ciba-code-pre">{SNIP_CIBA_INITIATE}</pre>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
