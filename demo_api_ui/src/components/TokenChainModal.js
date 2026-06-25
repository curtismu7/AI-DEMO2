// demo_api_ui/src/components/TokenChainModal.js
import React, { useState } from 'react';
import ActivityLogPanel from './ActivityLogPanel';
import DraggableModal from './DraggableModal';
import TokenChainDisplay from './TokenChainDisplay';

/**
 * Token Chain modal — draggable, resizable, pop-out.
 *
 * Two tabs:
 *   Token Chain  — RFC 8693 token inspection (unchanged)
 *   Activity Log — live /api/app-events/stream event feed
 *
 * credentialPath: each token-chain event carries a credentialPath field added in Phase 266.
 * TokenChainDisplay handles per-segment colour/badge rendering automatically.
 * No props change needed here — the field rides through TokenChainContext events unchanged.
 */

const TAB_TOKEN_CHAIN = 'tokenChain';
const TAB_ACTIVITY_LOG = 'activityLog';

const tabBarStyle = {
  display: 'flex',
  borderBottom: '2px solid #e2e8f0',
  background: '#f8fafc',
  flexShrink: 0,
};

function tabStyle(active) {
  return {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: active ? 700 : 500,
    color: active ? '#1e40af' : '#64748b',
    borderBottom: active ? '2px solid #1e40af' : '2px solid transparent',
    marginBottom: '-2px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    outline: 'none',
    whiteSpace: 'nowrap',
  };
}

export default function TokenChainModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState(TAB_TOKEN_CHAIN);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Chain"
      defaultWidth={700}
      defaultHeight={720}
      storageKey="ba-token-chain-modal"
      footer={null}
      closeOnPopout
      zIndex={10000}
    >
      {/* Tab bar */}
      <div style={tabBarStyle}>
        <button
          type="button"
          style={tabStyle(activeTab === TAB_TOKEN_CHAIN)}
          onClick={() => setActiveTab(TAB_TOKEN_CHAIN)}
        >
          Token Chain
        </button>
        <button
          type="button"
          style={tabStyle(activeTab === TAB_ACTIVITY_LOG)}
          onClick={() => setActiveTab(TAB_ACTIVITY_LOG)}
        >
          Activity Log
        </button>
      </div>

      {/* Keep both mounted so SSE doesn't restart on tab switch */}
      <div style={{ display: activeTab === TAB_TOKEN_CHAIN ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <TokenChainDisplay hideHeader />
      </div>
      <div style={{ display: activeTab === TAB_ACTIVITY_LOG ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <ActivityLogPanel enabled={isOpen} />
      </div>
    </DraggableModal>
  );
}
