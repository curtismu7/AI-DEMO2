'use strict';

/**
 * verifiedTrustService.js
 *
 * Launches a PingOne DaVinci flow (server-to-server, no browser/widget) to
 * issue a signed Verified Trust assertion for an A2A delegation chain.
 *
 * DaVinci flow launch API:
 *   POST https://orchestrate-api.pingone.com/v1/company/{companyId}/policy/{policyId}/start
 *   Header: X-SK-API-KEY (a DaVinci application API key — NOT the PingOne
 *   Management worker token used elsewhere in this repo; a separate credential).
 *   Response body is whatever the flow's own "Send Success JSON Response" node
 *   returns — this service requires that shape to be { credential, credentialId,
 *   expiresAt }, which is a constraint on how the DaVinci flow gets authored,
 *   not something this client controls.
 *   https://docs.pingidentity.com/davinci/integrating_flows_into_applications/davinci_launching_a_flow_with_an_api_call.html
 *
 * No DaVinci flow exists on this tenant yet (no Verified Trust connector
 * configured as of 2026-08-10) — this is the client that will call one once
 * it's authored and PINGONE_VERIFIED_TRUST_FLOW_ID is set. Until then,
 * issueAgentTrustAssertion() throws NOT_CONFIGURED. Every caller must treat
 * that as fail-open (skip the assertion, keep going), never fail-closed.
 *
 * Exported functions:
 *   isEnabled()
 *     → boolean (ff_verified_trust_a2a flag)
 *
 *   issueAgentTrustAssertion({ agentId, actingForUserId, scope, chainId })
 *     → { credential, credentialId, expiresAt }
 *     throws { code: 'NOT_CONFIGURED' | 'NOT_ENTITLED' | 'MALFORMED_RESPONSE' }
 */

const axios = require('axios');
const configStore = require('./configStore');

function isEnabled() {
  return configStore.getEffective('ff_verified_trust_a2a') === 'true';
}

async function issueAgentTrustAssertion({ agentId, actingForUserId, scope, chainId }) {
  const companyId = process.env.PINGONE_DAVINCI_COMPANY_ID;
  const apiKey = process.env.PINGONE_DAVINCI_API_KEY;
  const flowId = process.env.PINGONE_VERIFIED_TRUST_FLOW_ID;

  if (!companyId || !apiKey || !flowId) {
    const err = new Error(
      'verifiedTrustService not configured — missing PINGONE_DAVINCI_COMPANY_ID, ' +
      'PINGONE_DAVINCI_API_KEY, or PINGONE_VERIFIED_TRUST_FLOW_ID'
    );
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  let res;
  try {
    res = await axios.post(
      `https://orchestrate-api.pingone.com/v1/company/${companyId}/policy/${flowId}/start`,
      {
        agent_id: agentId,
        acting_for: actingForUserId,
        scope,
        chain_id: chainId,
      },
      { headers: { 'X-SK-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 404) {
      const wrapped = new Error(`DaVinci flow call failed (${err.response.status})`);
      wrapped.code = 'NOT_ENTITLED';
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  }

  const { credential, credentialId, expiresAt } = res.data || {};
  if (!credential) {
    const err = new Error(
      "DaVinci flow returned no credential — check the flow's Send Success JSON Response node shape"
    );
    err.code = 'MALFORMED_RESPONSE';
    throw err;
  }

  return { credential, credentialId, expiresAt };
}

module.exports = { isEnabled, issueAgentTrustAssertion };
