/**
 * Adapters: Agent Gateway test results, burst results and decision-buffer records -> InspectorCall.
 * Pure functions only.
 */
import { ok, warn, err, idle, tokensFromEvents } from './inspectorCalls';
import { isPause } from '../../services/tokenChainTrace/pauseObligation';

const GW = 'Gateway';
const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const stmtName = (s) => (typeof s === 'string' ? s : s?.name ?? s?.code ?? '');
const namesOf = (statements) => (Array.isArray(statements) ? statements.map(stmtName).filter(Boolean) : []);
const kv = (obj) => Object.entries(obj).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, str(v)]);

let seq = 0;

function statusOf({ rateLimited, ok: isOk, decision, httpStatus, paused }) {
  if (rateLimited) return warn('429 Rate limited');
  if (decision === 'DENY') return err('DENY');
  if (decision === 'PERMIT' && paused) return warn('PAUSE · approval');
  if (decision === 'PERMIT') return ok('PERMIT');
  if (isOk === false) return err(String(httpStatus || 'Error'));
  return decision ? idle(decision) : ok('OK');
}

function claimsOf(jwt) {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

function sentView(raw) {
  return { label: 'Token sent to the gateway', role: 'The delegated token the BFF presented to the gateway.', alg: null, rfc: null, status: ok('Sent'), claims: claimsOf(raw), hidden: [], header: null, raw };
}

function claimsView(introspection) {
  const { email, ...claims } = introspection;
  return {
    label: 'Token as the gateway saw it',
    role: 'What introspection returned to the gateway. This is what the policy saw.',
    alg: null,
    rfc: 'RFC 7662',
    status: introspection.active === false ? err('Inactive') : ok('Active'),
    claims,
    hidden: email ? ['email'] : [],
    header: null,
  };
}

const FILTER_TEXT = {
  McpValidationFilter: () => 'The request is a valid MCP JSON-RPC call.',
  McpAuditFilter: () => 'Written to the MCP audit log. The 5W1H record is below.',
  McpProtectionFilter: () => 'Rate limit and size checks.',
  TokenIntrospection: (c) => `Token is active. sub ${c.intro.sub ?? 'unknown'}, client ${c.intro.client_id ?? 'unknown'}, scope ${c.intro.scope ?? 'none'}`,
  P1AZDecision: (c) => {
    const names = namesOf(c.statements);
    const r = c.resolver;
    return `PingOne Authorize said ${c.decision}${names.length ? ': ' + names.join(', ') : ''}.`
      + (r ? ` Account context resolved (${[r.accountId, ...(r.attributes ?? [])].filter(Boolean).join(', ')}).` : '');
  },
};

function stepsFor(c) {
  const steps = (Array.isArray(c.filterChain) ? c.filterChain : []).map((f) => {
    const held = f.result === 'blocked' && c.paused;
    const status = f.result === 'passed' || f.result === 'forwarded' ? ok(f.result)
      : held ? warn('held')
        : f.result === 'blocked' ? err('blocked') : idle(f.result ?? 'unknown');
    return { title: f.filter, status, text: (FILTER_TEXT[f.filter] ?? (() => ''))(c), tag: 'Gateway filter' };
  });
  steps.push({
    title: 'Upstream MCP server',
    status: c.forwarded ? ok('forwarded') : idle('not called'),
    text: c.forwarded ? 'Forwarded. The MCP server answered.' : `Never reached: stopped at ${c.stoppedAt ?? 'an earlier step'}.`,
    tag: 'Gateway filter',
  });
  return steps;
}

function auditOf(a) {
  if (!a || typeof a !== 'object') return undefined;
  const { who = {}, what = {}, where = {}, how = {} } = a;
  return {
    Who: kv({ userSub: who.userSub, agentSub: who.agentSub, clientId: who.clientId, actDepth: who.actDepth }),
    What: kv({ mcpMethod: what.mcpMethod, tool: what.tool, transactionType: what.transactionType, transactionAmount: what.transactionAmount }),
    When: kv({ when: a.when != null ? new Date(a.when).toISOString() : null }),
    Where: kv({ resourceId: where.resourceId, vertical: where.vertical }),
    Why: kv({ reason: how.reason ?? (namesOf(a.statements).join(', ') || null) }),
    How: kv({ decision: how.decision, backend: how.backend, result: how.result }),
  };
}

function hopsFor(c) {
  const stopped = c.stoppedAt;
  const first = { dir: c.entry, call: 'POST /mcp tools/call', what: c.entry === 'BFF → Gateway' ? 'This page asked the gateway to run the tool.' : 'The AI agent asked the gateway to run the tool.', status: c.status, ms: c.ms, request: { tool: c.tool, args: c.args }, response: c.response };
  // No audit trail (BFF down, network failure): the gateway never reported, so draw only what we know.
  if (c.noTrail) return [first];
  return [
    first,
    { dir: 'Gateway → PingOne', call: 'POST /as/introspect', what: 'The gateway checked the token with PingOne.', status: c.intro.active === false ? err('inactive') : ok('active'), ms: null, request: null, response: c.intro },
    { dir: 'Gateway → PingOne Authorize', call: 'POST /decisionEndpoints/{id}', what: 'The gateway asked PingOne Authorize for a decision.', status: c.decision === 'DENY' ? err('DENY') : c.paused ? warn('PAUSE') : ok(c.decision ?? 'unknown'), ms: null, request: { parameters: c.parameters }, response: c.rawResponse },
    { dir: 'Gateway → MCP server', call: `POST /mcp tools/call ${c.tool}`, what: c.forwarded ? 'The gateway forwarded the call to the MCP server.' : 'Stopped at ' + (stopped ?? 'an earlier step'), status: c.forwarded ? ok('forwarded') : idle('not called'), ms: null, request: { tool: c.tool, args: c.args }, response: null },
  ];
}

function bannerOf(status, c) {
  if (status.tone === 'ok') return null;
  if (status.tone === 'warn') return { tone: 'warn', title: c.rateLimited ? 'Rate limited' : 'Held for approval', text: c.message ?? 'The gateway stopped the call.' };
  return { tone: 'err', title: c.decision === 'DENY' ? 'Denied by PingOne Authorize' : 'Call failed', text: c.message ?? (namesOf(c.statements).join(', ') || 'The gateway stopped the call.') };
}

/** Shared by tests and records. n has the normalized fields. */
function build(n) {
  const paused = n.decision === 'PERMIT' && isPause(n.decision, { statements: n.statements, response: n.rawResponse });
  const forwarded = n.decision === 'PERMIT' && !paused && !n.stoppedAt && n.ok !== false;
  const status = statusOf({ ...n, paused });
  const c = { ...n, paused, forwarded, status, intro: n.introspection ?? {}, entry: n.src === 'you' ? 'BFF → Gateway' : 'AI agent → Gateway', stoppedAt: n.stoppedAt ?? null };
  const chips = [];
  if (c.stoppedAt) chips.push(idle('Stopped at: ' + c.stoppedAt));
  if (c.backend) chips.push(idle('Backend: ' + c.backend));
  return {
    id: n.id, at: n.at, kind: n.method || 'tools/call', title: n.tool, src: n.src, ms: n.ms ?? null, status, chips,
    banner: bannerOf(status, c),
    corr: n.correlationId || null,
    request: { label: 'tools/call request', where: c.entry, body: { tool: n.tool, args: n.args } },
    response: { label: 'Gateway response', where: 'Gateway → ' + c.entry.split(' → ')[0], body: n.response ?? n.rawResponse ?? null },
    tokens: [...tokensFromEvents(n.tokenEvents), ...(n.rawInboundToken ? [sentView(n.rawInboundToken)] : []), ...(n.introspection ? [claimsView(n.introspection)] : [])],
    hops: hopsFor({ ...c, response: n.response ?? n.rawResponse ?? null }),
    steps: stepsFor(c),
    audit: auditOf(n.mcpAudit && { ...n.mcpAudit, statements: n.statements }),
    input: n.input ?? { tool: n.tool, args: n.args },
  };
}

function rateLimitedCall({ id, at, ms, tool, args, res, hops }) {
  const status = warn('429 Rate limited');
  const note = 'Rate limit hit before any checks ran';
  const call = {
    id, at, kind: 'tools/call', title: tool, src: 'you', ms: ms ?? null, status, chips: [],
    banner: { tone: 'warn', title: 'Rate limited', text: res.message ?? note },
    corr: null,
    request: { label: 'tools/call request', where: 'BFF → Gateway', body: { tool, args } },
    response: { label: 'Gateway response', where: 'Gateway → BFF', body: res },
    tokens: [],
    hops: [{ dir: 'BFF → Gateway', call: 'POST /mcp tools/call', what: 'This page asked the gateway to run the tool.', status: warn('429'), ms: ms ?? null, request: { tool, args }, response: res }],
    steps: [{ title: 'Rate limit', status: warn('429'), text: res.retryAfterMs ? `${note}. Retry after ${res.retryAfterMs} ms.` : note, tag: 'Gateway filter' }],
    input: { tool, args },
  };
  if (hops === 2) call.hops.push({ dir: 'Gateway → PingOne', call: 'POST /as/introspect', what: note, status: idle('not called'), ms: null, request: null, response: null });
  return call;
}

/** @returns {import('./inspectorCalls').InspectorCall} */
export function gatewayCallFromTest(res, { tool, args, at }) {
  const id = `gw-test-${at}-${seq++}`;
  if (res.rateLimited) return rateLimitedCall({ id, at, ms: res.durationMs, tool, args, res, hops: 2 });
  const t = res.gwAuditTrail ?? {};
  const a = t.authorize ?? {};
  const body = res.ok === false ? { error: res.error, httpStatus: res.httpStatus, gatewayErrorCode: res.gatewayErrorCode, message: res.message } : res.result;
  return build({
    id, at, src: 'you', ms: res.durationMs, tool, args, ok: res.ok, httpStatus: res.httpStatus, message: res.message,
    noTrail: !res.gwAuditTrail, decision: a.decision ?? res.decision, backend: a.backend, method: a.method, parameters: a.parameters, rawResponse: a.rawResponse, statements: a.statements,
    resolver: a.resolver, introspection: t.introspection, mcpAudit: t.mcpAudit, filterChain: t.filterChain, stoppedAt: t.denyingFilter,
    tokenEvents: res.tokenEvents, rawInboundToken: res.rawInboundToken, response: body,
  });
}

/** One call per burst result: hop 1 and a Rate limit step only. */
export function gatewayCallsFromBurst(res, { tool, args, at }) {
  return (res.results ?? []).map((r) => {
    const id = `gw-burst-${at}-${r.index}`;
    const ts = at + r.index;
    if (r.rateLimited) return rateLimitedCall({ id, at: ts, ms: r.durationMs, tool, args, res: r, hops: 1 });
    const status = r.ok ? ok('200 OK') : err(String(r.httpStatus || 'Error'));
    const body = r.ok ? r.result ?? null : { error: r.error, httpStatus: r.httpStatus, message: r.message };
    return {
      id, at: ts, kind: 'tools/call', title: tool, src: 'you', ms: r.durationMs ?? null, status, chips: [],
      banner: r.ok ? null : { tone: 'err', title: 'Call failed', text: r.message ?? r.error ?? 'The gateway returned an error.' },
      corr: null,
      request: { label: 'tools/call request', where: 'BFF → Gateway', body: { tool, args } },
      response: { label: 'Gateway response', where: 'Gateway → BFF', body },
      tokens: [],
      hops: [{ dir: 'BFF → Gateway', call: 'POST /mcp tools/call', what: 'This page asked the gateway to run the tool.', status, ms: r.durationMs ?? null, request: { tool, args }, response: body }],
      steps: [{ title: 'Rate limit', status: ok('under the limit'), text: 'Rate limit and size checks.', tag: 'Gateway filter' }],
      input: { tool, args },
    };
  });
}

/** @returns {import('./inspectorCalls').InspectorCall} */
export function gatewayCallFromRecord(rec) {
  const intro = {
    sub: rec.sub, aud: rec.aud, scope: rec.scope, iss: rec.iss, client_id: rec.clientId,
    ...(rec.actor ? { act: { sub: rec.actor } } : {}),
  };
  const claims = Object.fromEntries(Object.entries(intro).filter(([, v]) => v));
  const introspection = { ...claims, ...(rec.email ? { email: rec.email } : {}), ...(rec.introspectionActive != null ? { active: rec.introspectionActive } : {}) };
  const n = build({
    id: `gw-rec-${rec.ts}-${rec.tool}-${rec.correlationId}`, at: Date.parse(rec.ts), src: 'agent', ms: null,
    tool: rec.tool, args: {}, input: { tool: rec.tool, args: {}, partial: true }, method: rec.method,
    decision: rec.decision, backend: rec.backend, parameters: rec.parameters, rawResponse: rec.rawResponse, statements: rec.statements,
    introspection, mcpAudit: rec.mcpAudit && !rec.mcpAudit.truncated ? rec.mcpAudit : null,
    filterChain: rec.filterChain, stoppedAt: rec.stoppedAt, correlationId: rec.correlationId, message: rec.reason,
  });
  return n;
}

/** Drops a record call that a test call from this page already shows. */
export function dedupeGatewayCalls(testCalls, recordCalls) {
  // ponytail: heuristic dedupe; switch to correlationId once the ingest records it
  const dup = (r) => testCalls.some((t) => t.title === r.title && t.status.label === r.status.label && Math.abs(t.at - r.at) <= 5000);
  return [...recordCalls.filter((r) => !dup(r)), ...testCalls].sort((a, b) => b.at - a.at);
}

const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?/;

/** Gateway log lines near the call that mention its tool. */
export function logLinesFor(call, lines) {
  const lo = call.at - 2000;
  const hi = call.at + (call.ms ?? 0) + 2000;
  return (lines ?? []).filter((l) => {
    const m = ISO.exec(l);
    if (!m) return false;
    const t = Date.parse(m[0].endsWith('Z') ? m[0] : m[0] + 'Z');
    return t >= lo && t <= hi && l.includes(call.title);
  });
}
