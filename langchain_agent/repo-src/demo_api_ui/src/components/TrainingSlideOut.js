import React from 'react';

const S = {
  overlay: {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(30,41,59,0.32)', zIndex: 1000,
  },
  panel: {
    position: 'fixed', top: 0, right: 0, width: 480, maxWidth: '100vw', height: '100vh', background: '#fff', boxShadow: '-2px 0 16px rgba(0,0,0,0.10)', zIndex: 1001, padding: 32, overflowY: 'auto',
  },
  closeBtn: {
    position: 'absolute', top: 18, right: 24, background: 'none', border: 'none', fontSize: 22, color: '#374151', cursor: 'pointer',
  },
  heading: { fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 18 },
  section: { marginBottom: 24 },
  link: { color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' },
  list: { paddingLeft: 20, marginBottom: 12 },
};

export default function TrainingSlideOut({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.panel} onClick={e => e.stopPropagation()}>
        <button style={S.closeBtn} onClick={onClose} aria-label="Close">×</button>
        <div style={S.heading}>🤖 What Are AI Agents?</div>
        <div style={S.section}>
          <p>
            AI agents are autonomous or semi-autonomous programs that can perceive their environment, reason about it, and take actions to achieve goals. In the context of identity and security, agents can act on behalf of users or systems, making decisions and performing tasks securely.
          </p>
          <p>
            <strong>Learn more:</strong> <a href="https://developer.pingidentity.com/identity-for-ai/agents/idai-what-are-agents.html" target="_blank" rel="noopener noreferrer" style={S.link}>Ping Identity: What Are Agents?</a>
          </p>
        </div>
        <div style={S.section}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Key Concepts:</div>
          <ul style={S.list}>
            <li>Agents can be embedded in apps, run as services, or operate as cloud-based tools.</li>
            <li>They use identity, authentication, and authorization to act securely.</li>
            <li>Agents can chain actions, call APIs, and enforce policies.</li>
            <li>They are governed by scopes, tokens, and audit trails.</li>
          </ul>
        </div>
        <div style={S.section}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>BX Finance AI Agent Docs:</div>
          <ul style={S.list}>
            <li><a href="/docs/ai-overview" style={S.link}>AI Overview</a></li>
            <li><a href="/docs/ai-security" style={S.link}>AI Security & Trust</a></li>
            <li><a href="/docs/ai-architecture" style={S.link}>AI Architecture</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
