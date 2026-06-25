import React, { useState } from 'react';
import './SnapshotImport.css';

interface ValidationReport {
  valid: boolean;
  summary: {
    policies: number;
    conditions: number;
    statements: number;
    rules: number;
  };
  conflicts: Array<{
    type: string;
    snapshot?: string[];
    sot?: string[];
    statement?: string;
    message?: string;
  }>;
}

export default function SnapshotImport() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) {
      setError('No file selected');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('snapshot', file);

      const res = await fetch('http://localhost:9001/admin/import-snapshot', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
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
        <input
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          disabled={loading}
          placeholder="Select snapshot.json"
        />
        <button onClick={handleImport} disabled={!file || loading}>
          {loading ? 'Validating...' : 'Validate Snapshot'}
        </button>
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

          {result.conflicts.length > 0 && (
            <div className="conflicts">
              <h4>Conflicts ({result.conflicts.length})</h4>
              <ul>
                {result.conflicts.map((c, i) => (
                  <li key={i}>
                    <strong>{c.type}</strong>
                    {c.message && `: ${c.message}`}
                    {c.snapshot && (
                      <div className="conflict-detail">
                        Snapshot: {c.snapshot.join(', ')}
                      </div>
                    )}
                    {c.sot && (
                      <div className="conflict-detail">
                        Expected: {c.sot.join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.valid && (
            <p className="success-msg">
              Snapshot is ready to import to PingOne Authorize.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
