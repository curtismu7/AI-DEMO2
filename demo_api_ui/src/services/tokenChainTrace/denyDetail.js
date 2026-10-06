// Deny detail for a failed trace step — the reason / rule / policy / error code
// / required-vs-presented scope the demo is about, pulled out of the raw
// evidence so TraceStepCard can show it FIRST instead of burying it in JSON.
// Pure: reads the step buildTraceSteps produced plus the trace it came from.

const DENY_STEPS = new Set(["authorize", "gateway", "mcp", "intent-binding"]);

/** Gateway defaults when the 429 evidence carries no limit of its own:
 * demo_mcp_gateway/src/config.ts (GATEWAY_RATE_LIMIT_MAX_REQUESTS / _WINDOW_MS)
 * and ping-gateway/scripts/groovy/uc18-rate-limit.groovy (PG_RATE_LIMIT_*). */
export const RATE_LIMIT_DEFAULTS = { maxRequests: 20, windowMs: 60000 };

const has = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);
const first = (...vals) => vals.find(has);
const list = (v) => (Array.isArray(v) ? v.join(" ") : String(v));

function parseJson(text) {
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

function statementsText(statements) {
  if (!has(statements)) return null;
  if (!Array.isArray(statements)) return typeof statements === "string" ? statements : JSON.stringify(statements);
  return statements
    .map((s) => (s && typeof s === "object"
      ? [s.code || s.name, s.payload != null ? (typeof s.payload === "string" ? s.payload : JSON.stringify(s.payload)) : null]
        .filter(Boolean).join(": ")
      : String(s)))
    .filter(Boolean)
    .join(" · ");
}

function secs(ms) { return Math.max(1, Math.ceil(ms / 1000)); }

/** What a rate-limit deny means here, the limit, what was seen, when it clears. */
function rateLimitRows(ev) {
  const max = Number(first(ev?.maxRequests, ev?.rateLimit?.maxRequests)) || 0;
  const win = Number(first(ev?.windowMs, ev?.rateLimit?.windowMs)) || 0;
  const configured = max > 0 && win > 0;
  const retryMs = Number(first(ev?.retryAfterMs, ev?.rateLimit?.retryAfterMs)) || 0;
  const observed = first(ev?.observedCalls, ev?.rateLimit?.observedCalls);
  const layer = ev?.rateLimitLayer;
  return [
    ["what it means", "The gateway counts tool calls per agent + tool in a sliding window. Past the quota it answers 429 before the call reaches PingOne Authorize or the MCP server, so a runaway agent cannot burn resources or cost. This is a throttle, not a permissions decision."],
    ["limit", configured
      ? `${max} calls per ${secs(win)} s per (agent, tool)`
      : `${RATE_LIMIT_DEFAULTS.maxRequests} calls per ${RATE_LIMIT_DEFAULTS.windowMs / 1000} s per (agent, tool) — gateway default (GATEWAY_RATE_LIMIT_* on the Demo Agent Gateway, PG_RATE_LIMIT_* on PingGateway); this response did not report its own`],
    observed != null ? ["observed", `${observed} call${Number(observed) === 1 ? "" : "s"} in the window${configured ? ` (limit ${max})` : ""}`] : null,
    ["resets", retryMs
      ? `in about ${secs(retryMs)} s (Retry-After) — wait that long, then retry; the oldest call ages out of the window.`
      : "when the oldest call ages out of the window (see the Retry-After header) — wait, then retry, or slow the agent down."],
    layer ? ["enforced by", layer === "ig" ? "PingGateway (uc18-rate-limit.groovy)" : "Demo Agent Gateway (rateLimit.ts)"] : null,
  ].filter(Boolean);
}

/**
 * @returns {{ rows: Array<[string,string]>, rateLimit: Array<[string,string]>|null } | null}
 *   null when the step did not fail or no deny detail could be found.
 */
export function extractDenyDetail(step, trace) {
  const id = step?.baseId || step?.id;
  if (step?.status !== "error" || !DENY_STEPS.has(id)) return null;
  const events = trace?.tokenEvents || [];
  const d = step.detail || {};
  const ev = events.find((e) => e && (e.id === "sim-gateway-deny"
    || (/^sim-burst-/.test(e.id || "") && e.error === "rate_limited")
    || e.id === "transfer-blocked")) || null;
  const phase = (trace?.phases || []).find((p) => p && p.phase === "gateway_policy_denied") || null;
  const az = trace?.authorize || null;
  const body = parseJson(d.response?.text) || {};
  const mcp = trace?.mcpResult || {};

  const code = first(ev?.error, body.error_code, body.code, typeof body.error === "string" ? body.error : null,
    id === "mcp" ? mcp.error : null, id === "authorize" ? az?.outcome : null);
  const status = first(ev?.httpStatus, body.status, body.httpStatus);
  const detailLabel = d.decision?.label ? String(d.decision.label) : null;
  const phaseDetail = phase?.detail && phase.detail !== "—" ? phase.detail : null;
  const reason = first(az?.reason, body.reason, body.message, body.error_description, ev?.reason,
    id === "mcp" ? mcp.message : null, phaseDetail, ev?.explanation);
  const statements = statementsText(first(az?.statements, body.statements, ev?.authorizeStatements));
  const policy = first(body.policy, body.policyName, body.rule, body.ruleName, ev?.policy, ev?.rule);
  const required = first(ev?.requiredScopes, ev?.requiredScope, body.requiredScopes, body.required_scope, body.requiredScope);
  const presented = first(ev?.presentedScopes, ev?.tokenScopes, body.presentedScopes, body.presented_scope);
  const tried = first(ev?.triedAudience, ev?.tokenAud, phase?.triedAudience);
  const allowed = first(ev?.allowedAudience, ev?.expectedAud, phase?.allowedAudience);
  const rateLimited = code === "rate_limited" || Number(status) === 429;

  const rows = [
    detailLabel && !reason ? ["decision", detailLabel] : null,
    has(code) ? ["error code", String(code)] : null,
    has(status) ? ["http status", String(status)] : null,
    has(reason) ? ["reason", String(reason)] : null,
    has(policy) ? ["policy / rule", String(policy)] : null,
    statements ? ["statements", statements] : null,
    has(required) || has(presented)
      ? ["scope", `required ${has(required) ? list(required) : "(not reported)"} · presented ${has(presented) ? list(presented) : "(not reported)"}`]
      : null,
    has(tried) || has(allowed)
      ? ["audience", `token ${has(tried) ? list(tried) : "(unknown)"} · expected ${has(allowed) ? list(allowed) : "(unknown)"}`]
      : null,
  ].filter(Boolean);

  const rateLimit = rateLimited ? rateLimitRows(ev) : null;
  if (!rows.length && !rateLimit) return null;
  return { rows, rateLimit };
}
