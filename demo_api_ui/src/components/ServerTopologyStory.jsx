import React, { useEffect, useMemo, useState } from "react";
import { PLAYBACKS, RFC, SPECS, SERVER_MAP, SERVER_EDGES } from "./serverTopologyData";
import "./ServerTopologyStory.css";

const SERVERS = Object.fromEntries(SERVER_MAP.map((node) => [node.id, node.data]));
const EDGES = Object.fromEntries(SERVER_EDGES.map((edge) => [edge.id, edge]));
const referenceLabel = (data) => [
  ...(data.rfcs || []).map((key) => RFC[key]?.id),
  ...(data.specs || []).map((key) => SPECS[key]?.id),
].filter(Boolean).join(" · ") || "No standard mapped";

function participantsFor(playback) {
  return [...new Set(playback.edgeIds.flatMap((id) => [EDGES[id].source, EDGES[id].target]))];
}

function StoryControls({ scenario, setScenario, view, setView, step, setStep, playing, setPlaying }) {
  const playback = PLAYBACKS[scenario];
  const restart = () => { setPlaying(false); setStep(0); };
  const advance = () => setStep((current) => {
    if (current >= playback.edgeIds.length - 1) { setPlaying(false); return current; }
    return current + 1;
  });
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(advance, 1900);
    return () => window.clearTimeout(timer);
  }, [playing, step, scenario]);

  return (
    <div className="sts-controls">
      <label htmlFor="sts-scenario">Request path</label>
      <select id="sts-scenario" value={scenario} onChange={(event) => { setScenario(event.target.value); setStep(0); setPlaying(false); }}>
        {Object.entries(PLAYBACKS).map(([key, path]) => <option key={key} value={key}>{path.label}</option>)}
      </select>
      <div className="sts-view-switch" role="group" aria-label="Flow presentation">
        <button type="button" aria-pressed={view === "sequence"} onClick={() => setView("sequence")}>Sequence</button>
        <button type="button" aria-pressed={view === "reel"} onClick={() => setView("reel")}>Movie reel</button>
      </div>
      <button type="button" onClick={() => { setPlaying(false); setStep((current) => Math.max(0, current - 1)); }} disabled={step === 0}>Back</button>
      <button className="sts-play" type="button" onClick={() => {
        if (playing) setPlaying(false);
        else { if (step >= playback.edgeIds.length - 1) setStep(0); setPlaying(true); }
      }}>{playing ? "Pause" : "Play"}</button>
      <button type="button" onClick={() => {
        setPlaying(false);
        setStep((current) => Math.min(playback.edgeIds.length - 1, current + 1));
      }}>Next</button>
      <button type="button" onClick={restart}>Restart</button>
      <span className="sts-counter" aria-live="polite">{step + 1} / {playback.edgeIds.length}</span>
    </div>
  );
}

function SequenceView({ playback, actors, step }) {
  const active = EDGES[playback.edgeIds[step]];
  const actorIndex = Object.fromEntries(actors.map((id, index) => [id, index]));
  return (
    <div className="sts-sequence" aria-label="Animated service sequence diagram">
      <div className="sts-sequence__actors" style={{ "--sts-columns": actors.length }}>
        {actors.map((id) => <div className={`sts-actor${id === active.source || id === active.target ? " is-active" : ""}`} key={id}>
          <strong>{SERVERS[id]?.title || id}</strong><small>{SERVERS[id]?.service || "external"}</small>
        </div>)}
      </div>
      <div className="sts-sequence__events" role="list" aria-label="Request path hops" style={{ "--sts-columns": actors.length }}>
        {actors.map((id, index) => <i key={id} style={{ gridColumn: index + 1 }} aria-hidden="true" />)}
        {playback.edgeIds.slice(0, step + 1).map((edgeId, index) => {
          const edge = EDGES[edgeId];
          const from = actorIndex[edge.source];
          const to = actorIndex[edge.target];
          const start = Math.min(from, to) + 1;
          const width = Math.abs(from - to) + 1;
          const reverse = from > to;
          const source = SERVERS[edge.source]?.title || edge.source;
          const target = SERVERS[edge.target]?.title || edge.target;
          const spokenDetail = `Hop ${index + 1}: ${source} to ${target}. ${edge.label}. Protocol: ${edge.data.protocol}. Network: ${edge.data.network}. Security: ${edge.data.security}. Standards: ${referenceLabel(edge.data)}.`;
          return <div key={edgeId} role="listitem" aria-label={spokenDetail} className={`sts-message${index === step ? " is-current" : ""}${reverse ? " is-reverse" : ""}`} style={{ gridColumn: `${start} / span ${width}`, gridRow: index + 1 }}>
            <span className="sts-message__label">{edge.label}<small>{edge.data.protocol}</small><small>{referenceLabel(edge.data)}</small></span>
          </div>;
        })}
      </div>
      <p className="sts-current-caption">{active.label} <span>· {active.data.security}</span></p>
    </div>
  );
}

function ReelView({ playback, step }) {
  return <div className="sts-reel" aria-label="Request path movie reel">
    {playback.edgeIds.map((id, index) => {
      const edge = EDGES[id];
      const reached = index <= step;
      return <article key={id} className={`sts-frame${index === step ? " is-current" : ""}${reached ? " is-reached" : ""}`}>
        <div className="sts-frame__number">{String(index + 1).padStart(2, "0")}</div>
        <div className="sts-frame__actors"><strong>{SERVERS[edge.source]?.title || edge.source}</strong><span aria-hidden="true">→</span><strong>{SERVERS[edge.target]?.title || edge.target}</strong></div>
        <p>{edge.label}</p>
        <small>{edge.data.protocol}</small>
        <div className="sts-frame__meta"><span>{edge.data.security}</span><span>{referenceLabel(edge.data)}</span></div>
      </article>;
    })}
  </div>;
}

export default function ServerTopologyStory() {
  const [scenario, setScenario] = useState("nodeGateway");
  const [view, setView] = useState("sequence");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playback = PLAYBACKS[scenario];
  const actors = useMemo(() => participantsFor(playback), [playback]);
  return <section className="sts-shell" aria-label="Server request flow walkthrough">
    <header className="sts-heading"><div><h2>Server flow</h2><p>Configured service paths · sequence playback</p></div><span>STATIC MAP</span></header>
    <StoryControls {...{ scenario, setScenario, view, setView, step, setStep, playing, setPlaying }} />
    {view === "sequence" ? <SequenceView playback={playback} actors={actors} step={step} /> : <ReelView playback={playback} step={step} />}
    <footer className="sts-footnote">Declared protocols and trust notes · playback is illustrative, not runtime telemetry.</footer>
  </section>;
}
