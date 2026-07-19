// demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js
//
// /use-cases/live — A5.2: catalog drawer + real Token Chain, driven by the
// app's single real <AIAgent> squeezed into a narrow column (see App.js
// onLiveWorkbenchRoute / onMiddlePlacementInDashboard, wired in Task 3).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import { useVertical } from '../vertical/useVertical';
import VerticalSwitcher from '../components/VerticalSwitcher';
import { useAgentUiMode } from '../context/AgentUiModeContext';
import TokenChainTraceRail from '../components/TokenChainTraceRail';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildSimRailEvents } from '../services/tokenChainTrace/simTraceAdapter';
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

function triggerLabel(trigger) {
  if (!trigger) return '';
  return trigger.type === 'chip' ? `"${trigger.text}"` : `attack sim: ${trigger.sim}`;
}

function matchesQuery(uc, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return `${uc.title} ${uc.id} ${triggerLabel(uc.trigger)}`.toLowerCase().includes(q);
}

export default function LiveUseCaseWorkbenchPage() {
  const { activeId: vertical } = useVertical();
  const [useCases, setUseCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [runState, setRunState] = useState(null); // { id, state: 'running'|'error', msg? }

  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = useState(null);
  const agentHostRef = useCallback((node) => setAgentHostEl(node), []);

  useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((cur) => (cur === agentHostEl ? null : cur));
  }, [agentHostEl, setSurfaceHostEl]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient.get('/api/use-cases', { params: { vertical } })
      .then(({ data }) => {
        if (cancelled) return;
        setUseCases(data.useCases || []);
        setLoading(false);
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
    setRunState({ id: uc.id, state: 'running' });
    apiClient.post('/api/use-cases/demo/run', { useCaseId, vertical })
      .then(({ data }) => apiClient.post('/api/verticals/active', { id: vertical }).then(() => data))
      .then((data) => {
        setRunState(null);
        window.dispatchEvent(new CustomEvent('banking-agent-prefill', {
          detail: { message: data.triggerText, autoSend: true },
        }));
      })
      .catch((err) => {
        setRunState({ id: uc.id, state: 'error', msg: err.message || 'Failed to launch scenario' });
      });
  }, [vertical]);

  const handleRunAttack = useCallback((uc) => {
    setRunState({ id: uc.id, state: 'running' });
    tokenChainTraceStore.beginTrace({ prompt: `attack sim: ${uc.trigger.sim}` });
    apiClient.post('/api/demo/attack-sim/run', { sim: uc.trigger.sim })
      .then(({ data }) => {
        setRunState(null);
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

  const grouped = useMemo(
    () => TRACK_ORDER.map((track) => ({
      track,
      items: useCases.filter((uc) => uc.track === track && matchesQuery(uc, query)),
    })).filter((g) => g.items.length > 0),
    [useCases, query],
  );

  return (
    <div className="luw">
      <div className="luw-topbar">
        <p className="luw-topbar__title">Use Cases</p>
        <span className="luw-topbar__crumb">/ Live Workbench</span>
        <div className="luw-topbar__vertical"><VerticalSwitcher /></div>
      </div>

      <div className="luw-body">
        <nav className="luw-drawer" aria-label="Use case launcher">
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
            {!loading && !error && grouped.length === 0 && (
              <p className="luw-drawer__empty">No use cases match “{query}”.</p>
            )}
            {!loading && !error && grouped.map(({ track, items }) => (
              <details key={track} className={`luw-track luw-track--${track}`} open>
                <summary>
                  {TRACK_LABELS[track]}
                  <span className="luw-track__count">{items.length}</span>
                </summary>
                {items.map((uc) => {
                  const isChip = uc.trigger?.type === 'chip';
                  const isRunnableAttack = uc.trigger?.type === 'attack' && RUNNABLE_SIMS.includes(uc.trigger.sim);
                  const disabled = (!isChip && !isRunnableAttack) || runState?.state === 'running';
                  return (
                    <button
                      key={uc.id}
                      type="button"
                      className="luw-row"
                      disabled={disabled}
                      onClick={() => (isChip ? handleRunChip(uc) : handleRunAttack(uc))}
                    >
                      <span className="luw-row__main">
                        <span className="luw-row__title">{uc.id} — {uc.title}</span>
                        <span className="luw-row__trigger">{triggerLabel(uc.trigger)}</span>
                      </span>
                      <span className={`luw-pill luw-pill--${(uc.expectedOutcome || '').toLowerCase()}`}>
                        {uc.expectedOutcome}
                      </span>
                    </button>
                  );
                })}
              </details>
            ))}
          </div>
        </nav>

        <section className="luw-main" aria-label="Live run">
          <div className="luw-run-layout">
            <div id="luw-agent-host" className="luw-agent-host" ref={agentHostRef} />
            <div className="luw-rail-host">
              <TokenChainTraceRail />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
