/**
 * Adapters: MCP call-store entries and API-traffic entries -> InspectorCall.
 * Pure functions only.
 */
import { ok, err, idle, tokensFromEvents, stepsFromTokenEvents } from './inspectorCalls';

const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean);

function scopeStep(required, exchanged) {
  const have = words(exchanged.claims?.scope);
  const missing = required.filter((s) => !have.includes(s));
  return {
    title: "Compared the tool's required scopes with the token",
    status: missing.length ? err('missing ' + missing.join(', ')) : ok('has them'),
    text: `The tool needs ${required.join(', ')}; the exchanged token carries ${have.join(', ') || 'no scopes'}.`,
  };
}

function toolStep(frames, errorMsg) {
  const e = frames?.response?.error;
  if (e) return { title: 'Ran the tool', status: err(`${e.code ?? 'error'} ${e.message ?? ''}`.trim()), text: e.message ?? 'The MCP server returned a JSON-RPC error.' };
  if (errorMsg) return { title: 'Ran the tool', status: err('failed'), text: errorMsg };
  return { title: 'Ran the tool', status: ok('done'), text: 'The MCP server ran the tool and returned a result.' };
}

/** A 200 can still carry a refusal: gateway showcase DENY, PingOne `error: true`, rsFilter 401. */
function refusalOf(b) {
  if (!b || typeof b !== 'object') return null;
  const code = Number(b.status);
  const strErr = typeof b.error === 'string' && b.error !== '';
  if (!b.denied && b.error !== true && !strErr && !(code >= 400)) return null;
  const text = [b.message, b.error, b.reason].find((x) => typeof x === 'string' && x) ?? `HTTP ${b.status ?? 200} refusal`;
  return { label: code >= 400 ? String(code) : b.denied ? 'Denied' : 'Error', text };
}

/** @returns {import('./inspectorCalls').InspectorCall} */
export function mcpCallFromStore(entry) {
  const d = entry.detail ?? {};
  const src = d.src ?? 'agent';
  const frames = d.frames;
  const tokenEvents = d.tokenEvents ?? [];
  const body = d.response ?? {};
  const insp = body.inspector ?? {};
  const required = insp.requiredScopesHint ?? body.requiredScopesHint;
  const exchanged = tokenEvents.find((e) => e.id === 'exchanged-token');
  const httpOk = entry.status >= 200 && entry.status < 300;
  const refusal = httpOk ? refusalOf(d.response) : null;
  const errorMsg = entry.errorMsg ?? refusal?.text ?? null;
  const okStatus = httpOk && !refusal;

  const hops = [{
    dir: src === 'you' ? 'Browser → BFF' : 'AI agent → BFF',
    call: src === 'you' ? 'POST /api/mcp/inspector/invoke' : 'POST /api/mcp/tool',
    what: src === 'you' ? 'You sent the tool call to the backend.' : 'The AI agent sent its chosen tool to the backend.',
    status: okStatus ? ok(String(entry.status)) : err(refusal?.label ?? String(entry.status || 'network')),
    ms: entry.duration ?? null,
    request: d.params ?? {},
    response: entry.result ?? { error: entry.errorMsg },
  }];
  if (exchanged) {
    hops.push({
      dir: 'BFF → PingOne',
      call: 'POST /as/token (token exchange)',
      what: 'The backend swapped your token for one scoped to the MCP server.',
      status: ok('exchanged'),
      ms: null,
      request: { grant_type: GRANT, audience: [].concat(exchanged.claims?.aud ?? []), scope: exchanged.claims?.scope },
      response: exchanged.claims,
    });
  }
  if (frames?.initializeRequest) {
    hops.push({ dir: 'BFF → MCP server', call: 'initialize', what: 'Opened the MCP session.', status: ok('ok'), ms: null, request: frames.initializeRequest, response: frames.initializeResponse });
  }
  if (frames?.request) {
    hops.push({ dir: 'BFF → MCP server', call: 'tools/call', what: 'Asked the MCP server to run the tool.', status: frames.response?.error ? err('error') : ok('ok'), ms: null, request: frames.request, response: frames.response });
  }

  const steps = [{
    title: src === 'you' ? 'You sent the call' : 'The AI agent picked a tool',
    status: idle('start'),
    text: src === 'you' ? `You ran ${entry.tool} from the inspector.` : `The agent chose ${entry.tool}${d.question ? ` for: ${d.question}` : ''}.`,
  }, ...stepsFromTokenEvents(tokenEvents)];
  if (required && exchanged) steps.push(scopeStep(required, exchanged));
  const init = frames?.initializeResponse?.result;
  if (init) {
    steps.push({ title: 'Opened the MCP session', status: ok('open'), text: `${init.serverInfo?.name ?? 'MCP server'}, protocol ${init.protocolVersion ?? 'unknown'}.` });
  }
  steps.push(toolStep(frames, errorMsg));

  const chips = [];
  if (insp.tokenExchangeApplied) chips.push(idle('Token exchange applied'));
  if (body._localFallback) chips.push(idle('Local handler, no MCP server'));

  return {
    id: `mcp-${entry.id}`,
    at: Date.parse(entry.timestamp),
    kind: 'mcp',
    title: entry.tool,
    src,
    ms: entry.duration ?? null,
    status: okStatus ? ok(`${entry.status} OK`) : err(refusal?.label ?? String(entry.status || 'network')),
    chips,
    banner: okStatus ? null : { tone: 'err', title: 'Call failed', text: errorMsg ?? `HTTP ${entry.status}` },
    corr: null,
    request: frames?.request
      ? { label: 'JSON-RPC request', where: 'BFF → MCP server', body: frames.request }
      : { label: 'Tool arguments', body: d.params ?? {} },
    response: frames?.response
      ? { label: 'JSON-RPC response', where: 'MCP server → BFF', body: frames.response }
      : { label: 'Result', body: entry.result ?? { error: entry.errorMsg } },
    tokens: tokensFromEvents(tokenEvents),
    hops,
    steps,
    input: { tool: entry.tool, params: d.params },
  };
}

/** @returns {import('./inspectorCalls').InspectorCall} */
export function apiCallFromTracker(call) {
  const title = `${call.method} ${call.url}`;
  const code = call.response?.status;
  const status = code >= 200 && code < 400 ? ok(String(code)) : err(String(code || 'network'));
  const req = call.request?.body ?? null;
  const res = call.response?.body ?? null;
  return {
    id: `api-${call.id}`,
    at: Date.parse(call.timestamp),
    kind: 'api',
    title,
    src: 'you',
    ms: call.duration ?? null,
    status,
    chips: [],
    banner: null,
    corr: null,
    request: { label: 'Request', body: req ?? {} },
    response: { label: 'Response', body: res },
    tokens: [],
    hops: [{ dir: 'Browser → BFF', call: title, what: 'The page called the backend API.', status, ms: call.duration ?? null, request: req, response: res }],
    steps: [{ title: 'Called the API', status, text: title }],
  };
}
