// demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx
// Cursor-IDE-styled MCP client for PingOne Privilege MCP Gateway.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FootprintSkinPicker } from '../components/aiFootprintMocks/FootprintSkinPicker';
import ToolsTable from '../components/privilege/ToolsTable';
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


function scopeColor(scope) {
  if (scope.startsWith('mcp:')) return 'scope-mcp';
  if (scope.startsWith('p1:')) return 'scope-p1';
  if (scope === 'openid' || scope === 'profile' || scope === 'email') return 'scope-oidc';
  if (scope.includes('read')) return 'scope-read';
  if (scope.includes('write') || scope.includes('admin') || scope.includes('manage')) return 'scope-write';
  return 'scope-default';
}

export default function PrivilegeMcpClientPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState({ mcpUrl: '', clientId: '', scopes: 'openid profile email', llmUrl: 'http://127.0.0.1:11434', llmModel: 'llama3.2:1b' });
  const [authenticated, setAuthenticated] = useState(false);
  const [mainAppAuthenticated, setMainAppAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [grantedScopes, setGrantedScopes] = useState([]);
  const [tools, setTools] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [events, setEvents] = useState([]);
  const [rawRpc, setRawRpc] = useState('{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "tools/list",\n  "params": {}\n}');
  const [rawRpcResult, setRawRpcResult] = useState('');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const [showPresent, setShowPresent] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const jumpedToToolsRef = useRef(false);
  const silentAuthAttempted = useRef(false);
  const [silentAuthPending, setSilentAuthPending] = useState(false);
  // Page-local light/dark, independent of the app theme. The page ships a fixed
  // Cursor-IDE dark look; this lets it flip to light without touching app wiring.
  const [pageTheme, setPageTheme] = useState(() => {
    try { return localStorage.getItem('cur_priv_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    try { localStorage.setItem('cur_priv_theme', pageTheme); } catch { /* storage disabled */ }
  }, [pageTheme]);
  const [terminalTab, setTerminalTab] = useState('events');
  // Tool-call results collected into the RESULTS terminal tab. resultNonce bumps
  // on each new result to flash the tab so the user notices output arrived.
  const [toolResults, setToolResults] = useState([]);
  const [resultNonce, setResultNonce] = useState(0);
  // Scope picked in the left rail — echoed/highlighted in the right SCOPES table.
  // With a long granted-scope list, clicking a pill on the left jumps to its row.
  const [selectedScope, setSelectedScope] = useState(null);
  const scopeRowRef = useRef(null);
  // Tool picked in the left rail — the right Tools table scrolls to and expands
  // it. The nonce lets the same tool re-trigger the reveal on a second click.
  const [selectedTool, setSelectedTool] = useState(null);
  const [toolSelectNonce, setToolSelectNonce] = useState(0);
  const selectTool = useCallback((name) => {
    setSelectedTool(name);
    setToolSelectNonce((n) => n + 1);
    setActiveTab('tools');
  }, []);
  const [envVars, setEnvVars] = useState(null);
  const [envDirty, setEnvDirty] = useState(false);
  const chatEndRef = useRef(null);
  const sidebarRef = useRef(null);
  const terminalRef = useRef(null);
  const bodyRef = useRef(null);

  const startSidebarDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current.offsetWidth;
    const onMove = (ev) => {
      const next = Math.max(200, Math.min(1000, startW + ev.clientX - startX));
      sidebarRef.current.style.width = `${next}px`;
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const startTerminalDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalRef.current.offsetHeight;
    const onMove = (ev) => {
      const next = Math.max(80, Math.min(500, startH - (ev.clientY - startY)));
      terminalRef.current.style.height = `${next}px`;
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (activeTab === 'sessions' && authenticated) loadSessions();
  }, [activeTab, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the message list itself, never the window: scrollIntoView() walked up
  // to the document and pushed the title bar (and its Skin picker) off-screen on
  // first paint.
  useEffect(() => {
    const list = chatEndRef.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatMessages]);

  const appendChat = useCallback((role, content, extra = null) => {
    setChatMessages((prev) => [...prev, { role, content, extra, ts: Date.now() }]);
  }, []);

  const appendEvent = useCallback((entry) => {
    setEvents((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    api('/state').then((s) => {
      setConfig(s.config || config);
      setAuthenticated(Boolean(s.oauth?.authenticated));
      setMainAppAuthenticated(Boolean(s.mainAppAuthenticated));
      setUser(s.user || null);
      if (s.oauth?.scope) setGrantedScopes(s.oauth.scope.split(' ').filter(Boolean));
      setTools(s.tools || []);
      // Auto-discover tools only after Privilege auth completes
      if (s.oauth?.authenticated && (!s.tools || s.tools.length === 0)) {
        refreshTools(true);
      }
      // Auto-connect Privilege using the active PingOne session when the main app
      // is already logged in — prompt=none on the BFF means PingOne returns silently.
      if (s.mainAppAuthenticated && !s.oauth?.authenticated) {
        const authParam = new URLSearchParams(window.location.search).get('auth');
        if (authParam !== 'silent_failed' && !silentAuthAttempted.current) {
          silentAuthAttempted.current = true;
          setSilentAuthPending(true);
          api('/auth/start', { method: 'POST' })
            .then((data) => { window.location.href = data.authUrl; })
            .catch(() => setSilentAuthPending(false));
        }
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    const authResult = searchParams.get('auth');
    const reason = searchParams.get('reason');
    if (authResult === 'success') {
      appendChat('system', 'OAuth completed. Refreshing tools...');
      api('/state').then((s) => {
        if (s.oauth?.authenticated) setAuthenticated(true);
        if (s.oauth?.scope) setGrantedScopes(s.oauth.scope.split(' ').filter(Boolean));
      }).catch(() => {});
      refreshTools();
    }
    if (authResult === 'error') {
      appendChat('system', `OAuth failed: ${reason ? decodeURIComponent(reason) : 'Unknown'}`);
    }
    // silent_failed: prompt=none couldn't reuse a PingOne session — show the
    // manual Sign In button without an error message.
    // (no-op here; the /state effect already guards on authParam !== 'silent_failed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConfig = async () => {
    try {
      await api('/config', { method: 'POST', body: config });
      appendChat('system', 'Configuration saved.');
    } catch (err) {
      appendChat('system', `Save failed: ${err.message}`);
    }
  };

  const loadEnv = async () => {
    try {
      const data = await api('/env');
      setEnvVars(data.vars || {});
      setEnvDirty(false);
    } catch { setEnvVars({}); }
  };

  const saveEnv = async () => {
    try {
      await api('/env', { method: 'PUT', body: { vars: envVars } });
      setEnvDirty(false);
      appendChat('system', 'Gateway .env saved. Restart mcpgw container to apply.');
    } catch (err) {
      appendChat('system', `Env save failed: ${err.message}`);
    }
  };

  const startAuth = async () => {
    try {
      await api('/config', { method: 'POST', body: config });
      const data = await api('/auth/start', { method: 'POST' });
      window.location.href = data.authUrl;
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
      if (!silent) appendChat('system', `Discovered ${nextTools.length} tools from MCP server.`);
    } catch (err) {
      setTools([]);
      if (err.message?.toLowerCase().includes('not authenticated')) {
        setAuthenticated(false);
      } else if (
        err.message?.toLowerCase().includes('not authorized') ||
        err.message?.includes('403') ||
        err.message?.toLowerCase().includes("doesn't have access") ||
        err.message?.toLowerCase().includes('does not have access')
      ) {
        setShowBlockedModal(true);
        if (!silent) appendChat('system', 'Access blocked by policy.');
        return;
      }
      if (!silent) appendChat('system', `Refresh failed: ${err.message}`);
    }
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const data = await api('/sessions');
      setSessions(data.applications || []);
    } catch (err) {
      setSessionsError(err.message);
    } finally {
      setSessionsLoading(false);
    }
  };

  const selectSession = async (app) => {
    const frontEnd = app.Spec?.McpAppConfig?.FrontEndName?.Elems?.[0];
    if (!frontEnd) return;
    const mcpUrl = `https://${frontEnd}:8643/mcp`;
    const next = { ...config, mcpUrl };
    setConfig(next);
    try {
      await api('/config', { method: 'POST', body: next });
      appendChat('system', `Switched to policy: ${app.ObjectMeta?.Name || frontEnd}`);
    } catch (err) {
      appendChat('system', `Failed to switch policy: ${err.message}`);
    }
  };

  const sendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    appendChat('user', prompt);
    setChatInput('');
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

  // Per-row executor for the Tools table: returns the pretty-printed result and
  // also records it in the RESULTS terminal tab (which flashes so the user sees
  // fresh output land).
  const recordResult = useCallback((name, result, ok) => {
    // Keep only the latest result per tool — re-running a tool replaces its prior
    // entry instead of stacking a duplicate (the RESULTS panel is tight).
    setToolResults((prev) => [{ tool: name, result, ok, ts: new Date().toISOString() }, ...prev.filter((r) => r.tool !== name)].slice(0, 50));
    setResultNonce((n) => n + 1);
    setTerminalTab('results');
  }, []);

  const executeToolCall = async (name, argsStr) => {
    let out;
    let ok = true;
    try {
      const args = JSON.parse(argsStr || '{}');
      const data = await api('/tools/call', { method: 'POST', body: { name, arguments: args } });
      out = JSON.stringify(data, null, 2);
      ok = !data?.error && !data?.result?.isError;
    } catch (err) {
      out = JSON.stringify({ error: err.message }, null, 2);
      ok = false;
    }
    recordResult(name, out, ok);
    return out;
  };

  // Land on the Tools tab the first time tools are discovered — it is the point
  // of the page. Only once, so it never fights later navigation.
  useEffect(() => {
    if (tools.length > 0 && !jumpedToToolsRef.current) {
      jumpedToToolsRef.current = true;
      setActiveTab('tools');
    }
  }, [tools.length]);

  // Scroll the picked scope's row into view once the SCOPES table is showing it.
  useEffect(() => {
    if (selectedScope && terminalTab === 'scopes' && scopeRowRef.current) {
      scopeRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedScope, terminalTab]);

  // Esc closes Present mode.
  useEffect(() => {
    if (!showPresent) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setShowPresent(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showPresent]);

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
    <div className="cur-ide" data-cur-theme={pageTheme}>
      {showPresent && (
        <div className="ptt-present-overlay">
          <ToolsTable tools={tools} presentMode onClose={() => setShowPresent(false)} />
        </div>
      )}
      {showBlockedModal && (
        <div className="cur-modal-overlay" onClick={() => setShowBlockedModal(false)}>
          <div className="cur-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Access Denied</h2>
            <p>You are blocked per policy — please login to{' '}
              <a href="https://console.login.privilege.pingone.com/?env=01d89b06-66d5-430e-9f28-65636843788b" target="_blank" rel="noreferrer">Ping Identity AI Gateway</a>
              {' '}to request access.
            </p>
            <div className="cur-btn-row">
              <button className="cur-btn" onClick={() => { setShowBlockedModal(false); refreshTools(); }}>Retry</button>
              <button className="cur-btn cur-btn--primary" onClick={() => setShowBlockedModal(false)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* Flow Topology Modal */}
      {showFlowModal && (
        <div className="cur-modal-overlay" onClick={() => setShowFlowModal(false)}>
          <div className="cur-flow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cur-flow-header">
              <span className="cur-flow-title">Privilege MCP — Request Flow</span>
              <button className="cur-flow-close" onClick={() => setShowFlowModal(false)}>&#x2715;</button>
            </div>
            <div className="cur-flow-body">
              <div className="cur-flow-label">END-TO-END DELEGATION CHAIN</div>
              <div className="cur-flow-row">
                {/* Node 1: Browser / Cursor IDE */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--browser">
                    <span className="cur-flow-icon">&#x1F5A5;</span>
                    <span className="cur-flow-name">Browser</span>
                    <span className="cur-flow-sub">Cursor IDE Client</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">action</span><span className="cur-flow-cv">OIDC login (PKCE)</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">scopes</span><span className="cur-flow-cv cur-flow-cv--hi">openid profile email</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">grant</span><span className="cur-flow-cv">authorization_code</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">PingOne token</span>
                </div>

                {/* Node 2: BFF */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--bff">
                    <span className="cur-flow-icon">&#x2699;</span>
                    <span className="cur-flow-name">BFF Relay</span>
                    <span className="cur-flow-sub">privilegeMcpClient.js</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">stores</span><span className="cur-flow-cv">access_token (session)</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">adds</span><span className="cur-flow-cv cur-flow-cv--ok">x-procyon-session-id</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">relay</span><span className="cur-flow-cv">JSON-RPC → MCP GW</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">Bearer + headers</span>
                </div>

                {/* Node 3: Privilege Proxy */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--privilege">
                    <span className="cur-flow-icon">&#x1F6E1;</span>
                    <span className="cur-flow-name">Privilege Proxy</span>
                    <span className="cur-flow-sub">PingOne Privilege Cloud</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">validates</span><span className="cur-flow-cv">JWT signature (JWKS)</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">enforces</span><span className="cur-flow-cv cur-flow-cv--ok">tool-level policy</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">upstream</span><span className="cur-flow-cv">OAuth or Static Token</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">frontend</span><span className="cur-flow-cv cur-flow-cv--aud">{config.mcpUrl?.split('/')[2]?.split(':')[0]?.slice(0, 24) || 'privilege.pingone.com'}</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">forward RPC</span>
                </div>

                {/* Node 4: Demo MCP Server */}
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--mcp">
                    <span className="cur-flow-icon">&#x1F527;</span>
                    <span className="cur-flow-name">Demo MCP Server</span>
                    <span className="cur-flow-sub">:8080/mcp</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">discovery</span><span className="cur-flow-cv">unauthenticated</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">tools/call</span><span className="cur-flow-cv cur-flow-cv--hi">bearer required</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">scopes</span><span className="cur-flow-cv cur-flow-cv--ok">accounts:read txn:read txn:write sensitive:read</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">exchange</span><span className="cur-flow-cv">RFC 8693 per tool</span></div>
                  </div>
                </div>
              </div>

              {/* Auth flow section */}
              <div className="cur-flow-label" style={{ marginTop: 20 }}>OAUTH AUTHENTICATION</div>
              <div className="cur-flow-row">
                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--auth">
                    <span className="cur-flow-icon">&#x1F511;</span>
                    <span className="cur-flow-name">PingOne AS</span>
                    <span className="cur-flow-sub">auth.pingone.com</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">env</span><span className="cur-flow-cv cur-flow-cv--aud">{config.clientId?.slice(0, 8) || '...'}</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">PKCE</span><span className="cur-flow-cv cur-flow-cv--ok">S256 required</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">method</span><span className="cur-flow-cv">client_secret_post</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">callback</span><span className="cur-flow-cv">/api/privilege-mcp/auth/callback</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">issues JWT</span>
                </div>

                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--token">
                    <span className="cur-flow-icon">&#x1F4DC;</span>
                    <span className="cur-flow-name">Access Token</span>
                    <span className="cur-flow-sub">RS256 / kid: default</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">iss</span><span className="cur-flow-cv">auth.pingone.com/{'{env}'}</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">aud</span><span className="cur-flow-cv cur-flow-cv--aud">{config.clientId?.slice(0, 12) || 'client_id'}...</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">scope</span><span className="cur-flow-cv cur-flow-cv--hi">{grantedScopes.join(' ') || 'openid profile email'}</span></div>
                  </div>
                </div>

                <div className="cur-flow-conn">
                  <div className="cur-flow-line" /><span className="cur-flow-arrow">&#x25B6;</span>
                  <span className="cur-flow-conn-label">Bearer</span>
                </div>

                <div className="cur-flow-node">
                  <div className="cur-flow-box cur-flow-box--privilege">
                    <span className="cur-flow-icon">&#x1F6E1;</span>
                    <span className="cur-flow-name">Privilege Proxy</span>
                    <span className="cur-flow-sub">validates via JWKS</span>
                  </div>
                  <div className="cur-flow-claims">
                    <div className="cur-flow-claim"><span className="cur-flow-ck">jwks</span><span className="cur-flow-cv">auth.pingone.com/{'{env}'}/as/jwks</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">kid</span><span className="cur-flow-cv cur-flow-cv--ok">matched from JWKS</span></div>
                    <div className="cur-flow-claim"><span className="cur-flow-ck">policy</span><span className="cur-flow-cv">tool access per user</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="cur-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="cur-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cur-flow-header">
              <span className="cur-flow-title">&#x2699; Settings</span>
              <button className="cur-flow-close" onClick={() => setShowSettings(false)}>&#x2715;</button>
            </div>
            <div className="cur-settings-body">
              <div className="cur-settings-section">
                <h4 className="cur-settings-section-title">MCP Connection</h4>
                <label className="cur-field">
                  <span className="cur-field-label">MCP Gateway URL</span>
                  <input className="cur-input" value={config.mcpUrl} onChange={(e) => setConfig({ ...config, mcpUrl: e.target.value })} placeholder="https://mcpgw.example.com/mcp" />
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">OAuth Client ID</span>
                  <input className="cur-input" value={config.clientId} onChange={(e) => setConfig({ ...config, clientId: e.target.value })} />
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">Requested Scopes</span>
                  <input className="cur-input" value={config.scopes} onChange={(e) => setConfig({ ...config, scopes: e.target.value })} />
                </label>
              </div>
              <div className="cur-settings-section">
                <h4 className="cur-settings-section-title">Local LLM</h4>
                <label className="cur-field">
                  <span className="cur-field-label">Ollama URL</span>
                  <input className="cur-input" value={config.llmUrl} onChange={(e) => setConfig({ ...config, llmUrl: e.target.value })} />
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">Model</span>
                  <input className="cur-input" value={config.llmModel} onChange={(e) => setConfig({ ...config, llmModel: e.target.value })} />
                </label>
              </div>
              <div className="cur-settings-section">
                <h4 className="cur-settings-section-title">Privilege Gateway .env</h4>
                {envVars === null ? (
                  <button className="cur-btn" onClick={loadEnv}>Load pingone.env</button>
                ) : (
                  <>
                    {['SERVER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_AUTH_URL', 'OIDC_TOKEN_URL', 'OIDC_USER_URL', 'OIDC_SCOPES'].map((key) => (
                      <label className="cur-field" key={key}>
                        <span className="cur-field-label">{key}</span>
                        <input className="cur-input" value={envVars[key] || ''} onChange={(e) => { setEnvVars({ ...envVars, [key]: e.target.value }); setEnvDirty(true); }} />
                      </label>
                    ))}
                    <div className="cur-btn-row" style={{ marginTop: 8 }}>
                      <button className="cur-btn cur-btn--primary" onClick={saveEnv} disabled={!envDirty}>Save .env</button>
                      <button className="cur-btn" onClick={loadEnv}>Reload</button>
                    </div>
                  </>
                )}
              </div>
              <div className="cur-btn-row" style={{ marginTop: 16 }}>
                <button className="cur-btn cur-btn--primary" onClick={() => { saveConfig(); setShowSettings(false); }}>Save</button>
                <button className="cur-btn" onClick={() => setShowSettings(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Title bar */}
      <header className="cur-titlebar">
        <div className="cur-titlebar-left">
          <div className="cur-traffic-lights">
            <span className="cur-dot cur-dot--red" />
            <span className="cur-dot cur-dot--yellow" />
            <span className="cur-dot cur-dot--green" />
          </div>
          <span className="cur-titlebar-title">Privilege MCP Client — PingOne</span>
        </div>
        <div className="cur-titlebar-center">
          <div className={`cur-status ${(authenticated || mainAppAuthenticated) ? 'cur-status--ok' : ''}`}>
            <span className="cur-status-dot" />
            {(authenticated || mainAppAuthenticated) ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <div className="cur-titlebar-right">
          <FootprintSkinPicker className="cur-skin-picker" />
          <button
            type="button"
            className="cur-flow-trigger"
            onClick={() => setPageTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={pageTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {pageTheme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="cur-flow-trigger" onClick={() => navigate('/privilege-mcp-learning')} title="Learning Guide">Guide</button>
          <button className="cur-flow-trigger" onClick={() => setShowSettings(true)} title="Settings">&#x2699;</button>
          <button className="cur-flow-trigger" onClick={() => setShowFlowModal(true)}>Flow</button>
          {config.llmModel && <span className="cur-model-badge">{config.llmModel}</span>}
        </div>
      </header>

      <div className="cur-body" ref={bodyRef}>
        {/* Activity bar */}
        <nav className="cur-activity-bar">
          <button className={`cur-act-btn ${activeTab === 'chat' ? 'cur-act-btn--active' : ''}`} onClick={() => setActiveTab('chat')} title="Agent Chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button className={`cur-act-btn ${activeTab === 'tools' ? 'cur-act-btn--active' : ''}`} onClick={() => setActiveTab('tools')} title="MCP Tools">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </button>
          <button className={`cur-act-btn ${activeTab === 'rpc' ? 'cur-act-btn--active' : ''}`} onClick={() => setActiveTab('rpc')} title="Raw RPC">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
        </nav>

        {/* Sidebar */}
        <aside className="cur-sidebar" ref={sidebarRef}>
          <div className="cur-sidebar-header">
            <span className="cur-sidebar-title">CONNECTION</span>
          </div>
          <div className="cur-conn-debug">
            <div><span className="cur-cd-k">mcpUrl: </span><span className="cur-cd-v cur-cd-v--url">{config.mcpUrl || '—'}</span></div>
            <div><span className="cur-cd-k">clientId: </span><span className="cur-cd-v cur-cd-v--id">{config.clientId || '—'}</span></div>
            <div><span className="cur-cd-k">scopes: </span><span className="cur-cd-v cur-cd-v--scope">{config.scopes || '—'}</span></div>
            <div><span className="cur-cd-k">authStatus: </span><span className={`cur-cd-v ${authenticated ? 'cur-cd-v--ok' : 'cur-cd-v--bad'}`}>{authenticated ? 'authenticated' : 'unauthenticated'}</span></div>
          </div>
          <div className="cur-sidebar-content">
            {authenticated ? (
              <div className="cur-auth-status">
                <span className="cur-auth-badge cur-auth-badge--ok">Authenticated</span>
                {user?.email && <span className="cur-auth-user">{user.email}</span>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="cur-btn" onClick={() => refreshTools()}>Retry Tools</button>
                  <button className="cur-btn" onClick={async () => {
                    await api('/auth/logout', { method: 'POST' }).catch(() => {});
                    setAuthenticated(false);
                    setGrantedScopes([]);
                    setTools([]);
                  }}>Sign Out</button>
                </div>
              </div>
            ) : silentAuthPending ? (
              <div className="cur-btn-row">
                <span className="cur-auth-badge">Connecting...</span>
              </div>
            ) : (
              <div className="cur-btn-row">
                {mainAppAuthenticated ? (
                  <span className="cur-auth-badge cur-auth-badge--ok">Authenticated</span>
                ) : (
                  <button className="cur-btn cur-btn--primary" onClick={startAuth}>Sign In with Privilege</button>
                )}
              </div>
            )}

            {grantedScopes.length > 0 && (
              <div className="cur-scopes-section">
                <div className="cur-sidebar-header">
                  <span className="cur-sidebar-title">GRANTED SCOPES</span>
                  <span className="cur-scope-count">{grantedScopes.length}</span>
                </div>
                <div className="cur-scopes-grid">
                  {grantedScopes.map((s) => (
                    <span
                      key={s}
                      role="button"
                      tabIndex={0}
                      className={`cur-scope-pill ${scopeColor(s)}${s === selectedScope ? ' cur-scope-pill--selected' : ''}`}
                      title={`Show ${s} in the scopes table`}
                      onClick={() => { setSelectedScope(s); setTerminalTab('scopes'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedScope(s); setTerminalTab('scopes'); } }}
                    >{s}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="cur-sidebar-header" style={{ marginTop: 12 }}>
              <span className="cur-sidebar-title">MCP TOOLS</span>
              <span className="cur-scope-count">{tools.length}</span>
            </div>
            {tools.length > 0 && (
              <input
                className="cur-input cur-tool-search"
                placeholder="Filter tools..."
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                style={{ margin: '4px 8px', width: 'calc(100% - 16px)', fontSize: 11 }}
              />
            )}
            {tools.length > 0 ? (() => {
              const q = toolSearch.trim().toLowerCase();
              const filtered = q ? tools.filter((t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)) : tools;
              return filtered.length > 0 ? (
                <div className="cur-tools-list">
                  {filtered.map((t) => {
                    const n = Object.keys(t.inputSchema?.properties || {}).length;
                    return (
                    <div key={t.name} className={`cur-tool-row${t.name === selectedTool ? ' cur-tool-row--selected' : ''}`} onClick={() => selectTool(t.name)} title={t.description || t.name}>
                      <span className="cur-tool-row-name">{t.name}</span>
                      <span className="cur-tool-row-meta">{n} param{n === 1 ? '' : 's'}</span>
                    </div>
                    );
                  })}
                </div>
              ) : <div className="cur-empty-state">No tools match &quot;{toolSearch}&quot;</div>;
            })() : (
              <div className="cur-empty-state">No tools discovered yet</div>
            )}
            <button className="cur-btn cur-btn--primary cur-btn--refresh" onClick={() => refreshTools(false)}>Refresh Tools</button>
          </div>
        </aside>

        <div className="cur-resize-handle cur-resize-handle--v" onMouseDown={startSidebarDrag} />

        {/* Main editor area */}
        <main className="cur-main">
          <div className="cur-tabs">
            <button className={`cur-tab ${activeTab === 'chat' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('chat')}>Agent Chat</button>
            <button className={`cur-tab ${activeTab === 'tools' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('tools')}>Tools</button>
            <button className={`cur-tab ${activeTab === 'rpc' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('rpc')}>Raw RPC</button>
            <button className={`cur-tab ${activeTab === 'sessions' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('sessions')}>Access</button>
          </div>

          <div className="cur-editor-area">
            {activeTab === 'chat' && (
              <div className="cur-chat-panel">
                <div className="cur-chat-messages">
                  {chatMessages.length === 0 && (
                    <div className="cur-chat-empty">
                      <div className="cur-chat-empty-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                      </div>
                      <p>Ask the agent to interact with MCP tools</p>
                      <span className="cur-chat-hint">Try: "List available tools" or "What can you do?"</span>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`cur-msg cur-msg--${msg.role}`}>
                      <div className="cur-msg-header">
                        <span className="cur-msg-role">{msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Agent' : 'System'}</span>
                      </div>
                      <div className="cur-msg-body">{msg.content}</div>
                      {msg.extra && (
                        <pre className="cur-msg-meta">{typeof msg.extra === 'string' ? msg.extra : JSON.stringify(msg.extra, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                  {thinking && (
                    <div className="cur-msg cur-msg--thinking">
                      <div className="cur-thinking-dots"><span /><span /><span /></div>
                      <span>Thinking...</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="cur-composer">
                  <textarea
                    className="cur-composer-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChat(); } }}
                    placeholder="Ask the agent... (Cmd+Enter to send)"
                    rows={2}
                  />
                  <button className="cur-composer-send" onClick={sendChat} disabled={thinking}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <ToolsTable
                tools={tools}
                onExecute={executeToolCall}
                onPresent={() => setShowPresent(true)}
                selectedTool={selectedTool}
                selectNonce={toolSelectNonce}
              />
            )}

            {activeTab === 'rpc' && (
              <div className="cur-rpc-panel">
                <div className="cur-tools-header"><h3>Raw MCP JSON-RPC</h3></div>
                <label className="cur-field">
                  <span className="cur-field-label">Request Body</span>
                  <textarea className="cur-input cur-input--code" rows={8} value={rawRpc} onChange={(e) => setRawRpc(e.target.value)} />
                </label>
                <button className="cur-btn cur-btn--primary" onClick={sendRawRpcCall}>Send RPC</button>
                {rawRpcResult && (
                  <div className="cur-result-block">
                    <span className="cur-result-label">Response</span>
                    <pre className="cur-code-output">{rawRpcResult}</pre>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'sessions' && (
              <div className="cur-sessions-panel">
                <div className="cur-tools-header">
                  <h3>Access Sessions</h3>
                  <button className="cur-btn" onClick={loadSessions} disabled={sessionsLoading}>
                    {sessionsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {sessionsError && (
                  <div className="cur-sessions-error">
                    <span style={{color:'#ff6b6b'}}>{sessionsError}</span>
                  </div>
                )}
                {!sessionsLoading && !sessionsError && sessions.length === 0 && (
                  <div className="cur-sessions-empty">No access sessions found.</div>
                )}
                <div className="cur-sessions-grid">
                  {sessions.map((app) => {
                    const name = app.ObjectMeta?.Name || '—';
                    const cfg = app.Spec?.McpAppConfig || {};
                    const backendCount = cfg.Backends?.Elems?.length ?? 0;
                    const principalCount = cfg.Policies?.Elems?.length ?? cfg.Principals?.Elems?.length ?? '?';
                    const endsAt = app.Spec?.TTL || app.Metadata?.ExpiresAt || null;
                    const status = app.Status?.McpServerStatus?.Status || '';
                    const frontEnd = cfg.FrontEndName?.Elems?.[0];
                    const appMcpUrl = frontEnd ? `https://${frontEnd}:8643/mcp` : null;
                    const isActive = appMcpUrl && config.mcpUrl === appMcpUrl;
                    return (
                      <div
                        key={name}
                        className={`cur-session-card${isActive ? ' cur-session-card--active' : ''}${appMcpUrl ? ' cur-session-card--selectable' : ''}`}
                        onClick={appMcpUrl ? () => selectSession(app) : undefined}
                        title={appMcpUrl ? `Use policy: ${name}` : 'No frontend URL available'}
                      >
                        <div className="cur-session-name">
                          {name}
                          {isActive && <span className="cur-session-active-badge"> ✓ Active</span>}
                        </div>
                        {endsAt && <div className="cur-session-ttl">Ends {endsAt}</div>}
                        {status && <div className="cur-session-status">{status}</div>}
                        <div className="cur-session-meta">
                          <span title="Backends">🗄️ {backendCount}</span>
                          <span title="Principals">👥 {principalCount}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Terminal panel */}
          <div className="cur-resize-handle cur-resize-handle--h" onMouseDown={startTerminalDrag} />
          <div className="cur-terminal" ref={terminalRef}>
            <div className="cur-terminal-tabs">
              <button className={`cur-terminal-tab ${terminalTab === 'events' ? 'cur-terminal-tab--active' : ''}`} onClick={() => setTerminalTab('events')}>RELAY LOG</button>
              <button className={`cur-terminal-tab ${terminalTab === 'trace' ? 'cur-terminal-tab--active' : ''}`} onClick={() => setTerminalTab('trace')}>TRACE</button>
              <button className={`cur-terminal-tab ${terminalTab === 'scopes' ? 'cur-terminal-tab--active' : ''}`} onClick={() => setTerminalTab('scopes')}>SCOPES</button>
              <button
                key={`results-tab-${resultNonce}`}
                className={`cur-terminal-tab ${terminalTab === 'results' ? 'cur-terminal-tab--active' : ''}${resultNonce > 0 && terminalTab !== 'results' ? ' cur-terminal-tab--flash' : ''}`}
                onClick={() => setTerminalTab('results')}
              >
                RESULTS{toolResults.length > 0 && <span className="cur-terminal-tab-badge">{toolResults.length}</span>}
              </button>
              {terminalTab === 'trace' && <button className="cur-terminal-tab" style={{marginLeft:'auto',opacity:0.6}} onClick={() => setEvents([])}>Clear</button>}
              {terminalTab === 'results' && toolResults.length > 0 && <button className="cur-terminal-tab" style={{marginLeft:'auto',opacity:0.6}} onClick={() => setToolResults([])}>Clear</button>}
            </div>
            <div className="cur-terminal-content">
              {terminalTab === 'trace' && (
                <div className="cur-terminal-log" style={{fontFamily:'monospace',fontSize:13}}>
                  {events.length === 0 && <span className="cur-terminal-empty">No events yet — sign in or call a tool</span>}
                  {events.slice(0, 100).map((e, i) => {
                    const rest = { ...e, ts: undefined, type: undefined };
                    let label = e.type;
                    let color = '#888';
                    if (e.type === 'relay' && e.direction === 'client->mcp') { label = `→ MCP ${e.method || ''} ${e.url || ''}`; color = '#7ec8e3'; }
                    if (e.type === 'relay' && e.direction === 'mcp->client') { label = `← MCP ${e.status >= 400 ? '❌' : '✅'} ${e.status}`; color = e.status >= 400 ? '#ff6b6b' : '#a8e6cf'; }
                    if (e.type === 'oauth') { label = `OAuth: ${e.phase}`; color = '#ffd93d'; }
                    if (e.type === 'mcp') { label = `MCP: ${e.phase}`; color = '#c3aed6'; }
                    if (e.type === 'error') { label = `ERROR: ${e.scope}`; color = '#ff6b6b'; }
                    if (e.type === 'config') { label = 'Config updated'; color = '#b2bec3'; }
                    return (
                      <details key={i} style={{borderBottom:'1px solid #222',padding:'2px 0'}}>
                        <summary style={{cursor:'pointer',color,listStyle:'none',display:'flex',gap:8,alignItems:'center'}}>
                          <span className="cur-trace-ts">{e.ts?.slice(11,23)||''}</span>
                          <span>{label}</span>
                          {e.type === 'error' && <span style={{color:'#ff6b6b'}}>{e.message}</span>}
                        </summary>
                        <pre className="cur-trace-json">
                          {JSON.stringify(rest, null, 2)}
                        </pre>
                      </details>
                    );
                  })}
                </div>
              )}
              {terminalTab === 'events' && (
                <div className="cur-terminal-log">
                  {events.length === 0 && <span className="cur-terminal-empty">Waiting for events...</span>}
                  {events.slice(0, 50).map((e, i) => (
                    <div key={i} className={`cur-terminal-line cur-terminal-line--${e.type}`}>
                      <span className="cur-terminal-ts">{e.ts?.slice(11, 19) || ''}</span>
                      <span className={`cur-terminal-badge cur-terminal-badge--${e.type}`}>{e.type}</span>
                      <span className="cur-terminal-msg">{JSON.stringify({ ...e, ts: undefined, type: undefined }, null, 0)}</span>
                    </div>
                  ))}
                </div>
              )}
              {terminalTab === 'scopes' && (
                <div className="cur-terminal-scopes">
                  {grantedScopes.length === 0 ? (
                    <span className="cur-terminal-empty">No scopes granted yet — sign in first</span>
                  ) : (
                    <div className="cur-scopes-detail">
                      <div className="cur-scopes-summary">
                        <span className="cur-scopes-count-large">{grantedScopes.length}</span>
                        <span className="cur-scopes-count-label">scopes granted</span>
                      </div>
                      <table className="cur-scopes-table">
                        <thead><tr><th>Scope</th><th>Category</th></tr></thead>
                        <tbody>
                          {grantedScopes.map((s) => (
                            <tr
                              key={s}
                              ref={s === selectedScope ? scopeRowRef : null}
                              className={s === selectedScope ? 'cur-scope-row--selected' : ''}
                              onClick={() => setSelectedScope(s)}
                            >
                              <td><code className={`cur-scope-pill ${scopeColor(s)}`}>{s}</code></td>
                              <td className="cur-scope-cat">
                                {s.startsWith('mcp:') ? 'MCP' : s.startsWith('p1:') ? 'PingOne' : (s === 'openid' || s === 'profile' || s === 'email') ? 'OIDC' : s.includes('read') ? 'Read' : s.includes('write') || s.includes('admin') ? 'Write' : 'Custom'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {terminalTab === 'results' && (
                <div className="cur-terminal-results">
                  {toolResults.length === 0 ? (
                    <span className="cur-terminal-empty">No results yet — run a tool to see its output here</span>
                  ) : (
                    toolResults.map((r, i) => (
                      <div key={`${r.ts}-${i}`} className="cur-result-item">
                        <div className="cur-result-item-head">
                          <span className={`cur-result-item-badge ${r.ok ? 'cur-result-item-badge--ok' : 'cur-result-item-badge--err'}`}>{r.ok ? '✓' : '❌'}</span>
                          <span className="cur-result-item-tool">{r.tool}</span>
                          <span className="cur-result-item-ts">{r.ts.slice(11, 19)}</span>
                        </div>
                        <pre className="cur-result-item-body">{r.result}</pre>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Status bar */}
      <footer className="cur-statusbar">
        <div className="cur-statusbar-left">
          <span className="cur-statusbar-item">MCP Protocol 2025-11-25</span>
          <span className="cur-statusbar-item">{tools.length} tools</span>
        </div>
        <div className="cur-statusbar-right">
          <span className="cur-statusbar-item">{config.llmModel || 'No LLM'}</span>
          <span className="cur-statusbar-item">{(authenticated || mainAppAuthenticated) ? 'Authenticated' : 'Not signed in'}</span>
        </div>
      </footer>
    </div>
  );
}
