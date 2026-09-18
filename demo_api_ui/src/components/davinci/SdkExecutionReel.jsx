import { useEffect, useMemo, useRef, useState } from "react";
import { PREVIEW_EVENTS } from "./sdkExecutionEvents";
import "./SdkExecutionReel.css";

const MODES = [
  ["movie", "Movie reel"],
  ["debugger", "Debugger"],
  ["storyboard", "Storyboard"],
];

const codeFor = {
  start: "const node = await client.start({ query: { nonce } });",
  flow: "const node = await client.flow({ action })();",
  "update-next": "client.update(collector)(value);\nconst node = await client.next();",
};

function json(value) {
  return JSON.stringify(value || {}, null, 2);
}

function elapsed(events, event) {
  const first = events[0]?.at;
  return typeof first === "number" && typeof event.at === "number" ? `+${event.at - first} ms` : "captured";
}

function Frame({ event, selected, onSelect, frameRef }) {
  return (
    <button
      ref={frameRef}
      type="button"
      className={`sdk-reel-frame${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={`Frame ${event.sequence}: ${event.label}`}
      onClick={() => onSelect(event.id)}
    >
      <span>#{event.sequence}</span>
      <strong>{event.label}</strong>
    </button>
  );
}

function LaneCard({ event, lane, events }) {
  const matches = lane === "davinci" ? event.lane === "davinci" : event.lane !== "davinci";
  return (
    <div className={`sdk-reel-lane-card${matches ? "" : " is-empty"}`}>
      {matches ? (
        <>
          <strong>{event.label}</strong>
          <span>{elapsed(events, event)}</span>
        </>
      ) : (
        <span aria-label={`No ${lane} event for frame ${event.sequence}`}>—</span>
      )}
    </div>
  );
}

function FrameDetails({ event }) {
  const detail = event.detail || {};
  const request = {
    ...(detail.method ? { method: detail.method, host: detail.host, path: detail.path } : {}),
    ...(detail.paramNames ? { parameterNames: detail.paramNames } : {}),
    ...(detail.body ? { body: detail.body } : {}),
  };
  const response = {
    ...(detail.status ? { status: detail.status } : {}),
    ...(detail.eventType ? { eventType: detail.eventType } : {}),
    ...(detail.actionKey ? { actionKey: detail.actionKey } : {}),
  };
  return (
    <section className="sdk-reel-detail" aria-label={`Selected frame: ${event.label}`}>
      <h4>{event.label}</h4>
      <p>Frame {event.sequence} explains the DaVinci and SDK boundary for this captured event.</p>
      <details>
        <summary>Code</summary>
        <pre><code>{codeFor[event.codeKey] || "// This event was observed from the SDK trace."}</code></pre>
      </details>
      <details>
        <summary>Request</summary>
        <pre><code>{json(request)}</code></pre>
      </details>
      <details>
        <summary>DaVinci response</summary>
        <pre><code>{json(response)}</code></pre>
      </details>
      <details>
        <summary>Collectors</summary>
        <pre><code>{json({ collectors: detail.collectors || [] })}</code></pre>
      </details>
    </section>
  );
}

function MovieReel({ events, selected, onSelect, frameRefs }) {
  return (
    <>
      <div className="sdk-reel-rail" aria-label="Execution frames">
        {events.map((event) => (
          <Frame key={event.id} event={event} selected={selected?.id === event.id} onSelect={onSelect} frameRef={(node) => frameRefs.current.set(event.id, node)} />
        ))}
      </div>
      <section className="sdk-reel-lanes" aria-label="Synchronized DaVinci and SDK collector lanes">
        <div className="sdk-reel-lane-heading"><h4>DaVinci</h4><h4>SDK + collectors</h4></div>
        {events.map((event) => (
          <div className="sdk-reel-lane-row" key={event.id}>
            <LaneCard event={event} lane="davinci" events={events} />
            <LaneCard event={event} lane="sdk" events={events} />
          </div>
        ))}
      </section>
    </>
  );
}

function DebuggerView({ events, selected, onSelect, frameRefs }) {
  return (
    <section className="sdk-reel-debugger" aria-label="Debugger event list">
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            <Frame event={event} selected={selected?.id === event.id} onSelect={onSelect} frameRef={(node) => frameRefs.current.set(event.id, node)} />
            <span>{event.lane} · {event.kind}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StoryboardView({ events, selected, onSelect, frameRefs }) {
  return (
    <section className="sdk-reel-storyboard" aria-label="Storyboard flow">
      {events.map((event) => (
        <div className="sdk-reel-story-node" key={event.id}>
          <span>{event.lane}</span>
          <Frame event={event} selected={selected?.id === event.id} onSelect={onSelect} frameRef={(node) => frameRefs.current.set(event.id, node)} />
        </div>
      ))}
    </section>
  );
}

function useReducedMotion() {
  const [reducedMotion] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  return reducedMotion;
}

export default function SdkExecutionReel({ events = [], previewEvents = PREVIEW_EVENTS, mode = "movie", onModeChange = () => {} }) {
  const isLive = events.length > 0;
  const isPreview = !isLive && previewEvents.length > 0;
  const displayedEvents = useMemo(() => (isLive ? events : previewEvents), [events, isLive, previewEvents]);
  const [selectedId, setSelectedId] = useState(displayedEvents[0]?.id ?? null);
  const frameRefs = useRef(new Map());
  const reducedMotion = useReducedMotion();
  const selected = selectedId ? displayedEvents.find((event) => event.id === selectedId) : null;

  useEffect(() => {
    setSelectedId(displayedEvents.at(-1)?.id ?? null);
  }, [displayedEvents]);

  useEffect(() => {
    const closeDetail = (event) => {
      if (event.key !== "Escape" || !selectedId) return;
      event.preventDefault();
      frameRefs.current.get(selectedId)?.focus();
      setSelectedId(null);
    };
    document.addEventListener("keydown", closeDetail);
    return () => document.removeEventListener("keydown", closeDetail);
  }, [selectedId]);

  return (
    <section className="sdk-execution-reel" aria-labelledby="sdk-reel-title" data-reduced-motion={reducedMotion}>
      <div className="sdk-reel-heading">
        <div>
          <p className="sdk-reel-eyebrow">Execution view concepts</p>
          <h3 id="sdk-reel-title">DaVinci execution reel</h3>
        </div>
        <span className={`sdk-reel-badge${isLive ? " is-live" : ""}`} role="status">
          {isPreview ? "Concept preview" : "Live execution"}
        </span>
      </div>

      <div className="sdk-reel-tabs" aria-label="Execution view concepts">
        {MODES.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => onModeChange(value)}>
            {label}
          </button>
        ))}
      </div>
      {isPreview && <p className="sdk-reel-preview">Concept preview: sample frames demonstrate the renderer and are not this browser run.</p>}
      {!displayedEvents.length ? <p>The first frame appears after start() begins.</p> : null}

      {displayedEvents.length > 0 && (
        <>
          {mode === "debugger" ? <DebuggerView events={displayedEvents} selected={selected} onSelect={setSelectedId} frameRefs={frameRefs} /> : null}
          {mode === "storyboard" ? <StoryboardView events={displayedEvents} selected={selected} onSelect={setSelectedId} frameRefs={frameRefs} /> : null}
          {mode === "movie" ? <MovieReel events={displayedEvents} selected={selected} onSelect={setSelectedId} frameRefs={frameRefs} /> : null}
          {selected && <FrameDetails event={selected} />}
        </>
      )}
    </section>
  );
}
