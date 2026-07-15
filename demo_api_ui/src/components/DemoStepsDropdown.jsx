/**
 * DemoStepsDropdown — presenter script picker next to the agent Actions menu.
 * Lists the same Demo use cases as /use-cases (DEMO_USE_CASE_IDS order).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_USE_CASE_IDS } from '../config/demoUseCaseSteps';
import apiClient from '../services/apiClient';
import { isUseCaseCompleted } from '../utils/useCaseDemoProgress';

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
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const loadSteps = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get('/api/use-cases', { params: { vertical }, _silent: true })
      .then(({ data }) => {
        const catalog = data.useCases || [];
        const ordered = DEMO_USE_CASE_IDS
          .map((id, index) => {
            const uc = catalog.find((u) => u.id === id);
            return uc ? { uc, stepNumber: index + 1 } : null;
          })
          .filter(Boolean);
        setSteps(ordered);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load demo steps');
        setSteps([]);
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
      const popoutWidth = 360;
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
  }, [open, steps.length]);

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
            Demo steps — scripted walkthrough
          </div>
          {loading && (
            <p className="ba-demo-steps-popout__status">Loading…</p>
          )}
          {error && (
            <p className="ba-demo-steps-popout__status ba-demo-steps-popout__status--error">
              {error}
            </p>
          )}
          {!loading && !error && steps.length === 0 && (
            <p className="ba-demo-steps-popout__status">
              No demo steps for this vertical.
            </p>
          )}
          <ul className="ba-demo-steps-popout__list">
            {steps.map(({ uc, stepNumber }) => {
              const completed = isUseCaseCompleted(uc.id);
              // tick forces re-read after select in this tab
              void tick;
              return (
                <li key={uc.id}>
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
