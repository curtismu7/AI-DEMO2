import React, { useEffect, useRef, useState } from "react";
import "./DiagramStepBar.css";
import "./DiagramReel.css";

// Colours the JSON in a code line (keys, strings, numbers, true/false/null); anything else (request lines, headers)
// stays plain. Splits on tokens only, so the text is unchanged and copy/paste still gives the original.
const JSON_TOKEN = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|((?<=:\s+|[\[,]\s*)-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
const TOKEN_CLASS = ["", "key", "str", "num", "lit"];
export function JsonCode({ text }) {
  const out = [];
  let last = 0;
  let m;
  JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const g = m.findIndex((v, i) => i > 0 && v !== undefined);
    out.push(<span key={m.index} className={`dreel-json-${TOKEN_CLASS[g]}`}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const SIZES = [["small", "A−", "Decrease details font size"], ["medium", "A", "Default details font size"], ["large", "A+", "Increase details font size"]];

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
  const [fontSize, setFontSize] = useState("medium");
  // a box click on the diagram bumps openKey: open the details row for the step it jumped to
  useEffect(() => {
    if (openKey) setOpen(true);
  }, [openKey]);
  const stripRef = useRef(null);
  const step = stepper?.step ?? -1;

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
    // The Close button unmounts with the panel; without this focus falls to the page body. Back to the card in focus
    // (the one that opened the row), or the first card when a diagram node opened it.
    stripRef.current?.querySelectorAll(".dreel-card")[Math.max(step, 0)]?.focus();
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
        <section className="dreel-detail" aria-live="polite" data-font-size={fontSize} data-testid={`${testId}-detail`}>
          <header>
            <h3>{panel.title}</h3>
            <span className="dreel-font" role="group" aria-label="Details font size">
              {SIZES.map(([size, label, aria]) => (
                <button key={size} type="button" aria-label={aria} aria-pressed={fontSize === size} onClick={() => setFontSize(size)}>{label}</button>
              ))}
            </span>
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
                  <dd>{l.code ? <pre className="dreel-code"><JsonCode text={l.code} /></pre> : l.text}</dd>
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
