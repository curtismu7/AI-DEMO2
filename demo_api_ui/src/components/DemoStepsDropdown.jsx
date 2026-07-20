/**
 * DemoStepsDropdown — presenter script picker next to the agent Actions menu.
 * Primary trust-ladder steps are always listed; advanced demos sit in a
 * collapsed "More demos" group (CIBA, A2A, attack deep-dives).
 * Testing + Attacks are separate collapsed groups on the Actions popout.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const popoutRef = useRef(null);
  const [primarySteps, setPrimarySteps] = useState([]);
  const [advancedSteps, setAdvancedSteps] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [explainUc, setExplainUc] = useState(null);

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
  }, [open, loadSteps]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (
        popoutRef.current?.contains(e.target) ||
        triggerRef.current?.contains(e.target)
      ) {
        return;
      }
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !popoutRef.current || !triggerRef.current) return;
    const reposition = () => {
      const trigger = triggerRef.current;
      const popout = popoutRef.current;
      if (!trigger || !popout) return;
      const rect = trigger.getBoundingClientRect();
      // Measured, not hardcoded: the width lives in CSS
      // (.ba-actions-popout.ba-demo-steps-popout) and a duplicated constant
      // here would silently mis-anchor the popout whenever that changes.
      const popoutWidth = popout.offsetWidth || 360;
      let left = rect.right - popoutWidth;
      if (left < 8) left = 8;
      if (left + popoutWidth > window.innerWidth - 8) {
        left = window.innerWidth - 8 - popoutWidth;
      }
      popout.style.left = `${left}px`;
      popout.style.top = `${rect.bottom + 4}px`;
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, primarySteps.length, advancedOpen]);

  /** Toggle the popout open/closed. */
  function handleToggle() {
    if (disabled) return;
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

  /**
   * Render one demo-step row.
   * @param {{ uc: object, stepNumber: number }} row
   */
  function renderStep({ uc, stepNumber }) {
    const completed = isUseCaseCompleted(uc.id);
    void tick;
    return (
      <li key={uc.id} className="ba-demo-steps-popout__row">
        <button
          type="button"
          className={`ba-demo-steps-popout__item${completed ? ' ba-demo-steps-popout__item--done' : ''}`}
          onClick={() => handleSelect(uc, stepNumber)}
          data-testid={`demo-step-${uc.id}`}
        >
          <span className="ba-demo-steps-popout__step">
            Step {stepNumber}
          </span>
          <span className="ba-demo-steps-popout__id">{uc.id}</span>
          {completed && (
            <span className="ba-demo-steps-popout__check" aria-label="Completed">
              ✓
            </span>
          )}
          <span className="ba-demo-steps-popout__title">{uc.title}</span>
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

  void tick;

  // Counted over the primary steps only — that is the "scripted walkthrough"
  // the header names; the advanced group is opt-in extra material. Recomputed
  // each render, and `tick` is bumped by select/clear, so it refreshes on the
  // same path as the per-row checkmarks.
  const completedCount = primarySteps.filter(({ uc }) =>
    isUseCaseCompleted(uc.id),
  ).length;

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
        <div
          ref={popoutRef}
          className="ba-actions-popout ba-demo-steps-popout"
          role="dialog"
          aria-label="Demo steps"
          aria-modal="false"
          data-testid="demo-steps-popout"
        >
          <div className="ba-demo-steps-popout__header">
            <span className="ba-demo-steps-popout__header-title">
              Demo steps — scripted walkthrough
            </span>
            <span className="ba-demo-steps-popout__header-actions">
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
              <button
                type="button"
                className="ba-demo-steps-popout__clear"
                onClick={handleClearProgress}
                title="Clear checkmarks for a fresh demo pass"
                data-testid="demo-steps-clear"
              >
                Clear progress
              </button>
            </span>
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
          <ul className="ba-demo-steps-popout__list">
            {primarySteps.map(renderStep)}
          </ul>
          {advancedSteps.length > 0 && (
            <div className="ba-demo-steps-popout__advanced">
              <button
                type="button"
                className="ba-demo-steps-popout__advanced-toggle"
                onClick={() => setAdvancedOpen((v) => !v)}
                aria-expanded={advancedOpen}
                data-testid="demo-steps-advanced-toggle"
              >
                {advancedOpen ? '▾' : '▸'} More demos ({advancedSteps.length})
              </button>
              {advancedOpen && (
                <ul className="ba-demo-steps-popout__list">
                  {advancedSteps.map(renderStep)}
                </ul>
              )}
            </div>
          )}
        </div>
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
