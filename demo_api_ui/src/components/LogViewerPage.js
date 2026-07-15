import React from 'react';
import LogViewer from './LogViewer';
import './LogViewer.css';

/**
 * Full-page standalone log viewer — rendered at /logs in its own window.
 * Reuses LogViewer in standalone (non-modal) mode.
 * Prefer ?mode=learn for Learning Log Learn tab.
 */
export default function LogViewerPage() {
  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get('mode') === 'learn' ? 'learn' : 'debug';
  return (
    <div className="log-page-shell">
      <LogViewer
        standalone
        isOpen={true}
        initialMode={initialMode}
        onClose={() => window.close()}
      />
    </div>
  );
}
