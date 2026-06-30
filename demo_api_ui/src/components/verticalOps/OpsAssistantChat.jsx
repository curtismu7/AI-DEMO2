// OpsAssistantChat.jsx
import React, { useState } from 'react';
import bffAxios from '../../services/bffAxios';

export default function OpsAssistantChat({ vertical, query }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);

  async function ask(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: 'u', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const { data } = await bffAxios.post(`/api/admin/${vertical}/ops-assistant`, { message: q, query });
      setMsgs((m) => [...m, { role: 'a', text: data.reply || '…' }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'a', text: 'Assistant offline. Try again shortly.' }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="vops-assistant">
      <button type="button" className="vops-assistant__bar" onClick={() => setOpen((o) => !o)}>
        🤖 <b>Ops Assistant</b> <span className="vops-assistant__ro">READ-ONLY</span>
      </button>
      {open && (
        <div className="vops-assistant__panel">
          <div className="vops-assistant__msgs">
            {msgs.length === 0 && <div className="vops-assistant__a">Ask me about this customer — I can summarize but can't change anything.</div>}
            {msgs.map((m, i) => <div key={i} className={m.role === 'u' ? 'vops-assistant__u' : 'vops-assistant__a'}>{m.text}</div>)}
          </div>
          <form className="vops-assistant__in" data-testid="ops-chat-form" onSubmit={ask}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this customer…" />
            <button type="submit" disabled={busy}>{busy ? '…' : 'Send'}</button>
          </form>
        </div>
      )}
    </div>
  );
}
