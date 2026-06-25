// demo_api_ui/src/components/ResourceServerTester.jsx
//
// Interactive tester for the OIDC Resource Server page. Lets a logged-in user submit a
// token (a session token by reference, or a pasted JWT) and see how this resource server
// would treat it, through three independently-collapsible modes:
//   1. Real RS validation  — signature + aud/exp/nbf/scope breakdown → PERMIT/REJECT
//   2. Decode + policy      — claims + policy check (no signature) → WOULD_PASS/WOULD_REJECT
//   3. Live request probe   — real HTTP call to a protected endpoint → actual status/body
//
// Raw tokens never leave the server when a session token is referenced — only the
// identifier is sent. Pasted tokens come from the user's own input.
import React, { useState } from 'react';
import bffAxios from '../services/bffAxios';
import JsonHighlight from './shared/JsonHighlight';
import { notifySessionExpiredIfNeeded, navigateToCustomerOAuthLogin } from '../utils/authUi';
import './ResourceServerTester.css';

const PROBE_TARGETS = ['/api/resource-server/accounts', '/api/resource-server/transactions'];

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rst-collapsible ${open ? 'is-open' : ''}`}>
      <button type="button" className="rst-collapsible-head" onClick={() => setOpen((o) => !o)}>
        <span className="rst-caret">{open ? '▾' : '▸'}</span>
        <span className="rst-collapsible-title">{title}</span>
      </button>
      {open && <div className="rst-collapsible-body">{children}</div>}
    </div>
  );
}

function RuleList({ rules }) {
  return (
    <ul className="rst-rules">
      {rules.map((r) => (
        <li key={r.name} className={r.pass ? 'pass' : 'fail'}>
          <span className="rst-rule-icon">{r.pass ? '✅' : '❌'}</span>
          <span className="rst-rule-name">{r.name}</span>
          <span className="rst-rule-detail">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function ClaimsDetails({ claims }) {
  if (!claims) return null;
  return (
    <details className="rst-claims">
      <summary>Decoded claims</summary>
      <pre className="rst-json jh-dark"><JsonHighlight value={claims} /></pre>
    </details>
  );
}

// Sign-in CTA shown next to any 401 in the tester results, so a rejected/expired
// token leaves the user a clear way forward instead of a bare status code.
function SignInButton({ label = 'Sign in' }) {
  return (
    <button type="button" className="rst-signin" onClick={navigateToCustomerOAuthLogin}>
      {label}
    </button>
  );
}

// Inline error line, with a Sign in button when the failure was a 401 (the caller's
// own session token expired against the authenticateToken-gated tester route).
function ErrorLine({ error, status }) {
  if (!error) return null;
  return (
    <div className="rst-error">
      <span>⚠ {error}</span>
      {status === 401 && <SignInButton />}
    </div>
  );
}

// Small hook: POSTs a body to an endpoint and tracks loading/result/error/status.
function useRunner(endpoint) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const run = async (body) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStatus(null);
    try {
      const res = await bffAxios.post(endpoint, body);
      setResult(res.data);
    } catch (e) {
      const httpStatus = e.response?.status;
      const data = e.response?.data;
      setStatus(httpStatus ?? null);
      // A 401 here means the caller's OWN session token expired (the route is gated by
      // authenticateToken) — surface the global re-auth banner so the user can sign in
      // again, rather than leaving a bare "status code 401" with no way forward.
      notifySessionExpiredIfNeeded({ status: httpStatus, body: data });
      setError(
        httpStatus === 401
          ? 'Your sign-in session has expired. Sign in again to test this resource server.'
          : data?.error_description || data?.message || e.message || 'Request failed',
      );
    } finally {
      setLoading(false);
    }
  };
  return { loading, result, error, status, run };
}

// Validate and decode render identically — only the endpoint, copy, and verdict labels
// differ — so they share one panel. (Probe is shaped differently and stays separate.)
const VERDICT_TEXT = { PERMIT: 'PERMIT', WOULD_PASS: 'WOULD PASS', WOULD_REJECT: 'WOULD REJECT' };

function PolicyPanel({ title, desc, endpoint, runLabel, loadingLabel, payload, ready }) {
  const { loading, result, error, status, run } = useRunner(endpoint);
  const isPass = result && ['PERMIT', 'WOULD_PASS'].includes(result.decision);
  return (
    <Collapsible title={title}>
      <p className="rst-mode-desc">{desc}</p>
      <button type="button" className="rst-run" disabled={!ready || loading} onClick={() => run(payload)}>
        {loading ? loadingLabel : runLabel}
      </button>
      <ErrorLine error={error} status={status} />
      {result && (
        <div className="rst-result">
          <div className={`rst-verdict ${isPass ? 'permit' : 'reject'}`}>
            {VERDICT_TEXT[result.decision] || result.decision}
          </div>
          {result.method === 'introspection' && (
            <div className="rst-note">Opaque (non-JWT) token — read via RFC 7662 token introspection instead of decoding.</div>
          )}
          {result.rules && <RuleList rules={result.rules} />}
          <ClaimsDetails claims={result.claims} />
        </div>
      )}
    </Collapsible>
  );
}

function ProbePanel({ payload, ready, endpointBase }) {
  const { loading, result, error, status, run } = useRunner(`${endpointBase}/probe`);
  const [target, setTarget] = useState(PROBE_TARGETS[0]);
  return (
    <Collapsible title="Live request probe — real HTTP call">
      <p className="rst-mode-desc">
        Sends a real request to a protected endpoint with this token as the bearer, and
        shows the actual response — including a 401/403 rejection.
      </p>
      <label className="rst-target">
        Target endpoint
        <select className="ctl-select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {PROBE_TARGETS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <button type="button" className="rst-run" disabled={!ready || loading} onClick={() => run({ ...payload, targetPath: target })}>
        {loading ? 'Probing…' : 'Send request'}
      </button>
      <ErrorLine error={error} status={status} />
      {result && result.error && <div className="rst-error">⚠ {result.message}</div>}
      {result && !result.error && (
        <div className="rst-result">
          <div className={`rst-verdict ${result.status < 400 ? 'permit' : 'reject'}`}>
            HTTP {result.status} {result.statusText}
          </div>
          {(result.status === 401 || result.status === 403) && (
            <div className="rst-signin-row">
              <span>This token was rejected — sign in to retry with a fresh session token.</span>
              <SignInButton />
            </div>
          )}
          <pre className="rst-json jh-dark"><JsonHighlight value={result.body} /></pre>
        </div>
      )}
    </Collapsible>
  );
}

// Shows the actual JWT under test plus its decoded claims, so the user can see exactly
// which token they are submitting (raw token is intentionally surfaced on this page).
function RevealPanel({ payload, ready, endpointBase }) {
  const { loading, result, error, status, run } = useRunner(`${endpointBase}/reveal`);
  return (
    <Collapsible title="🔑 The token under test — raw JWT + claims">
      <p className="rst-mode-desc">
        Reveals the exact JWT being submitted and its decoded claims, so you can see which
        token this resource server is evaluating before running a check.
      </p>
      <button type="button" className="rst-run" disabled={!ready || loading} onClick={() => run(payload)}>
        {loading ? 'Loading…' : 'Show this token'}
      </button>
      <ErrorLine error={error} status={status} />
      {result && result.error && <div className="rst-error">⚠ {result.message}</div>}
      {result && !result.error && (
        <div className="rst-result">
          <div className="rst-raw-label">Raw JWT</div>
          <pre className="rst-raw-token">{result.token}</pre>
          <ClaimsDetails claims={result.claims} />
        </div>
      )}
    </Collapsible>
  );
}

// Default token sources for the user (OIDC) resource server page.
const DEFAULT_SOURCES = [
  { value: 'access', label: 'My access token' },
  { value: 'id', label: 'My ID token' },
  { value: 'paste', label: 'Paste a JWT' },
];

export default function ResourceServerTester({
  endpointBase = '/api/resource-server/test',
  sources = DEFAULT_SOURCES,
  intro = 'Submit a token and see how this resource server would treat it. Pick one by reference, or paste any JWT to test a failure case.',
}) {
  const [source, setSource] = useState(sources[0].value);
  const [pasted, setPasted] = useState('');
  // Unique radio-group name per instance, so two testers on one page don't share a group.
  const radioGroup = `rst-src-${endpointBase}`;
  // Human label for the token currently selected — always shown so it's obvious which
  // token the resource server is being asked to evaluate (driven by the sources list).
  const activeLabel = sources.find((s) => s.value === source)?.label;

  const payload = source === 'paste' ? { tokenRaw: pasted } : { tokenRef: source };
  const ready = source === 'paste' ? pasted.trim().length > 0 : true;

  return (
    <Collapsible title="🧪 Test this Resource Server">
      <p className="rst-intro">{intro}</p>

      <div className="rst-source">
        <span className="rst-source-label">Token under test</span>
        <div className="rst-source-controls">
          {sources.map((s) => (
            <label key={s.value}>
              <input type="radio" name={radioGroup} checked={source === s.value} onChange={() => setSource(s.value)} /> {s.label}
            </label>
          ))}
        </div>
        <div className="rst-active-token">Using: <strong>{activeLabel}</strong></div>
        {source === 'paste' && (
          <textarea
            className="rst-paste"
            placeholder="eyJ…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
          />
        )}
      </div>

      <RevealPanel payload={payload} ready={ready} endpointBase={endpointBase} />

      <PolicyPanel
        title="Real RS validation — signature + claims"
        desc="Verifies the JWT signature against PingOne's JWKS, then checks audience, expiry and scope — exactly what a real resource server enforces."
        endpoint={`${endpointBase}/validate`}
        runLabel="Run validation"
        loadingLabel="Validating…"
        payload={payload}
        ready={ready}
      />
      <PolicyPanel
        title="Decode + policy check — no signature"
        desc="Decodes the token without verifying its signature and shows whether its audience, expiry and scope would pass this resource server's policy."
        endpoint={`${endpointBase}/decode`}
        runLabel="Run decode + policy"
        loadingLabel="Checking…"
        payload={payload}
        ready={ready}
      />
      <ProbePanel payload={payload} ready={ready} endpointBase={endpointBase} />
    </Collapsible>
  );
}
