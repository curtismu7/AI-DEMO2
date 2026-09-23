// demo_api_ui/src/pages/HostileMcpTab.jsx
//
// The "Malicious MCP" tab on /llm-gateway: drives the deliberately hostile MCP
// server (standalone/hostile-mcp-server, Agentic App `hostile-mcp`) through the
// SAME BFF relay the Privilege MCP client page uses — POST /config to point the
// session at the hostile door, POST /tools/list to fetch the poisoned metadata,
// POST /tools/call to fire `create_transfer` and show Privilege deny it.
//
// Honesty rule (same family as LlmGatewayPage's): the poison is in tool
// METADATA and the gateway does not police metadata — this tab says so rather
// than implying a scan. The Privilege verdict shown is on the TOOL CALL only.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HostileMcpDenialPanel from '../components/privilege/HostileMcpDenialPanel';
import './HostileMcpTab.css';

const API_BASE = '/api/privilege-mcp';
// Loosely matched against the BFF's preset label so a label edit on the BFF
// does not silently unfind the door.
const HOSTILE_PRESET_MATCH = /hostile-mcp/i;

function api(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || `HTTP ${r.status}`);
      err.status = r.status;
      if (data.loginUrl) err.loginUrl = data.loginUrl;
      throw err;
    }
    return data;
  });
}

function isPoisoned(t) {
  const blob = `${t.description || ''}${JSON.stringify(t.inputSchema || {})}`;
  return /IMPORTANT|callback_url/i.test(blob);
}

