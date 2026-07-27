'use strict';

/**
 * Every provisioned A2A specialist must be a REGISTERED ACTOR in the policy.
 *
 * WHY THIS EXISTS
 *
 * 2026-07-27: the P1AZ policy's HasValidActorChain condition is an OR of
 * `ActClientId Equals <registered actor>`. It held 7 ids while the tenant had 9
 * A2A specialists. The four missing (tax, finaid, supplier, holdings) mapped
 * exactly onto the four verticals that failed delegation — government,
 * university, manufacturing, investment.
 *
 * The failure mode is what makes this worth a check. Those calls were denied as
 * `mcp-invalid-actor`, i.e. a CORRECT two-hop delegation chain rejected for
 * carrying an unrecognised specialist. On the ProofStrip that reads as "the
 * delegation control worked" — a DENY is exactly what UC2 is supposed to
 * produce. The demo looks right while four verticals are silently broken, and
 * nothing else in the board notices: `verify:a2a-policy` catches it but is a
 * manual script, and it costs ~25s of rate-limited PingOne calls, so it cannot
 * run on every board.
 *
 * This is the offline half: compare the specialists that are CONFIGURED against
 * the actors the policy REGISTERS. No network, no PingOne, runs in milliseconds.
 * It cannot tell you the live policy matches the snapshot — that is what
 * `npm run verify:a2a-policy` is for — but it catches the drift that produced
 * the incident, which is adding a specialist and forgetting the allowlist.
 */

const fs = require('fs');
const path = require('path');
const { register } = require('./registry');

/** Same /repo vs /app probe the other checks use — __dirname differs in-container. */
function repoRoot() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..'),
    '/repo',
    path.resolve(__dirname, '..', '..'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'snapshots'))) return c;
  }
  return candidates[0];
}

const SNAPSHOT = 'snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json';
const ACTOR_CONDITION = 'HasValidActorChain';

/** Every string constant under a condition tree. */
function constants(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const c = node.comparison && node.comparison.right && node.comparison.right.constant;
  if (c && typeof c.value === 'string') out.push(c.value);
  for (const v of Object.values(node)) constants(v, out);
  return out;
}

/**
 * @returns {{registered:string[], configured:Array<{key:string,id:string}>, missing:Array<{key:string,id:string}>, error?:string}}
 */
function auditRegisteredActors() {
  const snapPath = path.join(repoRoot(), SNAPSHOT);
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  } catch (err) {
    return { registered: [], configured: [], missing: [], error: `cannot read ${SNAPSHOT}: ${err.message}` };
  }

  const cond = Array.isArray(snap) ? snap.find((o) => o && o.name === ACTOR_CONDITION) : null;
  if (!cond) {
    return { registered: [], configured: [], missing: [], error: `${ACTOR_CONDITION} not found in the snapshot` };
  }
  const registered = constants(cond.condition);

  // The specialists this deployment actually has credentials for. Gitignored, so
  // an environment without them yields an empty list and the check passes
  // vacuously rather than failing a checkout it cannot judge.
  const configured = Object.keys(process.env)
    .filter((k) => /^PINGONE_A2A_[A-Z0-9]+_AGENT_CLIENT_ID$/.test(k))
    .map((k) => ({ key: k.replace(/^PINGONE_A2A_|_AGENT_CLIENT_ID$/g, ''), id: String(process.env[k] || '').trim() }))
    .filter((e) => e.id);

  const missing = configured.filter((e) => !registered.includes(e.id));
  return { registered, configured, missing };
}

const a2aActors = {
  id: 'a2a.registered_actors',
  name: 'A2A specialists are registered actors in the policy',
  category: 'PingOne Authorize',
  severity: 'blocking',
  async run() {
    const { registered, configured, missing, error } = auditRegisteredActors();

    if (error) {
      return {
        status: 'warn',
        detail: `Could not audit the actor allowlist — ${error}`,
        nextAction: 'The P1AZ snapshot is the source for this check; regenerate with `node snapshots/gen-authorize-snapshot.js`.',
      };
    }
    if (!configured.length) {
      return {
        status: 'warn',
        detail: `Policy registers ${registered.length} actor(s), but no PINGONE_A2A_*_AGENT_CLIENT_ID is set here — nothing to compare.`,
        meta: { registered: registered.length },
        nextAction: 'Expected on a checkout without demo_api_server/.env. On the demo host this should list the specialists.',
      };
    }
    if (missing.length) {
      return {
        status: 'fail',
        detail:
          `${missing.length} of ${configured.length} A2A specialist(s) are NOT registered actors: `
          + `${missing.map((m) => m.key.toLowerCase()).join(', ')}. `
          + 'Their verticals will DENY a correct two-hop chain as mcp-invalid-actor — which looks '
          + 'like the delegation control working, not like a misconfiguration.',
        meta: { missing, registeredCount: registered.length, configuredCount: configured.length },
        nextAction:
          'Regenerate the snapshot with demo_api_server/.env loaded (the allowlist is a union, so it '
          + 'only grows), re-import it in the PingOne console, then confirm with '
          + '`npm run verify:a2a-policy` — expect 9/9.',
      };
    }
    return {
      status: 'pass',
      detail: `All ${configured.length} configured A2A specialist(s) are registered actors (${registered.length} total in the policy).`,
      meta: { registeredCount: registered.length, configuredCount: configured.length },
    };
  },
};

register(a2aActors);
module.exports = { a2aActors, auditRegisteredActors };
