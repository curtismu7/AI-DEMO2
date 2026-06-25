import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import './ApiCallDisplay.css';

export default function ApiCallDisplay({ sessionId = 'default' }) {
  const [apiCalls, setApiCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCall, setSelectedCall] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');

  const fetchApiCalls = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/api-calls?limit=50`);
      if (data.success) {
        setApiCalls(data.calls || []);
        setStats(data.stats || null);
      } else {
        setError(data.error || 'Failed to fetch API calls');
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch API calls');
    } finally {
      setLoading(false);
    }
  };

  const clearApiCalls = async () => {
    try {
      await apiClient.delete(`/api/api-calls`);
      setApiCalls([]);
      setStats(null);
      setSelectedCall(null);
    } catch (err) {
      setError(err.message || 'Failed to clear API calls');
    }
  };

  useEffect(() => {
    fetchApiCalls();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchApiCalls, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchApiCalls is recreated each render; sessionId is the real trigger
  }, [sessionId]);

  const filteredCalls = filterCategory === 'all' 
    ? apiCalls 
    : apiCalls.filter(call => call.category === filterCategory);

  const categories = stats ? Object.keys(stats.categories) : [];

  return (
    <div className="api-call-display">
      <div className="api-call-display-header">
        <h3>API Calls</h3>
        <div className="api-call-display-controls">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="api-call-filter"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchApiCalls}
            disabled={loading}
            className="api-call-button"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={clearApiCalls}
            className="api-call-button api-call-button--danger"
          >
            Clear
          </button>
        </div>
      </div>

      {stats && (
        <div className="api-call-stats">
          <span className="stat-item">Total: {stats.total}</span>
          <span className="stat-item stat-item--success">Success: {stats.successful}</span>
          <span className="stat-item stat-item--error">Failed: {stats.failed}</span>
          {stats.averageDuration && (
            <span className="stat-item">Avg Duration: {Math.round(stats.averageDuration)}ms</span>
          )}
        </div>
      )}

      {error && (
        <div className="api-call-error">
          {error}
        </div>
      )}

      <div className="api-call-list">
        {filteredCalls.length === 0 ? (
          <div className="api-call-empty">
            No API calls recorded yet
          </div>
        ) : (
          filteredCalls.map((call) => (
            <div
              key={call.id}
              className={`api-call-item ${call.success ? 'api-call-item--success' : 'api-call-item--error'}`}
              onClick={() => setSelectedCall(selectedCall?.id === call.id ? null : call)}
            >
              <div className="api-call-summary">
                <span className="api-call-method">{call.method}</span>
                <span className="api-call-url">{call.url}</span>
                <span className={`api-call-status ${call.success ? 'api-call-status--success' : 'api-call-status--error'}`}>
                  {call.response.status}
                </span>
                <span className="api-call-duration">
                  {call.duration ? `${call.duration}ms` : ''}
                </span>
                <span className="api-call-time">
                  {new Date(call.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {selectedCall?.id === call.id && (
                <div className="api-call-details">
                  <div className="api-call-detail-section">
                    <h4>Request</h4>
                    {call.request.headers && (
                      <div className="api-call-headers">
                        <h5>Headers</h5>
                        <pre>{JSON.stringify(call.request.headers, null, 2)}</pre>
                      </div>
                    )}
                    {call.request.body && (
                      <div className="api-call-body">
                        <h5>Body</h5>
                        <pre>{call.request.body}</pre>
                      </div>
                    )}
                  </div>
                  <div className="api-call-detail-section">
                    <h4>Response</h4>
                    {call.response.headers && (
                      <div className="api-call-headers">
                        <h5>Headers</h5>
                        <pre>{JSON.stringify(call.response.headers, null, 2)}</pre>
                      </div>
                    )}
                    {call.response.body && (
                      <div className="api-call-body">
                        <h5>Body</h5>
                        <pre>{call.response.body}</pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
