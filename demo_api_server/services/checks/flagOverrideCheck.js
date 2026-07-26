'use strict';

/**
 * Surface persisted feature-flag overrides that contradict their own default.
 *
 * WHY THIS EXISTS
 *
 * serializeFlag() marks a flag `pinned` only when an ENV var pins it
 * (PINNED_ENV_ALIASES). A value persisted in the runtime store gets no marker at
 * all — it is returned as plain `value`, indistinguishable from the default. So
 * a flag whose registry default is `true` can sit at `false` forever, in the UI
 * and over the API, with nothing indicating that someone once turned it off.
 *
 * That is not hypothetical. ff_gateway_brokered_exchange has
 * `defaultValue: true` and a description that says "ON (default)", but read
 * `false` on the live stack with no env var and nothing in compose — a stale
 * persisted override. With it off, Exchange #2 spans multiple PingOne resources
 * and PingOne returns invalid_scope, which the agent renders as the opaque
 * "That step couldn't be completed". It accounted for 22 of 50 banking use
 * cases being dead.
 *
 * This check does not change any value. It reports the divergence so an
 * operator can decide, which is the part that was missing.
 */

const { FLAG_REGISTRY, serializeFlag } = require('../../routes/featureFlags');
const { register } = require('./registry');

/** Flags whose default-ON state the demo actually depends on. */
const DEMO_CRITICAL = new Set([
  'ff_mcp_gateway_pinggateway',
  'ff_gateway_brokered_exchange',
  'ff_heuristic_enabled',
]);

/**
 * Compare each flag's effective value against its registry default.
 * @returns {{ overrides: object[], critical: object[] }}
 */
function findOverrides() {
  const overrides = [];
  for (const flag of FLAG_REGISTRY) {
    const s = serializeFlag(flag);
    // An env pin is a deliberate, visible decision — not the silent case.
    if (s.pinned) continue;
    if (s.defaultValue === undefined) continue;
    if (s.value === s.defaultValue) continue;
    overrides.push({
      id: s.id,
      name: s.name,
      category: s.category,
      value: s.value,
      defaultValue: s.defaultValue,
      demoCritical: DEMO_CRITICAL.has(s.id),
    });
  }
  return { overrides, critical: overrides.filter((o) => o.demoCritical) };
}

const flagOverrides = {
  id: 'config.flag_overrides',
  name: 'Persisted flag overrides vs defaults',
  category: 'Config / Secrets',
  severity: 'advisory',
  timeoutMs: 5000,
  async run() {
    let overrides;
    let critical;
    try {
      ({ overrides, critical } = findOverrides());
    } catch (err) {
      return { status: 'fail', detail: err.message };
    }

    if (overrides.length === 0) {
      return { status: 'pass', detail: 'Every flag matches its registry default' };
    }

    const describe = (o) => `${o.id}=${o.value} (default ${o.defaultValue})`;

    if (critical.length > 0) {
      return {
        status: 'fail',
        detail:
          `${critical.length} demo-critical flag(s) are persisted against their default: `
          + `${critical.map(describe).join(', ')}. `
          + 'These are stored runtime values, not env pins — nothing in the UI marks them as overridden.',
        meta: { overrides, critical },
        nextAction:
          'Set them back with PATCH /api/admin/feature-flags, or from the Feature Flags page. '
          + 'With ff_gateway_brokered_exchange off, Exchange #2 fails invalid_scope and chips '
          + 'show "That step couldn\'t be completed".',
      };
    }

    return {
      status: 'warn',
      detail: `${overrides.length} flag(s) differ from their default: ${overrides.map(describe).join(', ')}`,
      meta: { overrides, critical },
      nextAction: 'Expected if you set them deliberately — this only reports that they are not at their default.',
    };
  },
};

register(flagOverrides);
module.exports = { flagOverrides, findOverrides, DEMO_CRITICAL };
