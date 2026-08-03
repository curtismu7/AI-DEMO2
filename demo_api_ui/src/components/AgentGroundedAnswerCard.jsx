import React from "react";
import "./AgentGroundedAnswerCard.css";

/**
 * Option C — renders the BFF's grounded answer (`groundedAnswer` on the agent
 * response) so that every visible claim carries the tool call behind it.
 *
 * This component renders ONLY what the server already attributed. It never sees
 * the model's original prose and never sees a dropped claim's text: the server
 * returns claims and a dropped COUNT, deliberately not the dropped text, so
 * there is nothing here that could leak an unattributed statement to the screen.
 *
 * A claim's `scope` may legitimately be null — that means the tool is not
 * modelled in the scope topology, so no scope can be named. We show the tool
 * alone rather than inventing "read", for the same reason the no-match card
 * omits `closestCandidate` instead of fabricating a score.
 *
 * Zero claims is not this component's case at all: the caller degrades to
 * AgentNoMatchCard, because an empty grounded card would be a hedge.
 */
export default function AgentGroundedAnswerCard({ claims = [], droppedCount = 0 }) {
  if (!Array.isArray(claims) || claims.length === 0) return null;

  return (
    <div className="ba-grounded-card">
      <div className="ba-grounded-head">
        <span aria-hidden="true">✅</span> Grounded answer
      </div>
      <p className="ba-grounded-why">
        Each statement below came from a tool call in this vertical. Anything the
        agent could not trace to one was removed.
      </p>

      <ul className="ba-grounded-claims">
        {claims.map((claim, i) => (
          <li className="ba-grounded-claim" key={`${i}-${claim.text}`}>
            <p className="ba-grounded-claim-text">{claim.text}</p>
            <div className="ba-grounded-sources">
              {(claim.sources || []).map((s) => (
                <span className="ba-grounded-source" key={`${s.tool}-${s.scope || "none"}`}>
                  <span aria-hidden="true">🔑</span>
                  <span className="ba-grounded-source-tool">{s.tool}</span>
                  {s.scope ? (
                    <span className="ba-grounded-source-scope">scope: {s.scope}</span>
                  ) : null}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {droppedCount > 0 ? (
        <p className="ba-grounded-dropped">
          <span aria-hidden="true">⚠️</span>{" "}
          {droppedCount === 1
            ? "1 statement was dropped because no tool call supported it."
            : `${droppedCount} statements were dropped because no tool call supported them.`}
        </p>
      ) : null}
    </div>
  );
}
