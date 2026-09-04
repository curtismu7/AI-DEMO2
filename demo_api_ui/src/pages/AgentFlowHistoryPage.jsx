// demo_api_ui/src/pages/AgentFlowHistoryPage.jsx
// /agent-flow-inspector — master-detail history view. Left: past agent runs
// from every execution path in the app (GET /api/agent-flow-history — backed
// by reportStore, the same durable per-user store /api/agent/invoke and
// /api/demo-agent/nl already write to; /api/agent/run and
// /api/admin-agent/message now write there too). Right: the selected run's
// detail. Live execution happens elsewhere (the agent chat); this page is for
// inspecting past runs, not driving new ones.
import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import AgentRunTimeline from '../components/AgentRunTimeline';
import useDividerDrag from '../hooks/useDividerDrag';
import { useThemeOptional } from '../context/ThemeContext';
import './AgentFlowHistoryPage.css';

const PAGE_TITLE = 'Agent & Token Flow History';

function formatTimestamp(iso) {
  if (!iso) return 'Unknown time';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 'Unknown time' : new Date(t).toLocaleString();
}

function formatDuration(startedAt, completedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function truncatePrompt(prompt) {
  if (!prompt) return '(no prompt recorded)';
  return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
}

export default function AgentFlowHistoryPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const { size: sidebarWidth, handleProps: sidebarHandleProps } = useDividerDrag({
    min: 260,
    max: 520,
    initial: 320,
    storageKey: 'afh-sidebar-width',
  });
  const [runs, setRuns] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    return () => { document.title = previousTitle; };
  }, []);

  const fetchRuns = useCallback(() => {
    setRuns(null);
    setLoadError(null);
    apiClient
      .get('/api/agent-flow-history')
      .then((r) => {
        setRuns(Array.isArray(r.data?.runs) ? r.data.runs : []);
        setLoadError(null);
      })
      .catch(() => {
        setRuns([]);
        setLoadError('Failed to load run history.');
      });
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Default to the latest run until the user picks one — DERIVED, not stored.
  // An effect that wrote the default read selectedRunId from its own render, so
  // one scheduled while nothing was selected still fired after a click and
  // clobbered the choice with runs[0]. Click quickly and the detail pane snapped
  // back to the newest run; in CI it surfaced as AgentFlowHistoryPage.test.jsx
  // getting run_2 where it expected run_1. Deriving removes the ordering
  // question entirely: there is no second writer.
  //
  // Only the "nothing picked yet" case defaults; once the user has picked, a
  // missing run still resolves to null exactly as before. Removing the race is
  // the whole change.
  const selectedRun = (selectedRunId
    ? runs?.find((r) => r.runId === selectedRunId)
    : runs?.[0]) || null;

  return (
    <div className="agent-flow-history-page">
      <div className="afh-header">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="afh-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
        <h1 className="afh-title">{PAGE_TITLE}</h1>
        <p className="afh-subtitle">
          Inspect past agent runs from anywhere in the app — chat, chip clicks, demo
          steps, and admin actions. Run agents elsewhere; this page is for reviewing
          what already happened.
        </p>
      </div>

      <div className="afh-body" style={{ '--afh-sidebar-w': `${sidebarWidth}px` }}>
        <aside className="afh-sidebar" aria-label="Run history">
          {runs === null && <div className="afh-sidebar-empty">Loading runs…</div>}
          {loadError && (
            <div className="afh-sidebar-empty afh-sidebar-error">
              {loadError}{' '}
              <button type="button" className="afh-retry-btn" onClick={fetchRuns}>
                Try again
              </button>
            </div>
          )}
          {runs && runs.length === 0 && !loadError && (
            <div className="afh-sidebar-empty">No agent runs recorded yet.</div>
          )}
          {runs && runs.map((run) => {
            const active = run.runId === selectedRun?.runId;
            const duration = formatDuration(run.startedAt, run.completedAt);
            const status = run.success === false ? 'failed' : 'success';
            return (
              <button
                type="button"
                key={run.runId}
                className={`afh-run-item${active ? ' afh-run-item--active' : ''}`}
                onClick={() => setSelectedRunId(run.runId)}
                aria-current={active}
              >
                <div className="afh-run-item-top">
                  <span className={`afh-status-badge afh-status-badge--${status}`}>
                    {status === 'failed' ? 'Failed' : 'Success'}
                  </span>
                  <span className="afh-run-time">{formatTimestamp(run.startedAt)}</span>
                </div>
                <div className="afh-run-item-mid">{truncatePrompt(run.prompt)}</div>
                <div className="afh-run-item-bottom">
                  {run.vertical || 'banking'}
                  {run.toolsCalled?.length
                    ? ` · ${run.toolsCalled.length} tool${run.toolsCalled.length === 1 ? '' : 's'}`
                    : ''}
                  {duration ? ` · ${duration}` : ''}
                </div>
              </button>
            );
          })}
        </aside>

        <div className="divider-drag-handle" aria-label="Resize run history" {...sidebarHandleProps} />

        <main className="afh-detail">
          {selectedRun ? (
            <AgentRunTimeline run={selectedRun} />
          ) : (
            <div className="afh-detail-empty">
              {runs === null ? 'Loading…' : 'Select a run from the history list to inspect it.'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
