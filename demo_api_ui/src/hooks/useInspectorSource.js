// Unified inspector source hook — abstracts Banking, PingOne, API Calls,
// Custom Server, Protocol and Gateway Showcase.
// Returns a normalized interface that McpInspectorPageClean can consume.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';

const API_CALL_POLL_MS = 3000;

const coerceParam = (raw, type) => {
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
};

// Source-specific endpoints and transformers.
//
// `mode` says which of the three shapes a source has:
//   'tools'    — pick a tool, fill params, Execute (the default)
//   'profiles' — same, but a server profile is chosen first and threaded through
//   'calls'    — a read-only log browser; nothing to execute
const SOURCE_CONFIG = {
  banking: {
    endpoint: '/api/mcp/inspector/tools',
    invokeEndpoint: '/api/mcp/inspector/invoke',
    toolKey: 'name',
    paramsKey: 'tool',
  },
  pingone: {
    endpoint: '/api/mcp/inspector/pingone-tools',
    invokeEndpoint: '/api/mcp/inspector/pingone-invoke',
    toolKey: 'name',
    paramsKey: 'tool',
  },
  // API Calls is a log of what the demo already called, not a set of things to
  // call. It reads the same capture store the old Inspector read; there is no
  // /api/mcp/inspector/api-methods behind it (that route was a permanent
  // `{ methods: [] }` stub, which is why this tab used to render empty).
  api: {
    mode: 'calls',
    endpoint: '/api/api-calls?limit=100',
    toolKey: 'label',
  },
  // Custom Server = the MCP server profiles the BFF already manages. Tools and
  // invocation go through the ordinary /tools and /invoke routes with the
  // profile threaded through — non-default profiles are admin-only there.
  custom: {
    mode: 'profiles',
    endpoint: '/api/mcp/inspector/tools',
    invokeEndpoint: '/api/mcp/inspector/invoke',
    profilesEndpoint: '/api/mcp/inspector/profiles',
    toolKey: 'name',
    paramsKey: 'tool',
  },
  // Gateway Showcase — the two third-party servers PingGateway scopes at the
  // edge, as one source. `serverKey` is what makes it different from the others:
  // each tool carries the server it came from, and invoke must send it back so
  // the BFF knows which door to knock on.
  gateway: {
    endpoint: '/api/mcp/inspector/gateway-tools',
    invokeEndpoint: '/api/mcp/inspector/gateway-invoke',
    toolKey: 'name',
    paramsKey: 'tool',
    serverKey: 'server',
    groupBy: 'serverLabel',
  },
  // The MCP methods that are not tools/call. POST /rpc already takes exactly
  // { method, params }, so `paramsKey: 'method'` needs no adapter.
  protocol: {
    endpoint: '/api/mcp/inspector/protocol-methods',
    invokeEndpoint: '/api/mcp/inspector/rpc',
    toolKey: 'method',
    paramsKey: 'method',
  },
};

// One captured API call, shaped as a selectable list entry.
const callToEntry = (call) => ({
  label: `${(call.method || 'GET').toUpperCase()} ${call.url || ''}`,
  description: `${call.response?.status ?? call.status ?? '—'} · ${call.durationMs ?? call.duration ?? '—'}ms`,
  _call: call,
});

/**
 * A source's error banner, or null. Errors arrive in three shapes across these
 * endpoints, so normalize once here rather than at each render site:
 *   { error: true, reason, loginUrl }         — PingOne
 *   { pingone_admin_login_required, loginUrl } — profile dispatch
 *   an axios rejection                         — everything else
 */
function bannerFromPayload(data) {
  if (!data || typeof data !== 'object') return null;
  const loginUrl = data.loginUrl || null;
  if (data.error === true || data.authRequired) {
    return { message: data.reason || data.message || 'Request failed.', loginUrl };
  }
  if (data.pingone_admin_login_required || data.privilege_login_required) {
    return { message: data.message || 'Sign-in required.', loginUrl };
  }
  if (data.enabled === false) {
    return { message: data.reason || 'This source is turned off.', loginUrl: null };
  }
  return null;
}

