'use strict';

/**
 * adminConfig — pure logic for POST /admin/config dynamic config updates.
 *
 * Extracted from index.ts (Phase 3 CR-02) so the devBypass anti-bypass
 * hardening (A + D) is unit-testable without importing index.ts (which runs
 * an async IIFE — loadConfig/listen — on import).
 *
 * Phase 3 CR-02 — devBypass type-coercion silent-bypass fix (A+D combined):
 *
 *   A — Strict-boolean validation (all environments).
 *       `{ devBypass: "true" | 1 | "yes" }` is rejected with HTTP 400 BEFORE
 *       the prod check and BEFORE the assignment loop. The legitimate demo UI
 *       sends real JSON true/false, so it is unaffected.
 *
 *   D — Production hard-refuse any truthy devBypass.
 *       In production, `'devBypass' in updates && updates.devBypass !== false`
 *       → HTTP 403. Turning devBypass OFF in prod (false) is always allowed.
 *
 *   Belt — assignment coercion. `config.devBypass = updates.devBypass === true`,
 *       so the stored value can only ever be a real boolean even if A and D
 *       were somehow bypassed.
 *
 * devBypass stays in the `allowed` list — it MUST remain a runtime UI toggle
 * for the non-prod demo (no restart required, per product requirement).
 */

import { GatewayConfig } from './config';

export const ADMIN_CONFIG_ALLOWED_KEYS: Array<keyof GatewayConfig> = [
  'gatewayResourceUri',
  'mcpOlbWsUrl', 'mcpInvestWsUrl',
  'mcpOlbResourceUri', 'mcpInvestResourceUri',
  'pingAuthorizeEndpoint', 'pingAuthorizeWorkerId',
  'p1azEnabled',
  'hitlServiceUrl',
  'devBypass',
  'requireActForAgentTools',
  'intentTokenRequired',
  'requireRarIntent',
  'rateLimitEnabled',
  'rateLimitMaxRequests',
  'rateLimitWindowMs',
];

export interface AdminConfigResult {
  status: number;
  body: Record<string, unknown>;
  /** true when one or more allowed keys were written to `config` */
  mutated: boolean;
}

function safeView(config: GatewayConfig): Record<string, unknown> {
  return {
    gatewayResourceUri:    config.gatewayResourceUri,
    mcpOlbWsUrl:           config.mcpOlbWsUrl,
    mcpInvestWsUrl:        config.mcpInvestWsUrl,
    mcpOlbResourceUri:     config.mcpOlbResourceUri,
    mcpInvestResourceUri:  config.mcpInvestResourceUri,
    pingAuthorizeEndpoint: config.pingAuthorizeEndpoint,
    pingAuthorizeWorkerId: config.pingAuthorizeWorkerId,
    p1azEnabled:           config.p1azEnabled,
    hitlServiceUrl:        config.hitlServiceUrl,
    devBypass:             config.devBypass,
    requireActForAgentTools: config.requireActForAgentTools,
    intentTokenRequired:   config.intentTokenRequired,
    requireRarIntent:      config.requireRarIntent,
    rateLimitEnabled:      config.rateLimitEnabled,
    rateLimitMaxRequests:  config.rateLimitMaxRequests,
    rateLimitWindowMs:     config.rateLimitWindowMs,
    mcpServerPassthrough:  config.mcpServerPassthrough,
    // Phase 266/267 HTTP backend routes — non-secret addresses + logical
    // audiences only (the X-API-Key for the apikey path is NEVER exposed).
    // Lets the BFF's Agent Gateway page render the full 5-route topology.
    mortgageServiceBaseUrl:           config.mortgageServiceBaseUrl,
    bankingResourceServerBaseUrl:     config.bankingResourceServerBaseUrl,
    bankingResourceServerResourceUri: config.bankingResourceServerResourceUri,
  };
}

/**
 * Apply a POST /admin/config update in place on `config`.
 * Caller is responsible for the x-internal-gateway-secret gate (BL-01) and
 * JSON parsing — this function operates on the already-parsed object.
 *
 * @param config       live GatewayConfig (mutated in place on success)
 * @param updates      parsed JSON request body
 * @param nodeEnv      process.env.NODE_ENV (for the prod hard-refuse, layer D)
 */
export function applyAdminConfigUpdate(
  config: GatewayConfig,
  updates: Partial<Record<string, unknown>>,
  nodeEnv: string | undefined,
): AdminConfigResult {
  const hasDevBypass = Object.prototype.hasOwnProperty.call(updates, 'devBypass');
  const hasRateLimitEnabled = Object.prototype.hasOwnProperty.call(updates, 'rateLimitEnabled');
  const boolKeys = ['requireActForAgentTools', 'intentTokenRequired', 'requireRarIntent'] as const;

  // A — strict-boolean validation (all environments). Reject the whole
  // request on any non-boolean devBypass BEFORE the prod check / assignment.
  if (hasDevBypass && typeof updates.devBypass !== 'boolean') {
    return {
      status: 400,
      body: {
        error: 'invalid_config',
        message: 'devBypass must be a JSON boolean (true/false), not a string or number',
      },
      mutated: false,
    };
  }

  for (const key of boolKeys) {
    if (Object.prototype.hasOwnProperty.call(updates, key) && typeof updates[key] !== 'boolean') {
      return {
        status: 400,
        body: {
          error: 'invalid_config',
          message: `${key} must be a JSON boolean (true/false), not a string or number`,
        },
        mutated: false,
      };
    }
  }

  if (hasRateLimitEnabled && typeof updates.rateLimitEnabled !== 'boolean') {
    return {
      status: 400,
      body: {
        error: 'invalid_config',
        message: 'rateLimitEnabled must be a JSON boolean (true/false), not a string or number',
      },
      mutated: false,
    };
  }

  for (const numKey of ['rateLimitMaxRequests', 'rateLimitWindowMs'] as const) {
    if (Object.prototype.hasOwnProperty.call(updates, numKey)) {
      const v = updates[numKey];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        return {
          status: 400,
          body: {
            error: 'invalid_config',
            message: `${numKey} must be a positive number`,
          },
          mutated: false,
        };
      }
    }
  }

  // D — production hard-refuse any truthy devBypass. After A, updates.devBypass
  // is guaranteed boolean, so `!== false` means "is true" — defense-in-depth
  // phrasing. Turning devBypass OFF (false) in prod is always allowed.
  if (nodeEnv === 'production' && hasDevBypass && updates.devBypass !== false) {
    return {
      status: 403,
      body: {
        error: 'forbidden',
        message: 'devBypass cannot be enabled in production',
      },
      mutated: false,
    };
  }

  let mutated = false;
  for (const key of ADMIN_CONFIG_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      if (key === 'devBypass') {
        // Belt: strict boolean only — never store a truthy non-boolean.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any).devBypass = updates.devBypass === true;
      } else if (key === 'rateLimitEnabled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any).rateLimitEnabled = updates.rateLimitEnabled === true;
      } else if (key === 'requireActForAgentTools' || key === 'intentTokenRequired' || key === 'requireRarIntent') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any)[key] = updates[key] === true;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any)[key] = updates[key as string];
      }
      mutated = true;
    }
  }

  return {
    status: 200,
    body: { ok: true, config: safeView(config) },
    mutated,
  };
}

export { safeView as adminConfigSafeView };
