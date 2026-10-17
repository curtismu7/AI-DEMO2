import { useEffect, useState } from "react";
import { CALLS, PHASES, actorById } from "../utils/idJagCallSequence";
import { liveEvidenceFor, useLastRunTrace } from "../utils/idJagLiveClaims";
import IdJagCallReel from "./IdJagCallReel";
import IdJagCallSequence from "./IdJagCallSequence";
import "./IdJagCallPlayer.css";

const VIEW_KEY = "idjag.callView";
const readView = () => {
  try { return window.localStorage.getItem(VIEW_KEY) === "sequence" ? "sequence" : "reel"; } catch { return "reel"; }
};

// Every ID-JAG call, shown as a movie reel OR a sequence diagram (the user picks
// one), with Play/Step and a detail panel for the selected call.
export default function IdJagCallPlayer({ speedMs = 2500 }) {
  const [view, setView] = useState(readView);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const trace = useLastRunTrace();
  const call = CALLS[active];
  const live = liveEvidenceFor(call, trace);

  const choose = (v) => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* the choice just will not persist */ }
  };

  useEffect(() => {
    if (!playing) return undefined;
    if (active >= CALLS.length - 1) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setActive((a) => a + 1), speedMs);
    return () => clearTimeout(t);
  }, [playing, active, speedMs]);

  return (
    <div className="ijc" data-testid="idjag-player">
      <div className="ijc-bar">
        <div className="ijc-toggle" role="group" aria-label="Choose a view">
          <button type="button" aria-pressed={view === "reel"} onClick={() => choose("reel")}>Movie reel</button>
          <button type="button" aria-pressed={view === "sequence"} onClick={() => choose("sequence")}>Sequence diagram</button>
        </div>
        <div className="ijc-controls">
          <button type="button" onClick={() => setActive((a) => Math.max(0, a - 1))} disabled={active === 0}>Back</button>
          <button type="button" className="ijc-play" onClick={() => { if (!playing && active >= CALLS.length - 1) setActive(0); setPlaying(!playing); }}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => setActive((a) => Math.min(CALLS.length - 1, a + 1))} disabled={active >= CALLS.length - 1}>Next</button>
          <span className="ijc-count">Call {call.n} of {CALLS.length}</span>
        </div>
      </div>

      {view === "reel"
        ? <IdJagCallReel activeIndex={active} onSelect={(i) => { setPlaying(false); setActive(i); }} />
        : <IdJagCallSequence activeIndex={active} onSelect={(i) => { setPlaying(false); setActive(i); }} />}

      <section className="ijc-detail" aria-live="polite" data-testid="idjag-call-detail">
        <p className="ijc-detail__phase">{call.phase} · {PHASES.indexOf(call.phase) + 1} of {PHASES.length}</p>
        <h3>{call.n}. {call.label}</h3>
        <p className="ijc-detail__route">
          {actorById(call.from).label}{call.from === call.to ? " (inside itself)" : ` → ${actorById(call.to).label}`}
          <span> · {call.where}</span>
        </p>
        <p>{call.does}</p>
        {call.traced === false && <p className="ijc-note">Not traced: this hop is read from the architecture, not followed through the code.</p>}
        {live && (
          <div className="ijc-live" data-testid="idjag-call-live">
            <strong>{live.mock ? "Mock replay claims" : "Real claims from your last run"}</strong>
            <pre>{JSON.stringify(live.claims, null, 2)}</pre>
          </div>
        )}
        {call.evidence && !live && <p className="ijc-note">No run recorded yet. Run the demo and the claims for this call appear here.</p>}
        <p className="ijc-detail__source">Source: {call.source}</p>
      </section>
    </div>
  );
}
