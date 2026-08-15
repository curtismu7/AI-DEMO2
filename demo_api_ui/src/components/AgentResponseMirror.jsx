// AgentResponseMirror.jsx
// Shows the latest agent response on the main page (float mode).
// Visibility controlled via agent-mirror-toggle custom event + localStorage.
import React, { useEffect, useState } from 'react';
import './AgentResponseMirror.css';

const STORAGE_KEY = 'ba_show_response_mirror';

export default function AgentResponseMirror() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [text, setText] = useState('');

  useEffect(() => {
    const onResponse = (e) => setText(e.detail?.text || '');
    const onToggle = (e) => setVisible(!!e.detail?.on);
    window.addEventListener('agent-last-response', onResponse);
    window.addEventListener('agent-mirror-toggle', onToggle);
    return () => {
      window.removeEventListener('agent-last-response', onResponse);
      window.removeEventListener('agent-mirror-toggle', onToggle);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="arm-panel" role="region" aria-label="Last agent response">
      <div className="arm-header">
        <span className="arm-title">Last Response</span>
      </div>
      <div className="arm-body">
        {text ? (
          <p className="arm-text">{text}</p>
        ) : (
          <p className="arm-empty">Waiting for agent response…</p>
        )}
      </div>
    </div>
  );
}
