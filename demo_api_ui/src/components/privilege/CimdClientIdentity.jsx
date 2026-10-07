// CimdClientIdentity.jsx — how the Privilege MCP client identifies itself at the next sign-in.
// "Dynamic registration" registers with the gateway (RFC 7591, the default). "Client document (CIMD)" sends
// the URL of our client document as the client_id, so nothing is registered. The readiness check reports,
// per rule, whether the gateway and our document are set up for that. Layout uses the page's cur-* classes;
// the results table has its own stylesheet (dark default, light override), like ToolsTable.
import { useEffect, useState } from 'react';
import apiClient from '../../services/apiClient';
import './CimdClientIdentity.css';

const BASE = '/api/privilege-mcp';

export const IDENTITY_MODES = [
  { value: 'dcr', label: 'Dynamic registration (default)' },
  { value: 'cimd', label: 'Client document (CIMD)' },
];

export default function CimdClientIdentity() {
  const [mode, setMode] = useState('dcr');
  const [error, setError] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    apiClient
      .get(`${BASE}/state`)
      .then((res) => {
        if (live && res.data && res.data.clientIdentity) setMode(res.data.clientIdentity);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const choose = async (next) => {
    setError('');
    try {
      const res = await apiClient.post(`${BASE}/client-identity`, { mode: next });
      setMode(res.data.clientIdentity);
    } catch {
      setError('Could not change the client identity.');
    }
  };

  const check = async () => {
    setError('');
    setChecking(true);
    try {
      const res = await apiClient.get('/api/cimd/privilege/check');
      setReadiness(res.data);
    } catch {
      setReadiness(null);
      setError('Could not run the readiness check.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="cur-settings-section" data-testid="cimd-client-identity">
      <h4 className="cur-settings-section-title">Client identity</h4>
      <label className="cur-field">
        <span className="cur-field-label">Identify to the gateway by</span>
        <select className="cur-input" value={mode} onChange={(e) => choose(e.target.value)} data-testid="cimd-identity-select">
          {IDENTITY_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {mode === 'cimd' ? (
        <p className="cur-denial-note">
          The client_id will be the URL of our client document. Nothing is registered, and the token request carries
          no secret. Takes effect at the next Sign in.
        </p>
      ) : (
        <p className="cur-denial-note">The client registers with the gateway when you sign in.</p>
      )}
      <button type="button" className="cur-btn" onClick={check} disabled={checking} data-testid="cimd-check">
        {checking ? 'Checking…' : 'Check CIMD readiness'}
      </button>
      {error && (
        <p className="cur-denial-note" role="alert">
          {error}
        </p>
      )}
      {readiness && (
        <div className="cimd-ci-results">
          <div className={`cimd-ci-verdict ${readiness.ok ? 'cimd-ci-verdict--ok' : 'cimd-ci-verdict--bad'}`} data-testid="cimd-ci-verdict">
            <span className={`cimd-ci-mark ${readiness.ok ? 'cimd-ci-mark--pass' : 'cimd-ci-mark--fail'}`} aria-hidden="true">
              {readiness.ok ? '✓' : '✕'}
            </span>
            {readiness.ok ? 'Ready for a client document sign-in.' : 'Not ready yet.'}
          </div>
          <table className="cimd-ci-checks" data-testid="cimd-ci-checks" aria-label="CIMD readiness checks">
            <thead>
              <tr>
                <th scope="col" className="cimd-ci-col-result">
                  Result
                </th>
                <th scope="col" className="cimd-ci-col-check">
                  Check
                </th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {readiness.checks.map((c) => (
                <tr key={c.id}>
                  <td className="cimd-ci-col-result">
                    <span className={`cimd-ci-mark ${c.pass ? 'cimd-ci-mark--pass' : 'cimd-ci-mark--fail'}`} role="img" aria-label={c.pass ? 'Passed' : 'Failed'}>
                      {c.pass ? '✓' : '✕'}
                    </span>
                  </td>
                  <td className="cimd-ci-col-check">{c.label}</td>
                  <td>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {readiness.targets && readiness.targets.documentUrl && <p className="cimd-ci-docurl">Document: {readiness.targets.documentUrl}</p>}
        </div>
      )}
    </div>
  );
}
