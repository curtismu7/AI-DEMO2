import React, { useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { resolveApiBaseUrl } from '../utils/resolveApiBaseUrl';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import './RunReportPage.css';

// Canned prompts per vertical — chosen to exercise the full auth → token-exchange
// → MCP tool call pipeline so every step appears in the generated report.
const DEMO_PROMPTS_BY_VERTICAL = {
  banking:       'show my account balance',
  healthcare:    'show my medical records',
  retail:        'show my orders',
  'sporting-goods': 'show my orders',
  workforce:     'show my profile',
  mortgage:      'show my loan status',
};
const DEFAULT_DEMO_PROMPT = 'show my account balance';

export default function RunReportPage({ user }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoResult, setDemoResult] = useState(null); // { ok, message }
  const [verticals, setVerticals] = useState([]);
  const [selectedVertical, setSelectedVertical] = useState(user?.vertical || 'banking');
  const autoRanRef = useRef(false);
  const isAdmin = user?.role === 'admin';

  // Admin filters
  const [adminSince, setAdminSince] = useState('');
  const [adminUntil, setAdminUntil] = useState('');
  const [adminVertical, setAdminVertical] = useState('');
  const [adminFormat, setAdminFormat] = useState('md');
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadHistory();
      loadVerticals();
    }
  }, [user]);

  async function loadHistory() {
    try {
      setLoading(true);
      const { data } = await bffAxios.get('/api/reports/history');
      const fetched = data.runs || [];
      setRuns(fetched);
      // Auto-run the demo flow once if there are no reports yet
      if (fetched.length === 0 && !autoRanRef.current) {
        autoRanRef.current = true;
        runDemoFlow(true);
      }
    } catch (error) {
      console.error('Failed to load run history:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadVerticals() {
    try {
      const { data } = await bffAxios.get('/api/verticals/list');
      const list = Array.isArray(data) ? data : (data.verticals || []);
      if (list.length > 0) setVerticals(list);
    } catch (_e) {
      // keep the default empty list; picker will still work with DEMO_PROMPTS_BY_VERTICAL keys
    }
  }

  async function runDemoFlow(isAuto = false) {
    if (demoRunning) return;
    setDemoRunning(true);
    setDemoResult(null);
    const vertical = selectedVertical || user?.vertical || 'banking';
    const prompt = DEMO_PROMPTS_BY_VERTICAL[vertical] || DEFAULT_DEMO_PROMPT;
    try {
      const { data } = await bffAxios.post('/api/agent/invoke', { prompt, vertical });
      const ok = data.success !== false;
      setDemoResult({
        ok,
        message: ok
          ? `Demo run complete — ${vertical} flow executed successfully.`
          : `Demo run finished with an error: ${data.reply || data.error || 'unknown'}`,
      });
      await loadHistory();
    } catch (err) {
      const is401 = err.response?.status === 401;
      setDemoResult({
        ok: false,
        message: is401
          ? 'Your session has expired or you are not signed in.'
          : `Demo run failed: ${err.message}`,
        needsLogin: is401,
      });
    } finally {
      setDemoRunning(false);
    }
  }

  // HTML and PDF render in the browser, so open them in a new tab instead of
  // downloading. The backend serves these formats with `Content-Disposition: inline`,
  // and the BFF session cookie rides along on the top-level navigation, so no
  // Authorization header is needed.
  function openReport(runId, format) {
    const url = `${resolveApiBaseUrl()}/api/reports/${runId}/download?format=${format}`;
    window.open(url, '_blank', 'noopener');
  }

  async function downloadReport(runId, format) {
    try {
      const response = await bffAxios.get(`/api/reports/${runId}/download?format=${format}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${runId.slice(0, 8)}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(`Failed to download ${format}:`, error);
    }
  }

  async function copyShareLink(runId) {
    try {
      setCopying(runId);
      const { data } = await bffAxios.get(`/api/reports/${runId}/share`);
      await navigator.clipboard.writeText(data.shareUrl);
      setTimeout(() => setCopying(null), 2000);
    } catch (error) {
      console.error('Failed to copy share link:', error);
      setCopying(null);
    }
  }

  function emailShareLink(runId) {
    // Placeholder: in production, would open mailto or call backend email service
    window.location.href = `mailto:?subject=Run Report ${runId}`;
  }

  async function bulkExport() {
    try {
      setAdminLoading(true);
      const response = await bffAxios.post(
        '/api/reports/bulk',
        {
          since: adminSince || undefined,
          until: adminUntil || undefined,
          vertical: adminVertical || undefined,
          format: adminFormat,
        },
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bulk_export.${adminFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Bulk export failed:', error);
    } finally {
      setAdminLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="run-report-page">
        <header className="page-header">
          <h1>Run Reports</h1>
          <p>View and download reports from your agent runs</p>
        </header>
        <div className="empty-state">
          <p>Sign in to view your run reports.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="run-report-page">
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1>Run Reports</h1>
            <p>View and download reports from your agent runs</p>
          </div>
          <div className="demo-controls">
            <select
              className="vertical-picker"
              value={selectedVertical}
              onChange={e => setSelectedVertical(e.target.value)}
              disabled={demoRunning}
              title="Choose a vertical for the demo run"
            >
              {verticals.length > 0
                ? verticals.map(v => (
                    <option key={v.id} value={v.id}>{v.displayName || v.id}</option>
                  ))
                : Object.keys(DEMO_PROMPTS_BY_VERTICAL).map(id => (
                    <option key={id} value={id}>{id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ')}</option>
                  ))
              }
            </select>
            <button
              className="run-demo-btn"
              onClick={() => runDemoFlow(false)}
              disabled={demoRunning}
              title="Run a full auth → token-exchange → MCP tool call flow and generate a report"
            >
              {demoRunning ? '⏳ Running flow…' : '▶ Run Demo Flow'}
            </button>
          </div>
        </div>
        {demoResult && (
          <div className={`demo-result ${demoResult.ok ? 'demo-result--ok' : 'demo-result--err'}`}>
            {demoResult.message}
            {demoResult.needsLogin && (
              <button className="demo-result__login-btn" onClick={navigateToCustomerOAuthLogin}>
                Sign In
              </button>
            )}
          </div>
        )}
      </header>

      {loading || demoRunning ? (
        <div className="loading">{demoRunning ? 'Running demo flow…' : 'Loading history…'}</div>
      ) : runs.length === 0 ? (
        <div className="empty-state">
          <p>No reports yet. Click <strong>Run Demo Flow</strong> above to generate your first report.</p>
        </div>
      ) : (
        <div className="runs-table-container">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Vertical</th>
                <th>Date/Time</th>
                <th>Prompt</th>
                <th>Tools Called</th>
                <th>Step-Up</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.runId}>
                  <td className="vertical-cell">{run.vertical || 'banking'}</td>
                  <td className="date-cell">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="prompt-cell" title={run.prompt || ''}>
                    {(run.prompt || '').substring(0, 60)}...
                  </td>
                  <td className="tools-cell">{(run.toolsCalled || []).join(', ')}</td>
                  <td className="stepup-cell">
                    {run.hasCibaStepUp ? (
                      <span className="stepup-badge" title="A CIBA backchannel step-up was recorded in this run's token chain">
                        CIBA
                      </span>
                    ) : (
                      <span className="stepup-none">—</span>
                    )}
                  </td>
                  <td className="actions-cell">
                    <div className="action-group">
                      <button
                        className="action-btn download"
                        title="Download Markdown"
                        onClick={() => downloadReport(run.runId, 'md')}
                      >
                        MD
                      </button>
                      <button
                        className="action-btn download"
                        title="Open HTML in browser"
                        onClick={() => openReport(run.runId, 'html')}
                      >
                        HTML
                      </button>
                      <button
                        className="action-btn download"
                        title="Open PDF in browser"
                        onClick={() => openReport(run.runId, 'pdf')}
                      >
                        PDF
                      </button>
                    </div>
                    <div className="action-group">
                      <button
                        className="action-btn share"
                        title="Copy share link"
                        onClick={() => copyShareLink(run.runId)}
                      >
                        {copying === run.runId ? '✓ Copied' : 'Share'}
                      </button>
                      <button
                        className="action-btn email"
                        title="Email share link"
                        onClick={() => emailShareLink(run.runId)}
                      >
                        Email
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <section className="admin-section">
          <h2>Admin: Bulk Export</h2>
          <div className="admin-form">
            <div className="form-group">
              <label>
                Start Date:
                <input
                  type="datetime-local"
                  value={adminSince}
                  onChange={e => setAdminSince(e.target.value)}
                />
              </label>
            </div>
            <div className="form-group">
              <label>
                End Date:
                <input
                  type="datetime-local"
                  value={adminUntil}
                  onChange={e => setAdminUntil(e.target.value)}
                />
              </label>
            </div>
            <div className="form-group">
              <label>
                Vertical:
                <input
                  type="text"
                  placeholder="e.g., banking, healthcare"
                  value={adminVertical}
                  onChange={e => setAdminVertical(e.target.value)}
                />
              </label>
            </div>
            <div className="form-group">
              <label>
                Format:
                <select value={adminFormat} onChange={e => setAdminFormat(e.target.value)}>
                  <option value="md">Markdown</option>
                  <option value="html">HTML</option>
                </select>
              </label>
            </div>
            <button
              className="bulk-export-btn"
              onClick={bulkExport}
              disabled={adminLoading}
            >
              {adminLoading ? 'Exporting...' : 'Bulk Export'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
