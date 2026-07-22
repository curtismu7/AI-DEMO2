// demo_api_server/services/demoStepPrerequisites.js
'use strict';

/**
 * Demo-step runtime prerequisites — flags a chip/use-case needs armed, and
 * (for A2A) whether Agent 2 PingOne credentials are loaded into config.
 *
 * Catalog SoT for flag-gated maturity (`flag:<id>`). Extra flags that are
 * required even when maturity is `works` (e.g. UC2.5 → ff_a2a_delegation)
 * live here so the agent auto-enable path and step-verification share one list.
 */

const {
  clientIdKey,
  clientSecretKey,
  specialistForVertical,
} = require('../config/a2aSpecialists');

/** Use-case slugs that always need A2A delegation armed. */
const A2A_USE_CASE_IDS = new Set([
  'a2a-delegation',
  'a2a-orchestrator-learning',
]);

/**
 * Feature flags that must be ON before this use case can succeed at runtime.
 * @param {object|null|undefined} uc catalog entry (id / useCaseId / maturity / primaryTool)
 * @returns {string[]}
 */
function requiredFlagsForUseCase(uc) {
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
 * Same as requiredFlagsForUseCase but keyed by catalog useCaseId slug
 * (what BankingChips stamp on chip clicks).
 * @param {string|undefined} useCaseId
 * @param {object[]} catalog USE_CASES or listUseCases(vertical)
 * @returns {string[]}
 */
function requiredFlagsForUseCaseId(useCaseId, catalog) {
  if (!useCaseId || !Array.isArray(catalog)) return [];
  const uc = catalog.find((u) => u && u.useCaseId === useCaseId);
  return requiredFlagsForUseCase(uc);
}

/**
 * Whether this use case exercises A2A Agent 2 credentials for a vertical.
 * @param {object|null|undefined} uc
 * @returns {boolean}
 */
function needsA2aCredentials(uc) {
  if (!uc) return false;
  return (
    A2A_USE_CASE_IDS.has(uc.useCaseId)
    || uc.id === 'UC2.5'
    || uc.primaryTool === 'delegate_to_specialist'
  );
}

/**
 * Check Agent 2 client id/secret are loaded for the vertical's specialist.
 * @param {string} vertical
 * @param {{ getEffective: (k: string) => * }} cfg configStore-like
 * @returns {{ required: boolean, ok: boolean, clientIdKey?: string, clientSecretKey?: string, specialistName?: string }}
 */
function checkA2aCredentials(vertical, cfg) {
  const specialist = specialistForVertical(vertical);
  if (!specialist) {
    return { required: false, ok: true };
  }
  const idKey = clientIdKey(specialist.appKey);
  const secretKey = clientSecretKey(specialist.appKey);
  const id = cfg && typeof cfg.getEffective === 'function' ? cfg.getEffective(idKey) : null;
  const secret = cfg && typeof cfg.getEffective === 'function' ? cfg.getEffective(secretKey) : null;
  const ok = Boolean(id && secret);
  return {
    required: true,
    ok,
    clientIdKey: idKey,
    clientSecretKey: secretKey,
    specialistName: specialist.specialistName,
  };
}

/**
 * Full prerequisite verdict for one chip use case in a vertical.
 * @param {object} uc
 * @param {string} vertical
 * @param {{ getEffective: (k: string) => * }} cfg
 * @returns {{ ok: boolean, requiredFlags: string[], a2a: ReturnType<typeof checkA2aCredentials>|null, errors: string[] }}
 */
function checkChipPrerequisites(uc, vertical, cfg) {
  const requiredFlags = requiredFlagsForUseCase(uc);
  const errors = [];
  let a2a = null;
  if (needsA2aCredentials(uc)) {
    a2a = checkA2aCredentials(vertical, cfg);
    if (a2a.required && !a2a.ok) {
      errors.push(
        `${a2a.specialistName || 'Agent 2'} credentials missing `
        + `(${a2a.clientIdKey} / ${a2a.clientSecretKey})`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    requiredFlags,
    a2a,
    errors,
  };
}

module.exports = {
  A2A_USE_CASE_IDS,
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
  needsA2aCredentials,
  checkA2aCredentials,
  checkChipPrerequisites,
};
