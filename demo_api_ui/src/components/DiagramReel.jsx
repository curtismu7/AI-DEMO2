import React, { useEffect, useRef, useState } from "react";
import "./DiagramStepBar.css";
import "./DiagramReel.css";

/**
 * DiagramReel — the movie reel under a diagram: one card per arrow in walk order, the card in focus
 * matching the arrow in focus. Clicking a card jumps there (and pauses) and opens the details row
 * BELOW the reel, in normal page flow, so the diagram above never gets smaller. A node click on the
 * diagram can pass `nodeDetail` to show that node instead.
 *
 * Props: steps (buildReelSteps), stepper (useDiagramStepper), nodeDetail ({ title, lines } | null),
 * onClearNode, openKey (optional number: a change opens the details row for the step in focus), testId.
 */
export default function DiagramReel({ steps, stepper, nodeDetail = null, onClearNode, openKey = 0, testId = "diagram-reel" }) {
  const [open, setOpen] = useState(false);
  const stripRef = useRef(null);
  const step = stepper?.step ?? -1;
  useEffect(() => {
    if (openKey) setOpen(true);
  }, [openKey]);

  // keep the card in focus visible inside the strip (scroll the strip, never the page)
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || step < 0) return;
    const card = strip.children[step];
    if (!card) return;
    const left = card.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + card.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [step]);

  if (!steps?.length) return null;

  const current = step >= 0 ? steps[step] : null;
  const panel = nodeDetail || (open && current ? { title: current.title, label: current.label, lines: current.lines, refs: current.refs } : null);
  const close = () => {
    setOpen(false);
    onClearNode?.();
  };
  const pick = (i) => {
    onClearNode?.();
    if (i === step && open) {
      setOpen(false);
      return;
    }
    stepper.goTo(i);
    setOpen(true);
  };

  return (
    <div className="dreel" data-testid={testId}>
      <ol className="dreel-strip" ref={stripRef} aria-label="Movie reel: the steps of this diagram">
        {steps.map((s, i) => (
          <li key={s.n}>
            <button
              type="button"
              className={`dreel-card${i === step ? " dreel-card--now" : ""}${step >= 0 && i < step ? " dreel-card--done" : ""}`}
              aria-current={i === step ? "step" : undefined}
              onClick={() => pick(i)}
            >
              <span className="dreel-n">{s.n}</span>
              <span className="dreel-title">{s.title}</span>
              {s.label && <span className="dreel-label">{s.label}</span>}
            </button>
          </li>
        ))}
      </ol>
      {panel && (
        <section className="dreel-detail" aria-live="polite" data-testid={`${testId}-detail`}>
          <header>
            <h3>{panel.title}</h3>
            <button type="button" className="dreel-close" onClick={close} aria-label="Close details">
              Close
            </button>
          </header>
          {panel.label && <p className="dreel-detail-label">{panel.label}</p>}
          {panel.lines.length > 0 ? (
            <dl>
              {panel.lines.map((l, i) => (
                <div key={i}>
                  {l.who && <dt>{l.who}</dt>}
                  <dd>{l.code ? <pre className="dreel-code">{l.code}</pre> : l.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="dreel-detail-empty">No further detail for this one.</p>
          )}
          {panel.refs?.length > 0 && (
            <div className="dreel-refs" data-testid={`${testId}-refs`}>
              <h4>Standards behind this step</h4>
              <ul>
                {panel.refs.map((r) => (
                  <li key={r.id}>
                    <span className={`dreel-ref dreel-ref--${r.kind}`}>{r.kind === 'emerging' ? 'emerging' : r.kind === 'spec' ? 'spec' : 'RFC'}</span>
                    <strong>{r.id}</strong> {r.title}
                  </li>
                ))}
              </ul>
              <p className="dreel-refs-note">Emerging items are drafts or in-progress work; their status can change.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
