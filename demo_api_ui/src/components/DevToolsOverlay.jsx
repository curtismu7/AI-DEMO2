// banking_api_ui/src/components/DevToolsOverlay.jsx
/**
 * DevToolsOverlay — renders DevToolsDashboard in a fixed-position portal so it
 * floats above any page. Includes a toggle pill to show/hide.
 *
 * Usage: <DevToolsOverlay defaultOpen />
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import DevToolsDashboard from './DevToolsDashboard';

export default function DevToolsOverlay({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const pill = (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      title={open ? 'Hide Dev Tools' : 'Show Dev Tools'}
      style={{
        position: 'fixed',
        bottom: 84,
        right: 20,
        zIndex: 9001,
        padding: '8px 16px',
        borderRadius: '999px',
        border: 'none',
        background: open ? '#7f1d1d' : '#dc2626',
        color: '#fff',
        fontWeight: 700,
        fontSize: '0.82rem',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        outline: 'none',
      }}
    >
      <span>🛠</span>
      {open ? 'Hide Dev Tools' : 'Dev Tools'}
    </button>
  );

  return ReactDOM.createPortal(
    <>
      {pill}
      {open && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 9000,
          pointerEvents: 'none',
          width: 0,
          height: 0,
          overflow: 'visible',
        }}>
          <div style={{ pointerEvents: 'auto', display: 'inline-block' }}>
            <DevToolsDashboard
              defaultX={Math.max(20, window.innerWidth - 1140)}
              defaultY={60}
              defaultTab="chain"
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
