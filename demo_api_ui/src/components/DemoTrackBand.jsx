// The presenter's script, above the chain map.
//
// Distinct from the technical hops the rail draws below it: those are what the
// system did, this is the order a person demos it in and the line they say at
// each step. The track is the server's — see TokenChainDemoTrackTab, which
// fetches the same /api/demo-track and must not drift from this.
import React from "react";
import "./DemoTrackBand.css";

export default function DemoTrackBand({ track, activeIndex, onSelect }) {
  const steps = Array.isArray(track) ? track : [];
  if (steps.length === 0) return null;

  const at = Math.min(Math.max(activeIndex ?? 0, 0), steps.length - 1);
  const current = steps[at];
  const go = (next) => {
    if (next >= 0 && next < steps.length) onSelect?.(next);
  };

  return (
    <div className="dtb">
      <div className="dtb-chips">
        {steps.map((step, i) => {
          const state = i < at ? "done" : i === at ? "on" : "todo";
          // The act label leads its act's first chip, so the two acts read as
          // two groups without needing a second row of headings.
          const opensAct = i === 0 || step.act !== steps[i - 1].act;
          return (
            <React.Fragment key={step.n ?? i}>
              {opensAct ? <span className="dtb-act">Act {step.act}</span> : null}
              <button
                type="button"
                className={`dtb-chip dtb-chip--${state}`}
                onClick={() => go(i)}
              >
                <span className="dtb-chip-n">{step.n ?? i + 1}</span>
                <span className="dtb-chip-title">{step.title}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="dtb-now">
        <button
          type="button"
          className="dtb-nav"
          aria-label="Previous step"
          disabled={at === 0}
          onClick={() => go(at - 1)}
        >
          Prev
        </button>
        <div className="dtb-now-text">
          {current.capability ? <span className="dtb-cap">{current.capability}</span> : null}
          {current.buyerStory ? <p className="dtb-story">{current.buyerStory}</p> : null}
        </div>
        <button
          type="button"
          className="dtb-nav"
          aria-label="Next step"
          disabled={at === steps.length - 1}
          onClick={() => go(at + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
