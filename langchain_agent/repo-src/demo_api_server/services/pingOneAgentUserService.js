// banking_api_server/services/pingOneAgentUserService.js
/**
 * Optional: create a PingOne directory user representing the banking agent for a principal.
 * Requires PINGONE_MANAGEMENT_API_TOKEN (or worker token with Directory read/write) and
 * PINGONE_AGENT_POPULATION_ID when creating users via PingOne Platform API.
 */
'use strict';

const axios = require('axios');
const configStore = require('./configStore');

const CUSTOM_ATTR = process.env.PINGONE_AGENT_MAPPING_ATTR_NAME || 'bankingPrincipalUserId';

/**
 * Attempts POST /v1/environments/{envId}/users with a custom attribute linking to the principal.
 * Returns { created: false, reason } if not configured or on error.
 */
async function createAgentRepresentativeUser({
  principalSub,
  principalEmail,
}) {
  const token = process.env.PINGONE_MANAGEMENT_API_TOKEN || process.env.PINGONE_WORKER_ACCESS_TOKEN;
  const populationId = process.env.PINGONE_AGENT_POPULATION_ID;
  if (!token || !populationId) {
    return {
      created: false,
      reason: 'Set PINGONE_MANAGEMENT_API_TOKEN and PINGONE_AGENT_POPULATION_ID to provision agent users in PingOne.',
    };
  }

  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (!envId) {
    return { created: false, reason: 'pingone_environment_id not configured' };
  }

  const agentUsername =
    process.env.PINGONE_AGENT_USERNAME_PREFIX
      ? `${process.env.PINGONE_AGENT_USERNAME_PREFIX}-${principalSub.slice(0, 12)}`
      : `banking-agent-${principalSub.slice(0, 24)}`;

  const body = {
    username: agentUsername,
    email: principalEmail || `${agentUsername}@agent.invalid`,
    name: { given: 'Banking', family: 'Agent' },
    population: { id: populationId },
    customAttributes: {
      [CUSTOM_ATTR]: principalSub,
    },
  };

  try {
    const url = `https://api.pingone.com/v1/environments/${envId}/users`;
    const { data } = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    return {
      created: true,
      pingoneAgentUserId: data.id,
      pingoneAgentUsername: data.username || agentUsername,
      customAttributeName: CUSTOM_ATTR,
      customAttributeValue: principalSub,
    };
  } catch (err) {
    console.error('[PingOneAgentUser] create failed:', err.response?.data || err.message);
    return {
      created: false,
      reason: err.response?.data?.message || err.message,
    };
  }
}

module.exports = {
  createAgentRepresentativeUser,
  CUSTOM_ATTR,
};
