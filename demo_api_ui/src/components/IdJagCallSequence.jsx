import { ACTORS, CALLS } from "../utils/idJagCallSequence";

const COL = 124;
const PAD = 70;
const ROW = 46;
const TOP = 56;
const idx = (id) => ACTORS.findIndex((a) => a.id === id);
const x = (id) => PAD + idx(id) * COL;

// ID-JAG-specific sequence diagram: eight lifelines, one row per call. A fork of
// the idea behind SequenceReelDiagram, driven by the call list instead of the
// global trace, so every call appears whether or not a live run recorded it.
export default function IdJagCallSequence({ activeIndex, onSelect, calls = CALLS }) {
  // extra room on the right: a call on the last lifeline draws its label past it
  const width = PAD + (ACTORS.length - 1) * COL + 200;
  const height = TOP + calls.length * ROW + 40;
  return (
    <div className="ijc-seq" data-testid="idjag-sequence">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="ID-JAG calls, sequence diagram">
        <defs>
          <marker id="ijc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {ACTORS.map((a) => (
          <g key={a.id}>
            <rect x={x(a.id) - 52} y={6} width={104} height={30} rx={6} className="ijc-seq__actor" />
            <text x={x(a.id)} y={25} textAnchor="middle" className="ijc-seq__actor-label">{a.label}</text>
            <line x1={x(a.id)} y1={36} x2={x(a.id)} y2={height - 14} className="ijc-seq__life" />
          </g>
        ))}
        {calls.map((call, i) => {
          const y = TOP + i * ROW + 22;
          const self = call.from === call.to;
          const x1 = x(call.from);
          const x2 = x(call.to);
          const cls = `ijc-seq__row ${i === activeIndex ? "is-active" : ""} ${i < activeIndex ? "is-done" : ""}`;
          const mid = (x1 + x2) / 2;
          return (
            <g key={call.n} className={cls} onClick={() => onSelect(i)} role="button" tabIndex={0}
              aria-label={`Call ${call.n}: ${call.label}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
              <rect x={0} y={y - ROW / 2 + 4} width={width} height={ROW - 4} className="ijc-seq__band" />
              {self ? (
                <>
                  <path d={`M${x1},${y - 6} h26 v14 h-26`} className="ijc-seq__arrow" markerEnd="url(#ijc-arrow)" fill="none" />
                  <text x={x1 + 34} y={y + 3} className="ijc-seq__label">{call.n}. {call.label}</text>
                </>
              ) : (
                <>
                  <line x1={x1} y1={y} x2={x2} y2={y} className="ijc-seq__arrow" markerEnd="url(#ijc-arrow)" />
                  <text x={mid} y={y - 6} textAnchor="middle" className="ijc-seq__label">{call.n}. {call.label}</text>
                </>
              )}
              {call.traced === false && <text x={width - 8} y={y + 3} textAnchor="end" className="ijc-seq__untraced">not traced</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
