// Agent Gateway Inspector, built on the shared inspector layout (Task 8).
// Shows real gateway traffic: calls sent from this page plus every decision the gateway reported.
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import apiClient from '../services/apiClient';
import { formatAxiosError } from '../utils/formatAxiosError';
import { extractCapturedValues, unwrapMcpResult } from './AgentGatewayTester';
import { TOOL_ATTACKS } from '../config/toolAttackCatalog';
import InspectorLayout from './inspector/InspectorLayout';
import { ok, warn, err, idle } from './inspector/inspectorCalls';
import {
  gatewayCallFromTest, gatewayCallsFromBurst, gatewayCallFromRecord, dedupeGatewayCalls, logLinesFor,
} from './inspector/gatewayCalls';

const POLL_MS = 5000;
const CHAIN_STEPS = ['get_my_accounts', 'get_account_balance', 'get_sensitive_account_details'];
const CHAIN = 'chain';
const CUSTOM = 'custom';
const NEEDS_ACCOUNT_HINT = 'Run "Read accounts" first to fill account_id.';

/** First account id in a get_my_accounts result body, parsed the way the Tester does. */
const accountIdOf = (body) => extractCapturedValues('get_my_accounts', unwrapMcpResult(body)).find((c) => c.family === 'account')?.value ?? '';

const RELATED = [
  { label: 'Gateway tester', to: '/agent-gateway-capabilities' },
  { label: 'Gateway config', to: '/configure?tab=mcp-gateway' },
];

const NODE_SUBS = {
  'AI agent': ['Calls the gateway', 'with a delegated token'],
  BFF: ['Calls the gateway', 'for this page'],
  Gateway: ['PingOne Agent Gateway', 'filters every MCP call'],
  PingOne: ['Introspects the token', '(RFC 7662)'],
  'PingOne Authorize': ['Decides per tool call'],
  'MCP server': ['Runs the tool'],
};

const SOURCES = [
  { value: 'ping', label: 'PingOne Agent Gateway' },
  { value: 'node', label: 'Demo MCP Gateway (Node)' },
];

const SCENARIOS = [
  { id: CUSTOM, label: 'Custom' },
  { id: 'read', label: 'Read accounts (expect PERMIT)', tool: 'get_my_accounts', args: {} },
  { id: 'sensitive', label: 'Sensitive read (expect DENY)', tool: 'get_sensitive_account_details', args: { account_id: '' } },
  { id: 'withdrawal', label: 'Withdrawal (expect approval)', tool: 'create_withdrawal', args: { account_id: '', amount: 500 } },
  { id: CHAIN, label: 'Run chain: accounts → balance → sensitive', tool: CHAIN_STEPS[0], args: {} },
  ...TOOL_ATTACKS.map((a) => ({ id: 'attack:' + a.id, label: 'Attack library: ' + a.label, tool: a.tool, args: a.args })),
];

const CALLS_NOTE = 'Includes every call the gateway reported, from you and from agents.';

function parseArgs(text) {
  try {
    const v = text.trim() ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? { args: v } : { error: true };
  } catch {
    return { error: true };
  }
}

/** The gateway's own body when the request failed with one, else a synthetic failure. */
function failureBody(e) {
  const d = e.response?.data;
  if (d && typeof d === 'object' && 'ok' in d) return d;
  return { ok: false, error: formatAxiosError(e, 'Request failed'), httpStatus: e.response?.status, message: formatAxiosError(e, 'Request failed') };
}

