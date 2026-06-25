/**
 * Check — the app-wide standard checkbox/toggle control.
 *
 * Variants:
 *   - "box"    (default) square + brand fill + check. Universal drop-in.
 *   - "pill"   whole chip fills brand when on. For tag / multi-select (scopes).
 *   - "switch" sliding on/off. For settings-style toggles.
 *
 * State is driven by an `is-on` / `is-disabled` class from the `checked` prop,
 * NOT CSS :has(:checked) — a React-controlled checkbox's prop-driven state does
 * not reliably re-invalidate :has() in Chromium (server-set values would render
 * un-filled on load). The real <input> stays in the DOM for accessibility.
 */
import React from "react";
import "./Check.css";

export default function Check({
  checked = false,
  onChange,
  disabled = false,
  variant = "box",
  children,
  className = "",
  ...rest
}) {
  const cls = [
    "ctl-check",
    `ctl-check--${variant}`,
    checked ? "is-on" : "",
    disabled ? "is-disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={cls}>
      <input
        type="checkbox"
        className="ctl-raw"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        {...rest}
      />
      {variant === "switch" ? (
        <span className="ctl-check-track" aria-hidden="true" />
      ) : (
        <span className="ctl-check-mark" aria-hidden="true">
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <polyline points="2,6 5,9 10,3" />
          </svg>
        </span>
      )}
      {children != null && <span className="ctl-check-text">{children}</span>}
    </label>
  );
}
