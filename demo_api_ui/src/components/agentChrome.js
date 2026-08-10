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

// Clickable option buttons for clarification messages — replaces typing "checking"
// with a tap. Calls onSelect(value) when clicked. Disabled once the question is no
// longer active (active=false).
// Options may be plain strings or { label, value } objects. For plain strings the
// label is the string itself and onSelect receives the lowercased string.
export function ClarifyOptions({ options, amountOptions, onSelect, active, onDismiss }) {
  if ((!options || options.length === 0) && (!amountOptions || amountOptions.length === 0)) return null;

  function getLabel(opt) {
    return typeof opt === 'object' && opt !== null ? opt.label : opt;
  }
  function getValue(opt) {
    if (typeof opt === 'object' && opt !== null) return opt.value;
    return opt.charAt(0).toLowerCase() + opt.slice(1);
  }

  function fmtAmount(n) {
    return `$${Number(n).toLocaleString('en-US')}`;
  }

  function handleKeyDown(e) {
    const container = e.currentTarget.closest('.clarify-options-wrapper');
    const btns = container
      ? Array.from(container.querySelectorAll('button:not(:disabled)'))
      : [];
    const idx = btns.indexOf(e.currentTarget);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % btns.length;
      btns[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + btns.length) % btns.length;
      btns[prev]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss?.();
    }
  }

  return (
    <div className="clarify-options-wrapper">
      {options && options.length > 0 && (
        <div className="clarify-options" role="listbox">
          {options.map((opt) => {
            const label = getLabel(opt);
            const value = getValue(opt);
            return (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected="false"
                className="clarify-options__btn"
                disabled={!active}
                onClick={() => active && onSelect(value)}
                onKeyDown={handleKeyDown}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {amountOptions && amountOptions.length > 0 && (
        <div className="clarify-amounts" role="listbox" aria-label="Amount presets">
          {amountOptions.map((amt) => (
            <button
              key={amt}
              type="button"
              role="option"
              aria-selected="false"
              className="clarify-amounts__btn"
              disabled={!active}
              onClick={() => active && onSelect(fmtAmount(amt))}
              onKeyDown={handleKeyDown}
            >
              {fmtAmount(amt)}
            </button>
          ))}
        </div>
      )}
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

// App variant of the prefix prompt (queryPrompt "appFilter"). Same contract:
// "all"/"*" lists everything, "<prefix>*" filters, anything else is invalid.
// The prefix charset stays space-free to match the heuristic parser's
// PREFIX_RE — a spaced prefix would silently lose its filter in Fallback
// routing, which is exactly the failure the filter steps exist to disprove.
export function buildPingOneAppListMessage(value) {
  const input = String(value || '').trim();
  if (!input || input.toLowerCase() === 'all' || input === '*') {
    return 'List all applications in my PingOne environment. Call listApplications with no filter.';
  }
  if (!/^[A-Za-z0-9._@+-]+\*$/.test(input)) return null;
  const prefix = input.slice(0, -1);
  return `List PingOne applications whose name starts with "${prefix}". Call listApplications with arguments.filter exactly name sw "${prefix}".`;
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
