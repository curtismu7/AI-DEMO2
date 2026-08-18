import React, { useEffect, useRef } from 'react';
import JSONViewer from './JSONViewer';
import TokenChainEventCard from './TokenChainEventCard';
import TokenInspector from './TokenInspector';

const LOGIN_URL = '/api/auth/oauth/user/login?return_to=/protocol-playground';

function errorText(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message || 'Execution failed';
}

/**
 * Synthesize a token-chain event from a step result when real events unavailable.
 * No invented narrative; only data that was actually computed.
 */
function synthesizeEvent(result) {
  if (!result || !result.response) return null;

  const status = result.response.status;
  const statusMap = {
    200: 'success', 201: 'success', 204: 'success',
    403: 'deny', 401: 'deny', 400: 'error', 500: 'error'
  };

  const endpoint = result.request?.url || 'Unknown';
  const method = result.request?.method || 'GET';

  return {
    label: `${method} ${endpoint}`,
    status: statusMap[status] || (status >= 200 && status < 300 ? 'success' : 'error'),
    explanation: `HTTP ${status}${result.decodedToken?.isValid ? ' (signed)' : ''}`,
    claims: result.decodedToken?.claims ? Object.entries(result.decodedToken.claims).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value)
    })) : []
  };
}

/** Full wire detail for one step: request, response, decoded token. */
function EntryDetail({ result }) {
  if (!result.request && !result.response) return null;

  return (
    <div className="entry-detail-group">
      {result.request && (
        <details className="entry-detail" open>
          <summary>
            <span className="entry-detail__tag">Request</span>
            <span className="entry-detail__meta">{result.request.method} {result.request.url}</span>
          </summary>
          <JSONViewer data={result.request} />
        </details>
      )}
      {result.response && (
        <details className="entry-detail" open>
          <summary>
            <span className="entry-detail__tag">Response</span>
            <span className="entry-detail__meta">
              HTTP {result.response.status}{result.response.statusText ? ` ${result.response.statusText}` : ''}
            </span>
          </summary>
          <JSONViewer data={result.response} />
        </details>
      )}
      {result.decodedToken?.isValid && (
        <TokenInspector token={result.decodedToken} />
      )}
    </div>
  );
}

export default function ActivityPanel({ results, error }) {
  const logRef = useRef(null);
  const entries = Array.isArray(results) ? results : [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const message = errorText(error);
  const needsSignIn = entries.some((result) => result.response?.status === 401);

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
      </div>

      {message && (
        <div className="activity-error">
          ❌ {message}
          {needsSignIn && (
            <>
              {' '}
              <a className="activity-error__signin" href={LOGIN_URL}>Sign in</a>
            </>
          )}
        </div>
      )}

      <div className="activity-log" ref={logRef}>
        {entries.length === 0 ? (
          <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>
        ) : (
          entries.map((result) => {
            const realEvents = result.response?.body?.tokenChainEvents;
            const hasRealEvents = Array.isArray(realEvents) && realEvents.length > 0;
            const synthesized = hasRealEvents ? null : synthesizeEvent(result);

            return (
              <div key={result.stepId} className="activity-entry-block">
                {hasRealEvents ? (
                  realEvents.map((event, idx) => (
                    <TokenChainEventCard key={idx} event={event} />
                  ))
                ) : synthesized ? (
                  <TokenChainEventCard event={synthesized} />
                ) : result.error ? (
                  <TokenChainEventCard
                    event={{ label: result.stepId, status: 'error', explanation: result.error }}
                  />
                ) : null}
                <EntryDetail result={result} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
