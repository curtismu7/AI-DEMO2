/**
 * ForensicAuditDashboard.jsx
 *
 * Forensic audit trail viewer for AI Safety Red Button
 * Displays kill events, rate limit violations, and state snapshots
 */

import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import JsonHighlight from './shared/JsonHighlight';
import './ForensicAuditDashboard.css';

/**
 * ForensicAuditDashboard Component
 * @param {string} agentId - ID of agent to show audit trail for
 */
export default function ForensicAuditDashboard({ agentId }) {
  const [auditTrail, setAuditTrail] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedEventId, setExpandedEventId] = useState(null);

  // Fetch audit trail on mount or when agentId changes
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    loadAuditTrail();
  }, [agentId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const loadAuditTrail = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/admin/audit-trail', {
        params: {
          agentId: agentId || 'mcp-agent-001',
          hours: 24,
          limit: 100,
        },
      });
      setAuditTrail(response.data.events || []);
    } catch (err) {
      setError(err.message || 'Failed to load audit trail');
      console.error('[ForensicAuditDashboard] Error loading audit trail:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleEventDetails = (eventId) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  const formatTimestamp = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 2,
    });
  };

  const getEventBadge = (eventType) => {
    if (eventType === 'agent_killed') {
      return { label: '🔴 AGENT KILLED', className: 'badge-killed' };
    }
    if (eventType === 'agent_rate_limit_exceeded') {
      return { label: '⚠️ RATE LIMIT', className: 'badge-rate-limit' };
    }
    if (eventType === 'agent_kill_failed') {
      return { label: '❌ KILL FAILED', className: 'badge-failed' };
    }
    return { label: `${eventType}`, className: 'badge-default' };
  };

  const getEventSummary = (event) => {
    if (event.event === 'agent_killed') {
      return `Agent stopped — Reason: ${event.kill_reason || 'unknown'}`;
    }
    if (event.event === 'agent_rate_limit_exceeded') {
      return `Rate limit exceeded — ${event.request_count}/${event.limit} requests`;
    }
    if (event.event === 'agent_kill_failed') {
      return `Kill failed — Error: ${event.error_message || 'unknown'}`;
    }
    return `Event: ${event.event}`;
  };

  if (loading && auditTrail.length === 0) {
    return <div className="audit-dashboard loading">Loading audit trail...</div>;
  }

  if (error) {
    return (
      <div className="audit-dashboard error">
        <div className="audit-error-message">Error: {error}</div>
        <button className="audit-retry-button" onClick={loadAuditTrail}>
          Retry
        </button>
      </div>
    );
  }

  if (auditTrail.length === 0) {
    return (
      <div className="audit-dashboard">
        <div className="audit-empty">No events recorded for this agent.</div>
      </div>
    );
  }

  return (
    <div className="audit-dashboard">
      <div className="audit-header">
        <h3>Forensic Audit Trail</h3>
        <span className="audit-event-count">{auditTrail.length} events</span>
      </div>

      <div className="audit-timeline">
        {auditTrail.map((event, index) => {
          const eventId = event.audit_id || `event-${index}`;
          const isExpanded = expandedEventId === eventId;
          const badge = getEventBadge(event.event);
          const summary = getEventSummary(event);

          return (
            <div key={eventId} className="audit-event">
              <div className="audit-event-header" onClick={() => toggleEventDetails(eventId)}>
                <div className="audit-event-time">
                  {formatTimestamp(event.timestamp)}
                </div>

                <div className="audit-event-badge">
                  <span className={`badge ${badge.className}`}>{badge.label}</span>
                </div>

                <div className="audit-event-summary">{summary}</div>

                <div className="audit-expand-toggle">
                  {isExpanded ? '▲' : '▼'}
                </div>
              </div>

              {isExpanded && (
                <details className="audit-event-details" open>
                  <summary className="audit-details-summary">Event Details</summary>
                  <pre className="audit-details-json jh-dark">
                    <JsonHighlight value={event} />
                  </pre>

                  {event.event === 'agent_killed' && event.state_snapshot_id && (
                    <div className="audit-state-preview">
                      <div className="preview-title">State Snapshot ID</div>
                      <div className="preview-content">{event.state_snapshot_id}</div>
                      {event.state_size_bytes && (
                        <div className="preview-info">
                          Size: {(event.state_size_bytes / 1024).toFixed(2)} KB
                        </div>
                      )}
                    </div>
                  )}

                  {event.event === 'agent_rate_limit_exceeded' && (
                    <div className="audit-violation-info">
                      <div className="info-row">
                        <span className="label">Current Count:</span>
                        <span className="value">{event.request_count}</span>
                      </div>
                      <div className="info-row">
                        <span className="label">Limit:</span>
                        <span className="value">{event.limit}</span>
                      </div>
                    </div>
                  )}
                </details>
              )}
            </div>
          );
        })}
      </div>

      <div className="audit-footer">
        <small>Showing {auditTrail.length} most recent events. Audit trail is immutable and retained for 90 days.</small>
      </div>
    </div>
  );
}
