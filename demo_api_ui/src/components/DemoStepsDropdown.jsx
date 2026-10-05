/**
 * DemoStepsDropdown — presenter Mission Control list and floating launcher.
 * The agent toolbar trigger is kept separate so the list can stay open while
 * the agent panel is collapsed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import FloatingPanel from './FloatingPanel';
import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_JOURNEY_GROUPS,
  DEMO_PRIMARY_USE_CASE_IDS,
  DEMO_SUB_STEP_IDS,
  DEMO_USE_CASE_SEARCH_TERMS,
  EXTRA_STEP_GROUPS,
  PRIVILEGE_USE_CASE_IDS,
} from '../config/demoUseCaseSteps';
import { getMissionControlGroup } from '../config/missionControlCatalog';
import { demoStepLabel, demoStepNumber, stepQueryMatches } from '../config/demoStepNumbers';
import apiClient from '../services/apiClient';
import UseCaseExplainModal from './UseCaseExplainModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { a2aEventsForExplain } from './demoStepsA2a';
import { ID_JAG_USE_CASE_ID, RUN_MODES, requestLiveIdJagRun } from '../utils/idJagRunMode';
import { LOGIN_RUN_PROVIDERS, runProviderLogin } from '../utils/providerLoginRun';
import {
  PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID,
  PRIVILEGE_A2A_CHAIN_USE_CASE_ID,
  PRIVILEGE_A2A_DEMO_QUESTIONS,
  runPrivilegeA2aChatRun,
  startPrivilegeA2aChainRun,
} from '../utils/privilegeA2aChainRun';
import {
  clearCompletedUseCases,
  getCompletedUseCaseIds,
  BX_UC_PROGRESS_EVENT,
} from '../utils/useCaseDemoProgress';

const RAR_QUICK_RESULT_KEY = 'rar_intent_quick_result';
const DEMO_STEPS_DRAWER_OPEN_KEY = 'demo_steps_drawer_open_v1';
const DEMO_STEPS_FLOATING_BUTTON_POS_KEY = 'demo_steps_floating_button_pos_v1';
const DEMO_STEPS_FLOATING_BUTTON_SIZE = 48;
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

function clampFloatingButtonPosition(
  x,
  y,
  width = DEMO_STEPS_FLOATING_BUTTON_SIZE,
  height = DEMO_STEPS_FLOATING_BUTTON_SIZE,
) {
  const pad = 8;
  return {
    x: Math.min(Math.max(x, pad), Math.max(pad, window.innerWidth - width - pad)),
    y: Math.min(Math.max(y, pad), Math.max(pad, window.innerHeight - height - pad)),
  };
}

function readStoredFloatingButtonPosition() {
  try {
    const value = window.localStorage.getItem(DEMO_STEPS_FLOATING_BUTTON_POS_KEY);
    const position = value ? JSON.parse(value) : null;
    if (typeof position?.x !== 'number' || typeof position?.y !== 'number') return null;
    return clampFloatingButtonPosition(position.x, position.y);
  } catch {
    return null;
  }
}

export function DemoStepsTrigger({ open = false, disabled = false, onOpenChange }) {
  return (
    <button
      type="button"
      className={`ba-demo-steps-trigger${open ? ' active' : ''}`}
      title="Demo steps — same script as /use-cases Demo section"
      onClick={() => { if (!disabled) onOpenChange(!open); }}
      disabled={disabled}
      aria-expanded={open}
      aria-haspopup="dialog"
      data-testid="demo-steps-trigger"
    >
      Demo steps
    </button>
  );
}

export function DemoStepsFloatingButton({ open = false, disabled = false, onOpen }) {
  const [position, setPosition] = useState(readStoredFloatingButtonPosition);
  const dragRef = useRef(null);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    if (!position) return undefined;
    const onResize = () => setPosition((current) => current
      ? clampFloatingButtonPosition(current.x, current.y)
      : current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* browser/jsdom edge */ }
  }, []);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    drag.moved = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = clampFloatingButtonPosition(drag.originX + dx, drag.originY + dy, rect.width, rect.height);
    drag.originX += next.x - (drag.originX + dx);
    drag.originY += next.y - (drag.originY + dy);
    setPosition(next);
    event.currentTarget.style.left = `${next.x}px`;
    event.currentTarget.style.top = `${next.y}px`;
    event.currentTarget.style.right = 'auto';
    event.currentTarget.style.bottom = 'auto';
  }, []);

  const handlePointerUp = useCallback((event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* browser/jsdom edge */ }
    if (!drag?.moved) return;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    const clamped = clampFloatingButtonPosition(rect.left, rect.top, rect.width, rect.height);
    setPosition(clamped);
    try {
      window.localStorage.setItem(DEMO_STEPS_FLOATING_BUTTON_POS_KEY, JSON.stringify(clamped));
    } catch { /* storage unavailable — position just won't persist */ }
  }, []);

  if (open) return null;

  return (
    <button
      type="button"
      className="ba-demo-steps-floating-trigger"
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => { if (!disabled && !justDraggedRef.current) onOpen?.(); }}
      disabled={disabled}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label="Open Demo steps"
      title="Demo steps — drag to move; click to open"
      data-testid="demo-steps-floating-trigger"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 6h12M9 12h12M9 18h12" />
        <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
      </svg>
    </button>
  );
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
 * @param {boolean} [props.showTrigger]
 * @param {boolean} [props.showFloatingButton]
 * @param {boolean} [props.persistOpenState]
 * @param {() => void} [props.onFloatingOpen]
 */
