import { useEffect, useRef, useState } from 'react';
import './EmbeddedWorkerPage.css';

const USE_CASE_ID = 'saas-embedded-worker';
const TABS = ['Home', 'Accounts', 'Contacts', 'Opportunities', 'Cases', 'Reports'];

export default function EmbeddedWorkerPage() {
  const [agent, setAgent] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);
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

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages]);

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

  function submit() {
    const prompt = draft.trim();
    if (!prompt) return;
    setDraft('');
    handleSend(prompt);
  }

  return (
    <main className="embedded-worker-page">
      <div className="ew-crm" aria-label="Sales Cloud-style CRM hosting an embedded agent">
        <header className="ew-crm__global">
          <span className="ew-crm__launcher" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
          <span className="ew-crm__brand"><span className="ew-crm__cloud" aria-hidden="true" />Sales Cloud-style CRM</span>
          <span className="ew-crm__search">Search records, accounts and cases…</span>
          <span className="ew-crm__avatar" aria-hidden="true">👤</span>
        </header>
        <nav className="ew-crm__tabs" aria-label="CRM objects">
          <span className="ew-crm__app">Sales</span>
          {TABS.map((tab) => (
            <span key={tab} className={`ew-crm__tab ${tab === 'Accounts' ? 'is-active' : ''}`}>{tab}</span>
          ))}
        </nav>
        <div className="ew-crm__body">
          <section className="ew-crm__record" aria-label="Embedded agent context">
            <p className="ew-crm__crumb">Account</p>
            <h2>Northwind Traders</h2>
            <dl className="ew-crm__fields">
              <div><dt>Owner</dt><dd>Sam Rivera</dd></div>
              <div><dt>Stage</dt><dd>Renewal</dd></div>
              <div><dt>Open cases</dt><dd>2</dd></div>
              <div><dt>Annual value</dt><dd>$184,000</dd></div>
            </dl>
            <div className="ew-crm__card">
              <p className="embedded-worker-page__eyebrow">SAAS-EMBEDDED AGENT</p>
              <h1>Website Worker</h1>
              <p>Embedded in a third-party SaaS app, the worker acts for the signed-in user without becoming that user.</p>
            </div>
          </section>
          <aside className="ew-crm__panel" aria-label="Website worker experience">
            <div className="ew-crm__panel-head">
              <span className={`embedded-worker-page__status ${agent ? 'is-live' : ''}`} />
              <div className="ew-crm__who">
                <strong>{agent?.name || 'No worker identity loaded'}</strong>
                <span>{agent ? `PingOne identity · ${agent.id}` : 'Sign in and build the agent to activate this lane'}</span>
              </div>
              {!agent && <button type="button" onClick={createWorker} disabled={creating}>{creating ? 'Creating…' : 'Create Website Worker'}</button>}
            </div>
            <p className="ew-crm__delegated">🔑 Delegated token · acts on behalf of the signed-in user</p>
            <div className="ew-crm__chat" role="log" aria-live="polite">
              {messages.map((message, index) => (
                <div key={index} className={`ew-crm__msg is-${message.role}`}>{message.typing ? 'Working…' : message.text}</div>
              ))}
              <div ref={endRef} />
            </div>
            <div className="ew-crm__compose">
              <input
                type="text"
                value={draft}
                placeholder="Ask the agent about this account…"
                aria-label="Message the Website Worker"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
              />
              <button type="button" onClick={submit}>Send</button>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
