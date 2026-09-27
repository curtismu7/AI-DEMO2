/**
 * DemoStepsDropdown — presenter script picker next to the agent Actions menu.
 * Primary trust-ladder steps are always listed; advanced demos sit in a
 * collapsed "More demos" group (CIBA, A2A, attack deep-dives).
 * Testing + Attacks are separate collapsed groups on the Actions popout.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_JOURNEY_GROUPS,
  DEMO_PRIMARY_USE_CASE_IDS,
  DEMO_USE_CASE_SEARCH_TERMS,
  PRIVILEGE_USE_CASE_IDS,
} from '../config/demoUseCaseSteps';
import { getMissionControlGroup } from '../config/missionControlCatalog';
import apiClient from '../services/apiClient';
import UseCaseExplainModal from './UseCaseExplainModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { a2aEventsForExplain } from './demoStepsA2a';
import { ID_JAG_USE_CASE_ID, RUN_MODES, requestLiveIdJagRun } from '../utils/idJagRunMode';
import {
  clearCompletedUseCases,
  getCompletedUseCaseIds,
  BX_UC_PROGRESS_EVENT,
} from '../utils/useCaseDemoProgress';

const RAR_QUICK_RESULT_KEY = 'rar_intent_quick_result';
const DEMO_STEPS_DRAWER_OPEN_KEY = 'demo_steps_drawer_open_v1';
const DEMO_STEPS_DRAWER_WIDTH_KEY = 'demo_steps_drawer_width_v1';
const AGENT_TYPE_GROUP_ID = 'agent-types';
const PRIVILEGE_GROUP_ID = 'privilege';

export function readStoredDemoStepsOpen() {
  try {
    const value = window.localStorage.getItem(DEMO_STEPS_DRAWER_OPEN_KEY);
    return value === null ? true : value === 'true';
  } catch {
    return true;
  }
}

function readStoredDrawerWidth() {
  try {
    const width = Number(window.localStorage.getItem(DEMO_STEPS_DRAWER_WIDTH_KEY));
    return Number.isFinite(width) ? Math.min(900, Math.max(360, width)) : 470;
  } catch {
    return 470;
  }
}

/** UC14b's toggle: quick chat result (default) vs. the full /intent-binding-learning page. */
function readRarQuickResult() {
  try {
    const v = window.localStorage.getItem(RAR_QUICK_RESULT_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

/**
 * @param {object} props
 * @param {string} [props.vertical]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {(uc: object, stepNumber: number, opts?: {quickResult?: boolean}) => void} props.onSelect
 */
export default function DemoStepsDropdown({
  vertical = 'banking',
  disabled = false,
  open = false,
  onOpenChange,
  onSelect,
  onStopAgentClick,
}) {
  const triggerRef = useRef(null);
  const [primarySteps, setPrimarySteps] = useState([]);
  const [advancedSteps, setAdvancedSteps] = useState([]);
  const [ciamSteps, setCiamSteps] = useState([]);
  const [privilegeSteps, setPrivilegeSteps] = useState([]);
  const [activeGroup, setActiveGroup] = useState('all');
  const [rarQuickResult, setRarQuickResult] = useState(readRarQuickResult);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [explainUc, setExplainUc] = useState(null);
  const [query, setQuery] = useState('');
  const [drawerWidth, setDrawerWidth] = useState(readStoredDrawerWidth);
  const resizeRef = useRef(null);

  // finding #77: a vertical switch while the panel is open re-issues this
  // fetch before the previous vertical's request resolves — a monotonic
  // token discards a response that is no longer for the current vertical.
  const loadStepsReqIdRef = useRef(0);

  const loadSteps = useCallback(() => {
    const reqId = ++loadStepsReqIdRef.current;
    setLoading(true);
    setError(null);
    const isAdmin = vertical === 'pingone-admin';
    const primaryIds = isAdmin ? ADMIN_PRIMARY_USE_CASE_IDS : DEMO_PRIMARY_USE_CASE_IDS;
    const advancedIds = isAdmin ? [] : DEMO_ADVANCED_USE_CASE_IDS;
    apiClient
      .get('/api/use-cases', { params: { vertical }, _silent: true })
      .then(({ data }) => {
        if (reqId !== loadStepsReqIdRef.current) return;
        const catalog = data.useCases || [];
        const mapIds = (ids, offset) =>
          ids
            .map((id, index) => {
              const uc = catalog.find((u) => u.id === id);
              return uc ? { uc, stepNumber: offset + index + 1 } : null;
            })
            .filter(Boolean);
        setPrimarySteps(mapIds(primaryIds, 0));
        setAdvancedSteps(mapIds(advancedIds, primaryIds.length));
        const scriptedIds = new Set([...primaryIds, ...advancedIds]);
        setCiamSteps(
          mapIds(CIAM_AGENT_TYPE_USE_CASE_IDS, primaryIds.length + advancedIds.length)
            .filter(({ uc }) => !scriptedIds.has(uc.id)),
        );
        setPrivilegeSteps(
          mapIds(PRIVILEGE_USE_CASE_IDS, primaryIds.length + advancedIds.length + CIAM_AGENT_TYPE_USE_CASE_IDS.length),
        );
      })
      .catch((err) => {
        if (reqId !== loadStepsReqIdRef.current) return;
        // The backend 400s with unknown_vertical for verticals that have no
        // use-case catalog (e.g. the PingOne Admin console) — that is an
        // expected empty state for this dropdown, not a failure to report.
        if (err?.response?.data?.error !== 'unknown_vertical') {
          setError(err.message || 'Failed to load demo steps');
        }
        setPrimarySteps([]);
        setAdvancedSteps([]);
        setCiamSteps([]);
        setPrivilegeSteps([]);
      })
      .finally(() => {
        if (reqId === loadStepsReqIdRef.current) setLoading(false);
      });
  }, [vertical]);

  useEffect(() => {
    if (open) loadSteps();
    else setQuery('');
  }, [open, loadSteps]);

  useEffect(() => {
    const onProgress = () => setTick((n) => n + 1);
    window.addEventListener(BX_UC_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(BX_UC_PROGRESS_EVENT, onProgress);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DEMO_STEPS_DRAWER_OPEN_KEY, String(open));
      window.localStorage.setItem(DEMO_STEPS_DRAWER_WIDTH_KEY, String(drawerWidth));
    } catch {
      // Private browsing can reject storage; the drawer still works in memory.
    }
  }, [drawerWidth, open]);

  /** Toggle the right-side drawer from the existing agent toolbar. */
  function handleToggle() {
    if (disabled) return;
    onOpenChange(!open);
  }

  /** Resize from the drawer's left edge and remember the presenter's width. */
  function handleResizeStart(event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const startWidth = drawerWidth;
    const startX = event.clientX;
    resizeRef.current = { startWidth, startX };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
    if (target.setPointerCapture && event.pointerId != null) {
      try { target.setPointerCapture(event.pointerId); } catch { /* jsdom/browser edge */ }
    }
    const onMove = (moveEvent) => {
      const { startWidth: initialWidth, startX: initialX } = resizeRef.current || {};
      if (!initialWidth) return;
      const nextWidth = Math.min(
        900,
        Math.max(360, initialWidth + (initialX - moveEvent.clientX)),
      );
      setDrawerWidth(nextWidth);
    };
    const onEnd = () => {
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
  }

  /** Run a demo step and refresh checkmarks. */
  function handleSelect(uc, stepNumber) {
    onOpenChange(false);
    if (uc.id === 'UC40' && uc.useCaseId === ID_JAG_USE_CASE_ID) {
      requestLiveIdJagRun({
        mode: RUN_MODES.LIVE_ID_JAG,
        message: 'show my balance',
        returnTo: '/dashboard',
      });
      return;
    }
    // UC38/UC44 run in the dashboard agent as a chip prompt (their dedicated
    // /workload-agents page is opened via the secondary workload button below),
    // so the presenter stays on this page and the result lands in the agent.
    const selectedUc = ['UC38', 'UC44'].includes(uc.id) && uc.trigger?.type === 'link'
      ? { ...uc, trigger: { type: 'chip', text: uc.runPrompt || uc.trigger?.label } }
      : uc;
    onSelect(selectedUc, stepNumber, uc.id === 'UC14b' ? { quickResult: rarQuickResult } : undefined);
    setTick((n) => n + 1);
  }

  /** Flip UC14b's "open full page" vs "quick chat result" toggle; persists across sessions. */
  function handleRarQuickResultToggle() {
    setRarQuickResult((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(RAR_QUICK_RESULT_KEY, String(next)); } catch { /* private mode */ }
      return next;
    });
  }

  /** Open the explanation for a step without interrupting the presenter script. */
  function handleExplain(uc) {
    setExplainUc(uc);
  }

  /** UC38/UC44's dedicated page, with the active vertical carried in the query. */
  function handleWorkloadAgentsOpen(uc) {
    const url = new URL(uc.trigger?.path || `/workload-agents?useCase=${uc.id}`, window.location.origin);
    url.searchParams.set('vertical', vertical);
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  /** Reset demo check-offs for a fresh presenter pass. */
  function handleClearProgress() {
    clearCompletedUseCases();
    setTick((n) => n + 1);
  }

  // Counted over the primary steps only — that is the "scripted walkthrough"
  // the header names; the advanced group is opt-in extra material. Recomputed
  // each render, and `tick` is bumped by select/clear, so it refreshes on the
  // same path as the per-row checkmarks.
  void tick;
  // Read the completed-id Set once per render and reuse it below — finding
  // #79: `isUseCaseCompleted` re-parses sessionStorage on every call, and
  // this component was calling it 2-3x per row.
  const completedIds = getCompletedUseCaseIds();
  const completedCount = primarySteps.filter(({ uc }) =>
    completedIds.has(uc.id),
  ).length;
  const nextPrimaryId = primarySteps.find(({ uc }) => !completedIds.has(uc.id))?.uc
    ?.id;
  const progressPct =
    primarySteps.length > 0
      ? Math.round((completedCount / primarySteps.length) * 100)
      : 0;

  // Client-side filter on id + title. Progress above stays over the FULL
  // primary set — searching narrows what is shown, not what counts as done.
  const q = query.trim().toLowerCase();
  // Group filter chips mirror the 13 Guided Journey stages (/academy/journey).
  const activeMissionGroup = DEMO_JOURNEY_GROUPS.find((group) => group.id === activeGroup);
  const activeCatalogGroup = getMissionControlGroup(activeGroup);
  const activeGroupIds = activeGroup === 'all'
    ? null
    : activeGroup === AGENT_TYPE_GROUP_ID
      ? new Set(CIAM_AGENT_TYPE_USE_CASE_IDS)
      : new Set(activeMissionGroup?.useCaseIds || []);
  const scopedPrimary = activeGroupIds
    ? primarySteps.filter(({ uc }) => activeGroupIds.has(uc.id))
    : primarySteps;
  const scopedAdvanced = activeGroupIds
    ? advancedSteps.filter(({ uc }) => activeGroupIds.has(uc.id))
    : advancedSteps;
  const ciamIds = new Set(CIAM_AGENT_TYPE_USE_CASE_IDS);
  const scopedCiam = activeGroup === 'all' || activeGroup === AGENT_TYPE_GROUP_ID || activeMissionGroup?.useCaseIds?.some((id) => ciamIds.has(id))
    ? ciamSteps.filter(({ uc }) => !activeGroupIds || activeGroupIds.has(uc.id))
    : [];
  const privilegeIds = new Set(PRIVILEGE_USE_CASE_IDS);
  const scopedPrivilege = activeGroup === PRIVILEGE_GROUP_ID || activeMissionGroup?.useCaseIds?.some((id) => privilegeIds.has(id))
    ? privilegeSteps.filter(({ uc }) => !activeGroupIds || activeGroupIds.has(uc.id))
    : [];
  const matches = ({ uc }) =>
    !q ||
    uc.id.toLowerCase().includes(q) ||
    [
      uc.title,
      uc.demoLabel,
      uc.useCaseId,
      uc.trigger?.text,
      uc.whatToSay,
      uc.whatLong,
      ...(DEMO_USE_CASE_SEARCH_TERMS[uc.id] || []),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  const filteredPrimary = scopedPrimary.filter(matches);
  const filteredAdvanced = scopedAdvanced.filter(matches);
  const ciamGroupQuery = q === 'ciam' || q === 'ciam agent' || q === 'ciam agent types';
  const filteredCiam = ciamGroupQuery ? scopedCiam : scopedCiam.filter(matches);
  const privilegeGroupQuery = q === 'privilege' || q === 'jit' || q === 'privileged access';
  const filteredPrivilege = privilegeGroupQuery ? scopedPrivilege : scopedPrivilege.filter(matches);
  // A query surfaces matches regardless of the collapsed "More demos" state.
  const showAdvanced = q ? filteredAdvanced.length > 0 : advancedOpen;
  const noMatches =
    q && filteredPrimary.length === 0 && filteredAdvanced.length === 0 && filteredCiam.length === 0 && filteredPrivilege.length === 0;

  /**
   * Render one demo-step card (box style matching Actions grid).
   * @param {{ uc: object, stepNumber: number }} row
   * @param {{ markNext?: boolean }} [opts]
   */
  function renderStep({ uc, stepNumber }, { markNext = false, testId } = {}) {
    const completed = completedIds.has(uc.id);
    const isNext = markNext && !completed && uc.id === nextPrimaryId;
    const btnClass = [
      'banking-chips-dropdown__button',
      completed
        ? 'banking-chips-dropdown__button--done'
        : 'banking-chips-dropdown__button--heuristic',
      isNext ? 'ba-demo-steps-popout__card--next' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <li key={uc.id} className="ba-demo-steps-popout__card-item">
        <button
          type="button"
          className={btnClass}
          onClick={() => handleSelect(uc, stepNumber)}
          data-testid={testId || `demo-step-${uc.id}`}
          title={uc.id === 'UC40' ? 'Signs out the current session, then opens PingFederate login for the live ID-JAG run' : undefined}
        >
          {completed && (
            <span
              className="banking-chips-dropdown__check"
              aria-label="Completed"
            >
              ✓
            </span>
          )}
          <span className="ba-demo-steps-popout__id">{uc.id}</span>
          <span className={`banking-chips-dropdown__chip-name${uc.id === 'UC40' ? ' banking-chips-dropdown__chip-name--id-jag' : ''}`}>
            {uc.id === 'UC40' ? 'Run PingFederate ID-JAG' : uc.demoLabel || uc.title}
            {uc.id === 'UC40' && (
              <span className="ba-demo-steps-popout__id-jag-copy">
                Signs out your current session silently, then opens PingFederate login.
              </span>
            )}
          </span>
          {uc.demoSurface === 'hosted-pingone-mcp' && (
            <span
              className="ba-demo-steps-popout__hosted-badge"
              title="Calls the hosted PingOne MCP server and shows the live result in the agent reply"
            >
              Hosted MCP
            </span>
          )}
          {uc.resourceServer && (
            <span
              className="ba-demo-steps-popout__rs-badge"
              data-rs={uc.resourceServer.id}
              title={`${uc.resourceServer.name} :${uc.resourceServer.port}`}
            >
              :{uc.resourceServer.port}
            </span>
          )}
        </button>
        {['UC38', 'UC44'].includes(uc.id) && (
          <button
            type="button"
            className="ba-demo-steps-popout__workload-link"
            onClick={(e) => { e.stopPropagation(); onOpenChange(false); handleWorkloadAgentsOpen(uc); }}
            aria-label={`Open the ${uc.id} workload-agents page`}
            title="Open the dedicated workload-agents page for this demo (delegated identity walkthrough, security rail, and client window)"
            data-testid={`workload-page-${uc.id}`}
          >
            🪟
          </button>
        )}
        {uc.id === 'UC14b' && (
          <button
            type="button"
            className="ba-demo-steps-popout__rar-toggle"
            onClick={(e) => { e.stopPropagation(); handleRarQuickResultToggle(); }}
            aria-pressed={rarQuickResult}
            aria-label={rarQuickResult
              ? 'Result mode: quick chat reply, a simulated RAR check. Click to switch to the full intent-binding page, which makes the live PingOne PAR push.'
              : 'Result mode: full intent-binding page with the live PingOne PAR push. Click to switch to a quick chat reply, a simulated RAR check.'}
            title={rarQuickResult
              ? 'Quick result (simulated RAR check) — click to use the full page with the live PAR push'
              : 'Full page (live PAR push) — click to switch to a quick, simulated chat result'}
            data-testid="uc14b-result-toggle"
          >
            {rarQuickResult ? 'Q' : 'F'}
          </button>
        )}
        <button
          type="button"
          className="ba-demo-steps-popout__explain"
          onClick={() => handleExplain(uc)}
          title="Explain this step"
          aria-label={`Explain step ${stepNumber}: ${uc.id} — ${uc.title}`}
          data-testid={`demo-explain-${uc.id}`}
        />
      </li>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ba-demo-steps-trigger${open ? ' active' : ''}`}
        title="Demo steps — same script as /use-cases Demo section"
        onClick={handleToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="demo-steps-trigger"
      >
        Demo steps
      </button>
      {open && createPortal(
        // Keep the scrim outside FloatingPanel's stacking context so it can
        // cover the Command Dock while remaining below the body-portaled drawer.
        <div
          className="ba-demo-steps-drawer__scrim"
          aria-hidden="true"
          onMouseDown={() => onOpenChange(false)}
          data-testid="demo-steps-scrim"
        />,
        document.body,
      )}
      {open && createPortal(
        <aside
          className="ba-demo-steps-drawer"
          style={{ width: `${drawerWidth}px` }}
          role="dialog"
          aria-label="Demo steps"
          aria-modal="false"
          data-testid="demo-steps-popout"
          data-placement="right-overlay"
        >
          <button
            type="button"
            className="ba-demo-steps-drawer__resize"
            onPointerDown={handleResizeStart}
            aria-label="Resize Demo steps drawer"
            title="Drag to resize"
            data-testid="demo-steps-resize-handle"
          />
          <div className="ba-demo-steps-popout__header">
            <div className="ba-demo-steps-popout__header-top">
              <div>
                <div className="ba-demo-steps-drawer__kicker">Presenter mode</div>
                <h2 className="ba-demo-steps-drawer__title">Mission Control</h2>
                <p className="ba-demo-steps-drawer__subtitle">Run the trust story one proof at a time.</p>
              </div>
              <button
                type="button"
                className="ba-demo-steps-drawer__close"
                onClick={() => onOpenChange(false)}
                aria-label="Close Demo steps"
                data-testid="demo-steps-close"
              >
                ✕
              </button>
            </div>
            {primarySteps.length > 0 && (
              <div className="ba-demo-steps-drawer__progress-row">
                <span
                  className={`ba-demo-steps-popout__progress${
                    completedCount === primarySteps.length
                      ? ' ba-demo-steps-popout__progress--all'
                      : ''
                  }`}
                  data-testid="demo-steps-progress"
                >
                  {completedCount} of {primarySteps.length} done
                </span>
                <div className="ba-demo-steps-popout__track" aria-hidden="true">
                  <i style={{ width: `${progressPct}%` }} />
                </div>
                <span className="ba-demo-steps-drawer__time">12 min</span>
              </div>
            )}
            <div className="ba-demo-steps-popout__header-actions">
              <div className="ba-demo-steps-popout__academy-links">
                <a
                  href="/academy/journey"
                  className="ba-actions-trigger"
                >
                  Guided Journey
                </a>
                <a
                  href="/academy/demos"
                  className="ba-actions-trigger"
                >
                  Standalone Demos
                </a>
                <a
                  href="/academy/identity"
                  className="ba-actions-trigger"
                >
                  Agent Identity Academy
                </a>
              </div>
              <div className="ba-demo-steps-popout__search">
                <input
                  type="search"
                  className="ba-demo-steps-popout__search-input"
                  placeholder="Search steps…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search demo steps"
                  data-testid="demo-steps-search"
                />
                {query && (
                  <button
                    type="button"
                    className="ba-demo-steps-popout__search-clear"
                    onClick={() => setQuery('')}
                    title="Clear search"
                    aria-label="Clear search"
                    data-testid="demo-steps-search-clear"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="button"
                className="ba-demo-steps-popout__clear"
                onClick={handleClearProgress}
                title="Clear checkmarks for a fresh demo pass"
                data-testid="demo-steps-clear"
              >
                Clear progress
              </button>
              {onStopAgentClick && (
                <button
                  type="button"
                  className="ba-demo-steps-popout__stop-agent"
                  onClick={onStopAgentClick}
                  title="Revoke the agent's OAuth token at PingOne — stops it before its next tool call"
                  data-testid="demo-steps-stop-agent"
                >
                  Stop Agent
                </button>
              )}
            </div>
          </div>
          {loading && (
            <p className="ba-demo-steps-popout__status">Loading…</p>
          )}
          {error && (
            <p className="ba-demo-steps-popout__status ba-demo-steps-popout__status--error">
              {error}
            </p>
          )}
          {!loading && !error && primarySteps.length === 0 && (
            <p className="ba-demo-steps-popout__status">
              No demo steps for this vertical.
            </p>
          )}
          {noMatches && (
            <p
              className="ba-demo-steps-popout__status"
              data-testid="demo-steps-no-match"
            >
              No steps match “{query.trim()}”.
            </p>
          )}
          <div className="ba-demo-steps-drawer__body">
            <div className="ba-demo-steps-popout__group-filter" role="group" aria-label="Demo step groups">
              <button
                type="button"
                className="ba-demo-steps-popout__group-filter-button"
                aria-pressed={activeGroup === 'all'}
                data-testid="demo-steps-group-all"
                onClick={() => setActiveGroup('all')}
              >
                All
              </button>
              {DEMO_JOURNEY_GROUPS.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="ba-demo-steps-popout__group-filter-button"
                  title={group.description}
                  aria-pressed={activeGroup === group.id}
                  data-testid={`demo-steps-group-${group.id}`}
                  onClick={() => setActiveGroup(group.id)}
                >
                  {group.shortLabel}
                </button>
              ))}
            </div>
            {activeMissionGroup && filteredPrimary.length === 0 && filteredAdvanced.length === 0 && filteredCiam.length === 0 && filteredPrivilege.length === 0 && (
              <div className="ba-demo-steps-popout__group-empty" data-testid="demo-steps-group-empty">
                <strong>{activeMissionGroup.label}</strong>
                <span>{activeMissionGroup.description}</span>
                <small>{activeCatalogGroup?.status === 'live'
                  ? 'The live experience is available below; use its link to run the embedded flow.'
                  : 'This lane is a planned taxonomy entry; live steps will appear here when its flow is implemented.'}</small>
              </div>
            )}
            {activeCatalogGroup && (
              <section className="ba-demo-steps-popout__mission-links" data-testid="demo-steps-mission-links">
                <div className="ba-demo-steps-popout__group-heading">
                  <span>{activeCatalogGroup.product}</span>
                  <span>{activeCatalogGroup.status === 'planned' ? 'planned lane' : 'inspect & explain'}</span>
                </div>
                <div className="ba-demo-steps-popout__mission-link-columns">
                  <div>
                    <strong>Inspectors</strong>
                    <div className="ba-demo-steps-popout__mission-link-list">
                      {activeCatalogGroup.inspectors.map((item) => (
                        <a key={`${item.label}-${item.href}`} href={item.href}>
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </div>
                  <div>
                    <strong>Diagrams</strong>
                    <div className="ba-demo-steps-popout__mission-link-list">
                      {activeCatalogGroup.diagrams.map((item) => (
                        <a key={`${item.label}-${item.href}`} href={item.href}>
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </div>
                  {activeCatalogGroup.routes?.length > 0 && (
                    <div>
                      <strong>Run</strong>
                      <div className="ba-demo-steps-popout__mission-link-list">
                        {activeCatalogGroup.routes.map((item) => (
                          <a key={`${item.label}-${item.href}`} href={item.href}>{item.label}</a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
            <div className="ba-demo-steps-drawer__act-heading">
              <span>Act 1 / Establish the agent</span>
              <span>1 / 5</span>
            </div>
            <ul className="ba-demo-steps-popout__grid">
            {filteredPrimary.map((row) => renderStep(row, { markNext: !q }))}
            </ul>
            {advancedSteps.length > 0 && (
              <div className="ba-demo-steps-popout__advanced">
                {!q && (
                  <button
                    type="button"
                    className="ba-demo-steps-popout__advanced-toggle"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    aria-expanded={advancedOpen}
                    data-testid="demo-steps-advanced-toggle"
                  >
                    {advancedOpen ? '▾' : '▸'} More demos ({advancedSteps.length})
                  </button>
                )}
                {showAdvanced && (
                  <ul className="ba-demo-steps-popout__grid">
                    {filteredAdvanced.map((row) => renderStep(row))}
                  </ul>
                )}
              </div>
            )}
            {filteredCiam.length > 0 && (
              <section
                className="ba-demo-steps-popout__ciam"
                data-testid="demo-steps-ciam-group"
              >
                <div className="ba-demo-steps-popout__group-heading">
                  <span>CIAM agent types</span>
                  <span>live lanes</span>
                </div>
                <p className="ba-demo-steps-popout__group-intro">
                  Run a personal, digital-assistant, or denied agent lane through the same live demo handler.
                </p>
                <ul className="ba-demo-steps-popout__grid">
                  {filteredCiam.map((row) =>
                    renderStep(row, { testId: `demo-step-ciam-${row.uc.id}` }),
                  )}
                </ul>
              </section>
            )}
            {filteredPrivilege.length > 0 && (
              <section
                className="ba-demo-steps-popout__privilege"
                data-testid="demo-steps-privilege-group"
              >
                <div className="ba-demo-steps-popout__group-heading">
                  <span>Privilege & JIT Access</span>
                  <span>temporary control</span>
                </div>
                <p className="ba-demo-steps-popout__group-intro">
                  Request, approve, broker, observe, and revoke privileged agent access without standing credentials.
                </p>
                <ul className="ba-demo-steps-popout__grid">
                  {filteredPrivilege.map((row) =>
                    renderStep(row, { testId: `demo-step-privilege-${row.uc.id}` }),
                  )}
                </ul>
              </section>
            )}
          </div>
        </aside>,
        // Portal to the main window's body: the drawer is position:fixed, so
        // when the dock panel is popped out into its own window this would
        // otherwise open inside that small pop-out — the presenter needs the
        // steps drawer on the main window (2026-09-26).
        document.body
      )}
      {/* Rendered outside the popout so the explanation survives the
          outside-pointerdown close. */}
      <UseCaseExplainModal
        uc={explainUc}
        open={Boolean(explainUc)}
        a2aTokenEvents={a2aEventsForExplain(explainUc, tokenChainTraceStore)}
        zIndex={100062}
        onClose={() => setExplainUc(null)}
      />
    </>
  );
}
