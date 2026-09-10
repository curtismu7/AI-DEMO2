// LlmGatewayReel — the path a single LLM call took, as clickable boxes.
//
// The Path row this replaces was a read-only chip chain: it showed WHERE the
// call went but never WHAT each hop did with it, so every follow-up question in
// a demo ("what did Privilege actually check?", "did the model see the prompt?")
// had to be answered out loud. Each box now opens the evidence for its own hop.
//
// Two honesty rules are load-bearing here:
//
//  1. A denial stops the reel. The provider box is drawn UNREACHED, not failed —
//     Privilege refused before the model ever saw the prompt, and drawing it as
//     a failure would blame the wrong party.
//  2. `providerLimits` are the PROVIDER's rate-limit headers, not the Privilege
//     virtual key's caps. They are labelled as such and live on the provider
//     box, because showing them under Privilege would claim to display a
//     governance limit while displaying someone else's.

import { useState } from "react";
import "./LlmGatewayReel.css";

/**
 * Derive the reel from one decision. Exported for tests: the ordering and the
 * reached/unreached states are the substance of this component, and they are
 * far cheaper to assert here than through the DOM.
 */
export function buildReelSteps(decision, { providerTitle, isLocalLane = false } = {}) {
  if (!decision) return [];
  const deniedAtGateway = decision.layer === "Privilege";
  const steps = [];

  steps.push({
    id: "you",
    icon: "👤",
    label: "You",
    state: "ok",
    summary: "The prompt, as submitted",
    detail: [
      ["Lane requested", decision.provider || "—"],
      ["Model requested", decision.model || "(lane default)"],
      ["Route", decision.route || "—"],
    ],
  });

  // A local model never leaves the machine, so there is no Privilege hop to
  // draw. Inventing one would put a gate in the picture that did not run.
  if (!isLocalLane) {
    const redacted = Number(decision.redactions) > 0;
    steps.push({
      id: "privilege",
      icon: "🛡",
      label: "PingOne Privilege",
      state: deniedAtGateway ? "denied" : redacted ? "acted" : "ok",
      summary: deniedAtGateway
        ? decision.verdict || "Denied by policy"
        : redacted
          ? `Allowed, ${decision.redactions} redacted on the way back`
          : "Allowed, forwarded to the provider",
      detail: [
        ["Verdict", decision.verdict || (deniedAtGateway ? "Denied by policy" : "Allowed")],
        ...(decision.reason ? [["Reason", decision.reason]] : []),
        ["Gateway route", decision.route || "—"],
        ["Provider key", "held by Privilege — never sent by this app"],
        ...(redacted
          ? [["Redactions", `${decision.redactions} on the reply, not the prompt`]]
          : []),
      ],
    });
  }

  steps.push({
    id: "provider",
    icon: "🧠",
    label: providerTitle || decision.provider || "Model",
    state: deniedAtGateway ? "unreached" : "ok",
    summary: deniedAtGateway
      ? "Never saw the prompt"
      : decision.reachedProvider === false
        ? "Not reached"
        : "Answered",
    detail: [
      ["Model", decision.model || "(lane default)"],
      ["Reached the model", decision.reachedProvider ? "yes" : "no"],
      ...(decision.latencyMs !== undefined && decision.latencyMs !== null
        ? [["Round trip", `${decision.latencyMs} ms`]]
        : []),
      // Labelled explicitly: these are the PROVIDER's headers. Privilege
      // exposes no per-key usage endpoint, so calling them "your limits" would
      // be showing someone else's numbers under our own name.
      ...(decision.providerLimits
        ? [["Provider rate limits", formatLimits(decision.providerLimits)]]
        : []),
    ],
  });

  return steps;
}

function formatLimits(limits) {
  const parts = Object.entries(limits)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(" · ") : "reported, but empty";
}

export default function LlmGatewayReel({ decision, providerTitle, isLocalLane }) {
  // Default to the hop that decided the outcome: on a denial that is Privilege,
  // otherwise the provider that answered. Opening on "You" would make every
  // demo start with a click before it showed anything worth seeing.
  const steps = buildReelSteps(decision, { providerTitle, isLocalLane });
  const interesting = steps.find((s) => s.state === "denied") || steps[steps.length - 1];
  const [openId, setOpenId] = useState(null);
  if (steps.length === 0) return null;
  const activeId = openId || (interesting && interesting.id);
  const active = steps.find((s) => s.id === activeId) || steps[0];

  return (
    <div className="lgw-reel">
      <ol className="lgw-reel__track">
        {steps.map((step, i) => (
          <li key={step.id} className="lgw-reel__cell">
            {i > 0 ? (
              <span
                className={`lgw-reel__link${steps[i].state === "unreached" ? " lgw-reel__link--broken" : ""}`}
                aria-hidden="true"
              >
                {steps[i].state === "unreached" ? "╌╌" : "──"}
              </span>
            ) : null}
            <button
              type="button"
              className={`lgw-reel__box lgw-reel__box--${step.state}${step.id === active.id ? " is-open" : ""}`}
              aria-expanded={step.id === active.id}
              aria-controls="lgw-reel-detail"
              onClick={() => setOpenId(step.id)}
            >
              <span className="lgw-reel__icon" aria-hidden="true">{step.icon}</span>
              <span className="lgw-reel__label">{step.label}</span>
              <span className="lgw-reel__summary">{step.summary}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="lgw-reel__detail" id="lgw-reel-detail">
        <h4 className="lgw-reel__detail-title">
          <span aria-hidden="true">{active.icon}</span> {active.label}
        </h4>
        <dl className="lgw-reel__detail-list">
          {active.detail.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
