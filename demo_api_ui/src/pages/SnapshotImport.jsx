import React, { useState } from 'react';
import './SnapshotImport.css';

// Same pattern as the sibling admin pages (AuthorizeConfigPage, McpGatewayConfig):
// env-configured base, empty default so requests stay same-origin and resolve
// through the dev/prod proxy. It must not be a hardcoded host — REGRESSION_PLAN §3
// makes api.ping.demo canonical and forbids baked-in hosts/ports, and the previous
// literal ('http://localhost:9001') could not work anyway: this UI is served over
// HTTPS, so a plain-http request to it is blocked as mixed content.
const AUTHZ_BASE = process.env.REACT_APP_AUTHZ_BASE || '';

function ConflictDiff({ conflict }) {
  if (conflict.type === 'consent_tool_mismatch' || conflict.type === 'step_up_tool_mismatch') {
    const snap = new Set(conflict.snapshot || []);
    const sot = new Set(conflict.sot || []);
    const missing = (conflict.sot || []).filter(t => !snap.has(t));
    const extra = (conflict.snapshot || []).filter(t => !sot.has(t));
    return (
      <li className="conflict-item">
        <strong className="conflict-type">{conflict.type}</strong>
        <div className="conflict-diff">
          {missing.length > 0 && (
            <div className="diff-block diff-missing">
              <span className="diff-label">Missing from snapshot:</span>
              {missing.map(t => <span key={t} className="diff-tag diff-tag-missing">{t}</span>)}
            </div>
          )}
          {extra.length > 0 && (
            <div className="diff-block diff-extra">
              <span className="diff-label">Extra in snapshot (not in SoT):</span>
              {extra.map(t => <span key={t} className="diff-tag diff-tag-extra">{t}</span>)}
            </div>
          )}
          <div className="diff-block diff-expected">
            <span className="diff-label">Expected ({(conflict.sot || []).length} tools):</span>
            <span className="diff-tools">{(conflict.sot || []).join(', ')}</span>
          </div>
        </div>
        <div className="conflict-fix">
          Import the correct snapshot below to fix this.
        </div>
      </li>
    );
  }
  return (
    <li className="conflict-item">
      <strong className="conflict-type">{conflict.type}</strong>
      {conflict.message && <span>: {conflict.message}</span>}
      {conflict.statement && <div className="conflict-detail">Statement: {conflict.statement}</div>}
    </li>
  );
}

export default function SnapshotImport() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) { setError('No file selected'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('snapshot', file);
      const res = await fetch(`${AUTHZ_BASE}/admin/import-snapshot`, { method: 'POST', body: formData });
      // 409 means the snapshot was rejected for parity conflicts — the body is a
      // full conflict report, so render it instead of collapsing it to a status code.
      if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="snapshot-import">
      <h2>P1AZ Snapshot Import & Validation</h2>
      <p className="description">
        Validate that a PingOne Authorize snapshot matches the mock authz server policies.
        This ensures P1AZ and demo-authz-server stay synchronized.
      </p>

      <div className="upload-section">
        <input type="file" accept=".json" onChange={handleFileSelect} disabled={loading} />
        <button onClick={handleImport} disabled={!file || loading}>
          {loading ? 'Validating...' : 'Validate Snapshot'}
        </button>
      </div>

      <div className="download-section">
        <span className="download-label">Current correct snapshot (SoT-generated):</span>
        <a
          className="download-btn"
          href={`${AUTHZ_BASE}/admin/current-snapshot`}
          download="Super_Banking_Transaction_Authorization_P1AZ.snapshot.json"
        >
          Download for P1AZ import
        </a>
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className={`result ${result.valid ? 'valid' : 'invalid'}`}>
          <h3>{result.valid ? '✅ Valid' : '❌ Invalid'}</h3>

          <div className="summary">
            <h4>Summary</h4>
            <ul>
              <li>Policies: {result.summary.policies}</li>
              <li>Conditions: {result.summary.conditions}</li>
              <li>Statements: {result.summary.statements}</li>
              <li>Rules: {result.summary.rules}</li>
            </ul>
          </div>

          {result.conflicts && result.conflicts.length > 0 && (
            <div className="conflicts">
              <h4>Conflicts ({result.conflicts.length})</h4>
              <ul>
                {result.conflicts.map((c, i) => <ConflictDiff key={i} conflict={c} />)}
              </ul>
              <div className="fix-callout">
                <strong>Fix:</strong> Download the correct snapshot above and import it into PingOne Authorize.
              </div>
            </div>
          )}

          {result.valid && (
            <p className="success-msg">Snapshot is in sync. No action needed.</p>
          )}
        </div>
      )}
    </div>
  );
}
