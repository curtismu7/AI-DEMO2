/**
 * Adapters: PingOne Authorize evaluate results / recent-decision rows -> InspectorCall.
 * Pure functions only.
 */
import { ok, warn, err, idle, tokensFromEvents } from './inspectorCalls';

const statementsOf = (raw) => (Array.isArray(raw?.statements) ? raw.statements : []);
const kvOf = (obj) => Object.entries(obj || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);

function titleFor(preset, p = {}) {
  if (preset === 'transaction') return `${p.TransactionType} $${Number(p.Amount).toLocaleString('en-US')}`;
  if (preset === 'mcp') return p.ToolName;
  return 'Custom decision';
}

function nextStep(r) {
  if (r.decision === 'DENY' && r.stepUpRequired) return 'The app prompts the user for MFA, then sends the call again.';
  if (r.decision === 'PERMIT' && (r.consentRequired || r.hitlRequired)) return 'The app asks for approval (CIBA), then sends the call again with HitlApproved = true.';
  return r.decision === 'PERMIT' ? 'The app goes ahead with the action.' : 'The app stops. The action does not run.';
}

/** @returns {import('./inspectorCalls').InspectorCall} */
export function authorizeCallFromResult({ result, error, parameters, preset, elapsedMs, at, policies }) {
  const r = result ?? {};
  const raw = r.pingoneResponse ?? r.raw;
  const statements = statementsOf(raw);
  const names = statements.map((s) => s.name);
  const needsApproval = r.consentRequired || r.hitlRequired;

  let status;
  let banner = null;
  if (error) {
    status = err('Error');
    banner = { tone: 'err', title: 'PingOne Authorize call failed', text: error };
  } else if (r.decision === 'DENY') {
    status = err('DENY');
    banner = r.stepUpRequired
      ? { tone: 'err', title: 'Denied until the user steps up', text: 'PingOne Authorize wants a stronger sign-in. Statement: ' + names[0] }
      : { tone: 'err', title: 'Denied by PingOne Authorize', text: names.join(', ') || 'No statements returned.' };
  } else if (needsApproval) {
    status = warn('PERMIT · needs approval');
    banner = { tone: 'warn', title: 'Permitted, with a condition', text: "The app must get the user's approval before the tool runs." };
  } else {
    status = ok('PERMIT');
  }

  const chips = [];
  if (r.ruleName) chips.push(idle('Rule: ' + r.ruleName));
  if (r.policyEvalMs != null) chips.push(idle('Policy eval ' + r.policyEvalMs + ' ms'));

  const cached = !!r.workerTokenCached;
  const hops = [
    { dir: 'Browser → BFF', call: 'POST /api/authorize/evaluate-endpoint', what: 'You sent the decision request to the backend.', status: error ? err('error') : ok('200'), ms: elapsedMs ?? null, request: parameters, response: error ? { error } : raw },
    {
      dir: 'BFF → PingOne', call: 'POST /as/token',
      what: cached ? 'Worker token: cached, so no call was made' : 'The backend got a worker token to call PingOne Authorize.',
      status: cached ? idle('skipped') : ok('200'), ms: null, request: null, response: null,
    },
    { dir: 'BFF → PingOne Authorize', call: 'POST /decisionEndpoints/{id}', what: 'The backend asked PingOne Authorize for a decision.', status: error ? err('error') : ok('200'), ms: r.policyEvalMs ?? null, request: r.pingoneRequest?.body ?? null, response: raw ?? null },
  ];

  const steps = [
    { title: 'Built the decision request', status: ok('done'), text: 'The page turned the form into Trust Framework parameters.', kv: kvOf(parameters) },
    { title: 'Got a worker token', status: cached ? idle('cached') : ok('fetched'), text: cached ? 'A cached worker token was reused.' : 'The backend fetched a fresh worker token.' },
    { title: 'Called the decision endpoint', status: error ? err('failed') : ok('done'), text: error ? error : `Sent the request to PingOne Authorize (${r.path ?? 'decision endpoint'}).` },
    {
      title: 'Evaluated the policies', status: status.tone === 'err' ? err(r.decision ?? 'Error') : ok('done'),
      text: 'Matched rules are worked out from the returned statements; PingOne does not return a per-rule trace.',
      policyTree: { policies: policies ?? [], result: r },
    },
    names.length
      ? { title: 'Returned statements', status: ok(String(names.length)), text: names.join(', ') }
      : { title: 'No statements', status: idle('none'), text: 'PingOne returned no statements.' },
    { title: 'What the app does next', status, text: error ? 'Nothing: the call failed.' : nextStep(r) },
  ];

  return {
    id: `authz-${at}-${r.decisionId ?? 'x'}`,
    at,
    kind: `Decision · ${preset}`,
    title: titleFor(preset, parameters),
    src: 'you',
    ms: elapsedMs ?? null,
    status,
    chips,
    banner,
    corr: r.decisionId ?? null,
    request: { label: 'Decision request', ...(r.pingoneRequest?.url ? { where: 'POST ' + r.pingoneRequest.url } : {}), body: r.pingoneRequest?.body ?? { parameters } },
    response: { label: 'PingOne Authorize response', where: 'PingOne Authorize → BFF', body: error ? { error } : raw },
    tokens: tokensFromEvents(r.tokenEvents),
    hops,
    steps,
    input: { preset, parameters },
  };
}

/** @returns {import('./inspectorCalls').InspectorCall} */
export function authorizeCallFromRecent(d) {
  const decision = d.decisionResponse?.decision ?? d.decision;
  const statements = statementsOf(d.decisionResponse);
  const status = decision === 'DENY' ? err('DENY') : decision === 'PERMIT' ? ok('PERMIT') : idle(String(decision ?? 'unknown'));
  return {
    id: `recent-${d.id}`,
    at: Date.parse(d.requestedAt ?? d.createdAt ?? d.timestamp),
    kind: 'Decision · log',
    title: `Decision ${String(d.id).slice(0, 8)}`,
    src: 'log',
    ms: null,
    status,
    chips: [],
    banner: null,
    corr: d.id ?? null,
    request: { label: 'Decision request', body: { note: "PingOne's recent-decisions summary doesn't include the request parameters." } },
    response: { label: 'PingOne Authorize response', body: d },
    tokens: [],
    hops: [{ dir: 'BFF → PingOne Authorize', call: 'GET /recent-decisions', what: 'Read from the PingOne recent-decisions log.', status, ms: null, request: null, response: d }],
    steps: [
      { title: 'Recorded by PingOne', status, text: `PingOne Authorize logged a ${decision ?? 'unknown'} decision.` },
      ...statements.map((s) => ({ title: s.name ?? 'Statement', status: idle('statement'), text: s.code ?? s.description ?? '' })),
    ],
  };
}
