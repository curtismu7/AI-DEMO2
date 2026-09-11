import React, { useEffect, useRef, useState } from 'react';
import DraggableModal from '../DraggableModal';
import JSONViewer from './JSONViewer';
import TokenChainEventCard, { StatusBadge } from './TokenChainEventCard';
import TokenInspector from './TokenInspector';

const LOGIN_URL = '/api/auth/oauth/user/login?return_to=/protocol-playground';

const TAB_LABELS = { token: 'Token', request: 'Request', response: 'Response' };

function errorText(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message || 'Execution failed';
}

/**
 * One-line summary of a step result for its chain row.
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
  };
}

/**
 * Wire detail for one hop as tabs, not a stack: token (real chain events
 * and/or the decoded token), request, response. Tabs with nothing to show
 * are left out.
 */
function HopDetail({ result, tab, onTab }) {
  const realEvents = result.response?.body?.tokenChainEvents;
  const events = Array.isArray(realEvents) ? realEvents : [];
  const token = result.decodedToken?.isValid ? result.decodedToken : null;

  const tabs = [
    (events.length > 0 || token) && 'token',
    result.request && 'request',
    result.response && 'response',
  ].filter(Boolean);
  if (tabs.length === 0) return null;
  const current = tabs.includes(tab) ? tab : tabs[0];

  return (
    <div className="chain-hop__body">
      <div className="chain-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="chain-tab"
            aria-selected={t === current}
            onClick={() => onTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="chain-panel" role="tabpanel">
        {current === 'token' && (
          <>
            {events.map((event, idx) => (
              <TokenChainEventCard key={idx} event={event} />
            ))}
            {token && <TokenInspector token={token} />}
            {token && <JSONViewer data={token.payload} />}
          </>
        )}
        {current === 'request' && <JSONViewer data={result.request} />}
        {current === 'response' && <JSONViewer data={result.response} />}
      </div>
    </div>
  );
}

export default function ActivityPanel({ results, error, dark = false }) {
  const logRef = useRef(null);
  const entries = Array.isArray(results) ? results : [];
  // Hops are identified by position, not stepId: re-running a step appends a
  // second result with the same stepId. null follows the newest hop as a run
  // streams in; -1 means all closed.
  const [openIdx, setOpenIdx] = useState(null);
  const [tab, setTab] = useState('token');
  const [poppedOut, setPoppedOut] = useState(false);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  // Each new result (or a reset) hands the open hop back to the newest one.
  useEffect(() => {
    setOpenIdx(null);
  }, [entries.length]);

  const message = errorText(error);
  const needsSignIn = entries.some((result) => result.response?.status === 401);
  const activeIdx = openIdx === null ? entries.length - 1 : openIdx;

  // expandable=false is the column while the chain is popped out: rows still
  // pick the hop, the window shows its detail.
  const renderChain = (expandable) =>
    entries.map((result, idx) => {
      const summary = synthesizeEvent(result) || {
        label: result.stepId,
        status: result.error ? 'error' : null,
        explanation: result.error,
      };
      const open = idx === activeIdx;

      return (
        <div key={idx} className={`chain-hop${open ? ' chain-hop--open' : ''}`}>
          <button
            type="button"
            className="chain-hop__row"
            aria-expanded={expandable ? open : undefined}
            onClick={() => setOpenIdx(open ? -1 : idx)}
          >
            <span className="chain-hop__n">{idx + 1}</span>
            <span className="chain-hop__label">{summary.label}</span>
            <StatusBadge status={summary.status} />
            {summary.explanation && <span className="chain-hop__sub">{summary.explanation}</span>}
          </button>
          {open && expandable && <HopDetail result={result} tab={tab} onTab={setTab} />}
        </div>
      );
    });

  const empty = <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>;

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Token chain</h4>
        {entries.length > 0 && (
          <button
            type="button"
            className="activity-popout-btn"
            onClick={() => setPoppedOut(true)}
            disabled={poppedOut}
            title="Open the token chain in a window you can move and resize"
          >
            🪟 Pop out
          </button>
        )}
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
        {entries.length === 0 ? empty : renderChain(!poppedOut)}
      </div>

      <DraggableModal
        isOpen={poppedOut}
        onClose={() => setPoppedOut(false)}
        title="Token chain"
        noBackdrop
        footer={null}
        defaultWidth={640}
        defaultHeight={560}
        storageKey="pp-token-chain-window"
      >
        {/* The modal portals to document.body, outside the page — re-enter
            .protocol-playground so the --pp-* tokens and this page's own
            dark toggle apply inside the window too. */}
        <div className={`dm-scroll protocol-playground pp-chain-window${dark ? ' dark' : ''}`}>
          {entries.length === 0 ? empty : renderChain(true)}
        </div>
      </DraggableModal>
    </div>
  );
}
