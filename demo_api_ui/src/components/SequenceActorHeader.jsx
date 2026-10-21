// Shared header for every sequence widget: a segmented progress bar over a row
// of actor tiles (initials, name, one-line role, optional step badge). Actors
// the sequence has not reached yet are dimmed; the one acting now is ringed.
//
// Purely presentational. Each widget maps its own participants/steps onto
// `actors` and `segments` and keeps its own lifeline renderer below this.
import React from "react";
import "./SequenceActorHeader.css";

export const initialsOf = (name) => {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

/**
 * actors:   [{ id, name, initials?, description?, badge?, color?, state? }]
 *           state: "idle" (default, dimmed) | "done" | "active"
 *           color: any CSS colour, e.g. "var(--srd-color-browser)"
 * segments: [{ color?, state? }] — one per step, same state vocabulary
 */
export default function SequenceActorHeader({ actors = [], segments = [], className = "" }) {
  return (
    <div className={`sah ${className}`.trim()} data-testid="sequence-actor-header">
      {segments.length > 0 && (
        <div className="sah__bar" aria-hidden="true">
          {segments.map((s, i) => (
            <span
              key={i}
              className={`sah__seg sah__seg--${s.state || "idle"}`}
              style={s.color ? { "--sah-color": s.color } : undefined}
            />
          ))}
        </div>
      )}
      <ol className="sah__row">
        {actors.map((a) => (
          <li
            key={a.id}
            className={`sah__actor sah__actor--${a.state || "idle"}`}
            style={a.color ? { "--sah-color": a.color } : undefined}
            data-state={a.state || "idle"}
          >
            <span className="sah__tile">
              {a.initials || initialsOf(a.name)}
              {a.badge != null && <span className="sah__badge">{a.badge}</span>}
            </span>
            <span className="sah__name">{a.name}</span>
            {a.description && <span className="sah__desc">{a.description}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
