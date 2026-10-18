// MCP Inspector, built on the shared inspector layout (Task 4).
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInspectorSource } from '../hooks/useInspectorSource';
import { useInspectorFields } from '../context/InspectorFieldContext';
import JsonHighlight from './shared/JsonHighlight';
import { useThemeOptional } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { formatAxiosError } from '../utils/formatAxiosError';
import InspectorLayout from './inspector/InspectorLayout';
import { Chip } from './inspector/CallDetail';
import { ok, warn, err, idle } from './inspector/inspectorCalls';
import { mcpCallFromStore, apiCallFromTracker } from './inspector/mcpCalls';

const NEW_PROFILE_DEFAULTS = {
  label: '',
  transport: 'http',
  url: '',
  authHeader: 'Authorization',
  authValue: '',
  command: '',
  argsText: '',
};

const SOURCES = [
  { value: 'banking', label: 'AI Demo MCP' },
  { value: 'pingone', label: 'PingOne MCP' },
  { value: 'gateway', label: 'Gateway showcase' },
  { value: 'custom', label: 'Custom server' },
  { value: 'protocol', label: 'Raw JSON-RPC' },
  { value: 'api', label: 'All API calls' },
];

const RELATED = [
  { label: 'MCP traffic log', to: '/monitoring/mcp-traffic' },
  { label: 'Token chain', to: '/monitoring/token-chain' },
  { label: 'Agent flow', to: '/monitoring/agent-flow' },
];

const NODE_SUBS = {
  Browser: ['This page', 'holds only a session cookie'],
  'AI agent': ['Asks the BFF to run tools', 'for you'],
  BFF: ['Holds your tokens', 'exchanges them per call'],
  PingOne: ['Issues the MCP token', '(RFC 8693 exchange)'],
  'MCP server': ['Runs the tool'],
};

const CALLS_NOTE = 'Includes calls the AI agent made in this browser tab.';
const ELICIT_ID = 'elicitation-pending';

/** Tools bucketed by `config.groupBy`, first-seen order. No groupBy: one unlabelled group. */
function groupsFor(source) {
  const key = source.config.groupBy;
  if (!key) return [{ label: null, tools: source.tools }];
  const order = [];
  const byLabel = new Map();
  for (const t of source.tools) {
    const label = t[key] || 'Other';
    if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
    byLabel.get(label).push(t);
  }
  return order.map((label) => ({ label, tools: byLabel.get(label) }));
}

