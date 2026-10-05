// The Privilege AI Gateway's own record of what it did, read for one run.
//
// The gateway has no "what did you decide" API. It writes a line per guardrail
// verdict and per model call to its log, and the deployment ships those lines
// to the `gateway-events` index. This reads them the same way the Gateway
// findings panel does (components/GatewayVerdicts.jsx): through the gateway
// itself, via the Privilege OpenSearch door of the MCP inspector. That door
// needs its own sign-in once per session, so a caller must handle `needsAuth`.
import { authGate, extractSearchHits, frameworkLabel, pickSearchTool } from '../components/GatewayVerdicts';

const PROFILE_ID = 'built-in-privilege-opensearch';
const INDEX = 'gateway-events';
const INSPECTOR_BASE = '/api/mcp/inspector';
// Where a person signs in to the door; the Gateway findings panel lives there.
export const GATEWAY_RECORD_SIGN_IN_PATH = '/llm-gateway';

const unique = (values) => [...new Set(values.filter(Boolean))];

/**
 * One guardrail verdict line, as the views show it. The key the line carries
 * (`VirtualKeyID`) is a credential and is left behind here.
 */
export function normalizeGuardrailEvent(doc) {
  const src = doc?._source || doc || {};
  const mappings = Array.isArray(src.ComplianceMappings) ? src.ComplianceMappings : [];
  const byFramework = {};
  for (const mapping of mappings) {
    if (!mapping?.Framework || !mapping.Identifier) continue;
    const label = frameworkLabel(mapping.Framework);
    byFramework[label] = unique([...(byFramework[label] || []), mapping.Identifier]);
  }
  return {
    time: src.time || null,
    event: src.Event || 'unknown',
    category: src.Category || 'unknown',
    direction: src.Direction || 'unknown',
    // The gateway's name for the agent whose key made the call.
    client: src.Client || '',
    rules: unique(mappings.map((mapping) => mapping?.Source)),
    frameworks: Object.entries(byFramework).map(([label, identifiers]) => ({ label, identifiers })),
  };
}

/** One model-call line, as the views show it. */
export function normalizeModelCall(doc) {
  const src = doc?._source || doc || {};
  const number = (value) => (typeof value === 'number' ? value : null);
  return {
    time: src.time || src.RequestTS || null,
    provider: src.Provider || '',
    model: src.Model || '',
    status: number(src.HTTPStatus),
    promptTokens: number(src.PromptTokens),
    completionTokens: number(src.CompletionTokens),
    totalTokens: number(src.TotalTokens),
    costUsd: number(src.CostUSD),
    latencyMs: number(src.LatencyMs),
  };
}

/**
 * The gateway's lines between two instants (epoch ms), oldest first.
 * Resolves `{ state, guardrail, modelCalls, loginUrl?, error? }` where state is
 * `ready`, `needsAuth` (sign in to the door first) or `error`. Never rejects:
 * the record is evidence beside a run, not part of it.
 */
export async function loadGatewayRecord({ since, until, fetchImpl = fetch } = {}) {
  const empty = { guardrail: [], modelCalls: [] };
  try {
    const toolsRes = await fetchImpl(`${INSPECTOR_BASE}/tools?profile=${encodeURIComponent(PROFILE_ID)}`, { credentials: 'include' });
    const toolsBody = await toolsRes.json().catch(() => ({}));
    const gate = authGate(toolsRes, toolsBody);
    if (gate) return { state: 'needsAuth', loginUrl: gate.loginUrl, ...empty };
    if (!toolsRes.ok || toolsBody.error) throw new Error(toolsBody.reason || toolsBody.error || `HTTP ${toolsRes.status}`);
    const tool = pickSearchTool(toolsBody.tools);
    if (!tool) {
      throw new Error('the gateway findings door is connected, but its search tool (SearchIndexTool) is not granted to this user. Grant it in the Privilege console: Agentic Apps, the OpenSearch app, Configure Tools');
    }

    const invokeRes = await fetchImpl(`${INSPECTOR_BASE}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        profile: PROFILE_ID,
        tool,
        params: {
          index: INDEX,
          query_dsl: {
            query: { range: { time: { gte: new Date(since).toISOString(), lte: new Date(until).toISOString() } } },
            sort: [{ time: { order: 'asc' } }],
          },
          size: 50,
        },
      }),
    });
    const invokeBody = await invokeRes.json().catch(() => ({}));
    const invokeGate = authGate(invokeRes, invokeBody);
    if (invokeGate) return { state: 'needsAuth', loginUrl: invokeGate.loginUrl, ...empty };
    if (!invokeRes.ok) throw new Error(invokeBody.error || `HTTP ${invokeRes.status}`);

    const sources = extractSearchHits(invokeBody).map((hit) => hit?._source || hit || {});
    return {
      state: 'ready',
      guardrail: sources.filter((src) => src.msg === 'AIGuard').map(normalizeGuardrailEvent),
      modelCalls: sources.filter((src) => src.msg === 'LLM request').map(normalizeModelCall),
    };
  } catch (error) {
    return { state: 'error', error: error?.message || String(error), ...empty };
  }
}
