// Thin wrapper over @cedar-policy/cedar-wasm for the /standalone/cedar demo. The engine module is INJECTED (the page
// passes the web build, the tests the node build) so this file has no wasm loading of its own.
//
// Mapping layer (the only PF-specific piece): a PingFederate token's claims become a Cedar principal with Group parents
// and a request context. `groups` -> principal parents; `scope` -> context.token.scopes; client_id and the act claim
// are DEMO extensions the real Privilege console does not expose (see config/cedarDemoScenarios.js VOCABULARY).
import { CEDAR_SCHEMA, TOOLS } from '../config/cedarDemoScenarios';

const ANNOTATION = (name) => new RegExp(`@${name}\\("((?:[^"\\\\]|\\\\.)*)"\\)`);
const ID = ANNOTATION('id');
const REASON = ANNOTATION('reason');
const APPROVERS = ANNOTATION('approvers');
const grab = (re, text) => (text.match(re) || [])[1];

const entity = (type, id, parents = []) => ({ uid: { type, id }, attrs: {}, parents: parents.map((p) => ({ type: 'Group', id: p })) });
const errMsg = (e) => (e && (e.message || (e.error && e.error.message))) || String(e);

// Claims -> entities. A PF token's groups claim becomes the principal's parents.
export function claimsToEntities(claims) {
  const groups = claims.groups || [];
  return [
    entity('User', claims.sub, groups),
    ...groups.map((g) => entity('Group', g)),
    ...Object.keys(TOOLS).map((t) => entity('Tool', t)),
  ];
}

// Claims + request -> Cedar context. `args.amount` is a Long, so it is rounded and omitted when blank.
export function buildContext(claims, request) {
  const args = {};
  if (request.args && Number.isFinite(Number(request.args.amount)) && request.args.amount !== '') args.amount = Math.round(Number(request.args.amount));
  const token = { scopes: String(claims.scope || '').split(/\s+/).filter(Boolean), client_id: claims.client_id || '' };
  if (claims.actor) token.actor = claims.actor;
  const pinned = `h-${request.tool}`;
  return {
    app: TOOLS[request.tool].app,
    args,
    token,
    approval_count: Number(request.approvalCount) || 0,
    pinnedHash: pinned,
    observedHash: request.schemaDrift ? 'h-CHANGED' : pinned,
  };
}

// Split editor text into named policies (id from @id, else policyN) and read the annotations the demo surfaces.
export function parsePolicies(cedar, text) {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== 'success') return { ok: false, stage: 'parse', errors: (parts.errors || []).map(errMsg) };
  const policies = parts.policies.map((p, i) => ({
    id: grab(ID, p) || `policy${i + 1}`,
    text: p,
    reason: grab(REASON, p),
    approvers: grab(APPROVERS, p),
    effect: /^\s*(@[^\n]*\n\s*)*forbid\b/.test(p) ? 'forbid' : 'permit',
  }));
  const ids = policies.map((p) => p.id);
  if (new Set(ids).size !== ids.length) return { ok: false, stage: 'parse', errors: ['Two policies share the same @id.'] };
  return { ok: true, policies };
}

const policySet = (policies) => ({ staticPolicies: Object.fromEntries(policies.map((p) => [p.id, p.text])), templates: {}, templateLinks: [] });

// Strict validation against the schema: this is what rejects vocabulary the engine does not have (e.g. context.claims).
export function validatePolicies(cedar, policies) {
  const v = cedar.validate({ validationSettings: { mode: 'strict' }, schema: CEDAR_SCHEMA, policies: policySet(policies) });
  if (v.type !== 'success') return { ok: false, stage: 'validate', errors: (v.errors || []).map(errMsg) };
  const errors = (v.validationErrors || []).map((e) => `${e.policyId}: ${errMsg(e)}${e.error && e.error.help ? ` (${e.error.help})` : ''}`);
  return errors.length ? { ok: false, stage: 'validate', errors } : { ok: true, errors: [] };
}

// The bodies to POST to Privilege's AI Policies API (/api/<tenant>/v1/aipolicys), one per policy so the console validates
// each separately. State "Candidate" = validated and stored but never enforced; the console reports the verdict in
// Status.Validation / Status.Error. AuthoringMode "text" is the console's "Write Cedar". Names are console-safe slugs.
export function candidateRequests(policies, { tenant = '<your-tenant-id>', expiresAt = '' } = {}) {
  return policies.map((p) => ({
    ObjectMeta: { Name: `cedar-demo-${p.id}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 63), Namespace: 'default', Tenant: tenant },
    Spec: { Description: `Cedar demo policy ${p.id}. Candidate: validated, never enforced.`, Cedar: `${p.text.trim()}\n`, AuthoringMode: 'text', BuilderForm: '', TemplateID: '', TemplateParams: { Map: {} }, CandidateExpiresAt: expiresAt },
    State: 'Candidate',
  }));
}

// outcome: allow | deny | hold | default-deny. A deny decided only by forbids that carry @approvers is a HOLD, which is
// how the real gateway treats such a rule (it opens an approval and the client retries once it is approved).
export function evaluate(cedar, { policiesText, claims, request }) {
  const parsed = parsePolicies(cedar, policiesText);
  if (!parsed.ok) return parsed;
  const valid = validatePolicies(cedar, parsed.policies);
  if (!valid.ok) return valid;

  const r = cedar.isAuthorized({
    principal: { type: 'User', id: claims.sub },
    action: { type: 'Action', id: request.action },
    resource: { type: 'Tool', id: request.tool },
    context: buildContext(claims, request),
    schema: CEDAR_SCHEMA,
    validateRequest: true,
    policies: policySet(parsed.policies),
    entities: claimsToEntities(claims),
  });
  if (r.type !== 'success') return { ok: false, stage: 'request', errors: (r.errors || []).map(errMsg) };

  const byId = Object.fromEntries(parsed.policies.map((p) => [p.id, p]));
  const deciding = (r.response.diagnostics.reason || []).map((id) => byId[id]).filter(Boolean);
  const decision = String(r.response.decision).toLowerCase() === 'allow' ? 'allow' : 'deny';
  let outcome = decision;
  if (decision === 'deny') outcome = deciding.length === 0 ? 'default-deny' : deciding.every((p) => p.effect === 'forbid' && p.approvers) ? 'hold' : 'deny';
  return {
    ok: true,
    decision,
    outcome,
    deciding: deciding.map((p) => ({ id: p.id, effect: p.effect, reason: p.reason, approvers: p.approvers })),
    evalErrors: (r.response.diagnostics.errors || []).map(errMsg),
  };
}