const asText = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function AddServerForm({ source }) {
  const [open, setOpen] = useState(false);
  const [newProfile, setNewProfile] = useState(NEW_PROFILE_DEFAULTS);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setNewProfile((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setError(null);
    const { label, transport, url, authHeader, authValue, command, argsText } = newProfile;
    const body = { label: label.trim(), transport };
    if (transport === 'stdio') {
      if (!command.trim()) { setError('Command is required.'); return; }
      body.command = command.trim();
      body.args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
    } else {
      if (!url.trim()) { setError('Server URL is required.'); return; }
      body.url = url.trim();
      if (authHeader.trim() && authValue.trim()) {
        body.authHeader = authHeader.trim();
        body.authValue = authValue.trim();
      }
    }
    setBusy(true);
    try {
      const { data } = await apiClient.post('/api/mcp/inspector/profiles', body);
      await source.loadProfiles(data.profile.id);
      setOpen(false);
      setNewProfile(NEW_PROFILE_DEFAULTS);
    } catch (e) {
      setError(formatAxiosError(e, 'Failed to add server'));
    } finally {
      setBusy(false);
    }
  };

  const field = (label, input) => <label className="insp-field"><span>{label}</span>{input}</label>;
  return (
    <>
      <button type="button" className="insp-btn ghost" onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel' : '+ Add server'}
      </button>
      {open && (
        <div className="insp-send-row" style={{ flex: '1 1 100%' }}>
          {field('Label', <input type="text" value={newProfile.label} onChange={set('label')} placeholder="e.g. Staging MCP server" />)}
          {field('Transport', (
            <select value={newProfile.transport} onChange={set('transport')}>
              <option value="http">http</option>
              <option value="websocket">websocket</option>
              <option value="stdio">stdio</option>
            </select>
          ))}
          {newProfile.transport === 'stdio' ? (
            <>
              {field('Command', <input type="text" value={newProfile.command} onChange={set('command')} placeholder="node" />)}
              {field('Args', <input type="text" value={newProfile.argsText} onChange={set('argsText')} placeholder="server.js --stdio" />)}
            </>
          ) : (
            <>
              {field('Server URL', <input type="text" value={newProfile.url} onChange={set('url')} placeholder="https://example.test/mcp" />)}
              {field('Auth header', <input type="text" value={newProfile.authHeader} onChange={set('authHeader')} placeholder="Authorization" />)}
              {field('Auth value', <input type="password" value={newProfile.authValue} onChange={set('authValue')} placeholder="Bearer ..." />)}
            </>
          )}
          <button type="button" className="insp-btn" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
          {error && <div className="insp-err">{error}</div>}
        </div>
      )}
    </>
  );
}

function McpInspectorPageClean() {
  const { darkMode } = useThemeOptional();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('source');
  const activeSource = SOURCES.some((s) => s.value === requested) ? requested : 'banking';
  const { registerFields, getMatchingFields } = useInspectorFields();
  const source = useInspectorSource(activeSource);
  const isCalls = source.mode === 'calls';
  const isMethod = source.config.paramsKey === 'method';
  const toolKey = source.config.toolKey;
  const sendRef = useRef(null);

  // null = follow the newest call; set when the user picks a row.
  const [pickedId, setPickedId] = useState(null);

  // Smart field propagation: publish this page's last result for other inspectors.
  useEffect(() => {
    const result = source.lastInvoke?.result ?? source.lastInvoke;
    if (result && typeof result === 'object') registerFields(`mcp-${activeSource}`, result);
  }, [source.lastInvoke, activeSource, registerFields]);

  // Auto-populate parameters from other inspector results.
  useEffect(() => {
    if (!source.selectedTool) return;
    const paramNames = source.selectedTool.parameters ? Object.keys(source.selectedTool.parameters) : [];
    const matches = getMatchingFields(paramNames);
    Object.entries(matches).forEach(([key, value]) => {
      if (!source.paramValues?.[key]) source.setParamValues((prev) => ({ ...prev, [key]: String(value) }));
    });
  }, [source.selectedTool, getMatchingFields, source.paramValues, source.setParamValues]);

  const pending = source.pendingElicitation;
  const calls = useMemo(() => {
    const base = isCalls
      ? source.tools.map((t) => apiCallFromTracker(t._call))
      : source.mcpHistory.map(mcpCallFromStore);
    // Resend/Edit need a tool this source still lists; otherwise the call carries no input.
    const resendable = base.map((c) => {
      if (!c.input || source.tools.some((x) => x[toolKey] === c.input.tool)) return c;
      const { input: _drop, ...rest } = c;
      return rest;
    });
    if (!pending) return resendable;
    const elicitation = {
      id: ELICIT_ID,
      at: Date.now(),
      kind: 'mcp',
      title: source.selectedTool?.[toolKey] ?? 'tools/call',
      src: 'you',
      ms: null,
      status: warn('Waiting for you'),
      chips: [],
      banner: {
        tone: 'warn',
        testId: 'elicitation-card',
        title: 'The MCP server is asking you to confirm (elicitation/create)',
        text: pending.message,
        actions: [
          { label: 'Confirm', onClick: () => source.answerElicitation('accept', { confirm: true }) },
          { label: 'Decline', onClick: () => source.answerElicitation('decline') },
        ],
      },
      corr: null,
      request: { label: 'Tool call', body: {} },
      response: { label: 'Waiting', body: null },
      tokens: [],
      hops: [{ dir: 'Browser → BFF', call: 'tools/call', what: 'Waiting for your answer to the MCP server.', status: warn('paused'), ms: null, request: null, response: null }],
      steps: [{ title: 'The MCP server asked you to confirm', status: warn('Waiting for you'), text: 'The tools/call is paused until you answer.' }],
    };
    return [elicitation, ...resendable];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCalls, source.tools, source.mcpHistory, pending, source.selectedTool, toolKey]);

  const selectedId = pending ? ELICIT_ID : pickedId ?? calls[0]?.id ?? null;

  // The tool and string-valued params a past call was sent with, or null when
  // this source no longer lists the tool.
  const inputOf = useCallback((call) => {
    const { tool, params } = call.input || {};
    const t = source.tools.find((x) => x[toolKey] === tool);
    if (!t) return null;
    return { tool: t, params: Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, asText(v)])) };
  }, [source.tools, toolKey]);

  const loadInput = useCallback((input) => {
    source.setSelectedTool(input.tool);
    source.setParamValues(input.params);
  }, [source]);

  const onEdit = useCallback((call) => {
    const input = inputOf(call);
    if (!input) return;
    loadInput(input);
    sendRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [inputOf, loadInput]);

  const onResend = useCallback(async (call) => {
    const input = inputOf(call);
    if (!input) return;
    loadInput(input);
    await source.handleExecute(input);
    setPickedId(null);
  }, [inputOf, loadInput, source]);

  const send = useCallback(async () => {
    await source.handleExecute();
    setPickedId(null);
  }, [source]);

  const toolsSource = source.toolsSource;
  const mode = source.toolsBanner ? err('Unavailable') : source.loadingTools ? idle('Loading') : toolsSource === 'local_catalog' ? warn('Local fallback') : ok('Live');

  const tool = source.selectedTool;
  const matches = tool ? getMatchingFields(Object.keys(source.schemaProps)) : {};
  const scopes = tool?.requiredScopes || [];

  const sendCard = isCalls ? null : (
    <div className="insp-send-body" ref={sendRef}>
      {source.banner && (
        <div className="insp-banner err" role="status">
          <p>{source.banner.message}</p>
          <div className="insp-actions">
            {source.banner.loginUrl && <a className="insp-btn ghost" href={source.banner.loginUrl}>Sign in</a>}
            <button type="button" className="insp-btn ghost" onClick={source.loadTools}>Retry</button>
          </div>
        </div>
      )}
      <div className="insp-send-row">
        {source.mode === 'profiles' && source.profiles.length > 0 && (
          <label className="insp-field">
            <span>Server profile</span>
            <select value={source.selectedProfileId} onChange={(e) => source.setSelectedProfileId(e.target.value)}>
              {source.profiles.map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
            </select>
          </label>
        )}
        {source.mode === 'profiles' && source.profiles.length > 0 && <AddServerForm source={source} />}
        <label className="insp-field">
          <span>{isMethod ? 'Method' : 'Tool'}</span>
          <select
            value={tool ? String(source.tools.indexOf(tool)) : ''}
            disabled={source.loadingTools}
            onChange={(e) => {
              source.setSelectedTool(e.target.value === '' ? null : source.tools[Number(e.target.value)]);
              source.setParamValues({});
            }}
          >
            <option value="">{source.loadingTools ? 'Loading…' : `Select a ${isMethod ? 'method' : 'tool'}`}</option>
            {groupsFor(source).map(({ label, tools }) => {
              const opts = tools.map((t) => <option key={source.tools.indexOf(t)} value={String(source.tools.indexOf(t))}>{t[toolKey]}</option>);
              return label ? <optgroup key={label} label={label}>{opts}</optgroup> : opts;
            })}
          </select>
        </label>
        {tool && Object.entries(source.schemaProps).map(([key, schema]) => (
          <label key={key} className="insp-field">
            <span>{key}{source.requiredParams.has(key) ? ' *' : ''}</span>
            <input
              type="text"
              placeholder={schema?.description || schema?.type || 'value'}
              value={source.paramValues[key] || ''}
              onChange={(e) => source.setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
            />
            {matches[key] != null && source.paramValues[key] === String(matches[key]) && (
              <small>Filled from an earlier result</small>
            )}
          </label>
        ))}
        <button type="button" className="insp-btn" onClick={send} disabled={source.busy || !tool}>
          {source.busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {source.servers.length > 0 && (
        <div className="insp-chips">
          {source.servers.map((s) => (
            <span key={s.key}>{s.label} <Chip chip={s.error ? err(s.error) : ok(`${s.count} tools`)} /></span>
          ))}
        </div>
      )}
      {tool && (
        <p className="insp-toolinfo">
          {tool.description}
          {scopes.map((s) => <Chip key={s} chip={idle('needs ' + s)} />)}
        </p>
      )}
      {tool && (tool.inputSchema || tool.schema) && (
        <details>
          <summary>Input schema</summary>
          <pre className={`insp-json${darkMode ? ' jh-dark' : ''}`}><JsonHighlight value={tool.inputSchema || tool.schema} deep copyable /></pre>
        </details>
      )}
      {source.tools.length > 0 && (
        <details>
          <summary>{`Browse all ${source.tools.length} tools`}</summary>
          <ul className="insp-browse">
            {source.tools.map((t, i) => (
              <li key={i}>
                <strong className="mono">{t[toolKey]}</strong>
                {t.description && <span>{t.description}</span>}
                {(t.requiredScopes || []).map((s) => <Chip key={s} chip={idle(s)} />)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );

  return (
    <InspectorLayout
      eyebrow="PingOne MCP · Inspector"
      title="MCP Inspector"
      lede="Every MCP tool call in one place: what was sent, what came back, the tokens it carried, and the API calls behind it."
      related={RELATED}
      mode={mode}
      source={{
        label: 'Server',
        value: activeSource,
        options: SOURCES,
        onChange: (v) => { setPickedId(null); setSearchParams({ source: v }); },
      }}
      send={sendCard}
      calls={calls}
      callsNote={CALLS_NOTE}
      selectedId={selectedId}
      onSelect={setPickedId}
      onResend={onResend}
      onEdit={onEdit}
      nodeSubs={NODE_SUBS}
    />
  );
}

export default McpInspectorPageClean;
