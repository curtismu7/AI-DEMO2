// banking_api_ui/src/services/credentialsService.js
import bffAxios from './bffAxios';

/**
 * Submit credentials to the BFF for storage in configStore.
 *
 * @param {string} credentialType  e.g. 'customer_oauth', 'worker_token', 'oauth_client'
 * @param {Object} credentials     { client_id, client_secret, ... }
 * @returns {Promise<{ ok: boolean, updated: string[], retryUrl?: string }>}
 */
export async function submitCredentials(credentialType, credentials) {
  const res = await bffAxios.post('/api/config/credentials/set', {
    credentialType,
    credentials,
  });
  return res.data;
}

/**
 * Check which credentials are missing for a given action.
 *
 * @param {string} actionType  e.g. 'agent_mcp', 'admin_login', 'user_login'
 * @returns {Promise<{ allSet: boolean, missing: string[], credentialType: string, guidance?: object }>}
 */
export async function getMissingCredentials(actionType) {
  const res = await bffAxios.get('/api/config/credentials/missing', {
    params: { action: actionType },
  });
  return res.data;
}
