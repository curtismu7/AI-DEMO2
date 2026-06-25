import React from "react";
import JsonHighlight from "./JsonHighlight";
import "./JsonField.css";

// The recursive stringified-JSON unwrap (deepParse) now lives in JsonHighlight,
// which also colour-codes the output. JsonField keeps the collapsible wrapper.

/**
 * Collapsible, wrapping, pretty-printed (colour-coded) JSON field for
 * request/response payloads. Renders nothing when `value` is null/undefined.
 */
export default function JsonField({ label, value, defaultOpen = false }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="json-field" open={defaultOpen}>
      <summary className="json-field-summary">{label}</summary>
      <pre className="json-field-pre"><JsonHighlight value={value} deep /></pre>
    </details>
  );
}
