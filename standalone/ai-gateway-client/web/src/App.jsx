import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import InspectorShell from './components/shared/InspectorShell';
import InspectorTabs from './components/shared/InspectorTabs';
import InspectorListItem from './components/shared/InspectorListItem';
import { api } from './lib/api';

const OUTPUT_TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'log', label: 'Relay log' },
];

function coerceParam(raw, type) {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function readAndClearAuthResult() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const reason = params.get('reason');
  if (!auth) return null;
  window.history.replaceState({}, '', window.location.pathname);
  return { auth, reason };
}

export default function App() {
  const [state, setState] = useState(null);
  const [banner, setBanner] = useState(null);
  const [doorUrlInput, setDoorUrlInput] = useState('');
  const [events, setEvents] = useState([]);
  const [showConsoleForm, setShowConsoleForm] = useState(false);
  const [consoleToken, setConsoleToken] = useState('');
  const [probeResults, setProbeResults] = useState(null);

  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [outputTab, setOutputTab] = useState('response');

  const [rawMethod, setRawMethod] = useState('resources/list');
  const [rawParams, setRawParams] = useState('{}');

  const loadState = useCallback(async () => {
    const { data } = await api.get('/api/gateway/state');
    setState(data);
    setDoorUrlInput(data?.config?.mcpUrl || '');
    return data;
  }, []);

  const loadTools = useCallback(async () => {
    const { data, ok } = await api.post('/api/gateway/tools/list');
    if (!ok) {
      setBanner({ message: data?.error || 'Failed to list tools.' });
      return;
    }
    setState((prev) => (prev ? { ...prev, tools: data.tools, policy: data.policy } : prev));
  }, []);

  useEffect(() => {
    (async () => {
      const result = readAndClearAuthResult();
      const data = await loadState();
      if (result?.auth === 'success') {
        setBanner(null);
        if (data?.oauth?.authenticated) loadTools();
      } else if (result?.auth === 'error') {
        setBanner({ message: `Sign-in failed: ${result.reason || 'unknown error'}` });
      } else if (data?.oauth?.authenticated) {
        loadTools();
      }
    })();
  }, [loadState, loadTools]);

  useEffect(() => {
    const es = new EventSource('/api/gateway/events');
    es.onmessage = () => {};
    ['oauth', 'relay', 'mcp', 'config', 'subscription', 'error'].forEach((type) => {
      es.addEventListener(type, (e) => {
        let payload = {};
        try { payload = JSON.parse(e.data); } catch { /* ignore */ }
        setEvents((prev) => [...prev.slice(-199), { type, ...payload }]);
      });
    });
    return () => es.close();
  }, []);

  const switchMode = useCallback(async (mode, url) => {
    const { data } = await api.post('/api/gateway/config', { gatewayMode: mode, mcpUrl: url });
    setState((prev) => ({ ...prev, gatewayMode: data.gatewayMode, config: data.config, gatewayConfigs: data.gatewayConfigs, oauth: { ...prev.oauth, authenticated: data.oauth.authenticated } }));
    setDoorUrlInput(data.config.mcpUrl || '');
    setSelectedTool(null);
    setLastInvoke(null);
    if (data.oauth.authenticated) loadTools(); else setState((prev) => ({ ...prev, tools: [] }));
  }, [loadTools]);

  const signIn = useCallback(async () => {
    if (doorUrlInput !== state?.config?.mcpUrl) {
      await api.post('/api/gateway/config', { gatewayMode: state.gatewayMode, mcpUrl: doorUrlInput });
    }
    const { data, ok } = await api.post('/api/gateway/auth/start', { returnTo: '/' });
    if (!ok) { setBanner({ message: data?.error || 'Failed to start sign-in.' }); return; }
    window.location.href = data.authUrl;
  }, [doorUrlInput, state]);

  const signOut = useCallback(async () => {
    await api.post('/api/gateway/auth/logout');
    await loadState();
    setState((prev) => ({ ...prev, tools: [] }));
  }, [loadState]);

  const schemaProps = useMemo(() => selectedTool?.inputSchema?.properties || {}, [selectedTool]);
  const requiredParams = useMemo(() => new Set(selectedTool?.inputSchema?.required || []), [selectedTool]);

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return;
    const missing = [...requiredParams].filter((k) => !String(paramValues[k] ?? '').trim());
    if (missing.length) { setBanner({ message: `Required: ${missing.join(', ')}` }); return; }
    const params = {};
    for (const [key, schema] of Object.entries(schemaProps)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setBusy(true);
    const t0 = Date.now();
    const { data, ok } = await api.post('/api/gateway/tools/call', { name: selectedTool.name, arguments: params });
    setBusy(false);
    setLastInvoke(data);
    setLastTiming({ ms: Date.now() - t0, error: !ok });
    setOutputTab('response');
    if (!ok) setBanner({ message: data?.error || 'Tool call failed.' });
  }, [selectedTool, paramValues, schemaProps, requiredParams]);

  const sendRaw = useCallback(async () => {
    let params;
    try { params = JSON.parse(rawParams || '{}'); } catch { setBanner({ message: 'Params must be valid JSON.' }); return; }
    setBusy(true);
    const t0 = Date.now();
    const { data, ok } = await api.post('/api/gateway/request', { method: rawMethod, params });
    setBusy(false);
    setLastInvoke(data);
    setLastTiming({ ms: Date.now() - t0, error: !ok });
    setOutputTab('response');
    if (!ok) setBanner({ message: data?.error || 'Request failed.' });
  }, [rawMethod, rawParams]);

  const runProbe = useCallback(async () => {
    const urls = (state?.presets || []).map((p) => p.url).filter((u) => u && u !== state?.config?.mcpUrl);
    if (urls.length === 0) return;
    const { data } = await api.post('/api/gateway/doors/probe', { urls });
    setProbeResults(data?.results || []);
  }, [state]);

  const connectConsole = useCallback(async () => {
    const { data, ok } = await api.post('/api/gateway/console/connect', { authToken: consoleToken });
    if (!ok) { setBanner({ message: data?.error || 'Console connect failed.' }); return; }
    setShowConsoleForm(false);
    setConsoleToken('');
    await loadState();
  }, [consoleToken, loadState]);

  const outputValue = useMemo(() => {
    if (outputTab === 'log') return null;
    if (outputTab === 'response') return lastInvoke ?? null;
    if (outputTab === 'request') {
      return selectedTool
        ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool.name, arguments: paramValues } }
        : { jsonrpc: '2.0', id: 1, method: rawMethod, params: JSON.parse(rawParams || '{}') };
    }
    return null;
  }, [outputTab, lastInvoke, selectedTool, paramValues, rawMethod, rawParams]);

  if (!state) return <div style={{ padding: 20 }}>Loading…</div>;

  const doorLabel = state.gatewayMode === 'privilege' ? 'Privilege — straight at the AI Gateway' : 'Direct — no Privilege in the path';

  const left = (
    <div className="tool-tree">
      {!state.oauth.authenticated && <div className="tool-tree__empty">Sign in to list tools.</div>}
      {state.oauth.authenticated && (state.tools || []).length === 0 && <div className="tool-tree__empty">No tools (or none permitted by policy).</div>}
      {(state.tools || []).map((tool) => (
        <InspectorListItem
          key={tool.name}
          label={tool.name}
          active={selectedTool?.name === tool.name}
          onClick={() => { setSelectedTool(tool); setParamValues({}); setLastInvoke(null); }}
        />
      ))}
      {state.policy?.filtered > 0 && (
        <div className="tool-tree__policy">{state.policy.filtered} tool(s) filtered by gateway policy.</div>
      )}
    </div>
  );

  const middle = (
    <div className="tool-form">
      {selectedTool ? (
        <>
          <h2>{selectedTool.name}</h2>
          {selectedTool.description && <p className="tool-form__desc">{selectedTool.description}</p>}
          {Object.entries(schemaProps).map(([key, schema]) => (
            <label key={key} className="tool-form__field">
              <span>{key}{requiredParams.has(key) ? ' *' : ''}{schema?.type ? ` (${schema.type})` : ''}</span>
              <input value={paramValues[key] ?? ''} placeholder={schema?.description || ''} onChange={(e) => setParamValues((p) => ({ ...p, [key]: e.target.value }))} />
            </label>
          ))}
          <button type="button" className="btn btn--primary" onClick={handleExecute} disabled={busy}>{busy ? 'Running…' : 'Execute'}</button>
        </>
      ) : (
        <>
          <h2>Raw MCP request</h2>
          <p className="tool-form__desc">For anything that isn't tools/call — resources, prompts, completion, tasks.</p>
          <label className="tool-form__field">
            <span>method</span>
            <input value={rawMethod} onChange={(e) => setRawMethod(e.target.value)} placeholder="resources/list" />
          </label>
          <label className="tool-form__field">
            <span>params (JSON)</span>
            <textarea rows={5} value={rawParams} onChange={(e) => setRawParams(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" onClick={sendRaw} disabled={busy || !state.oauth.authenticated}>{busy ? 'Sending…' : 'Send'}</button>
        </>
      )}
    </div>
  );

  const right = (
    <div className="tool-output">
      <InspectorTabs tabs={OUTPUT_TABS} activeKey={outputTab} onChange={setOutputTab} />
      {outputTab === 'log' ? (
        <div className="relay-log">
          {events.length === 0 && <div className="tool-tree__empty">No relay activity yet.</div>}
          {events.slice().reverse().map((ev, i) => (
            <div key={i} className={`relay-log__row relay-log__row--${ev.type}`}>
              <span className="relay-log__type">{ev.type}{ev.phase ? `:${ev.phase}` : ''}</span>
              <pre>{JSON.stringify(ev, null, 2)}</pre>
            </div>
          ))}
        </div>
      ) : (
        <pre className="tool-output__json">{outputValue === null || outputValue === undefined ? '—' : JSON.stringify(outputValue, null, 2)}</pre>
      )}
      {lastTiming && outputTab !== 'log' && (
        <div className={lastTiming.error ? 'tool-output__timing tool-output__timing--error' : 'tool-output__timing'}>
          {lastTiming.error ? 'Failed' : 'OK'} in {lastTiming.ms}ms
        </div>
      )}
    </div>
  );

  return (
    <InspectorShell
      title="AI Gateway Client"
      statusOn={state.oauth.authenticated}
      statusText={doorLabel}
      left={left}
      middle={middle}
      right={right}
      banner={
        <>
          <div className="source-bar">
            <select
              value={`${state.gatewayMode}::${state.config.mcpUrl || ''}`}
              onChange={(e) => {
                const [mode, url] = e.target.value.split('::');
                switchMode(mode, url);
              }}
            >
              {(state.presets || []).map((p) => (
                <option key={`${p.mode}::${p.url}`} value={`${p.mode}::${p.url}`}>{p.label}</option>
              ))}
              {!(state.presets || []).some((p) => p.url === doorUrlInput) && doorUrlInput && (
                <option value={`${state.gatewayMode}::${doorUrlInput}`}>Custom — {doorUrlInput}</option>
              )}
            </select>
            <input className="wide" value={doorUrlInput} onChange={(e) => setDoorUrlInput(e.target.value)} placeholder="MCP server URL" />
            {doorUrlInput !== state.config.mcpUrl && (
              <button type="button" className="btn" onClick={() => switchMode(state.gatewayMode, doorUrlInput)}>Use this URL</button>
            )}
            {state.oauth.authenticated ? (
              <button type="button" className="btn btn--danger" onClick={signOut}>Sign out</button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={signIn}>Sign in</button>
            )}
            <button type="button" className="btn" onClick={loadTools} disabled={!state.oauth.authenticated}>Refresh tools</button>
            <button type="button" className="btn" onClick={runProbe} disabled={!state.oauth.authenticated}>Probe other doors</button>
            <button type="button" className="btn" onClick={() => setShowConsoleForm((v) => !v)}>Connect Privilege console</button>
          </div>
          {showConsoleForm && (
            <div className="add-server-form">
              <input className="wide" type="password" placeholder="Paste the console's auth_token cookie value" value={consoleToken} onChange={(e) => setConsoleToken(e.target.value)} />
              <button type="button" className="btn btn--primary" onClick={connectConsole}>Connect</button>
              <button type="button" className="btn" onClick={() => setShowConsoleForm(false)}>Cancel</button>
            </div>
          )}
          {probeResults && (
            <div className="page-banner">
              Probe: {probeResults.map((r) => `${new URL(r.url).pathname.split('/')[1]} → ${r.ok ? `${r.tools} tools` : `denied (${r.status})`}`).join(' · ')}
              <button type="button" className="btn" onClick={() => setProbeResults(null)}>Dismiss</button>
            </div>
          )}
          {banner && (
            <div className="page-banner">
              {banner.message}
              <button type="button" className="btn" onClick={() => setBanner(null)}>Dismiss</button>
            </div>
          )}
        </>
      }
    />
  );
}
