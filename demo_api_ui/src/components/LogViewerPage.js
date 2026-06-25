import React from 'react';
import LogViewer from './LogViewer';
import './LogViewer.css';

/**
 * Full-page standalone log viewer — rendered at /logs in its own window.
 * Reuses LogViewer in standalone (non-modal) mode.
 */
export default function LogViewerPage() {
  return (
    <div className="log-page-shell">
      <LogViewer standalone isOpen={true} onClose={() => window.close()} />
    </div>
  );
}
