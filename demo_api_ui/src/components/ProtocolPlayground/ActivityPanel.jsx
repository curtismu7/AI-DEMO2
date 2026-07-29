import React, { useEffect, useRef } from 'react';
import TokenInspector from './TokenInspector';

export default function ActivityPanel({ results, error }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const lastResult = results.length > 0 ? results[results.length - 1] : null;

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
      </div>

      {error && (
        <div className="activity-error">
          ❌ {error}
        </div>
      )}

      <div className="activity-log" ref={logRef}>
        {results.length === 0 ? (
          <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>
        ) : (
          results.map((result, i) => (
            <div key={i} className="activity-entry">
              <div className="entry-header">
                <span className="entry-step">{result.stepId}</span>
                <span className={`entry-status status-${result.response.status >= 200 && result.response.status < 300 ? 'ok' : 'error'}`}>
                  {result.response.status}
                </span>
              </div>
              <div className="entry-method">{result.request.method} {result.request.url}</div>
            </div>
          ))
        )}
      </div>

      {lastResult && (
        <div className="activity-details">
          <div className="details-section">
            <h5>Response</h5>
            <pre className="details-json">{JSON.stringify(lastResult.response, null, 2)}</pre>
          </div>

          {lastResult.decodedToken && lastResult.decodedToken.isValid && (
            <TokenInspector token={lastResult.decodedToken} />
          )}
        </div>
      )}
    </div>
  );
}
