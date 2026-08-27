'use strict';
/**
 * agentIdentity.js — which OAuth client an autonomous agent authenticates as.
 *
 * Phase 1 decided each autonomous agent gets its OWN PingOne registration, so
 * the inventory can be filtered to "everything that runs unattended" and a
 * misbehaving agent revoked on its own. Phases 2-3 added the registrations to
 * scope-topology.json — and then every run authenticated with the shared MCP
 * token-exchanger client anyway, because the jobs never passed a clientId and
 * agentCCTokenService defaults to that one.
 *
 * The declared identity and the acting identity had drifted apart, and the
 * trace papered over it. This resolves the agent's own credentials when they
 * are configured, and says plainly when they are not.
 *
 * DELIBERATELY NOT FAIL-CLOSED. The registrations exist in the topology but
 * have never been provisioned in the tenant (Phase 1: "topology entry only,
 * the live tenant is untouched"), so refusing to run without them would break
 * a working demo to punish a gap the operator has not been given the chance to
 * close. Instead the run proceeds on the shared client and is MARKED as having
 * done so, everywhere it is visible. A visible gap gets fixed; a hidden one
 * gets demoed.
 */

const configStore = require('./configStore');

/**
 * configStore key prefixes, by scope-topology apps{} key. Set
 * <prefix>_client_id / <prefix>_client_secret to give an agent its own identity;
 * provisioning the app in PingOne is the other half.
 */
const AGENT_CREDENTIAL_PREFIX = {
  'Super Banking Fraud Watch Agent': 'pingone_fraud_watch_agent',
  'Super Banking Balance Sweep Agent': 'pingone_balance_sweep_agent',
};

/**
 * @param {string} agentName scope-topology apps{} key
 * @returns {{
 *   clientId: string|null, clientSecret: string|null,
 *   ownIdentity: boolean, reason: string
 * }}
 */
function resolveAgentCredentials(agentName) {
  const prefix = AGENT_CREDENTIAL_PREFIX[agentName];
  if (!prefix) {
    return {
      clientId: null, clientSecret: null, ownIdentity: false,
      reason: `no credential mapping is declared for "${agentName}"`,
    };
  }

  const clientId = configStore.getEffective(`${prefix}_client_id`);
  const clientSecret = configStore.getEffective(`${prefix}_client_secret`);

  if (clientId && clientSecret) {
    return { clientId, clientSecret, ownIdentity: true, reason: 'the agent\'s own registration' };
  }
  return {
    clientId: null, clientSecret: null, ownIdentity: false,
    reason: `${prefix}_client_id/_secret are not configured — the agent's PingOne registration exists in scope-topology.json but has not been provisioned, so this run borrows the shared token-exchanger client`,
  };
}

module.exports = { resolveAgentCredentials, AGENT_CREDENTIAL_PREFIX };
