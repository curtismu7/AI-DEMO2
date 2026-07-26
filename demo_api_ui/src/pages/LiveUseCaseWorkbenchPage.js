// demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js
//
// /use-cases/live — A5.2 + Mock A chrome: demo cards + banking glance,
// catalog drawer + real Token Chain, single <AIAgent> in the host column
// (see App.js onLiveWorkbenchRoute).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useVertical } from '../vertical/useVertical';
import VerticalSwitcher from '../components/VerticalSwitcher';
import UseCaseProofHeader from '../components/UseCaseProofHeader';
import { findBeat } from '../components/demoScript';
import VerdictPair from '../components/VerdictPair';
import { useAgentUiMode } from '../context/AgentUiModeContext';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
import TokenChainTraceRail from '../components/TokenChainTraceRail';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildSimRailEvents } from '../services/tokenChainTrace/simTraceAdapter';
import {
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  SECURITY_DEMO_USE_CASE_IDS,
} from '../config/demoUseCaseSteps';
import './LiveUseCaseWorkbenchPage.css';

const RUNNABLE_SIMS = [
  'insufficient-scope', 'wrong-aud', 'cross-owner-account', 'replayed-token',
  'rogue-actor', 'rar-exceeded', 'tampered-intent-token', 'impersonation-no-act',
  'rate-limit-burst',
];

const TRACK_ORDER = ['foundations', 'controls', 'hitl', 'attacks'];
const TRACK_LABELS = {
  foundations: 'Foundations — delegation lifecycle',
  controls: 'Controls — policy governs the agent',
  hitl: 'Human-in-the-Loop — approval & step-up',
  attacks: 'Attacks — blocked by PingOne',
};

const DRAWER_CLOSED_KEY = 'luw_demo_script_collapsed';

const DEMO_ID_SET = new Set([
  ...DEMO_PRIMARY_USE_CASE_IDS,
  ...DEMO_ADVANCED_USE_CASE_IDS,
]);

/**
 * Format trigger for secondary card line.
 * @param {{ type?: string, text?: string, sim?: string }} [trigger]
 */
function triggerLabel(trigger) {
  if (!trigger) return '';
  return trigger.type === 'chip' ? `"${trigger.text}"` : `attack sim: ${trigger.sim}`;
}

/**
 * Case-insensitive catalog filter.
 * @param {object} uc
 * @param {string} query
 */
function matchesQuery(uc, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return `${uc.title} ${uc.id} ${triggerLabel(uc.trigger)}`.toLowerCase().includes(q);
}

/**
 * Map expectedOutcome / run result to a short glance policy label.
 * @param {string} [outcome]
 */
function policyLabel(outcome) {
  if (!outcome) return '—';
  const o = String(outcome).toUpperCase();
  if (o.includes('HITL')) return 'HITL';
  if (o.includes('STEP')) return 'MFA';
  if (o.includes('DENY')) return 'DENY';
  if (o.includes('PERMIT')) return 'PERMIT';
  return outcome;
}

/**
 * Live use-case workbench: Mock A cards + glance, Token Chain unchanged.
 */
