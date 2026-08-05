'use strict';

/**
 * scopePolicies.ts — TypeScript port of the Agent Gateway (ping-gateway)
 * scope-enforcement Groovy filters, so the mock Node gateway enforces the
 * SAME demo policy for the same two showcase tools:
 *
 *   - checkWeatherScope()  mirrors ping-gateway/scripts/groovy/tx-weather-scope.groovy
 *   - checkBraveScope()    mirrors ping-gateway/scripts/groovy/tx-brave-scope.groovy
 *
 * Both run on the SAME live feature flags the real gateway reads from the BFF
 * (ff_weather_mcp_showcase / ff_weather_mcp_allowed_state, ff_brave_mcp_showcase)
 * with the identical fail-open/fail-closed posture: an unreachable BFF fails
 * OPEN on `enabled` (a demo toggle, not a security control) but defaults
 * `allowedState` to the NARROWEST state ('texas') — an outage must never
 * accidentally widen the policy. The content/geography check itself remains
 * fail-closed regardless of the flag-fetch outcome.
 *
 * Both are called from GatewayServer.forwardToUpstream() / authorizeMcpRequest.ts
 * BEFORE the request reaches the backend — same position as the Groovy
 * ScriptableFilter, which runs just before ReverseProxyHandler.
 */

import axios from 'axios';

export interface ScopeCheckResult {
  denied: boolean;
  message?: string;
}

interface StateDef {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  abbrevs: Set<string>;
  cities: Set<string>;
}

// Named-state scope data — kept in lockstep with tx-weather-scope.groovy's STATES map.
const STATES: Record<string, StateDef> = {
  texas: {
    latMin: 25.8, latMax: 36.5, lonMin: -106.6, lonMax: -93.5,
    abbrevs: new Set(['tx', 'texas']),
    cities: new Set([
      'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
      'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
      'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
      'brownsville', 'killeen', 'mcallen',
    ]),
  },
  michigan: {
    latMin: 41.7, latMax: 48.3, lonMin: -90.5, lonMax: -82.1,
    abbrevs: new Set(['mi', 'michigan']),
    cities: new Set([
      'detroit', 'grand rapids', 'warren', 'sterling heights', 'ann arbor',
      'lansing', 'dearborn', 'livonia', 'westland', 'troy',
      'farmington hills', 'kalamazoo', 'wyoming', 'southfield', 'rochester hills',
      'taylor', 'pontiac', 'novi', 'st. clair shores', 'royal oak',
    ]),
  },
};
const STATE_LABELS: Record<string, string> = { texas: 'Texas', michigan: 'Michigan' };

interface WeatherFlags {
  enabled: boolean;
  allowedState: string;
}

interface BraveFlags {
  enabled: boolean;
}

