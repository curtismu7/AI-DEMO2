// Agent Gateway Inspector, built on the shared inspector layout (Task 8).
// Shows real gateway traffic: calls sent from this page plus every decision the gateway reported.
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import apiClient from '../services/apiClient';
import { formatAxiosError } from '../utils/formatAxiosError';
import { extractCapturedValues, unwrapMcpResult } from './AgentGatewayTester';
import { TOOL_ATTACKS } from '../config/toolAttackCatalog';
import { argsFor, belongsElsewhere, toolsFor } from '../config/inspectorVerticals';
import InspectorLayout from './inspector/InspectorLayout';
import { useInspectorVertical } from './inspector/useInspectorVertical';
import { ok, warn, err, idle } from './inspector/inspectorCalls';
import {
  gatewayCallFromTest, gatewayCallsFromBurst, gatewayCallFromRecord, dedupeGatewayCalls, logLinesFor,
} from './inspector/gatewayCalls';

const POLL_MS = 5000;
const CUSTOM = 'custom';

/** The id a capture step's result carries (e.g. the first account id), parsed the way the Tester does. */
const capturedId = (cap, body) => extractCapturedValues(cap.tool, unwrapMcpResult(body)).find((c) => c.family === cap.family)?.value ?? '';
/** A sample's empty args are the ids a capture fills. */
const needsId = (args) => Object.values(args).includes('');
const fillIds = (args, id) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v === '' ? id : v]));

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

/** The vertical's scenarios, then the attack-library entries that use its tools. */
const scenariosFor = (v) => [
  { id: CUSTOM, label: 'Custom' },
  ...v.scenarios,
  ...TOOL_ATTACKS.filter((a) => v.tools.includes(a.tool)).map((a) => ({ id: 'attack:' + a.id, label: 'Attack library: ' + a.label, tool: a.tool, args: a.args })),
];

const argsJson = (v, tool) => JSON.stringify(argsFor(v, tool), null, 2);

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
  const message = d?.message || d?.error || formatAxiosError(e, 'Request failed');
  return { ok: false, error: d?.error || message, httpStatus: e.response?.status, message };
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
  // A vertical change starts over on that vertical's read tool.
  const { id: verticalId, vertical, field: verticalField } = useInspectorVertical((v) => {
    setScenario(CUSTOM);
    setTool(v.scenarios[0].tool);
    setArgsText(argsJson(v, v.scenarios[0].tool));
    setHint('');
  });
  const scenarios = useMemo(() => scenariosFor(vertical), [vertical]);
  const [tool, setTool] = useState(() => vertical.scenarios[0].tool);
  const [argsText, setArgsText] = useState(() => argsJson(vertical, vertical.scenarios[0].tool));
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
    const s = scenarios.find((x) => x.id === id);
    const first = s?.steps?.[0] ?? s;
    if (!first?.tool) return;
    let args = first.args ?? {};
    const cap = vertical.capture;
    if (cap && needsId(args)) {
      const known = calls.filter((c) => c.title === cap.tool && c.status.tone === 'ok').map((c) => capturedId(cap, c.response.body)).find(Boolean) ?? '';
      args = fillIds(args, known);
      setHint(known ? '' : cap.hint);
    } else setHint('');
    setTool(first.tool);
    setArgsText(JSON.stringify(args, null, 2));
  };

  const callOnce = useCallback(async (t, args) => {
    const at = Date.now();
    let res;
    // _noAuthBanner: a 401 here is the gateway refusing the token, not a signed-out user.
    try { res = (await apiClient.post('/api/mcp-gateway/test', { tool: t, args }, { _noAuthBanner: true })).data; } catch (e) { res = failureBody(e); setHint(res.message); }
    return gatewayCallFromTest(res, { tool: t, args, gatewayUrl: active?.url, at });
  }, [active]);

  // chain: { steps, capture } — later steps' empty args get the id step 1 returned.
  const run = useCallback(async (t, args, count = 1, chain = null) => {
    setBusy(true);
    setHint('');
    try {
      let made;
      if (chain) {
        made = [];
        const cap = chain.capture;
        let id = '';
        for (const [i, step] of chain.steps.entries()) {
          const call = await callOnce(step.tool, cap ? fillIds(step.args, id) : step.args);
          made.push(call);
          if (i === 0 && cap) id = capturedId(cap, call.response.body);
        }
        if (cap && !id) setHint(cap.hint);
      } else if (count > 1) {
        const at = Date.now();
        let res;
        try { res = (await apiClient.post('/api/mcp-gateway/test/burst', { tool: t, args, count }, { _noAuthBanner: true })).data; } catch (e) { const f = failureBody(e); res = { results: [{ index: 0, ...f }] }; setHint(f.message); }
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
  const steps = scenarios.find((s) => s.id === scenario)?.steps;
  const send = () => run(tool, parsed.args, Number(repeat) || 1, steps ? { steps, capture: vertical.capture } : null);

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

  // The vertical's tools and the global ones, plus the server's tools no other vertical owns.
  const toolNames = [...new Set([...toolsFor(vertical), ...tools.map((t) => t.name).filter((n) => !belongsElsewhere(verticalId, n))])];
  if (tool && !toolNames.includes(tool)) toolNames.push(tool);

  const sendCard = (
    <div className="insp-send-body" ref={sendRef}>
      <div className="insp-send-row">
        {verticalField}
        <label className="insp-field">
          <span>Scenario</span>
          <select value={scenario} onChange={(e) => pickScenario(e.target.value)}>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
