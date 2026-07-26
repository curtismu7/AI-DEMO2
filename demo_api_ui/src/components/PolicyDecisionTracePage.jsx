import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PolicyDecisionTree from './PolicyDecisionTree';
import './PingOneMcpInspector.css';

// ---------------------------------------------------------------------------
// Policy Decision Trace — full-page view of the P1AZ decision path.
//
// Reached from the "Open policy decision trace" button on PingOne Authorize
// (which navigates here with { policies, result } in router state) or
// directly from the sidebar, in which case there's nothing to show yet.
// ---------------------------------------------------------------------------
export default function PolicyDecisionTracePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { policies, result } = location.state || {};
  const hasTrace = Array.isArray(policies) && policies.length > 0 && !!result;

  return (
    <div className="p1mcp-page">
      <div className="p1mcp-topbar">
        <h1>Policy Decision Trace</h1>
        <div className="p1mcp-topbar__right">
          <button
            className="p1mcp-topbar__btn"
            onClick={() => navigate('/pingone-authorize?tab=guided')}
          >
            Back to PingOne Authorize
          </button>
        </div>
      </div>
      {hasTrace ? (
        <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
          <PolicyDecisionTree policies={policies} result={result} />
        </div>
      ) : (
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          <p style={{ marginBottom: '8px', fontWeight: 600, color: '#0f172a' }}>No decision trace loaded</p>
          <p>Run an evaluation on PingOne Authorize, then open the trace from there.</p>
        </div>
      )}
    </div>
  );
}
