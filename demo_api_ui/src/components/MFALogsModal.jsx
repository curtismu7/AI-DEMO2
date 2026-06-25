import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import DraggableModal from "./DraggableModal";
import "./MFALogsModal.css";

export default function MFALogsModal({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [logCount, setLogCount] = useState(50);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/api/mfa/test/logs?count=${logCount}`);
      if (data.success) setLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [logCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, logCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearLogs = async () => {
    try {
      await apiClient.delete("/api/mfa/test/logs");
      setLogs([]);
      setSelectedIndex(null);
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  const selectedLog = selectedIndex !== null ? logs[selectedIndex] : null;

  const footer = (
    <>
      <span className="logs-count">{logs.length} logs</span>
      <button type="button" className="dm-close-btn" onClick={onClose}>Close</button>
    </>
  );

  return (
    <DraggableModal
      isOpen
      onClose={onClose}
      title="MFA Test Logs"
      footer={footer}
      defaultWidth={720}
      defaultHeight={540}
      storageKey="mfa-logs-modal"
    >
      {/* Fixed controls bar */}
      <div className="logs-modal-controls" style={{ flexShrink: 0 }}>
        <label className="logs-checkbox">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh (2s)
        </label>
        <select
          className="logs-select"
          value={logCount}
          onChange={e => setLogCount(parseInt(e.target.value, 10))}
        >
          <option value={10}>Last 10</option>
          <option value={20}>Last 20</option>
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
        </select>
        <button type="button" className="logs-btn logs-btn--refresh" onClick={fetchLogs} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button type="button" className="logs-btn logs-btn--clear" onClick={clearLogs}>Clear</button>
      </div>

      {/* Scrollable log content */}
      <div className="logs-modal-content" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
        <div className="logs-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {logs.length === 0 ? (
            <div className="logs-empty">No logs yet</div>
          ) : (
            logs.map((log, idx) => (
              <div
                key={idx}
                className={`logs-item ${selectedIndex === idx ? "logs-item--selected" : ""}`}
                onClick={() => setSelectedIndex(selectedIndex === idx ? null : idx)}
              >
                <div className="logs-item-header">
                  <span className={`logs-type logs-type--${log.type || "debug"}`}>
                    {log.type || "DEBUG"}
                  </span>
                  <span className="logs-operation">{log.operation || log.message}</span>
                  <span className="logs-status">{log.status === "error" ? "ERROR" : "OK"}</span>
                  <span className="logs-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
                {selectedIndex === idx && log.details && (
                  <div className="logs-detail">
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {selectedLog && (
          <div className="logs-modal-detail" style={{ overflowY: 'auto' }}>
            <h3>Log Details</h3>
            <div className="logs-detail-content">
              <div className="logs-detail-field">
                <label>Type:</label>
                <span>{selectedLog.type || "DEBUG"}</span>
              </div>
              <div className="logs-detail-field">
                <label>Operation:</label>
                <span>{selectedLog.operation || selectedLog.message}</span>
              </div>
              <div className="logs-detail-field">
                <label>Timestamp:</label>
                <span>{new Date(selectedLog.timestamp).toLocaleString()}</span>
              </div>
              {selectedLog.details && (
                <div className="logs-detail-field">
                  <label>Details:</label>
                  <pre className="logs-detail-json">
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DraggableModal>
  );
}
