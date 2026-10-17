import { ACTORS, CALLS, actorById } from "../utils/idJagCallSequence";

// ID-JAG-specific movie reel: one card per call, in order. A fork, not the shared
// TokenChainFilmstrip, because that one only draws what the global trace recorded
// and several of these calls are never recorded there.
export default function IdJagCallReel({ activeIndex, onSelect, calls = CALLS }) {
  return (
    <ol className="ijc-reel" aria-label="ID-JAG calls, movie reel" data-testid="idjag-reel">
      {calls.map((call, i) => {
        const self = call.from === call.to;
        return (
          <li key={call.n}>
            <button
              type="button"
              className={`ijc-frame ${i === activeIndex ? "is-active" : ""} ${i < activeIndex ? "is-done" : ""}`}
              aria-current={i === activeIndex ? "step" : undefined}
              aria-label={`Call ${call.n}: ${call.label}`}
              onClick={() => onSelect(i)}
            >
              <span className="ijc-frame__n">{call.n}</span>
              <span className="ijc-frame__route">
                {actorById(call.from).label}{self ? " (itself)" : ` → ${actorById(call.to).label}`}
              </span>
              <span className="ijc-frame__label">{call.label}</span>
              {call.traced === false && <span className="ijc-badge">not traced</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export { ACTORS };
