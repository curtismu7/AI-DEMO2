// Small "chrome" components extracted from AIAgent.js — session timer, copy-hint,
// vertical suggestion-chip mapper, and the HITL chip marker. Stateless w.r.t.
// BankingAgent (each renders from props or its own local state).
import React, { useState, useEffect } from "react";
import APP_CONFIG from "../services/appConfig";

/** Session expiry countdown timer component */
export function SessionExpiryTimer({ sessionInfo, className = "" }) {
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [isExpiringSoon, setIsExpiringSoon] = useState(false);

  useEffect(() => {
    if (!sessionInfo?.expiresAt) return;

    const calculateTimeRemaining = () => {
      const now = Date.now();
      const expiresAt = new Date(sessionInfo.expiresAt).getTime();
      const remaining = Math.max(0, expiresAt - now);

      setTimeRemaining(remaining);
      setIsExpiringSoon(
        remaining > 0 && remaining < APP_CONFIG.SESSION_EXPIRY_WARNING_MS,
      );
    };

    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [sessionInfo?.expiresAt]);

  if (!timeRemaining || timeRemaining <= 0) return null;

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`ba-session-timer ${isExpiringSoon ? "ba-session-timer--expiring" : ""} ${className}`}
      title={`Session expires in ${formatTime(timeRemaining)}`}
    >
      <span className="ba-session-timer-icon">{"\u23f0"}</span>
      <span className="ba-session-timer-text">{formatTime(timeRemaining)}</span>
    </div>
  );
}

// Clarification hint (e.g. `release record 102`) with a one-click copy — demo
// presenters mostly copy the suggested command. Copies the quoted example when
// present, otherwise the whole hint.
export function ParamHintCopy({ hint }) {
  const [copied, setCopied] = useState(false);
  const text = String(hint || "");
  const quoted = text.match(/["“”']([^"“”']+)["“”']/);
  const copyText = quoted?.[1] || text;
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <div className="banking-agent-msg-param-hint">
      <span className="banking-agent-msg-param-hint__text">{hint}</span>
      <button
        type="button"
        className="banking-agent-msg-param-hint__copy"
        onClick={doCopy}
        title={`Copy "${copyText}"`}
        aria-label={`Copy "${copyText}"`}
      >
        {copied ? (
          "Copied"
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 11V3a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        )}
      </button>
    </div>
  );
}

// Map a vertical manifest's `chips10` into discovery-chip shape. Each carries a
// `message` so the click routes through the NL pipeline (the vertical service)
// rather than a banking action ID. Shared by the popout and the left-rail so
// the two surfaces can never drift.
export function verticalSuggestionChips(pageManifest) {
  const chips10 = Array.isArray(pageManifest?.dashboard?.chips10)
    ? pageManifest.dashboard.chips10
    : [];
  return chips10.map((c) => ({
    id: c.id,
    label: c.label,
    desc: c.message || "",
    message: c.message,
    rfcs: [],
    // Manifest source of truth: hitlTrigger marks chips that pause for
    // human-in-the-loop (consent/step-up). Carry it through so the UI can flag
    // them for the demo presenter — it was being dropped here.
    hitlTrigger: !!c.hitlTrigger,
    // Challenge marker: consent | both | step_up (drives HitlChipMark glyphs).
    challenge: c.challenge || null,
    // Negative-chip rail: mode 'direct' + tool/denyTool drive client dispatch
    // (attack-sim for synthetic tools, real foreign-tool call for denyTool).
    mode: c.mode || null,
    tool: c.tool || null,
    denyTool: c.denyTool || null,
    queryPrompt: c.queryPrompt || null,
  }));
}

export function buildPingOneUserListMessage(value) {
  const input = String(value || '').trim();
  if (!input || input.toLowerCase() === 'all' || input === '*') {
    return 'List all users in my PingOne environment. Call listUsers with no filter.';
  }
  if (!/^[A-Za-z0-9._@+-]+\*$/.test(input)) return null;
  const prefix = input.slice(0, -1);
  return `List PingOne users whose username starts with "${prefix}". Call listUsers with arguments.filter exactly username sw "${prefix}".`;
}

// Chip challenge marker (REGRESSION_PLAN §0 allows 👤 and 🔑), so a demo
// presenter can see at a glance which control a chip pauses for:
//   consent → 👤 (HITL approval)   both → 👤🔑 (consent + step-up/MFA)
//   step_up → 🔑 (MFA spotlight, showcase chips)
const CHALLENGE_MARK = {
  consent: { text: '👤', label: 'Requires human approval (consent)' },
  both: { text: '👤🔑', label: 'Requires consent and step-up (MFA)' },
  step_up: { text: '🔑', label: 'Requires step-up authentication (MFA)' },
};
export function HitlChipMark({ challenge = 'both' } = {}) {
  const m = CHALLENGE_MARK[challenge] || CHALLENGE_MARK.both;
  return (
    <span className="ba-chip-hitl-mark" role="img" title={m.label} aria-label={m.label}>
      {m.text}
    </span>
  );
}
