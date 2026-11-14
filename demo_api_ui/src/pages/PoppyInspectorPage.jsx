// Poppy protocol inspector (Company side): the feed of what Personal Agents sent to the
// Company's Poppy API and what the Company made of each request. Admin-only. Read-only.
// Mirrors the Cliffside protocol-inspector demo: newest-first rows, expandable per request
// into the verification narrative and raw Received / Sent panes. Tokens are fingerprints.
import { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import './PoppyInspectorPage.css';

function ReceivedSent({ entry }) {
  return (
    <div className="poppy-inspect-panes" data-testid="poppy-inspect-panes">
      <pre className="poppy-inspect-pane" aria-label="Received">
        <strong>Received</strong>
        {'\n'}
        {`${entry.received.method} ${entry.received.url}\n`}
        {entry.received.poppy_session ? `poppy-session: ${entry.received.poppy_session}\n` : ''}
        {entry.received.authorization ? `${entry.received.authorization}\n` : ''}
        {entry.received.body ? `\n${entry.received.body}` : ''}
      </pre>
      <pre className="poppy-inspect-pane" aria-label="Sent">
        <strong>Sent</strong>
        {'\n'}
        {`HTTP ${entry.sent.status}\n`}
        {entry.sent.body ? entry.sent.body : ''}
      </pre>
    </div>
  );
}

function InspectorRow({ entry, open, onToggle }) {
  return (
    <li className="poppy-inspect-row">
      <button
        type="button"
        className="poppy-inspect-row__head"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={`poppy-inspect-row-${entry.id}`}
      >
        <span className={`poppy-inspect-method poppy-inspect-method--${entry.received.method.toLowerCase()}`}>
          {entry.received.method}
        </span>
        <span className="poppy-inspect-path">{entry.received.url}</span>
        <span className={`poppy-inspect-status ${entry.sent.status < 400 ? 'poppy-inspect-status--ok' : 'poppy-inspect-status--err'}`}>
          {entry.sent.status}
        </span>
        <span className="poppy-inspect-agent">
          {entry.agentId || entry.clientId || '(unknown agent)'}
          {entry.signedOut ? ' · signed out' : entry.userId ? ` · ${entry.userId}` : ''}
        </span>
        <span className="poppy-inspect-time">{new Date(entry.at).toLocaleTimeString()}</span>
      </button>
      {open && (
        <div className="poppy-inspect-detail" data-testid="poppy-inspect-detail">
          <ol className="poppy-inspect-reasoning" aria-label="Company reasoning">
            {entry.reasoning.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
          <ReceivedSent entry={entry} />
        </div>
      )}
    </li>
  );
}

export default function PoppyInspectorPage() {
  const [entries, setEntries] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agent, setAgent] = useState('');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = agent ? `?agent=${encodeURIComponent(agent)}` : '';
      const res = await apiClient.get(`/api/admin/poppy/inspect${params}`);
      setEntries(res.data.entries || []);
      setError('');
      const ag = await apiClient.get('/api/admin/poppy/inspect/agents');
      setAgents(ag.data.agents || []);
    } catch (err) {
      setError(err.response?.data?.error === 'Access denied. Admin role required.'
        ? 'This feed is admin-only.'
        : 'Could not load the Poppy inspection feed.');
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);
  // The feed updates as agents call the Company; refresh gently while the page is open.
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="poppy-page" data-testid="poppy-inspector">
      <h2>Poppy protocol inspector</h2>
      <p className="poppy-muted">
        What Personal Agents sent to the Company&apos;s Poppy API, newest first, and what the
        Company made of each request. Tokens are shown shortened. Refreshes every few seconds.
      </p>
      {error && <p className="poppy-muted" role="alert" data-testid="poppy-inspect-error">{error}</p>}
      {agents.length > 1 && (
        <label className="poppy-inspect-agentpick" htmlFor="poppy-inspect-agent">
          Agent
          <select id="poppy-inspect-agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      )}
      {entries === null ? (
        <p className="poppy-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="poppy-muted" data-testid="poppy-inspect-empty">
          Nothing yet. Point the Poppy Agent Tester lab at this Company and make a call.
        </p>
      ) : (
        <ul className="poppy-inspect-list">
          {entries.map((e) => (
            <InspectorRow key={e.id} entry={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
