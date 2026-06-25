// banking_api_ui/src/components/tour/DemoTourModal.js
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useDemoTour, TOUR_STEPS } from '../../context/DemoTourContext';
import './DemoTourModal.css';

export default function DemoTourModal() {
  const { step, total, isOpen, next, prev, close } = useDemoTour();

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const current = TOUR_STEPS[step];
  const progressPct = ((step + 1) / total) * 100;
  const isLast = step === total - 1;

  const handleNext = () => {
    if (isLast) {
      close();
    } else {
      next();
    }
  };

  return (
    <div className="demo-tour-modal" role="dialog" aria-modal="true" aria-label="Demo tour">
      <div
        className="demo-tour-progress"
        style={{ width: `${progressPct}%` }}
        aria-hidden="true"
      />
      <div className="demo-tour-header">
        <span className="demo-tour-step-label">
          Step {step + 1} of {total}
        </span>
        <button
          type="button"
          className="demo-tour-close"
          onClick={close}
          aria-label="Close tour"
        >
          ✕
        </button>
      </div>
      <div className="demo-tour-body">
        <h3 className="demo-tour-title">{current.title}</h3>
        <p className="demo-tour-text">{current.body}</p>
        {current.action && (
          <div className="demo-tour-action">
            {current.action.label && current.action.route && (
              <Link to={current.action.route} className="demo-tour-action-btn" onClick={close}>
                {current.action.label}
              </Link>
            )}
            {current.action.label && !current.action.route && (
              <span className="demo-tour-action-btn">{current.action.label}</span>
            )}
            {current.action.hint && (
              <p className="demo-tour-hint">{current.action.hint}</p>
            )}
          </div>
        )}
      </div>
      <div className="demo-tour-footer">
        <button
          type="button"
          className="demo-tour-btn-prev"
          onClick={prev}
          disabled={step === 0}
          aria-disabled={step === 0}
        >
          ← Back
        </button>
        <button
          type="button"
          className="demo-tour-btn-next"
          onClick={handleNext}
        >
          {isLast ? 'Finish' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
