// demo_api_ui/src/components/shared/InspectorTabs.jsx
import React from 'react';
import './InspectorShell.css';

/**
 * Output tab bar. Renders tabs and highlights activeKey; tab content is
 * rendered separately by the caller.
 */
export default function InspectorTabs({ tabs, activeKey, onChange }) {
  return (
    <div className="inspector-shell-output-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={
            tab.key === activeKey
              ? 'inspector-shell-output-tab inspector-shell-output-tab--active'
              : 'inspector-shell-output-tab'
          }
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