export default function DemoStepsDropdown({
  vertical = 'banking',
  disabled = false,
  open = false,
  onOpenChange,
  onSelect,
  onStopAgentClick,
  showTrigger = true,
  showFloatingButton = false,
  persistOpenState = open,
  onFloatingOpen,
  placement = 'floating',
  onPopOutChange,
  reserveRight = 0,
  // Window the panel opens in — the agent's pop-out window when opened from there.
  win = window,
}) {
  // True while the panel lives in a pop-out window: running a step must not
  // close the panel, or the pop-out window dies with it.
  const poppedOutRef = useRef(false);
  // Remount key for the panel: flips when the floating agent opens or closes so
  // the panel re-places itself clear of it. Frozen while popped out — a remount
  // would close the pop-out window.
  const placeKeyRef = useRef(reserveRight > 0);
  if (!poppedOutRef.current) placeKeyRef.current = reserveRight > 0;
  const [primarySteps, setPrimarySteps] = useState([]);
  const [advancedSteps, setAdvancedSteps] = useState([]);
  const [ciamSteps, setCiamSteps] = useState([]);
  const [privilegeSteps, setPrivilegeSteps] = useState([]);
  const [extraSteps, setExtraSteps] = useState({});
  const [activeGroup, setActiveGroup] = useState('all');
  const [rarQuickResult, setRarQuickResult] = useState(readRarQuickResult);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [explainUc, setExplainUc] = useState(null);
  const [query, setQuery] = useState('');

  // finding #77: a vertical switch while the panel is open re-issues this
  // fetch before the previous vertical's request resolves — a monotonic
  // token discards a response that is no longer for the current vertical.
  const loadStepsReqIdRef = useRef(0);
  const loadStepsControllerRef = useRef(null);

  const loadSteps = useCallback(() => {
    const reqId = ++loadStepsReqIdRef.current;
    loadStepsControllerRef.current?.abort();
    const controller = new AbortController();
    loadStepsControllerRef.current = controller;
    setLoading(true);
    setError(null);
    const isAdmin = vertical === 'pingone-admin';
    const primaryIds = isAdmin ? ADMIN_PRIMARY_USE_CASE_IDS : DEMO_PRIMARY_USE_CASE_IDS;
    const advancedIds = isAdmin ? [] : DEMO_ADVANCED_USE_CASE_IDS;
    apiClient
      .get('/api/use-cases', {
        params: { vertical },
        _silent: true,
        signal: controller.signal,
      })
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
        // Lettered sub-steps (25A) slot in after their parent without taking a number.
        const primaryRows = mapIds(primaryIds, 0).flatMap((row) => {
          const sub = isAdmin ? undefined : catalog.find((u) => u.id === DEMO_SUB_STEP_IDS[row.uc.id]);
          return sub ? [row, { uc: sub, stepNumber: row.stepNumber, stepLabel: demoStepLabel(sub.id) }] : [row];
        });
        setPrimarySteps(primaryRows);
        setAdvancedSteps(mapIds(advancedIds, primaryIds.length));
        const scriptedIds = new Set([...primaryIds, ...advancedIds]);
        setCiamSteps(
          mapIds(CIAM_AGENT_TYPE_USE_CASE_IDS, primaryIds.length + advancedIds.length)
            .filter(({ uc }) => !scriptedIds.has(uc.id)),
        );
        const privilegeOffset = primaryIds.length + advancedIds.length + CIAM_AGENT_TYPE_USE_CASE_IDS.length;
        setPrivilegeSteps(mapIds(PRIVILEGE_USE_CASE_IDS, privilegeOffset));
        // Themed groups follow Privilege; each continues the step numbering.
        let extraOffset = privilegeOffset + PRIVILEGE_USE_CASE_IDS.length;
        const extra = {};
        for (const group of EXTRA_STEP_GROUPS) {
          // A step listed in more than one group keeps the number it got first.
          extra[group.id] = mapIds(group.ids, extraOffset).map((row) => ({
            ...row,
            stepNumber: demoStepNumber(row.uc.id) ?? row.stepNumber,
          }));
          extraOffset += group.ids.length;
        }
        setExtraSteps(isAdmin ? {} : extra);
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
        setExtraSteps({});
      })
      .finally(() => {
        if (reqId === loadStepsReqIdRef.current) {
          loadStepsControllerRef.current = null;
          setLoading(false);
        }
      });
  }, [vertical]);

  useEffect(() => {
    if (open) loadSteps();
    else setQuery('');
    return () => {
      ++loadStepsReqIdRef.current;
      loadStepsControllerRef.current?.abort();
      loadStepsControllerRef.current = null;
    };
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
    if (persistOpenState == null) return;
    try {
      window.localStorage.setItem(DEMO_STEPS_DRAWER_OPEN_KEY, String(persistOpenState));
    } catch {
      // Private browsing can reject storage; the panel still works in memory.
    }
  }, [persistOpenState]);

  /** Run a demo step and refresh checkmarks. */
  function handleSelect(uc, stepNumber, chainRun = uc.chainRuns?.[0]) {
    if (!poppedOutRef.current) onOpenChange(false);
    if (uc.id === 'UC40' && uc.useCaseId === ID_JAG_USE_CASE_ID) {
      requestLiveIdJagRun({
        mode: RUN_MODES.LIVE_ID_JAG,
        message: 'show my balance',
        returnTo: '/dashboard',
      });
      return;
    }
    if (LOGIN_RUN_PROVIDERS[uc.id]) {
      void runProviderLogin(LOGIN_RUN_PROVIDERS[uc.id]);
      return;
    }
    // The Privilege A2A agent chain starts here and plays in the reel: launch
    // the run, then let the link trigger land the presenter on the dashboard.
    // The run keeps streaming into the trace store across that navigation.
    let chainRunPromise;
    if (uc.useCaseId === PRIVILEGE_A2A_CHAIN_USE_CASE_ID && chainRun) {
      const { message, specialist } = chainRun;
      chainRunPromise = startPrivilegeA2aChainRun({ message, specialist });
    }
    // Step 25A runs the A2A access review in the embedded agent: start the run, keep its
    // trace across the hop to /dashboard, and leave the route-opening Step 25 alone.
    if (uc.useCaseId === PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID) {
      const run = runPrivilegeA2aChatRun({ message: PRIVILEGE_A2A_DEMO_QUESTIONS[0] });
      run.catch(() => {}); // the agent reports the failure; this only marks it handled
      onSelect(uc, stepNumber, { keepTrace: true, run });
      setTick((n) => n + 1);
      return;
    }
    // UC38/UC44 run in the dashboard agent as a chip prompt (their dedicated
    // /workload-agents page is opened via the secondary workload button below),
    // so the presenter stays on this page and the result lands in the agent.
    const selectedUc = ['UC38', 'UC44'].includes(uc.id) && uc.trigger?.type === 'link'
      ? { ...uc, trigger: { type: 'chip', text: uc.runPrompt || uc.trigger?.label } }
      : uc;
    onSelect(
      selectedUc,
      stepNumber,
      uc.id === 'UC14b' ? { quickResult: rarQuickResult } : chainRunPromise ? { run: chainRunPromise } : undefined,
    );
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
  // In the "all" view the group is shown too, minus anything already listed in
  // the script above (UC40 is in both lists and keeps its script number).
  const scriptedIds = new Set(primarySteps.map(({ uc }) => uc.id));
  const scopedPrivilege = activeGroup === 'all' || activeGroup === PRIVILEGE_GROUP_ID || activeMissionGroup?.useCaseIds?.some((id) => privilegeIds.has(id))
    ? privilegeSteps.filter(({ uc }) =>
        (!activeGroupIds || activeGroupIds.has(uc.id)) && !(activeGroup === 'all' && scriptedIds.has(uc.id)))
    : [];
  const matches = ({ uc, stepNumber, stepLabel }) =>
    !q ||
    uc.id.toLowerCase().includes(q) ||
    stepQueryMatches(q, { id: uc.id, number: stepNumber, label: stepLabel }) ||
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
  // The themed groups show in the All view only (the filter chips scope the
  // script, not these); a search matches inside them, or by group name.
  const filteredExtra = EXTRA_STEP_GROUPS.map((group) => {
    const rows = activeGroup === 'all' ? extraSteps[group.id] || [] : [];
    const byName = q && group.label.toLowerCase().includes(q);
    return { group, rows: byName ? rows : rows.filter(matches) };
  }).filter(({ rows }) => rows.length > 0);
  const noMatches =
    q && filteredPrimary.length === 0 && filteredAdvanced.length === 0 && filteredCiam.length === 0 && filteredPrivilege.length === 0 && filteredExtra.length === 0;
  // reserveRight is the strip the floating agent occupies: centre in what is
  // left so the two never open on top of each other. Below ~320px of free
  // width there is no room and the panel keeps its minimum at the left edge.
  const availWidth = win.innerWidth - reserveRight;
  const panelWidth = Math.min(760, Math.max(320, availWidth - 32));
  const panelHeight = Math.min(660, Math.max(280, win.innerHeight - 72));
  const panelX = Math.max(8, Math.round((availWidth - panelWidth) / 2));

  /**
   * Render one demo-step card (box style matching Actions grid).
   * @param {{ uc: object, stepNumber: number }} row
   * @param {{ markNext?: boolean }} [opts]
   */
  // scope: set for the themed groups, where a step can repeat a card shown
  // earlier, so its extra test ids stay unique.
  function renderStep({ uc, stepNumber, stepLabel }, { markNext = false, testId, scope = '' } = {}) {
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
          <span className="ba-demo-steps-popout__id">{stepLabel ?? stepNumber} · {uc.id}</span>
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
        {/* The chain's other runs: the same hand-off, set up to be refused. */}
        {uc.useCaseId === PRIVILEGE_A2A_CHAIN_USE_CASE_ID && (uc.chainRuns || []).slice(1).map((run) => (
          <button
            key={run.id}
            type="button"
            className="ba-demo-steps-popout__rar-toggle"
            onClick={(e) => { e.stopPropagation(); handleSelect(uc, stepNumber, run); }}
            aria-label={`Run the agent chain: ${run.label}`}
            title={`Run the agent chain: ${run.label} — the gateway should refuse this one`}
            data-testid={`chain-run-${scope}${run.id}`}
          >
            {run.label.charAt(0)}
          </button>
        ))}
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
          data-testid={`demo-explain-${scope}${uc.id}`}
        />
      </li>
    );
  }

  return (
    <>
      {showTrigger && (
        <DemoStepsTrigger
          open={open}
          disabled={disabled}
          onOpenChange={onOpenChange}
        />
      )}
      {showFloatingButton && (
        <DemoStepsFloatingButton
          open={open}
          disabled={disabled}
          onOpen={onFloatingOpen || (() => onOpenChange(true))}
        />
      )}
      {open && (
        <FloatingPanel
          key={`${placeKeyRef.current ? 'beside-agent' : 'centered'}${win === window ? '' : '-popout'}`}
          win={win}
          title="Demo Steps"
          className="ba-demo-steps-float"
          placement={placement}
          onPopOutChange={(v) => { poppedOutRef.current = v; onPopOutChange?.(v); }}
          defaultWidth={placement === 'drawer' ? Math.min(560, window.innerWidth - 16) : panelWidth}
          defaultHeight={panelHeight}
          defaultX={panelX}
          defaultY={64}
          minWidth={placement === 'drawer' ? 360 : 320}
          minHeight={240}
          zIndex={100061}
          onClose={() => onOpenChange(false)}
          role="dialog"
          aria-label="Demo steps"
          aria-modal="false"
          data-testid="demo-steps-popout"
          data-placement={placement}
        >
          <div className="ba-demo-steps-float__content">
          <div className="ba-demo-steps-popout__header">
            <div className="ba-demo-steps-popout__header-top">
              <div>
                <div className="ba-demo-steps-float__kicker">Presenter mode</div>
                <h2 className="ba-demo-steps-float__title">Mission Control</h2>
                <p className="ba-demo-steps-float__subtitle">Run the trust story one proof at a time.</p>
              </div>
          </div>
          {primarySteps.length > 0 && (
              <div className="ba-demo-steps-float__progress-row">
                <span
                  className={`ba-demo-steps-popout__progress${
                    completedCount === primarySteps.length
                      ? ' ba-demo-steps-popout__progress--all'
                      : ''
                  }`}
                  data-testid="demo-steps-progress"
                >
                  {completedCount} of {primarySteps.length} script steps done
                </span>
                <div className="ba-demo-steps-popout__track" aria-hidden="true">
                  <i style={{ width: `${progressPct}%` }} />
                </div>
                <span className="ba-demo-steps-float__time">12 min</span>
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
                <a
                  href="/jev-learning"
                  className="ba-actions-trigger"
                >
                  Jev
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
          <div className="ba-demo-steps-float__body">
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
            <div className="ba-demo-steps-float__act-heading">
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
            {filteredExtra.map(({ group, rows }) => (
              <section
                key={group.id}
                className="ba-demo-steps-popout__privilege"
                data-testid={`demo-steps-extra-${group.id}`}
              >
                <div className="ba-demo-steps-popout__group-heading">
                  <span>{group.label}</span>
                  <span>{group.tagline}</span>
                </div>
                <p className="ba-demo-steps-popout__group-intro">{group.intro}</p>
                <ul className="ba-demo-steps-popout__grid">
                  {rows.map((row) =>
                    renderStep(row, { testId: `demo-extra-${group.id}-${row.uc.id}`, scope: `${group.id}-` }),
                  )}
                </ul>
              </section>
            ))}
          </div>
          </div>
        </FloatingPanel>
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
