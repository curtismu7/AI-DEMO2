// demo_api_ui/src/utils/requiredDemoFlags.js

/**
 * Feature flags a demo chip / use case needs armed before it can succeed.
 * Mirrors demo_api_server/services/demoStepPrerequisites.js — keep in sync.
 */

const A2A_USE_CASE_IDS = new Set([
  'a2a-delegation',
  'a2a-orchestrator-learning',
  'a2a-generalist-mismatch',
]);

/**
 * Flags that must stay ON for any MCP tool chip. When both are off, Exchange #2
 * requests scopes/audiences across multiple PingOne resources and fails with
 * invalid_scope ("May not request scopes for multiple resources"), which the
 * agent surfaces as the opaque "That step couldn't be completed" fallback.
 */
const MCP_GATEWAY_RUNTIME_FLAGS = [
  'ff_mcp_gateway_pinggateway',
];

/**
 * Whether a catalog entry exercises the MCP token-exchange path.
 * @param {object|null|undefined} uc
 * @returns {boolean}
 */
function needsMcpGatewayRuntime(uc) {
  return Boolean(uc && typeof uc.primaryTool === 'string' && uc.primaryTool.trim());
}

/**
 * @param {object|null|undefined} uc catalog entry
 * @returns {string[]}
 */
export function requiredFlagsForUseCase(uc) {
  if (!uc || typeof uc !== 'object') return [];
  const flags = new Set();
  if (typeof uc.maturity === 'string' && uc.maturity.startsWith('flag:')) {
    const id = uc.maturity.slice('flag:'.length).trim();
    if (id) flags.add(id);
  }
  // This used to also arm ff_a2a_delegation for A2A use cases. That flag was
  // removed — delegation is always on (the a2aDelegated tools have no
  // non-delegated path), so there is nothing left to arm. Kept in sync with
  // demo_api_server/services/demoStepPrerequisites.js.
  if (needsMcpGatewayRuntime(uc)) {
    for (const f of MCP_GATEWAY_RUNTIME_FLAGS) flags.add(f);
  }
  return [...flags];
}

/**
 * @param {string|undefined} useCaseId
 * @param {object[]} [catalog]
 * @returns {string[]}
 */
export function requiredFlagsForUseCaseId(useCaseId, catalog) {
  if (!useCaseId) return [];
  if (Array.isArray(catalog)) {
    const uc = catalog.find((u) => u && u.useCaseId === useCaseId);
    if (uc) return requiredFlagsForUseCase(uc);
  }
  // Chip path may not have the catalog loaded — cover known A2A slugs. Route
  // through requiredFlagsForUseCase so the fallback can't drift from it (an A2A
  // case dispatches a tool, so it needs the gateway runtime flags too).
  if (A2A_USE_CASE_IDS.has(useCaseId)) {
    return requiredFlagsForUseCase({ useCaseId, primaryTool: 'delegate_to_specialist' });
  }
  return [];
}
