// Poppy protocol inspector (Company side): the feed of what Personal Agents sent to the
// Company's Poppy API and what the Company made of each request. Admin-only. Read-only.
// Mirrors the Cliffside protocol-inspector demo: newest-first rows, expandable per request
// into the verification narrative and raw Received / Sent panes. Tokens are fingerprints.
// JSON renders colored (JsonView) with a Pretty / Raw toggle per pane.
import { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import JsonView from './JsonView';
import './PoppyInspectorPage.css';

function ReceivedSent({ entry }) {
  const [view, setView] = useState('pretty');
  const received = { ...entry.received };
  const sentBody = entry.sent.body == null ? null : safeParse(entry.sent.body);
  return (
    <div className="poppy-inspect-panes" data-testid="poppy-inspect-panes">
      <h4 className="poppy-inspect-panetitle">Received</h4>
      <JsonView
        label="Received"
        view={view}
        onChangeView={setView}
        data={{
          request: `${received.method} ${received.url}`,
          'poppy-session': received.poppy_session || undefined,
          authorization: received.authorization || undefined,
          body: received.body ? safeParse(received.body) : undefined,
        }}
      />
      <h4 className="poppy-inspect-panetitle">Sent</h4>
      <JsonView
        label="Sent"
        view={view}
        onChangeView={setView}
        data={{ status: entry.sent.status, body: sentBody ?? undefined }}
      />
    </div>
  );
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
  const [source, setSource] = useState(null); // 'admin' | 'public'

  const load = useCallback(async () => {
    // Admins get the full feed (user + session identity); everyone else gets the
    // public projection: same requests, same narrative order, identity withheld.
    try {
      const params = agent ? `?agent=${encodeURIComponent(agent)}` : '';
      const res = await apiClient.get(`/api/admin/poppy/inspect${params}`, { _noAuthBanner: true });
      setEntries(res.data.entries || []);
      setSource('admin');
      setError('');
      const ag = await apiClient.get('/api/admin/poppy/inspect/agents', { _noAuthBanner: true });
      setAgents(ag.data.agents || []);
      return;
    } catch { /* not an admin: fall through to the public feed */ }
    try {
      const params = agent ? `?agent=${encodeURIComponent(agent)}` : '';
      const res = await apiClient.get(`/api/poppy/inspector${params}`);
      setEntries(res.data.entries || []);
      setSource('public');
      setError('');
      setAgents([]);
    } catch (err) {
      setError('Could not load the Poppy inspection feed.');
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
      {source === 'public' && (
        <p className="poppy-muted" data-testid="poppy-inspect-public-note">
          Public view: user and session identity is withheld (Poppy spec §5.1 — User IDs are
          pseudonymous and are not the Company&apos;s to publish). Sign in as a Company admin to see
          the full feed.
        </p>
      )}
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
