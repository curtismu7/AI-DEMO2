// banking_api_ui/src/services/userInfoService.js
import bffAxios from './bffAxios';

/**
 * Fetch enriched user profile from PingOne userinfo endpoint via BFF.
 * Returns { source, data, timestamp } on success, or { source, error, data: null } on failure.
 * Never throws — caller can safely check result.error.
 */
export async function fetchEnrichedUserInfo() {
  try {
    const response = await bffAxios.get('/api/tokens/userinfo');
    return response.data;
  } catch (err) {
    return {
      source: 'PingOne userinfo',
      error: err.response?.data?.error || err.message || 'Request failed',
      data: null,
    };
  }
}
