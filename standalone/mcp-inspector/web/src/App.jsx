import React, { useState, useEffect, useCallback, useMemo } from 'react';
import InspectorShell from './components/shared/InspectorShell';
import InspectorTabs from './components/shared/InspectorTabs';
import InspectorListItem from './components/shared/InspectorListItem';
import AddServerForm from './components/AddServerForm';
import { api } from './lib/api';

const SOURCES = [
  { key: 'tools', label: 'Tools' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'pingone', label: 'PingOne' },
];

const OUTPUT_TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'schema', label: 'Schema' },
];

function coerceParam(raw, type) {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function urlError(key) {
  const params = new URLSearchParams(window.location.search);
  const v = params.get(key);
  if (v) window.history.replaceState({}, '', window.location.pathname);
  return v;
}

export default function App() {
  const [source, setSource] = useState('tools');
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [showAddServer, setShowAddServer] = useState(false);

  const [items, setItems] = useState([]); // tools or protocol methods
  const [loadingItems, setLoadingItems] = useState(false);
  const [banner, setBanner] = useState(null);

  const [selectedItem, setSelectedItem] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [outputTab, setOutputTab] = useState('response');

  const [pingoneStatus, setPingoneStatus] = useState(null);

  const loadProfiles = useCallback(async () => {
    const { data } = await api.get('/api/profiles');
    const list = data?.profiles || [];
    setProfiles(list);
    setSelectedProfileId((prev) => prev || list[0]?.id || '');
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  useEffect(() => {
    const err = urlError('pingone_error');
    if (err) setBanner({ message: `PingOne sign-in failed: ${err}` });
    if (urlError('pingone_login')) setBanner(null);
  }, []);

  const loadPingoneStatus = useCallback(async () => {
    const { data } = await api.get('/api/pingone/status');
    setPingoneStatus(data);
  }, []);

  const loadItems = useCallback(async () => {
    setSelectedItem(null);
    setLastInvoke(null);
    setParamValues({});
    setBanner(null);

    if (source === 'pingone') {
      await loadPingoneStatus();
      setLoadingItems(true);
      const { data } = await api.get('/api/pingone/tools');
      setLoadingItems(false);
      if (data?.loginRequired) {
        setItems([]);
        setBanner({ message: data.message, action: { label: 'Sign in', href: '/api/pingone/login' } });
        return;
      }
      if (data?.error) {
        setItems([]);
        setBanner({ message: data.reason });
        return;
      }
      setItems(data?.tools || []);
      return;
    }

    if (!selectedProfileId) { setItems([]); return; }

    if (source === 'protocol') {
      setLoadingItems(true);
      const { data } = await api.get('/api/protocol-methods');
      setLoadingItems(false);
      setItems((data?.methods || []).map((m) => ({ ...m, name: m.method })));
      return;
    }

    // source === 'tools'
    setLoadingItems(true);
    const { data } = await api.get(`/api/tools?profile=${encodeURIComponent(selectedProfileId)}`);
    setLoadingItems(false);
    if (data?.error) setBanner({ message: data.reason || 'Failed to load tools.' });
    setItems(data?.tools || []);
  }, [source, selectedProfileId, loadPingoneStatus]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const schemaProps = useMemo(() => selectedItem?.inputSchema?.properties || {}, [selectedItem]);
  const requiredParams = useMemo(() => new Set(selectedItem?.inputSchema?.required || []), [selectedItem]);

  const handleExecute = useCallback(async () => {
    if (!selectedItem) return;
    const missing = [...requiredParams].filter((k) => !String(paramValues[k] ?? '').trim());
    if (missing.length) { setBanner({ message: `Required: ${missing.join(', ')}` }); return; }

    const params = {};
    for (const [key, schema] of Object.entries(schemaProps)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }

    setBusy(true);
    const t0 = Date.now();
    let res;
    if (source === 'pingone') {
      res = await api.post('/api/pingone/invoke', { tool: selectedItem.name, params });
    } else if (source === 'protocol') {
      res = await api.post('/api/rpc', { profile: selectedProfileId, method: selectedItem.name, params });
    } else {
      res = await api.post('/api/invoke', { profile: selectedProfileId, tool: selectedItem.name, params });
    }
    const ms = Date.now() - t0;
    setBusy(false);
    setLastInvoke(res.data);
    setLastTiming({ ms, error: !res.ok || Boolean(res.data?.error) });
    setOutputTab('response');
    if (res.data?.loginRequired || res.data?.error) {
      setBanner({ message: res.data.message || res.data.reason || 'Request failed.' });
    }
  }, [selectedItem, paramValues, schemaProps, requiredParams, source, selectedProfileId]);

  const outputValue = useMemo(() => {
    switch (outputTab) {
      case 'response': return lastInvoke ?? null;
      case 'request':
        return selectedItem
          ? {
              jsonrpc: '2.0',
              id: 1,
              method: source === 'protocol' ? selectedItem.name : 'tools/call',
              params: source === 'protocol' ? paramValues : { name: selectedItem.name, arguments: paramValues },
            }
          : null;
      case 'schema': return selectedItem?.inputSchema || null;
      default: return null;
    }
  }, [outputTab, lastInvoke, selectedItem, paramValues, source]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const needsProfile = source !== 'pingone';

  const left = (
    <div className="tool-tree">
      {loadingItems && <div className="tool-tree__empty">Loading…</div>}
      {!loadingItems && items.length === 0 && (
        <div className="tool-tree__empty">
          {needsProfile && !selectedProfileId ? 'Add a server to get started.' : 'No tools found.'}
        </div>
      )}
      {items.map((item) => (
        <InspectorListItem
          key={item.name}
          label={item.name}
          active={selectedItem?.name === item.name}
          onClick={() => { setSelectedItem(item); setParamValues({}); setLastInvoke(null); }}
        />
      ))}
    </div>
  );

  const middle = (
    <div className="tool-form">
      {!selectedItem && <div className="tool-form__empty">Select a tool on the left.</div>}
      {selectedItem && (
        <>
          <h2>{selectedItem.name}</h2>
          {selectedItem.description && <p className="tool-form__desc">{selectedItem.description}</p>}
          {Object.entries(schemaProps).map(([key, schema]) => (
            <label key={key} className="tool-form__field">
              <span>
                {key}
                {requiredParams.has(key) ? ' *' : ''}
                {schema?.type ? ` (${schema.type})` : ''}
              </span>
              <input
                value={paramValues[key] ?? ''}
                placeholder={schema?.description || ''}
                onChange={(e) => setParamValues((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          ))}
          <button type="button" className="btn btn--primary" onClick={handleExecute} disabled={busy}>
            {busy ? 'Running…' : 'Execute'}
          </button>
        </>
      )}
    </div>
  );

  const right = (
    <div className="tool-output">
      <InspectorTabs tabs={OUTPUT_TABS} activeKey={outputTab} onChange={setOutputTab} />
      <pre className="tool-output__json">
        {outputValue === null || outputValue === undefined ? '—' : JSON.stringify(outputValue, null, 2)}
      </pre>
      {lastTiming && (
        <div className={lastTiming.error ? 'tool-output__timing tool-output__timing--error' : 'tool-output__timing'}>
          {lastTiming.error ? 'Failed' : 'OK'} in {lastTiming.ms}ms
        </div>
      )}
    </div>
  );

  return (
    <InspectorShell
      title="MCP Inspector"
      statusOn
      left={left}
      middle={middle}
      right={right}
      banner={
        <>
          <div className="source-bar">
            {SOURCES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={s.key === source ? 'source-tab source-tab--active' : 'source-tab'}
                onClick={() => setSource(s.key)}
              >
                {s.label}
              </button>
            ))}
            {needsProfile && (
              <>
                <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  <option value="">Select a server…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => setShowAddServer((v) => !v)}>+ Add server</button>
                {selectedProfile && selectedProfile.transport !== 'pingone' && (
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={async () => {
                      await api.del(`/api/profiles/${selectedProfileId}`);
                      setSelectedProfileId('');
                      loadProfiles();
                    }}
                  >
                    Remove server
                  </button>
                )}
              </>
            )}
            {source === 'pingone' && pingoneStatus && !pingoneStatus.signedIn && (
              <a className="btn btn--primary" href="/api/pingone/login">Sign in to PingOne</a>
            )}
            <button type="button" className="btn" onClick={loadItems}>Refresh</button>
          </div>
          {showAddServer && (
            <AddServerForm
              onAdded={(profile) => { setShowAddServer(false); setSelectedProfileId(profile.id); loadProfiles(); }}
              onCancel={() => setShowAddServer(false)}
            />
          )}
          {banner && (
            <div className="page-banner">
              {banner.message}
              {banner.action && <a href={banner.action.href} className="btn btn--primary">{banner.action.label}</a>}
            </div>
          )}
        </>
      }
    />
  );
}
