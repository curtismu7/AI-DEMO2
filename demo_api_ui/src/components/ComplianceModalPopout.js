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
      <div className="compliance-modal-popout-root compliance-modal-popout-loading">
        Loading compliance modal…
      </div>
    );
  }

  return (
    <div className="compliance-modal-popout-root">
      <div className="compliance-modal-popout-panel">
        {/* Close button — top right corner */}
        <button
          type="button"
          onClick={() => window.close()}
          className="compliance-modal-popout-close"
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
