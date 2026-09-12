// Renders ONE DaVinci collector as our own UI.
//
// This is the only place in the app that knows collector shapes. Scope covers
// exactly what the live flow's sign-on screen sends, verified against the real
// SDK on 2026-09-12 (5 collectors): TextCollector `username`, PasswordCollector
// `password`, SubmitCollector `SIGNON`, and two FlowCollectors — `REGISTER`
// ("No account? Register now!") and `TROUBLE` ("Having trouble signing on?").
//
// Shape follows Ping's own reactjs-todo-davinci sample: the page hands each
// field its `updater` from `client.update(collector)` and the field writes
// through on change. The alternative — accumulating values in page state and
// writing them all at submit — needs a parallel values map, a submit-time loop
// that can miss a collector, and it hides update() errors until submit.
//
// Two rules that are easy to get wrong and fail silently:
//
//  1. NEVER assign to a collector. The SDK's state is immer-frozen, so
//     `collector.input.value = x` throws nothing, changes nothing, and fails
//     only at submit with an empty field. The updater is the only write path,
//     and it RETURNS an error object that has to be checked.
//
//  2. Branch on `category`, not `type`, for validated fields. A validated text
//     field arrives as `type: 'TextCollector'` with
//     `category: 'ValidatedSingleValueCollector'`; switching on type alone
//     renders it as a plain input and drops its validation rules.
//
// Anything unrecognised renders a visible fallback rather than nothing — an
// unsupported collector that renders blank looks like a broken page.
import { useCallback, useId, useState } from "react";

// Text-like input shared by the text and password cases. Holds the displayed
// value locally and writes through to the SDK on every change, reporting an
// updater rejection immediately rather than at submit.
function TextLikeField({ collector, updater, type, autoComplete, serverError, validated }) {
  const id = useId();
  const [value, setValue] = useState(collector?.input?.value ?? "");
  const [writeError, setWriteError] = useState(null);

  const onChange = useCallback(
    (e) => {
      const next = e.target.value;
      setValue(next);
      const err = updater?.(next);
      setWriteError(err && "error" in err ? err.error?.message || "Could not accept this value." : null);
    },
    [updater],
  );

  const error = writeError || serverError;
  const label = collector?.output?.label ?? collector?.output?.key ?? collector?.name;

  return (
    <div className="dvsdk-field">
      <label className="dvsdk-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="dvsdk-input"
        type={type}
        name={collector?.name}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
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

export default function CollectorField({ collector, updater, onSubmit, onFlow, serverError, busy }) {
  switch (collector?.type) {
    case "TextCollector":
      return (
        <TextLikeField
          collector={collector}
          updater={updater}
          type="text"
          autoComplete={/user|email/i.test(String(collector?.name)) ? "username" : "on"}
          serverError={serverError}
          validated={collector.category === "ValidatedSingleValueCollector"}
        />
      );

    case "PasswordCollector":
    case "ValidatedPasswordCollector":
      return (
        <TextLikeField
          collector={collector}
          updater={updater}
          type="password"
          // output.verify marks the confirm-password field of a pair.
          autoComplete={collector.output?.verify ? "new-password" : "current-password"}
          serverError={serverError}
          validated={collector.type === "ValidatedPasswordCollector"}
        />
      );

    // Action collectors carry no value, so there is no updater — they only move
    // the flow.
    case "SubmitCollector":
      return (
        <button type="button" className="dvsdk-submit" onClick={onSubmit} disabled={busy}>
          {busy ? "Working..." : (collector.output?.label ?? "Continue")}
        </button>
      );

    // A secondary branch out of this screen — "No account? Register now!",
    // "Having trouble signing on?". It does NOT submit: it takes the flow down
    // another path via client.flow({ action: output.key }), so the page routes
    // it separately from onSubmit.
    case "FlowCollector":
      return (
        <button type="button" className="dvsdk-flow-link" onClick={onFlow} disabled={busy}>
          {collector.output?.label ?? "Continue"}
        </button>
      );

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
