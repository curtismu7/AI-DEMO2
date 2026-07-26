// demo_api_ui/src/components/shared/JsonCrackView.jsx
import { JSONCrack } from 'jsoncrack-react';
import 'jsoncrack-react/style.css';
import { deepParse } from './JsonHighlight';
import './JsonCrackView.css';

function isEmptyValue(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Interactive node-graph view of a JSON value, via jsoncrack-react.
 * Renders nothing when `value` is empty/null/undefined.
 */
export default function JsonCrackView({ value, height = 420 }) {
  const normalized = deepParse(value);
  if (isEmptyValue(normalized)) {
    return <div className="jcv-empty">No data.</div>;
  }
  return (
    <div className="jcv-root" style={{ height }}>
      <JSONCrack json={normalized} theme="light" />
    </div>
  );
}