export function useInspectorSource(sourceKey) {
  const config = SOURCE_CONFIG[sourceKey];
  if (!config) throw new Error(`Unknown source: ${sourceKey}`);

  const mode = config.mode || 'tools';

  const [tools, setTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [outputTab, setOutputTab] = useState('response');
  const [busy, setBusy] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [mcpHistory, setMcpHistory] = useState(getCalls());
  const [banner, setBanner] = useState(null);
  const [servers, setServers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [defaultProfileId, setDefaultProfileId] = useState('');
  const [paramDefaults, setParamDefaults] = useState({});

  // Subscribe to call history
  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  // Custom Server: the profile list has to land before tools can be fetched.
  // Exposed as loadProfiles so the page can re-fetch after adding one (and,
  // optionally, select it) without duplicating this fetch/parse logic.
  // profilesReqRef guards against a stale response landing after a newer
  // call started (tab-switch while in flight, or a rapid add) — the same
  // protection the old effect's local `cancelled` flag gave a single fetch.
  const profilesReqRef = useRef(0);
  const loadProfiles = useCallback(async (selectId) => {
    if (mode !== 'profiles') return;
    const reqId = ++profilesReqRef.current;
    try {
      const { data } = await apiClient.get(config.profilesEndpoint);
      if (profilesReqRef.current !== reqId) return;
      setProfiles(data.profiles || []);
      setDefaultProfileId(data.defaultProfileId || '');
      setSelectedProfileId((prev) => selectId || prev || data.defaultProfileId || '');
    } catch (e) {
      if (profilesReqRef.current !== reqId) return;
      setBanner({ message: formatAxiosError(e, 'Failed to load server profiles'), loginUrl: null });
    }
  }, [mode, config.profilesEndpoint]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  // The Privilege/PingOne admin login round-trip lands back here as
  // ?profile=<id> (success) or ?profile=<id>&privilege_error=<msg> /
  // &pingone_admin_error=<msg> (failure) — see mcpPrivilegeAuth.js /
  // mcpPingOneAdminAuth.js's redirects. Without reading these, a failed
  // login is indistinguishable from never having tried: the door stays
  // unselected and the failure reason is silently dropped, so it just looks
  // like "sign in required" again with no clue why. One-time read on mount,
  // then scrub the URL so a refresh doesn't re-show a stale error.
  //
  // suppressNextBannerRef: setting selectedProfileId here immediately
  // triggers loadTools' own mount effect, which unconditionally nulls (then
  // re-sets) the banner as soon as its fetch resolves — that race would
  // erase this error before the user ever saw it. Set when there's an error
  // to report, consumed by exactly the next loadTools() call so this specific
  // race is skipped without suppressing banners for any later, real reload.
  const suppressNextBannerRef = useRef(false);
  useEffect(() => {
    if (mode !== 'profiles') return;
    const params = new URLSearchParams(window.location.search);
    const profileId = params.get('profile');
    const error = params.get('privilege_error') || params.get('pingone_admin_error');
    if (!profileId && !error) return;
    if (profileId) setSelectedProfileId(profileId);
    if (error) {
      setBanner({ message: error, loginUrl: null });
      suppressNextBannerRef.current = true;
    }
    params.delete('profile');
    params.delete('privilege_error');
    params.delete('pingone_admin_error');
    const qs = params.toString();
    window.history.replaceState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Load tools for this source
  const loadTools = useCallback(async () => {
    if (mode === 'profiles' && !selectedProfileId) return;
    const suppressBanner = suppressNextBannerRef.current;
    suppressNextBannerRef.current = false;
    setLoadingTools(true);
    if (!suppressBanner) setBanner(null);
    try {
      const url = mode === 'profiles' && selectedProfileId !== defaultProfileId
        ? `${config.endpoint}?profile=${encodeURIComponent(selectedProfileId)}`
        : config.endpoint;
      const { data } = await apiClient.get(url);

      if (mode === 'calls') {
        setTools((data.calls || []).slice().reverse().map(callToEntry));
      } else {
        setTools(data.tools || data.methods || data.items || []);
      }
      setServers(data.servers || []);
      setParamDefaults(data.paramDefaults || {});
      if (!suppressBanner) setBanner(bannerFromPayload(data));
      setSelectedTool(null);
      setLastInvoke(null);
      setParamValues({});
    } catch (e) {
      if (!suppressBanner) setBanner({
        message: formatAxiosError(e, `Failed to load ${sourceKey} tools`),
        loginUrl: e.response?.data?.loginUrl || null,
      });
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }, [sourceKey, config, mode, selectedProfileId, defaultProfileId]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  // API Calls is a live log — poll it, the way the old Inspector did. Kept in a
  // ref so the interval never restarts and never captures a stale loadTools.
  const loadToolsRef = useRef(loadTools);
  loadToolsRef.current = loadTools;
  useEffect(() => {
    if (mode !== 'calls') return undefined;
    const id = setInterval(() => loadToolsRef.current(), API_CALL_POLL_MS);
    return () => clearInterval(id);
  }, [mode]);

  const handleExecute = useCallback(async () => {
    // A captured call has already happened; there is nothing to execute.
    if (mode === 'calls' || !selectedTool) return;

    const toolKey = config.toolKey;
    const toolName = selectedTool[toolKey];
    const props = selectedTool.inputSchema?.properties || selectedTool.schema?.properties || {};
    const required = selectedTool.inputSchema?.required || selectedTool.schema?.required || [];
    const missing = required.filter((key) => !String(paramValues[key] ?? '').trim());

    if (missing.length > 0) {
      notifyError(`Required: ${missing.join(', ')}`);
      return;
    }

    setBusy(true);
    const t0 = Date.now();

    try {
      const params = {};
      for (const [key, schema] of Object.entries(props)) {
        const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
        if (coerced !== undefined) params[key] = coerced;
      }

      const payload = {
        [config.paramsKey]: toolName,
        params,
        // Multi-server sources (Gateway Showcase) must say WHICH server the
        // selected tool belongs to — the same tool name could exist on both.
        ...(config.serverKey && selectedTool[config.serverKey]
          ? { [config.serverKey]: selectedTool[config.serverKey] }
          : {}),
        // Non-default profiles dispatch to their own transport (Custom Server).
        ...(mode === 'profiles' && selectedProfileId && selectedProfileId !== defaultProfileId
          ? { profile: selectedProfileId }
          : {}),
      };

      const { data } = await apiClient.post(config.invokeEndpoint, payload);
      const ms = Date.now() - t0;

      appendMcpCall(toolName, 200, ms, data.result ?? data);
      setLastInvoke(data);
      // A 200 can still carry a refusal (PingOne auth, a gateway DENY). Surface
      // it rather than letting the Status chip claim "200 OK" over an error body.
      const payloadBanner = bannerFromPayload(data);
      setBanner(payloadBanner);
      setLastTiming({ ms, error: Boolean(payloadBanner) });
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      const failedTool = selectedTool[config.toolKey];
      appendMcpCall(failedTool, e.response?.status ?? 0, ms, null, formatAxiosError(e));
      setLastInvoke(e.response?.data || { error: formatAxiosError(e) });
      setLastTiming({ ms, error: true });
      setBanner({
        message: formatAxiosError(e, 'Invoke failed'),
        loginUrl: e.response?.data?.loginUrl || null,
      });
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues, config, mode, selectedProfileId, defaultProfileId]);

  const schemaProps = useMemo(() => {
    if (!selectedTool) return {};
    return selectedTool.inputSchema?.properties || selectedTool.schema?.properties || {};
  }, [selectedTool]);

  const requiredParams = useMemo(() => {
    if (!selectedTool) return new Set();
    return new Set(selectedTool.inputSchema?.required || selectedTool.schema?.required || []);
  }, [selectedTool]);

  // Prefill schema params the BFF already knows (PingOne hands back an
  // environmentId so nobody has to paste a UUID into every tool).
  useEffect(() => {
    if (!selectedTool) return;
    const prefill = {};
    for (const key of Object.keys(schemaProps)) {
      if (paramDefaults[key]) prefill[key] = String(paramDefaults[key]);
    }
    if (Object.keys(prefill).length > 0) {
      setParamValues((prev) => ({ ...prefill, ...prev }));
    }
  }, [selectedTool, schemaProps, paramDefaults]);

  // The raw value behind each output tab. The page stringifies for the JSON
  // view and walks the object for the Form view, so both need this un-stringified.
  const outputValue = useMemo(() => {
    if (mode === 'calls') {
      const call = selectedTool?._call;
      if (!call) return null;
      switch (outputTab) {
        case 'response': return call.response ?? null;
        case 'request': return call.request ?? null;
        case 'schema': return null;
        case 'timing': return { durationMs: call.durationMs ?? call.duration ?? null, at: call.timestamp ?? call.at ?? null };
        case 'headers': return call.request?.headers ?? call.response?.headers ?? null;
        default: return null;
      }
    }
    switch (outputTab) {
      case 'response':
        return lastInvoke ?? null;
      case 'request':
        return selectedTool ? {
          jsonrpc: '2.0',
          id: 1,
          method: config.paramsKey === 'method' ? selectedTool[config.toolKey] : 'tools/call',
          params: config.paramsKey === 'method'
            ? paramValues
            : { name: selectedTool[config.toolKey], arguments: paramValues },
        } : null;
      case 'schema':
        return selectedTool?.inputSchema || selectedTool?.schema || null;
      case 'timing':
        return lastTiming ? { durationMs: lastTiming.ms, error: lastTiming.error } : null;
      case 'headers':
        return { 'Protocol-Version': '2.0', Transport: 'WebSocket JSON-RPC' };
      default:
        return null;
    }
  }, [mode, outputTab, lastInvoke, selectedTool, paramValues, lastTiming, config]);

  const outputContent = useMemo(
    () => (outputValue === null || outputValue === undefined ? null : JSON.stringify(outputValue, null, 2)),
    [outputValue],
  );

  return {
    // Data
    tools,
    selectedTool,
    paramValues,
    outputTab,
    busy,
    loadingTools,
    lastInvoke,
    lastTiming,
    mcpHistory,
    schemaProps,
    requiredParams,
    outputContent,
    outputValue,
    banner,
    servers,
    profiles,
    selectedProfileId,
    defaultProfileId,
    mode,
    config,

    // Actions
    setSelectedTool,
    setParamValues,
    setOutputTab,
    setSelectedProfileId,
    handleExecute,
    loadTools,
    loadProfiles,
  };
}
