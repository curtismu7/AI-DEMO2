import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DraggableModal from './DraggableModal';
import PolicyDecisionTree from './PolicyDecisionTree';
import './KillSwitchConfirmModal.css';
import './PingOneMcpInspector.css';

// ---------------------------------------------------------------------------
// Policy Decision Trace — full-page view of the P1AZ decision path.
//
// Reached from the "Open policy decision trace" button on PingOne Authorize
// (which navigates here with { policies, result } in router state). Direct
// URL hits and page refreshes lose that router state, so this page falls
// back to the last run persisted in localStorage, with a one-time-per-tab
// modal clarifying the data may be stale.
// ---------------------------------------------------------------------------

const LAST_RUN_KEY = 'policyDecisionTrace.lastRun';
const MODAL_SEEN_KEY = 'policyDecisionTrace.historyModalSeen';
const MAX_STORED_CHARS = 500_000; // ~500KB JSON string length cap

function isValidTrace(policies, result) {
  return Array.isArray(policies) && policies.length > 0 && !!result;
}

function saveLastRun(policies, result) {
  try {
    const payload = JSON.stringify({ policies, result, savedAt: Date.now() });
    if (payload.length > MAX_STORED_CHARS) return;
    localStorage.setItem(LAST_RUN_KEY, payload);
  } catch {
    // quota exceeded or storage unavailable — skip silently, keep old value
  }
}

function loadLastRun() {
  try {
    const raw = localStorage.getItem(LAST_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !isValidTrace(parsed.policies, parsed.result)) return null;
    return parsed;
  } catch {
    return null; // corrupt JSON — treat as absent
  }
}

function hasSeenModalThisSession() {
  try {
    return sessionStorage.getItem(MODAL_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markModalSeen() {
  try {
    sessionStorage.setItem(MODAL_SEEN_KEY, '1');
  } catch {
    // ignore — worst case the modal reappears next mount
  }
}

export default function PolicyDecisionTracePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const stateFromNav = location.state || {};
  const freshTrace = isValidTrace(stateFromNav.policies, stateFromNav.result);

  const [historical, setHistorical] = useState(null);
  const [showStaleModal, setShowStaleModal] = useState(false);

  // Intentionally mount-only: this page instance corresponds to one nav;
  // location.state doesn't change without a fresh mount of this route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (freshTrace) {
      saveLastRun(stateFromNav.policies, stateFromNav.result);
      return;
    }
    const stored = loadLastRun();
    if (stored) {
      setHistorical(stored);
      if (!hasSeenModalThisSession()) {
        setShowStaleModal(true);
      }
    }
  }, []);

  const policies = freshTrace ? stateFromNav.policies : historical?.policies;
  const result = freshTrace ? stateFromNav.result : historical?.result;
  const hasTrace = isValidTrace(policies, result);

  const savedAtLabel = useMemo(() => {
    if (!historical || freshTrace) return '';
    try {
      return new Date(historical.savedAt).toLocaleString();
    } catch {
      return '';
    }
  }, [historical, freshTrace]);

  const closeStaleModal = () => {
    setShowStaleModal(false);
    markModalSeen();
  };

  const goToAuthorize = () => {
    closeStaleModal();
    navigate('/pingone-authorize?tab=guided');
  };

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
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--th-text-muted)', fontSize: '13px' }}>
          <p style={{ marginBottom: '8px', fontWeight: 600, color: 'var(--th-text)' }}>No decision trace loaded</p>
          <p>Run an evaluation on PingOne Authorize, then open the trace from there.</p>
        </div>
      )}
      <DraggableModal
        isOpen={showStaleModal}
        onClose={closeStaleModal}
        title="Viewing a saved decision"
        defaultWidth={460}
        defaultHeight={280}
        storageKey="policy-decision-stale-modal"
        minWidth={360}
        minHeight={220}
        footer={
          <>
            <button className="dm-close-btn" onClick={closeStaleModal} type="button">
              Dismiss
            </button>
            <button className="ksm-confirm-btn" onClick={goToAuthorize} type="button">
              Go to PingOne Authorize
            </button>
          </>
        }
      >
        <div className="dm-scroll">
          <p>
            You&apos;re viewing your last policy evaluation from PingOne Authorize,
            saved {savedAtLabel}. This may not reflect the current policy
            configuration.
          </p>
        </div>
      </DraggableModal>
    </div>
  );
}
