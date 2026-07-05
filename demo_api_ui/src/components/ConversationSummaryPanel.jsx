import React, { useCallback, useEffect, useState } from 'react';
import './ConversationSummaryPanel.css';

/**
 * ConversationSummaryPanel — "Earlier in this conversation".
 *
 * Shows the summaries the Phase 2 continuity pipeline stored for the current
 * user + vertical (GET /api/conversations/me/:vertical/summaries — `me` is
 * resolved server-side to the authenticated subject, so no token sub is
 * needed client-side).
 *
 * Renders nothing until at least one summary exists, so fresh/short threads
 * are unaffected. Collapsed by default; expanding refetches so the list stays
 * current after a background summarization lands.
 */
export default function ConversationSummaryPanel({ vertical }) {
  const [summaries, setSummaries] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const fetchSummaries = useCallback(() => {
    if (!vertical) return;
    fetch(`/api/conversations/me/${encodeURIComponent(vertical)}/summaries`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.summaries)) setSummaries(data.summaries);
      })
      .catch(() => {
        /* silent — the panel is an enhancement, never an error surface */
      });
  }, [vertical]);

  // Initial load + reload when the vertical changes (threads are per-vertical).
  useEffect(() => {
    setSummaries([]);
    setExpanded(false);
    fetchSummaries();
  }, [fetchSummaries]);

  const onToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) fetchSummaries(); // refresh on open so new summaries appear
  };

  if (summaries.length === 0) return null;

  return (
    <div className="conv-summary-panel">
      <button
        type="button"
        className="conv-summary-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`conv-summary-caret${expanded ? ' conv-summary-caret--open' : ''}`} aria-hidden />
        Earlier in this conversation
        <span className="conv-summary-count">{summaries.length}</span>
      </button>

      {expanded && (
        <ul className="conv-summary-list">
          {[...summaries]
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .map((s) => (
              <li className="conv-summary-item" key={s.id}>
                <div className="conv-summary-meta">
                  <span className="conv-summary-date">
                    {s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}
                  </span>
                  <span className="conv-summary-badge">
                    {s.method === 'llm' ? 'AI summary' : 'Key points'}
                  </span>
                  <span className="conv-summary-span">
                    {s.originalMessages} messages
                  </span>
                </div>
                <p className="conv-summary-text">{s.summary}</p>
                {s.keyEntities && Array.isArray(s.keyEntities.actions) && s.keyEntities.actions.length > 0 && (
                  <div className="conv-summary-chips">
                    {s.keyEntities.actions.slice(0, 6).map((a) => (
                      <span className="conv-summary-chip" key={a}>{a}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
