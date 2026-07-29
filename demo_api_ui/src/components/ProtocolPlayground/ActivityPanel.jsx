import React, { useEffect, useRef } from 'react';
import TokenInspector from './TokenInspector';

/** ExecutionEngine reports errors as objects; React can only render a string. */
function errorText(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message || 'Execution failed';
}

export default function ActivityPanel({ results, error }) {
  const logRef = useRef(null);
  const entries = Array.isArray(results) ? results : [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const lastResult = entries.length > 0 ? entries[entries.length - 1] : null;
  const message = errorText(error);

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
      </div>

      {message && (
        <div className="activity-error">
          ❌ {message}
        </div>
      )}

      <div className="activity-log" ref={logRef}>
        {entries.length === 0 ? (
          <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>
        ) : (
          entries.map((result) => {
            const status = result.response?.status;
            const ok = status >= 200 && status < 300;
            return (
              <div key={result.stepId} className="activity-entry">
                <div className="entry-header">
                  <span className="entry-step">{result.stepId}</span>
                  <span className={`entry-status status-${ok ? 'ok' : 'error'}`}>
                    {status ?? 'failed'}
                  </span>
                </div>
                <div className="entry-method">
                  {result.request
                    ? `${result.request.method} ${result.request.url}`
                    : errorText(result.error)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {lastResult?.response && (
        <div className="activity-details">
          <div className="details-section">
            <h5>Response</h5>
            <pre className="details-json">{JSON.stringify(lastResult.response, null, 2)}</pre>
          </div>

          {lastResult.decodedToken?.isValid && (
            <TokenInspector token={lastResult.decodedToken} />
          )}
        </div>
      )}
    </div>
  );
}
