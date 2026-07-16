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
import { notifySessionExpiredIfNeeded, navigateToCustomerOAuthLogin } from '../utils/authUi';
import './PingOneMcpInspector.css';
import './ResourceServerTester.css';

const PROBE_TARGETS = ['/api/resource-server/accounts', '/api/resource-server/transactions'];

// Default token sources for the user (OIDC) resource server page.
const DEFAULT_SOURCES = [
  { value: 'access', label: 'My access token' },
  { value: 'id', label: 'My ID token' },
  { value: 'paste', label: 'Paste a JWT' },
];

// The four operations available as tree items.
const OPERATIONS = [
  {
    id: 'reveal',
    name: 'Show Token',
    desc: 'Reveals the exact JWT being submitted and its decoded claims, so you can see which token this resource server is evaluating before running a check.',
    dotClass: '',
  },
  {
    id: 'validate',
    name: 'Real RS Validation',
    desc: 'Verifies the JWT signature against PingOne JWKS, then checks audience, expiry and scope - exactly what a real resource server enforces.',
    dotClass: 'p1mcp-tree-item__dot--write',
  },
  {
    id: 'decode',
    name: 'Decode + Policy',
    desc: 'Decodes the token without verifying its signature and shows whether its audience, expiry and scope would pass this resource server policy.',
    dotClass: '',
  },
  {
    id: 'probe',
    name: 'Live Request Probe',
    desc: 'Sends a real request to a protected endpoint with this token as the bearer, and shows the actual response - including a 401/403 rejection.',
    dotClass: 'p1mcp-tree-item__dot--sensitive',
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
  intro = 'Submit a token and see how this resource server would treat it. Pick one by reference, or paste any JWT to test a failure case.',
}) {
  // Token source state
  const [source, setSource] = useState(sources[0].value);
  const [pasted, setPasted] = useState('');

  // Operation tree state
  const [selectedOp, setSelectedOp] = useState(null);
  const [outputTab, setOutputTab] = useState('result');

  // Probe target
  const [probeTarget, setProbeTarget] = useState(PROBE_TARGETS[0]);

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

  const selectOp = (op) => {
    setSelectedOp(op);
    setOutputTab('result');
  };

  const executeOp = useCallback(async () => {
    if (!selectedOp) return;
    const runner = getRunner(selectedOp.id);
    if (!runner) return;
    const body = selectedOp.id === 'probe' ? { ...payload, targetPath: probeTarget } : payload;
    await runner.run(body);
  }, [selectedOp, payload, probeTarget]);

  const clearOutput = () => {
    if (!selectedOp) return;
    const runner = getRunner(selectedOp.id);
    if (runner) {
      // Reset runner state by re-rendering - but we cannot reset hooks directly,
      // so we just deselect and reselect
    }
    // Clear by deselecting
    setSelectedOp(null);
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
              <pre className="p1mcp-output-code" style={{ marginTop: 6 }}>
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
              <pre className="p1mcp-output-code">
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
          <pre className="p1mcp-output-code" style={{ marginTop: 14 }}>
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
      <pre className="p1mcp-output-code">
        <JsonHighlight value={claims} />
      </pre>
    );
  };

  const renderRawTab = () => {
    if (!currentRunner || !currentRunner.result) return null;
    const result = currentRunner.result;
    // Show the full raw response JSON
    return (
      <pre className="p1mcp-output-code">
        <JsonHighlight value={result} deep />
      </pre>
    );
  };

  return (
    <div className="p1mcp-page">
      {/* Top bar */}
      <div className="p1mcp-topbar">
        <span className="p1mcp-topbar__dot" />
        <h1>Resource Server Tester</h1>
        <span className="p1mcp-topbar__status">
          Token: {activeLabel}
        </span>
        <div className="p1mcp-topbar__right">
          <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
            {OPERATIONS.length} operations
          </span>
        </div>
      </div>

      {/* Three-column grid */}
      <div className="p1mcp-grid">
        {/* Column 1: Tree */}
        <div className="p1mcp-col-tree">
          <div className="p1mcp-tree-header">
            <span>Operations</span>
          </div>
          <div className="p1mcp-tree-body">
            {/* Operations group */}
            <div className="p1mcp-tree-group">
              <div className="p1mcp-tree-group__label">Test Operations</div>
              {OPERATIONS.map((op) => (
                <div
                  key={op.id}
                  className={`p1mcp-tree-item ${selectedOp?.id === op.id ? 'p1mcp-tree-item--active' : ''}`}
                  onClick={() => selectOp(op)}
                >
                  <span className={`p1mcp-tree-item__dot ${op.dotClass}`} />
                  <span>{op.name}</span>
                </div>
              ))}
            </div>

            {/* Token source group */}
            <div className="p1mcp-tree-group" style={{ marginTop: 16 }}>
              <div className="p1mcp-tree-group__label">Token Source</div>
              {sources.map((s) => (
                <div
                  key={s.value}
                  className={`p1mcp-tree-item ${source === s.value ? 'p1mcp-tree-item--active' : ''}`}
                  onClick={() => setSource(s.value)}
                >
                  <span className="p1mcp-tree-item__dot" style={{ background: source === s.value ? '#22c55e' : '#475569' }} />
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tree footer: intro text */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
            {intro}
          </div>
        </div>

        {/* Column 2: Form */}
        <div className="p1mcp-col-form">
          {selectedOp ? (
            <>
              <div className="p1mcp-form-header">
                <div className="p1mcp-form-header__name">{selectedOp.name}</div>
                <div className="p1mcp-form-header__desc">{selectedOp.desc}</div>
              </div>
              <div className="p1mcp-form-body">
                {/* Token source display */}
                <div className="p1mcp-field">
                  <label>Token Source</label>
                  <input type="text" value={activeLabel} readOnly />
                </div>

                {/* Paste JWT textarea if that source is selected */}
                {source === 'paste' && (
                  <div className="p1mcp-field">
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
                  <div className="p1mcp-field">
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
                        background: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: 4,
                        color: '#e2e8f0',
                      }}
                      value={probeTarget}
                      onChange={(e) => setProbeTarget(e.target.value)}
                    >
                      {PROBE_TARGETS.map((t) => (
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
              <div className="p1mcp-form-actions">
                <button
                  className="p1mcp-btn-call"
                  onClick={executeOp}
                  disabled={!ready || (currentRunner && currentRunner.loading)}
                >
                  {currentRunner && currentRunner.loading ? 'Running...' : 'Execute'}
                </button>
                <button className="p1mcp-btn-clear" onClick={clearOutput}>Clear</button>
                {currentRunner && currentRunner.error && (
                  <span className="p1mcp-form-error">Error</span>
                )}
              </div>
            </>
          ) : (
            <div className="p1mcp-form-empty">
              Select an operation from the tree to inspect and execute it.
            </div>
          )}
        </div>

        {/* Column 3: Output */}
        <div className="p1mcp-col-output">
          <div className="p1mcp-output-tabs">
            <button
              className={`p1mcp-output-tab ${outputTab === 'result' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('result')}
            >Result</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'claims' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('claims')}
            >Claims</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'raw' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('raw')}
            >Raw Response</button>
          </div>
          {currentRunner && (currentRunner.result || currentRunner.error) ? (
            <>
              <div className="p1mcp-output-body">
                {currentRunner.error && (
                  <ErrorLine error={currentRunner.error} status={currentRunner.status} />
                )}
                {currentRunner.result && outputTab === 'result' && renderResultTab()}
                {currentRunner.result && outputTab === 'claims' && renderClaimsTab()}
                {currentRunner.result && outputTab === 'raw' && renderRawTab()}
              </div>
              <div className="p1mcp-output-footer">
                <span><strong>Status:</strong> {currentRunner.error ? `Error${currentRunner.status ? ` (${currentRunner.status})` : ''}` : 'OK'}</span>
                <span><strong>Operation:</strong> {selectedOp?.name || '-'}</span>
                <span><strong>Token:</strong> {activeLabel}</span>
              </div>
            </>
          ) : (
            <div className="p1mcp-output-empty">
              {selectedOp ? 'Click Execute to run the operation and see results here.' : 'Select an operation and execute it to see results.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