async function fetchFlag<T extends { enabled: boolean }>(
  flagUrl: string,
  internalSecret: string,
  defaults: T,
  parse: (body: Record<string, unknown>, defaults: T) => T,
  logTag: string,
): Promise<T> {
  if (!flagUrl) return defaults;
  try {
    const resp = await axios.get(flagUrl, {
      timeout: 3000,
      validateStatus: () => true,
      headers: internalSecret ? { 'x-internal-gateway-secret': internalSecret } : undefined,
    });
    if (resp.status !== 200) {
      console.warn(`[${logTag}] flag check HTTP ${resp.status} — failing open (enabled), defaulting`);
      return defaults;
    }
    return parse((resp.data || {}) as Record<string, unknown>, defaults);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[${logTag}] flag check failed: ${msg} — failing open (enabled), defaulting`);
    return defaults;
  }
}

async function weatherFlags(flagUrl: string, internalSecret: string): Promise<WeatherFlags> {
  return fetchFlag<WeatherFlags>(
    flagUrl,
    internalSecret,
    { enabled: true, allowedState: 'texas' },
    (body, defaults) => {
      const result = { ...defaults, enabled: body.enabled !== false };
      // 'any' is a valid allowedState but deliberately has no STATES entry
      // (no bbox/cities — it means "skip the scope check entirely").
      const allowedState = body.allowedState;
      if (allowedState === 'any' || (typeof allowedState === 'string' && STATES[allowedState])) {
        result.allowedState = allowedState as string;
      }
      return result;
    },
    'TxWeatherScope',
  );
}

async function braveFlags(flagUrl: string, internalSecret: string): Promise<BraveFlags> {
  return fetchFlag<BraveFlags>(
    flagUrl,
    internalSecret,
    { enabled: true },
    (body, defaults) => ({ ...defaults, enabled: body.enabled !== false }),
    'TxBraveScope',
  );
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Mirrors tx-weather-scope.groovy. Only meaningful for tools/call — callers
 * should invoke this once the request has been identified as a get_weather
 * tools/call with an `arguments` object.
 */
export async function checkWeatherScope(
  args: Record<string, unknown> | undefined,
  flagUrl: string,
  internalSecret: string,
): Promise<ScopeCheckResult> {
  const flags = await weatherFlags(flagUrl, internalSecret);
  if (!flags.enabled) {
    return { denied: true, message: 'Agent Gateway: weather capability disabled (ff_weather_mcp_showcase is off)' };
  }

  if (!args) return { denied: false };

  // Wide open — no restriction at all, every location argument shape passes.
  if (flags.allowedState === 'any') return { denied: false };

  const state = STATES[flags.allowedState];
  const stateLabel = STATE_LABELS[flags.allowedState];

  if ('latitude' in args || 'longitude' in args) {
    const latVal = toNum(args.latitude);
    const lonVal = toNum(args.longitude);
    if (latVal == null || lonVal == null) {
      return { denied: true, message: `Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — invalid or incomplete coordinates` };
    }
    if (latVal < state.latMin || latVal > state.latMax || lonVal < state.lonMin || lonVal > state.lonMax) {
      return { denied: true, message: `Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — coordinates outside ${stateLabel}` };
    }
    return { denied: false };
  }

  const city = args.city_name;
  if (typeof city === 'string') {
    // Split on the FIRST comma: "Corpus Christi, TX" -> cityPart="corpus christi",
    // statePart="tx". Exact match on both parts — no substring containment — so
    // "Plano, IL" or "Houston Street, New York, NY" are correctly denied instead
    // of matching on a contained city name. A bare name with no qualifier
    // ("Austin") falls back to an exact allowlist match on the whole string.
    const normalized = city.toLowerCase().trim();
    const commaIdx = normalized.indexOf(',');
    let isInState: boolean;
    if (commaIdx >= 0) {
      const statePart = normalized.slice(commaIdx + 1).trim();
      isInState = state.abbrevs.has(statePart);
    } else {
      // Also accept "austin tx" — nlIntentParser norm() historically replaced
      // commas with spaces before the city was captured for the tool call.
      const sp = normalized.lastIndexOf(' ');
      if (sp > 0 && state.abbrevs.has(normalized.slice(sp + 1).trim())) {
        isInState = true;
      } else {
        isInState = state.cities.has(normalized);
      }
    }
    if (!isInState) {
      return { denied: true, message: `Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — city not recognized as ${stateLabel}` };
    }
    return { denied: false };
  }

  if ('location_name' in args) {
    return { denied: true, message: `Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — saved locations cannot be verified` };
  }

  // No location argument at all (e.g. check_service_status) — nothing to scope.
  return { denied: false };
}

const BRAVE_BLOCKED_TERMS = ['bitcoin', 'cryptocurrency', 'crypto'];

/**
 * Mirrors tx-brave-scope.groovy's content blocklist. Per-caller identity
 * checks were deliberately removed from the real filter (see that file's
 * header comment) — this mirror keeps the same, narrower scope.
 */
export async function checkBraveScope(
  args: Record<string, unknown> | undefined,
  flagUrl: string,
  internalSecret: string,
): Promise<ScopeCheckResult> {
  const flags = await braveFlags(flagUrl, internalSecret);
  if (!flags.enabled) {
    return { denied: true, message: 'Agent Gateway: Brave search capability disabled (ff_brave_mcp_showcase is off)' };
  }

  const query = args?.query;
  if (typeof query === 'string') {
    const normalized = query.toLowerCase();
    const hit = BRAVE_BLOCKED_TERMS.find((term) => normalized.includes(term));
    if (hit) {
      return { denied: true, message: `Agent Gateway: Brave search query contains a blocked term ('${hit}') — demo bank policy` };
    }
  }

  return { denied: false };
}
