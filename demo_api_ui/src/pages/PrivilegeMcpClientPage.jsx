// demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx
// Chat-first MCP client for PingOne Privilege MCP Gateway — integrated version.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './PrivilegeMcpClientPage.css';

const API_BASE = '/api/privilege-mcp';

function api(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  }).then(async (r) => {
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(data.error || text || `HTTP ${r.status}`);
    return data;
  });
}

function truncate(v, max = 240) {
  if (typeof v !== 'string') return v;
  return v.length <= max ? v : `${v.slice(0, max)}... (+${v.length - max} chars)`;
}

export default function PrivilegeMcpClientPage() {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState({ mcpUrl: '', clientId: '', scopes: 'openid profile email', llmUrl: 'http://127.0.0.1:11434', llmModel: 'llama3.2:1b' });
  const [authenticated, setAuthenticated] = useState(false);
  const [tools, setTools] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('List available tools from the connected MCP server.');
  const [thinking, setThinking] = useState(false);
  const [events, setEvents] = useState([]);
  const [selectedTool, setSelectedTool] = useState('');
  const [toolArgs, setToolArgs] = useState('{}');
  const [toolResult, setToolResult] = useState('');
  const [rawRpc, setRawRpc] = useState('{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "tools/list",\n  "params": {}\n}');
  const [rawRpcResult, setRawRpcResult] = useState('');
  const chatEndRef = useRef(null);
  const eventsRef = useRef(null);

  // scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // append helpers
  const appendChat = useCallback((role, content, extra = null) => {
    setChatMessages((prev) => [...prev, { role, content, extra, ts: Date.now() }]);
  }, []);

  const appendEvent = useCallback((entry) => {
    setEvents((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  // Load initial state
  useEffect(() => {
    api('/state').then((s) => {
      setConfig(s.config || config);
      setAuthenticated(Boolean(s.oauth?.authenticated));
      setTools(s.tools || []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE events
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    const handler = (type) => (e) => {
      try { appendEvent({ type, ...JSON.parse(e.data) }); } catch {}
    };
    es.addEventListener('relay', handler('relay'));
    es.addEventListener('oauth', handler('oauth'));
    es.addEventListener('config', handler('config'));
    es.addEventListener('mcp', handler('mcp'));
    es.addEventListener('error', handler('error'));
    return () => es.close();
  }, [appendEvent]);

  // Check auth callback result from URL
  useEffect(() => {
    const authResult = searchParams.get('auth');
    const reason = searchParams.get('reason');
    if (authResult === 'success') {
      appendChat('system', 'OAuth completed. Refreshing tools...');
      refreshTools();
    }
    if (authResult === 'error') {
      appendChat('system', `OAuth failed: ${reason ? decodeURIComponent(reason) : 'Unknown'}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh tools every 5s when authenticated
  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(() => { refreshTools(true); }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const saveConfig = async () => {
    try {
      await api('/config', { method: 'POST', body: config });
      appendChat('system', 'Config saved.');
    } catch (err) {
      appendChat('system', `Save failed: ${err.message}`);
    }
  };

  const startAuth = async () => {
    try {
      await api('/config', { method: 'POST', body: config });
      const data = await api('/auth/start', { method: 'POST' });
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      appendChat('system', 'OAuth started. Complete login in the opened tab.');
    } catch (err) {
      appendChat('system', `OAuth start failed: ${err.message}`);
    }
  };

  const refreshTools = async (silent = false) => {
    try {
      const data = await api('/tools/list', { method: 'POST' });
      const nextTools = data.tools || [];
      setTools(nextTools);
      setAuthenticated(true);
      if (!silent) appendChat('system', `Tools refreshed (${nextTools.length} found).`);
    } catch (err) {
      setAuthenticated(false);
      setTools([]);
      if (!silent) appendChat('system', `Refresh failed: ${err.message}`);
    }
  };

  const sendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    appendChat('user', prompt);
    setThinking(true);
    try {
      await api('/config', { method: 'POST', body: config });
      const data = await api('/chat', { method: 'POST', body: { prompt } });
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer');
        appendChat('assistant', `${data.reply} (Opened OAuth in new tab)`, data.steps || null);
      } else {
        appendChat('assistant', data.reply || 'Done.', {
          available_tools: (data.tools || []).map((t) => t.name),
          suggested_tools: data.suggested_tools || [],
          steps: data.steps || [],
        });
        if (data.tools) {
          setTools(data.tools);
          setAuthenticated(true);
        }
      }
    } catch (err) {
      appendChat('assistant', `Error: ${err.message}`);
    } finally {
      setThinking(false);
    }
  };

  const callTool = async () => {
    try {
      const args = JSON.parse(toolArgs || '{}');
      const data = await api('/tools/call', { method: 'POST', body: { name: selectedTool, arguments: args } });
      setToolResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setToolResult(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  const sendRawRpcCall = async () => {
    try {
      const body = JSON.parse(rawRpc);
      const data = await api('/rpc', { method: 'POST', body });
      setRawRpcResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setRawRpcResult(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  return (
    <div className="pmc-page">
      <header className="pmc-topbar">
        <div>
          <h1>PingOne Privilege MCP Client</h1>
          <p>Chat-first MCP demo with real-time protected tool visibility via PingOne Privilege Gateway.</p>
        </div>
        <div className={`pmc-pill ${authenticated ? 'pmc-pill--connected' : ''}`}>
          {authenticated ? 'Connected' : 'Not Authenticated'}
        </div>
      </header>

      <main className="pmc-layout">
        {/* LEFT — Config sidebar */}
        <aside className="pmc-panel pmc-sidebar">
          <h2>Connection</h2>
          <label className="pmc-label">
            MCP URL
            <input className="pmc-input" value={config.mcpUrl} onChange={(e) => setConfig({ ...config, mcpUrl: e.target.value })} placeholder="https://mcpgw.example.com/mcp" />
          </label>
          <label className="pmc-label">
            OAuth Client ID
            <input className="pmc-input" value={config.clientId} onChange={(e) => setConfig({ ...config, clientId: e.target.value })} />
          </label>
          <label className="pmc-label">
            Scopes
            <input className="pmc-input" value={config.scopes} onChange={(e) => setConfig({ ...config, scopes: e.target.value })} />
          </label>
          <label className="pmc-label">
            LLM URL (optional)
            <input className="pmc-input" value={config.llmUrl} onChange={(e) => setConfig({ ...config, llmUrl: e.target.value })} />
          </label>
          <label className="pmc-label">
            LLM Model (optional)
            <input className="pmc-input" value={config.llmModel} onChange={(e) => setConfig({ ...config, llmModel: e.target.value })} />
          </label>
          <div className="pmc-buttons">
            <button className="pmc-btn" onClick={saveConfig}>Save</button>
            <button className="pmc-btn pmc-btn--primary" onClick={startAuth}>Sign In</button>
          </div>

          <h2>Available Tools ({tools.length})</h2>
          <pre className="pmc-pre pmc-tools-summary">
            {tools.length > 0 ? JSON.stringify(tools.map((t) => t.name), null, 2) : 'No tools discovered yet.'}
          </pre>
          <button className="pmc-btn" onClick={() => refreshTools(false)}>Refresh Now</button>
        </aside>

        {/* CENTER — Chat */}
        <section className="pmc-panel pmc-chat-panel">
          <div className="pmc-chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`pmc-bubble pmc-bubble--${msg.role}`}>
                <span className="pmc-bubble-text">{msg.content}</span>
                {msg.extra && (
                  <pre className="pmc-bubble-meta">{typeof msg.extra === 'string' ? msg.extra : JSON.stringify(msg.extra, null, 2)}</pre>
                )}
              </div>
            ))}
            {thinking && <div className="pmc-thinking">Thinking and checking tools...</div>}
            <div ref={chatEndRef} />
          </div>
          <div className="pmc-composer">
            <textarea
              className="pmc-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChat(); } }}
              rows={3}
            />
            <button className="pmc-btn pmc-btn--primary" onClick={sendChat}>Send</button>
          </div>
        </section>

        {/* RIGHT — Inspector */}
        <aside className="pmc-panel pmc-inspector">
          <h2>Live Relay</h2>
          <pre className="pmc-pre pmc-event-log" ref={eventsRef}>
            {events.slice(0, 50).map((e, i) => (
              <div key={i}>[{e.ts}] {JSON.stringify({ ...e, ts: undefined }, null, 0)}</div>
            ))}
          </pre>

          <details className="pmc-details">
            <summary>Advanced: Raw MCP + Tool Call</summary>

            <h3>Raw MCP RPC</h3>
            <textarea className="pmc-input" rows={5} value={rawRpc} onChange={(e) => setRawRpc(e.target.value)} />
            <button className="pmc-btn" onClick={sendRawRpcCall}>Send RPC</button>
            <pre className="pmc-pre">{rawRpcResult}</pre>

            <h3>Direct Tool Call</h3>
            <select className="pmc-input" value={selectedTool} onChange={(e) => setSelectedTool(e.target.value)}>
              <option value="">Select a tool...</option>
              {tools.map((t) => <option key={t.name} value={t.name}>{t.name} - {truncate(t.description || '', 60)}</option>)}
            </select>
            <textarea className="pmc-input" rows={3} value={toolArgs} onChange={(e) => setToolArgs(e.target.value)} placeholder='{"key": "value"}' />
            <button className="pmc-btn" onClick={callTool}>Call Tool</button>
            <pre className="pmc-pre">{toolResult}</pre>
          </details>
        </aside>
      </main>
    </div>
  );
}
