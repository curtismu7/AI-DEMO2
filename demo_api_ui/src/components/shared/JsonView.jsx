// demo_api_ui/src/components/shared/JsonView.jsx
import { Suspense } from 'react';
import lazyWithRetry from '../../utils/lazyWithRetry';
import JsonColumnsView from './JsonColumnsView';
import JsonHighlight from './JsonHighlight';

// The node-graph view pulls in a ~2 MB graph library; load it only when the Crack tab is opened.
const JsonCrackView = lazyWithRetry(() => import('./JsonCrackView'));

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
  if (mode === 'crack') {
    return (
      <Suspense fallback={<div role="status" style={{ height: crackHeight, minHeight: 80 }}>Loading graph…</div>}>
        <JsonCrackView value={value} height={crackHeight} />
      </Suspense>
    );
  }
  return <JsonHighlight value={value} deep={deep} />;
}
