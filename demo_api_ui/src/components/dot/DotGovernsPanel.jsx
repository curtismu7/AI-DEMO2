import React from 'react';

export default function DotGovernsPanel({ cards, persona, mode }) {
  const last3 = cards.slice(-3);
  const count = (v) => last3.filter((c) => c.verdict === v).length;
  const tally = last3.length
    ? [`${count('PERMIT')} PERMIT`, count('DENY') && `${count('DENY')} DENY`, count('CONSENT') && `${count('CONSENT')} CONSENT`].filter(Boolean).join(' · ')
    : 'No calls yet';
  return (
    <section className="dot-card" aria-label="What Ping governs">
      <h3>What Ping governs</h3>
      <p className="dot-sub">Every tool call, checked live.</p>
      <div className="dot-gov">
        <div><span>Identity</span><span>{persona.agentName ? `${persona.agentName} has its own agent identity` : '—'}</span></div>
        <div><span>Delegation</span><span>{persona.scopes.length ? `${persona.scopes.length} scope${persona.scopes.length === 1 ? '' : 's'}` : '—'}</span></div>
        <div><span>Last 3 calls</span><span>{tally}</span></div>
        <div><span>Mode</span><span>{mode === 'heuristics' ? 'Heuristics (no model call)' : 'llama.cpp (model routes)'}</span></div>
      </div>
    </section>
  );
}
