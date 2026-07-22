// demo_api_ui/src/utils/requiredDemoFlags.js

/**
 * Feature flags a demo chip / use case needs armed before it can succeed.
 * Mirrors demo_api_server/services/demoStepPrerequisites.js — keep in sync.
 */

const A2A_USE_CASE_IDS = new Set([
  'a2a-delegation',
  'a2a-orchestrator-learning',
]);

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
  if (
    A2A_USE_CASE_IDS.has(uc.useCaseId)
    || uc.id === 'UC2.5'
    || uc.primaryTool === 'delegate_to_specialist'
  ) {
    flags.add('ff_a2a_delegation');
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
  // Chip path may not have the catalog loaded — cover known A2A slugs.
  if (A2A_USE_CASE_IDS.has(useCaseId)) return ['ff_a2a_delegation'];
  return [];
}
