import { useEffect, useMemo, useState } from "react";
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

function Frame({ event, selected, onSelect }) {
  return (
    <button
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
    <li className={`sdk-reel-lane-card${matches ? "" : " is-empty"}`}>
      {matches ? (
        <>
          <strong>{event.label}</strong>
          <span>{elapsed(events, event)}</span>
        </>
      ) : (
        <span aria-label={`No ${lane} event for frame ${event.sequence}`}>—</span>
      )}
    </li>
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

function ModeView({ mode, events }) {
  if (mode === "debugger") {
    return <p className="sdk-reel-mode-copy">Debugger view keeps the selected code boundary beside its captured event.</p>;
  }
  if (mode === "storyboard") {
    return <p className="sdk-reel-mode-copy">Storyboard view groups the same frames into a flow story without changing their order.</p>;
  }
  return <p className="sdk-reel-mode-copy">Movie reel view follows each captured boundary in sequence.</p>;
}

export default function SdkExecutionReel({ events = [], previewEvents = PREVIEW_EVENTS, mode = "movie", onModeChange = () => {} }) {
  const isLive = events.length > 0;
  const isPreview = !isLive && previewEvents.length > 0;
  const displayedEvents = useMemo(() => (isLive ? events : previewEvents), [events, isLive, previewEvents]);
  const [selectedId, setSelectedId] = useState(displayedEvents[0]?.id ?? null);
  const selected = displayedEvents.find((event) => event.id === selectedId) || displayedEvents[0];

  useEffect(() => {
    setSelectedId(displayedEvents.at(-1)?.id ?? null);
  }, [displayedEvents]);

  return (
    <section className="sdk-execution-reel" aria-labelledby="sdk-reel-title">
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
      {isPreview ? <ModeView mode={mode} events={displayedEvents} /> : null}

      {!displayedEvents.length ? <p>The first frame appears after start() begins.</p> : null}

      {displayedEvents.length > 0 && (
        <>
          <div className="sdk-reel-rail" aria-label="Execution frames">
            {displayedEvents.map((event) => (
              <Frame key={event.id} event={event} selected={selected?.id === event.id} onSelect={setSelectedId} />
            ))}
          </div>
          <div className="sdk-reel-lanes">
            <section aria-label="DaVinci lane">
              <h4>DaVinci</h4>
              <ol>{displayedEvents.map((event) => <LaneCard key={event.id} event={event} lane="davinci" events={displayedEvents} />)}</ol>
            </section>
            <section aria-label="SDK and collectors lane">
              <h4>SDK + collectors</h4>
              <ol>{displayedEvents.map((event) => <LaneCard key={event.id} event={event} lane="sdk" events={displayedEvents} />)}</ol>
            </section>
          </div>
          {selected && <FrameDetails event={selected} />}
        </>
      )}
    </section>
  );
}
