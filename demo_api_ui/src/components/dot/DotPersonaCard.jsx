import React from 'react';

export default function DotPersonaCard({ persona, identity }) {
  return (
    <div className="dot-card dot-persona">
      <div className="dot-avatar" aria-hidden="true" />
      <div>
        <h2>{persona.agentName || 'Dot'} <span className="dot-muted">· your always-on persona agent</span></h2>
        <p>Remembers how you like things done. Ping governs every tool call, never its memory.</p>
      </div>
      <div className="dot-pills">
        <span className="dot-pill">Acts as <b>{identity || '—'}</b></span>
        <span className="dot-pill">Agent identity <b>{persona.agentId || '—'}</b></span>
        {persona.scopes.length > 0 && <span className="dot-pill">Scopes <b>{persona.scopes.join(' · ')}</b></span>}
      </div>
    </div>
  );
}
