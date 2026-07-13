// WizardStepper.jsx — one-step-at-a-time walkthrough (horizontal progress +
// single-step card + Back/Next) shared by Agent Studio's and Discovery's
// flows. Chosen over a stacked step list for teaching: one thing on screen
// at a time, with the full sequence still visible as a progress bar.
import React, { useState, useCallback } from "react";
import "./WizardStepper.css";

export default function WizardStepper({ steps, outcome, onComplete }) {
  const [index, setIndex] = useState(0);
  const [completedFired, setCompletedFired] = useState(false);
  const done = index >= steps.length;

  const goNext = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= steps.length && !completedFired) {
        setCompletedFired(true);
        if (onComplete) onComplete();
      }
      return next;
    });
  }, [steps.length, completedFired, onComplete]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const reset = useCallback(() => {
    setIndex(0);
    setCompletedFired(false);
  }, []);

  return (
    <div className="asp-wiz">
      <div className="asp-wiz-progress">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className={`asp-wiz-node${i < index ? " done" : ""}${i === index ? " current" : ""}`}
          >
            {i > 0 && <div className="asp-wiz-line" />}
            <div className="asp-wiz-circle">{i < index ? "✓" : i + 1}</div>
            <div className="asp-wiz-lbl">{step.title}</div>
          </div>
        ))}
      </div>

      {!done ? (
        <div className="asp-wiz-card">
          <div className="asp-wiz-num">{index + 1}</div>
          <h2>{steps[index].title}</h2>
          <p>{steps[index].narrative}</p>
          <div className="asp-wiz-actions">
            {index > 0 && (
              <button type="button" className="asp-btn" onClick={goBack}>
                {"←"} Back
              </button>
            )}
            <button type="button" className="asp-btn asp-btn--primary" onClick={goNext}>
              {index === steps.length - 1 ? "Finish" : "Next step →"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="asp-btn" onClick={reset}>
          Restart walkthrough
        </button>
      )}

      {done && outcome && (
        <div className="asp-outcome">
          <strong>Outcome:</strong> {outcome}
        </div>
      )}
    </div>
  );
}
