// Renders ONE DaVinci collector as our own UI.
//
// This is the only place in the app that knows collector shapes. Scope covers
// exactly what the live flow's sign-on screen sends, verified against the real
// SDK on 2026-09-12 (5 collectors): TextCollector `username`, PasswordCollector
// `password`, SubmitCollector `SIGNON`, and two FlowCollectors — `REGISTER`
// ("No account? Register now!") and `TROUBLE` ("Having trouble signing on?").
//
// Two rules that are easy to get wrong and fail silently:
//
//  1. NEVER assign to a collector. The SDK's state is immer-frozen, so
//     `collector.input.value = x` throws nothing, changes nothing, and fails
//     only at submit with an empty field. The updater from
//     `client.update(collector)` is the only write path, and it RETURNS an
//     error object that has to be checked.
//
//  2. Branch on `category`, not `type`, for validated fields. A validated text
//     field arrives as `type: 'TextCollector'` with
//     `category: 'ValidatedSingleValueCollector'`; switching on type alone
//     renders it as a plain input and drops its validation rules.
//
// Anything unrecognised renders a visible fallback rather than nothing — an
// unsupported collector that renders blank looks like a broken page.
import { useId } from "react";

export default function CollectorField({ collector, value, onChange, onSubmit, onFlow, error, busy }) {
  const id = useId();
  const key = collector?.output?.key ?? collector?.name;
  const label = collector?.output?.label ?? key;

  switch (collector?.type) {
    case "TextCollector": {
      const validated = collector.category === "ValidatedSingleValueCollector";
      return (
        <div className="dvsdk-field">
          <label className="dvsdk-label" htmlFor={id}>
            {label}
          </label>
          <input
            id={id}
            className="dvsdk-input"
            type="text"
            autoComplete={/email/i.test(String(key)) ? "username" : "on"}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            data-validated={validated ? "true" : undefined}
          />
          {error && (
            <p className="dvsdk-field-error" id={`${id}-err`}>
              {error}
            </p>
          )}
        </div>
      );
    }

    case "PasswordCollector":
    case "ValidatedPasswordCollector": {
      return (
        <div className="dvsdk-field">
          <label className="dvsdk-label" htmlFor={id}>
            {label}
          </label>
          <input
            id={id}
            className="dvsdk-input"
            type="password"
            autoComplete="current-password"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
          />
          {error && (
            <p className="dvsdk-field-error" id={`${id}-err`}>
              {error}
            </p>
          )}
        </div>
      );
    }

    // Action collectors carry no value, so there is nothing to update — they
    // only move the flow.
    case "SubmitCollector": {
      return (
        <button type="button" className="dvsdk-submit" onClick={onSubmit} disabled={busy}>
          {busy ? "Working..." : label}
        </button>
      );
    }

    // A secondary branch out of this screen — "No account? Register now!",
    // "Having trouble signing on?". It does NOT submit the form: it takes the
    // flow down another path via client.flow({ action: output.key }), so the
    // page routes it separately from onSubmit.
    case "FlowCollector": {
      return (
        <button type="button" className="dvsdk-flow-link" onClick={onFlow} disabled={busy}>
          {label}
        </button>
      );
    }

    default:
      return (
        <p className="dvsdk-unsupported">
          Unsupported collector: <code>{collector?.type ?? "unknown"}</code>
          {collector?.category ? ` (category ${collector.category})` : ""}
        </p>
      );
  }
}

// Which collector types this renderer handles today. Exported so the page can
// report honestly when the flow sends something it cannot draw, instead of
// rendering a form that silently omits a required field.
export const SUPPORTED_COLLECTORS = [
  "TextCollector",
  "PasswordCollector",
  "ValidatedPasswordCollector",
  "SubmitCollector",
  "FlowCollector",
];