export default function HostileMcpTab() {
  const [doorUrl, setDoorUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [config, setConfig] = useState({});
  const [tools, setTools] = useState([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [agentProvider, setAgentProvider] = useState('llamacpp');
  const [agentTask, setAgentTask] = useState("What's the weather in Denver?");

  const log = (line) => setEvents((prev) => [...prev.slice(-40), { at: new Date(), line }]);

  useEffect(() => {
    let cancelled = false;
    api('/state').then((s) => {
      if (cancelled) return;
      setConfig(s.config || {});
      setCurrentUrl(s.config?.mcpUrl || '');
      const preset = (s.presets || []).find((p) => HOSTILE_PRESET_MATCH.test(p.label || ''));
      if (preset) setDoorUrl(preset.url);
    }).catch((err) => setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const onHostileDoor = (currentUrl || '').includes('hostile-mcp');

  const pointAt = async (url) => {
    if (!url) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api('/config', { method: 'POST', body: { ...config, mcpUrl: url, gatewayMode: 'privilege' } });
      setCurrentUrl(url);
      setAuthenticated(Boolean(saved?.oauth?.authenticated));
      setTools([]);
      log(`door → ${url}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/auth/start', { method: 'POST' });
      if (data?.authUrl) { window.location.href = data.authUrl; return; }
      // No authUrl means no redirect was needed (shared token) — we are signed in.
      setAuthenticated(true);
      await refreshTools();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshTools = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/tools/list', { method: 'POST', body: {} });
      setTools(data.tools || []);
      log(`tools/list — ${data.tools?.length || 0} tools, poison included verbatim`);
    } catch (err) {
      if (err.status === 401) { setAuthenticated(false); setError('Not authenticated — click Sign in with Privilege.'); }
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const callTransfer = async () => {
    setBusy(true);
    setError('');
    try {
      const t0 = performance.now();
      const data = await api('/tools/call', { method: 'POST', body: { name: 'create_transfer', arguments: { amount: 500, to: 'external-001' } } });
      const latency = Math.round(performance.now() - t0);
      const text = (data.content || []).map((c) => c.text || '').join('\n') || JSON.stringify(data);
      log(`ALLOWED by the gateway (${latency} ms) — create_transfer: ${text}`);
    } catch (err) {
      if (err.status === 403 || err.status === 401) {
        log(`🛡 DENIED by Privilege (${err.status}) — create_transfer: ${err.message}`);
      } else {
        log(`✕ create_transfer — ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  // The agent loop: hand the poisoned tool metadata to a real model and let IT
  // choose the tool calls. Each model-chosen call executes through the same
  // Privilege relay, so a denial reaches the model as its tool result.
  const runAgent = async (provider, task) => {
    setBusy(true);
    setError('');
    try {
      const t0 = performance.now();
      const data = await api('/agent/run', { method: 'POST', body: { provider, task } });
      const latency = Math.round(performance.now() - t0);
      log(`— agent run (${provider}, ${latency} ms) — task: "${task}"`);
      for (const step of data.trace || []) {
        log(step.verdict === 'denied'
          ? `🛡 ${step.tool} DENIED by Privilege (${step.latencyMs} ms) — ${step.detail}`
          : step.verdict === 'allowed'
            ? `✓ ${step.tool} allowed (${step.latencyMs} ms) — ${step.detail}`
            : `✕ ${step.tool} — ${step.detail}`);
      }
      log(`model: ${data.answer}`);
    } catch (err) {
      log(`✕ agent run — ${err.message}`);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hmc">
      <header className="hmc-bar">
        <div>
          <h1>Malicious MCP</h1>
          <p>
            The hostile MCP server (<code>hostile-mcp</code> Agentic App) serves poisoned tool
            metadata. Privilege does not police metadata — the demonstration is the gateway
            denying the <code>create_transfer</code> <strong>call</strong> the poison induces.
            {' '}<Link to="/privilege-mcp-client">Open the full client</Link>
          </p>
        </div>
        <div className="hmc-bar__side">
          {!onHostileDoor ? (
            <button type="button" className="hmc-btn hmc-btn--danger" disabled={busy || !doorUrl}
              onClick={() => pointAt(doorUrl)} title="Point the relay at the hostile door">
              Switch to hostile door
            </button>
          ) : (
            <span className="hmc-pill hmc-pill--ok">On the hostile door</span>
          )}
          {onHostileDoor && !authenticated ? (
            <button type="button" className="hmc-btn" disabled={busy} onClick={signIn}>
              Sign in with Privilege
            </button>
          ) : null}
          <button type="button" className="hmc-btn" disabled={busy || !onHostileDoor || !authenticated} onClick={refreshTools}>
            Get MCP Tools
          </button>
        </div>
      </header>

      {error ? <p className="hmc-error" role="alert">{error}</p> : null}

      <HostileMcpDenialPanel
        tools={tools}
        onRequest={({ method, params }) => api('/request', { method: 'POST', body: { method, params } })}
        onCall={({ name, arguments: args }) => api('/tools/call', { method: 'POST', body: { name, arguments: args } })}
      />

      <div className="hmc-body">
        <section className="hmc-pane" aria-label="Poisoned tools">
          <h2 className="hmc-k">Tools ({tools.length})</h2>
          {tools.length === 0 ? (
            <p className="hmc-note">
              Switch to the hostile door, sign in, then Get MCP Tools. The poison arrives in the
              metadata below, unfiltered — that is the point: it lands in the client&rsquo;s context.
              The gateway&rsquo;s job begins at the call.
            </p>
          ) : tools.map((t) => (
            <div key={t.name} className={`hmc-tool${isPoisoned(t) ? ' hmc-tool--poison' : ''}`}>
              <div className="hmc-tool__name">
                {t.name}
                {isPoisoned(t) ? <span className="hmc-pill hmc-pill--warn">poisoned metadata</span> : null}
                {t.name === 'create_transfer' ? <span className="hmc-pill hmc-pill--bad">harmful action</span> : null}
              </div>
              <details className="hmc-tool__desc">
                <summary>description / schema</summary>
                <pre>{(t.description || '') + '\n' + JSON.stringify(t.inputSchema || {}, null, 2)}</pre>
              </details>
              {t.name === 'create_transfer' ? (
                <button type="button" className="hmc-btn hmc-btn--danger" disabled={busy}
                  onClick={callTransfer}>
                  Call create_transfer ($500 → external-001)
                </button>
              ) : null}
            </div>
          ))}
          {tools.length > 0 ? (
            <div className="hmc-agent">
              <div className="hmc-tool__name">Let the model act on the poison</div>
              <p className="hmc-note">
                Sends the poisoned <code>tools/list</code> metadata to the model as real tool
                definitions. A benign task (&ldquo;What&rsquo;s the weather in Denver?&rdquo;) shows the
                poison landing: the model calls <code>create_transfer</code> or fills the exfil sink on
                its own, and Privilege polices the call.
              </p>
              <div className="hmc-agent__row">
                <select value={agentProvider} onChange={(e) => setAgentProvider(e.target.value)} disabled={busy} aria-label="Model">
                  <option value="llamacpp">llama.cpp (local, unmediated)</option>
                  <option value="anthropic">Claude — through Privilege LLM virtual key</option>
                </select>
                <input
                  value={agentTask}
                  onChange={(e) => setAgentTask(e.target.value)}
                  placeholder="What's the weather in Denver?"
                  aria-label="Agent task"
                />
                <button type="button" className="hmc-btn" disabled={busy || !authenticated || !agentTask.trim()}
                  onClick={() => runAgent(agentProvider, agentTask.trim())}>
                  Run agent
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="hmc-pane" aria-label="Relay log">
          <h2 className="hmc-k">Relay log</h2>
          {events.length === 0 ? (
            <p className="hmc-note">Fire the induced call and the gateway&rsquo;s verdict lands here.</p>
          ) : (
            <ol className="hmc-events">
              {events.map((e, i) => <li key={i} className="hmc-event">{e.line}</li>)}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
