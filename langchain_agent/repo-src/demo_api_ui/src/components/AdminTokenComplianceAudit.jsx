import React, { useState, useCallback } from 'react';

/**
 * AdminTokenComplianceAudit — RFC 8693 token compliance audit page.
 * Fetches validation report from /api/admin/token-compliance and displays results.
 */
export default function AdminTokenComplianceAudit() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/token-compliance', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const statusIcon = (status) => {
    if (status === 'pass') return '✅';
    if (status === 'fail') return '❌';
    return '⚠️';
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Token Compliance Audit</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        RFC 8693 structural validation of the current session's tokens.
        See <code>docs/RFC8693_MCP_VALIDATION_MATRIX.md</code> for full requirements.
      </p>

      <button
        onClick={runAudit}
        disabled={loading}
        style={{
          padding: '0.6rem 1.5rem',
          fontSize: '1rem',
          background: '#1a73e8',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: loading ? 'wait' : 'pointer',
          marginBottom: '1.5rem',
        }}
      >
        {loading ? 'Auditing…' : report ? 'Re-Audit' : 'Run Audit'}
      </button>

      {error && (
        <div style={{ background: '#fce4ec', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {report && (
        <>
          <div style={{
            padding: '1rem',
            borderRadius: 8,
            marginBottom: '1.5rem',
            background: report.compliant ? '#e8f5e9' : '#fff3e0',
            border: `1px solid ${report.compliant ? '#4caf50' : '#ff9800'}`,
          }}>
            <strong>{report.compliant ? '✅ Compliant' : '⚠️ Non-Compliant'}</strong>
            <span style={{ marginLeft: '1rem', color: '#666', fontSize: '0.9rem' }}>
              {report.timestamp}
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Check</th>
                <th style={{ padding: '0.5rem' }}>RFC</th>
                <th style={{ padding: '0.5rem' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((check, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.5rem', textAlign: 'center' }}>{statusIcon(check.status)}</td>
                  <td style={{ padding: '0.5rem', fontWeight: 500 }}>{check.name}</td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{check.rfc}</td>
                  <td style={{ padding: '0.5rem', fontSize: '0.9rem', color: '#555' }}>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `token-compliance-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              marginTop: '1rem',
              padding: '0.4rem 1rem',
              fontSize: '0.9rem',
              background: '#f5f5f5',
              border: '1px solid #ccc',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Export as JSON
          </button>
        </>
      )}
    </div>
  );
}