export default function AgentGatewayInspectorClean() {
  const [active, setActive] = useState(null);
  // 'loading' until /active answers; 'down' if it fails or the user is signed out.
  const [gwState, setGwState] = useState('loading');
  const [tools, setTools] = useState([]);
  const [records, setRecords] = useState([]);
  const [testCalls, setTestCalls] = useState([]);
  const [logsById, setLogsById] = useState({});
  const [pickedId, setPickedId] = useState(null);
  const [scenario, setScenario] = useState(CUSTOM);
  const [tool, setTool] = useState('get_my_accounts');
  const [argsText, setArgsText] = useState('{}');
  const [repeat, setRepeat] = useState(1);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const sendRef = useRef(null);
  const recordCache = useRef(new Map());
  const logCache = useRef(new Map());

  const signedOut = useRef(false);
  // _noAuthBanner: the Unavailable chip answers a 401 here, not the global sign-in modal.
  const fetchActive = useCallback(async () => {
    try {
      setActive((await apiClient.get('/api/mcp-gateway/active', { _noAuthBanner: true })).data);
      setGwState(signedOut.current ? 'down' : 'ready');
    } catch (e) {
      if (e.response?.status === 401) signedOut.current = true;
      setGwState('down');
    }
  }, []);
  const fetchRecords = useCallback(async () => {
    if (signedOut.current) return;
    try {
      const { data } = await apiClient.get('/api/admin/agent-gateway/decisions', { params: { limit: 50 }, _noAuthBanner: true });
      setRecords(data.decisions || []);
    } catch (e) {
      if (e.response?.status === 401) { signedOut.current = true; setGwState('down'); }
    }
  }, []);

  useEffect(() => {
    fetchActive();
    apiClient.get('/api/mcp/inspector/tools').then(({ data }) => setTools(data.tools || [])).catch(() => {});
    fetchRecords();
    const id = setInterval(() => { if (document.visibilityState === 'visible') fetchRecords(); }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchActive, fetchRecords]);

  // Keep call identity stable across polls so the diagram memo does not reset.
  const recordCalls = useMemo(() => {
    const next = new Map();
    const out = records.map((r) => {
      const id = `gw-rec-${r.ts}-${r.tool}-${r.correlationId}`;
      const hit = recordCache.current.get(id);
      const call = hit?.rec === r ? hit.call : gatewayCallFromRecord(r);
      next.set(id, { rec: r, call });
      return call;
    });
    recordCache.current = next;
    return out;
  }, [records]);

  const calls = useMemo(() => {
    const next = new Map();
    const out = dedupeGatewayCalls(testCalls, recordCalls).map((c) => {
      const lines = logsById[c.id];
      if (!lines) return c;
      const hit = logCache.current.get(c.id);
      const withLogs = hit?.base === c && hit.lines === lines ? hit.out : { ...c, logs: lines };
      next.set(c.id, { base: c, lines, out: withLogs });
      return withLogs;
    });
    logCache.current = next;
    return out;
  }, [testCalls, recordCalls, logsById]);

  const selectedId = pickedId ?? calls[0]?.id ?? null;
  const selected = calls.find((c) => c.id === selectedId);

  // Gateway log lines for the selected call.
  const selTitle = selected?.title;
  const selKey = selected?.id;
  const selRef = useRef(selected);
  selRef.current = selected;
  useEffect(() => {
    if (!selKey) return undefined;
    let live = true;
    apiClient.get('/api/admin/agent-gateway/logs', { params: { tail: 200, filter: selTitle } })
      .then(({ data }) => {
        if (live && data.ok) setLogsById((m) => ({ ...m, [selKey]: logLinesFor(selRef.current, data.lines || []) }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [selKey, selTitle]);

  const pickScenario = (id) => {
    setScenario(id);
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s?.tool) return;
    let args = s.args ?? {};
    if ('account_id' in args) {
      const known = calls.filter((c) => c.title === 'get_my_accounts' && c.status.tone === 'ok').map((c) => accountIdOf(c.response.body)).find(Boolean) ?? '';
      args = { ...args, account_id: known };
      setHint(known ? '' : NEEDS_ACCOUNT_HINT);
    } else setHint('');
    setTool(s.tool);
    setArgsText(JSON.stringify(args, null, 2));
  };

  const callOnce = useCallback(async (t, args) => {
    const at = Date.now();
    let res;
    try { res = (await apiClient.post('/api/mcp-gateway/test', { tool: t, args })).data; } catch (e) { res = failureBody(e); }
    return gatewayCallFromTest(res, { tool: t, args, gatewayUrl: active?.url, at });
  }, [active]);

  const run = useCallback(async (t, args, count = 1, chain = false) => {
    setBusy(true);
    setHint('');
    try {
      let made;
      if (chain) {
        made = [];
        let account_id = '';
        for (const step of CHAIN_STEPS) {
          const call = await callOnce(step, step === CHAIN_STEPS[0] ? {} : { account_id });
          made.push(call);
          if (step === CHAIN_STEPS[0]) account_id = accountIdOf(call.response.body);
        }
        if (!account_id) setHint(NEEDS_ACCOUNT_HINT);
      } else if (count > 1) {
        const at = Date.now();
        let res;
        try { res = (await apiClient.post('/api/mcp-gateway/test/burst', { tool: t, args, count })).data; } catch (e) { res = { results: [{ index: 0, ...failureBody(e) }] }; }
        made = gatewayCallsFromBurst(res, { tool: t, args, at });
      } else {
        made = [await callOnce(t, args)];
      }
      setTestCalls((cs) => [...made, ...cs]);
      setPickedId(null);
      await fetchRecords();
    } finally {
      setBusy(false);
    }
  }, [callOnce, fetchRecords]);

  const parsed = parseArgs(argsText);
  const send = () => run(tool, parsed.args, Number(repeat) || 1, scenario === CHAIN);

  const onResend = useCallback((call) => run(call.input.tool, call.input.args), [run]);
  const onEdit = useCallback((call) => {
    setScenario(CUSTOM);
    setTool(call.input.tool);
    setArgsText(JSON.stringify(call.input.args ?? {}, null, 2));
    sendRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  const patchFlag = async (flag, value) => {
    setHint('');
    try {
      await apiClient.patch('/api/admin/feature-flags', { updates: { [flag]: value } });
      await fetchActive();
    } catch (e) {
      setHint(formatAxiosError(e, 'Could not change the setting'));
    }
  };

  const toolNames = tools.map((t) => t.name);
  if (tool && !toolNames.includes(tool)) toolNames.push(tool);

  const sendCard = (
    <div className="insp-send-body" ref={sendRef}>
      <div className="insp-send-row">
        <label className="insp-field">
          <span>Scenario</span>
          <select value={scenario} onChange={(e) => pickScenario(e.target.value)}>
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="insp-field">
          <span>Tool</span>
          <select value={tool} onChange={(e) => { setTool(e.target.value); setScenario(CUSTOM); }}>
            {toolNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="insp-field">
          <span>Arguments (JSON)</span>
          <textarea rows={3} spellCheck={false} value={argsText} onChange={(e) => { setArgsText(e.target.value); setScenario(CUSTOM); }} />
          {parsed.error && <small className="insp-err">Invalid JSON</small>}
        </label>
        <label className="insp-field">
          <span>Repeat</span>
          <input type="number" min={1} max={20} value={repeat} onChange={(e) => setRepeat(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" className="insp-btn" onClick={send} disabled={busy || !!parsed.error}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
      {hint && <p className="insp-err" role="status">{hint}</p>}
    </div>
  );

  const heroExtra = active && (
    <>
      <span id="insp-authz">Authz</span>
      <div className="insp-seg" role="group" aria-labelledby="insp-authz">
        <button type="button" aria-pressed={!active.simulated} onClick={() => patchFlag('ff_authorize_real', true)}>Real</button>
        <button type="button" aria-pressed={!!active.simulated} onClick={() => patchFlag('ff_authorize_real', false)}>Simulated</button>
      </div>
    </>
  );

  return (
    <InspectorLayout
      eyebrow="PingOne Agent Gateway · Inspector"
      title="Agent Gateway Inspector"
      lede="Every tool call that went through the gateway: the request and response, the token it checked, each filter it passed, and each API call the gateway made."
      related={RELATED}
      mode={gwState === 'loading' ? idle('Loading') : gwState === 'down' ? err('Unavailable') : active?.simulated ? warn('Simulated authz') : ok('Live')}
      source={{
        label: 'Gateway',
        value: active?.usePingGateway === false ? 'node' : 'ping',
        options: SOURCES,
        disabled: !active,
        onChange: (v) => patchFlag('ff_mcp_gateway_pinggateway', v === 'ping'),
      }}
      heroExtra={heroExtra}
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
