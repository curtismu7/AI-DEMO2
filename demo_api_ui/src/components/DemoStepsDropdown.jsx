/**
 * DemoStepsDropdown — presenter script picker next to the agent Actions menu.
 * Primary trust-ladder steps are always listed; advanced demos sit in a
 * collapsed "More demos" group (CIBA, A2A, attack deep-dives).
 * Testing + Attacks are separate collapsed groups on the Actions popout.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import FloatingPanel from './FloatingPanel';
import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
} from '../config/demoUseCaseSteps';
import apiClient from '../services/apiClient';
import UseCaseExplainModal from './UseCaseExplainModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { a2aEventsForExplain } from './demoStepsA2a';
import {
  clearCompletedUseCases,
  isUseCaseCompleted,
  BX_UC_PROGRESS_EVENT,
} from '../utils/useCaseDemoProgress';

/**
 * @param {object} props
 * @param {string} [props.vertical]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {(uc: object, stepNumber: number) => void} props.onSelect
 */
export default function DemoStepsDropdown({
  vertical = 'banking',
  disabled = false,
  open = false,
  onOpenChange,
  onSelect,
}) {
  const triggerRef = useRef(null);
  const panelPosRef = useRef({ x: 0, y: 0 });
  const [primarySteps, setPrimarySteps] = useState([]);
  const [advancedSteps, setAdvancedSteps] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [explainUc, setExplainUc] = useState(null);
  const [query, setQuery] = useState('');

  const loadSteps = useCallback(() => {
    setLoading(true);
    setError(null);
    const isAdmin = vertical === 'pingone-admin';
    const primaryIds = isAdmin ? ADMIN_PRIMARY_USE_CASE_IDS : DEMO_PRIMARY_USE_CASE_IDS;
    const advancedIds = isAdmin ? [] : DEMO_ADVANCED_USE_CASE_IDS;
    apiClient
      .get('/api/use-cases', { params: { vertical }, _silent: true })
      .then(({ data }) => {
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
      })
      .catch((err) => {
        // The backend 400s with unknown_vertical for verticals that have no
        // use-case catalog (e.g. the PingOne Admin console) — that is an
        // expected empty state for this dropdown, not a failure to report.
        if (err?.response?.data?.error !== 'unknown_vertical') {
          setError(err.message || 'Failed to load demo steps');
        }
        setPrimarySteps([]);
        setAdvancedSteps([]);
      })
      .finally(() => setLoading(false));
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

  /** Toggle the panel open/closed; capture trigger position for initial placement. */
  function handleToggle() {
    if (disabled) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 760;
      let x = rect.right - panelWidth;
      if (x < 8) x = 8;
      panelPosRef.current = { x, y: rect.bottom + 6 };
    }
    onOpenChange(!open);
  }

  /** Run a demo step and refresh checkmarks. */
  function handleSelect(uc, stepNumber) {
    onOpenChange(false);
    onSelect(uc, stepNumber);
    setTick((n) => n + 1);
  }

  /**
   * Open the explanation for a step. The popout must close first: it is
   * z-index 100061 (`.ba-actions-popout`) and DraggableModal defaults to 9999,
   * so leaving it open renders the modal behind the dropdown.
   */
  function handleExplain(uc) {
    onOpenChange(false);
    setExplainUc(uc);
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
  const completedCount = primarySteps.filter(({ uc }) =>
    isUseCaseCompleted(uc.id),
  ).length;
  const nextPrimaryId = primarySteps.find(({ uc }) => !isUseCaseCompleted(uc.id))?.uc
    ?.id;
  const progressPct =
    primarySteps.length > 0
      ? Math.round((completedCount / primarySteps.length) * 100)
      : 0;

  // Client-side filter on id + title. Progress above stays over the FULL
  // primary set — searching narrows what is shown, not what counts as done.
  const q = query.trim().toLowerCase();
  const matches = ({ uc }) =>
    !q ||
    uc.id.toLowerCase().includes(q) ||
    (uc.title || '').toLowerCase().includes(q);
  const filteredPrimary = primarySteps.filter(matches);
  const filteredAdvanced = advancedSteps.filter(matches);
  // A query surfaces matches regardless of the collapsed "More demos" state.
  const showAdvanced = q ? filteredAdvanced.length > 0 : advancedOpen;
  const noMatches =
    q && filteredPrimary.length === 0 && filteredAdvanced.length === 0;

  /**
   * Render one demo-step card (box style matching Actions grid).
   * @param {{ uc: object, stepNumber: number }} row
   * @param {{ markNext?: boolean }} [opts]
   */
  function renderStep({ uc, stepNumber }, { markNext = false } = {}) {
    const completed = isUseCaseCompleted(uc.id);
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
          data-testid={`demo-step-${uc.id}`}
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
          <span className="banking-chips-dropdown__chip-name">{uc.title}</span>
        </button>
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
        className={`ba-actions-trigger${open ? ' active' : ''}`}
        title="Demo steps — same script as /use-cases Demo section"
        onClick={handleToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="demo-steps-trigger"
      >
        Demo steps {open ? '▴' : '▾'}
      </button>
      {open && (
        <FloatingPanel
          title="Demo Steps"
          defaultX={panelPosRef.current.x}
          defaultY={panelPosRef.current.y}
          defaultWidth={760}
          defaultHeight={420}
          minWidth={420}
          minHeight={250}
          onClose={() => onOpenChange(false)}
          className="ba-demo-steps-float"
        >
          <div className="ba-demo-steps-popout__header">
            <div className="ba-demo-steps-popout__header-top">
              {primarySteps.length > 0 && (
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
              )}
            </div>
            {primarySteps.length > 0 && (
              <div
                className="ba-demo-steps-popout__track"
                aria-hidden="true"
              >
                <i style={{ width: `${progressPct}%` }} />
              </div>
            )}
            <div className="ba-demo-steps-popout__header-actions">
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
        </FloatingPanel>
      )}
      {/* Rendered outside the popout so the explanation survives the
          outside-pointerdown close. */}
      <UseCaseExplainModal
        uc={explainUc}
        open={Boolean(explainUc)}
        a2aTokenEvents={a2aEventsForExplain(explainUc, tokenChainTraceStore)}
        onClose={() => setExplainUc(null)}
      />
    </>
  );
}
