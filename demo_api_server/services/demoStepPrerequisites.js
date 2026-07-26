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
 * Flags that must stay ON for any MCP tool chip.
 *
 * This used to also list ff_gateway_brokered_exchange. That flag was removed:
 * its OFF path made Exchange #2 request tool scopes spanning multiple PingOne
 * resources, which PingOne rejects outright —
 *   invalid_scope: "May not request scopes for multiple resources"
 * — surfacing as the opaque "That step couldn't be completed". Gateway-brokered
 * is now the only path, so there is nothing left to arm. See
 * docs/dual-exchange-broker.md.
 */
const MCP_GATEWAY_RUNTIME_FLAGS = [
  'ff_mcp_gateway_pinggateway',
];

/**
 * Whether a use case exercises the PAR/RAR (Pushed Authorization Request) path.
 * Catches non-chip triggers — attack sim `rar-exceeded` and the intent-binding
 * learning link — that require live PingOne PAR config to run.
 * @param {object|null|undefined} uc
 * @returns {boolean}
 */
function needsParConfig(uc) {
  if (!uc) return false;
  const trigger = uc.trigger || {};
  if (trigger.sim === 'rar-exceeded') return true;
  if (typeof trigger.path === 'string' && trigger.path.includes('intent-binding')) return true;
  if (Array.isArray(uc.evidence && uc.evidence.tokenChain)) {
    return uc.evidence.tokenChain.some(
      (t) => String(t).startsWith('sim-rar') || t === 'intent-binding-verified',
    );
  }
  return false;
}

/**
 * configStore keys that must all be set for PingOne PAR (RFC 9126) — the AI
 * Agent Actor (WEB) app's PAR push + token exchange. Mirrors the live check
 * in routes/intentBinding.js (parEndpoint / clientId / clientSecret / redirect).
 */
const PAR_CONFIG_KEYS = [
  'pingone_par_endpoint',
  'pingone_ai_agent_actor_client_id',
  'pingone_ai_agent_actor_client_secret',
  'pingone_ai_agent_actor_redirect_uri',
];

/**
 * Check PingOne PAR (RFC 9126) config keys are present.
 * @param {{ getEffective: (k: string) => * }} cfg configStore-like
 * @returns {{ ok: boolean, missing: string[] }}
 */
function checkParConfig(cfg) {
  const missing = PAR_CONFIG_KEYS.filter((k) => {
    const v = cfg && typeof cfg.getEffective === 'function' ? cfg.getEffective(k) : null;
    return !v;
  });
  return { ok: missing.length === 0, missing };
}

/**
 * Whether a catalog entry exercises the MCP token-exchange path.
 * @param {object|null|undefined} uc
 * @returns {boolean}
 */
function needsMcpGatewayRuntime(uc) {
  return Boolean(uc && typeof uc.primaryTool === 'string' && uc.primaryTool.trim());
}

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
  if (needsMcpGatewayRuntime(uc)) {
    for (const f of MCP_GATEWAY_RUNTIME_FLAGS) flags.add(f);
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
 * @returns {{ ok: boolean, requiredFlags: string[], a2a: ReturnType<typeof checkA2aCredentials>|null, par: ReturnType<typeof checkParConfig>|null, errors: string[] }}
 */
/**
 * Whether a configStore-like value means the flag is armed.
 * @param {*} v
 * @returns {boolean}
 */
function isFlagOn(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function checkChipPrerequisites(uc, vertical, cfg) {
  const requiredFlags = requiredFlagsForUseCase(uc);
  const errors = [];
  let a2a = null;
  let par = null;
  for (const flag of requiredFlags) {
    const v = cfg && typeof cfg.getEffective === 'function' ? cfg.getEffective(flag) : null;
    if (!isFlagOn(v)) {
      errors.push(`flag ${flag} is off`);
    }
  }
  if (needsA2aCredentials(uc)) {
    a2a = checkA2aCredentials(vertical, cfg);
    if (a2a.required && !a2a.ok) {
      errors.push(
        `${a2a.specialistName || 'Agent 2'} credentials missing `
        + `(${a2a.clientIdKey} / ${a2a.clientSecretKey})`,
      );
    }
  }
  if (needsParConfig(uc)) {
    par = checkParConfig(cfg);
    if (!par.ok) {
      errors.push(`PAR config missing: ${par.missing.join(', ')}`);
    }
  }
  return {
    ok: errors.length === 0,
    requiredFlags,
    a2a,
    par,
    errors,
  };
}

module.exports = {
  A2A_USE_CASE_IDS,
  MCP_GATEWAY_RUNTIME_FLAGS,
  needsMcpGatewayRuntime,
  requiredFlagsForUseCase,
  requiredFlagsForUseCaseId,
  needsA2aCredentials,
  checkA2aCredentials,
  checkChipPrerequisites,
  isFlagOn,
  needsParConfig,
  checkParConfig,
  PAR_CONFIG_KEYS,
};