export default function LiveUseCaseWorkbenchPage() {
  const { activeId: vertical } = useVertical();
  const navigate = useNavigate();
  const [useCases, setUseCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [runState, setRunState] = useState(null); // { id, state: 'running'|'error'|'done', msg? }
  const [selectedId, setSelectedId] = useState(null);
  const [glanceChecking, setGlanceChecking] = useState('$4,820.00');
  const [glanceRecent, setGlanceRecent] = useState('—');
  const { verdict } = useProofOfEnforcement();
  const [authorizeSeen, setAuthorizeSeen] = useState(null);

  // The observed decision, read straight off the token-chain trace. Never
  // derived from uc.expectedOutcome — that was the bug this replaces.
  useEffect(() => tokenChainTraceStore.subscribe((snap) => {
    const az = snap?.trace?.authorize;
    setAuthorizeSeen(az ? (az.outcome || az.decision || null) : null);
  }), []);

  const running = runState?.state === 'running';
  // The rail owns the room once a verdict settles, and keeps it until the next
  // run starts. Emphasis is visual only — DOM focus is never moved.
  const railFocus = !running && Boolean(verdict?.state);
  const verdictMatched = verdict?.state === 'verified' || verdict?.state === 'denied-as-expected';
  const announcement = railFocus
    ? `Run complete. ${verdictMatched ? 'Outcome matched.' : 'Outcome not proven.'}`
    : '';

  // Bring the authorize decision into view and pulse it — the rail is the proof,
  // so the eye should land on the step that decided the outcome. Purely additive:
  // no rail content is hidden, collapsed, or reordered.
  useEffect(() => {
    if (!railFocus) return undefined;
    const card = document.querySelector('[data-step-id="authorize-decision"]');
    if (!card) return undefined;
    card.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    card.classList.add('luw-step-pulse');
    const t = setTimeout(() => card.classList.remove('luw-step-pulse'), 2400);
    return () => clearTimeout(t);
  }, [railFocus]);

  const [drawerOpen, setDrawerOpen] = useState(() => {
    try {
      return localStorage.getItem(DRAWER_CLOSED_KEY) !== '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_CLOSED_KEY, drawerOpen ? '0' : '1');
    } catch {
      /* ignore */
    }
  }, [drawerOpen]);

  const edgeTabRef = useRef(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Return focus to the edge tab whenever the drawer closes, but not on the
  // initial mount (a persisted closed preference shouldn't steal focus from
  // wherever the page load put it).
  const skipFocusReturnRef = useRef(true);
  useEffect(() => {
    if (skipFocusReturnRef.current) {
      skipFocusReturnRef.current = false;
      return;
    }
    if (!drawerOpen) edgeTabRef.current?.focus();
  }, [drawerOpen]);

  // Escape closes the slide-over, matching the scrim click.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  const { setSurfaceHostEl, setToolbarHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = useState(null);
  const agentHostRef = useCallback((node) => setAgentHostEl(node), []);
  const [toolbarHostEl, setToolbarHostElNode] = useState(null);
  const toolbarHostRef = useCallback((node) => setToolbarHostElNode(node), []);

  useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((cur) => (cur === agentHostEl ? null : cur));
  }, [agentHostEl, setSurfaceHostEl]);

  // The agent's header control row portals here so it spans the full page width
  // instead of wrapping into six rows inside the middle column.
  useEffect(() => {
    setToolbarHostEl(toolbarHostEl);
    return () => setToolbarHostEl((cur) => (cur === toolbarHostEl ? null : cur));
  }, [toolbarHostEl, setToolbarHostEl]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient.get('/api/use-cases', { params: { vertical } })
      .then(({ data }) => {
        if (cancelled) return;
        const list = data.useCases || [];
        setUseCases(list);
        setLoading(false);
        const firstPrimary = DEMO_PRIMARY_USE_CASE_IDS
          .map((id) => list.find((u) => u.id === id))
          .find(Boolean);
        if (firstPrimary) setSelectedId(firstPrimary.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load use cases');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [vertical]);

  const handleRunChip = useCallback((uc) => {
    const useCaseId = uc.useCaseId;
    setSelectedId(uc.id);
    setRunState({ id: uc.id, state: 'running' });
    apiClient.post('/api/use-cases/demo/run', { useCaseId, vertical })
      .then(({ data }) => apiClient.post('/api/verticals/active', { id: vertical }).then(() => data))
      .then((data) => {
        setRunState({ id: uc.id, state: 'done' });
        if (String(uc.expectedOutcome || '').toUpperCase().includes('HITL')
          || /transfer/i.test(data.triggerText || '')) {
          setGlanceChecking('$4,570.00');
          setGlanceRecent('Transfer');
        }
        window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
          detail: { message: data.triggerText, autoSend: true, useCaseId: data.useCaseId },
        }));
      })
      .catch((err) => {
        setRunState({ id: uc.id, state: 'error', msg: err.message || 'Failed to launch scenario' });
      });
  }, [vertical]);

  const handleRunAttack = useCallback((uc) => {
    setSelectedId(uc.id);
    setRunState({ id: uc.id, state: 'running' });
    tokenChainTraceStore.beginTrace({ prompt: `attack sim: ${uc.trigger.sim}` });
    apiClient.post('/api/demo/attack-sim/run', { sim: uc.trigger.sim })
      .then(({ data }) => {
        setRunState({ id: uc.id, state: 'done' });
        const isDeny = typeof data?.status !== 'number' || data.status >= 400;
        // Same rail-feed wiring as AIAgent's own attack-sim handler (AIAgent.js) —
        // buildSimRailEvents remaps sim-* ids onto the full-pipeline steps
        // buildTraceSteps recognizes, and ingestAuthorize surfaces the real
        // PingOne Authorize DENY detail. Without both, the rail only shows a
        // bare pending/done dot with no request/response JSON.
        if (data?.tokenChainEvents?.length) {
          buildSimRailEvents(data).forEach((ev) => tokenChainTraceStore.ingestTokenEvent(ev));
          if (data.authorize) tokenChainTraceStore.ingestAuthorize(data.authorize);
        }
        tokenChainTraceStore.completeTrace(!isDeny);
      })
      .catch((err) => {
        tokenChainTraceStore.completeTrace(false);
        setRunState({ id: uc.id, state: 'error', msg: err.message || 'Attack simulation failed' });
      });
  }, []);

  // Link-type steps (e.g. UC14b PAR verified) open a learning page. POST
  // demo/run first so the backend arms the step's feature flag (ff_rar), then
  // SPA-navigate so the teleprompter overlay and the session cookie survive.
  const handleOpenLink = useCallback((uc) => {
    setSelectedId(uc.id);
    const path = uc.trigger?.path || '';
    apiClient.post('/api/use-cases/demo/run', { useCaseId: uc.useCaseId, vertical })
      .catch(() => {})
      .finally(() => {
        const hashIdx = path.indexOf('#');
        if (hashIdx >= 0) {
          navigate({ pathname: path.slice(0, hashIdx), hash: path.slice(hashIdx) });
        } else if (path) {
          navigate(path);
        }
      });
  }, [vertical, navigate]);

  /** Run the selected card (chip, attack, or link). */
  const handleRunSelected = useCallback((uc) => {
    if (uc.trigger?.type === 'chip') {
      handleRunChip(uc);
      return;
    }
    if (uc.trigger?.type === 'attack' && RUNNABLE_SIMS.includes(uc.trigger.sim)) {
      handleRunAttack(uc);
      return;
    }
    if (uc.trigger?.type === 'link' && uc.trigger.path) {
      handleOpenLink(uc);
    }
  }, [handleRunChip, handleRunAttack, handleOpenLink]);

  // Run a use case triggered from the Demo Script teleprompter. Uses the shared
  // 'demo-script' BroadcastChannel so a Run click from the in-page modal OR the
  // popped-out 2nd-screen window lands here exactly once, and reuses the same
  // handleRunSelected path the tiles use.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel('demo-script');
    const onMsg = (e) => {
      if (e.data?.type !== 'run' || !e.data.ucId) return;
      const uc = useCases.find((u) => u.id === e.data.ucId);
      if (!uc) return;
      setSelectedId(uc.id);
      handleRunSelected(uc);
    };
    channel.addEventListener('message', onMsg);
    return () => {
      channel.removeEventListener('message', onMsg);
      channel.close();
    };
  }, [useCases, handleRunSelected]);

  const primaryDemo = useMemo(
    () => DEMO_PRIMARY_USE_CASE_IDS
      .map((id) => useCases.find((uc) => uc.id === id))
      .filter(Boolean)
      .filter((uc) => matchesQuery(uc, query)),
    [useCases, query],
  );

  const securityDemo = useMemo(
    () => SECURITY_DEMO_USE_CASE_IDS
      .map((id) => useCases.find((uc) => uc.id === id))
      .filter(Boolean)
      .filter((uc) => matchesQuery(uc, query)),
    [useCases, query],
  );

  const advancedDemo = useMemo(
    () => DEMO_ADVANCED_USE_CASE_IDS
      .map((id) => useCases.find((uc) => uc.id === id))
      .filter(Boolean)
      .filter((uc) => matchesQuery(uc, query)),
    [useCases, query],
  );

  const groupedOther = useMemo(
    () => TRACK_ORDER.map((track) => ({
      track,
      items: useCases.filter(
        (uc) => uc.track === track
          && !DEMO_ID_SET.has(uc.id)
          && matchesQuery(uc, query),
      ),
    })).filter((g) => g.items.length > 0),
    [useCases, query],
  );

  const selectedUc = useCases.find((u) => u.id === selectedId) || null;
  const selectedBeat = findBeat(selectedId);

  // Mirror selection to the teleprompter (in-page modal or 2nd-screen pop-out)
  // over the same channel it already uses to send us `run` messages.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined' || !selectedId) return undefined;
    const channel = new BroadcastChannel('demo-script');
    channel.postMessage({ type: 'select', ucId: selectedId });
    return () => channel.close();
  }, [selectedId]);

  /**
   * Render a Mock A–style use-case card.
   * @param {object} uc
   * @param {number} [stepNumber]
   */
  function renderCard(uc, stepNumber) {
    const isChip = uc.trigger?.type === 'chip';
    const isRunnableAttack = uc.trigger?.type === 'attack' && RUNNABLE_SIMS.includes(uc.trigger.sim);
    const isLink = uc.trigger?.type === 'link' && !!uc.trigger.path;
    const canRun = isChip || isRunnableAttack || isLink;
    const isSelected = selectedId === uc.id;
    const isRunning = runState?.id === uc.id && runState.state === 'running';
    const isDone = runState?.id === uc.id && runState.state === 'done';
    const title = stepNumber
      ? `${stepNumber} · ${uc.title}`
      : `${uc.id} · ${uc.title}`;
    let meta = uc.id;
    if (isDone) meta = `${uc.id} · Done`;
    else if (isRunning) meta = `${uc.id} · Running`;
    else if (isSelected) meta = `${uc.id} · Ready`;
    else if (uc.expectedOutcome) meta = `${uc.id} · ${uc.expectedOutcome}`;

    return (
      <div
        key={uc.id}
        className={
          'luw-card'
          + (isSelected ? ' is-active' : '')
          + (isDone ? ' is-done' : '')
          + (isRunning ? ' is-running' : '')
        }
        role="button"
        tabIndex={0}
        onClick={() => setSelectedId(uc.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedId(uc.id);
          }
        }}
      >
        <p className="luw-card__title">{title}</p>
        <p className="luw-card__meta">{meta}</p>
        {canRun && (
          <button
            type="button"
            className="luw-card__run"
            disabled={runState?.state === 'running'}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(uc.id);
              handleRunSelected(uc);
            }}
          >
            {isRunnableAttack ? 'Run sim →' : isLink ? 'Open page →' : isDone ? 'Run again →' : 'Run in agent →'}
          </button>
        )}
        {!canRun && (
          <p className="luw-card__hint">Not runnable in live workbench</p>
        )}
      </div>
    );
  }

  return (
    <div className="luw">
      <div className="luw-topbar">
        <p className="luw-topbar__title">Use Cases</p>
        <span className="luw-topbar__crumb">/ Live Workbench</span>
        <div className="luw-topbar__vertical"><VerticalSwitcher /></div>
        <div className="luw-topbar__agent-tools" ref={toolbarHostRef} />
      </div>

      <div className={`luw-body${drawerOpen ? '' : ' luw-body--drawer-closed'}`}>
        <button
          type="button"
          ref={edgeTabRef}
          className="luw-drawer-tab"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open demo script"
          title="Open demo script"
        >
          Demo script <span aria-hidden="true">→</span>
        </button>
        <div
          className="luw-drawer__scrim"
          onClick={closeDrawer}
          aria-hidden="true"
        />
        <nav className="luw-drawer" aria-label="Use case launcher">
          <div className="luw-drawer__head">
            <button
              type="button"
              className="luw-drawer__toggle"
              onClick={closeDrawer}
              aria-expanded={drawerOpen}
              aria-label="Close demo script"
              title="Close"
            >
              ←
            </button>
            <h1 className="luw-drawer__title">Demo script</h1>
            <p className="luw-drawer__sub">Pick a step — agent runs on the right</p>
          </div>
          <div className="luw-drawer__search">
            <input
              type="text"
              placeholder="Filter use cases…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          {runState?.state === 'error' && (
            <p className="luw-drawer__empty">{runState.msg}</p>
          )}
          <div className="luw-drawer__scroll">
            {loading && <p className="luw-drawer__empty">Loading…</p>}
            {error && <p className="luw-drawer__empty">{error}</p>}
            {!loading && !error && primaryDemo.length === 0 && advancedDemo.length === 0 && groupedOther.length === 0 && (
              <p className="luw-drawer__empty">No use cases match “{query}”.</p>
            )}

            {!loading && !error && securityDemo.length > 0 && (
              <details className="luw-track luw-track--security" open>
                <summary>
                  15-Min Security Demo
                  <span className="luw-track__count">{securityDemo.length}</span>
                </summary>
                {securityDemo.map((uc, i) => renderCard(uc, i + 1))}
              </details>
            )}

            {!loading && !error && primaryDemo.map((uc, i) => renderCard(uc, i + 1))}

            {!loading && !error && advancedDemo.length > 0 && (
              <details className="luw-track luw-track--more">
                <summary>
                  More demos
                  <span className="luw-track__count">{advancedDemo.length}</span>
                </summary>
                {advancedDemo.map((uc) => renderCard(uc))}
              </details>
            )}

            {!loading && !error && groupedOther.map(({ track, items }) => (
              <details key={track} className={`luw-track luw-track--${track}`} open={track === 'attacks'}>
                <summary>
                  {TRACK_LABELS[track]}
                  <span className="luw-track__count">{items.length}</span>
                </summary>
                {items.map((uc) => renderCard(uc))}
              </details>
            ))}
          </div>
        </nav>

        <section className="luw-main" aria-label="Live run">
          <div className="luw-main__stage">
            <UseCaseProofHeader uc={selectedUc} beat={selectedBeat} />
            <p className="luw-sr-only" aria-live="polite">{announcement}</p>
            <div className={`luw-run-layout${railFocus ? ' luw-run-layout--rail-focus' : ''}`}>
              <div id="luw-agent-host" className="luw-agent-host" ref={agentHostRef} />
              <div className="luw-rail-host">
                {railFocus && (
                  <div className="luw-rail-verdict" data-testid="rail-verdict">
                    {verdict?.state === 'incomplete' ? 'Unproven' : (authorizeSeen || '—')}
                  </div>
                )}
                <TokenChainTraceRail />
              </div>
            </div>
          </div>
          <div className="luw-glance" aria-label="Banking glance">
            <div className="luw-glance__cell">
              <span className="luw-glance__label">Checking</span>
              <span className="luw-glance__value">{glanceChecking}</span>
            </div>
            <div className="luw-glance__cell">
              <span className="luw-glance__label">Verdict</span>
              <VerdictPair
                expected={policyLabel(selectedUc?.expectedOutcome)}
                actual={authorizeSeen}
                state={verdict?.state || null}
                running={runState?.state === 'running'}
              />
            </div>
            <div className="luw-glance__cell">
              <span className="luw-glance__label">Recent</span>
              <span className="luw-glance__value">{glanceRecent}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
