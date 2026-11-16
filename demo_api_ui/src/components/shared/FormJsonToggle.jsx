// Form / JSON view switch for a data payload — the reading aid the demo needs
// when a pane's content is a JSON blob read off a projector.
//
// The idiom already exists on /llm-test, /mcp-inspector and /privilege-mcp-client;
// this is the first shared copy, added when the dashboard's right column needed
// it in two places at once (the token chain's step detail and the agent's
// results panel). `children` is the Form view — whatever rich rendering the
// caller already has — and `value` is the payload shown as JSON.
//
// The Form | JSON choice is the page-wide one of the shared JsonPane (kept in localStorage, shared with every
// JSON pane); `defaultView` applies only until the visitor has chosen. The JSON view is the shared JsonPane.
import React from "react";
import JsonPane, { JsonViewOnly, JsonViewToggle, useJsonView } from "./JsonPane";
import "./FormJsonToggle.css";

/**
 * Every leaf of a payload as a `path: value` row, paths in JS notation
 * (accounts[0].balance). A rendering, not an interpretation — nothing is
 * summarised or dropped.
 */
export function flattenPayload(value, prefix = "") {
  if (value === null || typeof value !== "object") {
    return [[prefix || "(value)", value === null ? "null" : String(value)]];
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [`${prefix}[${i}]`, v])
    : Object.entries(value).map(([k, v]) => [prefix ? `${prefix}.${k}` : k, v]);
  if (!entries.length) return [[prefix || "(value)", Array.isArray(value) ? "[]" : "{}"]];
  return entries.flatMap(([p, v]) => flattenPayload(v, p));
}

/** The default Form view: flattened `path: value` rows. */
export function PayloadFormView({ value }) {
  return (
    <dl className="fjt-form">
      {flattenPayload(value).map(([k, v]) => (
        <div className="fjt-form__row" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * @param {object} props
 * @param {unknown} props.value          Payload rendered in the JSON view.
 * @param {string}  props.ariaLabel      Label for the button group.
 * @param {'form'|'json'} [props.defaultView]
 * @param {React.ReactNode} [props.children] Form view; defaults to flattened rows.
 * @param {React.ReactNode} [props.jsonView] JSON view; defaults to highlighted
 *   JSON. A caller that already renders the raw payload passes its own node so
 *   the JSON view stays byte-for-byte what it showed before the toggle existed.
 */
export default function FormJsonToggle({
  value,
  ariaLabel,
  defaultView = "form",
  children,
  jsonView,
}) {
  const [view] = useJsonView(defaultView);
  return (
    <div className="fjt">
      <JsonViewToggle view={view} label={ariaLabel} />
      {view === "form" ? (
        children ?? <PayloadFormView value={value} />
      ) : (
        <JsonViewOnly>
          {jsonView ?? <JsonPane value={value} deep toggle={false} />}
        </JsonViewOnly>
      )}
    </div>
  );
}
