import { ACTORS, CALLS } from "../utils/idJagCallSequence";

const COL = 124;
const PAD = 70;
const ROW = 54;
const TOP = 62;
const idx = (id) => ACTORS.findIndex((a) => a.id === id);
const x = (id) => PAD + idx(id) * COL;

// Ping palette per actor: red = Ping product, dark = apps and people, grey = the MCP side.
const ACTOR_COLOR = {
  browser: "#151a24", bff: "#151a24", agent: "#151a24", pf: "#b5231a",
  oauthmcp: "#5a5f69", gateway: "#5a5f69", mcp: "#151a24", bank: "#151a24",
};

// ID-JAG-specific sequence diagram: eight lifelines, one row per call, in the shared Ping look
// (light grey canvas, thick black arrows, orange numbered badges, blue dashed arrow for the call in focus).
// Lifeline actors are not draggable; the numbers, the arrows and the detail panel work like the other diagrams.
// A fork of the idea behind SequenceReelDiagram, driven by the call list instead of the global trace, so every
// call appears whether or not a live run recorded it.
export default function IdJagCallSequence({ activeIndex, onSelect, calls = CALLS }) {
  // extra room on the right: a call on the last lifeline draws its label past it
  const width = PAD + (ACTORS.length - 1) * COL + 200;
  const height = TOP + calls.length * ROW + 30;
  return (
    <div className="ijc-seq" data-testid="idjag-sequence">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="ID-JAG calls, sequence diagram">
        <defs>
          <marker id="ijc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="ijc-seq__head" />
          </marker>
        </defs>
        {ACTORS.map((a) => (
          <g key={a.id}>
            <line x1={x(a.id)} y1={40} x2={x(a.id)} y2={height - 12} className="ijc-seq__life" />
            <rect x={x(a.id) - 52} y={6} width={104} height={34} rx={6} className="ijc-seq__actor" />
            <rect x={x(a.id) - 52} y={6} width={5} height={34} fill={ACTOR_COLOR[a.id]} />
            <text x={x(a.id) + 2} y={a.label.includes(" (") ? 20 : 27} textAnchor="middle" className="ijc-seq__actor-label">
              {a.label.split(/ (?=\()/).map((part, k) => <tspan key={part} x={x(a.id) + 2} dy={k ? 13 : 0}>{part}</tspan>)}
            </text>
          </g>
        ))}
        {calls.map((call, i) => {
          const y = TOP + i * ROW + 28;
          const self = call.from === call.to;
          const x1 = x(call.from);
          const x2 = x(call.to);
          const dir = x2 >= x1 ? 1 : -1;
          const cls = `ijc-seq__row ${i === activeIndex ? "is-active" : ""} ${i < activeIndex ? "is-done" : ""}`;
          const mid = (x1 + x2) / 2;
          const badgeX = self ? x1 + 13 : x1 + dir * 22;
          return (
            <g key={call.n} className={cls} onClick={() => onSelect(i)} role="button" tabIndex={0}
              aria-label={`Call ${call.n}: ${call.label}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
              <rect x={0} y={y - ROW / 2 + 4} width={width} height={ROW - 4} className="ijc-seq__band" />
              {self ? (
                <>
                  <path d={`M${x1},${y - 6} h40 v16 h-40`} className="ijc-seq__arrow" markerEnd="url(#ijc-arrow)" fill="none" />
                  <text x={x1 + 52} y={y + 5} className="ijc-seq__label">{call.label}</text>
                </>
              ) : (
                <>
                  <line x1={x1} y1={y} x2={x2} y2={y} className="ijc-seq__arrow" markerEnd="url(#ijc-arrow)" />
                  <text x={mid} y={y - 14} textAnchor="middle" className="ijc-seq__label">{call.label}</text>
                </>
              )}
              <circle cx={badgeX} cy={self ? y - 6 : y} r={11} className="ijc-seq__num" />
              <text x={badgeX} y={(self ? y - 6 : y) + 4} textAnchor="middle" className="ijc-seq__num-text">{call.n}</text>
              {call.traced === false && <text x={width - 8} y={y + 4} textAnchor="end" className="ijc-seq__untraced">not traced</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
