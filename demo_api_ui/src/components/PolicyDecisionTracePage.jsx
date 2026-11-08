import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DraggableModal from './DraggableModal';
import PolicyDecisionTree from './PolicyDecisionTree';
import PageHeader from './common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList } from './pingUi';
import { useThemeOptional } from '../context/ThemeContext';
import {
  DECISION_LABELS, overallDecision, decisionTone, engineLabel, elapsedMs,
} from '../utils/policyDecisionSummary';
import './PolicyDecisionTracePage.css';

// ---------------------------------------------------------------------------
// Policy Decision Trace — full-page view of the P1AZ decision path.
//
// Reached from the "Open policy decision trace" button on PingOne Authorize
// (which navigates here with { policies, result } in router state). Direct
// URL hits and page refreshes lose that router state, so this page falls
// back to the last run persisted in localStorage, with a one-time-per-tab
// modal clarifying the data may be stale.
//
// Layout follows the Ping UI Standard (docs/ping-ui-primitives.md): P2 banner first,
// P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons. Nothing is evaluated on this page.
//
// One primary button per view state (P9), always "Back to PingOne Authorize", the one way
// forward from a read-only replay (run another evaluation):
//   - trace shown, or no trace loaded: the header "Back to PingOne Authorize" is the primary;
//   - saved-run modal open: the modal's "Go to PingOne Authorize" is the primary and the
//     header button drops to a secondary until the modal is dismissed.
// Dark mode, Dismiss and the tree's collapse / expand controls are always secondaries.
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
  const { darkMode, toggleDarkMode } = useThemeOptional();
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

  // The modal opens on mount and DraggableModal does not move focus into it, so Dismiss takes focus when it
  // appears (the safe choice: it only closes), and closing hands focus to the header's first button instead of
  // dropping it on <body>, so a keyboard user carries on from the top of the page.
  const closeStaleModal = () => {
    setShowStaleModal(false);
    markModalSeen();
    requestAnimationFrame(() => {
      document.querySelector('.pdt-page .pdt-actions button')?.focus();
    });
  };

  const goToAuthorize = () => {
    closeStaleModal();
    navigate('/pingone-authorize?tab=guided');
  };

  const summary = hasTrace ? summarize(result, freshTrace, savedAtLabel) : null;

  return (
    <PingPage className="pdt-page">
      <SimBanner data-testid="pdt-banner">
        <strong>{hasTrace ? 'REPLAY OF A PAST EVALUATION' : 'NO EVALUATION LOADED'}</strong> — nothing is
        evaluated on this page. It draws the result of an evaluation you ran on PingOne Authorize. The
        verdict, the returned statements and the total time are that engine's own output (the Engine row
        says whether it was PingOne or this app's simulated rules). PingOne returns no per-node trace, so
        which policy and rule nodes are marked active is derived here by matching statements to rule names.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · PingOne Authorize"
        title="Policy Decision Trace"
        summary="The policy set, policies and rules behind one decision, with the path the decision took."
        actions={(
          <HeaderActions
            modalOpen={showStaleModal}
            darkMode={darkMode}
            onBack={() => navigate('/pingone-authorize?tab=guided')}
            onToggleDark={toggleDarkMode}
          />
        )}
      />
      <PageFrame>
        {hasTrace ? (
          <>
            <Section
              id="pdt-decision"
              kicker="1 · Decision"
              title="What the engine decided"
            >
              <Card tone={summary.cardTone} title="Decision" data-testid="pdt-decision">
                <p className="pu-status-line">
                  <StatusChip tone={summary.tone}>{summary.label}</StatusChip>
                  {summary.sentence}
                </p>
                <KvList items={summary.items} />
                {summary.saved ? (
                  <p className="pu-note">
                    <StatusChip tone="warn">Saved run</StatusChip>{' '}
                    This is the last evaluation stored in this browser. It may not reflect the current policy configuration.
                  </p>
                ) : null}
              </Card>
            </Section>
            <Section
              id="pdt-path"
              kicker="2 · Execution path"
              title="Policy set, policy, rule"
              lede="Green nodes are on the path the decision took. Inactive branches are collapsed; open them to see what did not apply."
            >
              <Card tone="neutral" title="Policy tree" data-testid="pdt-tree-card">
                <PolicyDecisionTree policies={policies} result={result} embedded />
              </Card>
            </Section>
          </>
        ) : (
          <Section id="pdt-empty" kicker="1 · Decision" title="Nothing to show yet">
            <Card tone="neutral" title="No decision trace loaded" data-testid="pdt-empty">
              <p className="pu-status-line"><StatusChip tone="neutral">No evaluation</StatusChip></p>
              <p className="pu-note">Run an evaluation on PingOne Authorize, then open the trace from there.</p>
            </Card>
          </Section>
        )}
      </PageFrame>
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
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <button className="dm-close-btn" onClick={closeStaleModal} type="button" autoFocus>
              Dismiss
            </button>
            <button className="pdt-modal-primary" onClick={goToAuthorize} type="button">
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
    </PingPage>
  );
}

// Title-band actions. A component, not inline in the PageHeader prop: the page's one primary lives here.
function HeaderActions({ modalOpen, darkMode, onBack, onToggleDark }) {
  return (
    <div className="pu-actions pdt-actions">
      <button type="button" className={modalOpen ? 'pu-btn' : 'pu-btn pu-btn--primary'} onClick={onBack}>
        Back to PingOne Authorize
      </button>
      <button
        type="button"
        className="pu-btn"
        onClick={onToggleDark}
        title="Switch this page between light and dark"
        aria-pressed={darkMode}
      >
        {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
      </button>
    </div>
  );
}

function sentenceFor(engine) {
  if (engine.real) return 'Returned by the PingOne Authorize decision endpoint.';
  if (engine.label === 'Not recorded') return 'The saved result does not say which engine produced it.';
  return 'Returned by this app, not by a PingOne decision endpoint.';
}

// The decision card: chip word, one sentence, and the facts a reader needs to judge the replay.
function summarize(result, fresh, savedAtLabel) {
  const decision = overallDecision(result);
  const engine = engineLabel(result.engine);
  const ms = elapsedMs(result);
  const raw = result.pingoneResponse || result.raw || {};
  const statementCount = Array.isArray(raw.statements) ? raw.statements.length : 0;
  const label = DECISION_LABELS[decision] || decision.replace(/_/g, ' ');
  return {
    tone: decisionTone(decision),
    cardTone: decisionTone(decision),
    label: label.charAt(0) + label.slice(1).toLowerCase(),
    sentence: sentenceFor(engine),
    saved: !fresh,
    items: [
      { label: 'Engine', value: engine.label },
      { label: 'Evaluation time', value: ms == null ? 'Not reported' : `${ms.toFixed(3)} ms`, mono: ms != null },
      { label: 'Statements', value: String(statementCount) },
      { label: 'Evaluated', value: fresh ? 'Just now, from PingOne Authorize' : (savedAtLabel || 'Earlier') },
    ],
  };
}
