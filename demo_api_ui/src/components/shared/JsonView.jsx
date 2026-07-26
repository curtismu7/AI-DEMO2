// demo_api_ui/src/components/shared/JsonView.jsx
import JsonColumnsView from './JsonColumnsView';
import JsonCrackView from './JsonCrackView';
import JsonHighlight from './JsonHighlight';

// Tab list for InspectorTabs — shared by every JsonView call site so the
// JSON/Hero/Crack toggle looks and behaves the same everywhere it appears.
export const JSON_VIEW_TABS = [
  { key: 'json', label: 'JSON' },
  { key: 'hero', label: 'Hero' },
  { key: 'crack', label: 'Crack' },
];

/**
 * Renders `value` as one of three JSON view modes:
 * - 'json'  (default) — colour-coded raw JSON via JsonHighlight
 * - 'hero'  — Miller-column drill-down via JsonColumnsView (JSON Hero-style)
 * - 'crack' — interactive node-graph via JsonCrackView (jsoncrack-react)
 */
export default function JsonView({ mode = 'json', value, deep, crackHeight }) {
  if (mode === 'hero') return <JsonColumnsView value={value} />;
  if (mode === 'crack') return <JsonCrackView value={value} height={crackHeight} />;
  return <JsonHighlight value={value} deep={deep} />;
}
