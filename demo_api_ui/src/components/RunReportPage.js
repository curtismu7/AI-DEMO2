// /reports — run reports: the list of agent runs the BFF recorded, per-run downloads, and a demo run that
// creates one.
//
// Honesty: the history is what the BFF stored (a shared list: every demo identity's runs, not only yours).
// "Run Demo Flow" posts one canned prompt for the chosen vertical to /api/agent/invoke as the signed-in user.
// This page does not know whether the model and tools behind that call are live or mocked (that is the app's
// agent settings), so it never says which. It only reports what it checked: the BFF's success flag, and, after
// the list reloads, whether the new run id is in it.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through
// the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards,
// P5 kv, P7 chips, P9 buttons. P9 "one primary per view state":
//   signed out ............... Sign in is the only action, so it is the primary.
//   signed in (any run state)  Run Demo Flow is the primary. History row actions (MD, HTML, PDF, Share, Email)
//                              and Bulk export (admin) are secondaries.
//   session lapsed (a 401 from the history or the run) ... Sign in becomes the primary and Run Demo Flow drops to
//                              a secondary, because running again cannot work until the user signs in.
// While a run or an export is in flight the button takes aria-disabled, not disabled, so keyboard focus stays
// on it. Its name does not change; the status line (role=status, mounted before its text changes) says what is
// happening. Results are kept with the thing they belong to: the demo result in the run card, a download/share
// result in its own table row, the export result in the admin card.
// Page CSS (.run-report-page, rr- prefix) keeps only the table and the form grid.

