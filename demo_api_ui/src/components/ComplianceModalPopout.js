import React, { useEffect, useState, useRef } from 'react';
import ComplianceModalContent from './ComplianceModalContent';
import './ComplianceModal.css';

/**
 * Pop-out version of the compliance modal — displayed in a separate window.
 */
export default function ComplianceModalPopout() {
  const [data, setData] = useState(null);
  const broadcastChannelRef = useRef(null);

  useEffect(() => {
    // Load initial data from sessionStorage
    try {
      const stored = sessionStorage.getItem('compliance_modal_popout');
      if (stored) {
        setData(JSON.parse(stored));
      }
    } catch (_) {}

    // Listen to BroadcastChannel for updates from original window
    try {
      broadcastChannelRef.current = new BroadcastChannel('compliance-modal');
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data.type === 'state-update' && event.data.data) {
          setData(event.data.data);
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel not supported:', e.message);
    }

    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, []);

  if (!data) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontSize: '14px', color: '#666' }}>
        Loading compliance modal…
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '90vw', height: '90vh', maxWidth: '500px', maxHeight: '700px', background: '#fff', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Close button — top right corner */}
        <button
          type="button"
          onClick={() => window.close()}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            padding: '4px 8px',
            zIndex: 1000,
          }}
          aria-label="Close window"
        >
          ✕
        </button>

        {/* Content */}
        <div
          className="compliance-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="compliance-modal-title"
          style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
        >
          <h2 id="compliance-modal-title" className="compliance-modal__modal-title">
            MCP Compliance Checklist
          </h2>

          <ComplianceModalContent
            complianceStripState={data.complianceStripState}
            messages={data.messages}
            onClearSteps={() => {}}
            CHIP_APPLICABLE_STEPS={[]}
            getStepSkipExplanation={() => ''}
          />
        </div>
      </div>
    </div>
  );
}
