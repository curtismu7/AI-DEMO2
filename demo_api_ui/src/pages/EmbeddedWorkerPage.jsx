import { useEffect, useState } from 'react';
import AgentClientSkin from '../components/AgentClientSkin';
import './EmbeddedWorkerPage.css';

const USE_CASE_ID = 'saas-embedded-worker';

export default function EmbeddedWorkerPage() {
  const [agent, setAgent] = useState(null);
  const [creating, setCreating] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'agent', text: "Hi! I'm the store's embedded Website Worker. I can help with your account, orders, and delivery preferences while preserving your customer identity." },
  ]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/embedded-worker/state', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : {}))
      .then((body) => { if (!cancelled) setAgent(body?.agent || null); })
      .catch(() => { if (!cancelled) setAgent(null); });
    return () => { cancelled = true; };
  }, []);

  function createWorker() {
    setCreating(true);
    fetch('/api/embedded-worker/agent', { method: 'POST', credentials: 'include' })
      .then((response) => response.json())
      .then((body) => setAgent(body?.agent || null))
      .finally(() => setCreating(false));
  }

  function handleSend(prompt) {
    setMessages((previous) => [...previous, { role: 'user', text: prompt }, { role: 'agent', typing: true, text: '' }]);
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt, vertical: 'airlines', useCaseId: USE_CASE_ID }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => setMessages((previous) => [...previous.filter((message) => !message.typing), { role: 'agent', text: data.reply || 'The Website Worker completed the request.' }]))
      .catch((error) => setMessages((previous) => [...previous.filter((message) => !message.typing), { role: 'agent', text: error.message || 'The Website Worker could not complete the request.' }]));
  }

  return (
    <main className="embedded-worker-page">
      <section className="embedded-worker-page__context" aria-label="Embedded agent context">
        <div>
          <p className="embedded-worker-page__eyebrow">SAAS-EMBEDDED AGENT</p>
          <h1>Website Worker</h1>
          <p>Embedded in the customer website, the worker acts for the signed-in customer without becoming the customer.</p>
        </div>
        <div className="embedded-worker-page__identity">
          <span className={`embedded-worker-page__status ${agent ? 'is-live' : ''}`} />
          <div>
            <strong>{agent?.name || 'No worker identity loaded'}</strong>
            <span>{agent ? `PingOne identity · ${agent.id}` : 'Sign in and build the agent to activate this lane'}</span>
          </div>
          {!agent && <button type="button" onClick={createWorker} disabled={creating}>{creating ? 'Creating…' : 'Create Website Worker'}</button>}
        </div>
      </section>
      <section className="embedded-worker-page__experience" aria-label="Website worker experience">
        <AgentClientSkin
          skin="gpt"
          theme="light"
          messages={messages}
          onSend={handleSend}
          showPopOutButton={false}
          onPopOut={null}
        />
      </section>
    </main>
  );
}