import React, { useEffect, useRef, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { resolveApiBaseUrl } from '../utils/resolveApiBaseUrl';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import './RunReportPage.css';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from './pingUi';

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

const FORMAT_NAMES = { md: 'Markdown', html: 'HTML', pdf: 'PDF' };

const verticalLabel = (id) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
const shortId = (runId) => String(runId || '').slice(0, 8);

function formatWhen(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function triggerFileSave(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export default function RunReportPage({ user }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  // null | 'auth' | 'failed': why the last history read did not work.
  const [historyError, setHistoryError] = useState(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [runAuto, setRunAuto] = useState(false); // the run in flight is the automatic first run
  // The demo run's own result, kept in the run card:
  // { state: 'ok' | 'failed' | 'signed-out', message, vertical, prompt, runId, toolsCalled, recorded, auto }
  const [demoResult, setDemoResult] = useState(null);
  const [verticals, setVerticals] = useState([]);
  const [selectedVertical, setSelectedVertical] = useState(user?.vertical || 'banking');
  // Results of row actions, keyed by run id: { tone, text }.
  const [rowStatus, setRowStatus] = useState({});
  const [lastAction, setLastAction] = useState('');
  const autoRanRef = useRef(false);
  const runningRef = useRef(false);
  const historyRequest = useRef(0);
  const isAdmin = user?.role === 'admin';

  // Admin filters
  const [adminSince, setAdminSince] = useState('');
  const [adminUntil, setAdminUntil] = useState('');
  const [adminVertical, setAdminVertical] = useState('');
  const [adminFormat, setAdminFormat] = useState('md');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminResult, setAdminResult] = useState(null); // { tone, word, text }

  useEffect(() => {
    if (user) {
      loadHistory();
      loadVerticals();
    }
  }, [user]);

  // Returns the runs it read, or null when the read failed.
  async function loadHistory() {
    const id = historyRequest.current + 1;
    historyRequest.current = id;
    try {
      setLoading(true);
      const { data } = await bffAxios.get('/api/reports/history');
      const fetched = Array.isArray(data?.runs) ? data.runs : [];
      if (id === historyRequest.current) {
        setRuns(fetched);
        setHistoryError(null);
      }
      // Auto-run the demo flow once if there are no reports yet
      if (fetched.length === 0 && !autoRanRef.current) {
        autoRanRef.current = true;
        runDemoFlow(true);
      }
      return fetched;
    } catch (error) {
      console.error('Failed to load run history:', error);
      if (id === historyRequest.current) {
        setHistoryError(error?.response?.status === 401 ? 'auth' : 'failed');
      }
      return null;
    } finally {
      if (id === historyRequest.current) setLoading(false);
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

  const verticalOptions = verticals.length > 0
    ? verticals.map((v) => ({ id: v.id, label: v.displayName || v.id }))
    : Object.keys(DEMO_PROMPTS_BY_VERTICAL).map((id) => ({ id, label: verticalLabel(id) }));
  // A value the list does not offer would show the first option while running another vertical.
  const activeVertical = verticalOptions.some((o) => o.id === selectedVertical)
    ? selectedVertical
    : (verticalOptions[0]?.id || 'banking');
  const activePrompt = DEMO_PROMPTS_BY_VERTICAL[activeVertical] || DEFAULT_DEMO_PROMPT;

  async function runDemoFlow(isAuto = false) {
    if (runningRef.current) return; // aria-disabled keeps focus on the button; the click is ignored
    runningRef.current = true;
    setDemoRunning(true);
    setRunAuto(isAuto === true);
    setDemoResult(null);
    const vertical = activeVertical;
    const prompt = activePrompt;
    const base = { vertical, prompt, auto: isAuto === true };
    try {
      const { data } = await bffAxios.post('/api/agent/invoke', { prompt, vertical });
      const ok = data.success !== false;
      // The BFF may leave the flag out. Then the page says so instead of crediting the BFF with a success report.
      const flagged = data.success === true;
      const runId = typeof data.runId === 'string' ? data.runId : null;
      const toolsCalled = Array.isArray(data.toolsCalled) ? data.toolsCalled : [];
      const fetched = await loadHistory();
      // The page's own check: is the run in the list the BFF returned now?
      let recorded = 'unchecked';
      if (ok && runId && fetched) recorded = fetched.some((r) => r.runId === runId) ? 'yes' : 'no';
      setDemoResult({
        ...base,
        state: ok ? 'ok' : 'failed',
        flagged,
        message: ok ? null : `The run ended with an error: ${data.reply || data.error || 'unknown'}`,
        runId,
        toolsCalled,
        recorded,
      });
    } catch (err) {
      const is401 = err.response?.status === 401;
      setDemoResult({
        ...base,
        state: is401 ? 'signed-out' : 'failed',
        message: is401
          ? 'Your session has expired or you are not signed in.'
          : `The run failed: ${err.message}`,
      });
    } finally {
      runningRef.current = false;
      setDemoRunning(false);
    }
  }

  function setRow(runId, tone, text) {
    setRowStatus((prev) => ({ ...prev, [runId]: { tone, text } }));
    setLastAction(`Run ${shortId(runId)}: ${text}`);
  }

  // HTML and PDF render in the browser, so open them in a new tab instead of
  // downloading. The backend serves these formats with `Content-Disposition: inline`,
  // and the BFF session cookie rides along on the top-level navigation, so no
  // Authorization header is needed.
  function openReport(runId, format) {
    const url = `${resolveApiBaseUrl()}/api/reports/${runId}/download?format=${format}`;
    window.open(url, '_blank', 'noopener');
    // window.open with noopener returns null whether or not a tab opened, so the page cannot tell a blocked pop-up.
    setRow(runId, 'neutral', `${FORMAT_NAMES[format]} requested in a new tab. If nothing opened, allow pop-ups for this site.`);
  }

  async function downloadReport(runId, format) {
    try {
      const response = await bffAxios.get(`/api/reports/${runId}/download?format=${format}`, {
        responseType: 'blob',
      });
      triggerFileSave(response.data, `report_${runId.slice(0, 8)}.${format}`);
      setRow(runId, 'ok', `${FORMAT_NAMES[format]} downloaded.`);
    } catch (error) {
      console.error(`Failed to download ${format}:`, error);
      setRow(runId, 'danger', `${FORMAT_NAMES[format]} download failed${error?.response?.status ? ` (HTTP ${error.response.status})` : ''}.`);
    }
  }

  async function copyShareLink(runId) {
    try {
      const { data } = await bffAxios.get(`/api/reports/${runId}/share`);
      if (typeof data?.shareUrl !== 'string' || !data.shareUrl) {
        setRow(runId, 'danger', 'The BFF returned no share link, so nothing was copied.');
        return;
      }
      await navigator.clipboard.writeText(data.shareUrl);
      setRow(runId, 'ok', 'Share link copied to the clipboard.');
    } catch (error) {
      console.error('Failed to copy share link:', error);
      setRow(runId, 'danger', 'The share link could not be copied.');
    }
  }

  function emailShareLink(runId) {
    // Placeholder: in production, would open mailto or call backend email service
    window.location.href = `mailto:?subject=Run Report ${runId}`;
  }

  async function bulkExport() {
    if (adminLoading) return; // aria-disabled keeps focus on the button; the click is ignored
    try {
      setAdminLoading(true);
      setAdminResult(null);
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
      triggerFileSave(response.data, `bulk_export.${adminFormat}`);
      setAdminResult({ tone: 'ok', word: 'Exported', text: `bulk_export.${adminFormat} was downloaded.` });
    } catch (error) {
      console.error('Bulk export failed:', error);
      setAdminResult({
        tone: 'danger',
        word: 'Failed',
        text: `The export failed${error?.response?.status ? ` (HTTP ${error.response.status})` : ''}, so no file was saved.`,
      });
    } finally {
      setAdminLoading(false);
    }
  }

  const signIn = () => navigateToCustomerOAuthLogin('/reports');

  if (!user) {
    return (
      <PingPage className="run-report-page">
        <SimBanner data-testid="rr-banner">
          <strong>SIGNED OUT</strong> — run reports need a session. Nothing is requested from the BFF until you sign
          in, and no demo run starts on its own.
        </SimBanner>
        <PageHeader title="Run Reports" summary="View and download reports from your agent runs" />
        <PageFrame>
          <Section id="rr-signin-h" kicker="Session" title="Sign in to see your run reports">
            <CardGrid>
              <Card tone="warn" title="Signed out" data-testid="rr-signed-out">
                <p className="pu-status-line" role="status">
                  <StatusChip tone="warn">Signed out</StatusChip>
                  Sign in to view run reports.
                </p>
                <p className="pu-note">
                  Sign in starts the app&apos;s sign-in and returns you to this page. Nothing happens until you press it.
                </p>
                <div className="pu-actions">
                  <ActionButton lead onClick={signIn} data-testid="rr-signin">
                    Sign in
                  </ActionButton>
                </div>
              </Card>
            </CardGrid>
          </Section>
        </PageFrame>
      </PingPage>
    );
  }

  // The session lapsed, so the one thing that can move forward is signing in again.
  const needsLogin = demoResult?.state === 'signed-out' || historyError === 'auth';

  // Run card status. The word says what the page itself saw.
  let runStatus;
  if (demoRunning) {
    runStatus = { tone: 'neutral', word: 'Running', text: `${runAuto ? 'No reports existed, so a demo run started automatically. ' : ''}Sending the ${activeVertical} prompt to /api/agent/invoke.` };
  } else if (demoResult?.state === 'ok') {
    runStatus = okOutcome(demoResult);
  } else if (demoResult?.state === 'failed') {
    runStatus = { tone: 'danger', word: 'Failed', text: demoResult.message };
  } else if (demoResult?.state === 'signed-out') {
    runStatus = { tone: 'warn', word: 'Signed out', text: demoResult.message };
  } else {
    runStatus = { tone: 'neutral', word: 'Idle', text: 'No demo run from this page yet.' };
  }

  // History status.
  let historyStatus;
  if (loading && runs.length === 0) historyStatus = { tone: 'neutral', word: 'Loading', text: 'Reading the run history from the BFF.' };
  else if (loading) historyStatus = { tone: 'neutral', word: 'Refreshing', text: 'Reading the run history again.' };
  else if (historyError === 'auth') {
    historyStatus = { tone: 'warn', word: 'Signed out', text: 'The BFF would not return the history because the session is not valid. Sign in again.' };
  } else if (historyError) {
    historyStatus = {
      tone: 'danger',
      word: 'Unavailable',
      text: runs.length
        ? 'The refresh failed, so the rows below are from the last successful read.'
        : 'The run history could not be read. That does not mean there are no runs.',
    };
  } else if (runs.length === 0) {
    historyStatus = { tone: 'neutral', word: 'Empty', text: 'The BFF has no recorded runs yet.' };
  } else {
    historyStatus = { tone: 'ok', word: 'Loaded', text: `${runs.length} recorded ${runs.length === 1 ? 'run' : 'runs'} read from the BFF.` };
  }

  const runKv = [
    { label: 'Vertical', value: verticalOptions.find((o) => o.id === activeVertical)?.label || activeVertical },
    { label: 'Prompt sent', value: activePrompt, mono: true },
  ];

  return (
    <PingPage className="run-report-page">
      <SimBanner data-testid="rr-banner">
        <strong>RECORDED RUNS</strong> — the table lists run records the BFF stored: every demo identity&apos;s, not only
        yours. <strong>Run Demo Flow</strong> sends one canned prompt for the chosen vertical to /api/agent/invoke as
        you, with the agent settings the app is currently set to. Whether the model and tools behind that are live or
        mocked depends on those settings and is not checked here; the report records what ran. If no reports exist
        yet, one demo run starts automatically when this page opens.
      </SimBanner>
      <PageHeader title="Run Reports" summary="View and download reports from your agent runs" />
      <PageFrame>
        <Section
          id="rr-run-h"
          kicker="1 · Make a run"
          title="Run a demo flow"
          lede="One prompt per vertical, sent through the same agent route the app uses, to generate a report."
        >
          <CardGrid>
            <Card title="Demo run" data-testid="rr-run">
              <label className="pu-label" htmlFor="rr-vertical">Vertical</label>
              <select
                id="rr-vertical"
                className="pu-select rr-vertical"
                value={activeVertical}
                onChange={(e) => { if (!runningRef.current) setSelectedVertical(e.target.value); }}
                aria-disabled={demoRunning ? 'true' : undefined}
                title="Choose a vertical for the demo run"
                data-testid="rr-vertical"
              >
                {verticalOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <KvList items={runKv} />
              <p className="pu-status-line" role="status" data-testid="rr-run-status">
                <StatusChip tone={runStatus.tone}>{runStatus.word}</StatusChip>
                {runStatus.text}
              </p>
              <div className="pu-actions">
                <ActionButton
                  lead={!needsLogin}
                  aria-disabled={demoRunning ? 'true' : undefined}
                  onClick={() => runDemoFlow(false)}
                  title="Run a full auth → token-exchange → MCP tool call flow and generate a report"
                  data-testid="rr-run-demo"
                >
                  Run Demo Flow
                </ActionButton>
                {needsLogin && (
                  <ActionButton lead onClick={signIn} data-testid="rr-signin">
                    Sign in
                  </ActionButton>
                )}
              </div>
            </Card>
            <Card
              title="Last demo run"
              tone={demoResult ? runStatus.tone : 'neutral'}
              data-testid="rr-result"
            >
              {demoResult ? (
                <KvList
                  items={[
                    { label: 'Started', value: demoResult.auto ? 'Automatically (no reports existed)' : 'By you' },
                    { label: 'Vertical', value: demoResult.vertical },
                    { label: 'Prompt', value: demoResult.prompt, mono: true },
                    { label: 'Run id', value: demoResult.runId || 'Not returned', mono: true },
                    {
                      label: 'Tools called',
                      value: demoResult.toolsCalled?.length ? demoResult.toolsCalled.join(', ') : 'None reported',
                      mono: true,
                    },
                    {
                      label: 'In the history',
                      value: {
                        yes: 'Yes, the run is in the list below.',
                        no: 'No, the list below does not contain it.',
                        unchecked: 'Not checked.',
                      }[demoResult.recorded || 'unchecked'],
                    },
                  ]}
                />
              ) : (
                <p className="pu-note pu-empty">
                  {demoRunning ? 'Waiting for the run to finish.' : 'Run the demo flow to see its result here.'}
                </p>
              )}
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="rr-history-h"
          kicker="2 · Recorded runs"
          title="Run history"
          lede="Reports are a shared demo list, so runs from other demo identities appear here too."
        >
          <Card tone="neutral" data-testid="rr-history">
            <p className="pu-status-line" role="status" data-testid="rr-history-status">
              <StatusChip tone={historyStatus.tone}>{historyStatus.word}</StatusChip>
              {historyStatus.text}
            </p>
            {runs.length === 0 ? (
              !loading && !historyError && (
                <p className="pu-note pu-empty" data-testid="rr-empty">
                  No reports yet. Press <strong>Run Demo Flow</strong> above to generate your first report.
                </p>
              )
            ) : (
              <div className="rr-table-wrap">
                <table className="rr-table" data-testid="rr-table">
                  <thead>
                    <tr>
                      <th scope="col">Vertical</th>
                      <th scope="col">Date/Time</th>
                      <th scope="col">Prompt</th>
                      <th scope="col">Tools Called</th>
                      <th scope="col">Step-Up</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const when = formatWhen(run.startedAt);
                      const prompt = typeof run.prompt === 'string' ? run.prompt : '';
                      const row = rowStatus[run.runId];
                      const id = shortId(run.runId);
                      return (
                        <tr key={run.runId}>
                          <td data-label="Vertical" className="rr-strong">{run.vertical || 'Not recorded'}</td>
                          <td data-label="Date/Time" className="pu-mono">
                            {when ? <time dateTime={when.toISOString()}>{when.toLocaleString()}</time> : 'Time unavailable'}
                          </td>
                          <td data-label="Prompt" className="rr-wrap" title={prompt}>
                            {prompt ? (prompt.length > 60 ? `${prompt.substring(0, 60)}…` : prompt) : 'Not recorded'}
                          </td>
                          <td data-label="Tools Called" className="rr-wrap">{(run.toolsCalled || []).join(', ') || 'None'}</td>
                          <td data-label="Step-Up">
                            {run.hasCibaStepUp ? (
                              <span title="A CIBA backchannel step-up was recorded in this run's token chain">
                                <StatusChip tone="info">CIBA</StatusChip>
                              </span>
                            ) : (
                              <span className="rr-muted">None</span>
                            )}
                          </td>
                          <td data-label="Actions">
                            <div className="rr-actions">
                              <button
                                type="button"
                                className="pu-btn rr-act"
                                title="Download Markdown"
                                aria-label={`MD: download the Markdown report for run ${id}`}
                                onClick={() => downloadReport(run.runId, 'md')}
                              >
                                MD
                              </button>
                              <button
                                type="button"
                                className="pu-btn rr-act"
                                title="Open HTML in browser"
                                aria-label={`HTML: open the HTML report for run ${id} in a new tab`}
                                onClick={() => openReport(run.runId, 'html')}
                              >
                                HTML
                              </button>
                              <button
                                type="button"
                                className="pu-btn rr-act"
                                title="Open PDF in browser"
                                aria-label={`PDF: open the PDF report for run ${id} in a new tab`}
                                onClick={() => openReport(run.runId, 'pdf')}
                              >
                                PDF
                              </button>
                              <button
                                type="button"
                                className="pu-btn rr-act"
                                title="Copy share link"
                                aria-label={`Share: copy the share link for run ${id}`}
                                onClick={() => copyShareLink(run.runId)}
                              >
                                Share
                              </button>
                              <button
                                type="button"
                                className="pu-btn rr-act"
                                title="Open an email draft (the subject names the run; no link is attached)"
                                aria-label={`Email: open an email draft for run ${id}`}
                                onClick={() => emailShareLink(run.runId)}
                              >
                                Email
                              </button>
                            </div>
                            {row && (
                              <p className="rr-row-status" data-testid="rr-row-status">
                                <StatusChip tone={row.tone}>{{ ok: 'Done', danger: 'Failed', neutral: 'Requested' }[row.tone] || 'Note'}</StatusChip>
                                {row.text}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="rr-sr-only" role="status" data-testid="rr-action-status">{lastAction}</p>
          </Card>
        </Section>

        {isAdmin && (
          <Section
            id="rr-admin-h"
            kicker="3 · Admin"
            title="Admin: Bulk Export"
            lede="Download the recorded runs between two dates as one file."
          >
            <Card tone="neutral" data-testid="rr-admin">
              <div className="rr-admin-form">
                <div>
                  <label className="pu-label" htmlFor="rr-since">Start Date</label>
                  <input
                    id="rr-since"
                    className="pu-select"
                    type="datetime-local"
                    value={adminSince}
                    onChange={(e) => setAdminSince(e.target.value)}
                  />
                </div>
                <div>
                  <label className="pu-label" htmlFor="rr-until">End Date</label>
                  <input
                    id="rr-until"
                    className="pu-select"
                    type="datetime-local"
                    value={adminUntil}
                    onChange={(e) => setAdminUntil(e.target.value)}
                  />
                </div>
                <div>
                  <label className="pu-label" htmlFor="rr-admin-vertical">Vertical</label>
                  <input
                    id="rr-admin-vertical"
                    className="pu-select"
                    type="text"
                    placeholder="e.g., banking, healthcare"
                    value={adminVertical}
                    onChange={(e) => setAdminVertical(e.target.value)}
                  />
                </div>
                <div>
                  <label className="pu-label" htmlFor="rr-format">Format</label>
                  <select
                    id="rr-format"
                    className="pu-select"
                    value={adminFormat}
                    onChange={(e) => setAdminFormat(e.target.value)}
                  >
                    <option value="md">Markdown</option>
                    <option value="html">HTML</option>
                  </select>
                </div>
              </div>
              <p className="pu-status-line" role="status" data-testid="rr-admin-status">
                {adminLoading ? (
                  <><StatusChip tone="neutral">Exporting</StatusChip>Building the export on the BFF.</>
                ) : adminResult ? (
                  <><StatusChip tone={adminResult.tone}>{adminResult.word}</StatusChip>{adminResult.text}</>
                ) : (
                  <><StatusChip tone="neutral">Idle</StatusChip>No export requested yet.</>
                )}
              </p>
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn"
                  aria-disabled={adminLoading ? 'true' : undefined}
                  onClick={bulkExport}
                  data-testid="rr-bulk-export"
                >
                  Bulk Export
                </button>
              </div>
            </Card>
          </Section>
        )}
      </PageFrame>
    </PingPage>
  );
}

// What the page saw for a run the BFF did not report as failed. Green only when the page itself found the run
// id in the reloaded list; a miss is a warning and anything unchecked is neutral.
function okOutcome({ vertical, flagged, recorded }) {
  const lead = flagged
    ? `The BFF reported success for the ${vertical} run.`
    : `The BFF answered the ${vertical} run without a success flag.`;
  if (recorded === 'yes') {
    return { tone: 'ok', word: flagged ? 'Completed' : 'Recorded', text: `${lead} Its run id is in the history.` };
  }
  if (recorded === 'no') {
    return { tone: 'warn', word: 'Not in history', text: `${lead} Its run id is not in the history list, so the report may be missing.` };
  }
  return { tone: 'neutral', word: flagged ? 'Reported success' : 'Answered', text: `${lead} Whether it was recorded was not checked.` };
}

// One button, one place the primary class is written. `lead` is the view state's single primary (see the header).
function ActionButton({ lead, ...rest }) {
  return <button type="button" className={lead ? 'pu-btn pu-btn--primary' : 'pu-btn'} {...rest} />;
}
