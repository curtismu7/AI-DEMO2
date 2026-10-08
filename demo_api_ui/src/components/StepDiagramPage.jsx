// StepDiagramPage.jsx — the destination of "Open diagram" (Mission Control)
// and "Open full diagram" (explain modal). One diagram per demo step at
// /step-diagrams/<step number>, drawn with the Demo arch slide primitives and
// the same Play / Step walkthrough idea; the Live/SSE mode stays on the arch
// slides pages for now (ponytail: add here when a step needs it).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StepTimeSelector, DEFAULT_STEP_MS, STEP_TIME_OPTIONS } from './diagram';
import { stepDiagramFor } from '../config/stepDiagrams';
import './StepDiagramPage.css';

// Script-only player: cur 0 = idle (everything lit), 1..N = walkthrough.
function useWalkthrough(total) {
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);

  useEffect(() => {
    if (!playing) return undefined;
    if (cur >= total) {
      setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setCur((c) => Math.min(total, c + 1)), cur === 0 ? 200 : stepMs);
    return () => clearTimeout(t);
  }, [playing, cur, total, stepMs]);

  const play = useCallback(() => { setCur((c) => (c >= total ? 0 : c)); setPlaying(true); }, [total]);
  const pause = useCallback(() => setPlaying(false), []);
  const next = useCallback(() => { setPlaying(false); setCur((c) => Math.min(total, c + 1)); }, [total]);
  const back = useCallback(() => { setPlaying(false); setCur((c) => Math.max(0, c - 1)); }, []);
  const reset = useCallback(() => { setPlaying(false); setCur(0); }, []);

  // Same class contract as DemoArchSlidesPage's st(): idle → untouched,
  // current → now, past → on, future → off.
  const st = useCallback((...ids) => {
    if (ids.length === 0 || cur === 0) return '';
    if (ids.includes(cur)) return 'das-st das-st-now';
    if (Math.min(...ids) < cur) return 'das-st das-st-on';
    return 'das-st das-st-off';
  }, [cur]);

  return { cur, playing, stepMs, setStepMs, play, pause, next, back, reset, st };
}

/** Result badge text from the catalog's expectedOutcome class of answer. */
function resultFor(step) {
  const outcomes = {
    2: { text: 'PERMIT', cls: 'sdp__result--permit' },
    3: { text: 'HITL_REQUIRED', cls: 'sdp__result--hitl' },
    4: { text: 'STEP_UP', cls: 'sdp__result--hitl' },
    5: { text: 'PERMIT', cls: 'sdp__result--permit' },
  };
  return outcomes[step] || null;
}

export default function StepDiagramPage({ step }) {
  const def = stepDiagramFor(step);
  const total = def ? def.meta.steps.length : 0;
  const p = useWalkthrough(total);
  const stepText = p.cur > 0 ? def.meta.steps[p.cur - 1] : null;
  const result = resultFor(step);

  if (!def) {
    return (
      <div className="sdp">
        <span className="das-eyebrow">Demo step diagram</span>
        <div className="sdp__empty">
          <h1>No diagram for this step yet</h1>
          <p>
            Step {step} has no step diagram registered. Diagrams exist for the steps listed in{' '}
            <code>src/config/stepDiagrams.js</code>; coverage grows one step at a time.
          </p>
          <Link className="das-btn das-btn--primary" to="/dashboard">Back to Mission Control</Link>
        </div>
      </div>
    );
  }

  const Scene = def.render;

  return (
    <div className="sdp">
      <span className="das-eyebrow">Demo step diagram</span>
      <nav className="sdp__crumb" aria-label="Breadcrumb">
        <Link to="/dashboard">← Back to Mission Control</Link>
        <span>· Step {step}</span>
      </nav>

      <div className="sdp__head">
        <span className="sdp__num">Step {step}</span>
        <h1 className="sdp__title">{def.title}</h1>
        {result && <span className={`sdp__result ${result.cls}`}>{result.text}</span>}
      </div>
      <p className="sdp__sub">{def.meta.subtitle}</p>

      <div className="das-controls" role="group" aria-label="Walkthrough controls">
        <button type="button" className="das-btn das-btn--primary" onClick={p.playing ? p.pause : p.play}>
          {p.playing ? 'Pause' : '▶ Play'}
        </button>
        <button type="button" className="das-btn" onClick={p.back} disabled={p.cur === 0}>← Back</button>
        <button type="button" className="das-btn" onClick={p.next} disabled={p.cur >= total}>Step →</button>
        <button type="button" className="das-btn" onClick={p.reset} disabled={p.cur === 0 && !p.playing}>↺ Reset</button>
        <StepTimeSelector value={p.stepMs} options={STEP_TIME_OPTIONS} onChange={p.setStepMs} title="Time each step takes during Play" />
        <span className="das-counter">{p.cur === 0 ? `${total} steps` : `Step ${p.cur} / ${total}`}</span>
      </div>

      <div className="sdp__stepbar" aria-live="polite">
        {stepText ? (
          <>
            <span className="sdp__stepbar-num">{p.cur}</span>
            <span className="sdp__stepbar-title">{stepText[0]}</span>
            <span className="sdp__stepbar-desc">{stepText[1]}</span>
          </>
        ) : (
          <span className="sdp__stepbar-desc">
            Press Play to walk the request through the diagram, or Step to advance one hop at a time. Everything is lit while idle.
          </span>
        )}
      </div>

      <figure>
        <div className="das-frame"><Scene st={p.st} /></div>
        <figcaption className="das-caption">{def.meta.aria}</figcaption>
      </figure>
    </div>
  );
}
