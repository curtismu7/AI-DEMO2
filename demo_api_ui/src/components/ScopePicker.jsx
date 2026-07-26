import React from "react";

/**
 * ScopePicker — the in-agent "write toggle" that drives Authorize scope filtering.
 *
 * "Read only"   → the agent token is minted with the vertical's READ scopes only.
 * "Read + Write" → adds the vertical's write scopes.
 *
 * Flipping it re-fetches the tool list (POST /api/demo-agent/tools), so write-action
 * chips grey out under read-only — the visible Authorize moment in the demo. The
 * actual scope set per vertical is resolved server-side (resolveAgentScopes); this
 * control only sends a boolean.
 */
export default function ScopePicker({ allowWrite, onChange, disabled = false }) {
  return (
    <div className="agent-scope-picker-row">
      <div
        className="scope-picker"
        title="Controls the scopes the agent token requests. Read-only greys out write-action chips via PingOne Authorize."
      >
        <span className="scope-picker__label" id="agent-scope-label">
          Agent scope
        </span>
        <div
          className="scope-picker__toggle"
          role="group"
          aria-labelledby="agent-scope-label"
        >
          <button
            type="button"
            className={`scope-picker__opt${!allowWrite ? " scope-picker__opt--on" : ""}`}
            aria-pressed={!allowWrite}
            disabled={disabled}
            onClick={() => onChange(false)}
          >
            Read
          </button>
          <button
            type="button"
            className={`scope-picker__opt${allowWrite ? " scope-picker__opt--on" : ""}`}
            aria-pressed={allowWrite}
            disabled={disabled}
            onClick={() => onChange(true)}
          >
            Write
          </button>
        </div>
      </div>
      <p className="scope-picker__hint">
        Controls the OAuth scopes in the agent&apos;s token. &ldquo;Read only&rdquo; greys out write actions via PingOne Authorize.
      </p>
    </div>
  );
}
