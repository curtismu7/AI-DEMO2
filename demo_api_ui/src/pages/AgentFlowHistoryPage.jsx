// demo_api_ui/src/pages/AgentFlowHistoryPage.jsx
// /agent-flow-inspector — master-detail history view. Left: past agent runs
// (GET /api/agent/runs). Right: the selected run's recorded events. Live
// execution happens elsewhere (the agent chat); this page is for inspecting
// past runs, not driving new ones.
import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import AgentRunTimeline from '../components/AgentRunTimeline';
import './AgentFlowHistoryPage.css';

const PAGE_TITLE = 'Agent & Token Flow History';

const STATUS_LABELS = {
  success: 'Success',
  failed: 'Failed',
  interrupted: 'Waiting on approval',
  in_progress: 'In progress',
};

function formatTimestamp(ms) {
  if (!ms) return 'Unknown time';
  return new Date(ms).toLocaleString();
}

function formatDuration(startedAt, lastEventAt) {
  if (!startedAt || !lastEventAt || lastEventAt <= startedAt) return null;
  const seconds = Math.round((lastEventAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export default function AgentFlowHistoryPage() {
  const [runs, setRuns] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    return () => { document.title = previousTitle; };
  }, []);

  const fetchRuns = useCallback(() => {
    apiClient
      .get('/api/agent/runs')
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

  // Default to the latest run once the list loads.
  useEffect(() => {
    if (runs && runs.length && selectedRunId == null) {
      setSelectedRunId(runs[0].runId);
    }
  }, [runs, selectedRunId]);

  return (
    <div className="agent-flow-history-page">
      <div className="afh-header">
        <h1 className="afh-title">{PAGE_TITLE}</h1>
        <p className="afh-subtitle">
          Inspect past agent runs — OAuth token lifecycle and execution events. Run agents
          from the banking chat; this page is for reviewing what already happened.
        </p>
      </div>

      <div className="afh-body">
        <aside className="afh-sidebar" aria-label="Run history">
          {runs === null && <div className="afh-sidebar-empty">Loading runs…</div>}
          {loadError && <div className="afh-sidebar-empty afh-sidebar-error">{loadError}</div>}
          {runs && runs.length === 0 && !loadError && (
            <div className="afh-sidebar-empty">No agent runs recorded yet.</div>
          )}
          {runs && runs.map((run) => {
            const active = run.runId === selectedRunId;
            const duration = formatDuration(run.startedAt, run.lastEventAt);
            return (
              <button
                type="button"
                key={run.runId}
                className={`afh-run-item${active ? ' afh-run-item--active' : ''}`}
                onClick={() => setSelectedRunId(run.runId)}
                aria-current={active}
              >
                <div className="afh-run-item-top">
                  <span className={`afh-status-badge afh-status-badge--${run.status}`}>
                    {STATUS_LABELS[run.status] || run.status}
                  </span>
                  <span className="afh-run-time">{formatTimestamp(run.startedAt)}</span>
                </div>
                <div className="afh-run-item-mid">
                  {run.frameworkLabel || 'Agent'} <span className="afh-run-id">· {run.runId}</span>
                </div>
                <div className="afh-run-item-bottom">
                  {run.eventCount} event{run.eventCount === 1 ? '' : 's'}
                  {duration ? ` · ${duration}` : ''}
                </div>
              </button>
            );
          })}
        </aside>

        <main className="afh-detail">
          {selectedRunId ? (
            <AgentRunTimeline runId={selectedRunId} />
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
