import React, { useEffect, useState, useRef } from 'react';
import AgentDemoGuide from './AgentDemoGuide';
import AIAgent from './AIAgent';
import './AgentDemoGuide.css';

/**
 * Pop-out version of the Agent Demo Guide — displayed in a separate window with the agent beside it.
 */
export default function DemoGuidePopout() {
  const [data, setData] = useState(null);
  const broadcastChannelRef = useRef(null);

  useEffect(() => {
    // Load initial data from sessionStorage
    try {
      const stored = sessionStorage.getItem('demo_guide_modal_popout');
      if (stored) {
        setData(JSON.parse(stored));
      }
    } catch (_) {}

    // Listen to BroadcastChannel for updates from original window
    try {
      broadcastChannelRef.current = new BroadcastChannel('demo-guide-modal');
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
        Loading demo guide…
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '90vw', height: '90vh', maxWidth: '1400px', maxHeight: '800px', background: '#fff', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)', display: 'flex' }}>
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

        {/* Demo Guide — left side */}
        <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #e0e0e0' }}>
          <AgentDemoGuide
            onClose={() => window.close()}
            initialActiveScenario={data.activeScenario}
            initialExpandedSteps={data.expandedSteps}
            isPopout={true}
          />
        </div>

        {/* Agent — right side */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
          <AIAgent user={null} placement="none" />
        </div>
      </div>
    </div>
  );
}
