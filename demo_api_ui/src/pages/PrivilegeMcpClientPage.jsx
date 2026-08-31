// demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx
// Cursor-IDE-styled MCP client for PingOne Privilege MCP Gateway.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FootprintSkinPicker } from '../components/aiFootprintMocks/FootprintSkinPicker';
import ToolsTable from '../components/privilege/ToolsTable';
import JsonHighlight from '../components/shared/JsonHighlight';
import DraggableModal from '../components/DraggableModal';
import PrivilegeMcpLearningPage from './PrivilegeMcpLearningPage';
import './PrivilegeMcpClientPage.css';

const API_BASE = '/api/privilege-mcp';
// An empty Explorer panel reads as a failed fetch. Usually it is not: the BFF
// only issues prompts/list or resources/list when the server advertised that
// capability in its initialize response, so an empty panel most often means the
// server has none to give. Say which of the two it is.
// The banking backend, for example, advertises only {tools, logging}.
// The agentless gateway routes on the application name: /<door>/mcp.
function doorName(mcpUrl) {
  try { return new URL(mcpUrl).pathname.split('/').filter(Boolean)[0] || null; } catch { return null; }
}

// Every string value anywhere in an undocumented object.
function specStrings(value, out = []) {
  if (typeof value === 'string') out.push(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach((v) => specStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => specStrings(v, out));
  return out;
}

// The pacpolicy Spec schema is undocumented, so we do NOT parse it — we compare
// against whole string values inside it. Whole values, not substrings: the door
// "cmuir" is a substring of the principal "cmuir+demo@pingone.com", so
// JSON.stringify(...).includes() marked every policy as mentioning every door.
// This says a policy MENTIONS a name, never that it grants access — the UI
// wording has to stay that careful or it states something it cannot know.
function policyMentions(policy, needle) {
  if (!needle) return false;
  return specStrings(policy.spec || {}).includes(String(needle).toLowerCase());
}

function capabilityNote(declared, kind) {
  return declared
    ? `Server advertises ${kind} but returned none.`
    : `Server does not advertise ${kind}.`;
}

const MCP_METHOD_TEMPLATES = {
  'resources/read': { uri: '' },
  'prompts/get': { name: '', arguments: {} },
  'completion/complete': { ref: { type: 'ref/prompt', name: '' }, argument: { name: '', value: '' } },
  'tasks/get': { taskId: '' },
  'tasks/update': { taskId: '', action: 'input', input: {} },
};

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

function isGatewayAuthChallenge(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('401') || message.includes('bearer token required') || message.includes('authorization_uri');
}

function gatewayModeDetails(mcpUrl) {
  const host = String(mcpUrl || '').toLowerCase();
  if (!host) return { key: 'unknown', title: 'Gateway mode not selected', detail: 'Choose an Agent or Agentless Gateway in Settings.' };
  if (host.includes('.applications.procyon.ai')) {
    return { key: 'agent', title: 'Agent-based AI Gateway', detail: 'The Priv Agent supplies device-bound identity; this MCP client sends no OAuth bearer.' };
  }
  const agentless = host.includes('agentless') || host.includes('opensearch');
  return agentless
    ? { key: 'agentless', title: 'Agentless Gateway', detail: 'AI Gateway → MCP services. No desktop agent is in this path.', url: mcpUrl }
    : { key: 'agent', title: 'Agent Gateway', detail: 'Desktop Agent → AI Gateway → MCP services.', url: mcpUrl };
}

export default function PrivilegeMcpClientPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState({ mcpUrl: '', clientId: '', scopes: 'openid profile email', llmUrl: 'http://127.0.0.1:11434', llmModel: 'llama3.2:1b' });
  const [gatewayMode, setGatewayMode] = useState('agentless');
  const [gatewayConfigs, setGatewayConfigs] = useState({ agent: {}, agentless: {} });
  const [presets, setPresets] = useState([]);
  const [gatewayStateLoaded, setGatewayStateLoaded] = useState(false);
  // Gateway switch in flight (agent <-> agentless). The sessionStorage flag lets
  // the overlay survive the OAuth redirect and show again from first paint on
  // the ?auth=success return, until tools are rediscovered from the new gateway.
  const savedMcpUrlRef = useRef('');
  const [switching, setSwitching] = useState(() => {
    try { return sessionStorage.getItem('cur_priv_switching') === '1'; } catch { return false; }
  });
  const clearSwitching = useCallback(() => {
    setSwitching(false);
    try { sessionStorage.removeItem('cur_priv_switching'); } catch { /* storage disabled */ }
  }, []);
  const [authenticated, setAuthenticated] = useState(false);
  const [mainAppAuthenticated, setMainAppAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [grantedScopes, setGrantedScopes] = useState([]);
  const [tools, setTools] = useState([]);
  // Discovery goes out to the AI Gateway, which can take several seconds before
  // it returns a tool list. Without a visible wait state the sidebar just reads
  // "No tools discovered yet" the whole time, which looks like a failure.
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolPolicy, setToolPolicy] = useState({ total: 0, permitted: 0, filtered: 0, filteredTools: [] });
  const [mcpCatalog, setMcpCatalog] = useState({ prompts: [], resources: [], resourceTemplates: [] });
  const [mcpProtocol, setMcpProtocol] = useState(null);
  const [mcpMethod, setMcpMethod] = useState('resources/read');
  const [mcpParams, setMcpParams] = useState(JSON.stringify(MCP_METHOD_TEMPLATES['resources/read'], null, 2));
  const [mcpResult, setMcpResult] = useState('');
  const [mcpInputRequired, setMcpInputRequired] = useState(null);
  const [mcpInputResponses, setMcpInputResponses] = useState('[]');
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [events, setEvents] = useState([]);
  const [rawRpc, setRawRpc] = useState('{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "tools/list",\n  "params": {}\n}');
  const [rawRpcResult, setRawRpcResult] = useState('');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  // The gateway answers a policy denial with a bare "Forbidden" and writes
  // nothing to its own log, so the modal has to assemble its own evidence:
  // the door and identity we already know, plus a live probe of the other doors.
  const [blockedDetail, setBlockedDetail] = useState(null);
  const [doorProbe, setDoorProbe] = useState({ running: false, results: null });
  // Privilege console inventory — only populated once an auth_token is pasted.
  const [consoleToken, setConsoleToken] = useState('');
  const [consoleData, setConsoleData] = useState(null);
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [consoleError, setConsoleError] = useState(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const [showPresent, setShowPresent] = useState(false);
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
  const mode = gatewayModeDetails(config.mcpUrl);
  // The latest tool-call result shown in the RESULTS terminal tab. resultNonce
  // bumps on each new result to flash the tab so the user notices output arrived.
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
  // Fresh-demo reset: wipe chat, events, results, and discovered tools but keep
  // the Privilege sign-in and gateway config. The empty /config POST resets the
  // server-side MCP session (resetMcpState) without changing any config value.
  const clearActivity = useCallback(() => {
    setChatMessages([]);
    setChatInput('');
    setEvents([]);
    setToolResults([]);
    setRawRpcResult('');
    setTools([]);
    setToolPolicy({ total: 0, permitted: 0, filtered: 0, filteredTools: [] });
    setSelectedTool(null);
    setSelectedScope(null);
    setToolSearch('');
    api('/config', { method: 'POST', body: {} }).catch(() => { /* page state already cleared */ });
  }, []);
  const [envVars, setEnvVars] = useState(null);
  const [envDirty, setEnvDirty] = useState(false);
  const chatEndRef = useRef(null);
  const sidebarRef = useRef(null);
  const terminalRef = useRef(null);
  const bodyRef = useRef(null);

  // Drag cleanup refs so an unmount mid-drag (route change with the button
  // held) can also remove the listeners — same class of leak useDividerDrag
  // guards against for its callers.
  const dragCleanupRef = useRef(null);

  const startSidebarDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current.offsetWidth;
    const onMove = (ev) => {
      const next = Math.max(200, Math.min(1000, startW + ev.clientX - startX));
      sidebarRef.current.style.width = `${next}px`;
    };
    // Pointer capture keeps pointermove/pointerup delivered to this element
    // even if the cursor leaves the document (taskbar, another window, an
    // iframe) — a plain document mouseup listener never fires there, which
    // used to leave onMove permanently attached.
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      try { e.target.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      dragCleanupRef.current = null;
    };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* environment without Pointer Capture support */ }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    dragCleanupRef.current = onUp;
  };

  const startTerminalDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalRef.current.offsetHeight;
    const onMove = (ev) => {
      const next = Math.max(80, Math.min(500, startH - (ev.clientY - startY)));
      terminalRef.current.style.height = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      try { e.target.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      dragCleanupRef.current = null;
    };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* environment without Pointer Capture support */ }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    dragCleanupRef.current = onUp;
  };

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  useEffect(() => {
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
      setGatewayMode(s.gatewayMode || 'agentless');
      setGatewayConfigs(s.gatewayConfigs || { agent: {}, agentless: {} });
      savedMcpUrlRef.current = s.config?.mcpUrl || '';
      setPresets(Array.isArray(s.presets) ? s.presets : []);
      setAuthenticated(Boolean(s.oauth?.authenticated));
      setMainAppAuthenticated(Boolean(s.mainAppAuthenticated));
      setUser(s.user || null);
      if (s.oauth?.scope) setGrantedScopes(s.oauth.scope.split(' ').filter(Boolean));
      setTools(s.tools || []);
      setToolPolicy(s.policy || { total: (s.tools || []).length, permitted: (s.tools || []).length, filtered: 0, filteredTools: [] });
      setMcpProtocol(s.mcp || null);
      setSubscriptionActive(Boolean(s.mcp?.subscriptionActive));
      setGatewayStateLoaded(true);
      // Auto-discover tools only after Privilege auth completes
      if (s.gatewayMode !== 'agent' && s.oauth?.authenticated && (!s.tools || s.tools.length === 0)) {
        refreshTools(true);
      }
      // Auto-connect Privilege using the active PingOne session when the main app
      // is already logged in. The gateway is its own Authorization Server, so the
      // banking token can never be reused directly — but prompt=none on the BFF
      // (see privilegeMcpClient.js beginOAuthFlow) completes off the existing
      // PingOne session, so this costs one redirect and no login page.
      //
      // NEVER auto-retry once an attempt has already come back: by then the BFF
      // has set privilegePromptNoneFailed, so a second /auth/start drops the user
      // on a real PingOne login page they never asked for. Any `auth` param means
      // we are returning from a round trip — hand back to the modal instead.
      if (s.gatewayMode !== 'agent' && s.mainAppAuthenticated && !s.oauth?.authenticated) {
        if (searchParams.get('auth')) {
          setShowSignInModal(true);
        } else {
          setSilentAuthPending(true);
          api('/auth/start', { method: 'POST' })
            .then((data) => { window.location.href = data.authUrl; })
            .catch(() => { setSilentAuthPending(false); setShowSignInModal(true); });
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
    es.addEventListener('subscription', handler('subscription'));
    es.addEventListener('error', handler('error'));
    return () => es.close();
  }, [appendEvent]);

  useEffect(() => {
    const authResult = searchParams.get('auth');
    const reason = searchParams.get('reason');
    if (authResult === 'success') {
      appendChat('system', 'OAuth completed. Refreshing tools...');
      api('/state').then((s) => {
        if (s.oauth?.authenticated) {
          setAuthenticated(true);
          // The app shell owns the top banner; notify it after this page's
          // gateway callback establishes the shared BFF session.
          window.dispatchEvent(new CustomEvent('userAuthenticated'));
        }
        if (s.oauth?.scope) setGrantedScopes(s.oauth.scope.split(' ').filter(Boolean));
      }).catch(() => {});
      refreshTools().finally(clearSwitching);
    } else {
      // Stale switch flag (auth error, silent_failed, or back-button out of the
      // redirect) — never leave the overlay stuck.
      clearSwitching();
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
    const urlChanged = Boolean(config.mcpUrl) && config.mcpUrl !== savedMcpUrlRef.current;
    try {
      const saved = await api('/config', { method: 'POST', body: { ...config, gatewayMode } });
      savedMcpUrlRef.current = config.mcpUrl;
      setGatewayConfigs(saved.gatewayConfigs || gatewayConfigs);
      if (!urlChanged) {
        appendChat('system', 'Configuration saved.');
        return;
      }
      if (gatewayMode === 'agent') {
        setTools([]);
        setSelectedTool(null);
        await refreshTools();
        return;
      }
      // Gateway changed (agent <-> agentless): the two frontends have different
      // OAuth front doors, so re-auth against the new one. The redirect lands
      // back on ?auth=success, which rediscovers tools and clears the overlay.
      setSwitching(true);
      setTools([]);
      setSelectedTool(null);
      try { sessionStorage.setItem('cur_priv_switching', '1'); } catch { /* storage disabled */ }
      const data = await api('/auth/start', { method: 'POST' });
      window.location.href = data.authUrl;
    } catch (err) {
      clearSwitching();
      appendChat('system', `Save failed: ${err.message}`);
    }
  };

  const switchGatewayMode = async (nextMode) => {
    if (nextMode === gatewayMode) return;
    const savedConfig = gatewayConfigs[nextMode] || {};
    const nextConfig = nextMode === 'agent'
      ? { ...config, ...savedConfig, clientId: '', scopes: '' }
      : { ...config, ...savedConfig };

    setGatewayMode(nextMode);
    setConfig(nextConfig);
    setTools([]);
    setSelectedTool(null);
    try {
      const saved = await api('/config', {
        method: 'POST',
        body: { ...nextConfig, gatewayMode: nextMode },
      });
      savedMcpUrlRef.current = nextConfig.mcpUrl;
      setGatewayConfigs(saved.gatewayConfigs || gatewayConfigs);
      if (nextMode === 'agent') {
        await refreshTools();
        return;
      }
      setSwitching(true);
      try { sessionStorage.setItem('cur_priv_switching', '1'); } catch { /* storage disabled */ }
      const data = await api('/auth/start', { method: 'POST' });
      window.location.href = data.authUrl;
    } catch (err) {
      clearSwitching();
      appendChat('system', `Gateway switch failed: ${err.message}`);
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
    setToolsLoading(true);
    try {
      const data = await api('/tools/list', { method: 'POST' });
      const nextTools = data.tools || [];
      setTools(nextTools);
      setToolPolicy(data.policy || { total: nextTools.length, permitted: nextTools.length, filtered: 0, filteredTools: [] });
      api('/catalog').then((catalog) => {
        setMcpCatalog({
          prompts: catalog.prompts || [],
          resources: catalog.resources || [],
          resourceTemplates: catalog.resourceTemplates || [],
        });
        setMcpProtocol(catalog.protocol || null);
      }).catch(() => { /* tools remain usable when optional primitives fail */ });
      setAuthenticated(true);
      if (!silent) appendChat('system', `Discovered ${nextTools.length} tools from MCP server.`);
    } catch (err) {
      setTools([]);
      if (err.message?.toLowerCase().includes('not authenticated') || err.message?.includes('401')) {
        setAuthenticated(false);
        setShowSignInModal(true);
      } else if (
        err.message?.toLowerCase().includes('not authorized') ||
        err.message?.includes('403') ||
        err.message?.toLowerCase().includes("doesn't have access") ||
        err.message?.toLowerCase().includes('does not have access')
      ) {
        setBlockedDetail({ door: doorName(config.mcpUrl), url: config.mcpUrl, upstream: err.message });
        setShowBlockedModal(true);
        if (!silent) appendChat('system', 'Access blocked by policy.');
        return;
      }
      if (!silent) appendChat('system', `Refresh failed: ${err.message}`);
    } finally {
      // finally, not a trailing line — the 403 branch returns early.
      setToolsLoading(false);
    }
  };

  const connectConsole = async () => {
    const authToken = consoleToken.trim();
    if (!authToken) return;
    setConsoleBusy(true);
    setConsoleError(null);
    try {
      const data = await api('/console/connect', { method: 'POST', body: { authToken } });
      setConsoleData(data);
      setConsoleToken('');   // the BFF holds it now; don't keep a copy in the DOM
    } catch (err) {
      setConsoleError(err.message);
      setConsoleData(null);
    } finally {
      setConsoleBusy(false);
    }
  };

  const refreshConsole = async () => {
    setConsoleBusy(true);
    setConsoleError(null);
    try {
      setConsoleData(await api('/console/inventory'));
    } catch (err) {
      setConsoleError(err.message);
    } finally {
      setConsoleBusy(false);
    }
  };

  const disconnectConsole = async () => {
    await api('/console/disconnect', { method: 'POST' }).catch(() => {});
    setConsoleData(null);
    setConsoleError(null);
  };

  const switchDoor = async (mcpUrl) => {
    const next = { ...config, mcpUrl };
    try {
      await api('/config', { method: 'POST', body: next });
      setConfig(next);
      setShowBlockedModal(false);
      appendChat('system', `Switched to door: ${doorName(mcpUrl) || mcpUrl}`);
      refreshTools(true);
    } catch (err) {
      appendChat('system', `Failed to switch door: ${err.message}`);
    }
  };

  // Candidate doors to probe on a denial: everything the console knows about,
  // falling back to the configured presets when no console token is connected.
  const knownDoors = () => {
    const fromConsole = (consoleData?.applications || []).map((a) => a.mcpUrl).filter(Boolean);
    const fromPresets = presets.filter((p) => p.mode === 'agentless').map((p) => p.url);
    return [...new Set([...fromConsole, ...fromPresets])].filter((u) => u && u !== config.mcpUrl);
  };

  const probeDoors = async () => {
    const urls = knownDoors();
    if (urls.length === 0) { setDoorProbe({ running: false, results: [] }); return; }
    setDoorProbe({ running: true, results: null });
    try {
      const data = await api('/doors/probe', { method: 'POST', body: { urls } });
      setDoorProbe({ running: false, results: data.results || [] });
    } catch (err) {
      setDoorProbe({ running: false, results: [], error: err.message });
    }
  };

  // Probe as soon as the denial modal opens: the answer to "is my grant missing
  // or am I on the wrong door?" is the first thing anyone wants, and the gateway
  // will not say. Reset on close so a later denial re-probes rather than showing
  // a stale verdict.
  useEffect(() => {
    if (showBlockedModal) probeDoors();
    else setDoorProbe({ running: false, results: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBlockedModal]);

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
          policy: data.policy || null,
          decision: data.decision || null,
          execution: data.execution || null,
          steps: data.steps || [],
        });
        if (data.tools) {
          setTools(data.tools);
          setToolPolicy(data.policy || { total: data.tools.length, permitted: data.tools.length, filtered: 0, filteredTools: [] });
          setAuthenticated(true);
        }
        if (data.decision?.tool && data.execution) {
          recordResult(data.decision.tool, JSON.stringify(data.execution, null, 2), data.decision.outcome === 'ALLOWED');
        }
      }
    } catch (err) {
      if (isGatewayAuthChallenge(err)) {
        setShowSignInModal(true);
        appendChat('system', 'Sign in is required to access the gateway.');
      } else {
        appendChat('assistant', `Error: ${err.message}`);
      }
    } finally {
      setThinking(false);
    }
  };

  // Per-row executor for the Tools table: returns the pretty-printed result and
  // also records it in the RESULTS terminal tab (which flashes so the user sees
  // fresh output land).
  const recordResult = useCallback((name, result, ok) => {
    setToolResults([{ tool: name, result, ok, ts: new Date().toISOString() }]);
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
      if (isGatewayAuthChallenge(err)) setShowSignInModal(true);
      out = JSON.stringify({ error: isGatewayAuthChallenge(err) ? 'Sign in is required to access the gateway.' : err.message }, null, 2);
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

  const chooseMcpMethod = (method) => {
    setMcpMethod(method);
    setMcpParams(JSON.stringify(MCP_METHOD_TEMPLATES[method] || {}, null, 2));
    setMcpResult('');
  };

  const sendMcpRequest = async () => {
    try {
      const params = JSON.parse(mcpParams || '{}');
      const data = await api('/request', { method: 'POST', body: { method: mcpMethod, params } });
      setMcpResult(JSON.stringify(data, null, 2));
      const result = data?.result;
      if (result?.resultType === 'input_required') {
        const responses = (result.inputRequests || []).map((input) => (
          input.method === 'elicitation/create'
            ? { action: 'accept', content: {} }
            : { error: { code: -32601, message: `Unsupported input request: ${input.method}` } }
        ));
        setMcpInputRequired({ method: mcpMethod, params, requestState: result.requestState });
        setMcpInputResponses(JSON.stringify(responses, null, 2));
      } else {
        setMcpInputRequired(null);
      }
    } catch (err) {
      if (isGatewayAuthChallenge(err)) setShowSignInModal(true);
      setMcpResult(JSON.stringify({ error: isGatewayAuthChallenge(err) ? 'Sign in is required to access the gateway.' : err.message }, null, 2));
    }
  };

  const continueMcpRequest = async () => {
    if (!mcpInputRequired) return;
    try {
      const inputResponses = JSON.parse(mcpInputResponses || '[]');
      const params = {
        ...mcpInputRequired.params,
        requestState: mcpInputRequired.requestState,
        inputResponses,
      };
      const data = await api('/request', {
        method: 'POST', body: { method: mcpInputRequired.method, params },
      });
      setMcpResult(JSON.stringify(data, null, 2));
      if (data?.result?.resultType !== 'input_required') setMcpInputRequired(null);
    } catch (err) {
      if (isGatewayAuthChallenge(err)) setShowSignInModal(true);
      setMcpResult(JSON.stringify({ error: isGatewayAuthChallenge(err) ? 'Sign in is required to access the gateway.' : err.message }, null, 2));
    }
  };

  const toggleSubscriptions = async () => {
    try {
      if (subscriptionActive) {
        await api('/subscriptions', { method: 'DELETE' });
        setSubscriptionActive(false);
      } else {
        await api('/subscriptions/start', { method: 'POST' });
        setSubscriptionActive(true);
        setTerminalTab('events');
      }
    } catch (err) {
      setMcpResult(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  return (
    <div className="cur-ide" data-cur-theme={pageTheme}>
      {switching && (
        <div className="cur-modal-overlay cur-switch-overlay" role="status" aria-label="Switching gateway">
          <div className="cur-switch-box">
            <div className="cur-thinking-dots"><span /><span /><span /></div>
            <span>Switching gateway...</span>
          </div>
        </div>
      )}
      {showPresent && (
        <div className="ptt-present-overlay">
          <ToolsTable tools={tools} presentMode onClose={() => setShowPresent(false)} />
        </div>
      )}
      {showSignInModal && (
        <div className="cur-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cur-signin-title">
          <div className="cur-modal">
            <h2 id="cur-signin-title">Sign in to continue</h2>
            <p>
              This gateway is its own authorization server, so it issues its own token
              rather than reusing your app session. Silent sign-in did not complete, so
              this one may ask for your credentials.
            </p>
            <div className="cur-btn-row">
              <button className="cur-btn cur-btn--primary" onClick={async () => {
                setShowSignInModal(false);
                setSilentAuthPending(true);
                try {
                  const data = await api('/auth/start', { method: 'POST' });
                  window.location.href = data.authUrl;
                } catch (err) {
                  setSilentAuthPending(false);
                  appendChat('system', `Sign-in unavailable: ${err.message}`);
                }
              }}>Sign In</button>
              <button className="cur-btn" onClick={() => setShowSignInModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showBlockedModal && (
        <div className="cur-modal-overlay" onClick={() => setShowBlockedModal(false)}>
          <div className="cur-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Access Denied</h2>
            <dl className="cur-denial-facts">
              <dt>Door</dt><dd>{blockedDetail?.door || '(unknown)'}</dd>
              <dt>Identity</dt><dd>{user?.email || '(unknown)'}</dd>
              <dt>Gateway said</dt><dd>{blockedDetail?.upstream || '403 Forbidden'}</dd>
            </dl>
            <p className="cur-denial-note">
              The gateway does not disclose which policy denied this — it returns a bare
              403 and logs nothing — so the policy name below cannot be confirmed as the
              one that blocked you.
            </p>
            {consoleData ? (() => {
              const covering = (consoleData.policies || []).filter((p) => policyMentions(p, blockedDetail?.door));
              const naming = covering.filter((p) => policyMentions(p, user?.email));
              return (
                <p className="cur-denial-note">
                  {covering.length === 0
                    ? `No policy mentions "${blockedDetail?.door}". That is the likeliest reason.`
                    : `Policies mentioning "${blockedDetail?.door}": ${covering.map((p) => p.name).join(', ')}. `
                      + (naming.length === 0
                        ? `None of them mention ${user?.email || 'this user'}.`
                        : `${naming.map((p) => p.name).join(', ')} also mention this user — check the grant has not expired.`)}
                </p>
              );
            })() : (
              <p className="cur-denial-note">
                Connect a console token in the Policies tab to see which policies cover this door.
              </p>
            )}
            {doorProbe.running && <p className="cur-denial-note">Trying the other doors with this identity...</p>}
            {doorProbe.results && (
              <div className="cur-denial-probe">
                {doorProbe.results.length === 0 && <p className="cur-denial-note">No other doors to try.</p>}
                {doorProbe.results.map((r) => (
                  <div key={r.url} className="cur-denial-probe-row">
                    <span className={r.ok ? 'cur-denial-ok' : 'cur-denial-bad'}>{r.ok ? `${r.tools} tools` : (r.status || 'failed')}</span>
                    <span className="cur-denial-door">{doorName(r.url) || r.url}</span>
                    {r.ok && <button className="cur-btn" onClick={() => switchDoor(r.url)}>Switch</button>}
                  </div>
                ))}
              </div>
            )}
            <p className="cur-denial-note">
              Grant access in the{' '}
              <a href="https://console.login.privilege.pingone.com/?env=01d89b06-66d5-430e-9f28-65636843788b" target="_blank" rel="noreferrer">Privilege console</a>.
              Policies are time-boxed — an expired one fails exactly like a missing one.
            </p>
            <div className="cur-btn-row">
              <button className="cur-btn" onClick={() => { setShowBlockedModal(false); refreshTools(); }}>Retry</button>
              <button className="cur-btn" onClick={probeDoors} disabled={doorProbe.running}>
                {doorProbe.running ? 'Probing...' : 'Try other doors'}
              </button>
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
              <span className="cur-flow-title">AI Agent Gateway — Request Flow</span>
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

      {/* Learning Guide — draggable/resizable modal instead of a page navigation */}
      <DraggableModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        title="AI Agent Gateway Guide"
        defaultWidth={960}
        defaultHeight={720}
        storageKey="privilege-guide-modal"
      >
        <PrivilegeMcpLearningPage />
      </DraggableModal>

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
                {presets.length > 0 && (
                  <label className="cur-field">
                    <span className="cur-field-label">Gateway Preset</span>
                    <select
                      className="cur-input"
                      value={presets.find((p) => p.url === config.mcpUrl)?.url || ''}
                      onChange={(e) => {
                        const preset = presets.find((p) => p.url === e.target.value);
                        if (!preset) return;
                        const nextMode = preset.mode || (preset.url.includes('.applications.procyon.ai') ? 'agent' : 'agentless');
                        const savedConfig = gatewayConfigs[nextMode] || {};
                        setGatewayMode(nextMode);
                        setConfig({ ...config, ...savedConfig, mcpUrl: preset.url });
                      }}
                    >
                      <option value="">Custom</option>
                      {presets.map((p) => (
                        <option key={p.url} value={p.url}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="cur-field">
                  <span className="cur-field-label">{gatewayMode === 'agent' ? 'Priv Agent URL' : 'Agentless Gateway URL'}</span>
                  <input className="cur-input" value={config.mcpUrl} onChange={(e) => setConfig({ ...config, mcpUrl: e.target.value })} placeholder="https://mcpgw.example.com/mcp" />
                </label>
                {gatewayMode === 'agent' ? (
                  <p className="cur-settings-note">Authentication is managed by the Priv Agent. Save redirects this browser directly to the configured URL.</p>
                ) : (
                  <>
                    <label className="cur-field">
                      <span className="cur-field-label">OAuth Client ID</span>
                      <input className="cur-input" value={config.clientId} onChange={(e) => setConfig({ ...config, clientId: e.target.value })} />
                    </label>
                    <label className="cur-field">
                      <span className="cur-field-label">Requested Scopes</span>
                      <input className="cur-input" value={config.scopes} onChange={(e) => setConfig({ ...config, scopes: e.target.value })} />
                    </label>
                  </>
                )}
              </div>
              {gatewayMode === 'agentless' && (
                <>
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
                </>
              )}
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
          <span className="cur-titlebar-title">AI Agent Gateway Client — PingOne</span>
        </div>
        <div className="cur-titlebar-center">
          <div className={`cur-status ${(authenticated || mainAppAuthenticated) ? 'cur-status--ok' : ''}`}>
            <span className="cur-status-dot" />
            {(authenticated || mainAppAuthenticated) ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <div className="cur-titlebar-right">
          <label className="cur-mode-switcher">
            <span>Gateway</span>
            <select
              aria-label="Gateway connection mode"
              value={gatewayMode}
              disabled={!gatewayStateLoaded || switching}
              onChange={(event) => switchGatewayMode(event.target.value)}
            >
              <option value="agent">Agent</option>
              <option value="agentless">Agentless</option>
            </select>
          </label>
          <FootprintSkinPicker className="cur-skin-picker" />
          <button
            type="button"
            className="cur-flow-trigger"
            onClick={() => setPageTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={pageTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {pageTheme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="cur-flow-trigger" onClick={clearActivity} title="Clear chat, events, and results for a fresh demo">Clear</button>
          <button className="cur-flow-trigger" onClick={() => setShowGuide(true)} title="Learning Guide">Guide</button>
          <button className="cur-flow-trigger cur-settings-gear" onClick={() => setShowSettings(true)} title="Settings">&#x2699;&#xFE0E;</button>
          <button className="cur-flow-trigger" onClick={() => setShowFlowModal(true)}>Flow</button>
          {config.llmModel && <span className="cur-model-badge">{config.llmModel}</span>}
        </div>
      </header>

      <section className={`cur-gateway-banner cur-gateway-banner--${mode.key}`} aria-label="Gateway mode">
        <div className="cur-gateway-banner__eyebrow">ACTIVE USE CASE</div>
        <div className="cur-gateway-banner__title">{mode.title}</div>
        <div className="cur-gateway-banner__detail">{mode.detail}</div>
        {mode.url && <code className="cur-gateway-banner__url">{mode.url}</code>}
        {toolPolicy.total > 0 && (
          <div className="cur-policy-summary" aria-label="Tool policy summary">
            <span><strong>{toolPolicy.total}</strong> catalog</span>
            <span className="cur-policy-summary__allowed"><strong>{toolPolicy.permitted}</strong> permitted</span>
            <span className="cur-policy-summary__filtered"><strong>{toolPolicy.filtered}</strong> filtered</span>
          </div>
        )}
      </section>

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
            {gatewayMode !== 'agent' && (authenticated ? (
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
            ))}

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
              {toolsLoading
                ? <span className="cur-spinner" role="status" aria-label="Discovering tools" />
                : <span className="cur-scope-count">{tools.length}</span>}
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
            })() : toolsLoading ? (
              <div className="cur-tools-waiting">
                <span className="cur-spinner" aria-hidden="true" />
                <span>Waiting for the AI Gateway to return tools...</span>
              </div>
            ) : (
              <div className="cur-empty-state">No tools discovered yet</div>
            )}
            <button
              className="cur-btn cur-btn--primary cur-btn--refresh"
              onClick={() => refreshTools(false)}
              disabled={toolsLoading}
            >
              {toolsLoading ? 'Discovering...' : 'Refresh Tools'}
            </button>
          </div>
        </aside>

        <div className="cur-resize-handle cur-resize-handle--v" onPointerDown={startSidebarDrag} />

        {/* Main editor area */}
        <main className="cur-main">
          <div className="cur-tabs">
            <button className={`cur-tab ${activeTab === 'chat' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('chat')}>Agent Chat</button>
            <button className={`cur-tab ${activeTab === 'tools' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('tools')}>Tools</button>
            <button className={`cur-tab ${activeTab === 'mcp' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('mcp')}>MCP Explorer</button>
            <button className={`cur-tab ${activeTab === 'rpc' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('rpc')}>Raw RPC</button>
            <button className={`cur-tab ${activeTab === 'policies' ? 'cur-tab--active' : ''}`} onClick={() => setActiveTab('policies')}>Policies</button>
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
                      {msg.extra?.decision && (
                        <div className={`cur-policy-decision cur-policy-decision--${msg.extra.decision.outcome.toLowerCase()}`}>
                          <strong>{msg.extra.decision.outcome}</strong>
                          <code>{msg.extra.decision.tool}</code>
                          <span>{msg.extra.decision.reason}</span>
                        </div>
                      )}
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

            {activeTab === 'mcp' && (
              <div className="cur-rpc-panel cur-mcp-explorer">
                <div className="cur-tools-header">
                  <h3>Server Capabilities</h3>
                  <div className="cur-btn-row">
                    <button className="cur-btn" onClick={toggleSubscriptions}>
                      {subscriptionActive ? 'Stop Subscriptions' : 'Listen for Changes'}
                    </button>
                    <button className="cur-btn" onClick={() => refreshTools(false)} disabled={toolsLoading}>
                      {toolsLoading ? 'Discovering...' : 'Rediscover'}
                    </button>
                  </div>
                </div>
                <div className="cur-mcp-protocol">
                  <span>{mcpProtocol?.serverInfo?.name || 'MCP server'}</span>
                  <span>{mcpProtocol?.era || 'not connected'} · {mcpProtocol?.version || 'version unknown'}</span>
                </div>
                {mcpProtocol?.instructions && <p className="cur-mcp-instructions">{mcpProtocol.instructions}</p>}
                <div className="cur-mcp-catalog-grid">
                  <section>
                    <h4>Prompts ({mcpCatalog.prompts.length})</h4>
                    {mcpCatalog.prompts.length === 0 ? (
                      <p className="cur-mcp-empty">{capabilityNote(mcpProtocol?.capabilities?.prompts, 'prompts')}</p>
                    ) : mcpCatalog.prompts.map((prompt) => (
                      <button key={prompt.name} className="cur-mcp-item" onClick={() => {
                        chooseMcpMethod('prompts/get');
                        setMcpParams(JSON.stringify({ name: prompt.name, arguments: {} }, null, 2));
                      }}>{prompt.name}</button>
                    ))}
                  </section>
                  <section>
                    <h4>Resources ({mcpCatalog.resources.length})</h4>
                    {mcpCatalog.resources.length === 0 ? (
                      <p className="cur-mcp-empty">{capabilityNote(mcpProtocol?.capabilities?.resources, 'resources')}</p>
                    ) : mcpCatalog.resources.map((resource) => (
                      <button key={resource.uri} className="cur-mcp-item" onClick={() => {
                        chooseMcpMethod('resources/read');
                        setMcpParams(JSON.stringify({ uri: resource.uri }, null, 2));
                      }}>{resource.name || resource.uri}</button>
                    ))}
                  </section>
                  <section>
                    <h4>Templates ({mcpCatalog.resourceTemplates.length})</h4>
                    {mcpCatalog.resourceTemplates.length === 0 ? (
                      <p className="cur-mcp-empty">{capabilityNote(mcpProtocol?.capabilities?.resources, 'resource templates')}</p>
                    ) : mcpCatalog.resourceTemplates.map((template) => (
                      <div key={template.uriTemplate} className="cur-mcp-item cur-mcp-item--static">
                        {template.name || template.uriTemplate}
                      </div>
                    ))}
                  </section>
                </div>
                <label className="cur-field">
                  <span className="cur-field-label">MCP Method</span>
                  <select className="cur-input" value={mcpMethod} onChange={(event) => chooseMcpMethod(event.target.value)}>
                    {Object.keys(MCP_METHOD_TEMPLATES).map((method) => <option key={method}>{method}</option>)}
                  </select>
                </label>
                <label className="cur-field">
                  <span className="cur-field-label">Parameters</span>
                  <textarea className="cur-input cur-input--code" rows={8} value={mcpParams} onChange={(event) => setMcpParams(event.target.value)} />
                </label>
                <button className="cur-btn cur-btn--primary" onClick={sendMcpRequest}>Send MCP Request</button>
                {mcpInputRequired && (
                  <div className="cur-mcp-input-required">
                    <h4>Input Required</h4>
                    <p>Review the server request above, then accept, decline, or cancel each input request.</p>
                    <textarea className="cur-input cur-input--code" rows={8} value={mcpInputResponses} onChange={(event) => setMcpInputResponses(event.target.value)} />
                    <button className="cur-btn cur-btn--primary" onClick={continueMcpRequest}>Continue Request</button>
                  </div>
                )}
                {mcpResult && (
                  <div className="cur-result-block">
                    <span className="cur-result-label">Response</span>
                    <pre className="cur-code-output jh-dark"><JsonHighlight value={mcpResult} deep /></pre>
                  </div>
                )}
              </div>
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
                    <pre className="cur-code-output jh-dark"><JsonHighlight value={rawRpcResult} deep /></pre>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'policies' && (
              <div className="cur-rpc-panel">
                <div className="cur-tools-header">
                  <h3>Privilege Console — doors and policies</h3>
                  {consoleData && (
                    <div className="cur-btn-row">
                      <button className="cur-btn" onClick={refreshConsole} disabled={consoleBusy}>
                        {consoleBusy ? 'Reading...' : 'Refresh'}
                      </button>
                      <button className="cur-btn" onClick={disconnectConsole}>Disconnect</button>
                    </div>
                  )}
                </div>

                {!consoleData && (
                  <>
                    <p className="cur-denial-note">
                      The console API lists the MCP applications (the doors this gateway routes
                      to) and the policies that grant access to them. It authenticates with a
                      console browser session, not with the gateway token this page already
                      holds, so it needs one value pasted from the console: the
                      <code> auth_token </code> cookie. It is held in this session only, is
                      never written to disk, and expires on its own in about an hour.
                    </p>
                    <p className="cur-denial-note">
                      Privilege console &rarr; DevTools &rarr; Application &rarr; Cookies &rarr;
                      copy the value of <code>auth_token</code>.
                    </p>
                    <label className="cur-field">
                      <span className="cur-field-label">Console auth_token</span>
                      <input
                        className="cur-input"
                        type="password"
                        value={consoleToken}
                        onChange={(e) => setConsoleToken(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') connectConsole(); }}
                        placeholder="paste the auth_token cookie value"
                      />
                    </label>
                    <button className="cur-btn cur-btn--primary" onClick={connectConsole} disabled={consoleBusy || !consoleToken.trim()}>
                      {consoleBusy ? 'Connecting...' : 'Connect'}
                    </button>
                  </>
                )}

                {consoleError && <p className="cur-denial-note cur-denial-bad">{consoleError}</p>}

                {consoleData && (
                  <>
                    <h4 className="cur-console-heading">Doors ({consoleData.applications.length})</h4>
                    <div className="cur-console-list">
                      {consoleData.applications.map((app) => (
                        <div key={app.name} className={`cur-console-row${app.mcpUrl === config.mcpUrl ? ' cur-console-row--active' : ''}`}>
                          <span className="cur-console-name">{app.name}</span>
                          <span className="cur-console-meta">
                            {app.backends.join(', ') || 'no backend'}{app.status ? ` · ${app.status}` : ''}
                          </span>
                          {app.mcpUrl === config.mcpUrl
                            ? <span className="cur-console-current">current</span>
                            : <button className="cur-btn" onClick={() => switchDoor(app.mcpUrl)}>Use</button>}
                        </div>
                      ))}
                    </div>

                    <h4 className="cur-console-heading">Policies ({consoleData.policies.length})</h4>
                    <p className="cur-denial-note">
                      The policy Spec schema is undocumented, so these are matched by text
                      search: &quot;mentions&quot; is not the same as &quot;grants&quot;. Expand a
                      policy to read what it actually contains.
                    </p>
                    <div className="cur-console-list">
                      {consoleData.policies.map((p) => (
                        <details key={p.name} className="cur-console-policy">
                          <summary>
                            <span className="cur-console-name">{p.name}</span>
                            {policyMentions(p, doorName(config.mcpUrl)) && <span className="cur-console-tag">mentions this door</span>}
                            {policyMentions(p, user?.email) && <span className="cur-console-tag">mentions you</span>}
                          </summary>
                          <pre className="cur-code-output jh-dark"><JsonHighlight value={p.spec} deep /></pre>
                        </details>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

          </div>

          {/* Terminal panel */}
          <div className="cur-resize-handle cur-resize-handle--h" onPointerDown={startTerminalDrag} />
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
                        <pre className="cur-result-item-body jh-dark"><JsonHighlight value={r.result} deep /></pre>
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
          <span className="cur-statusbar-item">MCP Protocol {mcpProtocol?.version || 'not negotiated'}</span>
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
