// banking_api_ui/src/components/DevToolsDashboard.jsx
/**
 * DevToolsDashboard — combines Live Token Chain, Agent & Token Flow Inspector,
 * and MCP Traffic into a single tabbed FloatingPanel.
 *
 * Draggable, 8-direction resizable, pop-out to second screen via FloatingPanel.
 */
import React, { useState } from 'react';
import FloatingPanel from './FloatingPanel';
import TokenChainDisplay from './TokenChainDisplay';
import UnifiedTokenFlowInspector from './UnifiedTokenFlowInspector';
import McpTrafficPage from './McpTrafficPage';
import TokenDiffPanel from './TokenDiffPanel';
import ApiExplorerPanel from './ApiExplorerPanel';

const TABS = [
  { id: 'chain',     icon: '🔗', label: 'Token Chain' },
  { id: 'diff',      icon: '📊', label: 'Token Diff' },
  { id: 'inspector', icon: '🔬', label: 'Flow Inspector' },
  { id: 'traffic',   icon: '🔌', label: 'MCP Traffic' },
  { id: 'api',       icon: '📡', label: 'API Explorer' },
];

export default function DevToolsDashboard({
  defaultWidth = 1100,
  defaultHeight = 620,
  defaultX = 0,
  defaultY = 0,
  defaultTab = 'chain',
  defaultCollapsed = false,
  bottomDock = false,
  className = '',
  onClose,
}) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <FloatingPanel
      title="🛠 Dev Tools Dashboard"
      defaultWidth={defaultWidth}
      defaultHeight={defaultHeight}
      defaultX={defaultX}
      defaultY={defaultY}
      defaultCollapsed={defaultCollapsed}
      bottomDock={bottomDock}
      minWidth={380}
      minHeight={320}
      className={`devtools-panel ${className}`}
    >
      {/* Full-height flex wrapper — lets tab bar stay fixed while content scrolls */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar — light background so it clearly differs from the dark navy title bar */}
      <div style={{
        display: "flex",
        background: "#2d3748",
        flexShrink: 0,
        gap: "3px",
        padding: "8px 10px 0",
        alignItems: "flex-end",
        borderBottom: "2px solid #1a202c",
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 20px 10px",
              border: "1px solid",
              borderColor: activeTab === tab.id ? "#c5cdd8" : "transparent",
              borderBottom: activeTab === tab.id ? "2px solid #ffffff" : "1px solid transparent",
              borderRadius: "6px 6px 0 0",
              background: activeTab === tab.id ? "#dc2626" : "#991b1b",
              cursor: "pointer",
              fontSize: "0.88rem",
              fontWeight: activeTab === tab.id ? 700 : 400,
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              gap: "7px",
              transition: "background 0.15s, color 0.15s",
              whiteSpace: "nowrap",
              marginBottom: activeTab === tab.id ? "-2px" : "0",
              boxShadow: activeTab === tab.id ? "0 -2px 0 #2563eb" : "none",
              letterSpacing: "0.01em",
            }}
          >
            <span style={{ fontSize: "1rem" }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ alignSelf: "center", paddingBottom: 8, paddingRight: 10, fontSize: "0.7rem", color: "rgba(255,255,255,0.5)" }}>
          drag · resize · ↗ pop out
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close Dev Tools"
            style={{
              alignSelf: "center", marginBottom: 8, marginRight: 6,
              background: "none", border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "4px", color: "rgba(255,255,255,0.7)",
              cursor: "pointer", fontSize: "1rem", lineHeight: 1,
              padding: "2px 7px", fontWeight: 700,
            }}
          >✕</button>
        )}
      </div>
      {/* Tab panels — all mounted to preserve polling/state */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: activeTab === 'chain' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <TokenChainDisplay hideHeader />
        </div>
        <div style={{ display: activeTab === 'diff' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <TokenDiffPanel />
        </div>
        <div style={{ display: activeTab === 'inspector' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
          <UnifiedTokenFlowInspector floatingByDefault={false} showToggle={false} />
        </div>
        <div style={{ display: activeTab === 'traffic' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <McpTrafficPage />
        </div>
        <div style={{ display: activeTab === 'api' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <ApiExplorerPanel />
        </div>
      </div>
      </div>{/* end full-height wrapper */}
    </FloatingPanel>
  );
}
