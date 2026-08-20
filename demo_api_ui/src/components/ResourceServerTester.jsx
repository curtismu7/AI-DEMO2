// demo_api_ui/src/components/ResourceServerTester.jsx
// Dark IDE three-column layout (Mock B) - interactive tester for the OIDC Resource Server.
// Lets a logged-in user submit a token (session token by reference, or pasted JWT)
// and see how this resource server would treat it through four operations:
//   1. Show Token        - reveals raw JWT + decoded claims
//   2. Real RS Validation - signature + aud/exp/nbf/scope check -> PERMIT/REJECT
//   3. Decode + Policy   - no-signature decode + policy check -> WOULD_PASS/WOULD_REJECT
//   4. Live Request Probe - real HTTP call to a protected endpoint -> actual status/body
import React, { useState, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorListItem from './shared/InspectorListItem';
import InspectorTabs from './shared/InspectorTabs';
import { notifySessionExpiredIfNeeded, navigateToCustomerOAuthLogin } from '../utils/authUi';
import './ResourceServerTester.css';

const DEFAULT_PROBE_TARGETS = ['/api/resource-server/accounts', '/api/resource-server/transactions'];

// Default token sources for the user (OIDC) login resource server tab.
const DEFAULT_SOURCES = [
  { value: 'access', label: 'My access token' },
  { value: 'id', label: 'My ID token' },
  { value: 'paste', label: 'Paste a JWT' },
];

export const INFLOW_SOURCES = [
  { value: 'mcp', label: 'In-flow MCP / gateway TX' },
  { value: 'access', label: 'My access token (login)' },
  { value: 'paste', label: 'Paste a JWT' },
];

export const CLIENT_CREDENTIALS_SOURCES = [
  { value: 'cc', label: 'Fetch server-side Client Credentials token', ready: true, detail: 'Machine identity; no user context' },
  { value: 'paste', label: 'Paste a JWT', ready: false, detail: 'Supply a token to inspect' },
];

export const INFLOW_PROBE_TARGETS = [
  '/api/resource-server/identity',
  '/api/resource-server/accounts',
  '/api/resource-server/transactions',
];

// The four operations available as tree items.
const OPERATIONS = [
  {
    id: 'reveal',
    name: 'Show Token',
    desc: 'Reveals the exact JWT being submitted and its decoded claims, so you can see which token this resource server is evaluating before running a check.',
    dot: 'default',
  },
  {
    id: 'validate',
    name: 'Real RS Validation',
    desc: 'Verifies the JWT signature against PingOne JWKS, then checks audience, expiry and scope - exactly what a real resource server enforces.',
    dot: 'write',
  },
  {
    id: 'decode',
    name: 'Decode + Policy',
    desc: 'Decodes the token without verifying its signature and shows whether its audience, expiry and scope would pass this resource server policy.',
    dot: 'default',
  },
  {
    id: 'probe',
    name: 'Live Request Probe',
    desc: 'Sends a real request to a protected endpoint with this token as the bearer, and shows the actual response - including a 401/403 rejection.',
    dot: 'sensitive',
  },
];

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

/** Merge profile into every tester POST so validate/decode use the correct RS audience. */
function withProfile(body, profile) {
  return profile && profile !== 'login' ? { ...body, profile } : body;
}

const VERDICT_TEXT = { PERMIT: 'PERMIT', WOULD_PASS: 'WOULD PASS', WOULD_REJECT: 'WOULD REJECT' };

function RuleList({ rules }) {
  if (!rules || rules.length === 0) return null;
  return (
    <ul className="rst-rules">
      {rules.map((r) => (
        <li key={r.name} className={r.pass ? 'pass' : 'fail'}>
          <span className="rst-rule-icon">{r.pass ? '\u2705' : '\u274C'}</span>
          <span className="rst-rule-name">{r.name}</span>
          <span className="rst-rule-detail">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function SignInButton({ label = 'Sign in' }) {
  return (
    <button type="button" className="rst-signin" onClick={navigateToCustomerOAuthLogin}>
      {label}
    </button>
  );
}

function ErrorLine({ error, status }) {
  if (!error) return null;
  return (
    <div className="rst-error">
      <span>{'\u26A0'} {error}</span>
      {status === 401 && <SignInButton />}
    </div>
  );
}

export default function ResourceServerTester({
  endpointBase = '/api/resource-server/test',
  sources = DEFAULT_SOURCES,
  probeTargets = DEFAULT_PROBE_TARGETS,
  profile = 'login',
  intro = 'Submit a token and see how this resource server would treat it. Pick one by reference, or paste any JWT to test a failure case.',
}) {
  // Token source state
  const [source, setSource] = useState(sources[0].value);
  const [pasted, setPasted] = useState('');

  // Operation tree state
  const [selectedOp, setSelectedOp] = useState(OPERATIONS[0]);
  const [outputTab, setOutputTab] = useState('result');

  // Probe target
  const [probeTarget, setProbeTarget] = useState(probeTargets[0]);

  // Runners for each operation type
  const revealRunner = useRunner(`${endpointBase}/reveal`);
  const validateRunner = useRunner(`${endpointBase}/validate`);
  const decodeRunner = useRunner(`${endpointBase}/decode`);
  const probeRunner = useRunner(`${endpointBase}/probe`);

  const getRunner = (opId) => {
    switch (opId) {
      case 'reveal': return revealRunner;
      case 'validate': return validateRunner;
      case 'decode': return decodeRunner;
      case 'probe': return probeRunner;
      default: return null;
    }
  };

  const payload = source === 'paste' ? { tokenRaw: pasted } : { tokenRef: source };
  const ready = source === 'paste' ? pasted.trim().length > 0 : true;

  const activeLabel = sources.find((s) => s.value === source)?.label || source;
  const activeSource = sources.find((s) => s.value === source);

  const selectOp = (op) => {
    setSelectedOp(op);
    setOutputTab('result');
  };

  const executeOp = useCallback(async () => {
    if (!selectedOp) return;
    const runner = getRunner(selectedOp.id);
    if (!runner) return;
    const body = selectedOp.id === 'probe'
      ? withProfile({ ...payload, targetPath: probeTarget }, profile)
      : withProfile(payload, profile);
    await runner.run(body);
  }, [selectedOp, payload, probeTarget, profile]);

  const clearOutput = () => {
    // Reset all runners by re-creating the component state - we reset via deselect + reselect
    setSelectedOp(null);
    setOutputTab('result');
    // Also reset the paste field if source is paste
    if (source === 'paste') setPasted('');
  };

  const currentRunner = selectedOp ? getRunner(selectedOp.id) : null;

  // Build output content for the tabs
  const renderResultTab = () => {
    if (!currentRunner || !currentRunner.result) return null;
    const result = currentRunner.result;

    if (selectedOp.id === 'reveal') {
      return (
        <div>
          <div className="rst-raw-label">Raw JWT</div>
          <pre className="rst-raw-token">{result.token}</pre>
          {result.claims && (
            <div style={{ marginTop: 14 }}>
              <div className="rst-raw-label">Decoded Claims</div>
              <pre className="inspector-shell-output-code" style={{ marginTop: 6 }}>
                <JsonHighlight value={result.claims} />
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (selectedOp.id === 'validate' || selectedOp.id === 'decode') {
      const isPass = ['PERMIT', 'WOULD_PASS'].includes(result.decision);
      return (
        <div>
          <div className={`rst-verdict ${isPass ? 'permit' : 'reject'}`}>
            {VERDICT_TEXT[result.decision] || result.decision}
          </div>
          {result.method === 'introspection' && (
            <div className="rst-note">Opaque (non-JWT) token - read via RFC 7662 token introspection instead of decoding.</div>
          )}
          <RuleList rules={result.rules} />
          {result.claims && (
            <div style={{ marginTop: 14 }}>
              <pre className="inspector-shell-output-code">
                <JsonHighlight value={result.claims} />
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (selectedOp.id === 'probe') {
      if (result.error) {
        return <div className="rst-error">{'\u26A0'} {result.message}</div>;
      }
      return (
        <div>
          <div className={`rst-verdict ${result.status < 400 ? 'permit' : 'reject'}`}>
            HTTP {result.status} {result.statusText}
          </div>
          {(result.status === 401 || result.status === 403) && (
            <div className="rst-signin-row">
              <span>This token was rejected - sign in to retry with a fresh session token.</span>
              <SignInButton />
            </div>
          )}
          <pre className="inspector-shell-output-code" style={{ marginTop: 14 }}>
            <JsonHighlight value={result.body} />
          </pre>
        </div>
      );
    }

    return null;
  };

  const renderClaimsTab = () => {
    if (!currentRunner || !currentRunner.result) return null;
    const result = currentRunner.result;
    const claims = result.claims || result.body;
    if (!claims) return <div style={{ color: '#64748b', fontSize: 13 }}>No claims data available for this operation.</div>;
    return (
      <pre className="inspector-shell-output-code">
        <JsonHighlight value={claims} />
      </pre>
    );
  };

  const renderRawTab = () => {
    if (!currentRunner || !currentRunner.result) return null;
    const result = currentRunner.result;
    // Show the full raw response JSON
    return (
      <pre className="inspector-shell-output-code">
        <JsonHighlight value={result} deep />
      </pre>
    );
  };

  const left = (
    <>
      <div className="inspector-shell-tree-header">
        <span>Operations</span>
      </div>
      <div className="rst-start-here"><strong>Start here:</strong> choose a token source, then run the selected first operation, <em>Show Token</em>. The evidence panel explains the request and decision.</div>
      <div className="inspector-shell-tree-body">
        <div className="inspector-shell-tree-group__label">Test Operations</div>
        {OPERATIONS.map((op) => (
          <InspectorListItem
            key={op.id}
            label={op.name}
            active={selectedOp?.id === op.id}
            dot={op.dot}
            onClick={() => selectOp(op)}
          />
        ))}
        <div className="inspector-shell-tree-group__label" style={{ marginTop: 16 }}>
          Token Source
        </div>
        {sources.map((s) => (
          <InspectorListItem
            key={s.value}
            label={`${s.label} — ${s.ready === false ? 'enter token' : 'ready'}`}
            active={source === s.value}
            onClick={() => setSource(s.value)}
          />
        ))}
      </div>
      {/* Tree footer: intro text (no shell footer class — page-owned, as in McpInspectorPage) */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #cbd5e1', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
        {intro}
      </div>
    </>
  );

  const executeButtons = (
    <>
      <button
        className="inspector-shell-btn-call"
        onClick={executeOp}
        disabled={!ready || (currentRunner && currentRunner.loading)}
      >
        {currentRunner && currentRunner.loading ? 'Running...' : 'Execute'}
      </button>
      <button className="inspector-shell-btn-clear" onClick={clearOutput}>Clear</button>
    </>
  );

  const middle = selectedOp ? (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">{selectedOp.name}</div>
        <div className="inspector-shell-form-header__desc">{selectedOp.desc}</div>
      </div>
      <div className="rst-context-strip">
        <span><strong>Selected token:</strong> {activeLabel}</span>
        <span><strong>Target audience:</strong> {profile === 'login' ? 'OIDC user resource server' : profile}</span>
      </div>
      <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
        {executeButtons}
      </div>
      <div className="inspector-shell-form-body">
        {/* Token source display */}
        <div className="inspector-shell-field">
          <label>Token Source</label>
          <input type="text" value={activeLabel} readOnly />
        </div>
        {source === 'access' || source === 'id' ? (
          <div className="rst-source-help">Customer sign-in is required for user tokens. Sign in to obtain a fresh session token, then run the operation.</div>
        ) : null}
        {activeSource?.detail && <div className="rst-source-help">{activeSource.detail}</div>}

        {/* Paste JWT textarea if that source is selected */}
        {source === 'paste' && (
          <div className="inspector-shell-field">
            <label>
              JWT
              <span className="req"> *</span>
              <span className="type">string</span>
            </label>
            <textarea
              placeholder="eyJ..."
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
            />
          </div>
        )}

        {/* Probe target selection */}
        {selectedOp.id === 'probe' && (
          <div className="inspector-shell-field">
            <label>
              Target Endpoint
              <span className="req"> *</span>
              <span className="type">select</span>
            </label>
            <select
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 13,
                fontFamily: "'SF Mono', monospace",
                background: '#ffffff',
                border: '1px solid #94a3b8',
                borderRadius: 4,
                color: '#1e293b',
              }}
              value={probeTarget}
              onChange={(e) => setProbeTarget(e.target.value)}
            >
              {probeTargets.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* Ready indicator */}
        {!ready && (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>
            Paste a JWT token above to enable execution.
          </div>
        )}
      </div>
      <div className="inspector-shell-form-actions">
        {executeButtons}
        {currentRunner && currentRunner.error && (
          <span className="inspector-shell-form-error">Error</span>
        )}
      </div>
    </>
  ) : (
    <div className="inspector-shell-form-empty">
      Select an operation from the tree to inspect and execute it.
    </div>
  );

  const right = (
    <>
      <InspectorTabs
        tabs={[
          { key: 'result', label: 'Result' },
          { key: 'claims', label: 'Claims' },
          { key: 'raw', label: 'Raw Response' },
        ]}
        activeKey={outputTab}
        onChange={setOutputTab}
      />
      {currentRunner && (currentRunner.result || currentRunner.error) ? (
        <>
          <div className="inspector-shell-output-body">
            {currentRunner.error && (
              <ErrorLine error={currentRunner.error} status={currentRunner.status} />
            )}
            {currentRunner.result && outputTab === 'result' && renderResultTab()}
            {currentRunner.result && outputTab === 'claims' && renderClaimsTab()}
            {currentRunner.result && outputTab === 'raw' && renderRawTab()}
          </div>
          <div className="inspector-shell-output-footer">
            <span><strong>Status:</strong> {currentRunner.error ? `Error${currentRunner.status ? ` (${currentRunner.status})` : ''}` : 'OK'}</span>
            <span><strong>Operation:</strong> {selectedOp?.name || '-'}</span>
            <span><strong>Token:</strong> {activeLabel}</span>
          </div>
        </>
      ) : (
        <div className="inspector-shell-output-empty">
          {selectedOp ? 'Click Execute to run the operation and see results here.' : 'Select an operation and execute it to see results.'}
        </div>
      )}
      <div className="rst-education">
        <div><strong>OIDC user delegation</strong><span>User tokens carry <code>sub</code> and may carry <code>act</code>, making the user and delegation chain auditable.</span></div>
        <div><strong>Client Credentials</strong><span>Machine-to-machine by design: no user context. An empty <code>sub</code>/<code>act</code> is a successful teaching result, not a broken token.</span></div>
      </div>
    </>
  );

  return (
    <InspectorShell
      title="Resource Server Tester"
      statusText={`Token: ${activeLabel}`}
      actions={
        <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
          {OPERATIONS.length} operations
        </span>
      }
      left={left}
      middle={middle}
      right={right}
    />
  );
}
