import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchMcpDiscoveryInventory, requestMcpDiscoveryScan } from '../services/mcpDiscoveryService';
import './McpDiscoveryPage.css';

const STATUS_ORDER = ['healthy', 'degraded', 'offline', 'candidate', 'unprobed'];

function statusLabel(status) {
  return String(status || 'unprobed').replace(/-/g, ' ');
}

function formatTime(value) {
  if (!value) return 'Not yet scanned';
  return new Date(value).toLocaleTimeString();
}

export default function McpDiscoveryPage() {
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanMessage, setScanMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInventory(await fetchMcpDiscoveryInventory());
    } catch (err) {
      setError(err?.response?.data?.error || 'mcp_discovery_unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const records = inventory?.records || [];
  const counts = useMemo(() => STATUS_ORDER.reduce((result, status) => {
    result[status] = records.filter((record) => record.status === status).length;
    return result;
  }, {}), [records]);
  const findings = records.flatMap((record) => (record.securityFindings || []).map((finding) => ({ ...finding, server: record.displayName })));

  const scanNow = async () => {
    setScanMessage(null);
    try {
      const result = await requestMcpDiscoveryScan();
      setScanMessage(`Scan queued: ${result.scanId}`);
      await load();
    } catch (err) {
      setScanMessage(err?.response?.data?.error || 'Scan could not be queued');
    }
  };

  return (
    <main className="mcp-discovery-page">
      <header className="mcp-discovery-header">
        <div>
          <p className="mcp-discovery-eyebrow">MCP runtime</p>
          <h1>Runtime inventory</h1>
          <p className="mcp-discovery-subtitle">
            Read-only discovery across host processes, local listeners, Compose services, and configured remote URLs.
          </p>
        </div>
        <div className="mcp-discovery-actions">
          <span className="mcp-discovery-updated">Last scan {formatTime(inventory?.scannedAt)}</span>
          <button type="button" className="mcp-discovery-button" onClick={load} disabled={loading}>Refresh</button>
          <button type="button" className="mcp-discovery-button mcp-discovery-button-primary" onClick={scanNow} disabled={loading}>Scan now</button>
        </div>
      </header>

      {error && <div className="mcp-discovery-error" role="alert">Discovery agent unavailable: {error}</div>}
      {scanMessage && <div className="mcp-discovery-notice" role="status">{scanMessage}</div>}

      <section className="mcp-discovery-summary" aria-label="Inventory summary">
        <div className="mcp-discovery-summary-card"><span>Verified servers</span><strong>{counts.healthy || 0}</strong><small>healthy MCP endpoints</small></div>
        <div className="mcp-discovery-summary-card"><span>Candidates</span><strong>{counts.candidate || 0}</strong><small>observed but unprobed</small></div>
        <div className="mcp-discovery-summary-card"><span>Needs attention</span><strong>{(counts.degraded || 0) + (counts.offline || 0)}</strong><small>degraded or unreachable</small></div>
        <div className="mcp-discovery-summary-card"><span>Findings</span><strong>{findings.length}</strong><small>heuristic metadata flags</small></div>
      </section>

      <div className="mcp-discovery-grid">
        <section className="mcp-discovery-panel" aria-labelledby="mcp-inventory-title">
          <div className="mcp-discovery-panel-heading">
            <div><p className="mcp-discovery-eyebrow">Operational view</p><h2 id="mcp-inventory-title">Discovered servers</h2></div>
            <span className="mcp-discovery-count">{records.length} records</span>
          </div>
          {loading && records.length === 0 ? <p className="mcp-discovery-empty">Scanning configured sources…</p> : records.length === 0 ? <p className="mcp-discovery-empty">No candidates found. Start the agent or configure a remote URL.</p> : (
            <div className="mcp-discovery-table-wrap">
              <table className="mcp-discovery-table">
                <thead><tr><th>Status</th><th>Server</th><th>Source</th><th>Transport</th><th>Tools</th><th>Latency</th></tr></thead>
                <tbody>{records.map((record) => <tr key={record.id}>
                  <td><span className={`mcp-discovery-status mcp-discovery-status-${record.status}`}>{statusLabel(record.status)}</span></td>
                  <td><strong>{record.displayName}</strong><small>{record.endpoint || 'No endpoint — candidate only'}</small></td>
                  <td>{(record.sources || [record.source]).join(', ')}</td>
                  <td>{statusLabel(record.transport)}</td>
                  <td>{record.tools?.length || 0}</td>
                  <td>{record.probe?.latencyMs == null ? '—' : `${record.probe.latencyMs} ms`}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mcp-discovery-panel mcp-discovery-security" aria-labelledby="mcp-security-title">
          <div className="mcp-discovery-panel-heading">
            <div><p className="mcp-discovery-eyebrow">Security view</p><h2 id="mcp-security-title">Metadata findings</h2></div>
            <span className="mcp-discovery-count">{findings.length} flags</span>
          </div>
          <p className="mcp-discovery-disclaimer">These are heuristic signals from tool descriptions and schemas, not proof of safety or malice.</p>
          {findings.length === 0 ? <p className="mcp-discovery-empty">No metadata findings in the latest scan.</p> : <ul className="mcp-discovery-findings">
            {findings.map((finding, index) => <li key={`${finding.server}-${finding.tool}-${index}`}>
              <strong>{finding.kind}</strong><span>{finding.server} · {finding.tool}</span><p>{finding.detail}</p>
            </li>)}
          </ul>}
          <div className="mcp-discovery-boundary"><strong>Discovery boundary</strong><span>No credentials. No tool calls. Stdio processes remain candidates unless they expose an inspection channel.</span></div>
        </section>
      </div>
    </main>
  );
}
