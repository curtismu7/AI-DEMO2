import React, { useState, useEffect, useCallback } from "react";
import "./MFALogsViewer.css";

export default function MFALogsViewer() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [logCount, setLogCount] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/mfa/test/logs?count=${logCount}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [logCount]);

  const clearLogs = async () => {
    if (!window.confirm("Clear all MFA logs?")) return;
    try {
      const response = await fetch("/api/mfa/test/logs", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLogs([]);
      setSelectedLog(null);
      alert("Logs cleared");
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadLogs();
    if (!autoRefresh) return;
    const interval = setInterval(loadLogs, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadLogs]);

  return (
    <div className="mfa-logs-viewer">
      <div className="logs-header">
        <h1>MFA Test Logs</h1>
        <div className="logs-controls">
          <button
            className="logs-btn logs-btn--refresh"
            onClick={loadLogs}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <label className="logs-checkbox">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (2s)
          </label>
          <select
            className="logs-select"
            value={logCount}
            onChange={(e) => setLogCount(parseInt(e.target.value, 10))}
          >
            <option value={10}>Last 10</option>
            <option value={20}>Last 20</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
          </select>
          <button
            className="logs-btn logs-btn--clear"
            onClick={clearLogs}
            disabled={logs.length === 0}
          >
            Clear Logs
          </button>
        </div>
      </div>

      {error && <div className="logs-error">{error}</div>}

      <div className="logs-container">
        <div className="logs-list">
          {logs.length === 0 ? (
            <div className="logs-empty">
              No logs yet. Run an MFA test to see logs here.
            </div>
          ) : (
            logs.map((log, idx) => (
              <div
                key={idx}
                className={`logs-item ${selectedLog === idx ? "logs-item--selected" : ""}`}
                onClick={() => setSelectedLog(selectedLog === idx ? null : idx)}
              >
                <div className="logs-item-header">
                  <span
                    className={`logs-type logs-type--${log.type.toLowerCase()}`}
                  >
                    {log.type}
                  </span>
                  <span className="logs-operation">{log.operation}</span>
                  <span className="logs-status">
                    {log.status ? `${log.status}` : log.error ? "ERROR" : "OK"}
                  </span>
                  <span className="logs-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {selectedLog === idx && (
                  <div className="logs-detail">
                    <pre>{JSON.stringify(log, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="logs-footer">
        <span className="logs-count">
          Showing {logs.length} of {logs.length} logs
        </span>
      </div>
    </div>
  );
}
